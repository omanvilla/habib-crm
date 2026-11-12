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

-- the view goes back to its SQL76 body first (it reads unit_label)
DROP VIEW IF EXISTS public.crm_properties_access;
CREATE VIEW public.crm_properties_access AS
 SELECT t.id,
    t.company_id,
    t.added_by,
    t.title,
    t.type,
    t.area,
    t.price,
    t.bedrooms,
    t.bathrooms,
    t.land_size,
    t.built_size,
    t.status,
    t.description,
    t.images,
    t.views_count,
    t.inquiries_count,
    t.created_at,
    t.updated_at,
    t.owner_client_id,
    t.archived,
    t.archived_at,
    t.archived_by,
    t.owner_id,
        CASE
            WHEN public.my_role() = 'owner'::text THEN t.owner_net
            ELSE NULL::numeric
        END AS owner_net,
    t.wilayat,
    t.source_type,
    t.marketing_status,
        CASE
            WHEN public.my_role() = 'owner'::text THEN t.expected_commission
            ELSE NULL::numeric
        END AS expected_commission,
    t.property_code,
    t.internal_name,
    t.branch_key,
    t.availability_checked_at,
    t.performance_tracking_started_at,
    t.photography_status,
    t.photography_reason,
    t.photography_required_at,
    t.photography_completed_at,
    t.marketing_review_status,
    t.marketing_reviewed_at,
    t.marketing_review_note,
    t.last_ai_recommendation,
    t.last_ai_recommendation_at,
    t.public_details,
    t.map_url,
    t.has_listing_agreement,
    t.agreement_start_date,
    t.agreement_duration_months,
    t.agreement_end_date,
    t.agreement_reminder_days,
    t.sourced_by,
    t.listing_purpose,
    t.archive_reason,
    t.archive_note,
    t.archive_source,
    t.archive_evidence,
    t.relisted_at
   FROM public.properties t
  WHERE t.company_id = public.my_company() AND crm_repair_private.investment_row_allowed(t.company_id, to_jsonb(t.*)) AND crm_repair_private.staff_can_access_branch(t.company_id, t.branch_key);
REVOKE ALL ON public.crm_properties_access FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.crm_properties_access TO authenticated, service_role;

ALTER TABLE public.whatsapp_outreach_queue DROP COLUMN IF EXISTS client_stage;
ALTER TABLE public.whatsapp_visit_followups DROP COLUMN IF EXISTS client_stage;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.properties WHERE nullif(btrim(coalesce(unit_label, '')), '') IS NOT NULL) THEN
    ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_unit_label_chk;
    ALTER TABLE public.properties DROP COLUMN IF EXISTS unit_label;
  END IF;
END $$;
