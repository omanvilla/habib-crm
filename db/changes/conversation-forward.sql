-- Atomic timestamps/unread counters, shared by webhook and explicit mark-read.
ALTER TABLE public.whatsapp_conversations ADD COLUMN IF NOT EXISTS last_message_seq bigint NOT NULL DEFAULT 0;
ALTER TABLE public.whatsapp_conversations ADD COLUMN IF NOT EXISTS read_through_seq bigint NOT NULL DEFAULT 0;
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS ingestion_seq bigint;
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS conversation_touched_at timestamptz;

CREATE OR REPLACE FUNCTION public.crm_touch_whatsapp_conversation(p_conversation_id uuid,p_message_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $f$
DECLARE c public.whatsapp_conversations%rowtype; m public.whatsapp_messages%rowtype; v_unread boolean;
BEGIN
 SELECT * INTO c FROM public.whatsapp_conversations WHERE id=p_conversation_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'conversation_not_found'; END IF;
 SELECT * INTO m FROM public.whatsapp_messages WHERE id=p_message_id AND conversation_id=c.id AND company_id=c.company_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'message_not_found'; END IF;
 IF m.conversation_touched_at IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'duplicate',true,'unread_count',c.unread_count); END IF;
 v_unread:=m.direction='inbound';
 UPDATE public.whatsapp_conversations SET
  last_message_at=greatest(last_message_at,coalesce(m.message_timestamp,m.created_at)),
  last_inbound_at=CASE WHEN m.direction='inbound' THEN greatest(last_inbound_at,coalesce(m.message_timestamp,m.created_at)) ELSE last_inbound_at END,
  last_outbound_at=CASE WHEN m.direction='outbound' THEN greatest(last_outbound_at,coalesce(m.message_timestamp,m.created_at)) ELSE last_outbound_at END,
  last_message_seq=last_message_seq+1,unread_count=coalesce(unread_count,0)+CASE WHEN v_unread THEN 1 ELSE 0 END,updated_at=now()
 WHERE id=c.id RETURNING * INTO c;
 UPDATE public.whatsapp_messages SET conversation_touched_at=now(),ingestion_seq=c.last_message_seq WHERE id=m.id;
 RETURN jsonb_build_object('ok',true,'unread_count',c.unread_count);
END $f$;
REVOKE ALL ON FUNCTION public.crm_touch_whatsapp_conversation(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_touch_whatsapp_conversation(uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_touch_whatsapp_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
BEGIN
 IF new.direction IN ('inbound','outbound') THEN PERFORM public.crm_touch_whatsapp_conversation(new.conversation_id,new.id); END IF;
 RETURN new;
END $f$;
REVOKE ALL ON FUNCTION public.crm_touch_whatsapp_after_insert() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_touch_whatsapp_after_insert() TO service_role;
DROP TRIGGER IF EXISTS trg_crm_touch_whatsapp_atomic ON public.whatsapp_messages;
CREATE TRIGGER trg_crm_touch_whatsapp_atomic AFTER INSERT ON public.whatsapp_messages FOR EACH ROW EXECUTE FUNCTION public.crm_touch_whatsapp_after_insert();

CREATE OR REPLACE FUNCTION public.crm_mark_whatsapp_read(p_conversation_id uuid,p_message_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE c public.whatsapp_conversations%rowtype; m public.whatsapp_messages%rowtype; n int;
BEGIN
 IF public.my_company() IS NULL OR public.my_role() NOT IN ('owner','manager','agent') THEN RAISE EXCEPTION 'not_allowed'; END IF;
 IF NOT crm_repair_private.can_access_whatsapp_conversation(public.my_company(),p_conversation_id) THEN RAISE EXCEPTION 'conversation_not_found'; END IF;
 SELECT * INTO c FROM public.whatsapp_conversations WHERE id=p_conversation_id AND company_id=public.my_company() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'conversation_not_found'; END IF;
 SELECT * INTO m FROM public.whatsapp_messages WHERE id=p_message_id AND conversation_id=c.id AND company_id=c.company_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'message_not_found'; END IF;
 c.read_through_seq:=greatest(c.read_through_seq,coalesce(m.ingestion_seq,0));
 SELECT count(*)::int INTO n FROM public.whatsapp_messages WHERE conversation_id=c.id AND company_id=c.company_id AND direction='inbound'
 AND ingestion_seq>c.read_through_seq;
 UPDATE public.whatsapp_conversations SET unread_count=n,read_through_seq=c.read_through_seq,updated_at=now() WHERE id=c.id;
 RETURN jsonb_build_object('ok',true,'unread_count',n);
END $f$;
REVOKE ALL ON FUNCTION public.crm_mark_whatsapp_read(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_mark_whatsapp_read(uuid,uuid) TO authenticated;
