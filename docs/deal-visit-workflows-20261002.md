# Deal and visit workflow update — 2026-10-02

Scope: Ahmed's later October 2 request. Review implementation, not a production deployment. The new property layout awaits his reference. This document contains no real customer names, phone numbers or record identifiers.

## Findings and decisions

- The operations property renderer replaced the original table and retained only the details action. Edit/archive/restore now have explicit permission and row-state checks; archiving preserves the original sale status and related history.
- A referenced legacy lost card really originated from a June 29, 2026 visit. Its system note described automatic pipeline-card creation, not a sale. Neither a structured rejection reason nor customer words were stored. No real customer record was changed or guessed. Pipeline display now excludes known system-origin lines from customer/rejection evidence while leaving storage intact.
- Historical completed deals must use their actual sale date. Company account creation in 2026 cannot define the start of a ledger containing 2020/2022 sales. The prepared performance RPC takes the earlier genuine closing date into account, within role/branch scope.
- Historical deals may omit an unknown visit. New completed sales need a real visit and a known collection date when commission is received. Negotiation/deposit timestamps are not mandatory entry steps. Audit creation/stage-change timestamps remain distinct from business dates.
- Deal entry should allow inline client, property and owner creation in one atomic save. Loss entry has a primary catalog reason and optional customer words. Preserve prior financial amounts until explicitly edited.
- Visit entry should automatically reuse a safe compatible request or create a property-specific one. Manual request selection is optional. Remove detailed meeting address from the form; omit that key during edits to preserve historical values. Keep date/time/status/attendance/next action/follow-up and notes.

## Review changes

- `crm-operations-v6.js/.css`: useful property actions and reversible archive/restore controls.
- `app-base-v15.html`: restore acknowledgement and permission checks, provenance-aware pipeline display, correct historical sale dates, simplified visit form.
- `crm-deal-workflow.js/.css`: additive one-screen deal workflow.
- Prepared SQL `12`: lifetime reporting before technical company creation when real historic sales exist.
- Prepared SQL `13`: automatic request resolution in the existing atomic visit operation.
- Prepared SQL `14`: atomic deal workflow and actual business dates.
- Prepared SQL `15`: one current primary refusal per exact client/property/request journey, optional customer words, private change history and matching report records.
- Prepared SQL `16`: only current primary reasons contribute to the existing client/property report aggregates. The original role, branch and period restrictions are preserved exactly.

## Evidence and release boundary

Local checks include property action render/dispatch and an archive/restore cycle; provenance versus customer text; preserved historical sale dates; isolated PostgreSQL performance assertions for 2020/2022 and branch-safe lifetime boundaries. Additional workflow and browser evidence is recorded below after integration.

The visit SQL suite verifies owner and both employee branches, compatible request reuse, incompatible/ambiguous independent requests, atomic rollback, replay, stale edits, historical location preservation, and no fabricated inbound inquiry. A simultaneous owner/employee save created one request for two distinct visits. Completed date-only visits explicitly retain unknown time and create no appointment timestamp; they remain editable from Visits. Normal scheduled visits still need a time.

The existing 26-case security harness passed with zero network requests and zero production writes. SQL16 was independently compared to the live definitions: only three `is_primary=true` predicates differ. Its definitions compiled in isolated PostgreSQL with body dependency checks disabled; this is not a full execution of those three report RPCs.

The deal PostgreSQL suite verifies historical entries without fabricated visits/requests/receipt dates; actual date-only current visits; owner-only financial writes and masked reads; per-deal percentages and unchanged historical amounts; request replay and payload mismatch; stale edits; complete rollback of inline entities; both directions of branch denial; and completion guards on old/direct UI paths. The rejection suite executes SQL13/14/15 together and verifies one current primary, retained prior history, optional words remaining null, exact-request isolation, no false inbound inquiry/visit, unchanged inactive historical reasons, branch denial and atomic rollback. Refusal percentages in the property UI use related clients as their labeled denominator, including genuine visits, rather than treating only proven inbound inquiries as the denominator.

The combined SQL13/14/15 regression also completes an existing scheduled card with a previously missing request and an inline actual visit: it keeps the same deal ID and creation timestamp and produces exactly one card. New-form selection of an existing visit reuses its existing nonfinal card while preserving financial amounts, notes and employee attribution. The private transaction context used for this link has no client permissions and is cleaned before completion.

SQL fixtures use an isolated local PostgreSQL database and synthetic records. Browser checks use a fixture SDK with external requests/sends blocked. Neither proves a successful real employee browser login. No production migration, customer message, data deletion or broad UI release is part of this review update.

Release requires the matching prepared database changes and frontend together, after the standing review gate. Keep the original property-layout reference outstanding and do not replace it with an invented redesign.
