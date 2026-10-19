# Successful staff message volume — SQL30

Deployed on 2026-10-19 as migration **`20261019093011`** (`staff_message_volume_scope_20261019`), from validated commit `c3e78b14646180481e1eebc5e2cdc27cc9402de6`. All seven jobs passed in [CI 39230257811](https://github.com/omanvilla/habib-crm/actions/runs/39230257811), including the full native PostgreSQL SQL30 cycle. [Pages 39230879858](https://github.com/omanvilla/habib-crm/actions/runs/39230879858) succeeded for that commit. The release owner subsequently verified equal owner/self message volume for both branches in a single repeatable-read production snapshot, with one performance row per employee. All11 inspected business-table fingerprints matched before/after application. See `docs/coherence-evidence-20261019.json` for sanitized release evidence.

## Proven cause and narrow correction

The owner's period report counted successful human messages on an employee's authorized WhatsApp line even when the conversation's primary client belonged to another branch or was an unassigned general client. The employee's copy additionally required current access to that primary client and therefore undercounted the same line work. The conversation and message were already readable under the existing line-based RLS.

SQL30 removes exactly this additional predicate from the `staff_messages` CTE in `crm_employee_performance(date,date)`:

```sql
and (v_role<>'agent' or (m.conversation_client_id is null or crm_repair_private.can_access_client(m.company_id,m.conversation_client_id)))
```

It keeps the existing conversation authorization, company/branch attribution, investor-link guards, successful-delivery requirements, automation exclusions and matching message/conversation client check. Inquiry evidence still requires client and property access, so inquiry clients, property pairs and human reply counts retain their previous scope. No client ownership or route is changed.

The migration patches the exact saved SQL28 definition, verifies that the single matching predicate is inside `staff_messages`, and preserves the report's owner and execute grants. Its private, RLS-protected catalog backup supports repeat application and exact rollback. An independently changed definition or ACL/owner causes application/rollback to stop. SQL28 and SQL29 are not edited.

Files: `db/changes/30-staff-message-volume-scope.forward.sql`, its rollback, and the CLI-created `supabase/migrations/*_staff_message_volume_scope_20261019.sql` mirror. This is a catalog-only repair without business-row DML.

## Meaningful isolated verification

The full sanitized catalog with the preceding migrations through SQL29 passed the complete SQL30 cycle: historical fixture setup, reproduced failure, application twice, authenticated acceptance, expected refusal after an independent function change, exact rollback and preservation assertions.

| Scenario | Verified result |
|---|---|
| Muscat line with a Barka-primary client and stale Barka conversation assignee | The line's message is readable before the migration. Owner receives two valid synthetic messages while self previously receives one; after SQL30 both receive two. |
| Barka line with Muscat-primary and unassigned general clients | Owner receives three valid synthetic messages while self previously receives one; after SQL30 both receive three. |
| Other report values | Every JSON metric other than `successful_staff_messages` remains exactly unchanged for each employee. The complete owner and manager reports remain unchanged. |
| Client and inquiry isolation | Opposite-primary/general client rows remain unavailable. The test inquiry retains the primary client's other-branch assignee and stays unavailable; its client-scoped inquiry evidence and reply credit remain excluded from the employee report. |
| Existing related-row policy | Exact visible client/request/conversation/message/inquiry/attribution ID sets match before and after for owner, manager and both employees. A message attribution already follows its readable message. An explicitly assigned inquiry can already be readable under existing RLS; SQL30 does not redefine that permission. |
| Other branch/private work | Other-line messages remain inaccessible. Private requests attached to ordinary lines, investment conversations on ordinary parent clients, and investor-linked ordinary-line conversations remain excluded. Removing private message evidence changes no team metric. |
| False volume | Failed/queued deliveries, automated actors, automation channel/payload markers, missing delivery state and mismatched message/conversation clients earn no successful-message credit. |
| Roles and security | Viewer and inactive roles remain denied. No existing RLS policy, other function, table/view permission, report owner or report grant changes. The catalog backup is inaccessible to application roles. |
| Preservation and recovery | Full business fingerprints, including clients, requests, messages, conversations, inquiries, properties, deals and targets, remain unchanged. Rollback restores the exact prior function and each role's prior report. |

The passing local engine was PGlite using the project's full catalog runner. Native PostgreSQL subsequently passed in CI: the workflow clones the sanitized SQL28 catalog into `crm_staff_volume_test`, applies SQL29 and the complete SQL30 cycle, then deletes that exact test database. This keeps committed synthetic fixtures outside the SQL28/29 predecessor rollback fingerprints. Workflow YAML parsing, `git diff --check` and forward/mirror byte comparison also passed. The CLI mirror is aligned to the actual production migration timestamp with identical contents.

No production connection, business mutation, customer message or live permission change was performed during this local work.
