-- Rollback of SQL76 (property archive). Coordinated: first roll back what reads archive_reason (the deal-closing
-- trigger on properties, the agent's «ما عادت متوفرة» block, the archive and restore dialogs), then run this file.
-- Business rows stay: the archived flag, archived_at/archived_by and the status each property has now (76b moved the
-- 14 archived «available» rows to withdrawn/not_available; they stay so, they are archived). The reasons, notes,
-- relisted_at and the history table are dropped. If archive decisions were recorded after the release (history rows
-- other than the 76b backfill), this refuses until they are exported and the transaction sets
-- crm.sql76_rollback_drop_history = 'yes' (SET LOCAL). Owner notifications and crm_property_alerts rows stay.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
BEGIN
  IF to_regclass('public.property_archive_events') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.property_archive_events e WHERE e.source <> 'backfill')
       AND coalesce(current_setting('crm.sql76_rollback_drop_history', true), '') <> 'yes' THEN
      RAISE EXCEPTION 'SQL76 rollback refused: archive decisions were recorded since the release; export public.property_archive_events, then SET LOCAL crm.sql76_rollback_drop_history = ''yes''';
    END IF;
  END IF;
END
$guard$;

DO $cron$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'crm_expire_listing_agreements_daily') THEN
      PERFORM cron.unschedule('crm_expire_listing_agreements_daily');
    END IF;
  END IF;
END
$cron$;

DROP FUNCTION IF EXISTS public.crm_expire_listing_agreements();
DROP FUNCTION IF EXISTS public.crm_restore_property(uuid, boolean, date, integer, numeric, text);
DROP FUNCTION IF EXISTS public.crm_archive_property(uuid, text, text, boolean);
DROP FUNCTION IF EXISTS public.crm_property_archive_precheck(uuid);
DROP FUNCTION IF EXISTS crm_repair_private.archive_property_internal(uuid, text, text, text, jsonb, boolean);
DROP FUNCTION IF EXISTS crm_repair_private.property_archive_caller(uuid);
DROP FUNCTION IF EXISTS crm_repair_private.property_archive_state(uuid);
DROP TRIGGER IF EXISTS crm_guard_property_archive ON public.properties;
DROP FUNCTION IF EXISTS crm_repair_private.guard_property_archive_columns();

-- The view goes back to its definition before SQL76. Columns can only be removed by recreating it, so its grants
-- are restored as they were (SELECT for authenticated and service_role only).
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
    t.listing_purpose
   FROM public.properties t
  WHERE t.company_id = public.my_company() AND crm_repair_private.investment_row_allowed(t.company_id, to_jsonb(t.*)) AND crm_repair_private.staff_can_access_branch(t.company_id, t.branch_key);
REVOKE ALL ON public.crm_properties_access FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.crm_properties_access TO authenticated, service_role;

-- The two archived-row rules come from 76b; IF EXISTS also covers a rollback made before 76b ran.
ALTER TABLE public.properties
  DROP CONSTRAINT IF EXISTS properties_archived_has_reason_chk,
  DROP CONSTRAINT IF EXISTS properties_archived_not_available_chk,
  DROP CONSTRAINT IF EXISTS properties_archive_source_chk;
ALTER TABLE public.properties
  DROP COLUMN IF EXISTS archive_reason,
  DROP COLUMN IF EXISTS archive_note,
  DROP COLUMN IF EXISTS archive_source,
  DROP COLUMN IF EXISTS archive_evidence,
  DROP COLUMN IF EXISTS relisted_at;
DROP TABLE IF EXISTS public.property_archive_events;
DROP TABLE IF EXISTS public.property_archive_reasons;

NOTIFY pgrst, 'reload schema';
