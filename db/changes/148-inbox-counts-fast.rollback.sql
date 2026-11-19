-- Rollback of SQL148: the previous SECURITY INVOKER body (whatsapp_conversations RLS decides the rows).
CREATE OR REPLACE FUNCTION public.crm_whatsapp_inbox_counts()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT jsonb_build_object(
    'unread_total',coalesce(sum(c.unread_count),0),
    'handoff_total',count(*) FILTER(WHERE c.human_handoff_required IS TRUE)
  ) FROM public.whatsapp_conversations c
  WHERE auth.uid() IS NOT NULL AND EXISTS(
    SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.is_active IS TRUE
  );
$function$;

REVOKE ALL ON FUNCTION public.crm_whatsapp_inbox_counts() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_whatsapp_inbox_counts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_whatsapp_inbox_counts() TO service_role;
