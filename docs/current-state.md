# Habib CRM — current state

Updated 2026-11-06. Read AGENTS.md. Latest owner instructions govern. Previous Instagram discovery, design, audit history and outstanding limits remain in [the v16 archive](current-state-v16-20261021.md).

## 8 November 2026 (evening) — R9 Muscat redirect, R10 heirs (commit 78026ba, agent v48)

- **Why.** Ahmed's evening review of 42 chats (`crm_owner_notes`, kept in the project doc «أوامر-أحمد-8-نوفمبر-مساء»). Decisions of the first batch: investors and any investment question, and owners of Muscat-area properties, who write to the Barka number are sent to the Muscat number 71770030 with «هذا الرقم خاص لعقارات بركاء»; heirs' property is declined politely; location rule unchanged (property and time first, ask which property when unclear).
- **Live.** `whatsapp-reply-agent` v48 pinned to 78026ba, brain synced (43,170 chars). The redirect text comes from the code (`redirectToMuscat` in `index.ts`), is sent at once (no hold), and names no project or figure. Muscat number: investors continue as before and wait for Ahmed.
- **Dry run at 78026ba (6 real Barka chats).** Al Hail villa owner, an investment house under 50k, an Iraqi asking for residency, a Yazan price question, a farm for daily rental: all got the Muscat redirect. A Khawd+Barka buyer was not redirected (both areas). The heirs reply (R10) has no unprocessed sample; it is a brain rule only and still to be seen on a live message. Dry drafts deleted.
- **Not done yet from the 42 notes:** visits that were never recorded (no follow-up after 1.5 h), documents for new owners (conflicts with the existing «no ownership papers at first» rule, waits for Ahmed), client behaviour and seriousness score, home screen tidy-up and slow approvals list, WhatsApp alert for missing property details, Barka/Muscat pricing day in the schedule, AIDA and Al Noor appointments.
- **Rollback.** Pin `whatsapp-reply-agent` back to 378fc06, revert 78026ba, run the prompt sync.

## 8 November 2026 (afternoon) — archive on the phone, videos of sold properties, hot buyer WhatsApp alert (e15230a, b522710)

- **Archive on the phone.** The «السجلات» switch (active / sold / archived) was behind the phone «الفلاتر» button; it now stays visible next to the search (`crm-simple-ui.css`). Checked on desktop that the label exists; not checked on a real phone.
- **Videos.** Today's reel `instagram:DfeJC4ICmTO` («الأولى انباعت، والتوين الثانية للحين متوفرة») linked to «فيلا الرميس 59 سلطان 2» through `instagram_decide` as Ahmed's decision (audited). The home «يحتاج قرارك» card now offers sold / reserved / archived properties too, tagged and after the available ones (the full list already did). The 241 older unlinked videos are mostly generic «تم البيع» captions; they need Ahmed to look, captions alone are not enough.
- **R7 hot buyer alert.** Trigger `crm_owner_hot_alert` → `whatsapp-owner-hot-alert`: a «مشتري جاد» / «تفاوض» handoff on Barka or Muscat sends Ahmed's private number (owner profile phone) a text from that branch number: name, number, topic, wa.me link. Tested with a «تجربة» message from each number: both delivered (Meta 200). Works inside the 24 h window Ahmed opens daily with «هلا»; failures are recorded as `owner_hot_alert` events.
- **Dry run.** Mohamed Al Harthy's 13:19 reel message now gets «الفيلا اللي سألت عنها في الرميس انباعت» + the 305/295 villa.

## 8 November 2026 (afternoon) — R6: a sold property gets the nearest available one (commit 378fc06, agent v47)

- **CRM.** «فيلا الرميس 59 سلطان 2» (300/270) set `sold` (sold elsewhere, 8 Nov); «سلطان 1» (sold elsewhere before, was `available` + archived) set `sold`, still archived. The Rumais 59 villa 305/295 («هشام») is the one on offer. Marking Sultan 2 sold queued 11 «انحجزت / تحب تشوف خيارات ثانية ؟» notices, pending owner approval; Sultan 1 queued nothing new.
- **Brain (synced at 378fc06).** Sold rule: «انباع» then the nearest available property (same branch/wilayat, area, type, price within 10k, size) with its ad and the visit question; specs question only when nothing is close. Twin rule only for identical sizes. Rumais 59 rule rewritten. «اول ما يتوفر» no longer precedes a sold-property alternative.
- **Code.** Sold list newest first and including archived sold properties (with 51 sold in 150 days and `limit(40)` without order, a property sold today could be missing). Old reels / matched messages of a sold property are labelled sold in the transcript. The «said sold while available» guard skips chats about a really sold property. «Ad already sent» also needs the same land size.
- **Dry run (4 real chats about Sultan 2: a message, an image, two October reels):** all answer «الفيلا اللي سألت عنها انباعت» + the Rumais 59 villa 305/295. Before the fixes two were handed over and two had «انباعت» stripped. Dry drafts deleted.

## 8 November 2026 — Ahmed's chats stay his, no negotiation before a visit, fixed rules file (commits ad42d00, e564ac4)

- **Why.** Tasnim (barka, 7 Nov): the agent carried on 30 s after Ahmed's typed reply (6 Nov rule), a pre-visit discount question became a «تفاوض» handoff, and the staff-reply trigger closed it. Ahmed's decisions are now [docs/agent-rules.md](agent-rules.md) R1–R5, with a mandatory change procedure (find conflicts, ask Ahmed first).
- **Live.** SQL `owner_hold_visit_first_20261108` (`agent_returned_at`, `crm_chat_hold()`, hard handoffs not closed by staff replies; baseline: manual replies of the last 24 h count). Functions pinned to e564ac4: `whatsapp-reply-agent` (v46), `whatsapp-visit-followup-auto` (v19), `whatsapp-inbox` (v21). Brain synced at e564ac4. Inbox chat shows «🤫 العقل ساكن هنا» with «↩️ رجّعها للعقل»; «✓ تمت المعالجة» also hands the chat back.
- **Dry run** (whatsapp-reply-agent-dryrun at ad42d00, brain from that commit, 20 chats incl. Tasnim's 7 Nov message): Tasnim now gets «شوفي البيت اول واذا ناسبك نتكلم في السعر» + «متى يناسبك تزورين ؟», no negotiation handoff. Dry drafts deleted afterwards. At publication 8 chats were held by R1, 6 by an open negotiation, 9 muted.
- **Inbox banner (7bcd945).** The new chat UI (`crm-whatsapp-chat.js`) hides `#waClientStrip`, so the old «✓ تمت المعالجة» was invisible too. The banner now sits under the chat header: handoff → «✓ تمت المعالجة», R1 hold → «↩️ رجّعها للعقل»; both call `clear_handoff`. Checked live in Chrome on Tasnim's chat (shows the R1 banner; not clicked).
- **More dry runs at e564ac4.** A customer who visited (Al Saadi, Al Udhaybah) asking the final price → «مشتري جاد» handoff, no reply. A customer who visited Al Rumais but asked for a discount on the Al Shakhakheet villa he had not seen (Hamed Al Balushi) → the model still wrote «تفاوض», the code guard turned it into «شوف العقار أول…» + «متى يناسبك تزور ؟». Dry drafts deleted.
- **Outreach not redeployed, by decision.** `whatsapp-outreach` has the R1 guard in the repo, but the live copy is inline and not proven identical to the repo, and it only sends rows Ahmed approved himself, so R1 is not at risk there.
- Branch `claude/negotiation-hold-20261108` is superseded and was never deployed.
- **Rollback.** Pin the three functions back to 0bdb7b9 / dab6b95, revert e564ac4 on main and re-run the prompt sync.

## 8 November 2026 — investor brain: rental income first (commit 47b62f1), live by prompt sync

- **What changed.** `brain.ts` (قسم المستثمر) and `knowledge.ts` only; no function redeploy. Someone who wants monthly income is offered only a property in the list that has «المؤجر حالياً» (today: the Al Hail South house with two rented flats, OMR 200 a month on OMR 130,000), quoting the written figure with no yield percentage and no promise the rent continues. With no such property the agent says so and does not substitute an off-plan project, which pays no rent before handover (2027 to 2029 as announced). Small budget or no capital: said plainly, no financing or loan advice, handoff. A question about residency plus investment gets no promise, only "by the rules, in specific projects".
- **Synced** with `agent-prompt-sync` at 47b62f1 (brain_base 40,525, knowledge 6,350 characters). Rollback: revert 47b62f1 on main and run the sync again.
- **Dry run on the latest 20 investor chats** (own number excluded): 14 drafted and held (dry-run drafts are hidden from the approval screen and refuse to send), 5 already answered live, 1 muted. Project figures in `knowledge.ts` were NOT touched; the Wadi Zaha and Al Yazan numbers still differ from the 5 Nov market study and wait for Ahmed's update.

## 6 November 2026 — «تم» on a hot alert saved for every device; visit follow-ups name the property (SQL74)

- **«تم» on a handed-over chat (SQL74, migration `hot_alert_done_20261106`).** It was kept in the browser only, so pressing it on the computer left it on the phone. Now «تم» calls `crm_hot_alert_done(conversation)` (owner only, `42501` for branch accounts, `P0002` for an unknown chat), which sets `whatsapp_conversations.owner_alert_done_at`. The alert is hidden while that time is at or after `handoff_updated_at`, so it comes back when the chat is handed over again. An older «تم» still in a browser is moved to the database the first time that browser loads. Trial in a rolled-back transaction: Barka refused, owner saved, unknown id refused.
- **After-visit question by name (`whatsapp-visit-followup-auto`).** The review only got the property type in English and the area, and wrote «بخصوص الزيارة قدرت تشوف العقار ؟» (3 of the last 25 follow-ups). It now gets the name the client knows («فيلا الرميس», type in Arabic plus area, never the internal title) and is told to ask his opinion of it by name. If a text still asks a generic «تشوف العقار» / «بخصوص الزيارة», it becomes «السلام عليكم كيف لقيت <name> ؟» (feminine kept). Applies to after-visit, daily review and the owner's instruction alike.
- **Not tried yet:** the buttons from the Barka branch's Android phone.
- **Rollback.** Revert the PR, then `db/changes/74-hot-alert-done.rollback.sql`; redeploy the follow-up stub on `51cb94b`.

## 6 November 2026 — visit results are the AI's job; hot client alert (SQL73, PRs #70, #71), live

- **Visit results.** Each run of `whatsapp-visit-followup-auto` (every 15 minutes, 9am to 9pm, independent of `visit_followups_auto` because it sends nothing) reads up to 10 past visits with no result from the last 30 days whose client wrote after the visit day and after `viewings.ai_checked_at`. It saves done (with `client_feedback`, `liked`, `pipeline_outcome`, `rejection_reason`, `outcome_note`), `no_show`, `postponed` (a new date when the client gave one) or `cancelled`, only at confidence 0.75 or more, checked on `row_version`. A line «[الذكاء الاصطناعي date] …» is added to the visit notes. `sync_viewing_to_crm` moves the deal as for a manual result. Unclear chats are only stamped `ai_checked_at` and wait for the next client message. A saved result sends that visit's follow-up on the daily list back to review. A serious buyer raises «🔥 مشتري جاد» to the owner, once a day per client. `preview_results` (scheduler secret) writes nothing. First live run 6 Nov 11:15 UTC: 10 read, 2 saved (one visited and hesitant, one visited and serious), 1 alert, 8 unclear.
- **Owner home.** «زيارات تحتاج نتيجة» is now a box «زيارات يتابعها الذكاء الاصطناعي N» beside the approval and owner-offer boxes, opened on tap; the manual «سجّل النتيجة» stays inside.
- **Hot client alert (`crm-hot-alerts.js/.css`).** Under «لوحة الإدارة · احمد · Habib Sons Real Estate», owner only: unread «🔥»/«📞» notifications of the owner, plus chats on either branch handed over as «مشتري جاد», «تفاوض» or «طلب اتصال» in the last 7 days (Barka chats are assigned to the branch account, so their notification never reached the owner). «فتح المحادثة» opens the chat; «تم» marks the notification read, or hides a handed-over chat on that browser until it is handed over again. A new alert also shows a browser notification while the CRM is open. Checked at 375px as the owner.
- **Rollback.** `db/changes/73-visit-ai-result.rollback.sql`, revert the PRs, redeploy the stub on `5b362dd`.

## 6 November 2026 — follow-ups inside the 24 hour window go out from the AI (owner's decision)

Each run (every 15 minutes, 9am to 9pm, when `visit_followups_auto` is on), a reviewed follow-up on his list whose chat had a client message in the last 24 hours is sent at once as free text (the review's text for this client), for visits and request follow-ups alike. It is not sent when an unread voice note is among the last 8 messages, the client wrote after it was prepared, the chat is muted or handed to a person, or the number is a company number. Free text does not count toward the 20 a day. Outside the window nothing changed. When this was added, no follow-up on the list was inside the window. Request follow-ups sent this way have `reason='auto_in_window'`, `send_mode='service'`.

## 6 November 2026 — «أمر للذكاء الاصطناعي» on each daily follow-up (SQL72, PR #67), live

- **What it does.** Each follow-up in «متابعات اليوم» has «أمر للذكاء الاصطناعي» (owner only; branch accounts do not see it). The instruction goes to `whatsapp-visit-followup-auto` with the owner's login. It reads the whole chat again with the instruction and either rewrites the text (shown before he sends, nothing is sent) or removes the client with the reason kept (`review_skip` / `review_wait_for_match`, so the client stays off until they write again). The day's automatic-send wait (`reviewed_at`) does not move.
- **Where it is recorded.** On the follow-up: `owner_instruction`, `instructed_at` (`whatsapp_visit_followups` or `whatsapp_outreach_queue`). As a lesson: a `crm_owner_notes` row with `context.source='followup_instruction'` holding kind, follow-up id, client, branch, decision, result, reason, text before and text after. Lessons feed `whatsapp_agent_prompts.lessons`, which every follow-up review now reads (and the reply agent already did). The list shows «انكتبت حسب أمرك».
- **Voice notes.** With an instruction the review does not wait for an untranscribed voice note; the owner writes what was said and the text follows his words.
- **Test without writing.** `preview_instruction: {kind, id, instruction}` with the scheduler secret returns the decision and text and writes nothing. Tried on a real follow-up: the text changed to ask which area he wants after the site did not suit him.
- **To answer "what happened with this client":** `select created_at, note, context from crm_owner_notes where context->>'source'='followup_instruction' and context->>'client_id'='<id>' order by created_at;`
- **Deployed:** SQL72 applied; function stub pinned to `913251a`. Page checked as the owner at 375px: 40 follow-ups, each with the button, box opens with the mic, no sideways scroll. Not yet tried: a real instruction from the owner's phone.
- **Rollback.** `db/changes/72-followup-owner-instruction.rollback.sql`, then redeploy the stub on `5ca14a1`.

## 6 November 2026 — old voice notes are gone at Meta

Our system never keeps a copy of a voice note: it has only Meta's media id (`media_id`), no Storage copy. On 6 Nov 40 failed notes from 14 to 26 Oct (7 of them in one client's chat from 25 Oct) were set back to retry and run through `whatsapp-transcribe-backfill`: all 40 answered `media_unavailable` from Meta with both keys. The ids touched are listed in `crm_repair_private.voice_retry_20261106`; all are back to `failed`. Since 28 Oct notes are transcribed on arrival (98 of 98 inbound up to 6 Nov). The only other copy is on the branch phone's WhatsApp Business app. For old notes, the owner's instruction on the follow-up is the way: he writes what was said.

## 6 November 2026 — owner private WhatsApp line (SQL68), merged, NOT yet live

Main `1596e02` contains a third WhatsApp route `owner` («واتساب المالك», +96890944469). It is the owner's own number with its own Meta phone number id once linked (coexistence, featureType `whatsapp_business_app_onboarding`).

- **Owner-only.** The route is forced to `owner_only_inbox=true` and assigned to the owner. `investment_link_is_private` treats `route_key='owner'` and anything that points to an owner-line conversation or message as private, so managers and agents never see the route, its conversations, messages, onboarding events or link activity (RLS, inbox, media, exports). The owner sees everything.
- **Not investment.** The investment row, `a00_guard_investment_route`, `a01_shared_reception_route` and `resolve_shared_whatsapp_business_route` are unchanged. Investor classification never moves an owner-line conversation.
- **Private capture only.** No client, request, inquiry, transcription or reply-agent draft on this line. The agent refuses `owner`. Replies come from his phone; echoes are stored.
- **History import.** After an owner bind, `whatsapp-embedded-signup` asks Meta (`POST /{phone_id}/smb_app_data`, `smb_app_state_sync` then `history`; once each, within 24h). The webhook stores `history` chunks as owner-line messages with original timestamps (`channel_source='owner_history_import'`, not unread, idempotent on wamid, media placeholders upgraded in place). Error 2593109 (history sharing off) is logged to `whatsapp_onboarding_events`. `smb_app_state_sync` contacts are not stored.
- **Linking.** «ربط / تحديث عبر Meta» on the owner card (Settings > routes), owner only; signup refuses any number other than +96890944469. Meta app fields `messages`, `history`, `smb_app_state_sync`, `smb_message_echoes` are already subscribed (v26.0).

**Follow-up fixes (SQL71, PRs #59, #60, #65, owner decision 6 Nov).** Everything reaches the daily list first. What he has not sent by 10am the day after it reached the list goes out by itself if the review allows, a UTILITY template or free text, 20 a day at most. A client changing, putting off or cancelling a visit updates it at once, whoever recorded it. The review now reads messages up to 3000 characters (it cut them at 500, which made answered voice replies look unanswered) and waits for a new voice note to be transcribed. `properties.rented_units` is an optional note on the property form, read by the review and the agent. The agent asks a name once, saves a stated name, otherwise adds a note to the client that the name was not given. The agent is deployed as a stub pinned to a commit on main.

**Not done.** SQL68 (`20261106090000_owner_private_route_20261106`) is not applied: the apply was cancelled at the confirmation prompt. Until it is applied, the owner card does not render (no route row) and nothing changes for staff. Then deploy in this order: `whatsapp-webhook` (stub importing commit `1596e02`), `whatsapp-inbox`, `whatsapp-reply-agent` (index/brain/knowledge), `whatsapp-transcribe-backfill`, `whatsapp-embedded-signup`, `whatsapp-direct-bind`. Then the owner links the number from the card.

**Verification.** `tests/owner-private-route.test.cjs` (31 synthetic handler tests) and `tests/owner-private-route-sql.sh` (SQL68 forward, re-apply and rollback on Postgres 16 with the live isolation functions copied, roles tested as owner, manager and agent). No live data was written.

## 5 November 2026 — audit fixes, owner type agent, visit presence, Instagram cards

Live on main (PRs #36, #37, #38). Database changes SQL55 to SQL59 are applied, each with a rollback file in `db/changes/`.

- **Runtime.** `mode=live`, `reply_agent_mode=direct` (investors and active deals wait for the owner), `auto_send_categories=[]`, `enabled_scenarios=[]`. The old engine and `buyer_intake_v1` stay stopped. `habib_whatsapp_followups_hourly` stays disabled.
- **Database closed (SQL56, SQL57).** The review tables moved to `crm_repair_private`, four functions got a fixed `search_path`, `crm_queue_property_outreach` lost public execute, and agents see only their own branch's owners.
- **Record of live changes.** `db/changes/20261105_live_sync_APPLIED.sql` holds the changes that existed only in the database, plus the scheduled jobs. `whatsapp-reply-agent-test` is a retired stub that returns 410.
- **Reply agent v26.**
  - `watchVisit` reads quiet paths and normal paths and logs agreed visits with `created_via='whatsapp_ai'`. It needs confidence of at least 0.7 and never moves or cancels a manual visit.
  - `visit_test:true` runs it without writing.
  - Requests are saved with `created_via='ai'`.
- **Owner type agent and visit presence (SQL58).**
  - `owners` gains `original_owner_name`, `kinship`, `has_power_of_attorney`.
  - `viewings` gains `ahmed_present`, `owner_visit_notes`.
  - `crm_set_visit_presence` and `crm_add_property_with_owner` accept the owner's login or a server call with no login, and refuse Barka. See `docs/add-property-from-claude.md`.
- **Listing purpose (SQL55).** New property column, which also needs the grant and the `crm_properties_access` view (see `CRM_DATA_COLUMNS`).
- **Instagram (SQL59, PR #38).**
  - The home page shows a card for each unlinked video from the last 14 days, with a suggested property. The owner confirms it, nothing links by itself.
  - Properties with no video for 7 days raise an alert.
  - Matching is `caption-facts-v2`. A caption with no price can link on area, bedrooms, bathrooms and one exact size, and a type conflict blocks it.
  - `thumbnail_url` refreshes on each scan for the newest 25 videos, and on the daily full scan for the rest.

**Verification limits.**
- CI passed on each PR.
- SQL was tried as live roles inside transactions that were rolled back.
- `watchVisit` was tried read-only on 12 real messages. No real visit has been logged by it yet.
- Screens were checked from the Barka account in the built-in browser. Owner-account screens have not been checked in a live session, because the Chrome extension was not connected.

**Owner home (SQL60, PR #40).** The owner's page has four sections from `crm_owner_home`: decisions, problems, properties, short report. The old lists stay behind a button. Staff pages are unchanged, and a failed load keeps the old page. Visits with no result always show. The upcoming list leaves after the first visit with `created_via='whatsapp_ai'`.

**Automatic visits and requests.** A client with several open requests made the visit save fail with `viewing_request_ambiguous`, which would also have stopped `watchVisit`. Trigger `crm_pick_viewing_request` now picks the closest request for `whatsapp_ai` and `system` visits. The manual form still asks.

**Investment projects and identical properties (SQL61, SQL62, PRs #42, #43).** Owner-only projects page. A video links to a project from a card, by link, or when its caption names one project. A video counts for identical properties only after the owner says yes. Each gets a row with `twin_of`, and inquiries count for each. The live test ran inside a rolled-back transaction, and no twin link exists until the owner approves.

**Automatic visit follow-ups (SQL63, PR #45).** `whatsapp-visit-followup-auto` runs every 15 minutes, 9am to 9pm Muscat, and sends without approval. It covers visits with no result from the last 30 days. Only UTILITY templates or free text inside 24 hours go out, and MARKETING ones stay in the approval list. Off switch: `visit_followups_auto`. Negotiation now gets no reply and goes to the owner. Interior photos of an occupied home get a fixed reply. Both rules were tried as dry runs on real messages.

**Daily list and chat review (SQL64 to SQL66, PRs #48, #51, #52). This replaces "sends without approval" above.** Each waiting follow-up is read first: the whole chat, up to 12 messages from the other number, and the available properties. It is kept with a text for this client, removed, or closed with what the client wants saved on the request. The list shows reviewed items only. An automatic send needs `auto_ok`, and waits until 10am the day after the review, 20 a day at most. A recent voice note with no transcript forces manual. Voice notes before 28 Oct cannot be read because the media is gone. The button opens WhatsApp Business on Android and iPhone, and neither has been tested on a real phone yet. First run on 5 Nov: 13 of 52 removed or closed, 38 clients on the list, nothing sent automatically. One removal is the owner's own decision on a client whose voice notes are unreadable. The owner turned `visit_followups_auto` on on 5 Nov. The first automatic sends are due at 10am on 6 Nov: 12 follow-ups at most, fewer if he sends some himself.

**After-visit follow-up (SQL67, SQL68, PRs #55 to #57, owner's decision 6 Nov).** 90 minutes after a visit's time (17:00 when no time is saved) the client is asked their opinion as free text, only inside the 24 hour window, never a template. Nothing goes if the client or a person wrote after the visit, a later visit is coming, a voice note is unread, or the chat is muted or handed to a person. If the window closed, it stays on the daily list. On the last 60 days, 36 of 42 visits with a chat still had the window open at that moment. When the window would close before that moment, the client is asked to confirm the visit while it is open, once per visit and only when a reply would still cover the visit (SQL70). A client the review removed stays off the list until they write again. Silence after getting the details no longer earns a follow-up.

**Follow-up fixes (SQL71, PRs #59, #60, #65, owner decision 6 Nov).** Everything reaches the daily list first. What he has not sent by 10am the day after it reached the list goes out by itself if the review allows, a UTILITY template or free text, 20 a day at most. A client changing, putting off or cancelling a visit updates it at once, whoever recorded it. The review now reads messages up to 3000 characters (it cut them at 500, which made answered voice replies look unanswered) and waits for a new voice note to be transcribed. `properties.rented_units` is an optional note on the property form, read by the review and the agent. The agent asks a name once, saves a stated name, otherwise adds a note to the client that the name was not given. The agent is deployed as a stub pinned to a commit on main.

**Not done.**
- `whatsapp-reply-agent` version 31 with project and twin awareness is deployed. No real client from a project video has passed through it yet.
- `whatsapp-visit-templates` is deployed and the six v2 templates went to Meta on 5 Nov, status PENDING. Follow-ups keep v1 until v2 is approved as UTILITY.
- Deletion of unused items waits for the owner. Nothing was deleted.

## 1 November 2026 — deals by date, quick visit result

- **Deals order.** Every stage of the board, and the table, is sorted newest first by `crmDealBusinessDate`:
  - sold, finance and commission stages: sale date;
  - deposit: paid date;
  - lost: loss date;
  - visit stages: visit date;
  - otherwise: creation time as the fallback.

  An old deal entered today sits with its year. The Deals layout and workflow are unchanged.
- **Quick visit result (`crm-quick-visit.js/.css`).** Built mainly for phones.
  - The dashboard card "زيارات اليوم" lists today's and overdue scheduled visits with "سجّل النتيجة". The visits table offers the same button.
  - The sheet is tap-based:
    - **Visit:** done, no-show or postponed.
    - **Client opinion:**
      - liked → `followup`;
      - wants to negotiate → `negotiation`;
      - hesitant → `followup`;
      - did not suit → `lost`, and a reason is required.
    - **Follow-up:** tomorrow, in two days, in a week, or none. This creates the follow-up task.
    - **Note:** free text; the keyboard microphone works.
  - "زيارة ما كانت مسجّلة" picks a client (by name or phone) and a property, then records a visit done today.
  - Everything saves through `crm_save_viewing_atomic` with the row version, so deal stage, request, inquiry and task rules are unchanged. The full form remains available.
  - Rolled-back trial as the Barka account, all through the RPC:
    - liked → visit done, deal stays at `visit`, follow-up task in 2 days;
    - negotiate → deal moved to `negotiation`;
    - an unbooked done/lost visit with a reason saved in one call;
    - no-show with a note saved.

## 26 October 2026 — deposits linked to deal reservations (SQL48)

The owner asked for every record to stay connected. A link audit found:

- **Visits** already update deals, client requests and property inquiries (`sync_viewing_to_crm`).
- **Deals** update property status and requests.
- **Owners** are a single record referenced by `properties.owner_id`, and all 44 properties have one. The property form's "new owner" writes to `owners`.
- **Deposits were not connected.**
  - A paid reservation confirmed on a deal lived only on `deals` (3 deals), so the Deposits page never showed it.
  - The Deposits page's own "new deposit" inserted a row and then tried `deals.stage='deposit'` directly. The reservation guard rejects that, leaving a half-saved record.

SQL48 (`db/changes/48-deposits-from-reservations.*`):

- **`deposits.from_reservation`.** One mirrored row per deal, enforced by a unique partial index.
- **Trigger `crm_sync_deposit_from_reservation` on deals.** It creates or updates that row from the deal's amount, paid date, client, property, stage and cancellation:
  - completed deal → `applied`;
  - cancelled or lost reservation → `cancelled`;
  - otherwise → `active`.

  It never overrides refunded or forfeited. A manual row with the same deal and amount is adopted rather than duplicated.
- **Delete guard.** A mirrored row cannot be deleted while the deal still has the reservation.
- **`crm_record_deposit(...)`.** The Deposits page's "new deposit" calls this. It runs `crm_confirm_paid_reservation` (same access, branch and investment checks), then stores method, receiver, refundability, duration and notes, all in one transaction.
- **Backfill.** Inserts the 3 existing reservations (applied / active / cancelled). It does not touch the deals.

UI:

- The deposit form offers only deals that can still take a reservation.
- Editing a reservation deposit locks amount, date and deal ("يُعدَّل من الصفقة").
- Rows show "من الصفقة" and "فتح الصفقة" instead of delete, plus a "الحجز ملغى" status.
- Errors are explained in Arabic.

Evidence: a rolled-back transaction with JWT claims for the Barka account and the owner.

- Barka recorded 500 on a synthetic Barka deal → deal moved to `deposit`, deposit row active/cash/21 days, visible to Barka.
- A Muscat deal → `not_authorized`.
- Re-recording a different amount → `reservation_already_confirmed_do_not_overwrite`.
- Owner delete → `reservation_deposit_managed_by_deal`.
- Owner correction to 650 → mirrored.
- Lost deal → `cancelled`.

The owner reported raw markup in deposit rows and an unreadable sold-value chart. I then reviewed every page as the Barka account, with owner-only pages shown in client-side owner mode on that browser only, at desktop width and at 375px. The review used an automatic scan for raw markup, undefined/NaN and horizontal overflow.

- **Deposits.** `fmtMoney` and `fmtDate` return markup. Cells now keep only their text before escaping. A missing payment method shows "—".
- **Sold-value chart.** The canvas was 100 units wide inside a 280px-tall box, so it rendered about 150px wide. It now uses a 600×200 canvas with 10–11px labels and plain-text tooltips.
- **Task and event forms.** Options are built in one pass, so the new-task form opens in about 2s instead of 6–11s, which had caused statement timeouts.
- **Staff labels.** The task assignee list, activity log, client timeline, expenses ("سُجّل بواسطة") and duplicate-client alert show the branch via `crmMemberChoiceLabel` / `crmRecordBranchLabel`. The Team page still lists accounts for management. The `{agent}` placeholder in message templates is unchanged.
- **Layout.**
  - Compact WhatsApp chat header, and a 300px conversation list at 901–1280px.
  - The grid actions column is sticky, with tighter cells at ≤1280px.
  - Dashboard attention rows are constrained on phones.
  - The initial top bar and quick-search names match the menu. "instagram" in the top bar is now "أداء العقارات".
- **Verification.** Each candidate commit's full build was loaded from jsDelivr in the live app. Owner-only report data cannot load for a staff account, so those reports were checked for layout only.

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

## 8 November 2026 (night) — visits, owner documents, client behavior, UI (commit 8baffaf, agent v49, follow-up v20)
- Reply agent: visit recorded for "going now" and when a location is sent; owner-documents rule (land: ownership + kroki + price in mind; villa: full details + kroki + ownership + completion certificate + maps/photos); name asked in first reply; handoff "which property?" closes itself; client behavior text injected (table `client_behavior`, 135 clients scored).
- Follow-up: fast 1.5 h follow-up reaches clients who wrote after the visit; behavior text used in review().
- UI: muted-brain banner is one compact line; «متابعات اليوم» collapsed by default; approvals screen filters dry drafts in SQL and loads last messages per chat in parallel.
- Calendar: BuNasser visit to Dar Global (Opera House) tentatively Mon 9 Nov 11:00.
- Still open: property-missing-details WhatsApp alert, land-study pricing-day alert, Al Noor meeting event + English message, staff numbers excluded from request/outreach generation, closing the 42 notes.
- (later that night, commit 2f2bdfe) Owner alerts: `whatsapp-owner-hot-alert` action `notify_owner`; cron `crm_property_alerts_run` (every 10 min) alerts on new properties with missing details and new land studies; `crm_properties_missing_details()` lists the backlog. Staff phones skipped in outreach/visit follow-ups (triggers). Unrecorded Shakhakheet visits of 7 Nov recorded retroactively. 21 of 42 notes closed (status done).
- (night, commit 700ac33, agent v50) Dry run on 20 chats: found and fixed (a) unknown-fact question (e.g. electricity) with location not yet sent → send location only, no answer, no handoff; handoff only if the question repeats after the location; (b) property description hook line from the video title is no longer copied. Migration `behavior_lock_unrealistic_20261108`: `client_behavior.tier_locked`, tier `unrealistic` (set for 2 clients) skipped by the follow-up/outreach insert trigger; behavior now counts messages through the conversation too. 18 notes still open.
- Not started: A/B comparison of follow-up wording.

## 9 November 2026 (morning) — closing the 8 Nov evening orders (commit 8030713)
- Corrective messages for sold-property cases (11 pending `property_sold` rows rewritten: sold + Hisham villa 305/295 at 59k; plus Ashraf (also Sultan Haitham City → Muscat number), M', Mazin, AFA video+location, Abu Ayan bank-first) are queued as pending outreach scheduled 09:15–09:20, waiting for approval in «ردود انتظر موافقتك». Stale viewing of M' on a sold property cancelled; handoff cleared for AFA and Abu Ayan.
- Brain: broker-or-buyer question; honest area answer; prompts synced (sha 8030713).
- `crm_followup_effect` view + `crm_followup_compare()` (owner only): reply rate by follow-up wording. Only the fixed visit question exists so far (31 sent, 74% replied within 24h).
- Ahmed (58bf26f1) locked as wanderer; 2 unrealistic clients locked.
- Open notes: 2 — 5f02bd2f (lockbox code photo for Ahmed Al-Shaer Sumhan villa needed from Ahmed) and b498b41a (pre-24h reminder only exists for visit follow-ups, not for general "I'll reply later").

## 9 Nov 2026 (10:30–11:30, Ahmed notes)
- Brain a8bdebe: new section «قواعد أحمد (9 نوفمبر)»: SHC vs Sultan Qaboos question, 0% down offer until 30 Nov (only allowed project number), freehold for any nationality in SHC, old Wadi Zahl apartments sold, Khawd/Falah villas and Al-Shaer villa unavailable («ما متوفره» not sold), owners: mortgage/occupied → apologise like heirs, rental owner flow (5% after viewing), monthly rent wording, brokers/CV silent, English follow-up for English clients. Knowledge: freehold line + 0% exception. Synced via agent-prompt-sync (brain_base 50,290).
- Data: archived 3 Falah Khawd villas (kept sold one) and Al-Shaer Sumhan villa; cancelled today's 16:00 viewing on Khawd 120(2); 3 corrective outreach rows queued (pending approval).
- Drafts: 18 old drafts regenerated with the new rules; 8 stale drafts skipped, 6 chats flagged «ارجع ورد بنفسك». owner_with_ahmed skips for two owners restored to pending by hand (Ahmed asked the agent to continue).
- Calendar: Al Noor meeting confirmed 16:30 (evening 19:30 event removed).
- Open: note b498b41a (general 24h reminder), carousel/photos sending for rentals, A/B assignment.

### 9 Nov 2026 (11:30, investors)
- eeb5669: chats >23.5h since last inbound go to «متابعة اليوم» (outreach_queue request_followup) instead of drafts; function v51.
- 97384b4: brain.ts section «مستشار المستثمر» (Ahmed's consultant prompt); investors answered directly; unknown -> handoff. Project doc: claude/برومت-مستشار-المستثمرين-العقل.md. Project info comes only from project files.

## 9 نوفمبر (بعد الظهر)
- تفريغ صوتيات أحمد (gpt-4o-transcribe + قاموس)، لوحة «العقل موقوف عندهم»، زر «وقّف العقل هنا»، إعادة تصميم الرئيسية (بلاطات + نوافذ)، إغلاق صفقات الزيارة الراكدة بعد 90 يوم، إصلاح cron سلوك العملاء.
- R13: whatsapp-visit-followup-auto مثبت على 1627292، يقفل الزيارات الفائتة (عقار منتهي / 5 أيام بدون نتيجة) ويكتب ملاحظة للمحادثات الموقوفة. أول تشغيل: 14 زيارة انقفلت، 9 باقية حديثة (1–4 أيام).

