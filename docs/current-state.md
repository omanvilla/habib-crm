# Habib CRM — current state

Updated 2026-10-15. Read this with `AGENTS.md` before work. This file distinguishes deployed changes, direct verification and remaining work. Older dated reports remain evidence, not competing product rules.

## Where the work is

| Surface | State |
|---|---|
| October 15 investment work | In validation: owner-only `investment` manual workflow, existing request qualification/milestones, linked-record/RPC/Edge isolation, and future investment-line preparation. No historical investor conversion or Meta onboarding attempt. See `docs/investment-owner-only-20261015.md`. |
| October 11 WhatsApp follow-up | Deployed and verified: receiving-line fallback replaces the unknown-geography Muscat default; 48 affected clients and 53 linked requests repaired with private before/after evidence; complete Clients-page pagination published. See `docs/whatsapp-client-routing-20261011.md`. |
| October 11 visit update | Deployed and verified: inline client creation/selection in New Visit and automatic loading of all permitted client options. Frontend-only; no database migration. See `docs/visit-client-20261011.md`. |
| October 3 release | Completed: matching database changes and frontend deployed. Ahmed's standing instruction now authorizes direct deployment after validation, followed by his live review. See `docs/release-20261003.md`. |
| Production website | GitHub Pages from `main`; published runtime `e38bac4392a26b7d4cf660d6fc13d92316841142`, frontend `20261011-whatsapp-clients-v14` |
| Validation branch | `codex/role-workflows-ui-preview-20260930`; October 11 candidate validated here, then fast-forwarded to `main` under the standing deployment authorization. Earlier [PR #1](https://github.com/omanvilla/habib-crm/pull/1) remains merged. |
| Release validation | Runtime `e38bac4392a26b7d4cf660d6fc13d92316841142`: all four jobs passed in [run 38123904162](https://github.com/omanvilla/habib-crm/actions/runs/38123904162): `attribution-sql`, `synthetic-browser`, `workflows-sql`, `node-tests`. Local Node: 126 passed, 2 SQL-context skips; security harness: 26 passed. |
| Public deployment verification | [Pages run 38124246664](https://github.com/omanvilla/habib-crm/actions/runs/38124246664) succeeded at runtime `e38bac4392a26b7d4cf660d6fc13d92316841142`; public `index.html` and `app-base-v15.html` returned HTTP 200 and matched source bytes exactly; version v14 verified. |
| Supabase | `dmsckqjkcnsfmnzfjczz`; WhatsApp routing migration `20261011081328` / `whatsapp_branch_fallback_20261011` applied; webhook v34 ACTIVE and retrieved source matches the runtime commit byte-for-byte; inbox v12 retained; deployed separately from Pages |
| Approved production business change | Classified property attribution to Hadeel/Muscat and Maram/Barka; standing inventory target 10, migration `approved_branch_employee_attribution_20261001` |
| Deployed database changes | SQL17 applied as migration `20261011081328`; audited backfill repaired 48 clients / 53 linked requests, with 48 private before/after snapshots and original identity, dates and business-field assertions passing. SQL12–16 remain deployed as migration `20261003050357`; their private backup captured 88 catalog/integrity entries and preserved original deal/visit/rejection fingerprints. |

The October 2 conversation mentioned local Codex commit `d3c7481` on `work`. It was not found on GitHub and is not evidence of a production deployment. Inspect that local workspace if it becomes available; do not recreate or discard unseen local changes.

## Latest agreed behavior

- From October 3, ordinary requested CRM changes proceed through implementation, meaningful tests, coordinated deployment and live checks without asking Ahmed to approve publication again. He reviews the live result and requests changes or reversal if needed. His silence does not prove testing or acceptance. Newer explicit release exceptions still apply; permission to deploy the CRM does not authorize destructive deletion or external customer messages.
- Each employee sees her branch; owner sees both. A stale assignment does not override the branch boundary.
- October 15: canonical `investment` is owner-only across all CRM data, including against manager/viewer access. New owner-selected investors use that route and owner assignment; qualification remains optional in existing requests. Preserve old branch investor labels, shared-phone identities, existing Muscat/Barka workflows and current route configuration. Private investment evidence must not enter shared summaries or AI caches. No Meta connection attempt or old-client backfill.
- Standing active inventory is 10. Shortage is `max(0,10-active inventory)`. Monthly additions remain descriptive, not a second target scoring the same shortage.
- Work since 2026-08-01 uses approved branch reporting attribution while preserving original dates, authors, senders and amounts. Lifetime reporting is not a one-year substitute.
- Other targets need actual owner-entered values. Cross-month weekly target allocation remains undecided; the deployed UI suppresses its score.
- Owner must see company commission by employee. Employee commission is an owner-selected percentage per deal of company commission, never sale price. The deployed deal workflow supports an explicit per-deal percentage without retroactively recalculating historical amounts; actual employee UI-use verification remains outstanding.
- Latest October 2 request: one-screen deal entry with inline client/property/owner; historical 2020/2022 sales may omit an unknown visit. New completed sales require an actual visit and a collection date when commission is received. Record-creation timestamps remain audit evidence, separate from sale dates. A refusal has one primary reason plus optional customer words.
- A new visit resolves or creates its property request atomically; manual request choice is optional. Remove the detailed meeting-address field while preserving stored historical values. Preserve date/time, status, attendance, next action and automatic follow-up task behavior.
- October 11: create/select a client directly in New Visit by name and phone without leaving or resetting the form. Contact save is explicit and separate from visit save. Automatically load all accessible unarchived client choices instead of requiring manual batches of 50; preserve branch and session boundaries.
- Ahmed confirmed the New Visit change worked on October 11. His next reported missing WhatsApp client was an existing contact hidden by inconsistent branch assignment; repair receiving-line fallback without broadening access or overwriting explicit cross-branch requests.
- Keep property edit/archive/restore actions usable and reversible. Ahmed will send a reference for the new property layout; that design is still pending.
- CRM read state is separate from phone WhatsApp. A visit creates interest but does not fabricate an inbound inquiry.
- Generated UI numbers use 0–9 with Arabic text. Keep source content unchanged.
- Follow-ups remain disabled. No customer messages or production data deletion for tests.

## Deployed work and remaining verification

The October 11 WhatsApp backend repair now uses the verified receiving line when request geography is unknown, preserves explicit customer geography and manual assignments, and prevents request summaries from reassigning a physical inbox. The reported contact and its request now belong to the receiving branch. Transaction-local authenticated SQL reads verified that Barka sees the target client, request and conversation, Muscat sees none of those three records, and the owner sees all three. The conservative backfill repaired 48 clients and 53 requests with private snapshots; assertions preserved original identities, creation dates and business fields. Security-advisor output is unchanged: the same five findings before and after, with no new warnings. These are live database-role checks, not actual employee browser sessions. The complete Clients-page pagination frontend is published and its changed public assets match the validated source bytes.

The October 11 frontend update adds client creation/selection inside New Visit, preserving other form values, and loads all permitted client options automatically. The complete CI suite passed; synthetic owner/Muscat/Barka browser checks cover creation, duplicate-phone reuse (including Arabic digits), double submission, and subsequent visit payload. No database migration or production test record was needed. This does not replace the outstanding actual employee login walkthroughs.

The October 3 release includes the simplified dashboard/property/client screens, inventory shortage reminder, period/lifetime performance presentation, Western date numerals, session guards, performance-response and export-session regressions, and integration hardening. See `docs/release-20261003.md` for current deployment evidence; `docs/audit-20261002.md` records the earlier audit scope.

The later October 2 workflow update is documented separately in `docs/deal-visit-workflows-20261002.md`. It corrects the operations renderer hiding property actions and extends lifetime reporting before the company's technical account-creation date when genuine historical completed deals exist. Its local synthetic browser pass covers 24 checks and 45 screenshots across owner/Muscat/Barka and desktop/mobile emulation; it is not real employee-login evidence. Mobile deal-form title/footer overflow was corrected without removing the width assertion. Do not count visit-origin pipeline notes as completed sales or fabricate missing historical rejection reasons.

Live read-only RPC checks executed client 360, property action queue, property performance and employee performance using owner, Muscat and Barka SQL role claims. Staff property reports returned no other-branch rows; owner finance keys were visible while staff finance data was masked. Barka had no accessible deal available for a live deal-read sample; isolated tests cover that path. These checks used SQL role claims, not actual employee UI login sessions.

The matching server changes and frontend are now deployed and verified within the scope above. The prior requirement for Ahmed's review before release is superseded; he reviews the result on the live site. The new property-layout design still awaits his reference and is not part of this release.

Still needed: actual employee list/detail/export/mobile/account-switch walkthroughs; isolated backend for business writes/uploads; live inbound WhatsApp attribution/ambiguity proof; fresh Instagram metrics and direct-message connection; configured targets and cross-month goal rule. Mock SDK, SQL role tests and successful CI are distinct evidence and do not replace actual authenticated UI use.

## Tools and next-start rule

GitHub and Supabase are usable here. TinyFish is installed with callable tools, but Ahmed set the browser-attempt topic aside; do not restart stopped attempts. No extra plugin is required for this audit. Codex Security was declined on October 2; do not suggest it again for this request. Google Drive is optional for documents; Runway is unrelated to CRM repair, but may serve property marketing. No plugin was removed.

Begin the next task from this state and the newest user decision. Update this file and replace superseded rules in `AGENTS.md` in the same change; keep dated evidence in `docs/`.
