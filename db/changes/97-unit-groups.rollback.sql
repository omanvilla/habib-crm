-- Rollback of SQL97: the move trigger and the unit group functions go, so a sold unit closes its cards again (SQL77) and
-- every sender falls back to «انحجزت، تحب تشوف خيارات ثانية ؟». Pin whatsapp-outreach, whatsapp-sold-notify,
-- whatsapp-visit-followup-auto and whatsapp-reply-agent back to their previous commits FIRST (they call crm_unit_group_notice /
-- crm_unit_groups; without the functions they only log an error and use the old wording). What was already moved to a remaining
-- unit stays there (each move is in the card's activity log and in the visit's notes). properties.unit_label is dropped only
-- when no property has one: the names are Ahmed's data.
SET LOCAL lock_timeout = '10s';

DROP TRIGGER IF EXISTS crm_a_move_to_remaining_unit ON public.properties;
DROP FUNCTION IF EXISTS crm_repair_private.move_to_remaining_unit_on_change();
DROP FUNCTION IF EXISTS crm_repair_private.move_to_remaining_unit(uuid, text, boolean);
DROP FUNCTION IF EXISTS public.crm_unit_groups(uuid);
DROP FUNCTION IF EXISTS public.crm_unit_group_notice(uuid);
DROP FUNCTION IF EXISTS crm_repair_private.unit_group_notice(uuid);
DROP FUNCTION IF EXISTS crm_repair_private.unit_siblings(uuid);
DROP FUNCTION IF EXISTS crm_repair_private.unit_name(text, text);
DROP FUNCTION IF EXISTS crm_repair_private.unit_ordinal(text);
DROP FUNCTION IF EXISTS crm_repair_private.unit_near(numeric, numeric);
DROP FUNCTION IF EXISTS crm_repair_private.unit_area_key(text);
DROP FUNCTION IF EXISTS crm_repair_private.unit_type_family(text);

ALTER TABLE public.whatsapp_outreach_queue DROP COLUMN IF EXISTS client_stage;
ALTER TABLE public.whatsapp_visit_followups DROP COLUMN IF EXISTS client_stage;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.properties WHERE nullif(btrim(coalesce(unit_label, '')), '') IS NOT NULL) THEN
    ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_unit_label_chk;
    ALTER TABLE public.properties DROP COLUMN IF EXISTS unit_label;
  END IF;
END $$;
