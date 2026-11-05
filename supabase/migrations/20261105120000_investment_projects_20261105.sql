-- SQL61 (5 Nov 2026): investment projects. Owner only, like all investment work.
-- A video can belong to a project. A video that is also about one property stays linked to it.
CREATE TABLE IF NOT EXISTS public.investment_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  developer text,
  area text,
  aliases text[] NOT NULL DEFAULT '{}',
  notes text,
  archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);
ALTER TABLE public.investment_projects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.investment_projects FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.investment_projects TO authenticated;
CREATE POLICY investment_projects_owner_read ON public.investment_projects FOR SELECT TO authenticated
  USING (company_id = (SELECT public.my_company()) AND (SELECT public.my_role()) = 'owner');
CREATE POLICY investment_projects_owner_insert ON public.investment_projects FOR INSERT TO authenticated
  WITH CHECK (company_id = (SELECT public.my_company()) AND (SELECT public.my_role()) = 'owner');
CREATE POLICY investment_projects_owner_update ON public.investment_projects FOR UPDATE TO authenticated
  USING (company_id = (SELECT public.my_company()) AND (SELECT public.my_role()) = 'owner')
  WITH CHECK (company_id = (SELECT public.my_company()) AND (SELECT public.my_role()) = 'owner');

INSERT INTO public.investment_projects (company_id, name, developer, aliases)
SELECT DISTINCT p.company_id, s.name, s.developer, s.aliases
  FROM public.profiles p
 CROSS JOIN (VALUES
   ('مدينة السلطان هيثم', 'الأهلي صبور', ARRAY['مدينة السلطان هيثم','مدينة هيثم','وادي زها']),
   ('اليزن', 'VA Group', ARRAY['اليزن','alyazan','al yazan']),
   ('عايدة', 'دار جلوبال', ARRAY['عايدة','aida'])
 ) AS s(name, developer, aliases)
 WHERE p.role = 'owner'
ON CONFLICT (company_id, name) DO NOTHING;

ALTER TABLE public.instagram_media_catalog ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.investment_projects(id);
CREATE INDEX IF NOT EXISTS instagram_media_catalog_project_idx ON public.instagram_media_catalog (project_id) WHERE project_id IS NOT NULL;
ALTER TABLE public.instagram_media_catalog DROP CONSTRAINT IF EXISTS instagram_media_catalog_state_check;
ALTER TABLE public.instagram_media_catalog ADD CONSTRAINT instagram_media_catalog_state_check
  CHECK (state = ANY (ARRAY['pending','linked','needs_review','non_property','project']));

-- One place that changes a video's project, with the same version check and audit as property decisions.
CREATE OR REPLACE FUNCTION crm_repair_private.instagram_set_project(p_id uuid, p_expected timestamptz, p_project uuid, p_reason text, p_evidence jsonb, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE c public.instagram_media_catalog; before_row jsonb;
BEGIN
  SELECT * INTO STRICT c FROM public.instagram_media_catalog WHERE id = p_id FOR UPDATE;
  IF c.updated_at IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'stale_media' USING ERRCODE = '40001'; END IF;
  -- The scan never overrides a decision Ahmed made, or a video already linked to a property.
  IF p_actor IS NULL AND (c.reviewed_at IS NOT NULL OR c.state = 'linked') THEN RETURN jsonb_build_object('state', c.state, 'preserved', true); END IF;
  IF p_project IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.investment_projects x WHERE x.id = p_project AND x.company_id = c.company_id AND NOT x.archived) THEN
    RAISE EXCEPTION 'project_not_found' USING ERRCODE = '22023';
  END IF;
  before_row := to_jsonb(c);
  UPDATE public.instagram_media_catalog SET project_id = p_project,
         state = CASE WHEN state = 'linked' THEN 'linked' WHEN p_project IS NULL THEN 'needs_review' ELSE 'project' END,
         reason_code = CASE WHEN state = 'linked' THEN reason_code ELSE p_reason END,
         evidence = CASE WHEN state = 'linked' THEN evidence ELSE p_evidence END,
         reviewed_by = coalesce(p_actor, reviewed_by),
         reviewed_at = CASE WHEN p_actor IS NOT NULL THEN now() ELSE reviewed_at END,
         updated_at = now()
   WHERE id = c.id RETURNING * INTO c;
  INSERT INTO crm_repair_private.instagram_discovery_audit (catalog_id, company_id, actor_id, action, before_data, after_data)
  VALUES (c.id, c.company_id, p_actor, 'project', jsonb_build_object('catalog', before_row), jsonb_build_object('catalog', to_jsonb(c)));
  RETURN jsonb_build_object('state', c.state, 'project_id', c.project_id);
END
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.instagram_set_project(uuid, timestamptz, uuid, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.crm_instagram_link_project(p_id uuid, p_expected timestamptz, p_project uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF public.my_role() IS DISTINCT FROM 'owner' OR NOT EXISTS (SELECT 1 FROM public.instagram_media_catalog WHERE id = p_id AND company_id = public.my_company()) THEN
    RAISE EXCEPTION 'owner_required' USING ERRCODE = '42501';
  END IF;
  RETURN crm_repair_private.instagram_set_project(p_id, p_expected, p_project, 'owner_review', '{"source":"crm_review"}'::jsonb, auth.uid());
END
$function$;
REVOKE ALL ON FUNCTION public.crm_instagram_link_project(uuid, timestamptz, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_instagram_link_project(uuid, timestamptz, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_instagram_auto_link_project(p_id uuid, p_expected timestamptz, p_project uuid, p_reason text, p_evidence jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF current_setting('role', true) <> 'service_role' THEN RAISE EXCEPTION 'service_required' USING ERRCODE = '42501'; END IF;
  RETURN crm_repair_private.instagram_set_project(p_id, p_expected, p_project, p_reason, p_evidence, NULL);
END
$function$;
REVOKE ALL ON FUNCTION public.crm_instagram_auto_link_project(uuid, timestamptz, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_instagram_auto_link_project(uuid, timestamptz, uuid, text, jsonb) TO service_role;

-- Add a video to a project from its link, when the scan already knows the video.
CREATE OR REPLACE FUNCTION public.crm_project_add_video(p_project uuid, p_link text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE k text; c public.instagram_media_catalog;
BEGIN
  IF public.my_role() IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'owner_required' USING ERRCODE = '42501'; END IF;
  k := public.normalize_property_marketing_link(p_link);
  IF k IS NULL OR k NOT LIKE 'instagram:%' THEN RAISE EXCEPTION 'invalid_link' USING ERRCODE = '22023'; END IF;
  SELECT * INTO c FROM public.instagram_media_catalog WHERE company_id = public.my_company() AND link_key = k LIMIT 1;
  IF c.id IS NULL THEN RAISE EXCEPTION 'video_not_found' USING ERRCODE = '22023'; END IF;
  RETURN crm_repair_private.instagram_set_project(c.id, c.updated_at, p_project, 'owner_review', '{"source":"project_page"}'::jsonb, auth.uid());
END
$function$;
REVOKE ALL ON FUNCTION public.crm_project_add_video(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_project_add_video(uuid, text) TO authenticated;

-- The projects page: each project, its videos, and the clients who wrote to us from one of them.
CREATE OR REPLACE FUNCTION public.crm_investment_projects()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_company uuid := public.my_company();
BEGIN
  IF public.my_role() IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'owner_only' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id', x.id, 'name', x.name, 'developer', x.developer, 'area', x.area, 'aliases', x.aliases, 'notes', x.notes,
      'videos', coalesce((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'permalink', m.permalink, 'caption', left(m.caption, 300), 'published_at', m.published_at,
                  'thumbnail_url', m.thumbnail_url, 'updated_at', m.updated_at, 'likes', m.likes, 'comments', m.comments) ORDER BY m.published_at DESC)
                FROM public.instagram_media_catalog m WHERE m.project_id = x.id), '[]'::jsonb),
      'clients', coalesce((SELECT jsonb_agg(jsonb_build_object('id', l.client_id, 'name', l.name, 'at', l.at) ORDER BY l.at DESC) FROM (
                  SELECT w.client_id, max(cl.name) AS name, max(w.message_timestamp) AS at
                    FROM public.instagram_media_catalog m
                    JOIN public.whatsapp_messages w ON w.company_id = m.company_id AND w.direction = 'inbound' AND w.client_id IS NOT NULL
                     AND (w.property_link_key = m.link_key OR w.body LIKE '%/' || substring(m.link_key FROM 11) || '%')
                    JOIN public.clients cl ON cl.id = w.client_id
                   WHERE m.project_id = x.id GROUP BY w.client_id) l), '[]'::jsonb)
    ) ORDER BY x.created_at) FROM public.investment_projects x WHERE x.company_id = v_company AND NOT x.archived), '[]'::jsonb);
END
$function$;
REVOKE ALL ON FUNCTION public.crm_investment_projects() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_investment_projects() TO authenticated;
