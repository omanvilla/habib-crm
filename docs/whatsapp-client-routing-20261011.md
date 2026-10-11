# WhatsApp client visibility — October 11, 2026

Ahmed reported that a WhatsApp contact did not appear as a CRM client after confirming the earlier New Visit improvement worked.

## Diagnosis

The reported contact already existed and its messages were ingested. Its physical conversation belonged to Barka, but its client and generic request were assigned to Muscat. Transaction-local authenticated-role reads confirmed Barka could see the conversation but neither the client nor the request. No customer identifiers are recorded in this public report.

When property geography was unknown, request geography/team triggers defaulted to Muscat. The client-summary function then copied that assignment into the client and physical inbox. Webhook postprocessing repeated that default. A later physical-line event restored only the inbox assignment, leaving the client inaccessible to the receiving branch.

## Changes

- SQL17 derives unknown request geography from its verified inbound origin conversation, or a unique configured inbound office number if no origin exists. Explicit geography, manual assignment, property-specific requests and conflicting/multi-branch cases keep their independent handling.
- Client-summary refresh no longer changes physical inbox assignments. The webhook removes its global client/inbox reassignment and preserves the receiving branch when geography is unknown. Failed request updates are surfaced through the existing review path.
- Private, RLS-protected catalog and row snapshots make the repair reviewable. The separate backfill is restricted to unarchived WhatsApp contacts with one physical branch, no visits/deals, no manual/foreign/property-specific/non-WhatsApp/closed requests, and verified evidence for every unknown-location request. No messages, names, original creation dates or business amounts are changed.
- The general Clients page also uses automatic complete pagination, since its single API response could truncate larger permitted lists. New Visit inline creation remains deployed and unchanged.

## Verification and release

Runtime commit `e38bac4392a26b7d4cf660d6fc13d92316841142`, frontend version `20261011-whatsapp-clients-v14`, was promoted to `main` after all four jobs passed in [CI run 38123904162](https://github.com/omanvilla/habib-crm/actions/runs/38123904162): `attribution-sql`, `synthetic-browser`, `workflows-sql` and `node-tests`. Local Node validation passed 126 tests with 2 SQL-context skips; the security harness passed 26 checks.

The isolated tests execute routing functions with synthetic input and cover SQL routing/triggers/private privileges, read isolation, conservative backfill exclusions and a zero-change second run. The client-list regression uses more than 1000 synthetic rows, a failed later page and an account switch. SQL CI confirmed both the branch-fallback assertions and the safe-backfill/idempotency assertions passed.

Production backend deployment and verification:

- Migration `20261011081328`, named `whatsapp_branch_fallback_20261011`, applied successfully. This live migration version is distinct from the CLI-generated source filename timestamp `20261011080610`. The deployed `whatsapp-webhook` is version 34, ACTIVE; its retrieved source is byte-identical to the runtime commit.
- The audited backfill repaired exactly 48 clients and 53 linked requests. The final private-audit check confirmed 48 complete before/after snapshots and preserved identities. Assertions confirmed original creation dates and request business fields were preserved. The final conversation check found zero unlinked conversations.
- The reported contact and request now belong to Barka and its assigned employee. Transaction-local authenticated SQL reads verified client/request/conversation visibility as Barka: all visible; Muscat: all hidden; owner: all visible. This is live RLS evidence, not an actual employee browser login.
- Security-advisor findings are unchanged: the same five findings before and after, with no new warnings.

[Pages run 38124246664](https://github.com/omanvilla/habib-crm/actions/runs/38124246664) succeeded for the runtime commit. Public GET requests for `index.html` and `app-base-v15.html` returned HTTP 200, and both files matched the validated source bytes exactly. The public index identifies version `20261011-whatsapp-clients-v14`.

| Public asset | Verified SHA-256 |
|---|---|
| `index.html` | `bd478332ca0551dfde59ab848c92b5516ba8e64681ab59018e6123f1f1f85420` |
| `app-base-v15.html` | `b7e17ffdf0efcda77100115d8c9d3b8a3cfc2296d7edb3c92a21cb106c1cf5c5` |

No customer messages were sent, no automation was enabled and no real test client was created. Real employee UI-session verification remains separate from SQL role and synthetic browser evidence. Cases with explicit cross-branch requests were not automatically moved. Ahmed explicitly confirmed the preceding New Visit change worked before reporting this issue.
