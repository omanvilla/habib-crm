-- SQL101 (14 Nov 2026, Ahmed: «أي عقار نستلمه لازم نعرف إذا الكهرباء موصلة», then «نعم، الكهرباء والماء»).
--   Two facts on a property and on an owner offer: electricity_connected and water_connected, 'yes' / 'no' / NULL (not known).
--   The reply agent asks the owner once (next to the key question, R46), keeps the answer on the offer, and answers a buyer
--   from the property (R52). The office sets them on the property form. Only adds: two columns on two tables, their checks,
--   column grants, and the two columns appended at the end of the view crm_properties_access (refused when the live view is
--   not the SQL98 body). No trigger, no cron, no function, no data change.
DO $$ BEGIN
  IF current_setting('server_version_num')::int < 150000 THEN RAISE EXCEPTION 'SQL101 expects Postgres 15+'; END IF;
END $$;

ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS electricity_connected text;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS water_connected text;
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_electricity_connected_chk;
ALTER TABLE public.properties ADD CONSTRAINT properties_electricity_connected_chk CHECK (electricity_connected IS NULL OR electricity_connected IN ('yes','no'));
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_water_connected_chk;
ALTER TABLE public.properties ADD CONSTRAINT properties_water_connected_chk CHECK (water_connected IS NULL OR water_connected IN ('yes','no'));
GRANT SELECT, INSERT, UPDATE (electricity_connected, water_connected) ON public.properties TO authenticated;

ALTER TABLE public.owner_leads ADD COLUMN IF NOT EXISTS electricity_connected text;
ALTER TABLE public.owner_leads ADD COLUMN IF NOT EXISTS water_connected text;
ALTER TABLE public.owner_leads DROP CONSTRAINT IF EXISTS owner_leads_electricity_connected_chk;
ALTER TABLE public.owner_leads ADD CONSTRAINT owner_leads_electricity_connected_chk CHECK (electricity_connected IS NULL OR electricity_connected IN ('yes','no'));
ALTER TABLE public.owner_leads DROP CONSTRAINT IF EXISTS owner_leads_water_connected_chk;
ALTER TABLE public.owner_leads ADD CONSTRAINT owner_leads_water_connected_chk CHECK (water_connected IS NULL OR water_connected IN ('yes','no'));

-- the view: the two columns appended at the end. Refused when the live view is not the SQL98 body.
DO $guard$
DECLARE v_def text; v_path text := current_setting('search_path');
BEGIN
  PERFORM set_config('search_path', 'public', true);
  v_def := pg_get_viewdef('public.crm_properties_access'::regclass, true);
  PERFORM set_config('search_path', v_path, true);
  IF md5(v_def) <> '8af5dc12ea68b09627921796dbc7b091' AND position('electricity_connected' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SQL101 refused: public.crm_properties_access changed since SQL98 (md5 %)', md5(v_def);
  END IF;
END
$guard$;
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
    t.price_negotiable,
    t.electricity_connected,
    t.water_connected
   FROM public.properties t
  WHERE t.company_id = public.my_company() AND crm_repair_private.investment_row_allowed(t.company_id, to_jsonb(t.*)) AND crm_repair_private.staff_can_access_branch(t.company_id, t.branch_key);
