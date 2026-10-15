# Performance periods and client counts — 2026-10-15

## Requested change and findings

The owner requested full current month, rolling 3/6/9 months, rolling year and lifetime filters, with no day/week performance choices. He also requested the number of people making property inquiries and the employees’ genuine human replies, clearly separated from message volume.

The existing RPC counted first-ever client/property inquiry pairs (October:16 Muscat,22 Barka), not unique people. Proven period message evidence represented13 Muscat and20 Barka clients at audit time, including returning clients. Reports→Team used an unrelated legacy sale-value/new-client leaderboard; it now uses the same scoped RPC as dashboard and Team.

## Implementation

- Full month:1–31 October2026; rolling year:15 October2025–15 October2026. Rolling3/6/9 use calendar-month subtraction and clamp short months. Oman-local inclusive display, exclusive RPC end. Lifetime asks the backend for the actual historical start; a company account-creation date cannot hide older genuine sales.
- Reports retain the specific-month picker; selecting a preset clears its stale override. Reports use Oman boundaries. Target percentages are monthly only.
- `inquiry_clients`: distinct clients with a real inbound message attributed to a permitted property during the selected period, including returning clients and deduplicating multiple properties.
- `replied_inquiry_clients`: subset with a successful human message after a qualifying inquiry in the same conversation and period. An explicit quote of an unrelated message is excluded. This is observable message chronology, not a claim that AI verified the content of every response.
- `successful_staff_messages`: all successfully sent/delivered/read human staff messages in the period, including proactive follow-up; excludes known automated sources/payloads, failed/pending/unknown delivery. Legacy `outbound_messages` remains unchanged for compatibility.
- First-ever client/property inquiry cohorts remain separately and accurately labeled for existing goals and inquiry-to-visit conversion. Existing inventory, visits, sales, commissions and monthly targets retain their behavior.
- SQL23 only replaces the performance function and stores its prior definition in a restricted private backup. No business-row changes, routing changes, policy widening, external messages or Meta changes. Forward migration rejects unexpected function drift; rollback restores the original function and preserves ACL/owner.

## Validation before release

- Node:258 passed,2 existing database-context skips. Security harness:26 passed, no network calls or production writes.
- Full synthetic SQL catalog:29 stages passed locally, including duplicate SQL23 apply, every legacy metric unchanged for five roles, business-row fingerprints, unique clients/repeat inquiries/multiple properties, Oman boundaries, reply ordering, automation/failure exclusions, cross-company/branch and owner-only investment protection, exact rollback.
- Synthetic Chromium:five roles, all six period filters and RPC dates, dashboard/Team/Reports→Team, February2024 picker followed by yearly preset, desktop/mobile wrapping and no JavaScript errors. These are synthetic sessions, not employee logins.

## Release evidence

Release and live verification are pending at this checkpoint. See the final update below after deployment.
