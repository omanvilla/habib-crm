-- Rollback of SQL82: owner offers and investment projects owner-only again (bodies as before 11 Nov 2026).
SET LOCAL lock_timeout = '10s';
DROP POLICY IF EXISTS owner_leads_staff_read ON public.owner_leads;
DROP POLICY IF EXISTS owner_leads_staff_update ON public.owner_leads;
DROP POLICY IF EXISTS owner_lead_matches_staff_read ON public.owner_lead_matches;
DROP POLICY IF EXISTS investment_projects_staff_read ON public.investment_projects;
DROP POLICY IF EXISTS investment_projects_staff_insert ON public.investment_projects;
DROP POLICY IF EXISTS investment_projects_staff_update ON public.investment_projects;

CREATE OR REPLACE FUNCTION public.crm_match_owner_leads_now()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.my_role() is distinct from 'owner' then raise exception 'owner_only'; end if;
  return public.crm_match_owner_leads(false);
end $function$;

CREATE OR REPLACE FUNCTION public.crm_investment_projects()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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

-- the staff home: re-run db/changes/81-staff-home.forward.sql (owner offers count back to 0)
