# Reservation-period performance — 2026-10-18

## Result

Booking achievement follows the original actual-paid-deposit date in Asia/Muscat, independently of sale completion and company commission receipt. A paid booking has its own expected company commission snapshot and provenance (CRM payment confirmation, recording actor/time). Uploaded proof is not mandatory under Ahmed's explicit approval. Unverified legacy deposit-stage rows are not backfilled or scored.

The existing `sales` field continues to mean completed sales by closing date. New `reservations`, `active_reservations`, `cancelled_reservations`, `expected_commission`, `unknown_expected_commission`, `commission_collected`, and `receipt_count` fields separate the concepts. The monthly booking goal uses two reservations OR OMR4,000 expected commission. Manager financial redaction and existing branch/investment boundaries remain enforced.

## Implementation

- SQL24 extends the existing locked, optimistic-concurrency and idempotency-protected atomic deal RPC. No second browser save is needed for booking. Replays do not add a booking event or receipt. Original payment date, amount and source cannot be overwritten by later stage transitions.
- Cancellations retain date/reason and the original historical KPI; active bookings decrease. Moving to a documented lost stage records cancellation from that actual loss evidence.
- Expected company commission, entitlement date, closing date and actual receipt dates remain separate. Owner-entered partial receipts have dates, amounts, sources and operation keys. The per-deal employee commission and payout-on-company-collection rule are preserved.
- Legacy receipts are not guessed or silently replaced with a new ledger. Existing full receipts with a known collection date retain their historical actual amount. A legacy collected deal requires review before starting a new receipt ledger; unknown collection dates are not assigned to a month.
- `crm_get_deal_workflow` returns allowed booking metadata and owner-only finance. The UI no longer reads protected new columns directly from `deals`. Fixed the existing syntax error in the paid-deposit panel. Snapshot-only changes do not recalculate historical financial allocations.
- Existing target configuration is retained, labeled reference where superseded by the approved booking goal. No business rows are rewritten by deployment. Rollback restores guarded original functions and retains the immutable event/receipt history.

## Verification

- Node tests: 245 passed, two pre-existing environment-dependent SQL skips; zero failures. Security regression harness: 26 passed; no network sends or production writes.
- Isolated PostgreSQL18/PGlite full catalog: October2025 booking, November closure and partial receipt, December remaining receipt; no duplicate booking/sale; reservation and receipt retries; cancellation history; September/October Oman-local midnight boundary; approved branch attribution without rewriting author; exclusion of unproven deposits; scoped Barka/Muscat roles; private investment denial; finance redaction; viewer denial; pre-existing deal row equality; double migration apply and guarded rollback preserving receipts/audit.
- Synthetic Playwright owner/Barka/Muscat: one-screen booking payload, positive payment/date validation, same operation key after failure, finance field scope, immutable original booking/source/actor display, estimate-only update preserves legacy amounts, mobile layout. These are synthetic sessions, not actual employee logins.
- Five-role dashboard browser regression and the existing full preview/browser workflow are included in validation. GitHub CI adds isolated PostgreSQL16 booking/receipt/rollback tests.

## Release state

Deployed frontend runtime `0d201a1b4854ce290bc5fafb2104d3922d3aff0c`, cache version `20261018-reservation-period-v4`. All six CI jobs passed in [run39130879340](https://github.com/omanvilla/habib-crm/actions/runs/39130879340), including isolated PostgreSQL16 reservation/receipt/rollback tests and synthetic browsers. GitHub Pages deployment [39136079780](https://github.com/omanvilla/habib-crm/actions/runs/39136079780) succeeded. Backup branch `backup/pre-reservation-period-20261018` retains the prior frontend.

Supabase migration `20261018142647_reservation_period_performance_20261018` is applied. Its local migration filename is aligned with the actual server history. Post-deployment owner, Barka and Muscat authenticated SQL-role RPC reads succeeded; each employee received exactly her own performance and target row. Protected booking columns remain inaccessible directly to authenticated users; the private audit/receipt tables and metrics helper are not directly exposed. Anonymous booking execution remains denied. The 55 existing deal rows have an identical full-row fingerprint before and after deployment. No real booking, receipt or customer message was created for tests.

Security advisor warning/error categories and counts are unchanged; the only extra INFO entries are the three deliberately inaccessible private tables. The live browser reached the login screen; no actual authenticated employee browser session was available. The real employee UI walkthrough remains unverified; SQL-role and synthetic evidence do not replace it.
