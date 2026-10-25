# Habib CRM — current state

Updated 2026-10-21. Read AGENTS.md. Latest owner instructions govern. Previous Instagram discovery, design, audit history and outstanding limits remain in [the v16 archive](current-state-v16-20261021.md).

## 25 October 2026 — interface simplification, phase 3

- **Names.** The menu, top bar and page title now use the same short name: لوحة العمل، المهام، واتساب، العملاء، العقارات، التقويم، الزيارات، العربون، الملاك، التقارير، الفروع، النسخ الاحتياطي. The "إدارة …" prefixes, the English "Backup" and the mismatch between "الفريق" in the menu and "الفروع" on the page are gone. The Deals page title is unchanged.
- **Quick guide (`crm-simple-ui.js`).** Four short steps in a dialog, with the matching menu item outlined:
  1. Start from لوحة العمل.
  2. Reply in واتساب.
  3. Finish المهام and record visit results.
  4. Add a client or property, searching by phone first.

  It opens once per account on each browser after the dashboard loads. The "؟" button next to the notification bell reopens it. It stores only a per-browser "seen" flag and works if browser storage is blocked.

All in `crm-simple-ui.js/.css`. Deals were not touched, and the calendar month and week views are kept.

- **Sidebar.** Grouped as:
  - اليوم: dashboard, tasks, WhatsApp, calendar, visits.
  - العملاء والعقارات: clients, properties, owners, property performance.
  - المبيعات: deals, deposits.
  - التقارير: reports, expenses, activity log.
  - الإدارة: team, backup, settings.

  Existing links are moved, not rebuilt, so role visibility still applies. Groups with no visible link are hidden. Each link has a hover name for the collapsed icon sidebar. The backup link is hidden for staff, because that page is owner-only.
- **Calendar.** Opens on a list grouped into: overdue open tasks, today, tomorrow, the next 7 days, and later (first 20). Finished items and past non-task events are left out. Tasks open their details. Other items open the day view. The month and week buttons remain.
- **Owners and deposits.** One row per record in the `crm-grid` style, with the same filters, counts and actions:
  - Owners: edit, WhatsApp, and archive (archive only with delete permission).
  - Deposits: edit and delete.
  - Phone numbers are shown as escaped plain text.
- **Empty pages.** Owners, deposits, tasks and the calendar explain what the page is for and offer the main action where the account can edit. Filtered views say to choose «الكل».

The owner wants screens that a new employee can use without training. Phase 1 covers the daily screens. Deals were not touched.

- **Dashboard (`crm-attention.js/.css`).** The "يحتاج تدخل بشري" card is collapsed by default to the newest 3 conversations, one line each. Its actions are text links. "عرض الكل" restores paging, the summary counts and the owner's AI batch button. The choice is kept per browser. The day's work is visible above the fold again.
- **Tasks (`crm-v18-task-priority-patch.js`).** One row per task, in the shared `crm-grid` style:
  - Columns: done checkbox, task (with notes), client, due date, priority, branch, actions.
  - Sorting, filters, task details and permission checks are unchanged.
  - The dashboard's compact task card is unchanged.
- **Visits (`crm-simple-ui.js`).** One row per visit, with group separators in "الكل". Overdue visits are tinted and their main action reads "تسجيل النتيجة". Rows call the existing `editViewing`, `deleteViewing` and `viewClient`; loading and counts are unchanged.
- **Staff names.** `crmMemberChoiceLabel` returns the branch only: "مسقط" or "بركاء", "صاحب الشركة" for the owner, and "حساب فريق" otherwise. E-mail addresses no longer appear in task rows or account selectors. Retired records keep their "سجل سابق" label.
- **Phones (≤640px).**
  - Clients and properties show the search box only. The other filters open from a "الفلاتر" button, which shows how many filters are active.
  - Every `crm-grid` table (clients, properties, tasks, visits) becomes compact cards labelled from the column headers.
- **Checks.**
  - `tests/simple-ui.test.cjs`.
  - Checked in the live app as the Barka account by loading the branch files in the browser pane, at desktop width and 375px.
  - No horizontal page scroll at 375px.

The owner asked for the CRM inbox to work like WhatsApp Business, so they can answer customers when the branch phone is not available.

- **Viewing (`crm-whatsapp-chat.js/.css`).**
  - Date separators, delivery ticks, and quoted replies that jump to the original message.
  - Reactions, edits and deletions appear on the message they refer to; forwarded messages are labelled.
  - Voice notes play with the transcript underneath. Photos and stickers load as they scroll into view and open full size. Videos play in place. Documents open (PDF in a new tab) or download.
  - Locations open in Maps; contacts show name and number.
  - The open conversation refreshes every 12 s. The request/alert strip folds to one line.
- **Composer.**
  - Emoji panel; Enter sends, Shift+Enter adds a line.
  - Attach, paste or drop a photo, video or file. Images are converted to JPEG when needed.
  - Voice recording in OGG/Opus or MP4/AAC; WebM is never sent because WhatsApp rejects it.
  - Reply to a specific message.
  - Plain text still goes through `whatsapp-send`.
- **`whatsapp-inbox` v17.**
  - The `media` action now serves image, sticker, audio, video and document, for both directions, with MIME allowlists and size limits.
  - `messages` adds: filename, location, contacts, reaction, forwarded flag, context id, CRM media metadata, edit text and target, revoke target, voice flag.
- **New `whatsapp-send-media` v1.**
  - Sends media and quoted replies into the open conversation from that conversation's own number.
  - Same guards: caller RLS, owner-only investment, the 24 h window, and the idempotent `whatsapp_send_operations` journal.
- **Verified.**
  - Real conversation, read only: voice note and video played; photos lazy-load.
  - Guards: outside 24 h, unsupported type, reply target from another conversation, and Barka on a Muscat conversation were all refused.
  - Not verified: an actual media send to a customer, which needs a real recipient.
- **Rollback.** Revert the PR and redeploy `whatsapp-inbox` from `3934b84`. The new function can stay unused or be deleted.

**Pending, approved by the owner for later:** create Facebook Pages "عمان فيلا مسقط" and "عمان فيلا بركاء", then link @omanvilla1 and @omanvilla2 with the owner entering each Instagram password.

## 25 October 2026 — clients/properties as compact tables, faster clients page

The owner asked for a faster clients page and for clients and properties as spreadsheet-style rows instead of stacked cards. This intentionally overrides the earlier "stacked lists" guardrail. Deals are untouched.

- **Clients (`crm-operations-v6.js`).**
  - One line per client: name with role tags, phone, branch, current request (opens the request), stage, follow-up (overdue in red), first contact, and actions.
  - Drawn 100 rows at a time, with "عرض 100 أخرى" and "عرض الكل".
  - Filtering, sorting and the export snapshot still cover the whole list.
- **Properties.** One line per property: name and code, branch, area, type, rooms, land, built area, price, status, added date, and actions. Ordered branch → area → newest.
- **Speed (measured from Oman, owner, 1,486 clients).** First open 17 s → about 3 s. A return visit draws the cached list at once and refreshes it quietly. Changes:
  - Paged reads run in parallel after the first page gives the exact count; the same completeness checks apply.
  - The unused per-client agent-name join was removed from the clients query.
  - First-contact batches run in parallel.
  - SQL45–47 rewrote `crm_client_first_contacts`. Messages are now checked with the same two access rules, but only on the id columns those rules read; the per-row JSON of whole messages, including raw_payload, is gone. The lookup runs in two steps. Output is identical for owner and Barka; four parallel calls went from about 3.4 s to 0.5 s.
- **Database load.** The 30-second unread badge now calls `whatsapp-inbox` v16 `counts` unless the WhatsApp page is open. The full list (100 conversations, latest messages, clients) had been the largest repeated database load.
- **Rollback.**
  - Database: apply `db/changes/45-…forward.sql`, then the 46 rollback.
  - Inbox: redeploy `whatsapp-inbox` from `a4615b3`.
  - Front end: revert the PR.

## 24 October 2026 — Instagram metrics refresh (instagram-discovery v3)

- **Problem.** Marketing showed "قياسات غير متاحة" for links saved after 23 September (catalog or staff), for example the Al Khoudh 7 villa at 135,000. The page reported views for only 10 of 33 posts.
- **Cause.** Metrics were written only by the manual per-property `sync_property` button. The Instagram connection itself is healthy.
- **Fix.**
  - The scheduled worker now also refreshes metrics for 6 saved Instagram links per run (every 5 minutes); each link is refreshed every 12 hours.
  - The media id comes from the event or the account catalog.
  - Earlier values are kept when Meta returns no views.
  - Links not owned by the account are marked `error` and retried after 12 hours.
- **Limit.** YouTube links remain manual; there is no YouTube metrics integration.
- **Rollback.** Redeploy `instagram-discovery` from commit `1e6e1cb`.

**Deferred by the owner until they say "start testing":**
- the WhatsApp AI reply test from the allowed number ending 1169;
- uploading property cover photos, which image matching needs.

## 24 October 2026 — needs-intervention queue, saved-link reconciliation, AI suggestions (SQL42/43)

Owner request: the CRM should work out what each WhatsApp inquiry is about, and send anything unclear to a clear human queue on the dashboard that opens the exact conversation.

- **SQL42 (applied, migration `20261024162805`).**
  - `crm_attention_queue(limit, offset)` lists conversations with pending review rows (`unmatched_property_links`) or a hand-off, grouped per conversation, with image/link/text counts.
  - `crm_classify_inquiry(conversation, kind, property_ids[], note)` saves one of: property (1–10 listings, e.g. two villas in Al Rumais), general, unavailable, non_real_estate, other (note required).
  - Property links reuse `record_property_link_inquiry_internal` and `crm_finalize_property_message`.
  - Both functions require access to the exact conversation (branch separation, investment owner-only) and a property in the caller's branch.
  - A customer's explicit request for a person is never cleared by classification.
- **Frontend `crm-attention.js/.css`.**
  - A card under the dashboard header: each row opens the conversation via `openDashboardWhatsAppConversation`, and "تحديد الاستفسار" opens the classifier.
  - The same button appears in the open conversation header.
- **SQL43 (applied, migration `20261024164513`).**
  - The text checker in the webhook queued a second review row and raised a hand-off for messages that the insert trigger had already attributed by a saved publication link. A database trigger now skips such rows; the same guard is in `_shared/property-inquiry-service.mjs` for the next webhook deployment, which has not happened yet.
  - Saving a publication link for a listing now links every pending review row carrying that exact link.
  - Cross-branch rows (for example a Barka chat about a Muscat listing) stay with staff.
  - The automatic "identify the property" hand-off is suppressed or cleared only when no pending review row remains.
  - One-time catch-up: 89 rows linked by saved link and 1 already attributed, both recorded in `crm_repair_private.sql43_auto_resolved`; 55 stale hand-offs cleared, recorded in `sql43_cleared_handoffs`.
- **Edge function `inquiry-ai-suggest` (v2, deployed).**
  - Reads the last 60 messages: customer text, voice transcripts and image readings, plus staff replies with details and links.
  - Also reads up to two customer images, the branch inventory, and saved link mappings. Instagram catalog captions are included for the owner only, because the catalog is owner-only.
  - Stores a suggestion (kind, listings, confidence, Arabic reason) on the pending rows. It never links, replies or sends anything.
  - The owner can analyse 5 conversations at a time; staff can analyse one conversation at a time.
  - Limitation: no listing has photos in `properties.images`, so image-to-inventory comparison has nothing to compare against until cover photos are uploaded.
- **Tests.**
  - SQL42 was trialled in rolled-back transactions:
    - Owner: 399 conversations in 42 ms.
    - Barka: 192 conversations, all Barka, in 158 ms.
    - Barka was refused on a Muscat conversation (`not_assigned`) and on a Muscat property (`invalid_property`).
    - A two-villa link and a non-real-estate classification both worked.
  - SQL43 was trialled the same way before it was applied.
  - Real sessions:
    - The owner card shows all branches and the deep link opens the right conversation.
    - Barka sees only Barka conversations and Barka properties, with no batch button.
    - The AI dialog works for both sessions.
  - CI: 442 tests, 0 failures.
- **Rollback.**
  - Run `db/changes/43-saved-link-reconcile.rollback.sql`, then `42-attention-queue.rollback.sql`.
  - Remove the two `crm-attention` entries from `index.html`.
  - Delete the `inquiry-ai-suggest` function.
- **Automatic replies: not enabled.**
  - The existing runtime is in `test` mode with one allowed customer phone ending 1169 and the `buyer_intake_v1` scenario, which asks for missing requirements once.
  - Any new reply wording (details without location, alternatives on budget or room changes, asking for a visit time, then handing to a person) starts in the owner-only dry-run under "واتساب > تجربة الردود" before the test number.

## 24 October 2026 — same-origin SDK and database hardening (SQL35/36)

Frontend is still **20261021-client-v17**. PR #2 (merge `9234553`) only makes `index.html` load the identical pinned supabase-js 2.118.0 from `vendor/` instead of jsdelivr, keeping the SRI hash; `app-base-v15.html` is unchanged. Live: 34/34 files byte-identical to main, vendored file matches SRI, Chrome's cross-site `document.write` warning gone.

**SQL35** `20261024081343_profile_commission_guard_20261024`: staff can no longer change their own `profiles.commission_rate` through the self-edit policy; the owner still can. The column feeds no function or view today. Transaction-local role test (rolled back): agent rate change blocked, agent name change allowed, owner own/agent rate change allowed. **SQL36** `20261024081419_revoke_anon_table_privileges_20261024`: `anon` holds no privileges on any public table (274 grants on 40 tables saved in `crm_repair_private.anon36_grants_backup`); postgres default privileges for new public tables/sequences no longer include `anon`. `authenticated`/`service_role` grants unchanged; function EXECUTE grants untouched. Anonymous REST reads/inserts now return `42501` instead of empty results.

Verified after apply: owner's real session loaded the dashboard (18 calls, all 200) and the client list (1,409 clients, 10 calls, 0 errors). Not covered: employee sessions, every page, writes. Rollback: `db/changes/36-…rollback.sql` then `35-…rollback.sql`.

**SQL37** `20261024082708_rls_initplan_wrap_20261024`: every bare `auth.uid()`, `auth.jwt()`, `my_company()` and `my_role()` in public RLS policies is wrapped as `( SELECT f() )` so it is evaluated once per statement (85 policies; originals in `crm_repair_private.rls37_policy_backup`). Logic is unchanged; row-dependent helpers (`can_access_client`, `can_access_request`, `staff_can_access_branch`, `investment_row_allowed`) are untouched. The `auth_rls_initplan` advisor went from 37 to 0. Before apply: a rolled-back trial matched all 28 owner/agent visible-row counts, and a forward→rollback trial restored all policies byte-identical.

Measured `count(*)` per visible table, best of 2–3, same session data (before → after): owner clients 137→59 ms, client_requests 125→75, activities 441→190, whatsapp_messages 1158→1148; agent clients 1670→1563, client_requests 2385→2185, activities 7955→5895, client_request_assignees 1409→562, deals 115→56, whatsapp_messages 14415→13530. Agent counts were identical before and after. The remaining agent cost is the per-row helper functions above, not this rewrite; `crm_dashboard_work` (≈2.5–2.9 s in the owner's live session) is a SECURITY DEFINER report and unaffected. Live after apply: owner dashboard 18/18 calls 200, client list 1,411 clients, 12 calls, 0 errors. Rollback: `db/changes/37-rls-initplan-wrap.rollback.sql`.

**SQL38** `20261024085336_investment_link_fast_path_20261024`: `crm_repair_private.investment_link_is_private` (the recursive walk behind `investment_row_allowed`, ≈8.9 s over 10,473 messages for the agent) now returns `false` right after the row's own markers when none of the six marker-capable columns (`clients.lead_route`, `client_requests.route_key/branch_key`, `whatsapp_conversations.route_key`, `properties.branch_key`, `appointments.branch_key`) holds `'investment'` anywhere — checked inline via five empty partial indexes. With any marker present the original full walk runs unchanged. Event trigger `crm_guard_investment_marker_columns` rejects DDL giving the 15 walk tables another marker-capable column. Production currently has zero investment-marked rows in those columns.

Evidence before apply (all rolled back): ID-set fingerprints (count + md5 of sorted ids, rows created before the trial) for owner, active agent and both inactive agents over 16 tables and the two access views — 72/72 identical. Marker trial: an agent-visible client marked `investment` became invisible to the agent with its conversation and 4 messages (1/1/4 → 0/0/0) while the owner still saw it; new vs original function gave 0 mismatches over 300+ messages and 300 clients with the marker present. Event trigger blocked `ALTER TABLE deals ADD COLUMN branch_key` and allowed an unrelated column. Agent `count(*)` after apply (before → after): whatsapp_messages 13,530→2,173 ms, client_requests 2,185→193, clients 1,563→209, property_inquiries 555→48, whatsapp_conversations 640→198, activities 5,895→2,979; same row counts. Live owner session: dashboard 18/18 calls 200, WhatsApp list loads (100 conversations). Rollback: `db/changes/38-investment-link-fast-path.rollback.sql`.

Open from the same review: leaked-password protection still disabled (Dashboard → Auth; not available through the connector); agent full WhatsApp message count ≈2.2 s (per-row `to_jsonb` + conversation check, not plan cost).

**Owner instructions, 24 Oct (later).** Staff are named by branch only — Barka and Muscat; one active employee remains (Barka). Investors were moved onto the Muscat number (+968 71770030), which now serves investors as well; investment stays owner-only in the CRM. The dedicated investment number (+968 90944469) cannot be linked because Meta will not release it — deferred, not a CRM change. Barka (+968 92344273) unchanged. Live routes already match: `muscat` → owner, `investment` owner-only with no number, `barka` → the Barka agent. Caveat: if Muscat is assigned to an employee again, investor chats arriving on the Muscat number are visible to that employee unless they are classified `investment` first.

**SQL41** `20261024095324_dashboard_owner_plan_20261024`: the owner's `crm_dashboard_work` runs in `crm_repair_private.crm_dashboard_work_owner`, the same body with `SET enable_nestloop = off` (its CTE joins were nested loops over ~2.9 M row pairs); every other caller keeps the original path, and both state each list's order in `jsonb_agg` (the `deals` order previously depended on the plan). Trial (rolled back): output identical to the original for owner branches/investment and agent branches over three pages; owner ≈900→≈285 ms, agent unchanged; the agent is refused the investment scope and the owner copy. Applied bodies match the trial by md5. Rollback: `db/changes/41-dashboard-owner-plan.rollback.sql`.

**Real Barka employee session (browser pane, 24 Oct).** Read-only API checks from the signed-in agent: 0 Muscat / 0 investment clients, requests and conversations, 547 Barka clients; expenses, lead routes and the Instagram catalog return 0 rows; commission report refused; commissions null in `crm_deals_access` (deposit amounts visible by design — staff record the deposit stage); direct financial column reads refused (42501). Attempts to make herself owner, raise her commission rate, change company or take the Muscat route were refused or affected 0 rows; profile unchanged. WhatsApp inbox list: 100 conversations, all Barka. Live timings: client list 0.66 s, dashboard 1.25 s, inbox 2.4 s. Not covered: write journeys (no test data agreed), physical phone.

**Both real sessions together (24 Oct, later).** Owner in Chrome (Claude in Chrome) and Barka in the app's browser pane. Owner live: dashboard 0.72–0.85 s after SQL41 (deals ordered), investment scope works, WhatsApp list shows Muscat and Barka. Every page opened in both sessions (dash, clients, properties, owners, deals, deposits, viewings, calendar, daily, reports, expenses, team, settings, WhatsApp; Barka is correctly kept out of reports/expenses/team) with zero failed API calls and zero JavaScript errors. Phone viewport 375 px: no horizontal overflow on six main pages. Write journey as Barka: a clearly labelled synthetic client (+968 90000017) and a follow-up task were created and edited, the agent's own delete affected 0 rows, the owner saw both and deleted them; a database check found no remaining rows. **whatsapp-inbox v15** runs the `messages` action's page, client, requests and automation-event reads together (errors in the original order); responses byte-identical to v14 for 3 agent and 3 owner conversation reads, unknown conversation still 404; opening a conversation 1.7–1.9 s → 1.0–1.4 s. Meta (read-only): Muscat +968 7177 0030 and Barka +968 9234 4273 both Connected, quality High, in portfolio "وسيط عقاري" with a separate test WABA; two marketing templates active and unused; system user "Habib CRM" has Admin access with app "Habib CRM Connect"; stored WhatsApp tokens are non-expiring system-user tokens. Leaked-password protection requires the Supabase Pro plan (project is on Free); the four disabled Edge functions can be deleted from Dashboard → Edge Functions → function → Settings → Delete edge function.

**Repository hygiene.** The six Edge functions deployed but missing from the repo are now tracked under `supabase/functions/` (source as returned by the deployed functions: `crm-ai-test`, `whatsapp-admin-bind-probe`, `meta-app-business-probe`, `whatsapp-meta-repair` return 410; `whatsapp-meta-login-log` and `whatsapp-save-system-token` require owner/manager). Deleting the four disabled ones is not possible through the connector. New `.github/workflows/ci.yml` runs the unit and security tests on every pull request into `main` and every push to `main`.

**SQL40** `20261024092338_access_helpers_plpgsql_20261024`: `can_access_client`, `can_access_request`, `can_access_whatsapp_conversation` and `staff_can_access_branch` changed from `LANGUAGE sql` to `plpgsql` with the applied query verbatim inside `RETURN`, so their plans are cached instead of re-planned per call (PostgreSQL 17 never inlines SECURITY DEFINER SQL functions). Signatures, STABLE, SECURITY DEFINER, `search_path` and grants unchanged. Evidence (rolled back): ID-set fingerprints for owner, active agent and both inactive agents over 18 relations 72/72 identical; with an agent-visible Barka client moved to Muscat and another marked `investment`, the agent went from seeing both (6 and 3 activities) to 0/0/0/0 while the owner still saw both, and the new functions matched reference copies of the originals with 0 mismatches over all activities, clients, requests and branch values. Agent `count(*)` (before → after): activities 2,942→1,560 ms, tasks 28→13, viewings 53→27, appointments 42→19, deals view 19→13. Live owner session after apply: dashboard 19/19 calls 200, client list 1,421 clients, 11 calls, 0 errors. Rollback: `db/changes/40-access-helpers-plpgsql.rollback.sql`.

**WhatsApp list speed (SQL39 + whatsapp-inbox v14).** The function runs in `ap-south-1` while the database is in `ap-northeast-1`, so each of its ~9 sequential database/Auth calls cost a cross-region round trip. **SQL39** `20261024090157_whatsapp_latest_messages_lateral_20261024` makes `crm_whatsapp_latest_messages` read the newest visible message per conversation via `LATERAL … LIMIT 1` instead of RLS-checking every message of 100 conversations (owner 1,088→39 ms, agent 1,017→65 ms; rolled-back trial gave identical output for both roles on their top 100 and on all conversation ids). **whatsapp-inbox v14** (verify_jwt unchanged) runs independent reads together: `getUser()` with a profile prefetch for the token subject (used only if `getUser()` returns that same id), routes with staff phones, list with counts and hidden counts, then clients with previews; errors are checked in the original order and every authorization step is unchanged. Live owner checks: same response keys and 100 conversation ids, 99/100 rows byte-identical (the other had a new real message), same unread/handoff totals, `messages` action unchanged, unauthenticated and forged-token calls 401, no 5xx in logs. Warm list call 3.6–4.7 s → 1.5–2.1 s (first call after deploy ≈6.8 s cold start). Not covered: an agent's real browser session. Rollback: `db/changes/39-…rollback.sql` and redeploy the v13 source (`git show dcf8cc1:supabase/functions/whatsapp-inbox/index.ts`).

## Deployed: client chronology and guarded WhatsApp context — v17

Frontend **20261021-client-v17**, accepted runtime **f120eabc201cf9849c3fe3e6c6ef9e893db31635**, is on main. Delivery-only commit **b70ccdd7d8ab5be95a173c037412a5410ba5f9d9** adds `.nojekyll` so the pure trial modules under `_shared` are served unchanged. SQL34 is applied as **20261021130950_client_chronology_and_context_20261021**. WhatsApp webhook is **39**, send is **17**. Both Edge deployments pin the exact accepted repository entrypoint and its relative imports by immutable commit URL; the original entrypoint authentication/send logic is unchanged, while the shared attribution implementation changes. No new auto-reply rollout occurred.

Clients now sort newest first by their earliest actual permitted inbound WhatsApp/Instagram timestamp, not follow-up priority or latest message. The list shows **أول تواصل مسجل** with full date/time, Western numerals and Asia/Muscat. When no recorded inbound timestamp exists, registration is labelled **أُضيف للنظام · أول تواصل غير مسجل**; an original phone contact predating CRM history is not fabricated. Manual registration provides the explicit fallback sort timestamp. Filters, stacked layout and matching CSV source remain. Failed chronology reads are visible failures rather than apparently valid guessed times.

WhatsApp attribution now supports the exact stored Google map identity/native precise GPS, sufficiently specific listing text/land/build facts and Omani location phrases. An adjacent short question may inherit only an independently proven unique property context within24hours, under a service-only server recheck. Rejections, alternatives, contradictions, several candidates and unsolicited staff broadcasts do not create a guessed inquiry. Existing saved-link and legible-image evidence paths remain. **Location requested is visit interest, never an appointment or completed visit**. Its original timestamp is recorded once in request history. No bulk historical replay was performed.

Owner WhatsApp page has **تجربة الردود**. This is a text-only, deterministic in-browser draft simulator against permitted public inventory fields: an unspecified request remains unknown; the draft asks for the ad, area, budget or type one missing item at a time, and can use a staff listing reply following an actual ask. It has no customer-send API, business write, hosted LLM request or media processing. Closing/branch/session changes discard the draft. It is not a newly connected WhatsApp test account and not a live AI conversation. Existing restricted test-mode configuration is unchanged and its private allowlist was not expanded.

## Evidence

[Acceptance39605190931](https://github.com/omanvilla/habib-crm/actions/runs/39605190931) passed the complete Node/security gate and isolated PostgreSQL chronology/context/role checks, adjacent original semantic inquiry regressions and rollback/reapply. Existing two PostgreSQL-context Node skips are not counted as Node executions. Thirty-six grouped browser checks passed across client5/workspace11/design10/marketing5/discovery5; all downloaded reports have zero page errors, external requests and production writes. Synthetic artifact12348291921. The first database attempt correctly rejected an empty synthetic `matched_facts`; the fixture was repaired to include real area/price evidence without weakening production guards.

Live transaction-local authenticated-role SQL compared400 owner client timestamps with original permitted inbound messages:396 known, four unknown, zero differences, about1785ms for the aggregate comparison. Barka returned216 permitted rows from the same400-ID sample and zero Muscat/private rows; a retired identity returned zero. These are scoped database assertions, not fresh real-user browser logins.

[Public verification39606322028](https://github.com/omanvilla/habib-crm/actions/runs/39606322028) at2026-10-21T13:15:02Z confirmed **30/30 files HTTP200 and SHA256-identical**, including both dynamically imported pure modules. A fresh unauthenticated Chromium loaded v17, imported and exercised the pure preview with no business API attempt, and formatted Oman midnight correctly. Real unauthenticated POST probes returned401 `missing_auth` for send and401 `invalid_signature` for webhook before processing. Public artifact12347694004. The one-time verification branch is `codex/client-public-verification-20261021` at `d5203a47544426bdcc082c9d21f6e5cdba4573ae`; it is not a scheduled monitor.

The57-deal aggregate and restricted automation configuration matched their pre-release fingerprints. Client count remained1291, but its aggregate fingerprint changed during active production: one client was updated and had new message activity in the observation window (three new messages in total). Therefore no whole-client-table byte-identity claim is made. The release did not manually edit customer rows, insert synthetic clients or send customer test messages. SQL34 contains catalog changes only. Selected boot/uncaught/missing-function/attribution-failure log patterns returned zero matches in the inspected13:11–13:19UTC window; this is not an exhaustive provider audit.

## Rules retained and limits

Muscat/Barka account-independent operations and owner-only canonical investment boundaries remain. Hadeel stays retired; Barka stays active; Muscat awaits the branch-owned email. Keep Deals unchanged, marketing visible, stacked lists, compact home work categories, Reports performance and no Instagram-DM/templates. Preserve true booking/closing/collection dates, milli-OMR, existing shares and all historical authorship.

Instagram discovery remains enabled every5minutes; old WhatsApp scheduled follow-ups remain disabled. SQL34 added no public SECURITY DEFINER routine or broader client grant. Post-change advisors retain the existing two protected definer views,18 privileged-RPC notices and disabled leaked-password protection; the private deny-all backup adds one informational finding. These warnings are not claimed resolved.

Fresh authenticated v17 end-to-end UI use, physical phones, new real media/location customer acceptance and actual outbound trial delivery are not certified by synthetic tests or unauthenticated startup. Existing Auth/Storage/Realtime/backup-restoration limits remain. This release has no audio/video interpretation or guarantee of identifying ambiguous screenshots. The owner can now trial wording safely before a separately verified real test-number rollout.

Recovery: restore prior frontend and both prior WhatsApp shared modules before SQL34 rollback; keep legitimate request events and business records. The original candidate-reader definition is in `crm_repair_private.client34_catalog_backup`. See [release evidence and scope](client-whatsapp-20261021.md).
