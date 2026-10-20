# Habib CRM — current state

Updated 2026-10-20. Read with `AGENTS.md`. Prior implementation history and verification limits remain preserved verbatim in [the v11 state archive](current-state-v11-20261020.md).

## Latest deployed change: compact owner dashboard

Frontend **`20261020-dashboard-v12`**, validated runtime commit **`44e18225f664bd0c95bc389e7d718ea73bdfbef9`**, is deployed through main. [CI 39446824269](https://github.com/omanvilla/habib-crm/actions/runs/39446824269) and [Pages 39447321747](https://github.com/omanvilla/habib-crm/actions/runs/39447321747) succeeded. Independent public GET verification at 15:24:38 UTC found all **20 runtime files HTTP200 and byte-identical** to that source, including the exact root app-version. [Verification run 39448111088](https://github.com/omanvilla/habib-crm/actions/runs/39448111088). Later documentation-only commits do not change runtime assets.

Ahmed's latest dashboard decision: retain the existing four top shortcuts, approved goals and ordinary/private summary cards. The owner's work lists are initially collapsed behind six count buttons; a click opens only that category, repeat click/Close/Escape collapses it, and switching workspace clears the selection. Period performance is in **Reports > أداء الفريق**, not the owner's main dashboard. Other roles retain their existing permitted workspace. Do not restore the old owner-home performance panel or initially expand all lists in a future cleanup.

This is presentation-only: no database migration, financial changes, customer writes, messages or new permissions. Existing scoped loaders, counts, pagination, record actions and report calculations are reused. The compact module is appended to the current bootstrap; original operations source is unchanged.

Validation: 375 Node cases passed; two PostgreSQL-context cases remain skipped by this frontend-only gate (the prior database release evidence is separate). The security harness and all six selected browser suites passed: compact dashboard, branch operations, inventory, investment, deal dates and inquiry follow-up. The new compact suite has ten scenario groups across synthetic owner and other roles, full index bootstrap, keyboard interaction, retry, pagination, report month boundaries and 390px viewport. No external request or page error occurred in that suite. A separate cold-start 390px check verified all six buttons within the viewport. These are synthetic browser results, not authenticated production-session evidence.

Review branch: `codex/dashboard-compact-20261020` at validated `44e1822`. An independent read-only public-asset verification workflow is retained only on `codex/dashboard-public-verification-20261020` (`a46cfb3`); it is not a second production source or recurring monitor. The earlier comprehensive-audit branch is preserved. See [release and coverage](dashboard-compact-20261020.md) and [evidence summary](dashboard-compact-evidence-20261020.json).

## Production rules retained

- Production is GitHub Pages from `main`. Branch identities and goals are **مسقط** and **بركاء**, independent of staff names/count or login status. Preserve original authors, financial allocations and dates, exact approved goals and inventory-detail predicates.
- Hadeel's personal login remains retired, with sessions/refresh access expired. Do not reactivate it for tests. Maram's existing Barka account is retained. Muscat reception is temporarily owner-assigned, awaiting Ahmed's new branch-owned email; do not invent an account.
- The retired separate investor number is not an integration target. Canonical owner-private investment uses Muscat through `transport_route_key=muscat`; preserve its scope and do not infer private classification from geography or legacy labels.
- Latest SQL31=`20261020031442`, SQL32=`20261020032501`. Edge versions at v11: webhook38/send16/inbox13/direct-bind12/embedded-signup7. This layout task did not modify them.
- Actual paid-booking date fixes the month of goal achievement. Closing and receipts have independent dates; never duplicate a booking or fabricate historical evidence. Preserve milli-OMR and separate staff allocation.
- Scheduled follow-ups remain disabled. Never send test messages or mutate real customers for interface verification.

## Verification limits

A new authenticated production dashboard journey was not available. Public asset equality proves publication, not every live account action. A third-party browser summary reported unrelated Vite assets/version 1.0.0 and was not accepted as CRM UI evidence; direct HTTP checks of the actual twenty URLs independently established the expected bytes/version. No access changes were made to obtain a session.

The v11 archive retains actual database-role/Auth-state checks and earlier actual/synthetic browser distinctions. This layout release does not establish new Meta delivery, physical-phone use, Storage/Realtime behavior or physical backup restoration. Missing historical booking/receipt facts and disabled leaked-password protection remain unchanged.
