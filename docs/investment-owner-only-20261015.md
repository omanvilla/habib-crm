# Investment workflow — October 15, 2026

## Scope and audit

Ahmed requested a small extension of the existing CRM for manually entered investors while Meta onboarding remains incomplete. The canonical route is `investment`; only an active owner in the same company may access its work. Manager/viewer status must not grant investment access. No historical investor-label backfill, branch reassignment, customer messaging or Meta connection attempt is authorized by this change.

The live audit found:

- The investment business route already exists, is assigned to the active owner and has `owner_only_inbox=true`. No route configuration update is needed for deployment.
- Existing `client_requests` already contains the requested qualification fields and milestone timestamps. A separate investor table or pipeline is unnecessary.
- The manual client form did not reliably set the route or owner when Investor was selected. Existing client/request summaries could apply branch geography to investment work.
- Existing manager/viewer permissions and several privileged reporting paths were broader than the requested owner-only boundary. Inbox privacy alone did not protect every linked record.
- At audit time there were no canonical investment clients or requests, but 71 existing clients had an investor label within ordinary routes. Those labels are not a basis for changing old records or access.
- Shared AI summaries and shared-phone request summaries needed protection against copying private evidence into an ordinary client/property record.

## Implementation

New owner-created investors persist `lead_route=investment`, `client_type=investor`, and the current owner assignment. Investment requests persist `request_type=investor`, `route_key=branch_key=investment`, and an active owner assignment. The form identifies the route, owner and privacy, retains existing phone normalization/deduplication, and opens an existing number without moving it. Existing branch investor labels and staff workflows remain ordinary branch records.

Qualification remains optional. Existing request fields support financing readiness, decision maker, priority, current stage, next action and follow-up. Optional actual Oman-local milestone times are editable and visible on the client page. Record creation time is not substituted for contact evidence; no-response remains distinct from rejection. No new business pipeline or investor table is introduced.

SQL18 adds restrictive owner-only policies alongside the existing branch policies, guards related records and privileged writes, and protects definer views/RPC aggregates. Private catalog backups retain original definitions for a reviewed rollback. Nullable client/request notification references carry privacy context without changing existing notifications. There is no production client/request/deal/route backfill.

Mixed-phone handling preserves an existing ordinary client exactly while separating future private investment requests, conversations and property-attribution evidence. Private request summaries, messages and inquiry updates cannot overwrite the ordinary parent. Service-role Edge paths enforce the same owner boundary, and shared AI caches exclude private evidence even when the owner requests the analysis. Future investment onboarding is owner-only; this release does not attempt to connect Meta or enable follow-up automation.

## Verification and release

Runtime candidate `9e54d1ddcb8b0b180861a3851a6e35ab54791d76` passed all five jobs in [CI run 38733952928](https://github.com/omanvilla/habib-crm/actions/runs/38733952928): Node/security regressions, synthetic browsers, existing attribution SQL, existing visit/deal/rejection/WhatsApp workflow SQL, and the new investment SQL suite on PostgreSQL 16. Local Node results: 178 passed, 2 existing SQL-context skips; security harness: 26 passed. The isolated full-catalog SQL fixture includes 50 tables, 54 triggers, 129 original policies and four views with synthetic identities.

Isolation tests cover owner creation/editing, private duplicate-phone handling, employee/manager/viewer/inactive/foreign-company access, all 37 gated tables, direct and indirect references, writes, selectors, reporting RPCs, future inbound attribution and retries. Ordinary record fingerprints and seven-role visibility across 11 surfaces remain identical before/after the isolated migration. Removing private synthetic records leaves all four non-owner reporting results identical while changing owner results. The five-role Chromium walkthrough checks investor creation, optional qualification/milestones, no-response handling and duplicate reuse. These are automated synthetic sessions and database role tests, not actual employee browser logins. No real customer test record, outgoing message or AI invocation was used.

SQL18 was applied as migration `20261015123014` / `investment_owner_only_20261015`. The exact tested forward SQL has SHA256 `9be0e40447c39f5136b58c855f954337cfb200b38aefdcddae56f5aa347b7576`. The CLI-generated source filename retains its preparation timestamp `20261015115454`; its bytes match the forward file. The exposed AI privacy RPC is SECURITY INVOKER; its owner-checked implementation lives in the non-exposed private schema. Catalog backups preserve previous definitions; rollback refuses to expose existing private investment records.

Six Edge Functions are ACTIVE and their retrieved source matches the candidate byte-for-byte: webhook v35, send v14, direct-bind v11, embedded-signup v6, property AI v4 and client AI v2. Existing JWT settings are unchanged. Inbox v12 remains unchanged. The deployment neither connected Meta nor enabled automation.

Read-only production comparison found all four route configurations unchanged, no historical investment conversion and all 71 legacy investor classifications retained. Fourteen of 16 existing-table full fingerprints were identical. Live inbound messages updated conversation counters/contact summaries during deployment: an exact read-only hash reconstruction isolated the client route-fingerprint difference to one ordinary Barka contact's existing AI classification from null to buyer, following messages received before the migration. Every original client's route, assignment, investor flag and archive state stayed unchanged; conversation routing also stayed unchanged. No business-row DML was included in SQL18; its only inserts saved private catalog definitions.

Security-advisor comparison introduced no new warning/error category. The only added informational finding is the intentionally inaccessible private catalog backup with RLS enabled and no access policies ([Supabase explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)); existing broader security advisories remain separate work. This release does not claim a clean audit of the whole CRM.

Live read-only checks under transaction-local owner/Muscat/Barka claims also succeeded for clients, requests, visits, appointments, deal views, tasks and inboxes. Each employee inbox remained within its own branch; the private investment authorization predicate allowed owner and denied both employees. These checks did not create production records or employee login sessions. Combined full-table aggregate checks took approximately 0.75–7.82 seconds, so they are not a paginated UI latency benchmark.

[Pages run 38735640022](https://github.com/omanvilla/habib-crm/actions/runs/38735640022) succeeded. Public version `20261015-investment-v15` loads the login screen correctly in a fresh unauthenticated Chromium context, with no JavaScript/console errors or failed requests. All seven changed frontend assets returned HTTP 200 and matched candidate Git blob hashes exactly. This read-only smoke sent no backend mutations and used no saved credentials.
