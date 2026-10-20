# Lists, marketing access and workspace design

Status: candidate, not yet a production claim. Based on main `43bdfe20dabc843744ce308b18bcbe68d4dd42c2`. Frontend tag `20261020-workspace-v13`.

## Latest owner request

Return Clients and Properties to stacked lists instead of multi-column expanded cards. Preserve the current branch, area, status, role, request and search filters. Restore each property's marketing journal for Instagram, YouTube and Oman Reel. Use a consistent restrained Arabic design across daily work, visits, deposits, reports, owners, expenses, activity and team; retain calendar. Keep the already approved compact home dashboard. Do not change the Deals workspace or its workflow. Remove message templates and Instagram direct-message UI; retain property/content performance.

## Implementation boundary

The new workspace controller converts the exact already-filtered original result DOM to rows, after the original controller has captured the matching export snapshot. It preserves existing readers, sorting, IDs, actions and permissions. Property row rendering is observed only at the existing result mount. Empty/error states are not fabricated as zero rows. Styles are scoped to requested pages/forms; Deals and deal forms are excluded. Existing business/database/Edge source is unchanged.

The marketing control was previously inside `loadPropertyPerformance`, whose combined inquiry/marketing/rejection read could fail before the add button was rendered. A new independently loaded marketing section sits at the top of Property Detail and is reachable directly from every property row. It uses the existing `property_marketing_events` table, complete pagination and session/property-generation guards. No old events are overwritten or removed. Publication links are validated and canonicalized, including YouTube aliases, and a repeat existing publication is not inserted again. Stable client operation IDs prevent duplicate same-form retries; separate concurrent browser tabs are not claimed to have a new database-level canonical-URL uniqueness constraint. Unknown views remain null; dates are explicitly interpreted in Asia/Muscat. Existing database triggers still generate link identity, reconcile proven saved-link inquiries and update property monitoring.

The live read-only schema inspection confirmed the required marketing columns, the active link-identity/reconciliation/monitoring/private-write triggers and the acquisition-funnel RPC. No production business record was read as test data or written.

Instagram loads a performance-only module instead of the DM module. It delegates metrics to the existing acquisition-funnel renderer, and retains scoped status/connect/sync actions without inbox/list/messages/send/read polling. OAuth asks for Insights, not message permissions. This is removal of the application DM surface, not a claim that provider permissions/subscriptions have been revoked or historical messages deleted. No actual OAuth/provider call is part of validation. Instagram statistics still depend on the existing connected account and provider permissions. YouTube/Oman Reel metrics remain explicit manual measurements, not invented automatic analytics.

Reports has a separate period panel and six descriptive section selectors while preserving all report functions, Muscat boundaries, finance formulas and protected access. Other workspaces retain their original actions with scoped typography, spacing, controls and row treatment. No new business features or permissions are introduced.

## Verification to date

Local offline Chromium with synthetic SDK passed eleven grouped scenarios: compact dashboard retained, client role/search/branch/export, property filters, independent marketing despite an injected old-loader failure, publication/duplicate/unsafe-URL/save-failure/double-click cases, manual Oman Reel date/null metrics, Instagram performance without DM calls, report leap-month/branch figures, requested-page/deal exclusion, ten 390px workspaces, and synthetic branch/viewer/session reset. All external requests were denied; final test run recorded zero attempted external requests and zero page errors. These are UI fixture results, not production RLS or real account sessions.

The sandbox blocks local HTTP browser navigation, so local checks used an offline document. GitHub CI must run the complete actual index bootstrap against the deny-external preview server, full repository Node/security checks and adjacent dashboard/deal-date/inquiry suites before publication. The Pages artifact used locally omits `_shared` source directories and adds Jekyll HTML; local all-repository Node results are therefore not treated as a clean full-source test result.

No SQL migration, Edge deployment, customer send, live business write, destructive deletion or authentication setting change is required. Rollback is frontend-only. Final CI/publication evidence and remaining verification limits will be recorded after the gate completes.
