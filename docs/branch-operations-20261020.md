# Branch operations and shared Muscat WhatsApp reception

Date: 2026-10-20. Status: **deployed and verified to the scope below**. Latest owner instruction governs this release. The comprehensive October 19 audit/coherence reports retain their dated coverage; this work does not restart them or certify previously untested surfaces.

## Production release

- Runtime `20261020-branch-v11`, validated commit `a0ef434bf0d473b8eb226ad79beeb380fc269467` (application source `89eb774b347a72a67ee98f9f5feb5a202f551405`). All seven jobs in [CI 39362717083](https://github.com/omanvilla/habib-crm/actions/runs/39362717083) and [Pages 39364258345](https://github.com/omanvilla/habib-crm/actions/runs/39364258345) passed. All 18 public assets match the validated source.
- SQL31 applied as `20261020031442`; SQL32 as `20261020032501`. The first SQL32 connector call expired before application; an independent schema/migration check established absence before the successful retry. There is one SQL32 migration entry.
- Retrieved Edge sources and gateway settings match exactly: webhook 38, send 16, inbox 13, direct-bind 12 and embedded-signup 7. The inbox gateway continues to require JWT verification; the other four retain their prior settings and handler authentication.
- Targeted retirement committed at `2026-10-20 03:27:53 UTC`. Fresh Auth reads show inactive/banned, zero unexpired sessions and zero unrevoked refresh access; one immutable administrative audit. Maram and owner remain active. No account or session row was deleted.
- Live owner SQL target snapshot returns Barka 13/10 and Muscat 4/10; weekly additions 0/2 each. Both detail counts match their inventory arrays. Saved goal values and recorded commissions are preserved. The valid historical sale missing actual paid-booking evidence remains explicitly unattributed to a booking target; no date or amount was invented.
- All 15 inspected business/financial table fingerprints match across retirement. Across the longer migration window, 11 match; five normal messages and two activities were created before SQL32, explaining the four live conversation/client/activity/message deltas. Every original Barka/general route field is unchanged; only Muscat assignment/update time and the agreed investment configuration differ.
- [Sanitized evidence](branch-operations-evidence-20261020.json) and [18-asset verification](branch-operations-assets-20261020.json) are retained alongside this report. Later evidence/migration-filename/diagnostic-only commits leave runtime bytes unchanged.

## Requested behavior and preserved records

Operational headings, branch targets and performance use **مسقط** and **بركاء**. They no longer depend on Hadeel or Maram being the active account. Existing accounts and immutable record authors remain identifiable in account administration and history. A new staff account must not inherit authorship of previous work. Goals belong to the branch and month and are counted once even if several staff contributed.

The failed separate investor number is retired from CRM reception. Investment keeps its existing owner-private logical route, using the already connected Muscat phone and credentials. This does not delete the telephone service or WhatsApp/Meta account. Barka's line, credentials, assignee and activity state remain unchanged. The current general route is active and is preserved as observed, despite an older document saying otherwise.

The owner explicitly requested disabling Hadeel's personal CRM login and retaining Maram's existing account. The separately audited administrative operation makes Muscat reception owner-assigned, disables that one profile, bans future authentication and expires/revokes its existing sessions/refresh access. No user, session, customer, deal, property or message row is deleted. The new Muscat email is still pending from Ahmed; no placeholder account is created.

## Defects and changes

| Finding | Cause | Repair and evidence scope |
|---|---|---|
| Muscat could disappear when the former employee was disabled | Employee-based target/performance row selection required an active account | SQL31 returns stable branch identities and aggregates actual branch records; isolated roles and inactive/multiple-author scenarios cover this |
| Goals were tied to a person rather than the ongoing branch | Employee/month target key and fixed attribution | Copy approved values exactly to branch/month goals, including explicit zero/NULL and milli-OMR; immutable history and exact observed-version conflict checks |
| Editing an old listing could replace its original source after the account became inactive | Active-only source choices and an old fixed-employee database trigger | Preserve a selected inactive historical source, disable only the obsolete trigger reversibly, retain other attribution fields |
| An authorized edit of an existing Muscat visit would fail after its original account was retired | The atomic visit RPC required an active assigned account even when it was unchanged | SQL31 preserves the original inactive assignee on an already-authorized owner/manager edit; new visits and reassignment still require an active eligible account |
| A shared physical line could expose investor work to future Muscat staff | Physical receiving route and private business context were conflated | Service-only route resolver, private request/conversation enforcement, current conversation authorization, logical investment + Muscat transport |
| Stale webhook or request extraction could downgrade/misapply private context | Classification could change between request steps | Sticky private conversation, database checks at message and request-link persistence, propagation on explicit classification, fresh Edge resolution and guarded transaction failure |
| Legacy investor onboarding could revive the retired line | Separate connection buttons/endpoints remained enabled | Settings derive investment's physical number from Muscat; retired direct-bind/embedded-signup routes stop before provider credentials or calls |
| A disabled account could retain stale visible UI | Auth token alone did not revalidate profile state during an open session | Bounded refresh/focus/visibility profile checks, stale session response rejection, cache clearing and Arabic disabled-account error |

## Authoritative data and routing

SQL31 adds `crm_branch_performance`, `crm_branch_target_snapshot`, `crm_branch_monthly_targets` and owner-only `crm_save_branch_monthly_targets`. The previous employee RPCs remain unchanged for database-first compatibility and historical reference. New target/history/backup tables are private and deny application direct access.

Both ordinary branch cards use the same inventory predicate and exact underlying property IDs as property browsing. Weekly qualified additions remain a separate date-scoped goal. Follow-up counts use distinct clients with human outcome evidence. Paid-booking month, completed-sale month and actual receipt month retain their independent financial bases, including partial collection and milli-OMR amounts. Neither disabling a login nor receiving a message creates a booking or changes historic financial allocation.

SQL32 adds nullable `company_lead_routes.transport_route_key`. The logical investment route points to `muscat`, remains owner-only and owner-assigned, and no longer stores an independent phone/Meta ID. Muscat's actual Meta configuration and encrypted credentials are reused without copying or exposing token values.

Known canonical private clients, explicit private requests on Muscat, and already-private conversations stay private. Legacy investor labels, inferred project geography and model guesses are not sufficient to convert ordinary records. Unknown new Muscat inquiries remain ordinary until explicitly classified; temporarily the owner handles Muscat. A new conversation to the Muscat number is necessary for a customer whose only prior thread used another physical number. No customer is messaged automatically to create that conversation.

The database serializes new conversation insertion with explicit client/request classification by company and normalized phone. Existing message processing locks the conversation row and re-evaluates current private context. Request links must match the persisted conversation compartment; a stale AI batch is rejected atomically, including any earlier request changes in that transaction. Existing messages and author/date history are not rewritten by the migration.

## Coverage

| Surface | Verification |
|---|---|
| Branch dashboard/Team/Reports/goals | Node and synthetic desktop/390px browser passed; live owner/Barka SQL RPCs pass; authenticated v11 browser remains unverified |
| Goal saves, retries and conflicts | Isolated acceptance and native concurrent PostgreSQL passed: one effect on retry, one winner on competing stale edits |
| Inventory/source preservation | Synthetic goal/detail/export and historical inactive-source edit tests |
| Owner, Muscat, Barka, manager/viewer, disabled and foreign roles | Isolated role assertions passed; live owner/Barka/retired raw tables, views and relevant RPC restrictions passed |
| Shared reception/manual classification/privacy | Actual Edge handler simulation, full catalog and all four native commit-order races passed; deployed source bytes verified |
| Repeated webhook and out-of-order delivery | Synthetic actual-handler tests; no real provider/customer messages |
| Retired investor onboarding | Synthetic denied endpoints/button state; existing line credentials not read or changed |
| Account retirement | Exact operation and replay/19 guards passed in isolated Auth adapter; production operation and fresh state/preservation verification passed |
| Real password login/refresh after retirement | Not established by SQL state checks or mocked browser tests |
| Fresh Meta delivery, physical phone, Storage/Realtime | Not exercised in this release; previous report limitations remain |

Local verification executed each of the 35 Node test files directly and retained **375 passed cases, zero failures and two PostgreSQL-context skips** (377 total). Final CI independently reports the same case counts; the two context-dependent cases pass in dedicated database jobs. The security harness passed 28 checks. All eleven CI browser suites passed; focused reports include 7 branch-operation groups, 39 performance groups, 39 inventory groups and 56 fault groups, with zero external requests, production writes and browser errors. These are synthetic-role and desktop/390px checks, not new real-password login evidence.

The actual WhatsApp handler tests passed 28 shared-reception cases, alongside 42 investment-boundary and nine semantic/recovery cases. The full catalog in PGlite and native PostgreSQL passed authorization, stale-request atomic rollback, valid private replay, repeated SQL32 application and guarded/exact rollback/reapply. Four native overlaps cover insertion versus classification and existing-message persistence versus classification, in both commit orders. Every result leaves one private thread/message and preserves the ordinary parent. Goal concurrency proves one-effect identical retry and rejection of the competing stale value.

The exact parameterized retirement script executed twice against the isolated full catalog with a minimal synthetic Auth adapter. Nineteen intentional parameter/replay/drift failures preserved complete business/Auth/audit fingerprints. Original-account denial, retained Barka access and preservation of the other accounts/sessions passed. The captured predecessor reproduced the inactive-assignee visit failure; the patched RPC allowed authorized owner/manager edits, preserved original authors and rejected new/changed inactive assignments, stale edits and cross-branch/private/foreign access. SQL31's 35-file catalog chain also passed exact original-function/ACL/owner restoration and safe reapplication. Production table grants were read to reproduce the actual viewing-save policies in the fixture; no production grant expansion was introduced.

## Recovery and deployment

The migration CLI mirrors are versioned alongside `db/changes/31-branch-operations.forward.sql` and `32-shared-muscat-reception.forward.sql`, using actual remote versions `20261020031442` and `20261020032501`.

1. Validate the complete candidate, including native PostgreSQL concurrency and guarded rollback, on the existing validation branch.
2. Capture fresh live catalog/configuration and business-row fingerprints without publishing customer records or credentials.
3. Apply SQL31 followed by SQL32 transactionally. Keep existing API contracts available.
4. Deploy the five changed Edge handlers with their existing gateway verification settings.
5. Publish runtime `20261020-branch-v11` through main/GitHub Pages and verify the public asset bytes.
6. Execute the separately authorized retirement operation with privately supplied confirmed IDs; verify retained account and Barka route exactly, branch metrics, profile/Auth status, expired sessions and revoked refresh access.
7. Record actual live role results, migration/Edge versions, CI/Pages links and material limitations here and in current-state.

Before/after route configuration and catalog definitions/ACLs are preserved privately. Rollback scripts refuse unexpected independent schema/configuration changes and run atomically. SQL31 rollback retains newly entered target/history records privately; SQL32 rollback retains all customer/messages/classifications and the access audit. Neither rollback reactivates the retired login nor resurrects expired sessions. Restoring an earlier schema requires coordinated compatible frontend/Edge versions. No physical backup restoration is claimed from these guarded rollback tests.

The connector's single multi-statement retirement batch retained an earlier `now()` value in its trailing diagnostic, momentarily reporting 19 sessions as future despite their expiry at the later captured wall-clock time. A fresh query proved zero; the script's two final read-only comparisons now use `clock_timestamp()`. The transaction, mutations and replay guards are byte-identical to the operation that was tested and executed. No second retirement or account mutation was needed.

## Production authorization, logs and limits

Fresh transaction-local authenticated claims on the live database prove owner access to both branch metrics, Barka access to its branch and previously assigned general clients with no Muscat rows, and retired-identity NULL role/company with zero rows in the six checked business tables and both protected views. Barka and retired identities are denied branch-goal writes and the service-only routing resolver; retired target reads are denied. Service-role resolver execution is enabled, anon/authenticated execution is disabled, and application reads of the private retirement audit are disabled. SQL31's saved definition/ACL/owner catalog has zero drift after deployment.

The actual controlled production browser loaded the v11 sign-in form and version metadata. No current authenticated session was available, so no new real-password, signed-in dashboard or GoTrue refresh journey is claimed. The console observations contain only browser-extension metadata errors, not an observed application startup error. Earlier October 19 authenticated evidence retains its date and release scope.

The available unified logs for 03:25–03:32 UTC contain five Postgres LOG records and 14 PostgREST records, no PostgreSQL ERROR/FATAL/PANIC entries, and no new function-ingress evidence. Zero new WhatsApp message rows were observed after the new webhook became active. This does not establish fresh live Meta delivery. Cron remains disabled; no external message, test customer, historical backfill or provider onboarding was performed.

Security advisors retain [two protected projection-view findings](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view), [16 privileged-RPC findings](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), including the four guarded branch APIs, and [disabled leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). The latter configuration capability is not exposed by the connected tools. Thirty-five deny-all/private-table RLS informational findings are recorded. Existing performance recommendations remain explicit: 103 unindexed foreign keys, 37 RLS initplan warnings, 15 missing primary keys, 25 unused indexes and 16 multiple permissive-policy warnings. These automated recommendations, including private snapshot/history structures, are not presented as resolved performance defects; this release did not indiscriminately change indexes/policies or claim a full profiling/physical-restore exercise.

## Remaining owner input

Ahmed will supply the new branch-owned Muscat email. That later handover must verify the intended account, assign branch access, and transfer any current responsibility only where needed with an audit, preserving historical authors and financial allocations. Maram's current account remains the Barka login in the interim.
