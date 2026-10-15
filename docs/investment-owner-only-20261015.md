# Investment workflow — October 15, 2026

## Scope and audit

Ahmed requested a small extension of the existing CRM for manually entered investors while Meta onboarding remains incomplete. The canonical route is `investment`; only an active owner in the same company may access its work. Manager/viewer status must not grant investment access. No historical investor-label backfill, branch reassignment, customer messaging or Meta connection attempt is authorized by this change.

The live audit found:

- The investment business route already exists, is assigned to the active owner and has `owner_only_inbox=true`. No route configuration update is needed for deployment.
- Existing `client_requests` already contains the requested qualification fields and milestone timestamps. A separate investor table or pipeline is unnecessary.
- The manual client form did not reliably set the route or owner when Investor was selected. Existing client/request summaries could apply branch geography to investment work.
- Existing manager/viewer permissions and several privileged reporting paths were broader than the requested owner-only boundary. Inbox privacy alone did not protect every linked record.
- At audit time there were no canonical investment clients or requests, but 71 existing clients had an investor label within ordinary routes. Those labels are not a basis for changing old records or access.
- Shared AI summaries and shared-phone request summaries needed protection against copying private evidence into an ordinary client/property record.

## Implementation

New owner-created investors persist `lead_route=investment`, `client_type=investor`, and the current owner assignment. Investment requests persist `request_type=investor`, `route_key=branch_key=investment`, and an active owner assignment. The form identifies the route, owner and privacy, retains existing phone normalization/deduplication, and opens an existing number without moving it. Existing branch investor labels and staff workflows remain ordinary branch records.

Qualification remains optional. Existing request fields support financing readiness, decision maker, priority, current stage, next action and follow-up. Optional actual Oman-local milestone times are editable and visible on the client page. Record creation time is not substituted for contact evidence; no-response remains distinct from rejection. No new business pipeline or investor table is introduced.

SQL18 adds restrictive owner-only policies alongside the existing branch policies, guards related records and privileged writes, and protects definer views/RPC aggregates. Private catalog backups retain original definitions for a reviewed rollback. Nullable client/request notification references carry privacy context without changing existing notifications. There is no production client/request/deal/route backfill.

Mixed-phone handling preserves an existing ordinary client exactly while separating future private investment requests, conversations and property-attribution evidence. Private request summaries, messages and inquiry updates cannot overwrite the ordinary parent. Service-role Edge paths enforce the same owner boundary, and shared AI caches exclude private evidence even when the owner requests the analysis. Future investment onboarding is owner-only; this release does not attempt to connect Meta or enable follow-up automation.

## Verification and release

Release verification is in progress. The isolated SQL fixture reconstructs the current schema, functions, triggers, policies and grants with synthetic identities. Tests exercise owner creation/editing, private duplicate-phone handling, all application roles, direct and indirect reads/writes, reporting RPCs, future inbound attribution, retries, and unchanged ordinary records. Browser tests are synthetic sessions; they are distinct from real employee login sessions. No real customer test records or messages are used.

Final runtime, CI, migration, Edge and public-asset evidence will replace this paragraph after coordinated deployment.
