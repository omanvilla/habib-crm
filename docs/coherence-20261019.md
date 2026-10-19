# CRM coherence follow-up — 2026-10-19

## Release state

Deployed **`20261019-coherence-v10`**, validated release **`c3e78b14646180481e1eebc5e2cdc27cc9402de6`**. All seven jobs passed in [CI 39230257811](https://github.com/omanvilla/habib-crm/actions/runs/39230257811); [Pages 39230879858](https://github.com/omanvilla/habib-crm/actions/runs/39230879858) succeeded for that commit. The core frontend was first published as `258a4c1af93d58fa074a724b33352c14cffa9bda` after CI39226645115 and Pages39228956835. The starting runtime was v9; the final SQL30 commit leaves v10 frontend bytes unchanged. All18 public assets match the validated source. No business-record repair or historical backfill is part of this release. Detailed [sanitized evidence](coherence-evidence-20261019.json) and [asset hashes](coherence-assets-20261019.json) are versioned with this report.

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
| Owner and employee message-volume counts differed for the same line | Live role comparison traced the entire difference to an extra client-card permission condition on messages already readable through the employee's authorized WhatsApp conversation. SQL30 removes only that extra volume condition; client/inquiry access, line authorization, investment exclusion and successful-human qualification remain in place. | Independent policy review and isolated own-line/opposite-primary-client regression; final live comparison is recorded in release evidence |

## Financial and historical rules retained

- A real paid reservation stays in its actual Asia/Muscat booking month, including its recorded commission value when later sold or collected. Closing and each receipt have separate periods; they do not add another booking.
- The acceptance scenario remains two October reservations with expected commissions of OMR 2,000 and 2,500, and November receipts. Partial collection, later cancellation, audited date correction/reactivation, repeated requests and milli-OMR amounts are covered by the existing SQL24/25/26 acceptance in the release gate.
- Current inventory is all unique, available, non-archived ordinary branch properties, regardless of creation date or an unused verification timestamp. Each branch target is 10; qualified additions are separately two per Oman-local Sunday–Saturday week. SQL27 is retained.
- Historical notes are not automatically classified as new human follow-up attempts. A saved visit without a documented contact outcome remains a visit, not fabricated follow-up credit or inbound inquiry evidence.
- Missing booking dates/amounts and legacy collection evidence are preserved. No actual payment date is inferred from the time someone recorded a deposit stage.

## WhatsApp read-only evidence

A bounded October inbound relationship check found no missing client/conversation links, client identity mismatch, or property-resolved message lacking its corresponding inquiry relationship. Ambiguous or unresolved property identity remains visible for staff review; an unresolved message is not by itself proof that a property ask was missed. Existing receiving-line routing, WAMID idempotency and verified attribution were reviewed without sending or opening real customer threads. This is not a new Meta end-to-end delivery test.

## Migration and recovery order

SQL28 is applied as **20261019090437**, SQL29 as **20261019090534**, and SQL30 as **20261019093011**. SQL28 changes reporting and appends dates to the protected projection; SQL29 introduces the atomic follow-up API and repairs the request milestone trigger. These compatible backend changes preceded the core v10 frontend. The subsequent role comparison led to the narrow SQL30 authorized-line message-volume correction, with its own native PostgreSQL acceptance and live comparison before the final source release. None of these migrations updates business rows.

All three retain preceding catalog definitions in restricted, RLS-enabled private backup tables and refuse application/rollback over independently changed definitions. If reverting the whole coherence release, restore the earlier frontend and roll back **SQL30, then SQL29, then SQL28**; do not cascade-drop dependencies. Real follow-up activities created after release remain preserved by catalog rollback. The CLI mirrors have been aligned to the actual applied versions without changing their SQL bytes.

## Final verification

| Evidence | Result and scope |
|---|---|
| Data preservation | Every full-row fingerprint in the11 inspected business tables matched before/after SQL28+29 and again before/after SQL30. Ordinary work between these windows is preserved. |
| Native PostgreSQL | SQL24–30 acceptance, repeat application, immutable audit/precision/partial receipts, authorization, guard refusal and exact non-destructive rollback passed. SQL29 used real competing connections for same-key replay, stale versions and one client's independent inquiries. |
| Node/security | 330 Node tests passed, with two context-dependent cases exercised in their dedicated SQL jobs; 28 security checks passed. |
| Synthetic browser | New performance/read39, deal-date18 and inquiry-follow-up21 groups passed at1440px/390px. All10 existing/new browser suites passed in the final CI gate. These are isolated sessions with external sends blocked. |
| Live role reads | Both employees see only their own performance entry; message volume agrees with owner in one repeatable-read snapshot. Their opposite-branch property/private-request results are empty. An owner positive control contains protected financial values; the employee deal projections mask them. |
| Actual owner dashboard/properties | Barka13/10 and Muscat4/10, with weekly0/2 independently. Barka's goal opens13 available rows, matching its detail caption; clearing the goal scope restores ordinary browsing. |
| Actual owner performance/reports | Matching October1–31 journey results, six approved period buttons, Muscat date boundaries, one visit-date partition, separate office booking/sale/cash bases and a missing historical booking diagnostic. |
| Actual owner deal form/table | The requested legacy sale shows its actual visit/sale/receipt dates and an unknown paid-booking date. The completion button focuses blank actual date/amount fields; cancelling saves nothing. Card/table dates agree; all57 deals load in the table. Private identities, dates and financial totals are omitted from public evidence. |
| Security advisors | Existing two protected-view and12 authenticated-RPC findings remain; the INFO increase is three intentionally inaccessible catalog backups. Leaked-password protection remains disabled because Auth configuration changes are not exposed by the connected tools. [Auth protection reference](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). |

## Limits

Synthetic browser sessions and transaction-local PostgreSQL roles are separate from actual authenticated production sessions. The earlier v7/v8 Maram, Hadeel and owner read-only journeys retain their documented scope. This follow-up does not establish password recovery/forced token expiry, a new real employee business-write journey, fresh provider delivery, Storage/Realtime attachment behavior, physical devices or a physical backup restoration. No customer messages, guessed historical corrections, mass cleanup or production test records are authorized by the test process.
