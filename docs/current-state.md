# Habib CRM — current state

Updated 2026-10-02. Read this with `AGENTS.md` before work. This file distinguishes the deployed product from reviewed implementation. Older dated reports remain evidence, not competing product rules.

## Where the work is

| Surface | State |
|---|---|
| Production website | GitHub Pages from `main`; frontend `20260930-operations-v6b` |
| Latest production baseline inspected | `36bc4263298f81abc302c527e45d1de5fc4b12e7`; last frontend implementation `9f3c98d` |
| Active review branch | `codex/role-workflows-ui-preview-20260930`; baseline `a522e97`, 19 commits ahead of the common production ancestor |
| October2 implementation evidence | Main repair `ab1a598`; review fixes `af936ad`, all three CI jobs passed |
| Review frontend | `20261002-review-v10`; not released to production |
| Supabase | `dmsckqjkcnsfmnzfjczz`; inbox v12 released October2; webhook v33; deployed separately from Pages |
| Approved production business change | Classified property attribution to Hadeel/Muscat and Maram/Barka; standing inventory target 10, migration `approved_branch_employee_attribution_20261001` |
| Prepared database change | `db/changes/12-approved-performance-credit.forward.sql` on the review branch; not deployed |

The October 2 conversation mentioned local Codex commit `d3c7481` on `work`. It was not found on GitHub and is not evidence of a production deployment. Inspect that local workspace if it becomes available; do not recreate or discard unseen local changes.

## Latest agreed behavior

- Each employee sees her branch; owner sees both. A stale assignment does not override the branch boundary.
- Standing active inventory is 10. Shortage is `max(0,10-active inventory)`. Monthly additions remain descriptive, not a second target scoring the same shortage.
- Work since 2026-08-01 uses approved branch reporting attribution while preserving original dates, authors, senders and amounts. Lifetime reporting is not a one-year substitute.
- Other targets need actual owner-entered values. Cross-month weekly target allocation remains undecided; the review UI suppresses its score.
- Owner must see company commission by employee. Employee commission is an owner-selected percentage per deal of company commission, never sale price. This percentage workflow is still incomplete; do not invent or retroactively recalculate it.
- CRM read state is separate from phone WhatsApp. A visit creates interest but does not fabricate an inbound inquiry.
- Generated UI numbers use 0–9 with Arabic text. Keep source content unchanged.
- Follow-ups remain disabled. No customer messages or production data deletion for tests.

## Prepared work and remaining gates

The review branch contains simplified dashboard/property/client screens, inventory shortage reminder, period/lifetime performance presentation, Western date numerals and session guards. October 2 adds performance-response and export-session regressions and integration hardening. See `docs/audit-20261002.md` for exact verified scope and release state.

The interface/performance preview still requires Ahmed's concrete review before a broad production release. Do not publish it merely because it is newer. Complete its matching server work and commission flow before claiming the requested performance system is finished.

Still needed: actual employee list/detail/export/mobile/account-switch walkthroughs; isolated backend for business writes/uploads; live inbound WhatsApp attribution/ambiguity proof; fresh Instagram metrics and direct-message connection; configured targets and cross-month goal rule. Mock SDK, SQL role tests and successful CI are distinct evidence and do not replace actual authenticated UI use.

## Tools and next-start rule

GitHub and Supabase are usable here. TinyFish is installed with callable tools, but Ahmed set the browser-attempt topic aside; do not restart stopped attempts. No extra plugin is required for this audit. Codex Security was declined on October 2; do not suggest it again for this request. Google Drive is optional for documents; Runway is unrelated to CRM repair, but may serve property marketing. No plugin was removed.

Begin the next task from this state and the newest user decision. Update this file and replace superseded rules in `AGENTS.md` in the same change; keep dated evidence in `docs/`.
