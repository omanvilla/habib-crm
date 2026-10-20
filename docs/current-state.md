# Habib CRM — current state

Updated 2026-10-20. Read with `AGENTS.md`. Dated implementation history and prior verification limits are preserved verbatim in [the v11 state archive](current-state-v11-20261020.md).

## Latest requested change: compact owner dashboard

Candidate frontend `20261020-dashboard-v12` is based on published v11 `debd5d80dc60192e83c733f6909c4c5357803b55`. See [implementation and coverage](dashboard-compact-20261020.md). Publication is not claimed until the candidate check and Pages deployment succeed.

The owner keeps the existing top shortcuts, approved targets and branch/private summary cards. Work lists are collapsed initially behind six count buttons; clicking one opens only that category. Period performance belongs in **Reports > أداء الفريق**, not the owner's main dashboard. Other roles retain their existing permitted workspace. This is presentation-only: no database migration, financial change, customer write or new permission.

Active review branch for this change: `codex/dashboard-compact-20261020`. The prior comprehensive-audit branch and its evidence are preserved; do not mistake it for this change's source. The dedicated `Dashboard compact checks` workflow runs the full production bootstrap with a synthetic SDK and denied external traffic, plus existing calculation/security and adjacent workflow regressions. The prior owner-home layout assertions are superseded, not claimed as passing against the new layout.

## Production rules retained

- Production is GitHub Pages from `main`. Baseline runtime is `20261020-branch-v11` until the above candidate is published.
- Operational identities and goals are **مسقط** and **بركاء**, independent of staff names/count or login status. Preserve original authors, financial allocations and dates. Keep the exact approved saved targets and inventory-detail predicates.
- Hadeel's personal login was retired and its sessions/refresh access expired. Do not reactivate it for tests. Maram's existing Barka account is retained. Muscat reception is temporarily assigned to the owner, awaiting Ahmed's new branch-owned email; do not invent a replacement account.
- The retired separate investor number is not an integration target. Canonical owner-private investment uses the existing Muscat line through `transport_route_key=muscat`; preserve its private scope and do not infer private classification from geography or legacy labels.
- Latest database migrations are SQL31=`20261020031442` and SQL32=`20261020032501`. Verified Edge versions at v11: webhook38/send16/inbox13/direct-bind12/embedded-signup7. This layout task does not modify them.
- The paid-booking date fixes the month of goal achievement. Closing and actual collections have independent dates; no duplicate booking or fabricated historical evidence. Preserve milli-OMR calculations and separate staff allocation.
- Scheduled follow-ups remain disabled. Never send test messages or mutate real customers for UI verification.

## Verification limits

The v11 state archive preserves the successful database-role and Auth-state checks and all prior actual/synthetic browser distinctions. This layout task does not establish a new authenticated production session, live Meta delivery, physical-phone use, Storage/Realtime behavior or physical backup restoration. Missing historical booking/receipt facts and disabled leaked-password protection are not silently repaired by a visual change.
