# Habib CRM — current state

Updated 2026-10-20. Read with `AGENTS.md`. Latest owner instructions govern. Earlier implementation and verification are preserved in [v13](current-state-v13-20261020.md), [v12](current-state-v12-20261020.md), and [v11](current-state-v11-20261020.md) archives; their dated limitations are not silently marked resolved.

## Latest deployed release: unified interface and regression audit

Frontend **`20261020-design-v14`**, validated runtime **`d49357224002fff16d0c194013256d15e9cc8c57`**, is deployed from main. [All seven CI jobs passed](https://github.com/omanvilla/habib-crm/actions/runs/39467518482); [Pages publication succeeded](https://github.com/omanvilla/habib-crm/actions/runs/39467959784). Independent public GET verification at **2026-10-20 17:40:33 UTC** proved **24/24 runtime files HTTP200 and SHA256-identical** to the validated source. A fresh unauthenticated production browser loaded the v14 login form, actual IBM Plex Sans Arabic 400/600 font faces and new icon/controller modules with no observed page error, failed request or attempted business API request. [Public verification](https://github.com/omanvilla/habib-crm/actions/runs/39468123768). Later documentation-only changes do not alter runtime bytes.

### Current interface agreement

The shared shell and non-Deals workspaces use one Arabic font hierarchy, quiet off-white/white surfaces, evergreen navigation/actions and restrained gold accents. Application icons are consistent SVG line icons. Do not strip or rewrite emojis from actual customer names, notes or messages. Native filter selectors delegate to existing controllers and keep every permitted filter. Advanced request search is collapsible. Secondary row actions are under keyboard-accessible **المزيد**; the original action nodes and permissions remain. **التسويق stays directly visible** on every property row. Keep the approved stacked lists, compact owner dashboard/branch goals, Reports performance, calendar and performance-only Instagram. Message templates/DM stay removed from the current frontend. The Deals page, forms and workflow are not redesigned.

The old `modern-v17.js` broad text cleaner is no longer loaded; the historical file remains. Its interface responsibilities are replaced by the narrowly scoped design controller. `crm-dashboard-compact.js` only changes icon presentation and one initial repaint; its counts, private scopes and actions are unchanged. Source for base HTML, dedicated deal JS/CSS, db/ and supabase/ is byte-identical to v13, enforced by CI.

### Functional defects corrected

- List **edit-client** previously supplied an ID to an editor that ignored it and used the last detail selection. `crm-client-edit-v14.js` now reads the exact selected client through existing RLS before opening the original form. Error/mismatched rows, permission loss, newer selection or session reset never open the stale editor.
- The follow-up alert used an obsolete positional button selector; it now invokes the actual follow-up filter, keeping the displayed selector and results aligned.
- Removed broad displayed-text emoji mutation, repaired active parent navigation after programmatic/detail navigation, unified mobile navigation icons and removed an empty hidden-toast surface.
- Full-bootstrap CI found initial fallback icons when data completed before the later design module. A one-time DOMContentLoaded presentation refresh fixed it without an extra query; the unchanged assertion then passed.

### Verification

**382 Node cases passed**, with two PostgreSQL-context cases verified separately by the existing database jobs; security **28 checks** passed. Five native PostgreSQL suites reran the original unmodified SQL steps for attribution, workflows, investment, reservations and the comprehensive catalog through SQL32, including real concurrency and guarded rollback/reapply. No live migration was applied.

Actual index/server bootstrap with synthetic SDK passed **70 grouped browser scenarios**: design10, workspace11, compact10, deal dates18, inquiry follow-up21. Artifacts contain zero recorded external requests/page errors/production writes. The new design coverage inspected 18 desktop surfaces and 17 at390px; those page/font/overflow checks do not certify every action. Marketing save/retry/duplicate/date tests, filter/export tests, guarded client editing, keyboard More/menus, privacy/session reset and current financial-date regressions are separately recorded. Browser artifact ID `12284854046`.

Read-only production SQL checks proved no unprotected public base table, zero anon rows in the six checked business tables, zero Muscat/private results on the six inspected Barka paths, and null role/company plus zero inspected business/view rows for the retired identity. Owner positive controls were nonempty and both branch target rows loaded. These are transaction-local role assertions, not fresh authenticated browser journeys. Current migrations remain SQL31=`20261020031442`, SQL32=`20261020032501`; scheduled follow-ups remain disabled. Natural WhatsApp processing was observed without nonempty processing errors in the inspected last-day query, not an operator-sent end-to-end test.

See [audit, coverage and release](interface-audit-20261020.md) and [sanitized evidence](interface-audit-evidence-20261020.json). The one-time public verification workflow is only on `codex/design-public-verification-20261020` (`703be16bf85cf28f2dfe79561852d64b8466f89b`), artifact ID `12284798932`. It is not recurring monitoring. Application review branch is `codex/interface-audit-20261020` at the validated runtime.

## Preserved business rules and limits

Operational identities remain Muscat/Barka, independent of personnel. Hadeel stays retired; Maram stays active; Muscat remains owner-assigned pending Ahmed's new branch-owned email. Preserve original authors, historical sources, commissions and dates. Canonical investment remains owner-only through Muscat transport; do not restart the retired separate-number integration.

Goals and reports retain the same sources: current available inventory versus weekly additions; human outcome-documented contact; actual paid-booking month versus independent closing and receipt dates; partial receipts and milli-OMR precision. No expected commission becomes automatic cash or staff entitlement. Missing historical booking/receipt facts remain unknown. No customer, property, message or financial record was edited/deleted for this release. No outbound test message, Auth/RLS change, Edge deployment or production schema change occurred. Recovery is restoring the v13 frontend bootstrap, not altering data.

Security advisories remain two protected-definer-view findings,16 authenticated privileged-RPC warnings,35 private/deny-all RLS informational findings and disabled leaked-password protection. They are documented, not claimed fixed by successful UI/role tests. Fresh password login/recovery/forced refresh, signed-in production business-write journeys, physical mobile devices, new provider OAuth/analytics/delivery tests, sensitive attachment/Storage/Realtime network tests and physical backup restoration remain unverified. No broader permissions, reactivated account or fabricated token was used to obtain test access.
