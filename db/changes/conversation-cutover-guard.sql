-- Keep this compatibility guard after cutover. Old in-flight Edge/frontend versions
-- cannot overwrite counters/timestamps maintained by the new message trigger.
CREATE OR REPLACE FUNCTION public.crm_guard_whatsapp_conversation_counters()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $f$
BEGIN
 IF new.last_message_seq=old.last_message_seq THEN
  new.last_message_at:=old.last_message_at;
  new.last_inbound_at:=old.last_inbound_at;
  new.last_outbound_at:=old.last_outbound_at;
  IF new.read_through_seq<=old.read_through_seq THEN new.unread_count:=old.unread_count; END IF;
 END IF;
 RETURN new;
END $f$;
REVOKE ALL ON FUNCTION public.crm_guard_whatsapp_conversation_counters() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_guard_whatsapp_conversation_counters() TO service_role;
DROP TRIGGER IF EXISTS trg_crm_guard_whatsapp_counters ON public.whatsapp_conversations;
CREATE TRIGGER trg_crm_guard_whatsapp_counters BEFORE UPDATE ON public.whatsapp_conversations FOR EACH ROW EXECUTE FUNCTION public.crm_guard_whatsapp_conversation_counters();

CREATE OR REPLACE FUNCTION public.crm_guard_instagram_conversation_counters()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $f$
BEGIN
 IF new.last_message_seq=old.last_message_seq THEN
  new.last_message_at:=old.last_message_at;
  new.last_inbound_at:=old.last_inbound_at;
  new.last_outbound_at:=old.last_outbound_at;
  IF new.read_through_seq<=old.read_through_seq THEN new.unread_count:=old.unread_count; END IF;
 END IF;
 RETURN new;
END $f$;
REVOKE ALL ON FUNCTION public.crm_guard_instagram_conversation_counters() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_guard_instagram_conversation_counters() TO service_role;
DROP TRIGGER IF EXISTS trg_crm_guard_instagram_counters ON public.instagram_conversations;
CREATE TRIGGER trg_crm_guard_instagram_counters BEFORE UPDATE ON public.instagram_conversations FOR EACH ROW EXECUTE FUNCTION public.crm_guard_instagram_conversation_counters();
