CREATE TABLE IF NOT EXISTS public.instagram_outbound_operations(
 company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
 operation_id uuid NOT NULL,
 conversation_id uuid NOT NULL REFERENCES public.instagram_conversations(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL REFERENCES public.profiles(id),
 body_sha256 text NOT NULL,
 status text NOT NULL DEFAULT 'claimed' CHECK(status IN ('claimed','sent','uncertain','failed')),
 instagram_message_id text,
 recorded boolean NOT NULL DEFAULT false,
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(company_id,operation_id)
);
ALTER TABLE public.instagram_outbound_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.instagram_outbound_operations FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.instagram_outbound_operations TO service_role;
CREATE OR REPLACE FUNCTION public.crm_claim_instagram_send(p_company_id uuid,p_operation_id uuid,p_conversation_id uuid,p_actor_id uuid,p_body_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $f$
DECLARE r public.instagram_outbound_operations%rowtype; fresh boolean;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.instagram_conversations WHERE id=p_conversation_id AND company_id=p_company_id)
 OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND company_id=p_company_id AND is_active IS TRUE AND role IN ('owner','manager','agent'))
 THEN RAISE EXCEPTION 'not_allowed'; END IF;
 INSERT INTO public.instagram_outbound_operations(company_id,operation_id,conversation_id,actor_id,body_sha256)
 VALUES(p_company_id,p_operation_id,p_conversation_id,p_actor_id,p_body_sha256) ON CONFLICT(company_id,operation_id) DO NOTHING RETURNING * INTO r;
 fresh:=FOUND;
 IF NOT fresh THEN
  SELECT * INTO r FROM public.instagram_outbound_operations WHERE company_id=p_company_id AND operation_id=p_operation_id;
  IF r.conversation_id<>p_conversation_id OR r.actor_id<>p_actor_id OR r.body_sha256<>p_body_sha256 THEN RAISE EXCEPTION 'operation_key_reused'; END IF;
 END IF;
 RETURN jsonb_build_object('claimed',fresh,'status',r.status,'message_id',r.instagram_message_id,'recorded',r.recorded);
END $f$;
REVOKE ALL ON FUNCTION public.crm_claim_instagram_send(uuid,uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_claim_instagram_send(uuid,uuid,uuid,uuid,text) TO service_role;
