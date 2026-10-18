-- Already deployed migration, recovered verbatim from migration history.
alter table public.deals
 add column if not exists reservation_confirmed_at timestamptz,
 add column if not exists reservation_evidence_note text,
 add column if not exists reservation_cancelled_at timestamptz,
 add column if not exists reservation_cancellation_reason text,
 add column if not exists expected_company_commission_at_reservation numeric,
 add column if not exists commission_entitled_at timestamptz,
 add column if not exists company_commission_received_amount numeric;
comment on column public.deals.reservation_confirmed_at is 'Verified reservation timestamp, separate from sale close or commission receipt; no historical backfill.';
comment on column public.deals.expected_company_commission_at_reservation is 'Snapshot of expected company commission at confirmed reservation; never inferred from received commission.';
comment on column public.deals.company_commission_received_amount is 'Actual cumulative company receipts, may be partial; do not infer from commission_status.';


