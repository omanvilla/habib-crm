-- SQL97 (12 Nov 2026, Ahmed): a unit sold or booked out of a group of similar units. On 11 Nov «فيلا رضوان الصومحان جنوب 69-1»
-- was sold and 35 customers were about to be told «انحجزت، تحب تشوف خيارات ثانية ؟» although units 2 and 3 (same owner, same
-- specifications) were available. From now on:
--   1. A group = same company, branch, owner, area and kind of property (villa / house / twin count as one), same purpose,
--      and near specifications: land, built size and price within 10 percent, bedrooms within one.
--   2. crm_unit_group_notice(property) gives the sentence every sender uses («انحجزت وحدة منها والمتبقي الثانية والثالثة», or,
--      when the units differ, which one went and which one is left with what distinguishes it). NULL = no unit left, so the
--      old message and the nearest alternative (R6) stay.
--   3. properties.unit_label: the name a customer knows the unit by («الكورنر»، «الوسطية»، «الثانية»). Empty = the number at
--      the end of the title («69 -2» is «الثانية»).
--   4. When a unit becomes reserved or sold and a unit of its group is available, the active requests, the visits not yet done
--      and the open cards still at the visit move to the available unit instead of being closed (trigger
--      crm_a_move_to_remaining_unit, which runs before crm_close_deals_on_property_unavailable). Never moved: a done visit,
--      a card at negotiation or later, a card with a booking or a deposit, a historical or merged card, anything of a client
--      who holds such a card on the unit (the buyer), and a card of a client who already has one on the remaining unit.
--   5. client_stage on the two follow-up tables: where the client stands, written by the follow-up review (R39).
--   6. The view crm_properties_access (what the CRM screens read) carries unit_label at its end.
-- Nothing existing is replaced but that view (one column appended). Rollback: 97-unit-groups.rollback.sql
SET LOCAL lock_timeout = '10s';

ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS unit_label text;
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_unit_label_chk;
ALTER TABLE public.properties ADD CONSTRAINT properties_unit_label_chk CHECK (unit_label IS NULL OR char_length(unit_label) <= 60);
GRANT SELECT, INSERT, UPDATE (unit_label) ON public.properties TO authenticated;
ALTER TABLE public.whatsapp_outreach_queue ADD COLUMN IF NOT EXISTS client_stage text;
ALTER TABLE public.whatsapp_visit_followups ADD COLUMN IF NOT EXISTS client_stage text;

-- villa, twin villa, house and townhouse are one kind for a buyer (brain.ts: «بيت وفيلا ومنزل نفس الشي»)
CREATE OR REPLACE FUNCTION crm_repair_private.unit_type_family(p_type text)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO ''
AS $function$
  SELECT CASE WHEN lower(coalesce(p_type, '')) IN ('villa', 'twin_villa', 'house', 'townhouse') THEN 'home'
              WHEN lower(coalesce(p_type, '')) IN ('land', 'land_residential') THEN 'land'
              ELSE lower(coalesce(p_type, '')) END
$function$;

-- «الصومحان الجنوبية»، «صومحان الجنوبيه» and «بركاء الصومحان الجنوبية» are one area
CREATE OR REPLACE FUNCTION crm_repair_private.unit_area_key(p_area text)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO ''
AS $function$
  SELECT btrim(regexp_replace(regexp_replace(regexp_replace(
           translate(lower(btrim(coalesce(p_area, ''))), 'ةأإآى', 'هاااي'),
           '^(بركاء|بركا|مسقط)\s+', ''), '(^|\s)ال', '\1', 'g'), '\s+', ' ', 'g'))
$function$;

-- two figures are near when both are known and within 10 percent; an unknown figure does not separate two units
CREATE OR REPLACE FUNCTION crm_repair_private.unit_near(a numeric, b numeric)
 RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO ''
AS $function$
  SELECT CASE WHEN coalesce(a, 0) <= 0 OR coalesce(b, 0) <= 0 THEN true
              ELSE abs(a - b) <= 0.10 * greatest(a, b) END
$function$;

-- the unit's number when the title ends with «-2» / «- 2» (never a bare price such as «… 69»)
CREATE OR REPLACE FUNCTION crm_repair_private.unit_ordinal(p_title text)
 RETURNS integer LANGUAGE sql IMMUTABLE SET search_path TO ''
AS $function$
  SELECT nullif((regexp_match(btrim(coalesce(p_title, '')), '[-–]\s*([0-9]{1,2})\s*$'))[1], '')::integer
$function$;

CREATE OR REPLACE FUNCTION crm_repair_private.unit_name(p_label text, p_title text)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO ''
AS $function$
  SELECT coalesce(nullif(btrim(coalesce(p_label, '')), ''),
    (ARRAY['الاولى','الثانية','الثالثة','الرابعة','الخامسة','السادسة','السابعة','الثامنة','التاسعة','العاشرة'])[crm_repair_private.unit_ordinal(p_title)])
$function$;

-- the available units of the same group, the lowest unit number first
CREATE OR REPLACE FUNCTION crm_repair_private.unit_siblings(p_property uuid)
 RETURNS SETOF public.properties LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  SELECT s.*
    FROM public.properties p
    JOIN public.properties s
      ON s.company_id = p.company_id AND s.id <> p.id
     AND s.owner_id IS NOT NULL AND s.owner_id = p.owner_id
     AND coalesce(s.branch_key, '') = coalesce(p.branch_key, '')
     AND coalesce(s.listing_purpose, 'sale') = coalesce(p.listing_purpose, 'sale')
     AND crm_repair_private.unit_type_family(s.type) = crm_repair_private.unit_type_family(p.type)
     AND crm_repair_private.unit_area_key(s.area) <> ''
     AND crm_repair_private.unit_area_key(s.area) = crm_repair_private.unit_area_key(p.area)
     AND coalesce(s.price, 0) > 0 AND coalesce(p.price, 0) > 0
     AND crm_repair_private.unit_near(s.price, p.price)
     AND crm_repair_private.unit_near(s.land_size, p.land_size)
     AND crm_repair_private.unit_near(s.built_size, p.built_size)
     AND (s.bedrooms IS NULL OR p.bedrooms IS NULL OR abs(s.bedrooms - p.bedrooms) <= 1)
   WHERE p.id = p_property
     AND s.status = 'available' AND coalesce(s.archived, false) = false
     AND coalesce(to_jsonb(s) ->> 'archive_reason', '') NOT IN ('duplicate', 'test_record')
   ORDER BY crm_repair_private.unit_ordinal(s.title) NULLS LAST, s.title, s.id
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.unit_siblings(uuid) FROM PUBLIC, anon, authenticated;

-- The sentence for the customer. NULL when no unit of the group is available.
CREATE OR REPLACE FUNCTION crm_repair_private.unit_group_notice(p_property uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  p public.properties%rowtype;
  s public.properties%rowtype;
  v_of text;
  v_n integer := 0;
  v_named integer := 0;
  v_custom boolean;
  v_differs boolean := false;
  v_ids uuid[] := '{}';
  v_titles text[] := '{}';
  v_names text[] := '{}';
  v_descs text[] := '{}';
  v_feats text[];
  v_name text;
  v_rest text;
  v_line text;
  v_identical boolean;
BEGIN
  SELECT * INTO p FROM public.properties WHERE id = p_property;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_of := CASE WHEN lower(coalesce(p.type, '')) IN ('house', 'chalet', 'building', 'penthouse', 'office', 'shop', 'warehouse', 'other')
               THEN 'منه' ELSE 'منها' END;
  v_custom := nullif(btrim(coalesce(p.unit_label, '')), '') IS NOT NULL;
  FOR s IN SELECT * FROM crm_repair_private.unit_siblings(p_property) LOOP
    v_n := v_n + 1;
    v_ids := v_ids || s.id;
    v_titles := v_titles || coalesce(s.title, '');
    IF nullif(btrim(coalesce(s.unit_label, '')), '') IS NOT NULL THEN v_custom := true; END IF;
    v_name := crm_repair_private.unit_name(s.unit_label, s.title);
    IF v_name IS NOT NULL THEN v_named := v_named + 1; END IF;
    v_feats := '{}';
    IF coalesce(s.land_size, 0) > 0 AND coalesce(p.land_size, 0) > 0 AND round(s.land_size) <> round(p.land_size) THEN
      v_feats := v_feats || ('ارضها ' || round(s.land_size)::text || ' م²');
    END IF;
    IF coalesce(s.built_size, 0) > 0 AND coalesce(p.built_size, 0) > 0 AND round(s.built_size) <> round(p.built_size) THEN
      v_feats := v_feats || ('بناءها ' || round(s.built_size)::text || ' م²');
    END IF;
    IF s.bedrooms IS NOT NULL AND p.bedrooms IS NOT NULL AND s.bedrooms <> p.bedrooms THEN
      v_feats := v_feats || (s.bedrooms::text || ' غرف');
    END IF;
    IF round(s.price) <> round(p.price) THEN
      v_feats := v_feats || ('بـ ' || CASE WHEN s.price >= 1000 THEN trim(trailing '.' FROM trim(trailing '0' FROM round(s.price / 1000, 1)::text)) || ' الف'
                                           ELSE round(s.price)::text END);
    END IF;
    IF cardinality(v_feats) > 0 THEN v_differs := true; END IF;
    v_names := v_names || coalesce(v_name, '');
    v_descs := v_descs || btrim(coalesce(v_name, 'وحدة') || ' ' || array_to_string(v_feats, ' '));
  END LOOP;
  IF v_n = 0 THEN RETURN NULL; END IF;

  v_identical := NOT v_custom AND NOT v_differs;
  IF v_identical THEN
    v_rest := CASE WHEN v_named = v_n THEN array_to_string(v_names, ' و')
                   WHEN v_n = 1 THEN 'وحدة بنفس المواصفات'
                   WHEN v_n = 2 THEN 'وحدتين بنفس المواصفات'
                   ELSE v_n::text || ' وحدات بنفس المواصفات' END;
    v_line := 'انحجزت وحدة ' || v_of || ' والمتبقي ' || v_rest;
  ELSE
    v_rest := array_to_string(v_descs, ' و');
    v_line := CASE WHEN nullif(btrim(coalesce(p.unit_label, '')), '') IS NOT NULL AND v_named = v_n
                   THEN 'انحجزت ' || btrim(p.unit_label) || ' و' || v_rest || ' لين الحين ' || CASE WHEN v_n = 1 THEN 'متاحة' ELSE 'متاحات' END
                   ELSE 'انحجزت وحدة ' || v_of || ' والمتبقي ' || v_rest END;
  END IF;
  RETURN jsonb_build_object(
    'property_id', p.id, 'title', p.title, 'identical', v_identical, 'count', v_n,
    'line', v_line, 'remaining_text', v_rest,
    'target', v_ids[1], 'remaining_ids', to_jsonb(v_ids), 'remaining_titles', to_jsonb(v_titles));
END
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.unit_group_notice(uuid) FROM PUBLIC, anon, authenticated;

-- for the edge functions (service role only): one property
CREATE OR REPLACE FUNCTION public.crm_unit_group_notice(p_property uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$ SELECT crm_repair_private.unit_group_notice(p_property) $function$;
REVOKE ALL ON FUNCTION public.crm_unit_group_notice(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_unit_group_notice(uuid) TO service_role;

-- for the reply agent and the follow-up review (service role only): every unit sold or booked in the last 150 days that still
-- has an available unit of its group
CREATE OR REPLACE FUNCTION public.crm_unit_groups(p_company uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
  SELECT coalesce(jsonb_agg(x.n || jsonb_build_object('status', x.status, 'type', x.type, 'area', x.area, 'price', x.price)
                            ORDER BY x.updated_at DESC), '[]'::jsonb)
    FROM (SELECT p.status, p.type, p.area, p.price, p.updated_at, crm_repair_private.unit_group_notice(p.id) AS n
            FROM public.properties p
           WHERE p.company_id = p_company AND p.status IN ('sold', 'reserved')
             AND p.updated_at >= now() - interval '150 days'
             AND coalesce(to_jsonb(p) ->> 'archive_reason', '') NOT IN ('duplicate', 'test_record')
           ORDER BY p.updated_at DESC
           LIMIT 60) x
   WHERE x.n IS NOT NULL
$function$;
REVOKE ALL ON FUNCTION public.crm_unit_groups(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_unit_groups(uuid) TO service_role;

-- Moves what was open on a unit that went to the first available unit of its group. Each card moves in its own
-- sub-transaction, so nothing here can fail the property save. p_apply = false only counts.
CREATE OR REPLACE FUNCTION crm_repair_private.move_to_remaining_unit(p_property uuid, p_source text, p_apply boolean DEFAULT true)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  p public.properties%rowtype;
  t public.properties%rowtype;
  d record;
  v_buyers uuid[];
  v_requests integer := 0;
  v_viewings integer := 0;
  v_deals integer := 0;
  v_kept integer := 0;
  v_owner uuid;
  v_today date := (now() at time zone 'Asia/Muscat')::date;
  v_note text;
  v_claims text := current_setting('request.jwt.claims', true);
  v_sub text := current_setting('request.jwt.claim.sub', true);
BEGIN
  SELECT * INTO p FROM public.properties WHERE id = p_property;
  IF NOT FOUND THEN RETURN jsonb_build_object('property_id', p_property, 'missing', true); END IF;
  SELECT * INTO t FROM crm_repair_private.unit_siblings(p_property) LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('property_id', p.id, 'moved', false, 'why', 'no_available_unit'); END IF;

  -- the buyer and anyone Ahmed is dealing with on this unit keep everything where it is
  SELECT coalesce(array_agg(DISTINCT x.client_id), '{}') INTO v_buyers
    FROM public.deals x
   WHERE x.company_id = p.company_id AND x.property_id = p.id AND x.merged_into_deal_id IS NULL
     AND (x.stage NOT IN ('new', 'viewing_scheduled', 'viewing_no_show', 'viewing_cancelled', 'viewing_postponed', 'visit', 'lost')
          OR (x.stage <> 'lost' AND (x.reservation_confirmed_at IS NOT NULL OR coalesce(x.deposit_amount, 0) <> 0)));

  IF NOT p_apply THEN
    RETURN jsonb_build_object('property_id', p.id, 'target', t.id, 'target_title', t.title, 'moved', false, 'would_move', jsonb_build_object(
      'requests', (SELECT count(*) FROM public.client_requests r WHERE r.company_id = p.company_id AND r.subject_property_id = p.id
                     AND r.status = 'active' AND NOT (r.client_id = ANY (v_buyers))),
      'viewings', (SELECT count(*) FROM public.viewings v WHERE v.company_id = p.company_id AND v.property_id = p.id
                     AND v.status IN ('scheduled', 'confirmed', 'postponed') AND coalesce(v.archived, false) = false AND NOT (v.client_id = ANY (v_buyers))),
      'deals', (SELECT count(*) FROM public.deals x WHERE x.company_id = p.company_id AND x.property_id = p.id AND x.merged_into_deal_id IS NULL
                  AND x.stage IN ('new', 'viewing_scheduled', 'viewing_no_show', 'viewing_cancelled', 'viewing_postponed', 'visit')
                  AND coalesce(x.entry_mode, '') <> 'historical' AND NOT (x.client_id = ANY (v_buyers)))));
  END IF;

  v_note := '[تلقائي ' || to_char(v_today, 'YYYY-MM-DD') || '] ' || coalesce(nullif(btrim(p.title), ''), 'الوحدة')
    || CASE WHEN p.status = 'sold' THEN ' انباعت' ELSE ' انحجزت' END
    || ' وانتقل للوحدة المتبقية من نفس المجموعة: ' || coalesce(nullif(btrim(t.title), ''), 'وحدة متاحة');
  -- the system moves them, not a person (as in SQL77): the caller's login is cleared for the writes and restored after
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  BEGIN
    UPDATE public.client_requests r SET subject_property_id = t.id
     WHERE r.company_id = p.company_id AND r.subject_property_id = p.id AND r.status = 'active'
       AND NOT (r.client_id = ANY (v_buyers));
    GET DIAGNOSTICS v_requests = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'SQL97 requests of % not moved: % %', p.id, sqlstate, sqlerrm;
  END;

  BEGIN
    UPDATE public.viewings v SET property_id = t.id, notes = left(concat_ws(E'\n', nullif(v.notes, ''), v_note), 2000)
     WHERE v.company_id = p.company_id AND v.property_id = p.id
       AND v.status IN ('scheduled', 'confirmed', 'postponed') AND coalesce(v.archived, false) = false
       AND NOT (v.client_id = ANY (v_buyers));
    GET DIAGNOSTICS v_viewings = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'SQL97 viewings of % not moved: % %', p.id, sqlstate, sqlerrm;
  END;

  FOR d IN
    SELECT x.id, x.stage, x.client_id, x.request_id
      FROM public.deals x
     WHERE x.company_id = p.company_id AND x.property_id = p.id AND x.merged_into_deal_id IS NULL
       AND x.stage IN ('new', 'viewing_scheduled', 'viewing_no_show', 'viewing_cancelled', 'viewing_postponed', 'visit')
       AND coalesce(x.entry_mode, '') <> 'historical'
       AND x.reservation_confirmed_at IS NULL AND coalesce(x.deposit_amount, 0) = 0
       AND NOT (x.client_id = ANY (v_buyers))
       AND NOT EXISTS (SELECT 1 FROM public.deposits z WHERE z.deal_id = x.id AND coalesce(z.status, 'active') NOT IN ('cancelled', 'refunded', 'forfeited'))
     ORDER BY x.created_at, x.id
  LOOP
    -- one open card per client and property (SQL77c): a client who already has a card on the remaining unit keeps that one
    IF EXISTS (SELECT 1 FROM public.deals o WHERE o.company_id = p.company_id AND o.client_id = d.client_id AND o.property_id = t.id
                 AND o.merged_into_deal_id IS NULL AND o.stage NOT IN ('lost', 'closed', 'commission_collected')) THEN
      v_kept := v_kept + 1;
      CONTINUE;
    END IF;
    BEGIN
      UPDATE public.deals SET property_id = t.id, updated_at = now()
       WHERE id = d.id AND property_id = p.id AND stage = d.stage AND merged_into_deal_id IS NULL;
      IF FOUND THEN
        INSERT INTO public.activities(company_id, user_id, client_id, deal_id, property_id, request_id, type, activity_type,
          channel, direction, actor_type, description, occurred_at, before_data, after_data)
        VALUES (p.company_id, NULL, d.client_id, d.id, t.id, d.request_id, 'system', 'system',
          'system', 'internal', 'system', v_note, now(),
          jsonb_build_object('property_id', p.id, 'stage', d.stage),
          jsonb_build_object('property_id', t.id, 'stage', d.stage, 'reason', 'unit_group_remaining', 'source', p_source));
        v_deals := v_deals + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_kept := v_kept + 1;
      RAISE WARNING 'SQL97 deal % not moved: % %', d.id, sqlstate, sqlerrm;
    END;
  END LOOP;

  IF v_requests + v_viewings + v_deals > 0 THEN
    BEGIN
      v_owner := crm_repair_private.investment_owner(p.company_id);
      IF v_owner IS NOT NULL THEN
        INSERT INTO public.notifications(user_id, type, is_read, link, title, body)
        VALUES (v_owner, 'system_alert', false, 'dash', 'انحجزت وحدة وانتقل عملاؤها للوحدة المتبقية',
          left(coalesce(nullif(btrim(p.title), ''), 'وحدة') || CASE WHEN p.status = 'sold' THEN ' انباعت' ELSE ' انحجزت' END
            || '، والمتبقي من نفس المجموعة: ' || coalesce(nullif(btrim(t.title), ''), 'وحدة متاحة')
            || '. انتقل لها: ' || v_requests || ' طلب، ' || v_viewings || ' موعد زيارة، ' || v_deals || ' صفقة في مرحلة الزيارة'
            || CASE WHEN v_kept > 0 THEN '. ' || v_kept || ' صفقة ما انتقلت (العميل عنده بطاقة على الوحدة المتبقية أو تعذر النقل)' ELSE '' END, 1500));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'SQL97 owner notification for % failed: %', p.id, sqlerrm;
    END;
  END IF;
  PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  PERFORM set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);

  RETURN jsonb_build_object('property_id', p.id, 'target', t.id, 'target_title', t.title, 'moved', true,
    'requests', v_requests, 'viewings', v_viewings, 'deals', v_deals, 'deals_kept', v_kept);
END
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.move_to_remaining_unit(uuid, text, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION crm_repair_private.move_to_remaining_unit_on_change()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
  IF coalesce(to_jsonb(new) ->> 'archive_reason', '') IN ('duplicate', 'test_record') THEN RETURN NULL; END IF;
  BEGIN
    PERFORM crm_repair_private.move_to_remaining_unit(new.id, 'property_change', true);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'SQL97 move_to_remaining_unit % failed: %', new.id, sqlerrm;
  END;
  RETURN NULL;
END
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.move_to_remaining_unit_on_change() FROM PUBLIC, anon, authenticated;

-- «crm_a_…» sorts before «crm_close_deals_on_property_unavailable», so the cards move before that trigger closes what is left
DROP TRIGGER IF EXISTS crm_a_move_to_remaining_unit ON public.properties;
CREATE TRIGGER crm_a_move_to_remaining_unit AFTER UPDATE OF status, archived ON public.properties
  FOR EACH ROW WHEN (new.status IN ('sold', 'reserved') AND old.status IS DISTINCT FROM new.status)
  EXECUTE FUNCTION crm_repair_private.move_to_remaining_unit_on_change();

-- 6. The CRM reads properties through this view (crm-data adapter): unit_label is appended at the end, nothing else changes.
--    Refused when the live view is not the SQL76 body (a second apply, already carrying unit_label, passes).
DO $guard$
DECLARE v_def text; v_path text := current_setting('search_path');
BEGIN
  PERFORM set_config('search_path', 'public', true);
  v_def := pg_get_viewdef('public.crm_properties_access'::regclass, true);
  PERFORM set_config('search_path', v_path, true);
  IF md5(v_def) <> 'e7530d4663dcda5d66d5b18a71c526da' AND position('unit_label' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SQL97 refused: public.crm_properties_access changed since 12 Nov 2026 (md5 %)', md5(v_def);
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
    t.unit_label
   FROM public.properties t
  WHERE t.company_id = public.my_company() AND crm_repair_private.investment_row_allowed(t.company_id, to_jsonb(t.*)) AND crm_repair_private.staff_can_access_branch(t.company_id, t.branch_key);
