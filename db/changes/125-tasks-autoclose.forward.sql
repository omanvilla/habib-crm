-- SQL125 (18 Nov 2026, Ahmed's check, item 2: «إغلاق المهام تلقائياً»). 24 tasks were open and none had ever closed by itself.
-- What closes now, by itself (the task is marked done, completed_at is set, and its notes say why and when):
--   «متابعة نتيجة الزيارة»: the reply agent or anyone in the office writes to the client on WhatsApp (outbound text, voice,
--      template, photo, file, location; not a reaction or an edit), a call with the client is logged (activities type or
--      channel «call»), or the visited property's status changes (sold, reserved, withdrawn, back to available …).
--      Only a task opened before that event closes. The viewing being saved does not close it (that same save opens it).
--   «دراسة سعر»: the offer it prices leaves «open / studied» (closed: declined, a duplicate, the seller request withdrawn;
--      listed: the property is now in the CRM). Sending the study already closes it (price-study). It does NOT close when
--      the agent or the office writes to the owner or calls him: the agent always answers an owner («وصلت ونرجع لك»), so the
--      task would leave Claude's pricing queue before anyone priced the property (Ahmed is asked about this in the report).
-- Old tasks are closed only by a new event; nothing here closes what is open today. Rollback: 125-tasks-autoclose.rollback.sql
SET LOCAL lock_timeout = '10s';

-- close a client's open tasks of one kind that were opened before p_at
CREATE OR REPLACE FUNCTION crm_repair_private.autoclose_tasks(p_company uuid, p_client uuid, p_prefix text, p_reason text, p_at timestamptz,
                                                          p_property uuid DEFAULT NULL, p_lead uuid DEFAULT NULL)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE n integer;
BEGIN
  UPDATE public.tasks t
     SET done = true, completed_at = now(),
         notes = left(concat_ws(E'\n', t.notes, 'انقفلت تلقائياً: ' || p_reason || ' (' || to_char(now() at time zone 'Asia/Muscat', 'YYYY-MM-DD HH24:MI') || ')'), 4000)
   WHERE NOT coalesce(t.done, false)
     AND t.company_id = p_company
     AND t.title LIKE p_prefix || '%'
     AND t.created_at < coalesce(p_at, now())
     AND (p_client IS NULL OR t.client_id = p_client)
     AND (p_property IS NULL OR EXISTS (SELECT 1 FROM public.viewings v WHERE v.id = t.viewing_id AND v.property_id = p_property))
     AND (p_lead IS NULL OR t.owner_lead_id = p_lead);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $function$;
REVOKE ALL ON FUNCTION crm_repair_private.autoclose_tasks(uuid, uuid, text, text, timestamptz, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- a WhatsApp message to the client (agent or office)
CREATE OR REPLACE FUNCTION crm_repair_private.autoclose_on_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_client uuid;
BEGIN
  IF NEW.direction <> 'outbound' OR coalesce(NEW.actor_type, '') NOT IN ('human', 'automated')
     OR coalesce(NEW.message_type, '') IN ('reaction', 'edit', 'revoke', 'system', 'unsupported') THEN RETURN NULL; END IF;
  v_client := coalesce(NEW.client_id, (SELECT c.client_id FROM public.whatsapp_conversations c WHERE c.id = NEW.conversation_id));
  IF v_client IS NULL THEN RETURN NULL; END IF;
  PERFORM crm_repair_private.autoclose_tasks(NEW.company_id, v_client, 'متابعة نتيجة الزيارة',
    CASE WHEN NEW.actor_type = 'human' THEN 'انرسلت رسالة للعميل من المكتب' ELSE 'العقل راسل العميل' END,
    coalesce(NEW.message_timestamp, now()));
  RETURN NULL;
EXCEPTION WHEN others THEN RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION crm_repair_private.autoclose_on_message() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS crm_tasks_autoclose_on_message ON public.whatsapp_messages;
CREATE TRIGGER crm_tasks_autoclose_on_message AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW WHEN (NEW.direction = 'outbound') EXECUTE FUNCTION crm_repair_private.autoclose_on_message();

-- a call with the client was logged
CREATE OR REPLACE FUNCTION crm_repair_private.autoclose_on_call()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.client_id IS NOT NULL AND (NEW.channel = 'call' OR NEW.type = 'call') THEN
    PERFORM crm_repair_private.autoclose_tasks(NEW.company_id, NEW.client_id, 'متابعة نتيجة الزيارة', 'انسجل اتصال مع العميل',
      coalesce(NEW.occurred_at, NEW.created_at, now()));
  END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION crm_repair_private.autoclose_on_call() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS crm_tasks_autoclose_on_call ON public.activities;
CREATE TRIGGER crm_tasks_autoclose_on_call AFTER INSERT ON public.activities
  FOR EACH ROW EXECUTE FUNCTION crm_repair_private.autoclose_on_call();

-- the visited property's status changed
CREATE OR REPLACE FUNCTION crm_repair_private.autoclose_on_property()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM crm_repair_private.autoclose_tasks(NEW.company_id, NULL, 'متابعة نتيجة الزيارة',
      'حالة العقار تغيرت إلى ' || coalesce(NEW.status, '-'), now(), NEW.id, NULL);
  END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION crm_repair_private.autoclose_on_property() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS crm_tasks_autoclose_on_property ON public.properties;
CREATE TRIGGER crm_tasks_autoclose_on_property AFTER UPDATE OF status ON public.properties
  FOR EACH ROW EXECUTE FUNCTION crm_repair_private.autoclose_on_property();

-- the priced offer left open / studied
CREATE OR REPLACE FUNCTION crm_repair_private.autoclose_on_owner_lead()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.status IN ('closed', 'listed') AND OLD.status IN ('open', 'studied') THEN
    PERFORM crm_repair_private.autoclose_tasks(NEW.company_id, NEW.client_id, 'دراسة سعر',
      CASE NEW.status WHEN 'listed' THEN 'العقار انضاف في النظام' ELSE 'عرض المالك انقفل' END, now(), NULL, NEW.id);
  END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION crm_repair_private.autoclose_on_owner_lead() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS crm_tasks_autoclose_on_owner_lead ON public.owner_leads;
CREATE TRIGGER crm_tasks_autoclose_on_owner_lead AFTER UPDATE OF status ON public.owner_leads
  FOR EACH ROW EXECUTE FUNCTION crm_repair_private.autoclose_on_owner_lead();
