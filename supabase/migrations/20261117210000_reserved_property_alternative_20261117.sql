-- SQL121 (17 Nov 2026, Ahmed: «أيوة، إذا كان في بديل أعرض عليه بديل»). When a property turns sold / reserved, SQL120 closes the
-- open handoffs of the clients who were on it, silently. Now, if a similar property is available, Ahmed gets one row in
-- «عملاء يحتاجونك الحين»: «🔥 بديل: <client> · <property> انحجز» with the suggested alternative; no alternative → silent as before.
-- Nothing is sent to the client; Ahmed decides. Alternative = available, not archived, same type and purpose, same wilayat,
-- price between 80% and 125% (closest price first). Rollback: 121-reserved-property-alternative.rollback.sql (back to SQL120).
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION crm_repair_private.property_alternative(p_property uuid)
 RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
  SELECT concat_ws(' · ', coalesce(a.internal_name, a.title), coalesce(a.area, a.wilayat),
                   CASE WHEN a.price IS NOT NULL THEN trim(to_char(a.price, 'FM999G999G999')) || ' ر.ع' END)
    FROM public.properties p
    JOIN public.properties a ON a.company_id = p.company_id AND a.id <> p.id
   WHERE p.id = p_property
     AND a.status = 'available' AND NOT coalesce(a.archived, false)
     AND a.type IS NOT DISTINCT FROM p.type
     AND coalesce(a.listing_purpose, 'sale') = coalesce(p.listing_purpose, 'sale')
     AND a.wilayat IS NOT DISTINCT FROM p.wilayat
     AND (p.price IS NULL OR a.price BETWEEN p.price * 0.8 AND p.price * 1.25)
   ORDER BY abs(coalesce(a.price, 0) - coalesce(p.price, 0)), a.created_at DESC
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION crm_repair_private.property_alternative(uuid) FROM PUBLIC, anon, authenticated;

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
