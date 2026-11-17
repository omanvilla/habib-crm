-- SQL114 (17 Nov 2026, Ahmed: «سوّ الإضافات كلها» after the full system check). Only adds; nothing existing changes.
-- 1. crm_call_next: «اتصل بعدهم», open owner offers (owner_leads, from WhatsApp) whose number nobody has called in the
--    last 30 days, newest first, so staff know whom to call next toward the 10 calls a day. Same visibility as the offers
--    page: staff never get an offer from the owner's private line (owner_line_is_private) or a client they cannot open.
-- 2. crm_mark_seen: the app records the signed-in account's last visit (profiles.last_login_at was never written), at
--    most once every 5 minutes, so the owner sees when each employee last opened the CRM.
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.crm_call_next(p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $f$
DECLARE c uuid := public.my_company(); r text := public.my_role(); n integer := greatest(1, least(coalesce(p_limit, 20), 50));
BEGIN
  IF auth.uid() IS NULL OR c IS NULL OR coalesce(r, '') NOT IN ('owner', 'manager', 'agent') THEN
    RAISE EXCEPTION 'call_not_allowed' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(x ORDER BY x->>'created_at' DESC) FROM (
      SELECT jsonb_build_object('lead_id', ol.id, 'client_id', k.id, 'name', k.name, 'phone', k.phone,
               'kind', ol.kind, 'area', ol.area, 'wilayat', ol.wilayat, 'price', ol.price, 'status', ol.status,
               'created_at', ol.created_at,
               'last_called_at', (SELECT max(a.occurred_at) FROM public.activities a
                                   WHERE a.company_id = c AND a.channel = 'call' AND a.actor_type = 'human'
                                     AND (a.client_id = k.id OR right(coalesce(a.after_data->>'call_phone', ''), 8) = right(d.digits, 8)))) x
        FROM public.owner_leads ol
        JOIN public.clients k ON k.id = ol.client_id AND k.company_id = ol.company_id AND coalesce(k.archived, false) = false
        CROSS JOIN LATERAL (SELECT regexp_replace(coalesce(k.phone_normalized, k.phone, ''), '\D', '', 'g') digits) d
       WHERE ol.company_id = c AND ol.status = 'open' AND length(d.digits) >= 8
         AND (r = 'owner' OR (NOT crm_repair_private.owner_line_is_private(ol.company_id, to_jsonb(ol))
                               AND crm_repair_private.can_access_client(c, k.id)))
         AND NOT EXISTS (SELECT 1 FROM public.activities a
                          WHERE a.company_id = c AND a.channel = 'call' AND a.actor_type = 'human'
                            AND a.occurred_at > now() - interval '30 days'
                            AND (a.client_id = k.id OR right(coalesce(a.after_data->>'call_phone', ''), 8) = right(d.digits, 8)))
       ORDER BY ol.created_at DESC
       LIMIT n) s), '[]'::jsonb);
END $f$;
REVOKE ALL ON FUNCTION public.crm_call_next(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_call_next(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_mark_seen()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $f$
  UPDATE public.profiles SET last_login_at = now()
   WHERE id = auth.uid() AND is_active IS TRUE
     AND (last_login_at IS NULL OR last_login_at < now() - interval '5 minutes');
$f$;
REVOKE ALL ON FUNCTION public.crm_mark_seen() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_mark_seen() TO authenticated;
