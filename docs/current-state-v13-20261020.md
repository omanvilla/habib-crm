# Habib CRM — current state

Updated 2026-10-20. Read with `AGENTS.md`. Earlier release evidence and limitations remain in [the v12 state archive](current-state-v12-20261020.md) and [the v11 archive](current-state-v11-20261020.md). Latest explicit owner instructions govern.

## Latest deployed change: stacked lists, marketing and workspace presentation

Frontend **`20261020-workspace-v13`**, validated runtime commit **`4f274fcdda7ec995f370ae59c343b4a9eac2ca62`**, is deployed through main. [Workspace CI 39455580967](https://github.com/omanvilla/habib-crm/actions/runs/39455580967) and [Pages 39459110072](https://github.com/omanvilla/habib-crm/actions/runs/39459110072) passed. The interrupted attempt had saved and tested the candidate but had not published it; the continuation reviewed and published that same candidate without restarting the completed implementation.

At **2026-10-20 16:39:49 UTC**, independent public GET verification found all **22 runtime files HTTP200 and SHA256-identical** to validated source. A fresh empty Chromium browser loaded the actual public v13 sign-in form with both new modules, no message-template page or Instagram inbox, and zero observed page errors, failed requests, blocked API attempts or production writes. [Public verification 39459400442](https://github.com/omanvilla/habib-crm/actions/runs/39459400442). This is unauthenticated startup evidence, not a real signed-in account journey. Later documentation-only commits do not change runtime bytes.

### Implemented interface

- Clients and Properties use ordered stacked/table rows, not the expanded multi-column card grids. Existing role/search/request/branch/area/status/archive filters, pagination and exact matching export snapshots remain authoritative. Client type tabs and secondary work filters are organized separately. Mobile uses one record after another with readable labels and actions.
- Property lists expose a direct **التسويق** action. Property Detail begins with an independent **التسويق وروابط الفيديوهات** journal and **إضافة رابط / نشاط**. Failure of the older combined performance reader cannot hide this control. Existing Instagram, YouTube and Oman Reel events/dates remain in `property_marketing_events`; no historical record is overwritten or deleted by this release. URL validation, same-form retry IDs, duplicate-publication detection, unknown metrics and explicit Muscat publication dates are tested. No new database-wide canonical-URL constraint across concurrent tabs is claimed.
- Instagram loads `crm-instagram-performance.js` instead of the DM module. The application exposes property/content performance and scoped status/connect/sync only, without inbox, message polling, compose or read marking. Insights OAuth no longer requests message permissions and safely waits for the initiating owner's loaded profile. Existing provider permissions/subscriptions and historical message records are not revoked/deleted by frontend removal.
- Reports separates period controls from six descriptive section selectors, retaining the exact report sources, protected fields and date/financial rules. Daily work, calendar, visits, deposits, owners, expenses, activity and team receive scoped typography, spacing, controls and table/card treatment. Calendar remains available. Branch goals remain separate from account administration.
- The compact owner dashboard retains the approved four top actions, targets, ordinary/private summaries and six collapsed work categories. Period performance remains in Reports. **Deals page, forms and workflow are excluded**; CI verified the base HTML, deal JS/CSS and all db/Supabase sources byte-for-byte against v12.

### Verification and publication

The complete repository Node tests and security harness passed on `4f274fc`. The new workspace browser suite passed **11 grouped scenarios** through the real index bootstrap and synthetic SDK; adjacent compact-dashboard10, deal-date18 and inquiry-followup21 groups also passed. Their artifacts report zero external requests, page errors and production writes. They cover filters/exports, marketing loader isolation, duplicate/invalid URLs, retained inputs and retries, manual dates/null metrics, no Instagram message calls, report leap-month boundaries, role/session resets and ten narrow-screen workspaces. The three new Insights tests cover delayed profile completion, wrong state/account/role denial and omission of messaging code/scopes. PostgreSQL-context Node skips remain distinct; this frontend-only release did not rerun or modify SQL migrations.

The synthetic UI artifact is `workspace-v13-verification` (ID `12281420786`); public byte/startup evidence is `workspace-v13-public-verification` (ID `12281214551`). The read-only verification workflow remains only on `codex/workspace-public-verification-20261020` (`95422efb66bab2b33c8b3ef43a7bcf24adad002a`); it is not recurring or a production source. Application review branch `codex/workspace-polish-20261020` retains the validated runtime. See [implementation, release and limitations](workspace-polish-20261020.md) and [evidence summary](workspace-polish-evidence-20261020.json).

No SQL migration, Edge deployment, Auth/RLS change, customer message, live business test write or destructive deletion occurred. Rollback is frontend-only to the v12 bootstrap; retain current customer data and backend state.

## Production rules retained

- Production is GitHub Pages from main. Operational identities and goals are **مسقط** and **بركاء**, independent of staff names/count or login status. Preserve original authors, financial allocations, actual dates, approved goals and shared inventory-detail predicates.
- Hadeel's personal login remains retired. Never reactivate it for tests. Maram's Barka account remains active. Muscat is temporarily owner-assigned pending Ahmed's new branch-owned email; no replacement account is invented.
- Owner-private investment uses the existing Muscat transport with `transport_route_key=muscat`; unknown new contacts are ordinary until explicitly classified. Preserve all branch/private boundaries. Do not restart the retired separate-number onboarding.
- Latest backend remains SQL31=`20261020031442`, SQL32=`20261020032501`; Edge versions from v11 remain webhook38/send16/inbox13/direct-bind12/embedded-signup7. This release changes none of them.
- Actual paid-booking date fixes the goal month; closing and collection have independent dates. Do not duplicate a booking, guess historical evidence or change financial amounts/shares. Preserve milli-OMR.
- Scheduled follow-ups remain disabled. Never send customer test messages or modify real records for UI testing.

## Remaining verification limits

No fresh signed-in v13 owner/employee business-write journey or physical phone was used. Synthetic role fixtures and public startup do not replace production RLS/authenticated evidence. New actual Instagram OAuth, provider metric sync, WhatsApp ingress, Storage/Realtime and physical backup restoration remain outside this release. Earlier data-quality gaps and disabled leaked-password protection remain unchanged and documented in the v11 archive. Saving a URL does not automatically obtain views: Instagram metrics depend on the existing connection/provider permissions; YouTube and Oman Reel metrics in this release are manual.

Older browser tests that assert the pre-v12 owner's expanded lists/home performance or pre-v13 grid/Instagram inbox are superseded UI expectations, not recorded as passes. Use the current workspace/compact suites and update those old navigation expectations before treating them as future gates; do not silently reinstate retired UI to satisfy historical tests.
