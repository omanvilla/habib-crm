# Current branch inventory and independent weekly additions

## Scope and evidence

Ahmed clarified on 2026-10-19 that each employee must maintain the whole current branch inventory at a minimum of 10 available properties, independently of adding two new properties each week. This is a focused follow-up to the comprehensive audit, not a new assertion that every CRM journey has been retested.

The inspected baseline was `main` at `ab4974e2cd54bf62d37c373524943e49330f4e94`, with runtime `20261019-audit-v8` from `6021a2416939075531b065e7c90e154ce3efb7f6`. Production's actual owner dashboard showed zero inventory for both employees. SQL26's live function definition matched the repository predecessor.

| Branch | Actual available, non-archived rows | Old target count | Correct standing goal | Current-week additions |
|---|---:|---:|---:|---:|
| Barka / Maram | 15 | 0 | 15 / 10, 150%, none remaining | 0 / 2 |
| Muscat / Hadeel | 4 | 0 | 4 / 10, 40%, six remaining | 0 / 2 |

Observed on 2026-10-19; these are a verification checkpoint, not fixed production values. The current Oman-local week is October 18–24; additions are counted through October 19. Standing inventory has no date restriction.

## Root cause and correction

The target function required `availability_checked_at IS NOT NULL`. Ordinary property creation, editing and the installed property triggers do not populate that field. All 19 actual available, non-archived branch properties had a null timestamp. The earlier SQL fixtures explicitly supplied a verification timestamp, so they did not represent normal property entry and missed the production failure.

SQL27 replaces the target function with these definitions:

| Target | Actual source and eligibility |
|---|---|
| Current available inventory | Unique properties in the employee's routed company/branch, `status='available'`, not archived. All creation dates, original creators and prices are included; no unused verification-timestamp requirement. |
| Properties added this week | Unique non-archived branch properties with a positive price and an actual creation date within the Oman-local Sunday–Saturday week through today. A subsequent sale retains weekly addition credit. No unused verification-timestamp requirement. |
| Clients followed up with an outcome today | Existing unique-client, human-actor, documented-outcome activity query; unchanged. |
| Completed viewings this week | Existing actual completed, non-archived viewing records in the branch and Oman-local week; unchanged. |
| Confirmed bookings this month | Existing paid-reservation milestone metrics, based on the real booking date; unchanged. |
| Expected office commission from bookings | Existing booking-period expected company commission; independent of collection; unchanged. |

Both property metrics explicitly exclude private investment links even for the owner, so owner and employee branch figures agree. The same aggregate produces the counts and the authorized `inventory_property_ids` / `new_property_ids` arrays used by the property details. No business rows or verification timestamps are fabricated.

The frontend labels distinguish current stock from weekly additions. Property target buttons open their exact counted records, reset stale filters, show the branch and applicable period, and offer a clear return to ordinary property browsing. Reads retain the existing protected view and pagination. A missing/partial target contract or changed eligibility is a retryable loading error, not a broader fallback or a zero balance. Each scoped reload gets fresh authorized IDs. Request/session guards prevent a late broader property list or old shortage reminder from replacing newer results.

## Migration and preservation

- Applied SQL27: `20261019063515_inventory_goal_source_20261019.sql`. The file was created through the Supabase CLI and aligned with the actual migration-catalog timestamp; its contents match `db/changes/27-inventory-goal-source.forward.sql` byte for byte.
- The private, RLS-enabled catalog backup stores the exact preceding function definition. Its predecessor MD5 is `f149afe492ec2d5539890bd7bd46644c`. Rollback restores that definition only when the current function still matches this release; it refuses to overwrite a subsequent independent change.
- Before/after full-row fingerprints matched for **all 34 property records and both saved target records**. The four other target metrics, financial target outputs and saved goal values also matched. There were no production business writes, synthetic production rows or customer messages.
- Post-application read-only SQL role checks passed for the owner and each routed employee. Owner: 15 Barka and 4 Muscat; Maram: only Barka 15; Hadeel: only Muscat 4. Every inventory ID resolved through the protected property view, with zero opposite-branch IDs; both weekly lists were empty. Anonymous callers cannot execute the function; authenticated callers retain the function's active-role authorization.
- The post-DDL security advisor still reports the previously documented protected projection views, intentionally authenticated privileged functions and disabled leaked-password protection. The new private backup is intentionally RLS-enabled with no application policies or grants; its [no-policy notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) is not resolved by granting access. See [the earlier security report](audit-security-20261019.md) for the existing findings and remediation references. This follow-up does not claim an empty advisor report.

## Validation and publication

The full-catalog isolated SQL27 acceptance, repeat application, changed-function rollback rejection, actual rollback and SQL26/25 predecessor rollback checks passed. Cases include old/null-timestamp inventory, zero price, status exclusions, archive/restore, separate branches/companies, ordinary-branch private-investment links, Oman week boundaries, sold weekly credit, zero goals, and exact count/ID correspondence.

Local frontend validation passed: **276 Node tests**, two PostgreSQL-context skips assigned to their CI jobs, **28 security checks**, and **39 grouped synthetic browser checks** (owner 17, Barka 11, Muscat 11). The focused browser suite uses no external requests or production data; it verifies old/null-timestamp inventory, separate weekly additions, two-row API pagination, filters, exact private/branch scope, CSV parity, saved goals, 390px layout, save/status/archive/restore refresh, empty cohorts, failed/incomplete reads and retry, concurrent archive rejection, delayed broader reads and session reset. The six new shortage-reminder tests cover late success/error results and session changes.

Production browser verification, CI/deployment commit identifiers and final asset evidence will be recorded here after publication. The live SQL role checks above are database authorization evidence; they do not claim new employee browser login or production write journeys. Sanitized checkpoint evidence is in [inventory-goals-evidence-20261019.json](inventory-goals-evidence-20261019.json).
