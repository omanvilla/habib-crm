-- Rollback of SQL157: the two functions get their fragments back.
DO $patch$
DECLARE
  r record; v_def text;
  v_out constant text := ' and not (f.kind in (''negotiation'',''handoff'') and coalesce(f.handoff_reason,'''') ~ ''^\s*دراسة سعر'' and exists (select 1 from public.owner_price_studies s where s.conversation_id = f.id and s.status = ''sent'' and s.owner_reaction is null and s.sent_at < now() - interval ''7 days'' and f.last_inbound_at < s.sent_at))';
  v_silent constant text := 'EXISTS (SELECT 1 FROM public.owner_price_studies s LEFT JOIN public.whatsapp_conversations w ON w.id = s.conversation_id WHERE s.owner_lead_id = ol.id AND s.status = ''sent'' AND s.owner_reaction IS NULL AND s.sent_at < now() - interval ''7 days'' AND coalesce(w.last_inbound_at, ''-infinity'') < s.sent_at)';
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('public.crm_paused_chats()', v_out, ''),
      ('public.crm_call_next(integer)', '(ol.status = ''open'' OR (ol.status = ''studied'' AND ' || v_silent || ')) AND length(d.digits) >= 8', 'ol.status = ''open'' AND length(d.digits) >= 8'),
      ('public.crm_call_next(integer)', ' ''study_days'', CASE WHEN ol.status = ''studied'' THEN (SELECT (now() AT TIME ZONE ''Asia/Muscat'')::date - (max(s.sent_at) AT TIME ZONE ''Asia/Muscat'')::date FROM public.owner_price_studies s WHERE s.owner_lead_id = ol.id AND s.status = ''sent'') END,', '')
    ) AS x(fn, old, new)
  LOOP
    v_def := pg_get_functiondef(r.fn::regprocedure);
    IF position(r.old IN v_def) = 0 THEN CONTINUE; END IF;
    EXECUTE replace(v_def, r.old, r.new);
  END LOOP;
END $patch$;
