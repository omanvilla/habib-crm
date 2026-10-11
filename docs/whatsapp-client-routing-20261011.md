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

Prepared for isolated CI validation and coordinated backend/frontend deployment. Tests include real routing function execution with synthetic input, SQL routing/triggers/private privileges, read isolation, conservative backfill exclusions and a zero-change second run. The client-list regression uses more than 1000 synthetic rows, a failed later page and an account switch.

No customer messages are sent, no automation is enabled and no real test client is created. Real employee UI-session verification remains separate from SQL role and synthetic browser evidence. Cases with explicit cross-branch requests are not automatically moved.
