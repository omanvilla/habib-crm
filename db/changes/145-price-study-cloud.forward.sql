-- SQL145 (19 Nov 2026, Ahmed): pricing runs in the cloud, without Ahmed's laptop.
--   1. «⏰ العقار لسه ما تسعّر» was one WhatsApp message per task (10 in a minute, each one paid at Meta). Now one message a day
--      at most, listing every task still without a study. A task is listed only after two pricing runs (08:00 and 14:00
--      Muscat) passed since it opened, plus 2 hours for the study. The laptop line is gone (text built in price-study).
--      Today's per-task alerts of the old shape count as today's message, so the change itself sends nothing more today.
--   2. The owner's documents (sketch, ownership deed, photos) are copied to Google Drive, folder «مستندات التسعير الآلي»,
--      one sub-folder per task, so the cloud pricing session opens them with the Drive connector (download_file_content)
--      without a browser. owner_price_study_docs.drive_file_id holds the copy; crm_price_study_documents returns it next to
--      url. A cron every 10 minutes copies what is missing for open tasks (the first runs copy the old files once).
-- Rollback: 145-price-study-cloud.rollback.sql
SET LOCAL lock_timeout = '10s';

-- ---------- 1. one alert a day ----------
CREATE OR REPLACE FUNCTION public.crm_price_study_unpriced_due()
 RETURNS TABLE(task_id uuid, company_id uuid, branch text, property_kind text, kind_raw text, area text, wilayat text, waited_minutes integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select b.task_id, b.company_id, b.branch, b.property_kind, b.kind_raw, b.area, b.wilayat,
         (extract(epoch from (now() - t.created_at)) / 60)::integer
    from public.tasks t
   cross join lateral crm_repair_private.price_study_brief(t.id) b
   where t.title ilike 'دراسة سعر%' and not coalesce(t.done, false)
     and t.created_at >= greatest(timestamptz '2026-11-13 00:00:00+04', now() - interval '3 days')
     and not exists (select 1 from public.owner_price_studies s where s.task_id = t.id)
     -- two pricing runs passed since the task opened (tasks opened before the schedule change count from it), plus 2 hours
     and now() >= crm_repair_private.price_study_first_run(
                    crm_repair_private.price_study_first_run(greatest(t.created_at, timestamptz '2026-11-18 14:30:00+04'))) + interval '2 hours'
     and (now() at time zone 'Asia/Muscat')::time >= time '05:00'
     and (now() at time zone 'Asia/Muscat')::time < time '21:15'
     -- one message a day: nothing once today's alert went (the daily one, or the old per-task ones)
     and not exists (select 1 from public.whatsapp_automation_events e
                      where e.company_id = t.company_id and e.action_type = 'owner_notify' and e.status = 'applied'
                        and e.reason like 'price_study_unpriced%'
                        and e.created_at >= ((now() at time zone 'Asia/Muscat')::date::timestamp at time zone 'Asia/Muscat'))
   order by t.created_at
   limit 40
$function$;
REVOKE ALL ON FUNCTION public.crm_price_study_unpriced_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_price_study_unpriced_due() TO service_role;

-- ---------- 2. the documents in Drive ----------
ALTER TABLE public.owner_price_study_docs ADD COLUMN IF NOT EXISTS drive_file_id text;
ALTER TABLE public.owner_price_study_docs ADD COLUMN IF NOT EXISTS drive_error text;

-- the Drive sub-folder of each task (only the edge function reads or writes it)
CREATE TABLE IF NOT EXISTS public.owner_price_study_drive_folders (
  task_id uuid PRIMARY KEY REFERENCES public.tasks(id) ON DELETE CASCADE,
  folder_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.owner_price_study_drive_folders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.owner_price_study_drive_folders FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.owner_price_study_drive_folders TO service_role;

-- open price-study tasks whose chat has a saved document not yet in Drive (or media not saved yet)
CREATE OR REPLACE FUNCTION public.crm_price_study_drive_due()
 RETURNS TABLE(task_id uuid, conversation_id uuid, title text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select x.id, x.conv, x.title
    from (select t.id, t.title, t.created_at, crm_repair_private.price_study_conversation(t.id) conv
            from public.tasks t
           where t.title ilike 'دراسة سعر%' and not coalesce(t.done, false)) x
   where x.conv is not null
     and exists (select 1 from public.owner_price_study_docs d
                  where d.conversation_id = x.conv and d.status = 'saved' and d.storage_path is not null and d.drive_file_id is null
                    and (d.drive_error is null or d.updated_at < now() - interval '1 hour'))
   order by x.created_at
   limit 20
$function$;
REVOKE ALL ON FUNCTION public.crm_price_study_drive_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_price_study_drive_due() TO service_role;

-- the columns change (drive_file_id after url), so the function is made again; same name and input
DROP FUNCTION IF EXISTS public.crm_price_study_documents(uuid);
CREATE FUNCTION public.crm_price_study_documents(p_task_id uuid)
 RETURNS TABLE (sent_at timestamptz, kind text, filename text, mime text, size_bytes bigint, caption text, doc_status text, url text, drive_file_id text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_conv uuid; v_secret text; r record; j jsonb;
begin
  v_conv := crm_repair_private.price_study_conversation(p_task_id);
  if v_conv is null then raise exception 'conversation_not_found_for_task'; end if;
  select v.decrypted_secret into v_secret from vault.decrypted_secrets v where v.name = 'crm_reply_agent';
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '90000');
  select h.status as http_status, h.content as http_content into r
    from extensions.http(('POST', 'https://dmsckqjkcnsfmnzfjczz.supabase.co/functions/v1/price-study',
           ARRAY[extensions.http_header('x-crm-agent', v_secret)], 'application/json',
           jsonb_build_object('action', 'sign', 'conversation_id', v_conv, 'task_id', p_task_id)::text)::extensions.http_request) h;
  if r.http_status <> 200 then raise exception 'sign_failed: % %', r.http_status, left(r.http_content, 200); end if;
  j := r.http_content::jsonb;
  return query
    select (d ->> 'sent_at')::timestamptz, d ->> 'kind', d ->> 'filename', d ->> 'mime', (d ->> 'size')::bigint, d ->> 'caption', d ->> 'status', d ->> 'url', d ->> 'drive_file_id'
      from jsonb_array_elements(coalesce(j -> 'documents', '[]'::jsonb)) d
     order by 1;
end $function$;
REVOKE ALL ON FUNCTION public.crm_price_study_documents(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_price_study_documents(uuid) TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('owner_price_study_drive') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'owner_price_study_drive');
  PERFORM cron.schedule('owner_price_study_drive', '2-52/10 * * * *', $c$
  select crm_repair_private.price_study_call('{"action":"drive_tick"}'::jsonb, 150000)
   where exists (select 1 from public.crm_price_study_drive_due());
$c$);
END $$;
