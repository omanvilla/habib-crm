-- SQL157 (24 Nov 2026, full system check; Ahmed: «كمّل باقي التحسينات المقترحة»).
-- An owner who got the price study and said nothing for 7 days sat in «العقل موقوف عندهم» for ever (the handoff «دراسة سعر:
-- انرسلت الدراسة للمالك» is a hard one, nothing closes it). Writing to him again does not help; a call does. So:
--   * crm_paused_chats leaves out a «دراسة سعر» chat whose study was sent more than 7 days ago, has no recorded reaction
--     (accepted / counter offer / price rejected stay: those wait for Ahmed's decision) and no message from the owner since.
--     The agent stays paused on the chat; the moment the owner writes, the chat is back on the tile.
--   * crm_call_next («اتصل بعدهم») lists those owners too (offer status studied), with study_days = days since the study
--     went out. The 30-day «already called» rule still takes them off after the call.
-- Patched in place like SQL156: every fragment must be found once, a second run changes nothing.
-- Rollback: 157-silent-study-owners-to-calls.rollback.sql

DO $patch$
DECLARE
  r record; v_def text;
  v_out constant text := ' and not (f.kind in (''negotiation'',''handoff'') and coalesce(f.handoff_reason,'''') ~ ''^\s*دراسة سعر'' and exists (select 1 from public.owner_price_studies s where s.conversation_id = f.id and s.status = ''sent'' and s.owner_reaction is null and s.sent_at < now() - interval ''7 days'' and f.last_inbound_at < s.sent_at))';
  v_silent constant text := 'EXISTS (SELECT 1 FROM public.owner_price_studies s LEFT JOIN public.whatsapp_conversations w ON w.id = s.conversation_id WHERE s.owner_lead_id = ol.id AND s.status = ''sent'' AND s.owner_reaction IS NULL AND s.sent_at < now() - interval ''7 days'' AND coalesce(w.last_inbound_at, ''-infinity'') < s.sent_at)';
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('public.crm_paused_chats()', 'from flagged f where f.kind is not null', 'from flagged f where f.kind is not null' || v_out),
      ('public.crm_call_next(integer)', 'ol.status = ''open'' AND length(d.digits) >= 8',
                                        '(ol.status = ''open'' OR (ol.status = ''studied'' AND ' || v_silent || ')) AND length(d.digits) >= 8'),
      ('public.crm_call_next(integer)', '''created_at'', ol.created_at,',
                                        '''created_at'', ol.created_at, ''study_days'', CASE WHEN ol.status = ''studied'' THEN (SELECT (now() AT TIME ZONE ''Asia/Muscat'')::date - (max(s.sent_at) AT TIME ZONE ''Asia/Muscat'')::date FROM public.owner_price_studies s WHERE s.owner_lead_id = ol.id AND s.status = ''sent'') END,')
    ) AS x(fn, old, new)
  LOOP
    v_def := pg_get_functiondef(r.fn::regprocedure);
    IF position(r.new IN v_def) > 0 THEN CONTINUE; END IF;            -- already patched
    IF position(r.old IN v_def) = 0 THEN RAISE EXCEPTION 'SQL157: fragment not found in %: %', r.fn, left(r.old, 60); END IF;
    IF length(v_def) - length(replace(v_def, r.old, '')) <> length(r.old) THEN RAISE EXCEPTION 'SQL157: fragment not unique in %: %', r.fn, left(r.old, 60); END IF;
    EXECUTE replace(v_def, r.old, r.new);
  END LOOP;
END $patch$;
