-- SQL88 (11 Nov 2026, Ahmed: «إذا سويت تم خلاص مفترض ما يرجع لي مرة ثانية»): «تم» on a hot alert came back whenever the
-- reply agent handed the same chat over again (each handoff moves handoff_updated_at past owner_alert_done_at). «تم» now also
-- keeps the handoff it closed (owner_alert_done_reason); crm-hot-alerts.js shows the chat again only for a different kind of
-- handoff (a call request after «تم» on a serious buyer, a new meeting request...). Rollback: 88-hot-alert-done-sticks.rollback.sql
SET LOCAL lock_timeout = '10s';

DO $$ BEGIN
  IF md5(pg_get_functiondef('public.crm_hot_alert_done(uuid)'::regprocedure)) <> '024593e8d3bb0d1edcaa4c34e682e3f4' THEN
    RAISE EXCEPTION 'SQL88 refused: crm_hot_alert_done changed since 11 Nov 2026';
  END IF;
END $$;

ALTER TABLE public.whatsapp_conversations ADD COLUMN IF NOT EXISTS owner_alert_done_reason text;

CREATE OR REPLACE FUNCTION public.crm_hot_alert_done(p_conversation_id uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_company uuid := public.my_company(); v_at timestamptz := now();
BEGIN
  IF v_company IS NULL OR public.my_role() IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  UPDATE public.whatsapp_conversations SET owner_alert_done_at = v_at, owner_alert_done_reason = left(handoff_reason, 500)
   WHERE id = p_conversation_id AND company_id = v_company;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  RETURN v_at;
END
$function$;
