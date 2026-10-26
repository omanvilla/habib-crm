-- SQL48: one deposit record per paid reservation.
-- A paid deposit confirmed on a deal (crm_save_deal_workflow / crm_confirm_paid_reservation)
-- lived only on public.deals, so the Deposits page (public.deposits) never showed it, and the
-- Deposits page's own "new deposit" path wrote a row and then failed to move the deal.
-- From now on the deal reservation is the source of truth for amount, payment date and
-- cancellation; the deposits row mirrors it and keeps its own extra details (method,
-- receiver, refundability, duration, notes).

ALTER TABLE public.deposits ADD COLUMN IF NOT EXISTS from_reservation boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS deposits_one_reservation_per_deal ON public.deposits(deal_id) WHERE from_reservation;

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
  -- A deposit typed on the Deposits page for the same deal and amount becomes the mirrored row.
  SELECT id INTO v_id FROM public.deposits WHERE deal_id=NEW.id AND NOT from_reservation AND amount=NEW.deposit_amount
   ORDER BY created_at LIMIT 1 FOR UPDATE;
  IF v_id IS NOT NULL THEN UPDATE public.deposits SET from_reservation=true WHERE id=v_id; END IF;
 END IF;
 IF v_id IS NULL THEN
  INSERT INTO public.deposits(company_id,deal_id,client_id,property_id,amount,payment_date,duration_days,expiry_date,status,from_reservation,notes)
  VALUES(NEW.company_id,NEW.id,NEW.client_id,NEW.property_id,NEW.deposit_amount,v_paid,30,v_paid+30,
   CASE WHEN v_completed THEN 'applied' WHEN v_cancelled THEN 'cancelled' ELSE 'active' END,true,'سُجّل تلقائيًا من حجز الصفقة');
 ELSE
  UPDATE public.deposits SET amount=NEW.deposit_amount,payment_date=v_paid,client_id=NEW.client_id,property_id=NEW.property_id,
   expiry_date=v_paid+coalesce(duration_days,30)+coalesce(extension_days,0),
   status=CASE WHEN status IN ('applied','refunded','forfeited') THEN status
               WHEN v_completed THEN 'applied' WHEN v_cancelled THEN 'cancelled' ELSE 'active' END
  WHERE id=v_id;
 END IF;
 RETURN NULL;
END
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.sync_deposit_from_reservation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS crm_sync_deposit_from_reservation ON public.deals;
CREATE TRIGGER crm_sync_deposit_from_reservation
 AFTER INSERT OR UPDATE OF reservation_confirmed_at, deposit_amount, reservation_cancelled_at, client_id, property_id, stage ON public.deals
 FOR EACH ROW EXECUTE FUNCTION crm_repair_private.sync_deposit_from_reservation();

-- A mirrored deposit is removed by cancelling or correcting the reservation on the deal, not deleted on its own.
CREATE OR REPLACE FUNCTION crm_repair_private.guard_reservation_deposit_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
BEGIN
 IF OLD.from_reservation AND EXISTS(SELECT 1 FROM public.deals d WHERE d.id=OLD.deal_id AND d.reservation_confirmed_at IS NOT NULL) THEN
  RAISE EXCEPTION 'reservation_deposit_managed_by_deal' USING ERRCODE='22023';
 END IF;
 RETURN OLD;
END
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.guard_reservation_deposit_delete() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS crm_guard_reservation_deposit_delete ON public.deposits;
CREATE TRIGGER crm_guard_reservation_deposit_delete BEFORE DELETE ON public.deposits
 FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_reservation_deposit_delete();

-- Deposits page "new deposit": confirm the paid reservation on the deal (same checks as the
-- deal workflow), then store the page's extra details on the mirrored row, in one transaction.
CREATE OR REPLACE FUNCTION public.crm_record_deposit(
 p_deal_id uuid, p_payment_date date, p_amount numeric, p_payment_method text DEFAULT NULL,
 p_received_by text DEFAULT NULL, p_refundable text DEFAULT NULL, p_duration_days integer DEFAULT 30,
 p_legal_notes text DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_result jsonb; v_id uuid; v_days integer:=coalesce(p_duration_days,30);
BEGIN
 IF v_days<1 OR v_days>365 THEN RAISE EXCEPTION 'invalid_deposit_duration' USING ERRCODE='22023'; END IF;
 v_result:=public.crm_confirm_paid_reservation(p_deal_id,p_payment_date,p_amount,NULL);
 SELECT id INTO v_id FROM public.deposits WHERE deal_id=p_deal_id AND from_reservation;
 IF v_id IS NULL THEN RAISE EXCEPTION 'deposit_sync_missing' USING ERRCODE='P0001'; END IF;
 UPDATE public.deposits SET payment_method=coalesce(p_payment_method,payment_method),received_by=coalesce(p_received_by,received_by),
  refundable=coalesce(p_refundable,refundable),duration_days=v_days,expiry_date=payment_date+v_days+coalesce(extension_days,0),
  legal_notes=nullif(btrim(coalesce(p_legal_notes,'')),''),notes=coalesce(nullif(btrim(coalesce(p_notes,'')),''),notes)
 WHERE id=v_id;
 RETURN v_result||jsonb_build_object('deposit_id',v_id);
END
$function$;
REVOKE ALL ON FUNCTION public.crm_record_deposit(uuid,date,numeric,text,text,text,integer,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_record_deposit(uuid,date,numeric,text,text,text,integer,text,text) TO authenticated;

-- Backfill: every existing paid reservation gets its deposits row. Amount and date come from
-- the deal; the deals themselves are not touched.
INSERT INTO public.deposits(company_id,deal_id,client_id,property_id,amount,payment_date,duration_days,expiry_date,status,from_reservation,notes)
SELECT d.company_id,d.id,d.client_id,d.property_id,d.deposit_amount,(d.reservation_confirmed_at AT TIME ZONE 'Asia/Muscat')::date,30,
 (d.reservation_confirmed_at AT TIME ZONE 'Asia/Muscat')::date+30,
 CASE WHEN d.stage IN ('closed','commission_collected') THEN 'applied' WHEN d.reservation_cancelled_at IS NOT NULL THEN 'cancelled' ELSE 'active' END,
 true,'سُجّل تلقائيًا من حجز الصفقة'
FROM public.deals d
WHERE d.reservation_confirmed_at IS NOT NULL AND d.deposit_amount>0
  AND NOT EXISTS(SELECT 1 FROM public.deposits x WHERE x.deal_id=d.id);
