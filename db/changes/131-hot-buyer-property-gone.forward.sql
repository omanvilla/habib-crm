-- SQL131 (18 Nov 2026, Ahmed: «خلاص هذه الفيلا راحت، ليش بعده موجود كمشتري ساخن؟»). SQL120 closes a handed-over chat when
-- its property turns sold / reserved, but a «🔥 مشتري جاد» written only as a notification (the visit results job, e.g. the
-- client «.» who visited «فيلا الرميس 59 هشام» on 14 Nov) stayed in «عملاء يحتاجونك الحين». Now, when a property turns sold
-- or reserved, the unread «🔥 مشتري جاد» notifications of the clients who visited it or whose latest interest is it are marked
-- read — never the client who booked or bought it (a booked or closed deal on it), never «🔥 بديل» (written at that same moment).
-- Data, at Ahmed's word: the one notification he pointed at (78d3239a, «🔥 مشتري جاد: .», villa reserved) is marked read.
-- Rollback: 131-hot-buyer-property-gone.rollback.sql
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION crm_repair_private.hot_buyer_property_gone()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.status IN ('sold', 'reserved') AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.notifications n SET is_read = true
     WHERE n.type = 'whatsapp_handoff' AND NOT coalesce(n.is_read, false)
       AND coalesce(n.title, '') ~ '^🔥 مشتري جاد'
       AND n.client_id IN (
         SELECT v.client_id FROM public.viewings v WHERE v.property_id = NEW.id AND v.client_id IS NOT NULL
         UNION
         SELECT x.client_id FROM (
           SELECT DISTINCT ON (pi.client_id) pi.client_id, pi.property_id FROM public.property_inquiries pi
            WHERE pi.company_id = NEW.company_id AND pi.client_id IN (SELECT client_id FROM public.property_inquiries WHERE property_id = NEW.id)
            ORDER BY pi.client_id, coalesce(pi.last_inquiry_at, pi.created_at) DESC) x
          WHERE x.property_id = NEW.id)
       -- every interested client has a deal card on the property; only the one who booked or bought it keeps his alert (SQL121 rule)
       AND NOT EXISTS (SELECT 1 FROM public.deals d WHERE d.property_id = NEW.id AND d.client_id = n.client_id
                        AND (d.reservation_confirmed_at IS NOT NULL OR d.stage IN ('closed', 'commission_collected', 'awaiting_finance')));
  END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN RETURN NULL;
END $function$;
REVOKE ALL ON FUNCTION crm_repair_private.hot_buyer_property_gone() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS crm_hot_buyer_property_gone ON public.properties;
CREATE TRIGGER crm_hot_buyer_property_gone AFTER UPDATE OF status ON public.properties
  FOR EACH ROW EXECUTE FUNCTION crm_repair_private.hot_buyer_property_gone();

UPDATE public.notifications SET is_read = true WHERE id = '78d3239a-48dc-4d2a-a6fa-06d6c45ed394' AND NOT coalesce(is_read, false);
