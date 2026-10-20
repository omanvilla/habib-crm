# Owner dashboard: collapsed work shortcuts

Status: **deployed**, 2026-10-20. Runtime `20261020-dashboard-v12`, validated commit `44e18225f664bd0c95bc389e7d718ea73bdfbef9`, based on prior main `debd5d80dc60192e83c733f6909c4c5357803b55`.

## Requested result

Retain the four top quick actions, heading, approved goals and ordinary/private summaries. Replace initially expanded work lists with compact buttons. Keep period performance in Reports rather than the owner's home page.

## Implementation

- `crm-dashboard-compact.js` is a scoped presentation controller after the operations module. It reuses `crmLoadDashboardWork`, existing delegated record actions and pagination. It adds no database/API call and changes no records, financial definition, permission or routing.
- Six buttons select follow-ups, urgent tasks, visits, open deals, hot opportunities or contacts. Counts use the selected `dashboardWorkSnapshot.totals` field, never first-page length or a summary card's different unique-client measure. Missing data is an em dash; failed loaders preserve the original retry control.
- Only the explicitly selected list is visible. Repeated click, Close or Escape collapses it. Changing ordinary/private workspace clears selection. Pagination and refresh preserve an explicitly selected category. Keyboard focus, `aria-expanded` and `aria-controls` are maintained.
- The duplicate owner performance panel is detached before its loader can query it. Only empty markup is retained for a subsequent non-owner session. Reports' team panel is labeled `أداء الفريق`; its renderer, dates and permissions are unchanged. Non-owner home workspaces are unchanged.
- Top actions, goals and scope summaries are not rebuilt. Styles are owner-dashboard-only: three desktop columns and two narrow-screen columns. Reset clears compact selection and previous work DOM; existing session-generation/backend scope checks remain authoritative.

## Verification

[CI 39446824269](https://github.com/omanvilla/habib-crm/actions/runs/39446824269) passed on the deployed commit:

| Suite | Result |
|---|---|
| Existing Node cases | 375 passed, zero failed; two PostgreSQL-context skips. No new SQL test execution is claimed by this frontend-only gate. |
| Security regressions | Passed without changing or removing assertions. |
| New compact browser | Ten grouped scenarios passed through actual index bootstrap and synthetic SDK; zero external requests/page errors/production writes. |
| Adjacent browser suites | Branch operations, inventory targets, investment, deal-date coherence and inquiry follow-up all passed. |

The new compact suite tests the initial closed state, exact counts and each category, one-list-only selection, repeated click/Close/Escape/Enter and focus, ordinary/private changes, loading failure/retry, more-than-twenty-row pagination, refresh, 390px viewport, report month boundaries including February 2024, reset and unchanged other-role workspaces. CI screenshots contain synthetic records only.

The initial CI attempt failed before security assertions because shallow checkout omitted the historical comparison commit. Adding `fetch-depth: 0` fixed the environment without changing product code or security tests. Local testing used an offline document because this sandbox blocks loopback browser navigation; CI instead ran the complete index/server bootstrap. Local cold-start mobile verification separately measured all six buttons inside a 390px viewport after the responsive layout settled. Neither is evidence of a physical phone or authenticated production role journey.

Older dashboard/performance/preview/fault browser scripts still contain the superseded owner-home performance layout assertions and were not counted as v12 passes. Their calculation/security coverage remains in the existing Node/security and selected Reports/branch tests. Update their navigation to Reports before using those old UI assertions as a future release gate.

## Publication evidence

[Pages 39447321747](https://github.com/omanvilla/habib-crm/actions/runs/39447321747) succeeded for `44e1822`. Main was fast-forwarded with an expected-head check; no unrelated branch work was overwritten. No Supabase migration or Edge deployment was required.

A separate read-only Python HTTP check, [39448111088](https://github.com/omanvilla/habib-crm/actions/runs/39448111088), fetched the root, base HTML and all linked runtime JS/CSS at their actual versioned URLs. At **2026-10-20 15:24:38 UTC**, all **20 responses were HTTP200**, with SHA256 equality to the validated source; root meta app-version was exactly `20261020-dashboard-v12`. Evidence artifact `dashboard-v12-public-assets` (ID `12277337861`) retains URLs, timestamps, status, ETag and expected/served hashes. UI evidence artifact `compact-dashboard-verification` (ID `12276002598`) retains six synthetic-suite reports/screenshots. The public verification workflow remains on its dedicated branch and does not run periodically.

An optional third-party browser summary had reported Vite assets and version `1.0.0`, inconsistent with this source and publication. It is not treated as valid application-UI evidence. The subsequent independent direct HTTP comparison proves the specific served responses and release bytes; it does not establish a new authenticated browser journey. No credentials, client records or application write APIs were used in that check.

## Scope and recovery

No customer data, Auth/RLS state, message, financial amount or backend configuration was changed. Rollback consists of restoring the prior frontend bootstrap or removing the new decorator links; no database rollback is necessary. Prior source, history and dated reports remain available. A fresh live signed-in journey, physical-device check and previously declared backend verification limits remain unverified rather than assumed to pass.
