-- SQL49: a deposit mirrored from a deal reservation has no deadline unless one is entered on the
-- Deposits page. SQL48 gave mirrored rows a default 30-day expiry, which marked a live booking
-- waiting for finance as "expired" — an invented date. Only the rows SQL48 created are reset.
CREATE OR REPLACE FUNCTION crm_repair_private.sync_deposit_from_reservation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_id uuid; v_paid date; v_cancelled boolean; v_completed boolean;
BEGIN
 IF NEW.reservation_confirmed_at IS NULL OR NEW.deposit_amount IS NULL OR NEW.deposit_amount<=0 THEN RETURN NULL; END IF;
 v_paid:=(NEW.reservation_confirmed_at AT TIME ZONE 'Asia/Muscat')::date;
 v_cancelled:=NEW.reservation_cancelled_at IS NOT NULL;
 v_completed:=NEW.stage IN ('closed','commission_collected');
 SELECT id INTO v_id FROM public.deposits WHERE deal_id=NEW.id AND from_reservation FOR UPDATE;
 IF v_id IS NULL THEN
  SELECT id INTO v_id FROM public.deposits WHERE deal_id=NEW.id AND NOT from_reservation AND amount=NEW.deposit_amount
   ORDER BY created_at LIMIT 1 FOR UPDATE;
  IF v_id IS NOT NULL THEN UPDATE public.deposits SET from_reservation=true WHERE id=v_id; END IF;
 END IF;
 IF v_id IS NULL THEN
  INSERT INTO public.deposits(company_id,deal_id,client_id,property_id,amount,payment_date,duration_days,expiry_date,status,from_reservation,notes)
  VALUES(NEW.company_id,NEW.id,NEW.client_id,NEW.property_id,NEW.deposit_amount,v_paid,NULL,NULL,
   CASE WHEN v_completed THEN 'applied' WHEN v_cancelled THEN 'cancelled' ELSE 'active' END,true,'سُجّل تلقائيًا من حجز الصفقة');
 ELSE
  UPDATE public.deposits SET amount=NEW.deposit_amount,payment_date=v_paid,client_id=NEW.client_id,property_id=NEW.property_id,
   expiry_date=CASE WHEN duration_days IS NULL THEN NULL ELSE v_paid+duration_days+coalesce(extension_days,0) END,
   status=CASE WHEN status IN ('applied','refunded','forfeited') THEN status
               WHEN v_completed THEN 'applied' WHEN v_cancelled THEN 'cancelled' ELSE 'active' END
  WHERE id=v_id;
 END IF;
 RETURN NULL;
END
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.sync_deposit_from_reservation() FROM PUBLIC, anon, authenticated;

UPDATE public.deposits SET duration_days=NULL, expiry_date=NULL
 WHERE from_reservation AND notes='سُجّل تلقائيًا من حجز الصفقة' AND duration_days=30
   AND expiry_date=payment_date+30 AND coalesce(extension_days,0)=0;
