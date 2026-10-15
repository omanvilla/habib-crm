# Dashboard workspace — October 15, 2026

## Request and verified causes

Ahmed requested a professional, practical dashboard; clear top shortcuts; separate combined Muscat/Barka work and private owner investment work; usable action indicators; clear performance definitions; and temporary removal of the property-action/Instagram-publishing section from the dashboard. Existing employee branch and investment privacy rules remain authoritative.

The live owner contact queue was the principal loading failure: its existing correlated client/request query exceeded 100 seconds in the read-only audit. The previous dashboard waited on seven calls together, so one rejection discarded the entire snapshot and left other legacy indicators spinning. A logically equivalent materialized client/request plan completed in about one second without changing permissions.

The reported sales discrepancy is real: a sale closed in October follows an August completed visit. The old visit-to-sale metric selected the visit by the reporting period while the sales metric selected the sale by its closing date. The repair counts period sales backed by actual earlier completed visits; it does not fabricate or change visits, commissions or dates.

Muscat's zero linked-property inquiries is different from zero incoming contacts. Manual visits create interests without pretending to be inbound inquiries. The audit found 12 pending inbound references that now have exact unique saved marketing links, because those links were added after the messages arrived. Seven October messages have consistent client/inbox/property branches and explicit sale evidence and are eligible for a bounded repair. Five others remain pending: three branch/assignment conflicts and two without explicit listing sale evidence. Reconciliation uses original evidence only. Existing client routes, assignments, identity and nonempty classifications are protected; a missing classification may become buyer only for the verified sale listing through the existing request-summary behavior. Other ambiguous messages remain review work; no broad historical inference is approved.

## Release and verification

Runtime `97fd6b4e8fdda73b5279e93aa1cbc74dced457c4`, frontend `20261015-dashboard-v16`, was promoted to `main` after all five jobs passed in [CI run 38747088769](https://github.com/omanvilla/habib-crm/actions/runs/38747088769). Node: 197 passed, 2 existing SQL-context skips, zero failures; security harness: 26 passed. Real PostgreSQL 16 fixtures cover dashboard counts, exact paging, owner/employee/manager/viewer boundaries, private mixed-parent work, visit-backed sales, parent-preserving inquiry reconciliation and performance rollback. Synthetic browser tests cover desktop/mobile, failures/retries, scoped actions and account-switch races; no real employee session was used.

Deployed migrations:

| Change | Live migration | Prepared source timestamp |
|---|---|---|
| SQL19 workspace and contact queue | `20261015135741` | `20261015133824` |
| SQL20 period performance | `20261015135749` | `20261015133831` |
| SQL21 saved-link reconciliation | `20261015135800` | `20261015133838` |
| Private inquiry audit table | `20261015135859` | Generic schema only; reviewed IDs remain private |

CLI source timestamps record preparation, while the MCP assigns the actual applied versions above. Do not blindly push these prepared migrations to production as new migrations; reconcile with the live history first. SQL19/20 store original catalog definitions and ACLs for rollback. SQL21 rollback stops future reconciliation without deleting valid recorded evidence.

`whatsapp-webhook` version 36 is ACTIVE; retrieved source exactly matches the runtime. Existing webhook signature verification and `verify_jwt=false` remain unchanged. This release sends no customer messages and does not enable follow-up automation.

Actual production DB/RPC reads, with transaction-local role claims and an 8-second statement limit, completed in 2.15s for owner ordinary work, 1.57s for owner investment, 4.29s for Muscat and 3.49s for Barka. The owner ordinary snapshot returned 6 clients due, 10 hot clients, 13 open deals and 8 urgent tasks; investment currently had no work. Both staff investment calls were denied with `42501 investment_owner_only`. Employee performance returned only that employee. Paging preserved exact counts without duplicate list items; private and ordinary owner scopes did not overlap. Dates and refresh timestamps use Oman time.

October production performance now shows the Muscat employee with one closed sale, one sale backed by a prior visit and unchanged OMR 2,000 company commission. Barka has 11 proven property inquiries after the repair. Muscat remains zero proven linked inbound inquiries; this does not mean zero incoming contacts or visits. The unresolved cross-branch reference was deliberately not guessed into that total.

Before the bounded data repair, protected projections of all 1,220 clients, 1,132 requests, 34 properties, 55 deals and 4 route configurations matched the predeployment snapshot exactly. The subsequent seven-message transaction created seven property requests/inquiries/attributions using original October message timestamps. Seven affected client summaries refreshed through existing triggers; four previously empty classifications became buyer for an explicitly advertised sale. Existing nonempty classifications, identity, route and assignment stayed unchanged. All five excluded messages remain pending with no attribution. Existing conversations, properties, routes, activities and the affected clients’ 48 outbound messages are unchanged. The repair stores full before/after evidence in a revoked, RLS-enabled private table; the helper retry returned zero changes.

Security-advisor WARN/ERROR findings are unchanged. Three additional INFO findings are the deliberately inaccessible private backup/audit tables with RLS and no client policies. The existing advisor findings remain separate maintenance work; this release does not claim that the whole CRM is free of security findings. [Supabase explanation of private tables with no RLS policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

All audit examples and captures remain private; no client identifiers or message bodies belong in this public document. Actual authenticated employee walkthroughs and a fresh real inbound WhatsApp event remain distinct from the completed database/synthetic checks. Property-action publishing reminders are hidden only on the dashboard pending Ahmed’s redesign; existing records and other pages remain intact.

Public [Pages run 38747678465](https://github.com/omanvilla/habib-crm/actions/runs/38747678465) succeeded for the runtime above. The four changed frontend assets returned HTTP 200 and matched the validated Git blobs exactly. Fresh unauthenticated Chromium displayed v16/login with zero page, console or request errors; it submitted no forms and sent no writes. Independent HTTP verification used the configured certificate trust. This login smoke is not authenticated dashboard-browser evidence; the separate synthetic and actual DB checks described above cover those layers.
