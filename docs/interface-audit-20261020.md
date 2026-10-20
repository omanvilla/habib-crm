# Interface review and design v14

Status: **deployed, tested and verified to the scope stated below**, 2026-10-20.
Runtime `20261020-design-v14`; validated commit `d49357224002fff16d0c194013256d15e9cc8c57`; baseline main `70f413f9e5e95824f8237ffc99a52a5418d78c33`. Latest instruction requests a renewed review, coherent typography/icons/colors and fewer useful controls, retaining property marketing and prior approved workflows.

## Design and practical controls

The interface uses IBM Plex Sans Arabic with a consistent readable hierarchy, evergreen navigation and primary actions, white/off-white surfaces, restrained gold focus/accent and common spacing/borders. Static UI icons are line SVGs, including mobile navigation. Sidebar width no longer expands unexpectedly on desktop hover. Reduced motion, visible keyboard focus, labeled controls and touch sizing are retained.

Clients keep stacked results and the exact existing filter/export snapshot. Name/phone, type, branch, follow-up and archive selectors replace multiple rows of filter buttons. Request-specific search fields remain under an advanced-search disclosure. Properties retain search/branch/area/status and archive selection, and keep **التفاصيل** and **التسويق** directly visible. Edit/archive and other secondary actions move into **المزيد** using their original DOM nodes/handlers, not duplicate implementations. Client detail retains primary contact/WhatsApp/new-request actions. Calendar remains. Reports retains its six periods, actual Oman boundaries and calculations. The compact home dashboard, private scope and goals remain as approved.

The new style is scoped to the shared shell and requested workspaces. The **Deals workspace/forms/workflow are excluded**; base HTML and dedicated deal scripts/styles are byte-identical to v13. Database and Edge source also remain byte-identical. No extra business features, permissions or financial formulas were introduced.

## Proven defects and repairs

| Defect | Cause | Repair and proof |
|---|---|---|
| List contact editing could silently do nothing or use an earlier client's detail | The list passed an ID but the old editor ignored arguments and used a shared selection | Resolve the exact ID under existing RLS; require returned identity; reject stale operation/navigation/session/permission states; open the original form only after acknowledgment. Four Node regressions and a real UI click in synthetic bootstrap pass. |
| Follow-up alert could activate the wrong classification/filter state | Obsolete nth-child source-button position | Find and invoke the actual follow-up control, preserve its original implementation; the selected native filter and `clientRoleFilter` are asserted together. |
| Customer name/chat-title emojis changed in displayed text | Broad legacy cleaner traversed UI containers with dynamic customer text | Stop loading that cleaner; new icon replacement targets application controls only. Customer strings with emoji are asserted unchanged. No stored record was modified. |
| Programmatic/detail navigation left a stale highlighted section | Link highlight depended on a passed DOM node | Derive the active link from the actual current page, mapping client/property details to their parent; keyboard navigation remains supported. |
| Empty toast surface could remain above mobile navigation | Transformed hidden toast retained a visible surface | Explicit hidden visibility/opacity; meaningful status/error messages still appear. Tested at390px. |
| Early work shortcuts retained fallback glyphs | Initial work could render before the later icon module was parsed | Full index bootstrap reproduced it. One DOMContentLoaded repaint updates presentation without another API call; the original six-SVG assertion subsequently passes. |

No save confirmation, authorization or validation was removed to simplify buttons. Existing failed-load states remain errors rather than fake zeros. Open More menus and adapted selectors are reset on session changes; the presentation observer settles without an infinite DOM repaint loop.

## Renewed audit and coverage

This pass used source review, existing regression catalog, fresh read-only live schema/role reads, actual-browser synthetic fixtures and public deployment checks. Earlier dated audit inventories remain useful history; they are not proof of newly exercised UI actions. Eighteen non-Deals workspaces were opened and checked for the common design; seventeen were checked at390px. A page/font/overflow observation is deliberately distinguished from an end-to-end write.

| Area | What passed in this release | Not established |
|---|---|---|
| Clients/Properties | Existing filter/search/archive selectors, exact filtered export, stacked rows, More/keyboard, exact selected-client edit, role controls, late/session responses | Every live account/write combination |
| Property marketing | Independent journal, retained old links, Instagram/YouTube/Oman Reel input, canonical duplicate rejection, unsafe URL rejection, retry/double click, explicit Muscat dates and unknown metrics | New provider metrics, concurrent-tab canonical uniqueness beyond existing DB constraints |
| Home/goals/reports | Compact category counts/scopes, retries/pagination, preserved branch goals, both branch report results, six periods and leap-month boundaries | New authenticated production walkthrough |
| Visits/bookings/receipts | Existing native SQL workflow/financial suites, actual booking month, partial receipts, cancellation/correction, idempotency/concurrency, chronology and staff field masking; related synthetic forms | Fresh production business writes or guessing missing historical facts |
| Accounts/privacy | Native SQL role tests; fresh anon/Barka/retired/owner live claims; no privilege or routing changes | Password recovery/forced expiry/actual refresh or retired-password sign-in |
| Tasks/calendar/deposits/owners/expenses/activity/team | Existing workspaces, action preservation, native task/visit/deposit/owner selectors, common typography and narrow-screen layout | Every secondary action, export and filter combination |
| WhatsApp/Instagram | Existing handler/security and native private-route regressions; WhatsApp source unchanged; Instagram performance remains without DM | New operator-driven provider delivery, OAuth or metric sync |
| Storage/backups | Current bucket metadata and unchanged source; guarded migration rollback/reapply in isolated PostgreSQL | Sensitive attachment network/RLS journey, Realtime delivery, physical restore |

### Live read-only observations

Public base tables all have RLS enabled. Under anon, the six inspected business tables returned zero rows. Barka returned zero Muscat clients, conversations and protected property-view rows, and zero canonical private clients/requests/conversations. The retired identity returned null role/company and zero clients, requests, messages, marketing, property-view and deal-view rows. Owner controls returned actual nonempty rows and both saved branch goals. All role assertions were transaction-local and rolled back; they are not authenticated browser sessions.

The latest migration ledger remains SQL31 `20261020031442` and SQL32 `20261020032501`, following SQL30. Cron remains disabled. The existing public property-images bucket remains public; this observation is not a claim about all attachments. Ordinary WhatsApp rows were being stored and the inspected last-day processing-error aggregate was zero. No customer was sent a test message, and this is not substituted for an end-to-end provider test.

Security advisors retain **two protected SECURITY DEFINER projection findings**, **16 authenticated privileged-RPC warnings**, **35 private/deny-all RLS information notices**, and **disabled leaked-password protection**. Role tests provide evidence for the inspected scopes, not grounds to suppress the findings or indiscriminately broaden grants. References: [protected-view advisory](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view), [privileged-RPC advisory](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Auth configuration changes are not available through the connected project tools. Full live query profiling and every catalog relationship were not repeated or claimed verified from this interface pass.

## Automated release evidence

[Final CI 39467518482](https://github.com/omanvilla/habib-crm/actions/runs/39467518482) passed all **seven jobs** on the published commit. **382 Node cases** and **28 security checks** pass; two PostgreSQL-context Node cases are separately exercised by the native SQL jobs. Five PostgreSQL16 suites execute the exact original source workflow's steps: attribution, workflows, investment, reservations and comprehensive catalog through SQL32. This includes real concurrent saves/private routing races, guard failures, exact rollback/reapply and the isolated account-retirement adapter. Existing SQL fixtures/assertions are unchanged.

Five actual index/server-bootstrap synthetic-browser suites passed **70 grouped scenarios**: design10, workspace11, compact10, deal dates18 and inquiry21. Artifact `interface-v14-browser`, ID `12284854046`, was downloaded and inspected: zero page errors, external requests and production writes in all five reports. The design observer recorded zero settled mutations. Screenshot records are synthetic and must be labeled accordingly. Local offline-document results are separate because this sandbox does not support browser navigation to its loopback server; CI supplies complete bootstrap verification.

The first release candidate passed Node/security and all five SQL jobs but failed its initial icon assertion in full bootstrap. The cause was fixed in application presentation; assertions were not weakened. The final complete gate above passed. Historic suites asserting retired grid/DM/expanded-home UI are not relabeled as current passes.

## Publication and recovery

[Pages 39467959784](https://github.com/omanvilla/habib-crm/actions/runs/39467959784) succeeded for `d493572`. Main was updated with an expected-head check, without overwriting independent work.

[Public verification 39468123768](https://github.com/omanvilla/habib-crm/actions/runs/39468123768) independently compared the actual root and all linked local HTML/CSS/JS at **2026-10-20 17:40:33 UTC**: **24 HTTP200 responses, all SHA256-identical to validated source**, root version `20261020-design-v14`. An empty production Chromium session then loaded the sign-in form, design class/icon renderer, and IBM Plex Sans Arabic400/600 fonts. There were zero observed page errors, failed requests or attempted business API requests. Old emoji-cleaner and Instagram-DM modules were absent. No credentials or real record reads/writes were used.

Public artifact ID `12284798932` contains hashes, timestamps, startup observations and its unauthenticated screenshot. Its one-time workflow remains on `codex/design-public-verification-20261020` at `703be16bf85cf28f2dfe79561852d64b8466f89b`; no recurring watch was created. Subsequent docs-only commits do not change runtime files.

No production data, Auth/RLS setting, monetary amount, stored author, database definition or Edge deployment changed. No SQL migration was necessary. Rollback restores the v13 frontend bootstrap and preserves current data/backend. Physical devices, fresh signed-in writes, forced-auth lifecycle, external-provider tests, sensitive attachments/Realtime and physical restoration remain explicit limitations; a successful publication is not a claim that the entire CRM is error-free.
