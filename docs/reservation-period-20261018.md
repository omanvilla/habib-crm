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

Prepared from production main `0866d5190c4d6f83aa4326f375c03c5c7e9bf53a`. Deployment and post-release evidence will be recorded after validation. No real client booking, receipt or customer message is created by the test workflows.
