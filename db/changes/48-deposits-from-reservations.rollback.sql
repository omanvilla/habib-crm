-- Rollback for SQL48. Removes the sync and the RPC; mirrored rows created by the backfill or the
-- trigger (notes = 'سُجّل تلقائيًا من حجز الصفقة') are deleted, adopted manual rows are kept.
DROP TRIGGER IF EXISTS crm_sync_deposit_from_reservation ON public.deals;
DROP TRIGGER IF EXISTS crm_guard_reservation_deposit_delete ON public.deposits;
DROP FUNCTION IF EXISTS public.crm_record_deposit(uuid,date,numeric,text,text,text,integer,text,text);
DROP FUNCTION IF EXISTS crm_repair_private.sync_deposit_from_reservation();
DROP FUNCTION IF EXISTS crm_repair_private.guard_reservation_deposit_delete();
DELETE FROM public.deposits WHERE from_reservation AND notes='سُجّل تلقائيًا من حجز الصفقة';
DROP INDEX IF EXISTS public.deposits_one_reservation_per_deal;
ALTER TABLE public.deposits DROP COLUMN IF EXISTS from_reservation;
