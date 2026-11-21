-- Rollback of SQL151. The direct chats stay muted (the agent keeps quiet with them) and come back in «العقل موقوف عندهم»
-- with their «تواصل مباشر: …» reason; nothing is lost.
SET LOCAL lock_timeout = '10s';
DROP TRIGGER IF EXISTS crm_direct_contact_sync ON public.whatsapp_conversations;
DROP FUNCTION IF EXISTS crm_repair_private.direct_contact_sync();
DROP FUNCTION IF EXISTS public.crm_set_direct_contact(uuid, boolean, text);
DO $do$
declare d text;
begin
  d := pg_get_functiondef('public.crm_home_attention'::regproc);
  execute replace(d, 'AND w.ignored_at IS NULL AND w.direct_contact_at IS NULL', 'AND w.ignored_at IS NULL');
  d := pg_get_functiondef('public.crm_followups_today'::regproc);
  execute replace(d, 'WHERE NOT EXISTS (SELECT 1 FROM public.whatsapp_conversations dw WHERE dw.id = i.conversation_id AND dw.direct_contact_at IS NOT NULL) AND (v_owner OR (public.my_role() IN (''manager'',''agent'',''viewer'') AND i.route_key IS DISTINCT FROM ''owner''))',
    'WHERE v_owner OR (public.my_role() IN (''manager'',''agent'',''viewer'') AND i.route_key IS DISTINCT FROM ''owner'')');
end $do$;
-- crm_paused_chats: re-run its previous body (supabase/migrations/20261112150952_98_ignored_chats.sql or the latest that set it).
-- The direct_contact_* columns and crm_repair_private.direct_contact_label stay (harmless).
