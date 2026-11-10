-- SQL76 (10 Nov 2026, Ahmed's instruction 3): the property archive.
--
-- * An archived property is never «available». Archiving sets the status in the same UPDATE as archived=true
--   (sold stays sold, otherwise the reason's status_after), and two CHECK constraints make it a database rule.
--   76b adds them (NOT VALID, then validated at once) after it gives the 18 archived rows a reason. They are not
--   added here: a CHECK applies to every UPDATE of a row, so until 76b every write to one of those 18 rows (a deal
--   stage that recalculates its status, a marketing event, an edit) would fail.
-- * Every archive records a reason from public.property_archive_reasons, with an optional note, the source
--   (manual / agent / system / backfill) and evidence. The history is in public.property_archive_events
--   (archive / restore / reason_set rows); clients can only read it, through company and branch access.
-- * One write path: public.crm_property_archive_precheck, public.crm_archive_property and
--   public.crm_restore_property, all on crm_repair_private.archive_property_internal, which the expiry job and
--   the agent use too. A client that updates the archive columns directly is refused (crm_guard_property_archive).
-- * Active deal = a deal at negotiation, deposit, awaiting_finance, finance_approved, awaiting_clearance or
--   ownership_transfer, or a property status of reserved, deposit or negotiating. Branch staff are always blocked
--   by it; only the signed-in owner may force. Agent and system sources never force. Archiving an archived property
--   again sets a new reason (reason_set, owner or backend only) and keeps archived_at/archived_by.
-- * Restore = a new contract: status available, archive columns cleared (the history keeps them), an optional
--   new marketing agreement and price, relisted_at=now(). The status change fires the existing outreach trigger
--   (new-listing rows wait for the owner's approval), as wanted.
-- * public.crm_expire_listing_agreements() runs daily at 06:00 UTC (10:00 Muscat). An available property whose
--   recorded agreement ended before today is archived (contract_expired, source system) unless a deal is active
--   or a viewing is coming; then it is held. The owner gets one notification per property and end date.
-- Release order (10 Nov 2026), each file as its own migration: 76 -> 77 -> 77b -> 76b (then 77c, 78). 77 reads
-- archive_reason; 76b comes after 77b (its header says why). Between 76 and 76b the 18 archived rows have no reason
-- yet and are written as before; crm_guard_property_archive already refuses a direct client write of the archive
-- columns. Rollback: 76-property-archive.rollback.sql.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $guard$
DECLARE v_path text := current_setting('search_path'); v_def text;
BEGIN
  IF to_regprocedure('crm_repair_private.staff_can_access_branch(uuid,text)') IS NULL
     OR to_regprocedure('crm_repair_private.investment_row_allowed(uuid,jsonb)') IS NULL
     OR to_regprocedure('crm_repair_private.investment_owner(uuid)') IS NULL
     OR to_regprocedure('public.my_company()') IS NULL
     OR to_regprocedure('public.my_role()') IS NULL
     OR to_regprocedure('auth.uid()') IS NULL
     OR to_regprocedure('auth.role()') IS NULL THEN
    RAISE EXCEPTION 'SQL76 apply refused: access helpers are missing';
  END IF;
  IF to_regclass('public.crm_properties_access') IS NULL OR to_regclass('public.crm_property_alerts') IS NULL THEN
    RAISE EXCEPTION 'SQL76 apply refused: crm_properties_access or crm_property_alerts is missing';
  END IF;
  -- Section 6 rewrites the view from its 10 Nov 2026 definition and the rollback restores that body: refuse when the
  -- live view changed since then (a second apply, already carrying archive_reason, passes).
  PERFORM set_config('search_path', 'public', true);
  v_def := pg_get_viewdef('public.crm_properties_access'::regclass, true);
  PERFORM set_config('search_path', v_path, true);
  IF md5(v_def) <> 'e64c33f86254270ca1a13670191c9253' AND position('archive_reason' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SQL76 apply refused: public.crm_properties_access changed since 10 Nov 2026 (md5 %)', md5(v_def);
  END IF;
END
$guard$;

-- 1) Reasons. The label is what the CRM and the agent show; status_after is the market state after archiving.
CREATE TABLE IF NOT EXISTS public.property_archive_reasons (
  code text PRIMARY KEY,
  label_ar text NOT NULL,
  status_after text NOT NULL CHECK (status_after IN ('sold', 'withdrawn', 'not_available')),
  manual_selectable boolean NOT NULL DEFAULT true,
  note_required boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL
);
INSERT INTO public.property_archive_reasons (code, label_ar, status_after, manual_selectable, note_required, sort_order) VALUES
  ('contract_expired', 'انتهى عقد التسويق', 'withdrawn', true, false, 10),
  ('owner_withdrew', 'المالك سحب العقار', 'withdrawn', true, false, 20),
  ('sold_by_owner', 'المالك باعه بنفسه أو عن طريق غيرنا', 'sold', true, false, 30),
  ('sold_by_us', 'انباع عن طريقنا', 'sold', true, false, 40),
  ('rented', 'انأجر', 'not_available', true, false, 50),
  ('duplicate', 'سجل مكرر', 'not_available', true, true, 60),
  ('test_record', 'سجل تجريبي أو خطأ إدخال', 'not_available', true, false, 70),
  ('other', 'سبب آخر', 'not_available', true, true, 80),
  ('unrecorded', 'سبب الأرشفة غير مسجل', 'not_available', false, false, 90)
ON CONFLICT (code) DO UPDATE SET label_ar = EXCLUDED.label_ar, status_after = EXCLUDED.status_after,
  manual_selectable = EXCLUDED.manual_selectable, note_required = EXCLUDED.note_required, sort_order = EXCLUDED.sort_order;
ALTER TABLE public.property_archive_reasons ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS property_archive_reasons_read ON public.property_archive_reasons;
CREATE POLICY property_archive_reasons_read ON public.property_archive_reasons FOR SELECT TO authenticated
  USING ((SELECT public.my_company()) IS NOT NULL);
REVOKE ALL ON public.property_archive_reasons FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.property_archive_reasons TO authenticated;

-- 2) Archive columns on the property. archived/archived_at/archived_by stay as they are.
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS archive_reason text REFERENCES public.property_archive_reasons(code),
  ADD COLUMN IF NOT EXISTS archive_note text,
  ADD COLUMN IF NOT EXISTS archive_source text,
  ADD COLUMN IF NOT EXISTS archive_evidence jsonb,
  ADD COLUMN IF NOT EXISTS relisted_at timestamptz;
COMMENT ON TABLE public.property_archive_reasons IS 'SQL76: why a property left the market. status_after is its status after archiving (sold stays sold).';
COMMENT ON COLUMN public.properties.archive_reason IS 'SQL76: property_archive_reasons.code; required while archived (rule added by 76b). Written only by crm_archive_property / archive_property_internal (and the 76b backfill).';
COMMENT ON COLUMN public.properties.archive_source IS 'SQL76: manual (CRM button), agent (reply agent or Claude on Ahmed''s instruction), system (agreement expiry job), backfill (76b).';
COMMENT ON COLUMN public.properties.relisted_at IS 'SQL76: last restore from the archive as a new contract (crm_restore_property). created_at never changes.';

-- 3) Rules. Only the source check here. The two archived-row rules (a reason is required, never «available») are
--    added and validated by 76b once the 18 archived rows have a reason (see the header).
DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.properties'::regclass AND conname = 'properties_archive_source_chk') THEN
    ALTER TABLE public.properties ADD CONSTRAINT properties_archive_source_chk
      CHECK (archive_source IS NULL OR archive_source IN ('manual', 'agent', 'system', 'backfill'));
  END IF;
END
$constraints$;

-- 4) History. Read follows company and branch access (and owner-only investment isolation); no client writes.
CREATE TABLE IF NOT EXISTS public.property_archive_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('archive', 'restore', 'reason_set')),
  reason text REFERENCES public.property_archive_reasons(code),
  note text,
  source text NOT NULL CHECK (source IN ('manual', 'agent', 'system', 'backfill')),
  status_before text,
  status_after text,
  forced boolean NOT NULL DEFAULT false,
  agreement jsonb,
  evidence jsonb,
  actor uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS property_archive_events_property_idx ON public.property_archive_events (property_id, occurred_at DESC);
COMMENT ON TABLE public.property_archive_events IS 'SQL76: append-only archive history (archive / restore / reason_set). occurred_at is when it happened (76b: the original archived_at), recorded_at when it was written.';
ALTER TABLE public.property_archive_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS property_archive_events_read ON public.property_archive_events;
CREATE POLICY property_archive_events_read ON public.property_archive_events FOR SELECT TO authenticated
  USING (company_id = (SELECT public.my_company())
         AND EXISTS (SELECT 1 FROM public.properties p
                      WHERE p.id = property_archive_events.property_id AND p.company_id = property_archive_events.company_id
                        AND crm_repair_private.staff_can_access_branch(p.company_id, p.branch_key)));
DROP POLICY IF EXISTS investment_owner_only ON public.property_archive_events;
CREATE POLICY investment_owner_only ON public.property_archive_events AS RESTRICTIVE FOR ALL TO authenticated
  USING (crm_repair_private.investment_row_allowed(company_id, to_jsonb(property_archive_events.*)))
  WITH CHECK (crm_repair_private.investment_row_allowed(company_id, to_jsonb(property_archive_events.*)));
REVOKE ALL ON public.property_archive_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.property_archive_events TO authenticated;

-- 5) Direct client writes of the archive columns are refused: archiving and restoring go through the RPCs below.
--    SECURITY INVOKER on purpose: current_user is the role running the write, so a write made inside the
--    SECURITY DEFINER RPCs (current_user = their owner) passes and a PostgREST update by a CRM user does not.
CREATE OR REPLACE FUNCTION crm_repair_private.guard_property_archive_columns()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN new; END IF;
  IF TG_OP = 'INSERT' THEN
    IF coalesce(new.archived, false) OR new.archived_at IS NOT NULL OR new.archived_by IS NOT NULL
       OR new.archive_reason IS NOT NULL OR new.archive_note IS NOT NULL OR new.archive_source IS NOT NULL
       OR new.archive_evidence IS NOT NULL OR new.relisted_at IS NOT NULL THEN
      RAISE EXCEPTION 'property_archive_use_rpc' USING ERRCODE = '42501';
    END IF;
  ELSIF new.archived IS DISTINCT FROM old.archived OR new.archived_at IS DISTINCT FROM old.archived_at
     OR new.archived_by IS DISTINCT FROM old.archived_by OR new.archive_reason IS DISTINCT FROM old.archive_reason
     OR new.archive_note IS DISTINCT FROM old.archive_note OR new.archive_source IS DISTINCT FROM old.archive_source
     OR new.archive_evidence IS DISTINCT FROM old.archive_evidence OR new.relisted_at IS DISTINCT FROM old.relisted_at THEN
    RAISE EXCEPTION 'property_archive_use_rpc' USING ERRCODE = '42501';
  END IF;
  RETURN new;
END
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.guard_property_archive_columns() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS crm_guard_property_archive ON public.properties;
CREATE TRIGGER crm_guard_property_archive
  BEFORE INSERT OR UPDATE OF archived, archived_at, archived_by, archive_reason, archive_note, archive_source, archive_evidence, relisted_at
  ON public.properties FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_property_archive_columns();

-- 6) The CRM reads properties through this view: the five columns are appended at the end, nothing else changes.
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
    t.relisted_at
   FROM public.properties t
  WHERE t.company_id = public.my_company() AND crm_repair_private.investment_row_allowed(t.company_id, to_jsonb(t.*)) AND crm_repair_private.staff_can_access_branch(t.company_id, t.branch_key);
GRANT SELECT (archive_reason, archive_note, archive_source, archive_evidence, relisted_at) ON public.properties TO authenticated;

-- 7) Archive state of one property: open deals (not lost/closed and not merged), the active-deal rule and the
--    viewings still coming (scheduled, confirmed or postponed, from today in Muscat).
CREATE OR REPLACE FUNCTION crm_repair_private.property_archive_state(p_property uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH p AS (
    SELECT t.id, t.company_id, t.status, coalesce(t.archived, false) AS archived, t.archive_reason
      FROM public.properties t
     WHERE t.id = p_property
  ), open_deals AS (
    SELECT d.id, d.stage, d.created_at
      FROM public.deals d
      JOIN p ON d.property_id = p.id AND d.company_id = p.company_id
     WHERE d.stage NOT IN ('lost', 'closed', 'commission_collected')
       AND (to_jsonb(d) ->> 'merged_into_deal_id') IS NULL
  )
  SELECT jsonb_build_object(
           'property_id', p.id,
           'status', p.status,
           'archived', p.archived,
           'archive_reason', p.archive_reason,
           'open_deals', coalesce((SELECT jsonb_agg(jsonb_build_object('id', o.id, 'stage', o.stage) ORDER BY o.created_at, o.id) FROM open_deals o), '[]'::jsonb),
           'active_deal', coalesce(p.status, '') IN ('reserved', 'deposit', 'negotiating')
                          OR EXISTS (SELECT 1 FROM open_deals o
                                      WHERE o.stage IN ('negotiation', 'deposit', 'awaiting_finance', 'finance_approved', 'awaiting_clearance', 'ownership_transfer')),
           'upcoming_viewings', (SELECT count(*)::integer FROM public.viewings v
                                  WHERE v.property_id = p.id AND v.company_id = p.company_id
                                    AND coalesce(v.archived, false) = false
                                    AND v.status IN ('scheduled', 'confirmed', 'postponed')
                                    AND (v.viewing_date IS NULL OR v.viewing_date >= (now() AT TIME ZONE 'Asia/Muscat')::date)))
    FROM p
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.property_archive_state(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- 8) Who is calling. A CRM user must be an active owner, manager or agent who can see the property (company,
--    branch, owner-only investment). With no user (service role, i.e. the reply agent, or a SQL session acting
--    on Ahmed's instruction) the call is 'backend'.
CREATE OR REPLACE FUNCTION crm_repair_private.property_archive_caller(p_property uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_uid uuid := auth.uid(); v_role text; v_company uuid; v_prop record;
BEGIN
  IF v_uid IS NULL THEN
    IF coalesce(auth.role(), '') = 'service_role' OR session_user NOT IN ('authenticator', 'authenticated', 'anon') THEN
      IF NOT EXISTS (SELECT 1 FROM public.properties t WHERE t.id = p_property) THEN
        RAISE EXCEPTION 'property_not_found' USING ERRCODE = 'P0002';
      END IF;
      RETURN 'backend';
    END IF;
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT pr.role, pr.company_id INTO v_role, v_company FROM public.profiles pr WHERE pr.id = v_uid AND pr.is_active IS TRUE;
  IF v_company IS NULL OR v_role IS NULL OR v_role NOT IN ('owner', 'manager', 'agent') THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;
  SELECT t.company_id, t.branch_key, to_jsonb(t) AS row_data INTO v_prop FROM public.properties t WHERE t.id = p_property;
  IF NOT FOUND OR v_prop.company_id IS DISTINCT FROM v_company
     OR NOT crm_repair_private.staff_can_access_branch(v_company, v_prop.branch_key)
     OR NOT crm_repair_private.investment_row_allowed(v_company, v_prop.row_data) THEN
    RAISE EXCEPTION 'property_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_role;
END
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.property_archive_caller(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- 9) The one archive write. The caller is trusted (EXECUTE is revoked from every API role): the RPC checks the
--    user, the expiry job passes 'system', the agent path 'agent'. Status is set in the same UPDATE as archived.
CREATE OR REPLACE FUNCTION crm_repair_private.archive_property_internal(p_property uuid, p_reason text, p_note text, p_source text, p_evidence jsonb, p_force boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_reason public.property_archive_reasons%ROWTYPE;
  v_prop public.properties%ROWTYPE;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_source text := coalesce(p_source, '');
  v_actor uuid := auth.uid();
  v_force boolean := coalesce(p_force, false);
  v_evidence jsonb;
  v_state jsonb;
  v_active boolean;
  v_forced boolean;
  v_status_after text;
  v_action text;
  v_event uuid;
  v_desc text;
BEGIN
  -- 'manual' is the CRM button, so it always has a signed-in user (crm_archive_property checked who).
  IF v_source NOT IN ('manual', 'agent', 'system') OR (v_source = 'manual' AND v_actor IS NULL) THEN
    RAISE EXCEPTION 'archive_source_invalid' USING ERRCODE = '22023';
  END IF;
  -- Agent and system archives never force; a manual force is the signed-in owner's alone.
  IF v_source <> 'manual' OR public.my_role() IS DISTINCT FROM 'owner' THEN
    v_force := false;
  END IF;
  SELECT * INTO v_reason FROM public.property_archive_reasons r WHERE r.code = p_reason;
  IF NOT FOUND THEN RAISE EXCEPTION 'archive_reason_invalid' USING ERRCODE = '22023'; END IF;
  IF NOT v_reason.manual_selectable THEN RAISE EXCEPTION 'archive_reason_not_selectable' USING ERRCODE = '22023'; END IF;
  IF v_reason.note_required AND v_note IS NULL THEN RAISE EXCEPTION 'archive_note_required' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_prop FROM public.properties t WHERE t.id = p_property FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'property_not_found' USING ERRCODE = 'P0002'; END IF;
  v_action := CASE WHEN coalesce(v_prop.archived, false) THEN 'reason_set' ELSE 'archive' END;
  -- The reason of a property already in the archive changes only with Ahmed (the owner, or Claude/the agent on his
  -- instruction); branch staff archive, they do not rewrite a recorded reason.
  IF v_action = 'reason_set' AND v_source = 'manual' AND public.my_role() IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501';
  END IF;

  v_state := crm_repair_private.property_archive_state(v_prop.id);
  v_active := coalesce((v_state ->> 'active_deal')::boolean, false);
  IF v_active AND NOT v_force THEN
    RETURN jsonb_build_object('ok', false, 'blocked', 'active_deal', 'property_id', v_prop.id, 'status', v_prop.status,
      'status_after', v_prop.status, 'archived', coalesce(v_prop.archived, false), 'archive_reason', v_prop.archive_reason,
      'open_deals', v_state -> 'open_deals', 'upcoming_viewings', v_state -> 'upcoming_viewings');
  END IF;
  v_forced := v_active AND v_force;

  v_status_after := CASE WHEN v_prop.status = 'sold' THEN 'sold' ELSE v_reason.status_after END;
  IF v_action = 'reason_set' AND v_prop.archive_reason IS NOT DISTINCT FROM v_reason.code
     AND v_prop.archive_note IS NOT DISTINCT FROM v_note AND v_prop.status IS NOT DISTINCT FROM v_status_after THEN
    RETURN jsonb_build_object('ok', true, 'unchanged', true, 'action', v_action, 'property_id', v_prop.id,
      'status_after', v_prop.status, 'archive_reason', v_prop.archive_reason, 'label_ar', v_reason.label_ar);
  END IF;

  UPDATE public.properties t SET
    archived = true,
    archived_at = CASE WHEN v_action = 'archive' THEN now() ELSE t.archived_at END,
    archived_by = CASE WHEN v_action = 'archive' THEN v_actor ELSE t.archived_by END,
    status = v_status_after,
    archive_reason = v_reason.code,
    archive_note = v_note,
    archive_source = v_source,
    archive_evidence = p_evidence,
    updated_at = now()
  WHERE t.id = v_prop.id;

  v_evidence := CASE WHEN p_evidence IS NULL THEN '{}'::jsonb
                     WHEN jsonb_typeof(p_evidence) = 'object' THEN p_evidence
                     ELSE jsonb_build_object('value', p_evidence) END
                || jsonb_build_object('open_deals', v_state -> 'open_deals', 'upcoming_viewings', v_state -> 'upcoming_viewings');
  INSERT INTO public.property_archive_events (company_id, property_id, action, reason, note, source, status_before, status_after,
                                              forced, agreement, evidence, actor)
  VALUES (v_prop.company_id, v_prop.id, v_action, v_reason.code, v_note, v_source, v_prop.status, v_status_after, v_forced,
          jsonb_build_object('has_listing_agreement', v_prop.has_listing_agreement, 'start', v_prop.agreement_start_date,
                             'duration_months', v_prop.agreement_duration_months, 'end', v_prop.agreement_end_date),
          v_evidence, v_actor)
  RETURNING id INTO v_event;

  v_desc := CASE WHEN v_action = 'archive' THEN '[archive] أرشفة العقار: ' ELSE '[archive] تحديد سبب الأرشفة: ' END
            || coalesce(v_prop.title, 'عقار') || ' — ' || v_reason.label_ar
            || CASE WHEN v_note IS NOT NULL THEN ' · ' || v_note ELSE '' END
            || CASE WHEN v_forced THEN ' · رغم وجود صفقة نشطة (قرار المالك)' ELSE '' END;
  INSERT INTO public.activities (company_id, user_id, property_id, type, activity_type, description, activity_text,
                                 channel, direction, actor_type, occurred_at, after_data)
  VALUES (v_prop.company_id, v_actor, v_prop.id, 'system', 'system', v_desc, v_desc, 'system', 'internal',
          CASE v_source WHEN 'manual' THEN 'human' WHEN 'agent' THEN 'automated' ELSE 'system' END, now(),
          jsonb_build_object('action_type', 'archive', 'entity_type', 'property', 'entity_id', v_prop.id, 'archive_event_id', v_event,
                             'reason', v_reason.code, 'source', v_source, 'status_before', v_prop.status,
                             'status_after', v_status_after, 'forced', v_forced));

  RETURN jsonb_build_object('ok', true, 'action', v_action, 'property_id', v_prop.id, 'status_before', v_prop.status,
    'status_after', v_status_after, 'archive_reason', v_reason.code, 'label_ar', v_reason.label_ar,
    'forced', v_forced, 'archive_event_id', v_event);
END
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.archive_property_internal(uuid, text, text, text, jsonb, boolean) FROM PUBLIC, anon, authenticated, service_role;

-- 10) RPCs for the CRM (and the service role). The precheck only reads: open deals by stage, the active-deal
--     rule, viewings still coming, and whether this caller may force (owner only).
CREATE OR REPLACE FUNCTION public.crm_property_archive_precheck(p_property uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_role text := crm_repair_private.property_archive_caller(p_property);
BEGIN
  RETURN crm_repair_private.property_archive_state(p_property) || jsonb_build_object('ok', true, 'can_force', v_role = 'owner');
END
$function$;
REVOKE ALL ON FUNCTION public.crm_property_archive_precheck(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_property_archive_precheck(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.crm_archive_property(p_property uuid, p_reason text, p_note text DEFAULT NULL::text, p_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_role text := crm_repair_private.property_archive_caller(p_property);
BEGIN
  IF v_role = 'backend' THEN
    -- The reply agent (service role) or a SQL session acting on Ahmed's instruction: source agent, never forced.
    RETURN crm_repair_private.archive_property_internal(p_property, p_reason, p_note, 'agent', NULL, false);
  END IF;
  RETURN crm_repair_private.archive_property_internal(p_property, p_reason, p_note, 'manual', NULL, v_role = 'owner' AND coalesce(p_force, false));
END
$function$;
REVOKE ALL ON FUNCTION public.crm_archive_property(uuid, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_archive_property(uuid, text, text, boolean) TO authenticated, service_role;

-- Restore = a new contract. Refused while a completed or reservation-stage deal is on the property (the deal
-- guard would refuse «available» anyway). Without an agreement the old one is cleared, so an expired agreement
-- cannot archive the property again the next morning; a new agreement that already ended is refused for the same
-- reason. The monitoring window starts again at the relisting (performance_tracking_started_at only moves forward).
CREATE OR REPLACE FUNCTION public.crm_restore_property(p_property uuid, p_has_agreement boolean DEFAULT false, p_agreement_start date DEFAULT NULL::date, p_duration_months integer DEFAULT NULL::integer, p_price numeric DEFAULT NULL::numeric, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_role text := crm_repair_private.property_archive_caller(p_property);
  v_actor uuid := auth.uid();
  v_source text;
  v_prop public.properties%ROWTYPE;
  v_has boolean := coalesce(p_has_agreement, false);
  v_start date;
  v_months integer;
  v_end date;
  v_price numeric;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_event uuid;
  v_desc text;
BEGIN
  v_source := CASE WHEN v_role = 'backend' THEN 'agent' ELSE 'manual' END;
  IF p_price IS NOT NULL AND p_price <= 0 THEN RAISE EXCEPTION 'price_invalid' USING ERRCODE = '22023'; END IF;
  IF v_has THEN
    v_start := coalesce(p_agreement_start, (now() AT TIME ZONE 'Asia/Muscat')::date);
    v_months := coalesce(p_duration_months, 3);
    IF v_months < 1 OR v_months > 60 THEN RAISE EXCEPTION 'agreement_duration_invalid' USING ERRCODE = '22023'; END IF;
    IF (v_start + make_interval(months => v_months))::date < (now() AT TIME ZONE 'Asia/Muscat')::date THEN
      RAISE EXCEPTION 'agreement_already_ended' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT * INTO v_prop FROM public.properties t WHERE t.id = p_property FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'property_not_found' USING ERRCODE = 'P0002'; END IF;
  IF NOT coalesce(v_prop.archived, false) THEN RAISE EXCEPTION 'property_not_archived' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.deals d WHERE d.property_id = v_prop.id AND d.company_id = v_prop.company_id
               AND d.stage IN ('closed', 'commission_collected')) THEN
    RAISE EXCEPTION 'property_has_completed_deal' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.deals d WHERE d.property_id = v_prop.id AND d.company_id = v_prop.company_id
               AND d.stage IN ('deposit', 'awaiting_finance', 'finance_approved', 'awaiting_clearance', 'ownership_transfer')) THEN
    RAISE EXCEPTION 'property_has_active_reservation' USING ERRCODE = '23514';
  END IF;

  -- trg_normalize_property_listing_agreement computes the end date and reminder days (or clears them).
  UPDATE public.properties t SET
    status = 'available',
    archived = false,
    archived_at = NULL,
    archived_by = NULL,
    archive_reason = NULL,
    archive_note = NULL,
    archive_source = NULL,
    archive_evidence = NULL,
    relisted_at = now(),
    performance_tracking_started_at = greatest(t.performance_tracking_started_at, now()),
    has_listing_agreement = v_has,
    agreement_start_date = v_start,
    agreement_duration_months = v_months,
    agreement_end_date = NULL,
    agreement_reminder_days = NULL,
    price = coalesce(p_price, t.price),
    updated_at = now()
  WHERE t.id = v_prop.id
  RETURNING t.agreement_end_date, t.price INTO v_end, v_price;

  INSERT INTO public.property_archive_events (company_id, property_id, action, reason, note, source, status_before, status_after,
                                              forced, agreement, evidence, actor)
  VALUES (v_prop.company_id, v_prop.id, 'restore', v_prop.archive_reason, v_note, v_source, v_prop.status, 'available', false,
          jsonb_build_object('has_listing_agreement', v_has, 'start', v_start, 'duration_months', v_months, 'end', v_end,
                             'previous', jsonb_build_object('has_listing_agreement', v_prop.has_listing_agreement,
                                                            'start', v_prop.agreement_start_date,
                                                            'duration_months', v_prop.agreement_duration_months,
                                                            'end', v_prop.agreement_end_date)),
          jsonb_build_object('archived_at', v_prop.archived_at, 'archived_by', v_prop.archived_by, 'archive_note', v_prop.archive_note,
                             'archive_source', v_prop.archive_source, 'archive_evidence', v_prop.archive_evidence,
                             'price_before', v_prop.price, 'price_after', v_price,
                             'tracking_started_before', v_prop.performance_tracking_started_at, 'relisted_before', v_prop.relisted_at),
          v_actor)
  RETURNING id INTO v_event;

  v_desc := '[restore] استعادة العقار كعقد جديد: ' || coalesce(v_prop.title, 'عقار')
            || CASE WHEN v_has THEN ' — عقد تسويق من ' || v_start::text || ' إلى ' || coalesce(v_end::text, '؟') ELSE ' — بدون عقد تسويق' END
            || CASE WHEN v_price IS DISTINCT FROM v_prop.price THEN ' — السعر ' || v_price::text ELSE '' END
            || CASE WHEN v_note IS NOT NULL THEN ' · ' || v_note ELSE '' END;
  INSERT INTO public.activities (company_id, user_id, property_id, type, activity_type, description, activity_text,
                                 channel, direction, actor_type, occurred_at, after_data)
  VALUES (v_prop.company_id, v_actor, v_prop.id, 'system', 'system', v_desc, v_desc, 'system', 'internal',
          CASE WHEN v_source = 'manual' THEN 'human' ELSE 'automated' END, now(),
          jsonb_build_object('action_type', 'restore', 'entity_type', 'property', 'entity_id', v_prop.id, 'archive_event_id', v_event,
                             'previous_reason', v_prop.archive_reason, 'source', v_source, 'status_before', v_prop.status,
                             'status_after', 'available', 'agreement_end_date', v_end));

  RETURN jsonb_build_object('ok', true, 'status', 'available', 'property_id', v_prop.id, 'relisted_at', now(),
    'has_listing_agreement', v_has, 'agreement_end_date', v_end, 'price', v_price, 'archive_event_id', v_event);
END
$function$;
REVOKE ALL ON FUNCTION public.crm_restore_property(uuid, boolean, date, integer, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_restore_property(uuid, boolean, date, integer, numeric, text) TO authenticated, service_role;

-- 11) Automatic expiry of the marketing agreement. Each property is handled in its own block so one failure
--     never stops the others. crm_property_alerts (unique kind + ref_id) keeps one owner notification per
--     property and end date (held / archived / error).
CREATE OR REPLACE FUNCTION public.crm_expire_listing_agreements()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Muscat')::date;
  r record;
  v_state jsonb;
  v_res jsonb;
  v_owner uuid;
  v_hold text;
  v_err text;
  v_n integer;
  v_held integer := 0;
  v_archived integer := 0;
  v_alerts integer := 0;
  v_errors jsonb := '[]'::jsonb;
BEGIN
  FOR r IN
    SELECT p.id, p.company_id, coalesce(p.title, 'عقار') AS title, p.agreement_end_date
      FROM public.properties p
     WHERE coalesce(p.archived, false) = false
       AND p.has_listing_agreement IS TRUE
       AND p.agreement_end_date < v_today
       AND p.status = 'available'
     ORDER BY p.agreement_end_date, p.id
  LOOP
    v_owner := crm_repair_private.investment_owner(r.company_id);
    BEGIN
      v_state := crm_repair_private.property_archive_state(r.id);
      IF coalesce((v_state ->> 'active_deal')::boolean, false) OR coalesce((v_state ->> 'upcoming_viewings')::integer, 0) > 0 THEN
        v_held := v_held + 1;
        INSERT INTO public.crm_property_alerts (company_id, kind, ref_id)
        VALUES (r.company_id, 'agreement_expired_held:' || r.agreement_end_date::text, r.id)
        ON CONFLICT (kind, ref_id) DO NOTHING;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        IF v_n > 0 AND v_owner IS NOT NULL THEN
          v_hold := concat_ws(' و',
                      CASE WHEN coalesce((v_state ->> 'active_deal')::boolean, false) THEN 'صفقة نشطة' END,
                      CASE WHEN coalesce((v_state ->> 'upcoming_viewings')::integer, 0) > 0 THEN 'زيارة قادمة' END);
          INSERT INTO public.notifications (user_id, type, is_read, link, title, body)
          VALUES (v_owner, 'property_archive', false, 'properties',
                  'انتهى عقد التسويق وعليه ' || v_hold || ': ' || r.title,
                  'العقد انتهى ' || r.agreement_end_date::text || ' وما انأرشف العقار لأن عليه ' || v_hold
                  || '. قرر: تجدد العقد أو تأرشفه بعد ما تخلص.');
          v_alerts := v_alerts + 1;
        END IF;
      ELSE
        v_res := crm_repair_private.archive_property_internal(r.id, 'contract_expired',
                   'انتهى عقد التسويق ' || r.agreement_end_date::text || ' بدون صفقة نشطة', 'system',
                   jsonb_build_object('agreement_end_date', r.agreement_end_date, 'checked_on', v_today,
                                      'job', 'crm_expire_listing_agreements'), false);
        IF coalesce((v_res ->> 'ok')::boolean, false) THEN
          v_archived := v_archived + 1;
          INSERT INTO public.crm_property_alerts (company_id, kind, ref_id)
          VALUES (r.company_id, 'agreement_expired_archived:' || r.agreement_end_date::text, r.id)
          ON CONFLICT (kind, ref_id) DO NOTHING;
          GET DIAGNOSTICS v_n = ROW_COUNT;
          IF v_n > 0 AND v_owner IS NOT NULL THEN
            INSERT INTO public.notifications (user_id, type, is_read, link, title, body)
            VALUES (v_owner, 'property_archive', false, 'properties',
                    'انتهى عقد التسويق وانأرشف: ' || r.title,
                    'العقد انتهى ' || r.agreement_end_date::text
                    || ' وما عليه صفقة نشطة ولا زيارة قادمة، فانأرشف تلقائياً بسبب «انتهى عقد التسويق». الاستعادة تكون كعقد جديد.');
            v_alerts := v_alerts + 1;
          END IF;
        ELSE
          -- An active deal appeared under the row lock: held, and the next run notifies.
          v_held := v_held + 1;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
      v_errors := v_errors || jsonb_build_array(jsonb_build_object('property_id', r.id, 'error', v_err));
      BEGIN
        INSERT INTO public.crm_property_alerts (company_id, kind, ref_id)
        VALUES (r.company_id, 'agreement_expired_error:' || r.agreement_end_date::text, r.id)
        ON CONFLICT (kind, ref_id) DO NOTHING;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        IF v_n > 0 AND v_owner IS NOT NULL THEN
          INSERT INTO public.notifications (user_id, type, is_read, link, title, body)
          VALUES (v_owner, 'property_archive', false, 'properties',
                  'تعذرت أرشفة عقار انتهى عقده: ' || r.title, left(v_err, 300));
        END IF;
      EXCEPTION WHEN OTHERS THEN
        NULL;
      END;
    END;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'today', v_today, 'archived', v_archived, 'held', v_held,
                            'alerts', v_alerts, 'errors', v_errors);
END
$function$;
REVOKE ALL ON FUNCTION public.crm_expire_listing_agreements() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_expire_listing_agreements() TO service_role;

-- 12) Daily at 06:00 UTC (10:00 Muscat, after crm_close_stale_visit_deals at 05:40). Applying twice is safe:
--     an existing job (even one paused on purpose) is left as it is.
DO $cron$
BEGIN
  IF to_regnamespace('cron') IS NULL THEN
    RAISE NOTICE 'SQL76: pg_cron is not installed, crm_expire_listing_agreements is not scheduled';
  ELSIF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'crm_expire_listing_agreements_daily') THEN
    PERFORM cron.schedule('crm_expire_listing_agreements_daily', '0 6 * * *', 'select public.crm_expire_listing_agreements()');
  END IF;
END
$cron$;

NOTIFY pgrst, 'reload schema';
