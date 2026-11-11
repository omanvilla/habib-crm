-- SQL93 (11 Nov 2026, Ahmed, R36): A/B comparison of follow-up wordings.
-- Two wordings are compared: the after-visit question (step 1: the named question in the 24-hour window and the template
-- visit_followup_1_ar_v2) and the request follow-up template request_followup_ar_v2. Today's wording is «A» and stays the
-- default: with no wording written by Ahmed and approved by him on the screen, every follow-up is labelled A and its text,
-- template and timing are exactly what they were. A test wording (B, C…) is used only when Ahmed wrote it, pressed «جرّبها»,
-- and Meta approved its template as UTILITY on BOTH numbers; until then A goes. Same rule as the pinned replies (4 Nov):
-- about min_sample (20) people per wording, then the winner is used 8 times in 10 and the others keep being tested.
-- Nothing existing is replaced: new table, one new nullable column on two tables, new functions, two BEFORE INSERT
-- triggers that can only label a row (any error leaves the row as it was). Rollback: 93-followup-variants.rollback.sql
SET LOCAL lock_timeout = '10s';

CREATE TABLE public.whatsapp_followup_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('visit_step1', 'request_followup')),
  label text NOT NULL CHECK (label ~ '^[A-Z]$'),
  text text NOT NULL CHECK (length(btrim(text)) BETWEEN 8 AND 200),
  template_name text,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'testing', 'winner', 'retired')),
  min_sample integer NOT NULL DEFAULT 20 CHECK (min_sample BETWEEN 5 AND 500),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  retired_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- a letter is never used twice for the same kind, so results never mix two wordings
  UNIQUE (company_id, kind, label)
);
CREATE UNIQUE INDEX whatsapp_followup_variants_one_winner ON public.whatsapp_followup_variants (company_id, kind) WHERE status = 'winner';
ALTER TABLE public.whatsapp_followup_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY followup_variants_owner_read ON public.whatsapp_followup_variants FOR SELECT TO authenticated
  USING (company_id = (SELECT public.my_company()) AND (SELECT public.my_role()) = 'owner');
REVOKE ALL ON public.whatsapp_followup_variants FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.whatsapp_followup_variants FROM authenticated;
GRANT SELECT ON public.whatsapp_followup_variants TO authenticated;

-- A = today's wording (R29 for the visit question, R35 for the request template). It is here so the screen shows it and
-- its results next to the others; the follow-up code does not read it and A can never be stopped.
INSERT INTO public.whatsapp_followup_variants (company_id, kind, label, text, template_name, status, approved_at)
SELECT r.company_id, k.kind, 'A', k.text, k.template_name, 'testing', now()
  FROM public.whatsapp_automation_runtime r
 CROSS JOIN (VALUES
   ('visit_step1', 'السلام عليكم كيف شفت {العقار} وايش انطباعك عنه ؟', 'visit_followup_1_ar_v2'),
   ('request_followup', E'بخصوص طلبك {الموضوع}\nلين الحين تبحث ؟', 'request_followup_ar_v2')
 ) AS k(kind, text, template_name);

-- The wording a follow-up was given. NULL on everything before SQL93 and on follow-ups outside the comparison
-- (visit steps 2 to 4, financing, sold / new-listing notices). After sending it says which wording really went.
ALTER TABLE public.whatsapp_visit_followups ADD COLUMN variant_label text;
ALTER TABLE public.whatsapp_outreach_queue ADD COLUMN variant_label text;

-- a template can carry a wording only when Meta approved it as UTILITY on both numbers
CREATE FUNCTION crm_repair_private.followup_variant_usable(p_company uuid, p_template text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  SELECT p_template IS NOT NULL AND (
    SELECT count(DISTINCT t.route_key) FROM public.whatsapp_template_registry t
     WHERE t.company_id = p_company AND t.template_name = p_template AND t.route_key IN ('barka', 'muscat')
       AND upper(t.status) = 'APPROVED' AND upper(t.category) = 'UTILITY') = 2
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.followup_variant_usable(uuid, text) FROM PUBLIC, anon, authenticated;

-- follow-ups given a wording since p_since that are waiting or went
CREATE FUNCTION crm_repair_private.followup_variant_used(p_company uuid, p_kind text, p_label text, p_since timestamptz)
 RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  SELECT CASE WHEN p_kind = 'visit_step1' THEN
    (SELECT count(*) FROM public.whatsapp_visit_followups f
      WHERE f.company_id = p_company AND f.step = 1 AND f.variant_label = p_label
        AND f.status IN ('awaiting_approval', 'sending', 'sent') AND f.created_at >= coalesce(p_since, '-infinity'))
  ELSE
    (SELECT count(*) FROM public.whatsapp_outreach_queue q
      WHERE q.company_id = p_company AND q.kind = 'request_followup' AND q.variant_label = p_label
        AND q.status IN ('pending', 'approved', 'sent') AND q.created_at >= coalesce(p_since, '-infinity'))
  END
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.followup_variant_used(uuid, text, text, timestamptz) FROM PUBLIC, anon, authenticated;

-- Which wording the next follow-up gets. 'A' whenever no test wording is live.
-- No winner yet: the live wording used least since the test started (a tie is random), so each reaches its sample together.
-- With a winner: the winner 8 times in 10, otherwise the least used of the others.
CREATE FUNCTION crm_repair_private.followup_variant_pick(p_company uuid, p_kind text)
 RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_tests int; v_since timestamptz; v_winner text; v_label text;
BEGIN
  SELECT count(*) FILTER (WHERE l.label <> 'A'), min(l.approved_at) FILTER (WHERE l.label <> 'A'), max(l.label) FILTER (WHERE l.status = 'winner')
    INTO v_tests, v_since, v_winner
    FROM public.whatsapp_followup_variants l
   WHERE l.company_id = p_company AND l.kind = p_kind AND l.status IN ('testing', 'winner')
     AND (l.label = 'A' OR crm_repair_private.followup_variant_usable(p_company, l.template_name));
  IF coalesce(v_tests, 0) = 0 THEN RETURN 'A'; END IF;
  IF v_winner IS NOT NULL AND random() < 0.8 THEN RETURN v_winner; END IF;
  SELECT l.label INTO v_label
    FROM public.whatsapp_followup_variants l
   WHERE l.company_id = p_company AND l.kind = p_kind AND l.status IN ('testing', 'winner')
     AND (l.label = 'A' OR crm_repair_private.followup_variant_usable(p_company, l.template_name))
     AND (v_winner IS NULL OR l.label <> v_winner)
   ORDER BY crm_repair_private.followup_variant_used(p_company, p_kind, l.label, v_since), random()
   LIMIT 1;
  RETURN coalesce(v_label, v_winner, 'A');
END
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.followup_variant_pick(uuid, text) FROM PUBLIC, anon, authenticated;

-- A new step-1 visit follow-up gets its wording. For A the row is not touched beyond the label.
CREATE FUNCTION crm_repair_private.followup_variant_assign_visit()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_label text; v public.whatsapp_followup_variants;
BEGIN
  IF NEW.step = 1 AND NEW.status = 'awaiting_approval' AND NEW.variant_label IS NULL THEN
    v_label := crm_repair_private.followup_variant_pick(NEW.company_id, 'visit_step1');
    IF v_label <> 'A' THEN
      SELECT * INTO v FROM public.whatsapp_followup_variants l WHERE l.company_id = NEW.company_id AND l.kind = 'visit_step1' AND l.label = v_label;
      IF v.id IS NULL OR v.template_name IS NULL THEN v_label := 'A';
      ELSE NEW.body := regexp_replace(replace(v.text, '{العقار}', 'العقار'), '\s+', ' ', 'g'); NEW.template_name := v.template_name; END IF;
    END IF;
    NEW.variant_label := v_label;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.followup_variant_assign_visit() FROM PUBLIC, anon, authenticated;

-- A new request follow-up on the «لين الحين تبحث ؟» template gets its wording (financing follow-ups are not compared).
CREATE FUNCTION crm_repair_private.followup_variant_assign_request()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_label text; v public.whatsapp_followup_variants;
BEGIN
  IF NEW.kind = 'request_followup' AND NEW.status = 'pending' AND NEW.template_name = 'request_followup_ar_v2'
     AND NOT coalesce(NEW.dry_run, false) AND NEW.variant_label IS NULL THEN
    v_label := crm_repair_private.followup_variant_pick(NEW.company_id, 'request_followup');
    IF v_label <> 'A' THEN
      SELECT * INTO v FROM public.whatsapp_followup_variants l WHERE l.company_id = NEW.company_id AND l.kind = 'request_followup' AND l.label = v_label;
      IF v.id IS NULL OR v.template_name IS NULL THEN v_label := 'A';
      ELSE
        NEW.template_name := v.template_name;
        NEW.messages := to_jsonb(string_to_array(replace(v.text, '{الموضوع}', coalesce(NEW.template_params ->> 0, '')), E'\n'));
      END IF;
    END IF;
    NEW.variant_label := v_label;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.followup_variant_assign_request() FROM PUBLIC, anon, authenticated;

-- named to run after the other BEFORE INSERT triggers (staff numbers, kept review decisions)
CREATE TRIGGER variant_assign_visit_followup BEFORE INSERT ON public.whatsapp_visit_followups
  FOR EACH ROW EXECUTE FUNCTION crm_repair_private.followup_variant_assign_visit();
CREATE TRIGGER variant_assign_request_followup BEFORE INSERT ON public.whatsapp_outreach_queue
  FOR EACH ROW EXECUTE FUNCTION crm_repair_private.followup_variant_assign_request();

-- «لين يعتمد تنرسل A»: a waiting follow-up whose test wording is no longer live (stopped by Ahmed, or Meta paused or
-- re-rated its template) goes back to A. The visit one is read again, so no text in the stopped wording stays on it.
-- Called by whatsapp-visit-followup-auto on every run and when a wording is stopped. Nothing is sent from here.
CREATE FUNCTION public.crm_followup_variants_settle()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_visits int; v_requests int;
BEGIN
  UPDATE public.whatsapp_visit_followups f
     SET variant_label = 'A', body = public.crm_visit_followup_text(1, f.route_key), template_name = public.crm_visit_followup_template(1, f.route_key),
         owner_text = NULL, reviewed_at = NULL, updated_at = now()
   WHERE f.status = 'awaiting_approval' AND f.step = 1 AND f.variant_label IS NOT NULL AND f.variant_label <> 'A'
     AND NOT EXISTS (SELECT 1 FROM public.whatsapp_followup_variants l
                      WHERE l.company_id = f.company_id AND l.kind = 'visit_step1' AND l.label = f.variant_label
                        AND l.status IN ('testing', 'winner') AND crm_repair_private.followup_variant_usable(l.company_id, l.template_name));
  GET DIAGNOSTICS v_visits = ROW_COUNT;
  UPDATE public.whatsapp_outreach_queue q
     SET variant_label = 'A', template_name = 'request_followup_ar_v2',
         messages = jsonb_build_array('بخصوص طلبك ' || coalesce(q.template_params ->> 0, ''), 'لين الحين تبحث ؟')
   WHERE q.status IN ('pending', 'approved') AND q.kind = 'request_followup' AND q.variant_label IS NOT NULL AND q.variant_label <> 'A'
     AND NOT EXISTS (SELECT 1 FROM public.whatsapp_followup_variants l
                      WHERE l.company_id = q.company_id AND l.kind = 'request_followup' AND l.label = q.variant_label
                        AND l.status IN ('testing', 'winner') AND crm_repair_private.followup_variant_usable(l.company_id, l.template_name));
  GET DIAGNOSTICS v_requests = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'visits_back_to_a', v_visits, 'requests_back_to_a', v_requests);
END
$function$;
REVOKE ALL ON FUNCTION public.crm_followup_variants_settle() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_followup_variants_settle() TO service_role;

-- Ahmed writes a wording. It is saved as «proposed» and reaches nobody until he presses «جرّبها».
-- The text follows his fixed writing rules; a wording that breaks one is refused with the reason.
CREATE FUNCTION public.crm_followup_variant_save(p_kind text, p_text text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_company uuid := public.my_company(); v_text text; v_word text; v_label text; v_id uuid;
BEGIN
  IF public.my_role() IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'owner_only' USING ERRCODE = '42501'; END IF;
  IF p_kind NOT IN ('visit_step1', 'request_followup') THEN RAISE EXCEPTION 'variant_bad_kind' USING ERRCODE = '22023'; END IF;
  v_word := CASE p_kind WHEN 'visit_step1' THEN '{العقار}' ELSE '{الموضوع}' END;
  -- his rules: no comma, full stop or exclamation mark; the question mark is « ؟»
  v_text := regexp_replace(coalesce(p_text, ''), '[،,؛;!.]', ' ', 'g');
  v_text := regexp_replace(v_text, '[ \t]*[؟?]', ' ؟', 'g');
  v_text := regexp_replace(v_text, '[ \t]+', ' ', 'g');
  v_text := regexp_replace(v_text, '[ \t]*[\r\n]+[ \t]*', E'\n', 'g');
  v_text := btrim(v_text, E' \n\t');
  IF p_kind = 'visit_step1' THEN v_text := replace(v_text, E'\n', ' '); END IF;
  IF length(v_text) < 8 OR length(v_text) > 200 THEN RAISE EXCEPTION 'variant_length' USING ERRCODE = '22023'; END IF;
  IF v_text ~ '[A-Za-z]' THEN RAISE EXCEPTION 'variant_english' USING ERRCODE = '22023'; END IF;
  IF v_text ~ '[0-9٠-٩]' THEN RAISE EXCEPTION 'variant_number' USING ERRCODE = '22023'; END IF;
  IF v_text ~ '(^|\s)(هلا|اهلين|أهلين|اهلا|أهلا|مرحبا)(\s|$)' THEN RAISE EXCEPTION 'variant_greeting' USING ERRCODE = '22023'; END IF;
  -- R5 / R12: no promise of a reply or a call
  IF v_text ~ '(^|\s)(ب|بن|ا|أ|ن)(رد|رجع)\s*(عليك|عليكم|لك|لكم)|(ب|بن)تواصل\s*مع|(ب|بن|ا|أ)تصل\s*(عليك|فيك|بك)' THEN RAISE EXCEPTION 'variant_promise' USING ERRCODE = '22023'; END IF;
  -- R29: «كيف لقيت» reads as «did you find the place», and no «مبروك»; R34: we have no photos
  IF v_text ~ 'كيف\s*لقي|مبروك|صور' THEN RAISE EXCEPTION 'variant_banned_word' USING ERRCODE = '22023'; END IF;
  IF length(v_text) - length(replace(v_text, '؟', '')) <> 1 OR right(v_text, 2) <> ' ؟' THEN RAISE EXCEPTION 'variant_one_question' USING ERRCODE = '22023'; END IF;
  IF replace(v_text, v_word, '') ~ '[{}]' OR length(v_text) - length(replace(v_text, v_word, '')) > length(v_word) THEN RAISE EXCEPTION 'variant_placeholder' USING ERRCODE = '22023'; END IF;
  IF length(v_text) - length(replace(v_text, E'\n', '')) > 1 THEN RAISE EXCEPTION 'variant_lines' USING ERRCODE = '22023'; END IF;
  -- R16 / R29: the reply agent knows our after-visit question by these words. Without them a client who answers it
  -- could be told «شوف العقار أول». A wording without them needs the agent taught first.
  IF p_kind = 'visit_step1' AND v_text !~ 'كيف\s*شفت|قدرت[يوا]*\s*تشوف' THEN RAISE EXCEPTION 'variant_agent_unknown' USING ERRCODE = '22023'; END IF;
  -- Meta: a template cannot start or end with its variable
  IF p_kind = 'request_followup' AND (v_text LIKE v_word || '%' OR replace(v_text, ' ؟', '') LIKE '%' || v_word) THEN RAISE EXCEPTION 'variant_placeholder_edge' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.whatsapp_followup_variants l WHERE l.company_id = v_company AND l.kind = p_kind AND l.status <> 'retired'
              AND regexp_replace(l.text, '\s+', ' ', 'g') = regexp_replace(v_text, '\s+', ' ', 'g')) THEN RAISE EXCEPTION 'variant_duplicate' USING ERRCODE = '22023'; END IF;
  IF (SELECT count(*) FROM public.whatsapp_followup_variants l WHERE l.company_id = v_company AND l.kind = p_kind AND l.label <> 'A' AND l.status <> 'retired') >= 2 THEN
    RAISE EXCEPTION 'variant_limit' USING ERRCODE = '22023';
  END IF;
  SELECT chr(ascii(max(l.label)) + 1) INTO v_label FROM public.whatsapp_followup_variants l WHERE l.company_id = v_company AND l.kind = p_kind;
  IF v_label IS NULL OR v_label > 'Z' THEN RAISE EXCEPTION 'variant_limit' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.whatsapp_followup_variants (company_id, kind, label, text, status, created_by)
  VALUES (v_company, p_kind, v_label, v_text, 'proposed', auth.uid()) RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'label', v_label, 'text', v_text);
END
$function$;
REVOKE ALL ON FUNCTION public.crm_followup_variant_save(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_followup_variant_save(text, text) TO authenticated;

-- what went, per wording: for the results and for the winner decision
CREATE FUNCTION crm_repair_private.followup_variant_sent(p_company uuid, p_kind text, p_label text)
 RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  SELECT CASE WHEN p_kind = 'visit_step1' THEN
    (SELECT count(*) FROM public.whatsapp_visit_followups f WHERE f.company_id = p_company AND f.step = 1 AND f.variant_label = p_label AND f.status = 'sent' AND f.sent_at IS NOT NULL)
  ELSE
    (SELECT count(*) FROM public.whatsapp_outreach_queue q WHERE q.company_id = p_company AND q.kind = 'request_followup' AND q.variant_label = p_label AND q.status = 'sent' AND q.sent_at IS NOT NULL)
  END
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.followup_variant_sent(uuid, text, text) FROM PUBLIC, anon, authenticated;

-- Ahmed's decision on a wording, from the screen:
--   test     «جرّبها»: proposed -> testing; its template gets a name and goes to Meta for both numbers
--   submit   send the template to Meta again (when the first try did not reach Meta)
--   winner   «ثبّتها فايزة»: used 8 times in 10 (only after min_sample went in this wording); the old winner goes back to testing
--   unwinner back to an even test
--   retire   «وقفها»: off for good; follow-ups waiting on it go back to A. A itself cannot be stopped.
CREATE FUNCTION public.crm_followup_variant_decide(p_id uuid, p_action text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_company uuid := public.my_company(); v public.whatsapp_followup_variants; v_post boolean := false;
BEGIN
  IF public.my_role() IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'owner_only' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v FROM public.whatsapp_followup_variants l WHERE l.id = p_id AND l.company_id = v_company FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'variant_not_found' USING ERRCODE = '22023'; END IF;
  IF p_action = 'test' THEN
    IF v.status <> 'proposed' THEN RAISE EXCEPTION 'variant_not_proposed' USING ERRCODE = '22023'; END IF;
    UPDATE public.whatsapp_followup_variants
       SET status = 'testing', approved_at = now(), updated_at = now(),
           template_name = CASE v.kind WHEN 'visit_step1' THEN 'fu_visit1_ar_' ELSE 'fu_request_ar_' END || left(replace(v.id::text, '-', ''), 10)
     WHERE id = v.id;
    v_post := true;
  ELSIF p_action = 'submit' THEN
    IF v.label = 'A' OR v.status NOT IN ('testing', 'winner') THEN RAISE EXCEPTION 'variant_not_running' USING ERRCODE = '22023'; END IF;
    v_post := true;
  ELSIF p_action = 'winner' THEN
    IF v.status <> 'testing' THEN RAISE EXCEPTION 'variant_not_running' USING ERRCODE = '22023'; END IF;
    IF crm_repair_private.followup_variant_sent(v_company, v.kind, v.label) < v.min_sample THEN RAISE EXCEPTION 'variant_sample_small' USING ERRCODE = '22023'; END IF;
    UPDATE public.whatsapp_followup_variants SET status = 'testing', updated_at = now() WHERE company_id = v_company AND kind = v.kind AND status = 'winner';
    UPDATE public.whatsapp_followup_variants SET status = 'winner', updated_at = now() WHERE id = v.id;
  ELSIF p_action = 'unwinner' THEN
    IF v.status <> 'winner' THEN RAISE EXCEPTION 'variant_not_running' USING ERRCODE = '22023'; END IF;
    UPDATE public.whatsapp_followup_variants SET status = 'testing', updated_at = now() WHERE id = v.id;
  ELSIF p_action = 'retire' THEN
    IF v.label = 'A' THEN RAISE EXCEPTION 'variant_default' USING ERRCODE = '22023'; END IF;
    IF v.status = 'retired' THEN RAISE EXCEPTION 'variant_not_running' USING ERRCODE = '22023'; END IF;
    UPDATE public.whatsapp_followup_variants SET status = 'retired', retired_at = now(), updated_at = now() WHERE id = v.id;
    PERFORM public.crm_followup_variants_settle();
  ELSE
    RAISE EXCEPTION 'variant_bad_action' USING ERRCODE = '22023';
  END IF;
  IF v_post THEN
    -- whatsapp-visit-templates creates the missing templates on both numbers and records Meta's answer in the registry
    BEGIN
      PERFORM net.http_post(
        url := 'https://dmsckqjkcnsfmnzfjczz.supabase.co/functions/v1/whatsapp-visit-templates',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-crm-agent',
                     (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'crm_reply_agent')),
        body := jsonb_build_object('action', 'create'),
        timeout_milliseconds := 60000);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v.id, 'action', p_action);
END
$function$;
REVOKE ALL ON FUNCTION public.crm_followup_variant_decide(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_followup_variant_decide(uuid, text) TO authenticated;

-- Results per wording, split Barka / Muscat / investors (the lanes of «متابعة اليوم», SQL91) and in total:
--   sent     follow-ups that went in this wording (its template, or its own text inside the 24 hours)
--   replied  the client wrote within 48 hours of it
--   visits   a visit was booked for him within 30 days after it (not a cancelled one)
--   deals    a deal of his reached a paid booking or further within 90 days after it
-- Only follow-ups created after SQL93 carry a wording, so A and the others are measured over the same days.
CREATE FUNCTION public.crm_followup_variant_results()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_company uuid := public.my_company(); v jsonb;
BEGIN
  IF public.my_role() IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'owner_only' USING ERRCODE = '42501'; END IF;
  WITH s AS (
    SELECT 'visit_step1'::text AS kind, f.variant_label AS label, f.client_id, f.conversation_id, f.sent_at,
           crm_repair_private.followup_lane(f.client_id, f.conversation_id, f.route_key, concat_ws(' ', f.review_reason, f.owner_text, f.body)) AS lane
      FROM public.whatsapp_visit_followups f
     WHERE f.company_id = v_company AND f.step = 1 AND f.status = 'sent' AND f.sent_at IS NOT NULL AND f.variant_label IS NOT NULL
    UNION ALL
    SELECT 'request_followup', q.variant_label, q.client_id, q.conversation_id, q.sent_at,
           crm_repair_private.followup_lane(q.client_id, q.conversation_id, q.route_key,
             concat_ws(' ', q.review_reason, q.owner_text, q.summary, (SELECT string_agg(m.value, ' ') FROM jsonb_array_elements_text(q.messages) m)))
      FROM public.whatsapp_outreach_queue q
     WHERE q.company_id = v_company AND q.kind = 'request_followup' AND q.status = 'sent' AND q.sent_at IS NOT NULL AND q.variant_label IS NOT NULL
  ), m AS (
    SELECT s.kind, s.label, s.lane,
      EXISTS (SELECT 1 FROM public.whatsapp_messages w WHERE w.conversation_id = s.conversation_id AND w.direction = 'inbound'
               AND w.message_timestamp > s.sent_at AND w.message_timestamp <= s.sent_at + interval '48 hours') AS replied,
      EXISTS (SELECT 1 FROM public.viewings vw WHERE vw.client_id = s.client_id AND vw.company_id = v_company AND coalesce(vw.archived, false) = false
               AND vw.status <> 'cancelled' AND vw.created_at > s.sent_at AND vw.created_at <= s.sent_at + interval '30 days') AS visit,
      EXISTS (SELECT 1 FROM public.deals d WHERE d.client_id = s.client_id AND d.company_id = v_company AND d.merged_into_deal_id IS NULL
               AND d.stage IS DISTINCT FROM 'lost'
               AND coalesce(d.reservation_confirmed_at, d.commission_entitled_at, d.commission_received_at, d.closed_at) > s.sent_at
               AND coalesce(d.reservation_confirmed_at, d.commission_entitled_at, d.commission_received_at, d.closed_at) <= s.sent_at + interval '90 days') AS deal
      FROM s
  ), g AS (
    SELECT m.kind, m.label, m.lane, count(*) AS sent, count(*) FILTER (WHERE m.replied) AS replied,
           count(*) FILTER (WHERE m.visit) AS visits, count(*) FILTER (WHERE m.deal) AS deals
      FROM m GROUP BY m.kind, m.label, m.lane
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'kind', l.kind, 'label', l.label, 'text', l.text, 'template_name', l.template_name, 'status', l.status, 'min_sample', l.min_sample,
           'live', l.status IN ('testing', 'winner') AND (l.label = 'A' OR crm_repair_private.followup_variant_usable(v_company, l.template_name)),
           'templates', (SELECT coalesce(jsonb_object_agg(t.route_key, jsonb_build_object('status', upper(t.status), 'category', upper(t.category), 'error', t.last_error)), '{}'::jsonb)
                           FROM public.whatsapp_template_registry t
                          WHERE t.company_id = v_company AND t.template_name = l.template_name AND t.route_key IN ('barka', 'muscat')),
           'waiting', CASE l.kind WHEN 'visit_step1'
                        THEN (SELECT count(*) FROM public.whatsapp_visit_followups f WHERE f.company_id = v_company AND f.step = 1 AND f.variant_label = l.label AND f.status = 'awaiting_approval')
                        ELSE (SELECT count(*) FROM public.whatsapp_outreach_queue q WHERE q.company_id = v_company AND q.kind = 'request_followup' AND q.variant_label = l.label AND q.status IN ('pending', 'approved')) END,
           'total', (SELECT jsonb_build_object('sent', coalesce(sum(g.sent), 0), 'replied', coalesce(sum(g.replied), 0), 'visits', coalesce(sum(g.visits), 0), 'deals', coalesce(sum(g.deals), 0))
                       FROM g WHERE g.kind = l.kind AND g.label = l.label),
           'lanes', (SELECT jsonb_object_agg(x.lane, jsonb_build_object('sent', coalesce(g.sent, 0), 'replied', coalesce(g.replied, 0), 'visits', coalesce(g.visits, 0), 'deals', coalesce(g.deals, 0)))
                       FROM (VALUES ('barka'), ('muscat'), ('investor')) AS x(lane)
                       LEFT JOIN g ON g.kind = l.kind AND g.label = l.label AND g.lane = x.lane))
         ORDER BY l.kind DESC, l.label), '[]'::jsonb)
    INTO v
    FROM public.whatsapp_followup_variants l
   WHERE l.company_id = v_company;
  RETURN jsonb_build_object('reply_hours', 48, 'variants', v);
END
$function$;
REVOKE ALL ON FUNCTION public.crm_followup_variant_results() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_followup_variant_results() TO authenticated;
