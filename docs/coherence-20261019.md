# CRM coherence follow-up — 2026-10-19

## Release state

Candidate `20261019-coherence-v10` on `codex/crm-coherence-20261019`, based on production documentation head `d18d8ab8db4e32e4f2ab41da8f63e739d7489b86`. This section will be updated with the validated commit, migrations and live verification after release. The starting runtime was v9. No business-record repair or historical backfill is part of this release.

## Problems and corrected sources

| Finding | Cause and correction | Verification scope |
|---|---|---|
| Period performance contained disconnected counters and current inventory | Dashboard, Team and Reports now share one three-stage renderer. Current available stock stays in the goals/property views. Period additions use the same qualification as weekly additions with different date boundaries. | Synthetic owner/employee/manager rendering, SQL28 records, existing SQL27 inventory acceptance |
| Property inquiry pairs used a different period from unique inquiring clients | New display fields use the same actual inbound-message evidence as unique clients and human replies, including a returning client with an older first inquiry. Legacy keys remain for compatibility. | Isolated inbound provenance, multiple properties, older first inquiry, manual visit exclusion |
| Visit totals and completed visits could not be reconciled | The old total used record creation; completion used the visit date. New total/completed/incomplete/cancelled fields partition one actual Oman-local visit-date cohort. | Cross-month creation versus appointment dates and exact partition assertion |
| Closing commission and cash used different office bases | Closing-period commission now uses the existing authoritative gross office-commission helper before employee allocation, matching booking-value and receipt-report bases. Unknown values remain diagnostic. | Synthetic gross 2,500 versus net 2,000, protected role masking and prior precision/receipt acceptance |
| Completed deals hid missing booking dates | The protected deal projection appends only booking/cancellation dates. Cards, table, client deals and CSV use these actual dates. The edit form separates visit, booking, closing and owner-visible receipt dates. Unknown paid-booking history requires actual date and amount, with no stage-history or visit-date inference. | Oman midnight boundaries, missing versus unloaded dates, synthetic legacy edit and preserved allocations/receipts |
| A recorded inquiry follow-up did not count as documented human contact | The old path wrote an optional system note without an outcome, could partially save linked work, and overwrote the inbound inquiry date. SQL29 adds one authorized, locked, idempotent transaction for the inquiry, linked request/contact state, reasons and activity. Only a newly entered outcome creates contact credit. | Authenticated SQL roles, atomic failure, replay, stale version, private shared identity and human contact qualification |
| Merely following an old negotiation could invent a milestone date | The inquiry/request trigger now acts only on an actual new transition. It preserves unknown old dates and does not reuse an old contact timestamp for a new transition. | Unchanged legacy stage and genuine new transition assertions |
| Open performance retained pre-save results | Relevant workspace refresh also refreshes the open panel with its selected period. Hidden reports load on entry. | Deferred-request and browser period checks |
| Client panes could show a late result for a different client or session | Client selection/list and linked detail reads check the current client, request sequence and session. Failures provide retry states. Session reset clears private detail caches. | A→B response ordering, logout, failures versus empty, complete pagination |
| Request budget could belong to a different card | The enrichment patch fetched requests again and matched by row position. Each card now formats the budget from its own request row, with existing finance permissions. | Equal creation dates, exact request IDs, role masking and no second query |
| Property count could disagree with filters/export | The caption now uses the same filtered rows as the displayed and exported list. The available-stock goal retains its exact authoritative property-ID scope. | Existing inventory scope and filtered-list regression |
| Reports journey inferred visits from deal labels | The branch journey now reuses the period RPC and the same three stages per employee. It does not sum overlapping unique clients across employees or display unsupported cross-cohort percentages. | Shared response/period and mobile report rendering |

## Financial and historical rules retained

- A real paid reservation stays in its actual Asia/Muscat booking month, including its recorded commission value when later sold or collected. Closing and each receipt have separate periods; they do not add another booking.
- The acceptance scenario remains two October reservations with expected commissions of OMR 2,000 and 2,500, and November receipts. Partial collection, later cancellation, audited date correction/reactivation, repeated requests and milli-OMR amounts are covered by the existing SQL24/25/26 acceptance in the release gate.
- Current inventory is all unique, available, non-archived ordinary branch properties, regardless of creation date or an unused verification timestamp. Each branch target is 10; qualified additions are separately two per Oman-local Sunday–Saturday week. SQL27 is retained.
- Historical notes are not automatically classified as new human follow-up attempts. A saved visit without a documented contact outcome remains a visit, not fabricated follow-up credit or inbound inquiry evidence.
- Missing booking dates/amounts and legacy collection evidence are preserved. No actual payment date is inferred from the time someone recorded a deposit stage.

## WhatsApp read-only evidence

A bounded October inbound relationship check found no missing client/conversation links, client identity mismatch, or property-resolved message lacking its corresponding inquiry relationship. Ambiguous or unresolved property identity remains visible for staff review; an unresolved message is not by itself proof that a property ask was missed. Existing receiving-line routing, WAMID idempotency and verified attribution were reviewed without sending or opening real customer threads. This is not a new Meta end-to-end delivery test.

## Migration and recovery order

Apply SQL28 before SQL29, then release v10 assets. SQL28 changes reporting and appends dates to the existing protected projection; SQL29 introduces the atomic follow-up API and repairs the request milestone trigger. Neither migration updates business rows. Both retain prior catalog definitions in restricted, RLS-enabled private backup tables and refuse rollback over independently changed definitions. If this release must be reverted, restore the previous frontend and roll back SQL29 before SQL28; do not cascade-drop dependencies. Real follow-up activities created after release remain preserved by catalog rollback.

## Limits

Synthetic browser sessions and transaction-local PostgreSQL roles are separate from actual authenticated production sessions. The earlier v7/v8 Maram, Hadeel and owner read-only journeys retain their documented scope. This follow-up does not establish password recovery/forced token expiry, a new real employee business-write journey, fresh provider delivery, Storage/Realtime attachment behavior, physical devices or a physical backup restoration. No customer messages, guessed historical corrections, mass cleanup or production test records are authorized by the test process.
