-- Rollback SQL121: the property trigger goes back to SQL120 (close silently). Notifications already written stay.
SET LOCAL lock_timeout = '10s';
CREATE OR REPLACE FUNCTION crm_repair_private.handoff_close_on_property() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE c uuid;
BEGIN
  IF new.status IN ('sold', 'reserved') AND old.status IS DISTINCT FROM new.status THEN
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
      PERFORM crm_repair_private.close_hot_handoffs(new.company_id, c,
        CASE new.status WHEN 'sold' THEN 'العقار انباع' ELSE 'العقار انحجز' END || ': ' || coalesce(new.internal_name, new.title, ''));
    END LOOP;
  END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN RETURN NULL;
END $$;
DROP FUNCTION IF EXISTS crm_repair_private.property_alternative(uuid);
