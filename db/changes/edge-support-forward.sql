BEGIN;

-- A private receipt journal prevents repeating a send after an uncertain response.
CREATE TABLE public.whatsapp_send_operations (
  company_id uuid NOT NULL,
  user_id uuid NOT NULL,
  operation_key uuid NOT NULL,
  client_id uuid NOT NULL,
  conversation_id uuid NOT NULL,
  crm_request_id uuid,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('processing','sent','failed','unknown')),
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id,user_id,operation_key)
);
ALTER TABLE public.whatsapp_send_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_send_operations FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.whatsapp_send_operations TO service_role;

-- Checks the existing Vault secret without returning or copying its value.
CREATE FUNCTION public.crm_verify_followup_cron_secret(p_secret text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_secret IS NOT NULL AND length(p_secret)>0 AND EXISTS (
    SELECT 1 FROM vault.decrypted_secrets s
    WHERE s.name='crm_followup_cron_secret' AND s.decrypted_secret=p_secret
  );
$$;
REVOKE ALL ON FUNCTION public.crm_verify_followup_cron_secret(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_verify_followup_cron_secret(text) TO service_role;

-- Both read helpers deliberately run with the authenticated caller's RLS.
CREATE FUNCTION public.crm_whatsapp_inbox_counts()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'unread_total',coalesce(sum(c.unread_count),0),
    'handoff_total',count(*) FILTER(WHERE c.human_handoff_required IS TRUE)
  ) FROM public.whatsapp_conversations c
  WHERE auth.uid() IS NOT NULL AND EXISTS(
    SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.is_active IS TRUE
  );
$$;
REVOKE ALL ON FUNCTION public.crm_whatsapp_inbox_counts() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_whatsapp_inbox_counts() TO authenticated;

CREATE FUNCTION public.crm_whatsapp_latest_messages(p_conversation_ids uuid[])
RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT to_jsonb(latest) FROM (
    SELECT DISTINCT ON (m.conversation_id)
      m.conversation_id,m.request_id,m.direction,m.actor_type,m.body,m.transcript,
      m.message_type,m.message_timestamp,m.delivery_status,m.automation_result
    FROM public.whatsapp_messages m
    JOIN public.whatsapp_conversations c ON c.id=m.conversation_id AND c.company_id=m.company_id
    WHERE m.conversation_id=ANY(p_conversation_ids[1:300]) AND auth.uid() IS NOT NULL
      AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.is_active IS TRUE)
    ORDER BY m.conversation_id,m.message_timestamp DESC,m.id DESC
  ) latest;
$$;
REVOKE ALL ON FUNCTION public.crm_whatsapp_latest_messages(uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_whatsapp_latest_messages(uuid[]) TO authenticated;

COMMIT;
