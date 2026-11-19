-- SQL147 (19 Nov 2026): the cloud pricing run (first test, Al Amerat land) got «Connection timeout after 1000 ms» twice from
-- crm_price_study_documents: the http extension waits 1 second for the connection to the price-study edge function by
-- default. Both functions that call it now wait up to 20 seconds to connect. Nothing else changes.
-- Rollback: re-run the two functions from SQL145 (documents) and SQL96 (inspection).
CREATE OR REPLACE FUNCTION public.crm_price_study_documents(p_task_id uuid)
 RETURNS TABLE(sent_at timestamp with time zone, kind text, filename text, mime text, size_bytes bigint, caption text, doc_status text, url text, drive_file_id text)
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
  perform extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS', '20000');
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

CREATE OR REPLACE FUNCTION public.crm_price_study_inspection(p_task_id uuid)
 RETURNS TABLE(inspected_at date, note text, photos integer, photo_urls text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare i record; v_secret text; r record; j jsonb;
begin
  select x.inspected_at as d, x.note as n, x.photos as p into i from public.owner_price_study_inspections x where x.task_id = p_task_id;
  if not found then return; end if;
  if cardinality(i.p) = 0 then
    return query select i.d, i.n, 0, '{}'::text[];
    return;
  end if;
  select v.decrypted_secret into v_secret from vault.decrypted_secrets v where v.name = 'crm_reply_agent';
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '60000');
  perform extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS', '20000');
  select h.status as http_status, h.content as http_content into r
    from extensions.http(('POST', 'https://dmsckqjkcnsfmnzfjczz.supabase.co/functions/v1/price-study',
           ARRAY[extensions.http_header('x-crm-agent', v_secret)], 'application/json',
           jsonb_build_object('action', 'sign_inspection', 'task_id', p_task_id)::text)::extensions.http_request) h;
  if r.http_status <> 200 then raise exception 'sign_failed: % %', r.http_status, left(r.http_content, 200); end if;
  j := r.http_content::jsonb;
  return query select i.d, i.n, cardinality(i.p),
    array(select u.v from jsonb_array_elements_text(coalesce(j -> 'photos', '[]'::jsonb)) with ordinality as u(v, n) order by u.n);
end $function$;
