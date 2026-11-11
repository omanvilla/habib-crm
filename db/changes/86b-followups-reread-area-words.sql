-- SQL86b (11 Nov 2026): SQL86 matched the whole area text («بركاء الرميس»), so «فيلا في الرميس» was missed. A follow-up now goes
-- back to review when it names the area's own place word: the area without the wilayat (بركاء, مسقط...), without «ال», and
-- without direction words (الجنوبية، الشمالية...). «الصومحان الجنوبية» -> صومحان, «بركاء الرميس» -> رميس. Rollback: re-run SQL86.
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION crm_repair_private.followups_reread_for_area(p_company uuid, p_branch text, p_area text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_words text[]; n1 integer := 0; n2 integer := 0;
BEGIN
  IF p_branch NOT IN ('barka', 'muscat') THEN RETURN 0; END IF;
  SELECT array_agg(DISTINCT w) INTO v_words FROM (
    SELECT regexp_replace(regexp_replace(t, '^(و|ب)?ال', ''), '[ةه]$', '') AS w
      FROM regexp_split_to_table(coalesce(p_area, ''), '[\s,،\-/]+') t) x
   WHERE length(w) >= 3
     AND w NOT IN ('بركاء','مسقط','ولاي','ولايه','منطق','جنوبي','شمالي','شرقي','غربي','جديد','قديم','حي','مدين','سيب','سلطنه','عمان');
  IF v_words IS NULL THEN RETURN 0; END IF;
  UPDATE public.whatsapp_outreach_queue q SET reviewed_at = NULL, owner_text = NULL, review_reason = 'أعيدت للمراجعة: عقار في ' || p_area || ' ما عاد متوفر'
   WHERE q.company_id = p_company AND q.route_key = p_branch AND q.status = 'pending' AND q.kind = 'request_followup' AND NOT q.dry_run
     AND q.reason IS NULL AND q.reviewed_at IS NOT NULL
     AND EXISTS (SELECT 1 FROM unnest(v_words) w WHERE position(w IN coalesce(q.owner_text, q.messages::text, '')) > 0);
  GET DIAGNOSTICS n1 = ROW_COUNT;
  UPDATE public.whatsapp_visit_followups f SET reviewed_at = NULL, owner_text = NULL, review_reason = 'أعيدت للمراجعة: عقار في ' || p_area || ' ما عاد متوفر', updated_at = now()
   WHERE f.company_id = p_company AND f.route_key = p_branch AND f.status = 'awaiting_approval' AND f.reviewed_at IS NOT NULL
     AND EXISTS (SELECT 1 FROM unnest(v_words) w WHERE position(w IN coalesce(f.owner_text, f.body, '')) > 0);
  GET DIAGNOSTICS n2 = ROW_COUNT;
  RETURN n1 + n2;
END $function$;

REVOKE ALL ON FUNCTION crm_repair_private.followups_reread_for_area(uuid, text, text) FROM PUBLIC, anon, authenticated;
