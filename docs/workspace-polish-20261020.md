# Lists, marketing access and workspace design

Status: **deployed and verified within the scope below**, 2026-10-20. Runtime `20261020-workspace-v13`; validated source `4f274fcdda7ec995f370ae59c343b4a9eac2ca62`, based on v12 main `43bdfe20dabc843744ce308b18bcbe68d4dd42c2`. The continuation recovered the already tested candidate after an interrupted response and published it without recreating the work.

## Owner-visible result

Clients and Properties are stacked/table lists. All existing role, request, search, branch, area, status and archive controls remain; exports follow the same filtered records. Client type selectors are organized above secondary contact/work filters. Property rows include the directly accessible **التسويق** button alongside existing details/edit/archive actions.

Property Detail has an independent **التسويق وروابط الفيديوهات** journal at the top, with **إضافة رابط / نشاط**. Instagram, YouTube and Oman Reel links are retained as separate dated events in the existing property journal. Old events are not replaced when another video is added. Unknown measurements remain unavailable, not zero. Saving a URL is not automatic analytics: Instagram sync still depends on the existing account/provider permissions, while YouTube/Oman Reel measurements are manual.

Reports separates period controls from six descriptive section selectors. Daily work, calendar, visits, deposits, reports, owners, expenses, activity and team use coordinated page/form styling, spacing and controls. Calendar stays. The approved compact home dashboard, goals and private workspace remain. Message templates are removed from the application navigation/page. Instagram is property/content performance only, without DM inbox/composer/polling/read marking. **Deals and deal forms/workflow were not redesigned.**

## Implementation and fixes

The workspace controller converts the exact already-filtered original result DOM into rows after the original controller has captured the export snapshot. It reuses readers, sorting, IDs, actions and permissions instead of creating a second record source. Property rendering observes only the result mount. Empty/error states are not fabricated as zero. Styles are scoped to requested pages/forms and exclude Deals. The base HTML, deal JS/CSS, database and Edge sources are byte-identical to v12, as checked in CI.

The missing marketing button was inside `loadPropertyPerformance`; a combined inquiry/marketing/rejection read failure could prevent it from rendering. The new independent section uses the existing `property_marketing_events` table, complete pagination and session/property-generation guards. It remains usable when that older loader fails. No old events are overwritten/deleted. Publication URLs are validated/canonicalized, including YouTube aliases; an existing publication is not added again by the normal form. Stable operation IDs protect same-form retries and double clicks. A new database-wide canonical-URL uniqueness guarantee across separate concurrent tabs is not claimed. Publication dates use explicit Asia/Muscat interpretation and unknown views stay null. Existing identity/reconciliation/monitoring triggers remain authoritative.

The candidate phase recorded a read-only schema inspection confirming the marketing columns, active link-identity/reconciliation/monitoring/private-write triggers and acquisition-funnel RPC. No production business row was used as test data or changed. This continuation required no additional schema change.

The performance-only Instagram module replaces the DM module in the bootstrap. Existing acquisition-funnel metrics and scoped status/connect/sync functions remain. OAuth requests Insights scopes rather than messaging; it strips the callback hash immediately, waits for the actual CRM profile, binds completion to the initiating owner and processes once. Provider permissions/webhook subscriptions were not revoked, and historical messages were not deleted. No actual OAuth/provider call was performed for validation.

## Tests and coverage

[Workspace CI 39455580967](https://github.com/omanvilla/habib-crm/actions/runs/39455580967) succeeded on the exact deployed runtime commit. The full Node suite and unchanged security harness passed. Three new Insights tests covered delayed profile completion, wrong state/account/role denial, and omission of DM code/scopes. Two PostgreSQL-context skips are not claimed as new SQL execution by this frontend-only gate.

| Surface | Evidence |
|---|---|
| Clients | Actual index bootstrap with synthetic SDK: stacked rows, role/search/branch filters, empty-result recovery and matching CSV |
| Properties | Single ordered rows, original branch/area/status filters and export source, preserved actions |
| Marketing | Old links and genuine zeros preserved; old combined-loader failure cannot hide the journal; YouTube/Oman Reel save, canonical duplicates, unsafe scheme, retained failure inputs, retry and double click |
| Instagram | Performance surface without inbox/message calls; callback/session regressions; provider OAuth/sync not exercised |
| Reports | Redesigned navigation, both branch results, six periods and exact February2024 date boundaries |
| Daily/calendar/visits/deposits/owners/expenses/activity/team | Existing pages/actions retained and narrow-screen layout assertions; not every possible write/filter combination |
| Home and Deals | Compact dashboard10, deal-date18 and inquiry-followup21 scenario groups pass; CI byte guard confirms excluded code/backend unchanged |
| Roles/mobile | Synthetic Muscat/Barka/viewer/session-reset boundaries and ten390px workspaces; not actual employee credentials or physical devices |

The new workspace suite passed **11 grouped scenarios**. Combined with the adjacent suites above, the artifact contains **60 grouped browser scenarios**, with zero recorded external requests, page errors or production writes. Artifact `workspace-v13-verification` ID `12281420786` retains reports and synthetic screenshots. Screenshots must be described as synthetic, not live customer data.

Earlier local testing used an offline document because this sandbox blocks loopback browser navigation. GitHub CI exercised the complete actual index/server bootstrap; the incomplete local Pages export is not treated as an independent clean full-source Node run. Superseded historical grid/DM/home-performance browser expectations were not counted as v13 passes.

## Publication verification

[Pages 39459110072](https://github.com/omanvilla/habib-crm/actions/runs/39459110072) succeeded for `4f274fc`. Main was fast-forwarded with the expected prior SHA, preserving independent history. No Supabase migration/Edge deployment was required.

[Read-only public verification 39459400442](https://github.com/omanvilla/habib-crm/actions/runs/39459400442) independently fetched the actual root and all linked local runtime assets. At **2026-10-20 16:39:49 UTC**, all **22 responses were HTTP200 and SHA256-identical** to source, with root version `20261020-workspace-v13`.

A fresh empty Chromium browser then loaded that production URL and observed the actual sign-in form, exact v13 version, new workspace/performance modules, absence of the template page and Instagram DM elements, and no observed page error or failed request. The browser denied all non-GET/production-API requests; none was attempted. No credentials, login submission, real record read/write or outbound message were used. Artifact `workspace-v13-public-verification` ID `12281214551` contains all served/expected hashes, public startup observations and its unauthenticated screenshot. This proves publication and unauthenticated startup, not a signed-in journey.

The one-time verification workflow is retained only on `codex/workspace-public-verification-20261020` at `95422efb66bab2b33c8b3ef43a7bcf24adad002a`; it is not recurring monitoring or a second production source. Subsequent documentation-only changes leave runtime assets unchanged.

## Recovery and remaining limits

No customer record, Auth/RLS setting, financial amount, backend source or provider configuration changed. Removing a UI does not delete stored historical events/messages. Rollback is restoring the prior frontend bootstrap, not deleting data or rolling back backend migrations.

A fresh authenticated v13 owner/employee business-write journey, actual mobile hardware, new live provider metrics/OAuth, Storage/Realtime and physical backup restoration remain unverified. Earlier retired-account status, missing historical booking/receipt facts, investor-number retirement and disabled leaked-password protection are unchanged. No claim that the entire CRM is error-free follows from this presentation release.
