-- SQL81 (11 Nov 2026, Ahmed: "the whole system the same for the employee, except what the rules keep from staff").
-- crm_staff_home(): the same home as crm_owner_home() for a staff account, with the same JSON shape so
-- crm-owner-home.js draws one page for both. SECURITY INVOKER on purpose: every count goes through the row level
-- security the account already has (SQL79 shared branches; the owner's private line stays hidden), so the home can never
-- show more than the account's own pages. Owner-only parts are not computed: owner offers, system problems,
-- videos/Instagram, agent reply counts (the owner's approvals) and paused chats (crm_paused_chats stays owner-only).
-- Deals are counted through crm_deals_access, which hides money and merged cards.
-- Rollback: 81-staff-home.rollback.sql
SET LOCAL lock_timeout = '10s';

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
    'owner_leads_new', 0,
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

REVOKE ALL ON FUNCTION public.crm_staff_home() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_staff_home() TO authenticated;
