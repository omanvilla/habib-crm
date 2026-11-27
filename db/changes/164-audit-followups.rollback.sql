-- Rollback of SQL164: back to the SQL162 state.
DO $cron$ BEGIN PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'crm_waiting_customers_tasks'; END $cron$;
DROP FUNCTION IF EXISTS crm_repair_private.waiting_customers_tasks();
-- the tasks it made stay (they are Maram's tasks now); only the bookkeeping table goes
DROP TABLE IF EXISTS crm_repair_private.waiting_tasks;

CREATE OR REPLACE FUNCTION public.crm_call_next(p_limit integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE c uuid := public.my_company(); r text := public.my_role(); n integer := greatest(1, least(coalesce(p_limit, 20), 50));
BEGIN
  IF auth.uid() IS NULL OR c IS NULL OR coalesce(r, '') NOT IN ('owner', 'manager', 'agent') THEN
    RAISE EXCEPTION 'call_not_allowed' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(x ORDER BY x->>'created_at' DESC) FROM (
     (SELECT jsonb_build_object('lead_id', ol.id, 'client_id', k.id, 'name', k.name, 'phone', k.phone,
               'kind', ol.kind, 'area', ol.area, 'wilayat', ol.wilayat, 'price', ol.price, 'status', ol.status,
               'created_at', ol.created_at, 'study_days', CASE WHEN ol.status = 'studied' THEN (SELECT (now() AT TIME ZONE 'Asia/Muscat')::date - (max(s.sent_at) AT TIME ZONE 'Asia/Muscat')::date FROM public.owner_price_studies s WHERE s.owner_lead_id = ol.id AND s.status = 'sent') END,
               'last_called_at', (SELECT max(a.occurred_at) FROM public.activities a
                                   WHERE a.company_id = c AND a.channel = 'call' AND a.actor_type = 'human'
                                     AND (a.client_id = k.id OR right(coalesce(a.after_data->>'call_phone', ''), 8) = right(d.digits, 8)))) x
        FROM public.owner_leads ol
        JOIN public.clients k ON k.id = ol.client_id AND k.company_id = ol.company_id AND coalesce(k.archived, false) = false
        CROSS JOIN LATERAL (SELECT regexp_replace(coalesce(k.phone_normalized, k.phone, ''), '\D', '', 'g') digits) d
       WHERE ol.company_id = c AND (ol.status = 'open' OR (ol.status = 'studied' AND EXISTS (SELECT 1 FROM public.owner_price_studies s LEFT JOIN public.whatsapp_conversations w ON w.id = s.conversation_id WHERE s.owner_lead_id = ol.id AND s.status = 'sent' AND s.owner_reaction IS NULL AND s.sent_at < now() - interval '7 days' AND coalesce(w.last_inbound_at, '-infinity') < s.sent_at))) AND length(d.digits) >= 8
         AND (r = 'owner' OR (NOT crm_repair_private.owner_line_is_private(ol.company_id, to_jsonb(ol))
                               AND crm_repair_private.can_access_client(c, k.id)))
         AND NOT EXISTS (SELECT 1 FROM public.activities a
                          WHERE a.company_id = c AND a.channel = 'call' AND a.actor_type = 'human'
                            AND a.occurred_at > now() - interval '30 days'
                            AND (a.client_id = k.id OR right(coalesce(a.after_data->>'call_phone', ''), 8) = right(d.digits, 8)))
       ORDER BY ol.created_at DESC
       LIMIT n)
     UNION ALL
     (SELECT jsonb_build_object('hunt_id', h.id, 'name', h.name, 'phone', h.phone,
               'kind', CASE h.kind WHEN 'بيت' THEN 'house' ELSE 'villa' END, 'area', h.area, 'wilayat', h.wilayat, 'price', h.price,
               'status', 'hunt', 'link', h.link, 'source', h.source, 'created_at', h.last_new_at,
               'last_called_at', (SELECT max(a.occurred_at) FROM public.activities a WHERE a.company_id = c AND a.channel = 'call' AND a.actor_type = 'human'
                                    AND right(coalesce(a.after_data->>'call_phone', ''), 8) = h.phone8))
        FROM public.crm_hunt_leads h
       WHERE h.company_id = c AND h.status = 'new' AND h.last_new_at > now() - interval '21 days'
         AND NOT EXISTS (SELECT 1 FROM public.activities a WHERE a.company_id = c AND a.channel = 'call' AND a.actor_type = 'human'
                          AND a.occurred_at > h.last_new_at AND right(coalesce(a.after_data->>'call_phone', ''), 8) = h.phone8)
         AND NOT EXISTS (SELECT 1 FROM public.owner_leads ol JOIN public.clients k ON k.id = ol.client_id
                          WHERE ol.company_id = c AND right(regexp_replace(coalesce(k.phone_normalized, k.phone, ''), '\D', '', 'g'), 8) = h.phone8)
       ORDER BY h.last_new_at DESC
       LIMIT n)) s), '[]'::jsonb);
END $function$;
REVOKE ALL ON FUNCTION public.crm_call_next(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_call_next(integer) TO authenticated;

SELECT cron.alter_job(jobid, command := $cmd$
  select net.http_post(
    url := 'https://dmsckqjkcnsfmnzfjczz.supabase.co/functions/v1/whatsapp-owner-hot-alert',
    headers := jsonb_build_object('Content-Type','application/json','x-crm-agent', (select decrypted_secret from vault.decrypted_secrets where name='crm_reply_agent')),
    body := '{"action":"price_study_tick"}'::jsonb, timeout_milliseconds := 150000);
$cmd$) FROM cron.job WHERE jobname = 'owner_price_study_tick';
SELECT cron.alter_job(jobid, schedule := '*/5 * * * *') FROM cron.job WHERE jobname = 'sheet_sync_every_5_min';
DROP INDEX IF EXISTS public.whatsapp_automation_events_price_study_open_idx;

DO $office$
DECLARE d text := pg_get_functiondef('public.crm_office_snapshot()'::regprocedure);
BEGIN
  d := replace(d, $o$WHEN d.key = 'hunter' THEN CASE WHEN f.last_out IS NULL THEN 'soon' WHEN$o$, $o$WHEN d.key = 'hunter' THEN CASE WHEN f.last_out IS NULL THEN 'off' WHEN$o$);
  d := replace(d, $o$WHEN rn.last_run IS NULL THEN 'soon'
          WHEN rn.last_run < now() - d.max_age THEN 'yellow'$o$, $o$WHEN rn.last_run IS NULL OR rn.last_run < now() - d.max_age THEN 'yellow'$o$);
  EXECUTE d;
END $office$;
