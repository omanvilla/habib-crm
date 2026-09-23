ALTER TABLE public.instagram_conversations ADD COLUMN IF NOT EXISTS last_message_seq bigint NOT NULL DEFAULT 0;
ALTER TABLE public.instagram_conversations ADD COLUMN IF NOT EXISTS read_through_seq bigint NOT NULL DEFAULT 0;
ALTER TABLE public.instagram_messages ADD COLUMN IF NOT EXISTS ingestion_seq bigint;
CREATE OR REPLACE FUNCTION public.crm_touch_instagram_after_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE v_seq bigint;
BEGIN
 UPDATE public.instagram_conversations SET
  last_message_at=greatest(last_message_at,coalesce(new.message_timestamp,new.created_at)),
  last_inbound_at=CASE WHEN new.direction='inbound' THEN greatest(last_inbound_at,coalesce(new.message_timestamp,new.created_at)) ELSE last_inbound_at END,
  last_outbound_at=CASE WHEN new.direction='outbound' THEN greatest(last_outbound_at,coalesce(new.message_timestamp,new.created_at)) ELSE last_outbound_at END,
  last_message_seq=last_message_seq+1,unread_count=coalesce(unread_count,0)+CASE WHEN new.direction='inbound' THEN 1 ELSE 0 END,
  updated_at=now() WHERE id=new.conversation_id AND company_id=new.company_id RETURNING last_message_seq INTO v_seq;
 UPDATE public.instagram_messages SET ingestion_seq=v_seq WHERE id=new.id;
 RETURN new;
END $f$;
REVOKE ALL ON FUNCTION public.crm_touch_instagram_after_insert() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_touch_instagram_after_insert() TO service_role;
DROP TRIGGER IF EXISTS trg_crm_touch_instagram_atomic ON public.instagram_messages;
CREATE TRIGGER trg_crm_touch_instagram_atomic AFTER INSERT ON public.instagram_messages FOR EACH ROW EXECUTE FUNCTION public.crm_touch_instagram_after_insert();

CREATE OR REPLACE FUNCTION public.crm_mark_instagram_read(p_conversation_id uuid,p_message_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE c public.instagram_conversations%rowtype; m public.instagram_messages%rowtype; n int;
 v_company uuid:=public.my_company(); v_role text:=public.my_role();
BEGIN
 IF v_company IS NULL OR v_role NOT IN ('owner','manager','agent') THEN RAISE EXCEPTION 'not_allowed'; END IF;
 SELECT * INTO c FROM public.instagram_conversations WHERE id=p_conversation_id AND company_id=v_company
  AND (v_role IN ('owner','manager') OR assigned_to=auth.uid() OR EXISTS(SELECT 1 FROM public.clients cc WHERE cc.id=client_id AND cc.company_id=v_company AND cc.assigned_to=auth.uid())) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'conversation_not_found'; END IF;
 SELECT * INTO m FROM public.instagram_messages WHERE id=p_message_id AND conversation_id=c.id AND company_id=v_company;
 IF NOT FOUND THEN RAISE EXCEPTION 'message_not_found'; END IF;
 c.read_through_seq:=greatest(c.read_through_seq,coalesce(m.ingestion_seq,0));
 SELECT count(*)::int INTO n FROM public.instagram_messages WHERE conversation_id=c.id AND company_id=v_company AND direction='inbound' AND ingestion_seq>c.read_through_seq;
 UPDATE public.instagram_conversations SET unread_count=n,read_through_seq=c.read_through_seq,updated_at=now() WHERE id=c.id;
 RETURN jsonb_build_object('ok',true,'unread_count',n);
END $f$;
REVOKE ALL ON FUNCTION public.crm_mark_instagram_read(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_mark_instagram_read(uuid,uuid) TO authenticated;
