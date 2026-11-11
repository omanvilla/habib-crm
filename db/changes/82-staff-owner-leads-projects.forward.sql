-- SQL82 (11 Nov 2026, Ahmed: «نعم افتحها لهم»): staff (manager, agent, viewer) see owner offers («عروض الملاك») and the
-- investment projects page, like the owner. Still hidden from staff: anything from the owner's private line
-- (owner_line_is_private, SQL79), and linking or unlinking Instagram videos on a project (the Instagram manual review
-- stays owner-only, AGENTS.md). Viewers read only. The owner's policies are unchanged.
-- Rollback: 82-staff-owner-leads-projects.rollback.sql
SET LOCAL lock_timeout = '10s';

-- owner offers
DROP POLICY IF EXISTS owner_leads_staff_read ON public.owner_leads;
CREATE POLICY owner_leads_staff_read ON public.owner_leads FOR SELECT TO authenticated
  USING (company_id = (SELECT public.my_company()) AND (SELECT public.my_role()) IN ('manager','agent','viewer')
         AND NOT crm_repair_private.owner_line_is_private(company_id, to_jsonb(owner_leads.*)));
DROP POLICY IF EXISTS owner_leads_staff_update ON public.owner_leads;
CREATE POLICY owner_leads_staff_update ON public.owner_leads FOR UPDATE TO authenticated
  USING (company_id = (SELECT public.my_company()) AND (SELECT public.my_role()) IN ('manager','agent')
         AND NOT crm_repair_private.owner_line_is_private(company_id, to_jsonb(owner_leads.*)))
  WITH CHECK (company_id = (SELECT public.my_company()) AND (SELECT public.my_role()) IN ('manager','agent')
         AND NOT crm_repair_private.owner_line_is_private(company_id, to_jsonb(owner_leads.*)));
DROP POLICY IF EXISTS owner_lead_matches_staff_read ON public.owner_lead_matches;
CREATE POLICY owner_lead_matches_staff_read ON public.owner_lead_matches FOR SELECT TO authenticated
  USING ((SELECT public.my_role()) IN ('manager','agent','viewer')
         AND EXISTS (SELECT 1 FROM public.owner_leads l WHERE l.id = owner_lead_matches.lead_id AND l.company_id = (SELECT public.my_company())
                     AND NOT crm_repair_private.owner_line_is_private(l.company_id, to_jsonb(l.*))));

CREATE OR REPLACE FUNCTION public.crm_match_owner_leads_now()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.my_role() is distinct from 'owner' and public.my_role() not in ('manager','agent') then raise exception 'owner_only'; end if;
  return public.crm_match_owner_leads(false);
end $function$;

-- investment projects
DROP POLICY IF EXISTS investment_projects_staff_read ON public.investment_projects;
CREATE POLICY investment_projects_staff_read ON public.investment_projects FOR SELECT TO authenticated
  USING (company_id = (SELECT public.my_company()) AND (SELECT public.my_role()) IN ('manager','agent','viewer'));
DROP POLICY IF EXISTS investment_projects_staff_insert ON public.investment_projects;
CREATE POLICY investment_projects_staff_insert ON public.investment_projects FOR INSERT TO authenticated
  WITH CHECK (company_id = (SELECT public.my_company()) AND (SELECT public.my_role()) IN ('manager','agent'));
DROP POLICY IF EXISTS investment_projects_staff_update ON public.investment_projects;
CREATE POLICY investment_projects_staff_update ON public.investment_projects FOR UPDATE TO authenticated
  USING (company_id = (SELECT public.my_company()) AND (SELECT public.my_role()) IN ('manager','agent'))
  WITH CHECK (company_id = (SELECT public.my_company()) AND (SELECT public.my_role()) IN ('manager','agent'));

-- the page's read: staff too; the clients who asked about a project never include the owner's private line
CREATE OR REPLACE FUNCTION public.crm_investment_projects()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_company uuid := public.my_company(); v_owner boolean := public.my_role() = 'owner';
BEGIN
  IF public.my_role() IS NULL OR public.my_role() NOT IN ('owner','manager','agent','viewer') THEN RAISE EXCEPTION 'owner_only' USING ERRCODE = '42501'; END IF;
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
                   WHERE m.project_id = x.id
                     AND (v_owner OR NOT EXISTS (SELECT 1 FROM public.whatsapp_conversations c WHERE c.id = w.conversation_id AND c.route_key = 'owner'))
                   GROUP BY w.client_id) l), '[]'::jsonb)
    ) ORDER BY x.created_at) FROM public.investment_projects x WHERE x.company_id = v_company AND NOT x.archived), '[]'::jsonb);
END
$function$;

-- the staff home (SQL81) counts new owner offers too, through the staff policy above
CREATE OR REPLACE FUNCTION public.crm_staff_home()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY INVOKER
 SET search_path TO ''
AS $function$
DECLARE
  v_company uuid := public.my_company();
  v_today date := (now() AT TIME ZONE 'Asia/Muscat')::date;
  v_week date; v_month date;
BEGIN
  IF v_company IS NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = '42501'; END IF;
  v_week := v_today - extract(dow FROM v_today)::int;
  v_month := date_trunc('month', v_today)::date;
  RETURN jsonb_build_object(
    'today', v_today,
    'scope', 'branch',
    'overdue_total', (SELECT count(*) FROM public.viewings v WHERE v.company_id = v_company AND coalesce(v.archived, false) = false AND v.status IN ('scheduled','confirmed','postponed') AND v.viewing_date < v_today),
    'overdue', coalesce((SELECT jsonb_agg(x) FROM (
        SELECT v.id, v.viewing_date, v.notes, c.name AS client, p.title AS property
          FROM public.viewings v LEFT JOIN public.clients c ON c.id = v.client_id LEFT JOIN public.properties p ON p.id = v.property_id
         WHERE v.company_id = v_company AND coalesce(v.archived, false) = false AND v.status IN ('scheduled','confirmed','postponed') AND v.viewing_date < v_today
         ORDER BY v.viewing_date DESC, v.viewing_time DESC NULLS LAST LIMIT 60) x), '[]'::jsonb),
    'upcoming', coalesce((SELECT jsonb_agg(x) FROM (
        SELECT v.id, v.viewing_date, v.viewing_time, c.name AS client, p.title AS property
          FROM public.viewings v LEFT JOIN public.clients c ON c.id = v.client_id LEFT JOIN public.properties p ON p.id = v.property_id
         WHERE v.company_id = v_company AND coalesce(v.archived, false) = false AND v.status IN ('scheduled','confirmed') AND v.viewing_date BETWEEN v_today AND v_today + 7
         ORDER BY v.viewing_date, v.viewing_time NULLS LAST LIMIT 20) x), '[]'::jsonb),
    'owner_leads_new', (SELECT count(*) FROM public.owner_leads l WHERE l.company_id = v_company AND l.status = 'open' AND l.created_at > now() - interval '7 days'),
    'problems', '[]'::jsonb,
    'properties', jsonb_build_object(
      'branches', coalesce((SELECT jsonb_agg(x ORDER BY x.branch) FROM (
          SELECT p.branch_key AS branch, count(*) FILTER (WHERE p.status = 'available') AS available, count(*) FILTER (WHERE p.status = 'reserved') AS reserved
            FROM public.properties p WHERE p.company_id = v_company AND coalesce(p.archived, false) = false AND p.branch_key IN ('barka','muscat') GROUP BY 1) x), '[]'::jsonb),
      'added_week', (SELECT count(*) FROM public.properties p WHERE p.company_id = v_company AND coalesce(p.archived, false) = false AND p.branch_key IN ('barka','muscat') AND (p.created_at AT TIME ZONE 'Asia/Muscat')::date >= v_week),
      'unchecked', (SELECT count(*) FROM public.properties p WHERE p.company_id = v_company AND coalesce(p.archived, false) = false AND p.branch_key IN ('barka','muscat') AND p.status = 'available' AND (p.availability_checked_at IS NULL OR p.availability_checked_at < now() - interval '30 days')),
      'no_video', '[]'::jsonb),
    'report', jsonb_build_object(
      'week_start', v_week,
      'new_clients', (SELECT count(*) FROM public.clients c WHERE c.company_id = v_company AND coalesce(c.archived, false) = false AND (c.created_at AT TIME ZONE 'Asia/Muscat')::date >= v_week),
      'agent_replies', NULL,
      'visits_done', (SELECT count(*) FROM public.viewings v WHERE v.company_id = v_company AND coalesce(v.archived, false) = false AND v.status = 'done' AND v.viewing_date >= v_week AND v.viewing_date <= v_today),
      'bookings_month', (SELECT count(*) FROM public.crm_deals_access d WHERE d.company_id = v_company AND d.reservation_cancelled_at IS NULL AND (d.reservation_confirmed_at AT TIME ZONE 'Asia/Muscat')::date >= v_month),
      'sales_month', (SELECT count(*) FROM public.crm_deals_access d WHERE d.company_id = v_company AND d.stage IN ('closed','commission_collected') AND (d.closed_at AT TIME ZONE 'Asia/Muscat')::date >= v_month)
    ));
END
$function$;
