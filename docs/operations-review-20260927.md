# Operations review — 2026-09-27

Baseline: `5b3c779e0aceb5dc4a233d3ddeeedfe56b82b432`. Backup branch: `backup/pre-operations-review-20260927`.

## Applied
- Dashboard staff target reminder; owner monthly targets (active inventory default 10, newly sourced listings, sales, company commission).
- New `employee_monthly_targets` with owner write / employee own read RLS; `properties.sourced_by` and guard; no historical property is automatically attributed.
- Client 360 returns the latest 12 WhatsApp messages per direction and links to the full conversation.
- WhatsApp inbox excludes active staff phone numbers, including the owner's self conversation, and subtracts their unread counts. Manual CRM read marking is disabled in the Edge Function and EXECUTE privilege revoked for authenticated users. Phone app read events are not currently available as a reliable inbound signal.
- Reports navigation and route restricted to owner; redundant advanced search removed; visits ordered by overdue/today/upcoming/history and compacted; legacy lost deal notes distinguished from truly blank reasons.
- TEST_CRM_REPAIR_PROPERTY_20260923 archived, no deletion.
- Duplicate Khoudh Al Kawthar 140 archived (`cde048c6-9b2b-4643-aa80-48a3dc19c902`); its reel event `645905a8-adab-4c0a-afd9-c38595d9b253` moved to canonical `473b069f-e984-4cd9-a883-6c854009dc7c`. Three reels remain linked; historic activity and action reviews remain attached to archived record.

## Verification
- Browser anonymous load showed version `20260927-operations-v2`, removed search page and team target panel in DOM; no application error in console. Authenticated UI unavailable in this browser.
- SQL RLS rollback tests: owner can insert target; intended employee can select own target; colleague sees zero; employee attempting to change sourced_by gets `property_source_owner_only`.
- Client 360 sample returned 24 messages, including 12 outbound. Authenticated role cannot execute `crm_mark_whatsapp_read`.
- The 120 Khoudh Seventh property has three reels and zero matched WhatsApp messages / inbound inquiries: the no-inquiry alert reflects current attribution data.

## Reversal
- Static UI: reset `main` to backup branch commit via normal forward revert of the operations commit.
- WhatsApp inbox: redeploy version 9 from the repository backup branch; restore function EXECUTE to authenticated only if manual CRM marking is explicitly desired.
- Test property restore: `update public.properties set archived=false,archived_at=null,archived_by=null where id='dd95be18-651e-42fe-a105-837cafdac6fb';`
- Duplicate restore: within a transaction, move event `645905a8-adab-4c0a-afd9-c38595d9b253` back to `cde048c6-9b2b-4643-aa80-48a3dc19c902`, then clear its archived fields. Do not delete either property or the event.
- Target schema is additive. Preserve any entered targets / sourced_by values in a database export before considering a schema rollback.

## Pending provider and policy decisions
- WhatsApp Business phone-side read state cannot be inferred from opening CRM or from outbound echoes; leave unread indicators unchanged until an official reliable read event is available.
- Bonus formula and monthly commission target amounts are not configured. Owner can set numeric goals; no bonus is calculated.
- Historic properties need explicit owner review to assign sourced_by; attribution is not guessed from added_by.

## Instagram permalink reconciliation — operations v3
- Confirming an Instagram permalink on a property now checks older pending WhatsApp references with the exact same shortcode, within the signed-in employee's visible conversations. Each match uses the existing access-checked resolution RPC and creates/links its property request. Up to 200 occurrences are handled in one save; any failures or extra rows remain pending and are reported, without a false success message.
- Photos, ambiguous text and unlinked posts still require a person to identify the property. Adding a link sends no customer messages.
- Current snapshot before this change: 44 pending Instagram link occurrences across 16 distinct shortcodes; 8 Instagram marketing events were linked to properties. No historic records were automatically changed during deployment.
- Test: `node --test tests/*.test.cjs` (47 passed). Rollback: revert the v3 static files; previously reconciled business records should be reviewed individually rather than deleted.

## Instagram messaging authorization — operations v4
- The connected account grants Insights permissions, but not `pages_messaging` or `instagram_manage_messages`. Meta rejected the `messages` subscription with error `(#200)` naming `pages_messaging`; the database has zero Instagram webhook events and conversations. Insights numbers are still available.
- The reauthorization flow now requests `pages_manage_metadata`, `pages_messaging`, and `instagram_manage_messages` in addition to existing Insights scopes. The CRM status explains that performance and messages have different connection states. No new access was granted by deploying code; Meta account consent / app permission approval is still required, and webhook receipt must be tested after that.
- Four active listings share the exact title and specifications of Ahmed Al Shaer 57k; three share one owner record, while the fourth points to a different owner record. No listing was archived or merged because the ownership conflict needs a verified business decision.
