-- SQL62 (5 Nov 2026, owner's instruction): one video can count for identical properties, only after Ahmed says yes.
-- Each identical property gets its own publication row, so its views and inquiries show in its own performance.
-- Saving a link that belongs to another property is still refused, unless the row is an approved twin.
ALTER TABLE public.property_marketing_events ADD COLUMN IF NOT EXISTS twin_of uuid REFERENCES public.property_marketing_events(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS property_marketing_twin_idx ON public.property_marketing_events (twin_of) WHERE twin_of IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.property_twin_dismissals (
  company_id uuid NOT NULL,
  group_key text NOT NULL,
  dismissed_by uuid,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, group_key)
);
ALTER TABLE public.property_twin_dismissals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.property_twin_dismissals FROM PUBLIC, anon, authenticated;

DROP INDEX IF EXISTS public.property_marketing_link_key_unique;
DROP INDEX IF EXISTS public.property_marketing_instagram_media_unique;
CREATE UNIQUE INDEX IF NOT EXISTS property_marketing_property_link_unique ON public.property_marketing_events (company_id, property_id, link_key) WHERE link_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS property_marketing_property_media_unique ON public.property_marketing_events (company_id, property_id, instagram_media_id) WHERE instagram_media_id IS NOT NULL;

CREATE OR REPLACE FUNCTION crm_repair_private.guard_video_one_property()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_family uuid;
BEGIN
  IF new.twin_of IS NOT NULL AND (TG_OP = 'INSERT' OR old.twin_of IS DISTINCT FROM new.twin_of) THEN
    IF auth.uid() IS NOT NULL AND public.my_role() IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'owner_required' USING ERRCODE = '42501'; END IF;
  END IF;
  v_family := coalesce(new.twin_of, new.id);
  IF new.link_key IS NOT NULL AND EXISTS (SELECT 1 FROM public.property_marketing_events x
      WHERE x.company_id = new.company_id AND x.link_key = new.link_key AND x.property_id IS DISTINCT FROM new.property_id AND x.id IS DISTINCT FROM new.id
        AND coalesce(x.twin_of, x.id) IS DISTINCT FROM v_family AND new.twin_of IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', CONSTRAINT = 'property_marketing_link_key_unique', MESSAGE = 'duplicate key value violates unique constraint "property_marketing_link_key_unique"';
  END IF;
  IF new.instagram_media_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.property_marketing_events x
      WHERE x.company_id = new.company_id AND x.instagram_media_id = new.instagram_media_id AND x.property_id IS DISTINCT FROM new.property_id AND x.id IS DISTINCT FROM new.id
        AND coalesce(x.twin_of, x.id) IS DISTINCT FROM v_family AND new.twin_of IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', CONSTRAINT = 'property_marketing_instagram_media_unique', MESSAGE = 'duplicate key value violates unique constraint "property_marketing_instagram_media_unique"';
  END IF;
  RETURN new;
END
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.guard_video_one_property() FROM PUBLIC, anon, authenticated;
-- Named to run after trg_property_marketing_link_identity, which sets link_key.
DROP TRIGGER IF EXISTS zz_guard_video_one_property ON public.property_marketing_events;
CREATE TRIGGER zz_guard_video_one_property BEFORE INSERT OR UPDATE OF link_key, instagram_media_id, twin_of ON public.property_marketing_events
  FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_video_one_property();

-- A client who writes from the video counts for every identical property. A failure here never stops the first one.
CREATE OR REPLACE FUNCTION crm_repair_private.mirror_twin_attribution()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_root uuid; t record; v_at timestamptz;
BEGIN
  IF new.marketing_event_id IS NULL THEN RETURN new; END IF;
  SELECT coalesce(e.twin_of, e.id) INTO v_root FROM public.property_marketing_events e WHERE e.id = new.marketing_event_id;
  IF v_root IS NULL THEN RETURN new; END IF;
  SELECT m.message_timestamp INTO v_at FROM public.whatsapp_messages m WHERE m.id = new.message_id;
  FOR t IN SELECT e.id, e.property_id FROM public.property_marketing_events e WHERE (e.id = v_root OR e.twin_of = v_root) AND e.property_id IS DISTINCT FROM new.property_id LOOP
    BEGIN
      PERFORM public.record_property_link_inquiry_internal(new.company_id, new.client_id, t.property_id, t.id, new.message_id, new.source_url, new.evidence_key, v_at, new.method = 'manual');
    EXCEPTION WHEN others THEN
      RAISE WARNING 'twin attribution skipped: %', SQLERRM;
    END;
  END LOOP;
  RETURN new;
END
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.mirror_twin_attribution() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS crm_mirror_twin_attribution ON public.property_message_attributions;
CREATE TRIGGER crm_mirror_twin_attribution AFTER INSERT ON public.property_message_attributions
  FOR EACH ROW EXECUTE FUNCTION crm_repair_private.mirror_twin_attribution();

-- Adds the video to one more identical property: same publication details, and past inquiries from it count too.
CREATE OR REPLACE FUNCTION crm_repair_private.add_video_twin(p_event uuid, p_property uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE e public.property_marketing_events; v_root uuid; v_new uuid := gen_random_uuid(); a record;
BEGIN
  SELECT * INTO STRICT e FROM public.property_marketing_events WHERE id = p_event;
  v_root := coalesce(e.twin_of, e.id);
  IF NOT EXISTS (SELECT 1 FROM public.properties p WHERE p.id = p_property AND p.company_id = e.company_id) THEN RAISE EXCEPTION 'property_not_found' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.property_marketing_events x WHERE x.company_id = e.company_id AND x.property_id = p_property AND (x.link_key = e.link_key OR x.instagram_media_id = e.instagram_media_id)) THEN RETURN false; END IF;
  INSERT INTO public.property_marketing_events
  SELECT (jsonb_populate_record(e, jsonb_build_object('id', v_new, 'property_id', p_property, 'twin_of', v_root, 'created_at', now(), 'notes', 'نفس فيديو عقار مطابق، بموافقة المالك'))).*;
  FOR a IN SELECT DISTINCT ON (x.message_id) x.message_id, x.client_id, x.source_url, x.evidence_key, x.method, m.message_timestamp
             FROM public.property_message_attributions x
             JOIN public.property_marketing_events f ON f.id = x.marketing_event_id AND (f.id = v_root OR f.twin_of = v_root)
             LEFT JOIN public.whatsapp_messages m ON m.id = x.message_id
            WHERE x.company_id = e.company_id LOOP
    BEGIN
      PERFORM public.record_property_link_inquiry_internal(e.company_id, a.client_id, p_property, v_new, a.message_id, a.source_url, a.evidence_key, a.message_timestamp, a.method = 'manual');
    EXCEPTION WHEN others THEN
      RAISE WARNING 'twin backfill skipped: %', SQLERRM;
    END;
  END LOOP;
  RETURN true;
END
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.add_video_twin(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Identical = same owner, land, built size, bedrooms and price, on the market and not archived.
CREATE OR REPLACE FUNCTION public.crm_property_twins()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_company uuid := public.my_company();
BEGIN
  IF public.my_role() IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'owner_only' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(g) FROM (
    SELECT jsonb_build_object(
      'key', string_agg(p.id::text, ',' ORDER BY p.id),
      'properties', jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title,
          'videos', (SELECT count(*) FROM public.property_marketing_events e WHERE e.property_id = p.id AND e.link_key IS NOT NULL)) ORDER BY p.title),
      'videos', (SELECT count(DISTINCT e.link_key) FROM public.property_marketing_events e WHERE e.company_id = v_company AND e.link_key IS NOT NULL AND e.property_id = ANY (array_agg(p.id))),
      'dismissed', EXISTS (SELECT 1 FROM public.property_twin_dismissals d WHERE d.company_id = v_company AND d.group_key = string_agg(p.id::text, ',' ORDER BY p.id))
    ) AS g
      FROM public.properties p
     WHERE p.company_id = v_company AND coalesce(p.archived, false) = false AND p.status IN ('available','reserved')
       AND p.owner_id IS NOT NULL AND p.land_size > 0 AND p.price > 0
     GROUP BY p.owner_id, p.land_size, p.built_size, p.bedrooms, p.price
    HAVING count(*) > 1) s), '[]'::jsonb);
END
$function$;
REVOKE ALL ON FUNCTION public.crm_property_twins() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_property_twins() TO authenticated;

-- Ahmed said yes: every video on any of these properties goes on all of them.
CREATE OR REPLACE FUNCTION public.crm_link_twin_group(p_properties uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_company uuid := public.my_company(); v_specs bigint; e record; t uuid; n integer := 0;
BEGIN
  IF public.my_role() IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'owner_required' USING ERRCODE = '42501'; END IF;
  SELECT count(DISTINCT (p.owner_id, p.land_size, p.built_size, p.bedrooms, p.price)) INTO v_specs FROM public.properties p WHERE p.id = ANY (p_properties) AND p.company_id = v_company;
  IF v_specs <> 1 OR coalesce(array_length(p_properties, 1), 0) < 2 THEN RAISE EXCEPTION 'properties_not_identical' USING ERRCODE = '22023'; END IF;
  FOR e IN SELECT DISTINCT ON (x.link_key) x.id, x.link_key FROM public.property_marketing_events x
            WHERE x.company_id = v_company AND x.property_id = ANY (p_properties) AND x.link_key IS NOT NULL ORDER BY x.link_key, x.twin_of NULLS FIRST LOOP
    FOREACH t IN ARRAY p_properties LOOP
      IF crm_repair_private.add_video_twin(e.id, t) THEN n := n + 1; END IF;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('added', n);
END
$function$;
REVOKE ALL ON FUNCTION public.crm_link_twin_group(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_link_twin_group(uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_dismiss_twin_group(p_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF public.my_role() IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'owner_required' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.property_twin_dismissals (company_id, group_key, dismissed_by) VALUES (public.my_company(), p_key, auth.uid()) ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('ok', true);
END
$function$;
REVOKE ALL ON FUNCTION public.crm_dismiss_twin_group(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_dismiss_twin_group(text) TO authenticated;

-- A new video from the card: link to the chosen property as usual, then to its identical ones.
CREATE OR REPLACE FUNCTION public.crm_instagram_link_twins(p_id uuid, p_expected timestamptz, p_properties uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_company uuid := public.my_company(); v_specs bigint; v_saved jsonb; v_event uuid; t uuid; n integer := 0;
BEGIN
  IF public.my_role() IS DISTINCT FROM 'owner' OR NOT EXISTS (SELECT 1 FROM public.instagram_media_catalog WHERE id = p_id AND company_id = v_company) THEN
    RAISE EXCEPTION 'owner_required' USING ERRCODE = '42501';
  END IF;
  SELECT count(DISTINCT (p.owner_id, p.land_size, p.built_size, p.bedrooms, p.price)) INTO v_specs FROM public.properties p WHERE p.id = ANY (p_properties) AND p.company_id = v_company;
  IF v_specs <> 1 OR coalesce(array_length(p_properties, 1), 0) < 2 THEN RAISE EXCEPTION 'properties_not_identical' USING ERRCODE = '22023'; END IF;
  v_saved := crm_repair_private.instagram_decide(p_id, p_expected, 'link', p_properties[1], NULL, 'owner_review', '{"source":"crm_review","twins":true}'::jsonb, auth.uid());
  v_event := (v_saved->>'event_id')::uuid;
  FOREACH t IN ARRAY p_properties[2:] LOOP
    IF crm_repair_private.add_video_twin(v_event, t) THEN n := n + 1; END IF;
  END LOOP;
  RETURN v_saved || jsonb_build_object('twins_added', n);
END
$function$;
REVOKE ALL ON FUNCTION public.crm_instagram_link_twins(uuid, timestamptz, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_instagram_link_twins(uuid, timestamptz, uuid[]) TO authenticated;
