-- SQL55: each property says whether it is for sale or for rent, so the WhatsApp reply agent can
-- answer rental questions from what is in the CRM right now instead of a fixed reply.
-- Existing properties are all sales; the default keeps them that way.
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS listing_purpose text NOT NULL DEFAULT 'sale';
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_listing_purpose_chk;
ALTER TABLE public.properties ADD CONSTRAINT properties_listing_purpose_chk CHECK (listing_purpose IN ('sale', 'rent'));
-- Properties are read through column-level SELECT grants, so the new column needs its own.
GRANT SELECT (listing_purpose) ON public.properties TO authenticated;

-- The CRM reads properties through crm_properties_access; the new column goes at the end of the view.
CREATE OR REPLACE VIEW public.crm_properties_access AS
 SELECT id, company_id, added_by, title, type, area, price, bedrooms, bathrooms, land_size, built_size, status, description, images,
    views_count, inquiries_count, created_at, updated_at, owner_client_id, archived, archived_at, archived_by, owner_id,
    CASE WHEN my_role() = 'owner'::text THEN owner_net ELSE NULL::numeric END AS owner_net,
    wilayat, source_type, marketing_status,
    CASE WHEN my_role() = 'owner'::text THEN expected_commission ELSE NULL::numeric END AS expected_commission,
    property_code, internal_name, branch_key, availability_checked_at, performance_tracking_started_at, photography_status,
    photography_reason, photography_required_at, photography_completed_at, marketing_review_status, marketing_reviewed_at,
    marketing_review_note, last_ai_recommendation, last_ai_recommendation_at, public_details, map_url, has_listing_agreement,
    agreement_start_date, agreement_duration_months, agreement_end_date, agreement_reminder_days, sourced_by,
    listing_purpose
   FROM properties t
  WHERE company_id = my_company() AND crm_repair_private.investment_row_allowed(company_id, to_jsonb(t.*)) AND crm_repair_private.staff_can_access_branch(company_id, branch_key);
