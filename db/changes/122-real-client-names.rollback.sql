-- Rollback SQL122: the list and the alternative alert go back to «any name with letters is a name» (SQL120/121).
SET LOCAL lock_timeout = '10s';
CREATE OR REPLACE FUNCTION public.crm_owner_open_handoffs()
 RETURNS TABLE (conversation_id uuid, client_id uuid, display_name text, phone text, kind text, reason text,
                handoff_at timestamptz, last_inbound_at timestamptz, route_key text, last_property text)
 LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO ''
AS $$
  SELECT w.id, w.client_id,
         CASE WHEN coalesce(cl.name, '') ~ '[[:alpha:]]' THEN btrim(cl.name)
              WHEN coalesce(w.customer_name, '') ~ '[[:alpha:]]' AND lp.t IS NULL THEN btrim(w.customer_name)
              ELSE concat_ws(' · ', coalesce(cl.phone_normalized, cl.phone, w.customer_wa_id), lp.t) END,
         coalesce(cl.phone_normalized, cl.phone, w.customer_wa_id),
         btrim(split_part(w.handoff_reason, ':', 1)), w.handoff_reason,
         coalesce(w.handoff_updated_at, w.updated_at), w.last_inbound_at, w.route_key, lp.t
    FROM public.whatsapp_conversations w
    LEFT JOIN public.clients cl ON cl.id = w.client_id
    LEFT JOIN LATERAL (
      SELECT concat_ws(' / ', coalesce(p.internal_name, p.title), coalesce(p.area, p.wilayat)) t
        FROM public.property_inquiries pi JOIN public.properties p ON p.id = pi.property_id
       WHERE pi.client_id = w.client_id ORDER BY coalesce(pi.last_inquiry_at, pi.created_at) DESC LIMIT 1) lp ON true
   WHERE coalesce(w.route_key, '') NOT IN ('owner', 'investment') AND public.crm_hot_handoff_open(w)
   ORDER BY coalesce(w.handoff_updated_at, w.updated_at)
$$;

CREATE OR REPLACE FUNCTION crm_repair_private.handoff_close_on_property() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE c uuid; n integer; alt text; who text; what text;
BEGIN
  IF new.status IN ('sold', 'reserved') AND old.status IS DISTINCT FROM new.status THEN
    what := CASE new.status WHEN 'sold' THEN 'انباع' ELSE 'انحجز' END;
    alt := crm_repair_private.property_alternative(new.id);
    FOR c IN
      SELECT x.client_id FROM (
        SELECT DISTINCT ON (pi.client_id) pi.client_id, pi.property_id
          FROM public.property_inquiries pi
         WHERE pi.company_id = new.company_id
           AND pi.client_id IN (SELECT client_id FROM public.property_inquiries WHERE property_id = new.id)
         ORDER BY pi.client_id, coalesce(pi.last_inquiry_at, pi.created_at) DESC) x
       WHERE x.property_id = new.id
      UNION
      SELECT d.client_id FROM public.deals d WHERE d.property_id = new.id AND d.client_id IS NOT NULL
    LOOP
      n := crm_repair_private.close_hot_handoffs(new.company_id, c,
        'العقار ' || what || ': ' || coalesce(new.internal_name, new.title, ''));
      -- the buyer of this deal is not offered an alternative
      IF n > 0 AND alt IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM public.deals d WHERE d.property_id = new.id AND d.client_id = c
              AND (d.reservation_confirmed_at IS NOT NULL OR d.stage IN ('closed', 'commission_collected', 'awaiting_finance'))) THEN
        SELECT CASE WHEN coalesce(cl.name, '') ~ '[[:alpha:]]' THEN btrim(cl.name) ELSE coalesce(cl.phone_normalized, cl.phone, 'عميل') END
          INTO who FROM public.clients cl WHERE cl.id = c;
        INSERT INTO public.notifications (user_id, title, body, type, client_id)
        SELECT pr.id, '🔥 بديل: ' || coalesce(who, 'عميل') || ' · ' || coalesce(new.internal_name, new.title, 'العقار') || ' ' || what,
               'اعرض عليه بديل: ' || alt, 'whatsapp_handoff', c
          FROM public.profiles pr
         WHERE pr.company_id = new.company_id AND pr.role = 'owner' AND coalesce(pr.is_active, false);
      END IF;
    END LOOP;
  END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN RETURN NULL;
END $$;
DROP FUNCTION IF EXISTS public.crm_is_real_name(text);
