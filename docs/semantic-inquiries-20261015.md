# WhatsApp property inquiry follow-up — 2026-10-15

## Cause and scope

The earlier dashboard release repaired exact saved links but did not finish semantic attribution. Production rejected the old `ai_verified` attribution method, and that code also attempted an invalid WhatsApp message status. Its comparison required full stored area/price, read only one inbound text and one property, and image extraction allowed only literal URLs/codes. Staff responses did not reconcile the original customer question.

This change adds shared inventory matching and response verification to inbound WhatsApp, human Business-app echoes and successful CRM sends. Matching handles Arabic/Persian digits and price units, full authorized inventory, separate uniquely identified properties, literal saved links and legible image facts. Human responses resolve genuine customer questions within 24 hours with strict exact-quote/ID verification. Explicit quoted messages preserve provenance. Unsolicited promotions, unavailable properties, unrelated topics, conflicting customer-selected links and ambiguous listings are not counted. Review work uses the existing pending-reference/handoff flow and sends no customer message.

SQL22 enables the evidence method and adds backend-only candidate/apply RPCs. The apply transaction validates original inbound/source messages and branch/investment boundaries, preserves parent identity/routing and nonempty classification, retains real inquiry dates, and prevents duplicate attribution. It corrects visit-derived timestamps only when proven inbound evidence promotes that interest. Existing message status values remain unchanged. The summary-trigger exception is limited to this trusted backend transaction and its exact parent client. The rollback restores the prior function definition and disables new entry points while retaining recorded evidence.

## Verification and release

Implementation is under validation. Production deployment and bounded historical repair results are recorded below only after actual completion. The new pure matcher/service tests use synthetic records; controlled snapshot replays use human-reviewed response stubs, not actual model calls. PostgreSQL fixtures test source validation, idempotency, date promotion, complete pagination, role grants, branch/private isolation, and rollback alongside the existing investment suite.

## Evidence limits

Current property records have no catalog images. A plain building photo without legible identifying facts or a resolving conversation cannot safely be recognized from architectural resemblance. Such a photo stays in staff review. Image OCR integration is covered with controlled provider responses; a fresh real provider OCR event and actual employee browser sessions remain separate live verification. Historical repairs use only reviewed real text/conversation evidence, retain original dates, and are logged privately without publishing client data.

No changes to employee routing, existing deals, WhatsApp credentials, outbound test allowlists, automations or frontend design are part of this follow-up.
