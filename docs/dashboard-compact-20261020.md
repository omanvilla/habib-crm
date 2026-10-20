# Owner dashboard: collapsed work shortcuts

Owner request, 2026-10-20: retain the existing four top actions, heading, approved goals and ordinary/private summaries; replace the initially expanded work lists with compact buttons and keep period performance in Reports rather than the owner's home page.

## Implementation

- `crm-dashboard-compact.js` is a scoped presentation controller loaded after the existing operations module. It reuses `crmLoadDashboardWork`, the existing delegated record actions and pagination. It issues no database/API request and changes no records, financial definitions, permissions or routing.
- The owner's six work buttons select follow-ups, urgent tasks, visits, open deals, hot opportunities or contacts. Counts use the selected `dashboardWorkSnapshot.totals` field, never first-page length or a different summary's unique-client count. Missing data displays an em dash; loader failures keep their original retry control.
- Only an explicitly selected list is visible. Repeated click, Close or Escape collapses it. Scope changes reset the selection; loading more and ordinary refresh preserve an explicitly open category. Buttons retain keyboard focus and expose `aria-expanded`/`aria-controls`.
- The duplicate owner performance panel is detached before the loader can query it. Only empty markup is retained for a subsequent non-owner session. The existing Reports team panel is labeled `أداء الفريق`; its renderer and Oman-local periods are unchanged. No wider Reports permission is granted. Non-owner home workspaces remain unchanged.
- Top actions, goals and scope summaries are not rebuilt. Styles are restricted to the owner's dashboard; the buttons use three desktop columns and two narrow-screen columns.
- Session reset removes the selection and previous work DOM. The existing session-generation and backend scope checks remain authoritative. This visual change is not new evidence of database isolation.

## Verification and deployment status

Candidate runtime: `20261020-dashboard-v12`, based on deployed v11 `debd5d80dc60192e83c733f6909c4c5357803b55`. No Supabase migration or Edge deployment is required.

Local offline browser verification passed ten scenario groups against synthetic data, with zero page errors or external requests. The sandbox denies loopback browser navigation; this local pass inlined the same scripts/styles and synthetic SDK into an offline document, not a real authenticated session. The dedicated CI instead runs the full `index.html` bootstrap over the isolated preview server.

`tests/dashboard-compact-browser.cjs` covers the initial collapsed state, every category/count, one-list selection, repeated click, keyboard/Close, ordinary/private switching, unavailable-data retry, scoped pagination, refresh, 390px layout, Reports/history-period queries and reset. It also checks that the other four synthetic roles retain their former workspaces. Screenshots contain only test records.

The focused CI gate additionally runs all existing Node and security tests and the branch, inventory, investment, deal-date and inquiry-follow-up browser suites. The older dashboard/performance/preview/fault browser scripts include assertions for the intentionally removed owner-home performance control; they are historical v11 layout scenarios, not used as the v12 release gate. Their underlying calculations and authorizations remain covered by the Node tests and dedicated Reports/branch regressions. Do not claim the old UI-only assertions passed against v12 without adapting their navigation to Reports.

Production publication and served-asset checks are recorded after the candidate gate succeeds. No real customer record is written and no message is sent by verification.
