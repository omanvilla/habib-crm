-- SQL52: per-category auto-send switches for the WhatsApp reply agent (all off by default).
-- The agent sends without the owner's approval only when its reply matches a pinned reply
-- AND the conversation's category is switched on here. Owner-only read/write through RPCs;
-- the runtime table itself stays closed to clients (RLS, no policies).
ALTER TABLE public.whatsapp_automation_runtime
  ADD COLUMN IF NOT EXISTS auto_send_categories text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.whatsapp_automation_runtime DROP CONSTRAINT IF EXISTS runtime_auto_send_categories_chk;
ALTER TABLE public.whatsapp_automation_runtime ADD CONSTRAINT runtime_auto_send_categories_chk
  CHECK (auto_send_categories <@ ARRAY['buyer','tenant','investor','seller','general','broker','active_deal','unclear']::text[]);

CREATE OR REPLACE FUNCTION public.crm_reply_auto_send_get()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v text[];
BEGIN
  IF public.my_role() IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'owner_only' USING ERRCODE = '42501'; END IF;
  SELECT r.auto_send_categories INTO v FROM public.whatsapp_automation_runtime r WHERE r.company_id = public.my_company();
  RETURN jsonb_build_object('categories', to_jsonb(coalesce(v, '{}'::text[])));
END
$function$;

CREATE OR REPLACE FUNCTION public.crm_reply_auto_send_set(p_categories text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v text[];
BEGIN
  IF public.my_role() IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'owner_only' USING ERRCODE = '42501'; END IF;
  SELECT coalesce(array_agg(DISTINCT c ORDER BY c), '{}') INTO v FROM unnest(coalesce(p_categories, '{}'::text[])) c;
  UPDATE public.whatsapp_automation_runtime SET auto_send_categories = v, updated_at = now() WHERE company_id = public.my_company();
  IF NOT FOUND THEN RAISE EXCEPTION 'runtime_missing' USING ERRCODE = '22023'; END IF;
  RETURN jsonb_build_object('ok', true, 'categories', to_jsonb(v));
END
$function$;

REVOKE ALL ON FUNCTION public.crm_reply_auto_send_get() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_reply_auto_send_set(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_reply_auto_send_get() TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_reply_auto_send_set(text[]) TO authenticated;
