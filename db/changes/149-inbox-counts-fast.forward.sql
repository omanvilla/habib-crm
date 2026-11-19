-- SQL149 (19 Nov 2026): crm_whatsapp_inbox_counts without the per-row RLS checks.
-- The unread badge (whatsapp-inbox action=counts) calls it every 30 s from every open tab. As SECURITY INVOKER it ran both
-- whatsapp_conversations policies on each of ~1,800 rows (investment_row_allowed + can_access_whatsapp_conversation, each
-- reading profiles again): ~220 ms warm, 554 ms mean in pg_stat_statements, the largest total in the database.
-- Same rows as the policies allow, decided once per call:
--   * caller = active profile (auth.uid()); only rows of the caller's company;
--   * owner: every row (investment_row_allowed is true for the owner);
--   * manager/agent: route_key is not 'owner', the route exists for the company and is not an owner-only inbox (or is
--     'investment'), and the row is not on the owner's private line (owner_line_is_private, as investment_row_allowed);
--   * any other role or an inactive account: zero.
-- Rollback: 149-inbox-counts-fast.rollback.sql (the previous SECURITY INVOKER body).
CREATE OR REPLACE FUNCTION public.crm_whatsapp_inbox_counts()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH me AS (
    SELECT p.company_id, p.role FROM public.profiles p
     WHERE p.id = auth.uid() AND p.is_active IS TRUE AND p.company_id IS NOT NULL
       AND p.role IN ('owner','manager','agent')
  )
  SELECT jsonb_build_object(
    'unread_total', coalesce(sum(c.unread_count), 0),
    'handoff_total', count(*) FILTER (WHERE c.human_handoff_required IS TRUE)
  )
    FROM me JOIN public.whatsapp_conversations c ON c.company_id = me.company_id
   WHERE me.role = 'owner'
      OR (c.route_key IS DISTINCT FROM 'owner'
          AND EXISTS (SELECT 1 FROM public.company_lead_routes r
                       WHERE r.company_id = c.company_id AND r.route_key = c.route_key
                         AND (r.owner_only_inbox IS FALSE OR r.route_key = 'investment'))
          AND NOT crm_repair_private.owner_line_is_private(c.company_id, to_jsonb(c)));
$function$;

REVOKE ALL ON FUNCTION public.crm_whatsapp_inbox_counts() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crm_whatsapp_inbox_counts() TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_whatsapp_inbox_counts() TO service_role;
