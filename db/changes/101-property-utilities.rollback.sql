-- Rollback of SQL101: the view goes back to the SQL98 body, then the four columns go (their answers are lost).
DROP VIEW IF EXISTS public.crm_properties_access;
CREATE OR REPLACE VIEW public.crm_properties_access AS
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
    t.relisted_at,
    t.unit_label,
    t.price_negotiable
   FROM public.properties t
  WHERE t.company_id = public.my_company() AND crm_repair_private.investment_row_allowed(t.company_id, to_jsonb(t.*)) AND crm_repair_private.staff_can_access_branch(t.company_id, t.branch_key);

GRANT SELECT ON public.crm_properties_access TO authenticated, service_role;
ALTER TABLE public.properties DROP COLUMN IF EXISTS electricity_connected;
ALTER TABLE public.properties DROP COLUMN IF EXISTS water_connected;
ALTER TABLE public.owner_leads DROP COLUMN IF EXISTS electricity_connected;
ALTER TABLE public.owner_leads DROP COLUMN IF EXISTS water_connected;
