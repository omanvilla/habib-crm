-- Rollback for SQL55. The CRM and the reply agent treat a missing value as a sale.
-- Deploy the front end without listing_purpose first; the view must lose the column before the table does.
DROP VIEW public.crm_properties_access;
CREATE VIEW public.crm_properties_access AS
 SELECT id, company_id, added_by, title, type, area, price, bedrooms, bathrooms, land_size, built_size, status, description, images,
    views_count, inquiries_count, created_at, updated_at, owner_client_id, archived, archived_at, archived_by, owner_id,
    CASE WHEN my_role() = 'owner'::text THEN owner_net ELSE NULL::numeric END AS owner_net,
    wilayat, source_type, marketing_status,
    CASE WHEN my_role() = 'owner'::text THEN expected_commission ELSE NULL::numeric END AS expected_commission,
    property_code, internal_name, branch_key, availability_checked_at, performance_tracking_started_at, photography_status,
    photography_reason, photography_required_at, photography_completed_at, marketing_review_status, marketing_reviewed_at,
    marketing_review_note, last_ai_recommendation, last_ai_recommendation_at, public_details, map_url, has_listing_agreement,
    agreement_start_date, agreement_duration_months, agreement_end_date, agreement_reminder_days, sourced_by
   FROM properties t
  WHERE company_id = my_company() AND crm_repair_private.investment_row_allowed(company_id, to_jsonb(t.*)) AND crm_repair_private.staff_can_access_branch(company_id, branch_key);
GRANT SELECT ON public.crm_properties_access TO authenticated, service_role;
REVOKE SELECT (listing_purpose) ON public.properties FROM authenticated;
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_listing_purpose_chk;
ALTER TABLE public.properties DROP COLUMN IF EXISTS listing_purpose;
