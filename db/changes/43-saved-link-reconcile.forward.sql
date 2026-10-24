-- SQL43: stop false "identify the property" alerts and link saved publications automatically.
--
-- 1. A message that the insert trigger already attributed exactly (its link is a
--    saved publication of a listing) is not review work. The text checker in the
--    webhook still queued a second 'text:' review row and raised a hand-off for
--    such messages. The same guard is in _shared/property-inquiry-service.mjs and
--    takes effect there when the webhook is next deployed; the database enforces
--    it now.
-- 2. When a publication link is saved for a listing after customers already sent
--    it (from the property dialog, the Instagram catalog, or a staff
--    classification), every pending review row carrying that exact link is linked
--    through the same record_property_link_inquiry_internal path the insert
--    trigger uses. Exact saved publication = exact evidence; no inference.
-- 3. An automatic "identify the property" hand-off is not raised, and stale ones
--    are cleared, when the conversation has no pending review row left. A
--    customer's explicit request for a person is never touched.
-- Every automatic resolution is recorded in crm_repair_private.sql43_auto_resolved.

CREATE TABLE IF NOT EXISTS crm_repair_private.sql43_auto_resolved (
  unmatched_id uuid PRIMARY KEY,
  conversation_id uuid,
  property_id uuid,
  reason text NOT NULL,
  resolved_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS crm_repair_private.sql43_cleared_handoffs (
  conversation_id uuid PRIMARY KEY,
  handoff_reason text,
  handoff_updated_at timestamptz,
  cleared_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON crm_repair_private.sql43_auto_resolved, crm_repair_private.sql43_cleared_handoffs FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION crm_repair_private.resolve_saved_link_reviews(p_company uuid, p_link_key text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE u public.unmatched_property_links%rowtype; v_key text; v_marketing uuid; v_property uuid; v_n int:=0; v_convs uuid[]:='{}';
 v_code text:=nullif(split_part(coalesce(p_link_key,''),':',2),'');
BEGIN
 FOR u IN SELECT * FROM public.unmatched_property_links x
   WHERE x.company_id=p_company AND x.status='pending' AND x.link_key NOT LIKE 'image:%'
    AND (p_link_key IS NULL OR (v_code IS NOT NULL AND strpos(x.raw_url,v_code)>0))
   ORDER BY x.first_seen_at, x.id FOR UPDATE LOOP
  v_key:=public.normalize_property_marketing_link(substring(u.raw_url from '((?:https?://|www\.)[^[:space:]<>"'']+)'));
  IF v_key IS NULL OR (p_link_key IS NOT NULL AND v_key<>p_link_key) THEN CONTINUE; END IF;
  v_marketing:=NULL; v_property:=NULL;
  SELECT id,property_id INTO v_marketing,v_property FROM public.property_marketing_events
   WHERE company_id=p_company AND link_key=v_key AND property_id IS NOT NULL ORDER BY created_at LIMIT 1;
  IF v_property IS NULL THEN CONTINUE; END IF;
  -- A branch conversation about another branch's listing stays with staff.
  IF EXISTS(SELECT 1 FROM public.whatsapp_conversations w JOIN public.properties p ON p.id=v_property
    WHERE w.id=u.conversation_id AND w.route_key IN ('barka','muscat') AND p.branch_key IS DISTINCT FROM w.route_key) THEN CONTINUE; END IF;
  BEGIN
   PERFORM public.record_property_link_inquiry_internal(p_company,u.client_id,v_property,v_marketing,u.whatsapp_message_id,u.raw_url,v_key,u.first_seen_at,false);
   UPDATE public.unmatched_property_links SET status='resolved',resolution_kind='property',resolution_note='ربط تلقائي: رابط منشور محفوظ للعقار',
     property_id=v_property,marketing_event_id=v_marketing,resolved_at=now(),updated_at=now() WHERE id=u.id;
   PERFORM public.crm_finalize_property_message(u.whatsapp_message_id);
   UPDATE public.whatsapp_messages m SET matched_property_id=coalesce(m.matched_property_id,v_property),
     matched_marketing_event_id=coalesce(m.matched_marketing_event_id,v_marketing),
     property_match_status=CASE WHEN EXISTS(SELECT 1 FROM public.unmatched_property_links o WHERE o.whatsapp_message_id=m.id AND o.status='pending')
       THEN 'partial_match' WHEN m.property_match_status IN ('multiple_matched','resolved_manual') THEN m.property_match_status ELSE 'auto_matched' END
    WHERE m.id=u.whatsapp_message_id AND m.company_id=p_company;
   INSERT INTO crm_repair_private.sql43_auto_resolved(unmatched_id,conversation_id,property_id,reason)
    VALUES(u.id,u.conversation_id,v_property,'saved_link') ON CONFLICT (unmatched_id) DO NOTHING;
   v_convs:=array_append(v_convs,u.conversation_id); v_n:=v_n+1;
  EXCEPTION WHEN others THEN
   RAISE WARNING 'resolve_saved_link_reviews skipped %: %', u.id, SQLERRM;
  END;
 END LOOP;
 -- Review rows whose message is already exactly attributed (the false second alert).
 IF p_link_key IS NULL THEN
  FOR u IN SELECT x.* FROM public.unmatched_property_links x JOIN public.whatsapp_messages m ON m.id=x.whatsapp_message_id AND m.company_id=x.company_id
    WHERE x.company_id=p_company AND x.status='pending' AND x.link_key LIKE 'text:%'
     AND m.matched_property_id IS NOT NULL AND m.property_match_status IN ('auto_matched','resolved_manual') FOR UPDATE OF x LOOP
   UPDATE public.unmatched_property_links SET status='resolved',resolution_kind='property',resolution_note='الرسالة مربوطة بالعقار تلقائيًا مسبقًا',
     property_id=(SELECT matched_property_id FROM public.whatsapp_messages WHERE id=u.whatsapp_message_id),resolved_at=now(),updated_at=now() WHERE id=u.id;
   INSERT INTO crm_repair_private.sql43_auto_resolved(unmatched_id,conversation_id,property_id,reason)
    SELECT u.id,u.conversation_id,m.matched_property_id,'already_attributed' FROM public.whatsapp_messages m WHERE m.id=u.whatsapp_message_id
    ON CONFLICT (unmatched_id) DO NOTHING;
   v_convs:=array_append(v_convs,u.conversation_id); v_n:=v_n+1;
  END LOOP;
 END IF;
 PERFORM crm_repair_private.clear_identify_handoffs(p_company, CASE WHEN p_link_key IS NULL THEN NULL ELSE v_convs END);
 RETURN v_n;
END
$function$;

-- Clears only the automatic "identify the property" hand-off, and only when the
-- conversation has no pending review row. p_conversations NULL = all.
CREATE OR REPLACE FUNCTION crm_repair_private.clear_identify_handoffs(p_company uuid, p_conversations uuid[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE v_n int;
BEGIN
 WITH target AS (
  SELECT w.id, w.handoff_reason, w.handoff_updated_at FROM public.whatsapp_conversations w
  WHERE w.company_id=p_company AND w.human_handoff_required
   AND w.handoff_reason IN ('استفسار عن عقار يحتاج تحديده وربطه بالعقار الصحيح','استفسار عن عقار محدد يحتاج تحديده')
   AND (p_conversations IS NULL OR w.id=ANY(p_conversations))
   AND NOT EXISTS(SELECT 1 FROM public.unmatched_property_links u WHERE u.conversation_id=w.id AND u.company_id=w.company_id AND u.status='pending')
  FOR UPDATE OF w
 ), saved AS (
  INSERT INTO crm_repair_private.sql43_cleared_handoffs(conversation_id,handoff_reason,handoff_updated_at)
  SELECT id,handoff_reason,handoff_updated_at FROM target ON CONFLICT (conversation_id) DO NOTHING RETURNING 1
 )
 UPDATE public.whatsapp_conversations w SET human_handoff_required=false,handoff_reason=NULL,handoff_updated_at=now(),updated_at=now()
 FROM target t WHERE w.id=t.id;
 GET DIAGNOSTICS v_n=ROW_COUNT;
 RETURN v_n;
END
$function$;

CREATE OR REPLACE FUNCTION crm_repair_private.skip_attributed_text_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
 IF NEW.link_key LIKE 'text:%' AND NEW.status='pending' AND EXISTS(
   SELECT 1 FROM public.whatsapp_messages m WHERE m.id=NEW.whatsapp_message_id AND m.company_id=NEW.company_id
    AND m.matched_property_id IS NOT NULL AND m.property_match_status IN ('auto_matched','resolved_manual')) THEN
  RETURN NULL;
 END IF;
 RETURN NEW;
END
$function$;
DROP TRIGGER IF EXISTS crm_skip_attributed_text_review ON public.unmatched_property_links;
CREATE TRIGGER crm_skip_attributed_text_review BEFORE INSERT ON public.unmatched_property_links
 FOR EACH ROW EXECUTE FUNCTION crm_repair_private.skip_attributed_text_review();

CREATE OR REPLACE FUNCTION crm_repair_private.suppress_empty_identify_handoff()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
 IF NEW.human_handoff_required AND NOT coalesce(OLD.human_handoff_required,false)
  AND NEW.handoff_reason IN ('استفسار عن عقار يحتاج تحديده وربطه بالعقار الصحيح','استفسار عن عقار محدد يحتاج تحديده')
  AND NOT EXISTS(SELECT 1 FROM public.unmatched_property_links u WHERE u.conversation_id=NEW.id AND u.company_id=NEW.company_id AND u.status='pending') THEN
  NEW.human_handoff_required:=false; NEW.handoff_reason:=OLD.handoff_reason; NEW.handoff_updated_at:=OLD.handoff_updated_at;
 END IF;
 RETURN NEW;
END
$function$;
DROP TRIGGER IF EXISTS crm_suppress_empty_identify_handoff ON public.whatsapp_conversations;
CREATE TRIGGER crm_suppress_empty_identify_handoff BEFORE UPDATE OF human_handoff_required ON public.whatsapp_conversations
 FOR EACH ROW EXECUTE FUNCTION crm_repair_private.suppress_empty_identify_handoff();

CREATE OR REPLACE FUNCTION crm_repair_private.reconcile_on_saved_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
 IF NEW.link_key IS NOT NULL AND NEW.property_id IS NOT NULL
  AND (TG_OP='INSERT' OR OLD.link_key IS DISTINCT FROM NEW.link_key OR OLD.property_id IS DISTINCT FROM NEW.property_id) THEN
  PERFORM crm_repair_private.resolve_saved_link_reviews(NEW.company_id, NEW.link_key);
 END IF;
 RETURN NULL;
END
$function$;
DROP TRIGGER IF EXISTS crm_reconcile_on_saved_link ON public.property_marketing_events;
CREATE TRIGGER crm_reconcile_on_saved_link AFTER INSERT OR UPDATE OF link_key, property_id ON public.property_marketing_events
 FOR EACH ROW EXECUTE FUNCTION crm_repair_private.reconcile_on_saved_link();

REVOKE ALL ON FUNCTION crm_repair_private.resolve_saved_link_reviews(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION crm_repair_private.clear_identify_handoffs(uuid,uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION crm_repair_private.skip_attributed_text_review() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION crm_repair_private.suppress_empty_identify_handoff() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION crm_repair_private.reconcile_on_saved_link() FROM PUBLIC, anon, authenticated;

-- One-time catch-up for the rows that already exist.
SELECT crm_repair_private.resolve_saved_link_reviews(c.id) FROM public.companies c;
SELECT crm_repair_private.clear_identify_handoffs(c.id) FROM public.companies c;
