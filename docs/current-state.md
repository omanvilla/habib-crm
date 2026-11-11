# Habib CRM — current state

Updated 2026-11-11. Read AGENTS.md. Latest owner instructions govern. Previous Instagram discovery, design, audit history and outstanding limits remain in [the v16 archive](current-state-v16-20261021.md).

> **Date note.** The sections headed «12 November 2026» below (and «12 Nov» / «12 نوفمبر» in R32–R35, SQL90/91 comments, file
> names `*_20261112*` and commit messages) were all written on **11 November 2026** (afternoon, Oman time); the date was mislabeled.

## 11 November 2026 (night) — automatic price studies: Claude hands in, Ahmed approves, the owner gets it (SQL94, R37, commit b7a4996), live in test mode

- **What Ahmed asked.** Claude in the pricing projects (a scheduled task with SQL access only, not this session) studies every open «دراسة سعر» task and hands the study to the CRM; Ahmed reviews the figures and the two reports on his phone and approves or rejects with a note; only after his approval the CRM sends the owner the message and the owner report from the branch number. Owner net, commission and the internal report are for Ahmed only. He approved the plan and three choices: approval on the CRM (not on WhatsApp, the alert leaves from the branch number), PDFs through Google Drive link sharing, and the template text.
- **SQL94** (`db/changes/94-price-study-auto.forward.sql`, applied from the committed file at `b7a4996`; nothing existing replaced). Tables `owner_price_studies` (one in flight per task, versions, status submitted / files_failed / awaiting_approval / rejected / approved / sending / waiting_owner / sent / send_failed / cancelled) and `owner_price_study_docs`; both owner-read only, no staff policy, no browser write. Private bucket `price-studies` (owner-read storage policy). For Claude, closed to anon and authenticated: `crm_price_study_queue()`, `crm_price_study_documents(task)` (6-hour signed links through the edge function, synchronous `extensions.http`), `crm_price_study_chat(task)`, `crm_price_study_submit(...)`, `crm_price_study_status(task)`. For the owner screen: `crm_price_studies_pending()`, `crm_price_study_decide(study, approve, note, message)`. Triggers `crm_price_study_on_handoff` (conversations) and `crm_price_study_on_message` (messages, insert or transcript saved); both swallow every error. Column `whatsapp_automation_runtime.price_study_send_mode` (`test` by default; `live`, `off`).
- **Edge function `price-study`** v1 → `b7a4996` (reply-agent secret only): `save_docs`, `sign`, `pull_files`, `send`, `owner_inbound`, `template`. Outbound messages are recorded in the chat as `actor_type=automated`, `channel_source=crm_price_study`. The hold stays (hard handoff) and its reason becomes «دراسة سعر: انرسلت الدراسة للمالك …», so the chat leaves «ملاك ينتظرون تسعيرك» and shows with the other paused chats. Outside the 24-hour window the template `owner_price_study_ready_ar_v1` (UTILITY, quick reply «نعم ارسلها», submitted to both numbers on 11 Nov, PENDING) goes first and the study follows the owner's answer. The owner's later answer is read by the model once (`owner_reaction`): «price did not suit» or a counter offer is written on his `owner_leads.notes` and Ahmed is told through `notify_owner`.
- **Reply agent** v61 → `b7a4996` (was v60 `c25e0d2`; the only `index.ts` difference is R37): a decline (R10 / R20 wording, unchanged) closes the conversation's open owner offer with «ما نستلم: …» and never opens a price study task. `brain.ts` untouched, no prompt sync. Dry run before publishing: 20 latest chats plus 3 owners declined lately, 23 of 23 answered with no error, buyer replies as before, the declines word for word.
- **Front end.** `crm-price-studies.js` / `.css` (`?v=20261112-study1`), `crm-owner-home.js` (`?v=20261112-study1`): tile «دراسات سعر جاهزة», the approval sheet, deep link `?study=<id>`. Checked at phone size on synthetic data (no console errors); not checked in a signed-in owner session.
- **Checked live.** Queue on the 10 open tasks; documents: 19 copied, 121 older than 4 Nov no longer at Meta; a test study on the runtime test number handed in with two PDFs from Drive reached `awaiting_approval` and the alert reached Ahmed; in a rolled-back transaction the Barka account read 0 rows of both tables and the bucket and was refused every function, and the owner's rejection sent the task back to the queue with the note (version 2 accepted).
- **Not checked yet.** The approval click from Ahmed's phone, the actual send to the test number (needs a message from it inside 24 hours, or the template approved), the owner's «price did not suit me» answer, and the lead-closing write of R37 on a real decline.
- **Ahmed's test and SQL95** (`price-study` v2 → `5b34576`, applied from the committed file). He pressed «موافق» on the test study three times: the approval was saved each time, the send was held (`template_not_approved`: the test number had not written within 24 hours, the template is PENDING) and the screen did not say so clearly. Now an approved study held for that reason goes by itself when the owner writes (trigger `crm_price_study_on_message`, `owner_inbound`) and when Meta approves the template (cron `owner_price_study_held`, every 30 minutes, idle unless such a study waits, action `held_tick`); the screen (`crm-price-studies.js?v=20261112-study2`) says why it was not sent. `test_mode_hold` and `sending_off` are never retried. Checked: `held_tick` on the test study answered and kept it held. Meta showed the Muscat template as MARKETING while pending (Barka UTILITY) at 17:41 UTC; the code checks APPROVED only, not the category: tell Ahmed if it is approved as MARKETING.
- **The send, checked live (11 Nov, 17:47 UTC).** Ahmed wrote «هلا» from the test number: 9 seconds later the approved, held study went out (the message, then «دراسة سعر العقار.pdf», delivered), with nothing pressed again. Study `sent`, task `done` with `completed_at`, the test offer `studied` with the study line in its notes, the hold kept with «دراسة سعر: انرسلت الدراسة للمالك 11 نوفمبر 2026 · …», and the reply agent stayed out (`human_handoff_open`). The owner's answer was then checked with a synthetic inbound row written into the test chat (17:57 UTC, `raw_payload.synthetic`; no real reply from the test number had reached the system): within 3 seconds `owner_reaction = price_rejected`, the line «رد المالك على دراسة السعر …» was added to the test offer's notes and the alert reached Ahmed's WhatsApp from the Barka number. Still not checked: a real WhatsApp reply after a study, the template path (Meta), a real R37 decline.
- **Live for owners (11 Nov, about 18:05 UTC).** Ahmed: «فعّل للملاك». `price_study_send_mode = 'live'`. Test data deleted with his yes (the test study, task, offer, the synthetic reply, two `owner_price_study_docs` rows of the test chat); the test chat is back with the agent; the two dummy PDFs stay in the private bucket. No study in the table, 10 tasks in the queue for Claude in the pricing projects. `price-study` v3 → `71b6106`: the template goes out on its own only when APPROVED **and** UTILITY (his rule of 5 Nov); MARKETING or REJECTED holds the study (it still goes as plain text when the owner writes) and Ahmed is told once per number (`price_study_template_marketing:<route>` / `_rejected:`). Stop at once: `UPDATE whatsapp_automation_runtime SET price_study_send_mode = 'off'`.
- **Templates at Meta (11 Nov, 18:04–18:09 UTC).** `owner_price_study_ready_ar_v1`: Barka APPROVED UTILITY (in use), Muscat APPROVED **MARKETING** (never sent on its own). Ahmed approved a second wording for Muscat, «السلام عليكم بخصوص طلبك دراسة سعر عقارك الدراسة جاهزة نرسلها لك هنا ؟» (same quick reply): `owner_price_study_ready_ar_v2`, submitted on the Muscat number only, PENDING / UTILITY. `price-study` v4 → `30a1913`: each number uses its first template approved as UTILITY (`TEMPLATES`, `templateApproved` returns the template); until v2 is approved a Muscat owner past 24 hours gets his approved study when he writes. No template send has happened yet on either number.
- **Rollback.** `db/changes/95-price-study-held.rollback.sql`, then `db/changes/94-price-study-auto.rollback.sql`; re-pin `whatsapp-reply-agent` to `c25e0d2`.

## 11 November 2026 (evening) — R36: A/B comparison of follow-up wordings (SQL93, commit d8294ca), live with wording A only

- **What Ahmed asked.** The last open item: compare follow-up wordings. Two are compared: the after-visit question (step 1: the named question inside 24 hours and the template `visit_followup_1_ar_v2`) and the request follow-up template `request_followup_ar_v2`. Today's wording is **A** and stays the default (R29 and R35 are wording A, unchanged). B / C work only when Ahmed wrote them and pressed «جرّبها» on the screen, and only after Meta approves their template as UTILITY on **both** numbers; until then A goes. Same rule as the pinned replies (4 Nov): about 20 people per wording (`min_sample`), then the winner 8 times in 10 and the rest keep testing. Recorded as **R36** in `docs/agent-rules.md`.
- **SQL93** (`db/changes/93-followup-variants.forward.sql`, applied from the committed file at `d8294ca`; nothing existing replaced). Table `whatsapp_followup_variants` (kind `visit_step1` / `request_followup`, label, text, template_name, status proposed / testing / winner / retired, min_sample 20; A seeded for both kinds; owner-only read). Column `variant_label` on `whatsapp_visit_followups` and `whatsapp_outreach_queue`. `crm_repair_private.followup_variant_pick` (A whenever no test wording is live; otherwise least used, or the winner 8 in 10). BEFORE INSERT triggers `variant_assign_visit_followup` / `variant_assign_request_followup` label a new step-1 visit follow-up or a `request_followup_ar_v2` row (financing rows and steps 2 to 4 are not compared; an error leaves the row as it was). Owner RPCs: `crm_followup_variant_save` (writes a wording as proposed; refuses «هلا», punctuation is normalised, promises R5 / R12, «كيف لقيت» / «مبروك» R29, «صور» R34, numbers, English, more than one question; a visit wording must keep «كيف شفت» so the reply agent still knows our after-visit question, R16), `crm_followup_variant_decide` (test / submit / winner / unwinner / retire; winner only after `min_sample` sent; A cannot be stopped), `crm_followup_variant_results` (per wording, total and Barka / Muscat / investors: sent, replied within 48 hours, visit booked within 30 days, deal reaching a paid booking within 90 days). `crm_followup_variants_settle` (service role): a waiting follow-up whose wording was stopped or whose template is no longer approved goes back to A.
- **Functions.** `whatsapp-visit-followup-auto` v28 → `d8294ca` (was v27 `799141d`): a step-1 row on a test wording asks the opinion question in that wording; the subject goes into a test-wording request row; after sending, the label says which wording really went (a text the review wrote for one client counts for no wording); `crm_followup_variants_settle` at the start of each run. Nothing is read or rewritten for A. `whatsapp-visit-templates` v4 → `d8294ca` (was v3 `8cb9448`): also creates and tracks the template of a wording Ahmed approved (name `fu_visit1_ar_…` / `fu_request_ar_…`, fixed when he presses «جرّبها»).
- **Screen.** `crm-followup-variants.js` (`20261112-ab1`, with `crm-followups-today.js` / `.css` `20261112-ab1`): owner only, at the bottom of «متابعات اليوم» when the list is open: «مقارنة صياغات المتابعة (A/B)» with the results table per wording, the Meta state of its template, «أضف صياغة», «جرّبها», «ثبّتها فايزة», «وقفها» (a second tap confirms). Staff never get the box and the RPCs refuse them.
- **Checked.** CI green on the branch and on `main` (`d8294ca`). SQL93 was first run on the live database inside a transaction that was rolled back (two trials): with no test wording 600 picks gave A only and a new visit row and a new request row kept their text and template with label A; staff refused by every RPC and reading 0 rows; nine bad wordings refused each with its reason; a proposed wording, a testing wording with its template not approved, and one approved on one number only all gave A only; approved on both numbers 8 visit rows split 4 A / 4 B and 6 request rows 3 / 3 with B's text and template; a winner took 776 of 1000 picks; stopping B put every waiting row back on A's text and template. After the real apply and both deploys: the daily list (13 rows: text, template, what reaches the client, lane, auto time) and the waiting rows (4 visit, 83 queue) have the same checksums as before; only the two A rows exist; `preview` (reads the list again, writes nothing) returned today's wording («السلام عليكم كيف شفت فيلا الشخاخيط وايش انطباعك عنها ؟») and no test wording; unsigned calls answer 403; template status unchanged (16 templates).
- **Not tried:** a real «جرّبها» (it creates a template at Meta), and the screen in Ahmed's browser.
- **Found.** The live database had an older measuring view `crm_followup_effect` and `crm_followup_compare()` (9 Nov, reply rate guessed from the text; not in `db/changes`). Left as they are; the new results replace them.
- **Scenario lines fixed (`docs/agent-rules.md`).** The Jihan line and the booked-meeting line still said «المكتب في الموالح» / `meeting {office…}` and a confirming reply; they now follow R30 / R33 (the developer's office in Al Udhaybah, «تمام وصلت», Ahmed confirms). A pointer was added on the R19 row.
- **Rollback.** Pin `whatsapp-visit-followup-auto` back to `799141d` and `whatsapp-visit-templates` to `8cb9448` first, then `93-followup-variants.rollback.sql`; front end back to `20261112-lane1` / `20261106-fu6`.
- **Next free SQL number: 94.**

## 11 November 2026 (afternoon) — R34 photos, R35 investors lane, follow-ups fixed and sent, paused chats (SQL91, commit 799141d), live

- **R34 photos (brain at `799141d`).** Ahmed: we have no photos, only video; for a house the owner lives in: «بحكم إن المالك ساكن في البيت ما صورنا البيت من الداخل عشان الخصوصية» + «بس نقدر نرتب لك زيارة وتشوف البيت من الداخل على راحتك» + «متى يناسبك ؟», after the listing details. Never promise photos (agent or follow-ups). Replaces the older wording of the same rule. Dry run (dryrun v19 at `eb3f001`, inline): Ibrahim's «في صور من الداخل ؟» twice → exactly that; Riyam (rent and remaining space) → «الشقتين مؤجرات كل شقة بـ 100 ريال…» and a clear question; a Sultan Haitham «فلل مستقلة ولا كيف» → project facts + «الاسعار تختلف…» + Al Udhaybah meeting.
- **R35 investors lane (SQL91 + `crm-followups-today.js` `20261112-lane1` + `whatsapp-visit-followup-auto` v27 → `799141d`).** «متابعة اليوم» has tabs الكل / بركاء / مسقط / المستثمرين: `crm_repair_private.followup_lane` puts a Muscat follow-up in «المستثمرين» when the client is an investor, the agent filed the chat as investor, he is on the مستحقين list, or the follow-up is about a project / developer / freehold / residency. All still go out from the Muscat number. Each row also shows «اللي بيوصل للعميل من النظام» when the chat is past 24 hours: then only the Meta template goes («بخصوص طلبك {1} لين الحين تبحث ؟» or the fixed visit text), not the reviewed free text — before, the list showed one text while another went (e.g. Riyam's row showed «كم المساحة المتبقية للسكن ؟» but would have sent «بخصوص طلبك شقة»). The follow-up writer: investor topics are followed up (they were `skip`) with R18 figures and the R33 meeting, no questionnaire; one clear sentence about the client's actual subject; never re-asks the client his own question; a new `subject` field fills the template's {1}. Preview on two investor rows (read only): «السلام عليكم بخصوص التملك للأجنبي نقدر نوضح لك الأماكن والأسعار والشروط ونرتب لك اجتماع مع المطور…» instead of «الشراء عندك للسكن ولا للاستثمار ؟».
- **Today's follow-ups (Ahmed: send the automatic ones, leave the manual ones).** None of the chats was inside 24 hours, so each goes as its template. 16 request follow-ups got the right subject and were approved (`reason = 'owner_ok_chat_20261112'`, sent by `outreach_send_approved`): Barka 2 (بيت; توين فيلا الرميس — it said «عقار في نزوى»), Muscat 14 (9 × «بيت الحيل الجنوبية», «شقة في المعبيلة», «فيلا في الخوض», «بيت بحدود 85 الف», and investors «عقار في مدينة السلطان هيثم», «فيلا في مدينة السلطان هيثم», «عقار جاهز بتملك حر»). The Sultan Qaboos City apartment visit follow-up (fixed visit template) is set to go automatically at tomorrow's 10am send. Closed (status `stopped`): two visits to Al Khoudh 7 villa 120 (withdrawn) and two cancelled Al Hail visits (one of those clients gets the request follow-up). Left with Ahmed: Mohammed's (purchase in progress, cheques; «لين الحين تبحث ؟» would be wrong) and the 10 investor rows that can only be answered from the chat (no template); those 10 were sent back for a new review so their suggested text follows R35.
- **Paused chats.** «كم ؟» (Sultan Haitham two-bedroom, inside 24 h) resumed from Ahmed's owner session: the agent sent «الاسعار تختلف حسب الوحدة والمساحة والمرحلة» + the Al Udhaybah invitation + «أي يوم يناسبك ؟». Six investor chats past 24 h with no answer (c5b78dbe, ec71be7e, dfb924e5, fb51edfd, bb224782, 8aafeaad) were handed back to the agent (`clear_handoff`, no message); queueing a template to reopen them was refused by the session's permission check and waits for Ahmed's OK. Left with Ahmed: price studies, call requests, the broker and financing chats, and **the meeting booked before R30/R33**: 0b1c7b83 was told on 11 Nov «تمام ان شاء الله نشوفك بكره الساعة 11 في المكتب» (Mawaleh, 12 Nov 11:00) — he decides whether to keep it or move it to the developer.
- **Rollback.** `91-followup-lanes.rollback.sql`; `whatsapp-visit-followup-auto` back to `4d40947`; front end `20261111-crm1`; revert R34 lines and re-sync.

## 12 November 2026 — Ahmed's decisions: R33 meeting places, sold / withdrawn properties, step-1 template, price button, live

- **R33 (agent v60 → `c25e0d2`, prompts at `8cb9448`).** Ahmed: investor meetings are never in our Mawaleh office; we go to each project's developer. Al Ahli Sabour (Sultan Haitham City, Wadi Zaha, Iconic Tower) at their office in Al Udhaybah (`developer`); Aida (Dar Global) at their office by the Opera House (`dar_global`, no Aida price until Ahmed visits them and updates the project himself); Al Yazan's office is not named yet (`project_tbd`: the invitation names no place, Ahmed sets it when he confirms). `MEETING_PLACE` and the schema enum in `index.ts`, two lines in `brain.ts`, R33 + scenario in `docs/agent-rules.md`. Dry run (`whatsapp-reply-agent-dryrun` v18 at c25e0d2, `brain_sha`, inline, nothing sent): two Aida questions and the last 20 chats → Al Udhaybah meeting request «تمام وصلت» (book_meeting `developer`, waits for Ahmed), the price question → Al Udhaybah invitation, Barka investors → Muscat line, no Mawaleh, no Aida figure. One miss not from R33: an owner chat handed over as «دراسة سعر» drafted «بنطلع على المنطقة والاسعار الحالية ونرجع لك بدراسة للسعر» (R23 says a price study handoff is silent; R5 no promise) — left for a separate fix.
- **Rizwan Sawmhan 69-1 (`f99087b9`).** Ahmed: villa 1 was sold by the owner Rizwan himself; 69-2 and 69-3 are still available (checked). Its last open card (`d45e6b4e`, viewing cancelled) closed through `close_deal_property_unavailable`; then the reason was set in Ahmed's own Chrome session (owner) with the new «حدد السبب» → «المالك باعه بنفسه أو عن طريق غيرنا» + note, ticking the active-deal confirmation (status was still `reserved`). Status now sold; the «انحجزت» notice to customers who asked waits for approval. No «سبب الأرشفة غير مسجل» left.
- **Al Khoudh 7 villa 135 (`9457b323`).** Ahmed: withdrawn, the owner pulled it after the contract ended. The two negotiation cards `c89e141f`, `c2d06cc6` are lost (`property_unavailable`, note with his decision, activity logged) and their two review tasks done.
- **Step-1 visit template (SQL90).** Ahmed wants «كيف لقيته» gone. `visit_followup_1_ar_v2` «السلام عليكم كيف شفت العقار وايش انطباعك عنه ؟» submitted to Meta for Barka and Muscat (`whatsapp-visit-templates` v3 → `8cb9448`), both PENDING / UTILITY. SQL90 adds its text to `crm_visit_followup_text`; `crm_visit_followup_template` switches each number to v2 by itself once Meta approves it as UTILITY (until then v1 stays). Applied from the committed file at `8cb9448`. Rollback: `90-visit-followup-1-v2.rollback.sql`.
- **«ارسل السعر للمالك».** On each price-study row (owner only) a button opens a box: type the price, a suggested message fills in («السلام عليكم / درسنا العقار، والسعر المناسب له في السوق حالياً حوالي … ريال / اذا يناسبك نبدأ نسوقه بهالسعر ؟»), Ahmed can edit it, then «ارسل للمالك من رقم الفرع» sends through `crmSendWhatsApp` → `whatsapp-send` (the chat's branch number, 24 h window, recorded in the chat). The chat stays his (R26). `crm-owner-home.js` / `.css` `20261112-price1`. Checked in Ahmed's Chrome: 8 rows, each with «فتح في واتساب الجوال» (wa.me link), «فتح في النظام», «ملاحظة لـ Claude» and the new button; a sample price filled the message (cleared, nothing sent).
- **WhatsApp buttons checked as owner** (Ahmed's Chrome): «فتح في النظام» on a price-study row closed the sheet and opened that owner's chat in the CRM WhatsApp page, which also shows «فتح في واتساب الجوال» in the header. The phone app itself (WhatsApp Business opening) is for Ahmed to try on his phone.
- **Not done, Ahmed's call:** database compute upgrade (later); Supabase leaked-password protection (left as is).

## 12 November 2026 — Aida reply off, old archives get a reason, live

- **Aida (R18).** Ahmed: «ما معي الأسعار، لازم أقابل الشخص». The pinned reply ceeb852e (Aida villas from 170k, Oceana from 520k) is `active = false`; an Aida price question now follows R18 (the «it depends» line and a meeting invitation). Inline check on the live agent (nothing sent): the Muscat Aida/investment question twice → the Iconic studio from 57,000 and a rented house of ours, no Aida figure; the Barka Aida question → the Muscat line (R9). Open: where an Aida meeting happens (our Muscat office like R19, or a set Aida day) — Ahmed's choice.
- **Old archives.** Ahmed: old archives without a reason «نسجل شي ونخلص من الموضوع». 11 of the 12 «سبب الأرشفة غير مسجل» now have a reason through `archive_property_internal` (source `agent`, logged `reason_set`, evidence names this decision): the 2 withdrawn ones `owner_withdrew` (status stays withdrawn), the 9 others `other` with the note «أرشيف قديم قبل 10 نوفمبر، السبب ما انسجل وقتها…» (status stays not_available). No deal changed. Left: `f99087b9` (Rizwan Sawmhan 69, reserved with open card `d45e6b4e`; the function refuses it while a deal is active).

## 12 November 2026 — R32: a villa «المعروضة» from an ad is a specific property (commit 0aa58e9), live by prompt sync

- **Why.** In the dry run below, a buyer on the Muscat line asking «اريد استفسر عن الڤيلا المعروضه للبيع في حي الكوثر» got «حالياً ما عندنا فيلا للبيع في حي الكوثر» + «اول ما يتوفر بتواصل معك». The brain already said a specific property in an area with nothing listed must not get «ما متوفر» (ask which one and for the ad link); the model read it as a general search. Ahmed: «نعم صلحه». («اول ما يتوفر بتواصل معك» itself is Ahmed's approved wording for general searches, not an R5 promise.)
- **What.** One sentence in `brain.ts` (section on wrong area names): singular wording about one listed property («الفيلا المعروضة في…»، «البيت اللي في الاعلان»، «هذي الفيلا») = a specific ad: ask for the link or a picture, never «ما عندنا» or «اول ما يتوفر», action=none. R32 in `docs/agent-rules.md` with a scenario; checked for conflicts (rules file, `brain.ts`, the two open owner notes: none). Brain 60,781 chars.
- **Dry run** (`whatsapp-reply-agent-dryrun` v17 at 0aa58e9, `brain_sha`, inline, nothing written or sent): the Kawthar message 3 of 3 → «ارسل لي رابط الفيديو او صورة الاعلان عشان ارسلك التفاصيل والسعر بالضبط»; the latest message of the same last 20 chats as before the change (R29, R30, R9, R20, R21 replies unchanged). **Published:** prompts synced at `0aa58e9` (brain_base and brain), `whatsapp-reply-agent` code unchanged (v59, `4d40947`). Rollback: revert the sentence and re-sync.

## 12 November 2026 — the four postponed fixes (commits dcc0cec, 47527fb), live

- **Approved meeting drafts book the meeting.** `whatsapp-reply-send` v6 → `47527fb` (was `43050f4`; deployed on Ahmed's OK; no other change to that file in between; after deploy an unsigned call returns 401 `not_signed_in`): when Ahmed approves a held draft whose analysis is `book_meeting` with an «اجتماع:» reason and a date, the chat gets the soft handoff (the SQL78 trigger sends «📅 طلب اجتماع ينتظر تأكيدك» to his WhatsApp), a CRM notification and a task due today «أكد الموعد مع العميل أو اقترح وقت ثاني» (one per client and meeting date), as the direct mode does (R19/R30). The same slot again (`meeting_already_booked`) only keeps the handoff. An approved reply to a «المستحقين» asker now fills `mustahiq_waitlist` too (R31; before, only auto-sent replies did). No wording change.
- **Duplicate deal card in Arabic.** `crmDealSaveError` (app-base `20261112-fix1`) turns the SQL77c unique-index refusal into «هذا العميل عنده صفقة مفتوحة على نفس العقار. افتح الصفقة الموجودة وكمّل عليها بدل صفقة جديدة» (or the visit variant) in the old form, the stage drag and the deal workflow form (`crm-deal-workflow.js` `20261112-fix1`). The form and workflow are otherwise unchanged.
- **Reports skip merged cards.** The Reports page reads deals with `merged_into_deal_id is null`. The SQL reports already left them out in practice (the 7 merged cards are lost, with no booking, deposit, commission or receipt, checked 12 Nov).
- **«حدد السبب».** On an archived property recorded as «سبب الأرشفة غير مسجل», the owner sees «حدد السبب» in the archive banner; it opens the reason dialog and saves through `crm_archive_property` (SQL76 `reason_set`, owner only on the server too). The status follows the reason (a sold property stays sold); an active deal or reservation asks for the owner's «أعرف إن على العقار صفقة شغالة». Staff do not see the button. `crm-property-archive.js` `20261112-fix1`.
- **Leftover dry-run drafts closed.** The 15 dry-run drafts still `pending` from 8–9 Nov (hidden from the approval screen, refused by `whatsapp-reply-send`) are now `skipped` with `error = 'dry_run_leftover_cleanup_20261112'` (undo: set them back to `pending` by that error value).
- **Stale pinned replies turned off (Ahmed: «نعم طفها»).** Seven rows in `whatsapp_reply_rules` contradicted rules he already decided and are now `active = false` (undo: set back to true): 9482ca42, 03db59ba, eadf6a27 (sold → «بس عندنا خيارات قريبة» + specs question, R6), a24d9866 («بلغني كيف لقيته», R29), 77c771e9, 406e56e5 (owner asked mortgage/occupancy first, R20), ff7e86a1 (freehold → «سكن ولا استثمار» first, R22). Recorded in `docs/agent-rules.md` (قواعد انلغت). **Dry run after** (live agent, inline: nothing written or sent), latest message of the last 20 chats: all 200; Umm Mawadda «حياك الله وايش انطباعك بعد ما شفتيها ؟» (R29), «كم ؟» → Al Udhaybah meeting invitation (R18/R30), Barka investor → Muscat line (R9), mortgaged owner declined (R20), meeting «تمام وصلت» (R30), «بتواصل معك قبل لا اروح» → «تمام خذ راحتك» (R21). One miss not caused by this change: a buyer asking for a villa in Hay Al Kawthar got «حالياً ما عندنا…» + «اول ما يتوفر بتواصل معك» without the nearest alternative (R22) — left for a separate look. Still open: ceeb852e quotes Aida prices (170k / 520k) that are not in `knowledge.ts` (R18) — Ahmed's call.
- **Not tried:** approving a real held meeting draft, saving a duplicate deal, or setting a real reason from the browser (all write real records or message a customer); the 12 unrecorded reasons are Ahmed's to choose.
- **Rollback.** Pin `whatsapp-reply-send` back to `43050f4`; revert `dcc0cec` (front-end versions back to `20261111-wa1` / `20261021-client-v17` / `20261110-arch1`).

## 11 November 2026 — price study report to Ahmed's WhatsApp (SQL89, commit ee92c2c), live

- **What.** `whatsapp-owner-hot-alert` v7 → `ee92c2c` (was `210edc7`), action `price_study`: for a «دراسة سعر» chat it sends Ahmed's private number, from that chat's branch number (Barka → Barka, Muscat → Muscat), one block: «━━ 📋 دراسة سعر n من N · الفرع ━━», name, number, wa.me link, what was handed over, the owner offer on record (type, area, price in mind, land, built, plot, notes), the chat summary, the owner's own words (voice notes as transcripts, last 25 lines), then every image / document / video he sent in 45 days (downloaded from Meta and uploaded again from the branch number, captioned «n من N · الاسم · k/m»), and «✅ نهاية دراسة السعر n من N». Logged as `owner_price_study` (once per handoff). SQL89: the conversation trigger sends it automatically on each new «دراسة سعر» handoff (not on a rewording of an open one). Nothing goes to the customer.
- **Sent now** (one call at a time so blocks never interleave): 8 open price studies, Barka 1–5 then Muscat 6–8, all details delivered; 23 of 27 documents. Zaid Al Shubaibi's 4 images (sent 3 Nov) could not be fetched from Meta (`media_expired`); they are in the chat.
- **Not built:** sending Ahmed's priced reply on to the customer; he prices and answers from the branch number himself.
- **Rollback.** `89-price-study-report.rollback.sql`; pin back to `210edc7`.

## 11 November 2026 — phone + CRM WhatsApp buttons everywhere, «تم» sticks (SQL88), price studies for staff, «وايش انطباعك عنها ؟» (commits b1b68dc–4d40947), live

- **WhatsApp buttons.** `crm-wa-buttons.js` (new, `20261111-wa1`): `crmWaButtons({phone, conversationId, clientId})` gives «فتح في واتساب الجوال» (WhatsApp Business on the phone, wa.me on a computer) and «فتح في النظام» (the CRM chat; any home sheet closes first); a missing number or chat is looked up on tap. Used on «عملاء يحتاجونك الحين», the home's paused / price-study sheets, owner offers, all five approval cards, deal cards (app-base `20261111-wa1`), the مستحقين waiting list, and inside the CRM chat header (phone button). Follow-ups already had both.
- **«تم» sticks.** One «تم» marks all of that client's unread handoff notifications read and every chat of his still handed over as done; `crm_hot_alert_done` also stores the handoff it closed (`owner_alert_done_reason`, SQL88). The bar shows the client again only for a different kind (call / meeting / serious buyer), not when the agent re-hands the same kind or re-notifies (`crm-hot-alerts.js` `20261111-wa1`).
- **Price studies for staff.** Staff see the «دراسة سعر» tile and list (no «كمّل يا عقل» on them, for anyone; `whatsapp-inbox` still refuses staff clearing one).
- **R29 wording (Ahmed).** «السلام عليكم كيف شفت(ي) <العقار> وايش انطباعك عنها ؟» («عنه» for a house, building, shop); the earlier «عجبتك ولا ما ناسبتك» is rewritten to it; the agent's fallback is «حياك الله، وايش انطباعك بعد الزيارة ؟». The 8 waiting visit follow-ups were rewritten in place. `whatsapp-visit-followup-auto` v26 and `whatsapp-reply-agent` v59 → `4d40947`; prompts synced. Live check (inline, nothing sent): Umm Mawadda → «حياك الله وايش انطباعك بعد ما شفتيها ؟».
- **Not checked in the browser:** the Barka session in Ahmed's Chrome was signed out during the test (login screen); the scripts load without errors and the helper renders both buttons, but the logged-in pages were not clicked through. The hot-alert bar is owner-only.
- **Rollback.** `88-hot-alert-done-sticks.rollback.sql`; script versions back; pins back to `494f748` / `210edc7`.

## 11 November 2026 — R30 project meetings at Al Udhaybah, confirmed by Ahmed; R31 «المستحقين» waiting list (SQL87, commit 210edc7), live

- **Dry run** (`whatsapp-reply-agent-dryrun` v16 at 210edc7, nothing sent): the Thursday meeting chat → «تمام وصلت», book_meeting at «مكتب الأهلي صبور في العذيبة» 2026-11-12 11:00 «(ينتظر تأكيدك)»; three مستحقين askers → «طرح المستحقين حالياً موقف…» + «سجلناك في قائمة الانتظار…» (Barka one: Muscat line) with the waiting-list flag; a price question → the Al Udhaybah invitation and «أي يوم يناسبك ؟»; the last 20 chats otherwise as before, no «نشوفك». **Published:** `whatsapp-reply-agent` v58 and `whatsapp-owner-hot-alert` v6 → `210edc7` (were `494f748` / `febde8b`); prompts synced at `18fb514`. Projects page checked live as Barka: «قائمة انتظار المستحقين 4» with both buttons. Rollback: pins back, `87-mustahiq-waitlist.rollback.sql`, re-sync.

- **Why.** A booked meeting told the client «نشوفك الخميس الساعة 11 في المكتب بالموالح». Ahmed: project meetings (Al Ahli Sabour) are with the developer at their office in Al Udhaybah; the time must come back to him first so it never clashes with his day; tomorrow is fine, the same day is not. And «المستحقين» sales are stopped (first phase sold out): tell askers so and keep them on a waiting list in the CRM to message as soon as units open.
- **Meetings (R30).** `brain.ts`: the invitation names the developer's office in Al Udhaybah (online if abroad); the agent never confirms, it answers «تمام وصلت» once the client gives a day (tomorrow or later) and an hour; same day → «اليوم صعب، بكره أو بعده يناسبك ؟». `index.ts`: `MEETING_PLACE.developer` = «مكتب الأهلي صبور في العذيبة», a same-day slot is refused with that line, confirmation words («نشوفك»، «تم الحجز»...) are removed, the handoff ends «(ينتظر تأكيدك)» and the task is due today («أكد الموعد مع العميل أو اقترح وقت ثاني»). `whatsapp-owner-hot-alert`: «📅 طلب اجتماع ينتظر تأكيدك». Not done: reading Ahmed's own calendar to propose free slots (the agent cannot see it); he confirms each request.
- **المستحقين (R31).** `knowledge.ts` says the sales are stopped and the first phase is sold out; askers hear it plus «سجلناك في قائمة الانتظار، وأول ما يطرحون وحدات للمستحقين نتواصل معك» and the schema flag `mustahiq_waitlist` puts them in `public.mustahiq_waitlist` (SQL87, one row per client, never the owner line; Barka askers get the Muscat line and are listed too). The 4 clients who asked earlier (3 Muscat, 1 Barka) start on the list. The list shows on «المشاريع الاستثمارية» for owner and staff with «فتح في النظام» and «تم التواصل» (`crm-investment-projects.js` `20261111-wait1`). When the sales open Ahmed writes it in `knowledge.ts`. The list is filled only on auto-sent replies (a reply held for approval does not add the client).

## 11 November 2026 — R29: after-visit question in plain words, no «مبروك» without a purchase (commit 494f748), live

- **Dry run before publishing** (`whatsapp-reply-agent-dryrun` v15 at 494f748, inline, nothing sent): Umm Mawadda's «ايوه لقيناها الفيلا» → «حياك الله طيب عجبتك ولا ما ناسبتك ؟» (twice; once with «اسمك الكريم ؟»), and the latest message of the last 20 chats: no congratulation anywhere, the Muscat redirect, owner decline, office meeting and alternatives as before. **Published:** `whatsapp-reply-agent` v57 and `whatsapp-visit-followup-auto` v25 → `494f748` (were `487329a` / `fff79d6`); prompts synced from main. Rollback: pin back to those commits and re-sync.

- **Why.** Umm Mawadda got «السلام عليكم كيف لقيتي فيلا الشخاخيط ؟», answered «ايوه لقيناها الفيلا» (we found the place) and the agent replied «مبروك الله يبارك لك 🌷». Ahmed: make the question clear and a fixed rule.
- **What.** Follow-ups ask «كيف شفت(ي) <العقار> ؟ عجبتك ولا ما ناسبتك ؟»: `namedVisitQuestion` turns any «كيف لقيت» into it, and the review prompt forbids «كيف لقيت». The 10 waiting visit follow-ups that said «كيف لقيت …» were rewritten in place. `brain.ts` (بعد الزيارة) has R29: «لقيناها / وصلنا / شفناها» without an opinion means they saw it, never «مبروك»; ask «حياك الله، طيب عجبتك ولا ما ناسبتك ؟». `index.ts` drops a congratulation unless the customer's messages since our last one say they bought, reserved or paid (or a happy occasion), and after our after-visit question replaces it with that opinion question; `AFTER_VISIT_Q` also matches «كيف شفت». The Meta template `visit_followup_1_ar_v1` («بخصوص الزيارة قدرت تشوف العقار ؟ كيف لقيته ؟») is unchanged (an approved template; changing it needs Meta review).

## 11 November 2026 — stale follow-up offers go back to review (SQL86, 86b); «فتح في النظام» (commits 0bf9cbe, 894ee10), live

- **Why.** A waiting follow-up offered «فيلا في الصومحان الجنوبية ب٥٧ ألف», written 8 Nov; the four 57,000 Al Sawmhan villas were archived on 10 Nov (not available) and the text stayed.
- **What.** Trigger `crm_followups_reread_on_property_change` (properties, status/archived): when a property leaves the market, waiting follow-ups of its branch that name the area's place word (86b: area without the wilayat, «ال» and direction words, e.g. «الرميس» → رميس, «الصومحان الجنوبية» → صومحان) lose `reviewed_at`/`owner_text`: they leave the list and the 10am auto-send and `whatsapp-visit-followup-auto` rewrites them from the current available list on its next run. Owner-decided queue rows (`reason` set) are left alone; a failure only warns. The Sawmhan follow-up (01a96eee) was sent back now. Checked in a rolled-back transaction: marking the Rumais 59 villa unavailable sent back the two Rumais follow-ups and left the Shakhakhit and Muscat ones.
- **Button.** `crm_followups_today` returns each follow-up's `conversation_id`; each row has «فتح في واتساب الجوال» (was «فتح المحادثة») and «فتح في النظام», which closes the home sheet and opens that chat in the CRM WhatsApp page (`crm-followups-today.js` `20261111-crm1`). Checked live as Barka: 17 rows with both buttons, the first opened its own chat (Ahmed). The list no longer shows the Sawmhan offer.
- **Rollback.** `86-followups-reread-unavailable.rollback.sql` (drops trigger and functions; re-create `crm_followups_today` from SQL85 for the old shape), script `20261111-instr2`.

## 11 November 2026 — «أمر للذكاء الاصطناعي» on follow-ups for staff (R28, commits 3e4b270, fff79d6), live

- **Update (Ahmed: «نعم خلها دروس»).** Staff instructions now become agent lessons like the owner's (`apply_now: true`, marked `context.by_staff`). `whatsapp-visit-followup-auto` v24 → `fff79d6`, `crm-followups-today.js` `20261111-instr2` (the box says the instruction is saved as a lesson). No staff note existed before, so nothing older needed changing. The first paragraph below describes the earlier step.

- Ahmed: the button was missing on the staff follow-up list. `whatsapp-visit-followup-auto` v23 → `3e4b270` (was `febde8b`) accepts manager and agent for the instruction; `crm-followups-today.js` `20261111-instr1` shows the button to them. Nothing is sent. A staff instruction is stored in `crm_owner_notes` with `apply_now=false` and `context.by_staff`, so it does not become an agent lesson; there is no screen yet for Ahmed to turn such a note into a lesson. Checked live as Barka: 23 buttons on the Barka tab, the box says the instruction waits for Ahmed, a call with a dummy id passes the role check (409 `followup_not_found`). Not run: a real rewrite from the Barka account. Rollback: pin back to `febde8b`, script `20261111-all1`.

## 11 November 2026 — staff resume paused chats (R27, SQL84) and follow everyone (SQL85), live

- **Resume (R27).** Ahmed: «اريد الموظف ايضا يقدر يكمل موضوع العقل الموقوف». `crm_paused_chats` (SQL84) accepts manager and agent and never lists the owner's private line; the staff home shows «العقل موقوف عندهم» with «كمّل يا عقل». «دراسة سعر» rows stay Ahmed's: hidden on the staff page and `whatsapp-inbox` refuses `clear_handoff` from staff on them (`price_study_owner_only`). «ملاحظة لـ Claude» stays owner-only. `whatsapp-reply-agent` accepts a staff JWT for `resume` only (auth change, no wording change; owner line refused). Pins: `whatsapp-inbox` v25 and `whatsapp-reply-agent` v56 → `487329a` (were `3ff0641`). Rule in `docs/agent-rules.md` R27 (R1/R26 «أحمد يرجّعها» amended). Checked: as Barka 62 paused rows from SQL, 0 on the owner line, 8 price studies hidden → 54 on the page, each with «كمّل يا عقل» and no note button; the live agent answered an inline dry run after the deploy. Not pressed: a real resume from the Barka account (it would answer a real customer).
- **Follow-ups (SQL85).** Ahmed: «متابعه بركاء ما تقتصر فقط على بركاء». `crm_followups_today` gives staff every follow-up (both branches and investors) except the owner's line; his AI instructions stay hidden. As Barka: 51 = the owner's 51 (Barka 23, Muscat 28). The list tells staff to send each branch's follow-up from that branch's phone (the link opens WhatsApp on the phone in hand). `crm-followups-today.js` `20261111-all1`, `crm-owner-home.js` `20261111-resume2`.
- **Rollback.** `84-staff-paused-chats.rollback.sql`, `85-staff-followups-all.rollback.sql`; pin the two functions back to `3ff0641`.

## 11 November 2026 — targets, performance and tasks name «مرام» instead of «بركاء» (SQL83), live

- Ahmed: «نعم غيّرها». `crm_branch_people()` (SQL83, security definer, names only) returns the active staff account on each branch line (`company_lead_routes.assigned_to`): Barka = «مرام»; Muscat has no staff account and stays «مسقط». `crmBranchPersonName` / `crmRecordPersonLabel` (app-base `20261111-people2`) use it in the targets and performance cards (`crm-operations-v6.js` `20261111-people1`), the task list and its «المسؤول» column, which was headed «الفرع» (`crm-v18-task-priority-patch.js` `20261111-people2`), member selectors and the clients' responsible column. Display only: targets, filters, data and attribution stay per branch; a new person on the line shows automatically. Checked live as Barka: target card «مرام», 8 of 8 tasks «مرام». Rollback: `83-branch-people.rollback.sql` (labels fall back to the branch).

## 11 November 2026 — the Barka account is greeted as «مرام» (commit c263ec1), live

- Ahmed: «مسار بركاء خليه باسم مرام نفس صباح الخير وغيره». The Barka profile name changed from «Maram» to «مرام» (`profiles.full_name`, same account id, so authorship is unchanged). `updateUserUI` (app-base `20261111-name1`) shows a staff account's own name in the greeting and the sidebar, with «موظف مبيعات · بركاء» under it. Branch targets, filters, task assignee labels and record attribution still say «بركاء» (branch identity, AGENTS.md). Checked live as Barka: «صباح الخير مرام». Rollback: name back to «Maram», app-base `20261111-resume1`.

## 11 November 2026 — owner offers and investment projects open to staff (SQL82, commit 17453d3), live

- **Why.** Ahmed, asked whether staff should see «عروض الملاك» and «المشاريع الاستثمارية»: «نعم افتحها لهم».
- **What.** SQL82 adds staff policies (manager, agent, viewer read; manager and agent update offer status and add or edit projects) on `owner_leads`, `owner_lead_matches`, `investment_projects`; offers tied to the owner's private line stay hidden (`owner_line_is_private`, none today). `crm_match_owner_leads_now` («طابق الحين») accepts manager and agent; `crm_investment_projects` accepts staff and leaves out clients who wrote on the owner's line. `crm_staff_home` now counts new offers, so the staff home has the «عروض ملاك جديدة» tile. Kept owner-only: adding or removing a video on a project (`crm_project_add_video`, `crm_instagram_link_project`, Instagram manual review). Front end `crm-owner-leads.js` and `crm-investment-projects.js` v `20261111-staff1`.
- **Checked.** As the Barka account in a transaction: 258/258 offers, 1,674/1,674 matches, 3/3 projects; in Ahmed's Chrome as Barka: both sidebar links shown, offers page «253 عرض مالك مو معروض · 94 منها لها مشترين جاهزين», projects page 3 projects and 12 videos with «تعديل» and no video buttons. A browser that cached the old `index.html` needs one reload. Not tried: saving a project or changing an offer status from the Barka account (real records).
- **Rollback.** `db/changes/82-staff-owner-leads-projects.rollback.sql`, then re-run `81-staff-home.forward.sql`; the two scripts back to `20261110-week2` / `20261105-proj1`.

## 11 November 2026 — staff get the owner's home page (SQL81, commits 4f9eef1, a282f14), live

- **Why.** Ahmed opened the Barka account and saw the old dashboard instead of his home: "the whole system the same for the employee, except what the rules keep from staff".
- **What.** `crm-owner-home.js` (v `20261111-staff1`) now draws for manager, agent and viewer accounts too, with the same boot gate (no old-dashboard flash). Staff data comes from `crm_staff_home()` (SQL81), SECURITY INVOKER so every count goes through the account's own row level security (SQL79 shared branches) and deals through `crm_deals_access` (no money, no merged cards). Same tiles and sheets: follow-ups (per branch, as `crm_followups_today` gives), visits the AI follows, property and week summary. Kept owner-only: approvals, paused chats and price studies, owner offers, problems, twins, videos, agent reply counts, and the Reports link (money). Sidebar unchanged: staff still have no approvals, reports, expenses, activity log, owner offers, investment projects, branches (team) or backup.
- **Checked.** As the Barka account in a transaction (14 overdue visits, both branches' properties, 0 money fields) and in Ahmed's Chrome as the Barka account: home shown at once, follow-ups 23 and visits 14 open their sheets. CI green.
- **Rollback.** `db/changes/81-staff-home.rollback.sql`, and `crm-owner-home.js` back to `20261111-resume1`.

## 11 November 2026 — branches share data, Facebook links, voice note discard, «دراسة سعر» tile (PRs #74, #75, SQL79, SQL80)

- **Voice note (PR #74, live).** In the CRM chat, 🗑 while recording discards it, ➤ while recording sends it, and the preview has a clear «🗑 حذف» (only a faint ✕ before). Synthetic Chromium with a fake mic at 375 px; not tried on a real phone.
- **«دراسة سعر» (PR #74, live).** Handoffs whose reason starts «دراسة سعر» have their own home tile and list; «العقل موقوف عندهم» keeps the rest. Display only (8 such chats on the day).
- **Branches share data (SQL79, PR #75, live).** Ahmed's decision: Muscat and Barka staff see, edit and answer each other's properties, owners, clients, requests, visits, deals and chats, and investors. Hidden from staff: the owner's private line (route `owner`) and money (commission/owner_net columns, expenses, reports, unchanged). `investment_row_allowed` now blocks staff only from the owner line (`owner_line_is_private`); `investment_link_is_private` is unchanged so targets and performance still exclude investment. `staff_can_access_branch` is open to all staff; the old rule is `staff_is_branch_member` inside targets, performance, dashboard work and follow-up lists (per branch, including commission figures). Agents read/edit like managers in base policies (SELECT/UPDATE) and `crm_deals_access`; investment write guards accept staff. Edge `whatsapp-inbox` v23, `whatsapp-send` v18, `whatsapp-send-media` v2 pinned to `e70d214`. Owner tools stay owner-only (approvals, brain notes, owner home, project catalog, Instagram catalog, owner offers). Verified as the Barka account in transactions: 81/81 properties, 49/49 owners, 2,024/2,024 clients, 1,566/1,566 chats, 169/169 deals, edits a Muscat client and request; 0 money values, targets Barka only, `crm_paused_chats` 42501. Not tried: a real send from the Barka account.
- **Facebook links (SQL80, R25).** 11 of the 12 Facebook links customers sent in 120 days were `facebook.com/share/r|v/...`. The reply agent opens them (Facebook hosts only, no redirect off Facebook, 3 reads per reply, `facebook_link_cache`), reads the real video id and public post text, and labels the transcript (saved on a property / text only / unreadable as an unregistered reel). The marketing journal has a Facebook channel; a Facebook reel link saved on a property makes customer links to it resolve to that property. Share links led to page id `100083795340037`, not the stored `facebook_page_id` (the page's newer profile id, to confirm). Not done: automatic import of Facebook page posts into the catalog (needs a Graph check of the Page token on `/posts` and `/video_reels`).
- **«كمّل يا عقل» (R26).** Resuming a paused chat now makes the agent read the whole chat and answer the customer's unanswered last message at once (owner only, same draft row reopened, never twice); if it still cannot, the chat returns to Ahmed with a «ما عرفنا» reason. Every paused row has «ملاحظة لـ Claude»; «دراسة سعر» rows have no resume. Ahmed confirmed page `100083795340037` is his Omanvilla page.
- **Rollback.** `db/changes/79-shared-branches.rollback.sql` (restores from `crm_repair_private.sql79_backup`), `80-facebook-links.rollback.sql`; pin the three WhatsApp functions back to `a98eb82` / `f120eab` / inline `701c6e4`; revert the PRs.

## 10 November 2026 (evening) — one deal per client and property, archive with a reason, consultant agent R18–R24 (a2ed4b7 to febde8b), live

- **Deals (SQL77, 77b, 77c).** One open card per client and property: 7 duplicate cards merged into the older one (`merged_into_deal_id`, `merged_at`; hidden from the board, history kept), 0 duplicate open pairs left, and two unique indexes stop new ones (`deals_one_open_card_per_client_property`, `deals_one_open_card_per_viewing`). A visit result moves the client's open card on that property instead of opening another (`sync_viewing_to_crm`), and never opens or reopens a card on a sold, withdrawn or archived property. Trigger `crm_close_deals_on_property_unavailable`: when a property becomes sold, withdrawn or archived, its open cards before reservation close as lost with reason `property_unavailable` and a «تلقائي: ...» note; a card left open (booking, deposit, the buyer's own card, or a negotiation on a property withdrawn or archived without a sale) becomes a high-priority owner task instead. 21 cards closed this way; Ahmed got 10 `deal_auto_closed` notifications, shown on the home as «تحديثات تلقائية من النظام» (`crm-owner-home.js`). Left open on purpose: c89e141f and c2d06cc6 (negotiation on Falah 135, withdrawn and archived, each with a review task) and d45e6b4e (viewing cancelled, on f99087b9 which is reserved and archived).
- **Archive (SQL76, 76b).** Archived never means available (0 rows). Every archive has a reason (`property_archive_reasons`, `property_archive_events`): today 18 archived = unrecorded 12, contract expired 3, duplicate 1, test record 1, sold by owner 1. «📦 أرشفة العقار — ليش؟» asks the reason (`crm-property-archive.js`); restoring asks for a new listing contract («استعادة العقار كعقد جديد»). Daily `crm_expire_listing_agreements` at 06:00 UTC archives a property whose contract ended when no deal is active (`contract_expired`); a property with an active deal is not archived.
- **Agent (SQL78 + `whatsapp-reply-agent` febde8b + prompts synced at febde8b).** R18–R24 in `docs/agent-rules.md` (Ahmed's answers of 10 Nov: only the numbers he wrote; the agent invites to a meeting and books the time, «اجتماع:» alert on his WhatsApp; owner intake in his order; one light question before the 24 h window for «بشوف وبرد عليك»). The context has a client file (requests, visits, open deals, the agent's own notes, seriousness), the list of properties no longer available but not sold (R24), and every map link labelled with its property and status. Code guards from the dry run: residency denial or promise lines replaced (R17), «أم ...» and Latin «Om/Umm» names in the feminine when the customer writes Arabic (R15), call promises removed (R12), a map link to an available villa no longer answered as sold. The 7 open owner notes that became R18–R24 were closed; lessons are empty and the brain is base only (58,871 chars).
- **Dry run before publishing.** 19 scenarios and the last message of the last 20 chats, then the misses again, on `whatsapp-reply-agent-dryrun` (forced dry, inline: nothing written or sent). Final round at febde8b: residency twice correct (two R17 lines, no «مضمونة»), Om Muhsen in the feminine, the villa buyer told it is open to see, Rimaz answered, Al-Jeili, Abdullah (R16 silent handoff), Jihan, the mortgaged owner declined, Umm Rakan in the feminine. The live function answered the residency case the same way (inline, after the deploy).
- **Published.** `whatsapp-reply-agent` v53 → febde8b (was 6a78db8); `whatsapp-visit-followup-auto` v22 → febde8b (was 1627292; done-visit opinions and R21 send real messages from its next run, 05:00 UTC); `whatsapp-owner-hot-alert` v5 → febde8b (was 2f2bdfe; «اجتماع:» too); `whatsapp-reply-agent-dryrun` v12 → febde8b. Read-only checks after deploy: R21 preview found no chat waiting, the opinions preview read 12 done visits, hot alert refuses without the secret and its hourly keepalive returned 200. Front end: `crm-design-v14.js?v=20261110-obs1` (filter labels refresh with their counts). Migrations mirrored in `supabase/migrations/20261110*` (byte-identical to `db/changes`).
- **Not done.** `whatsapp-reply-send` does not book the meeting when Ahmed approves a held draft with `book_meeting`; the deal form shows the raw 23505 error when a second open card is refused; reports still count merged cards; a «حدد السبب» button for the 12 unrecorded archive reasons; leftover dry-run drafts and stale pinned replies; leaked-password protection is off in Supabase Auth.
- **Rollback.** Pin the four functions back to the commits above; `db/changes/78-agent-support.rollback.sql`, `77-deals-one-card.rollback.sql`, `76-property-archive.rollback.sql` (77b and 76b changed data: merged and closed cards keep their history and can be reopened one by one); revert the commits on main; reopen the 7 owner notes to restore their lessons.

## 10 November 2026 — full audit: no old-dashboard flash, counts match their pages, CI green (commits 37d9ffc to 29f7e2c)

- **Old dashboard before the new home.** The owner saw the old page (quick-add buttons, «جاري تحميل أهداف الفروع…») for several seconds. Two causes: nothing hid it before `crm-owner-home.js` finished, and `crm_owner_home` / `crm_paused_chats` queued behind the old dashboard reads (`crm_dashboard_work` twice, `crm_branch_target_snapshot`), all about 6 s together on the small database. Now `applyRoleVisibility` marks an owner session with `html.coh-boot` before the app shows: the old sections are not painted, a light placeholder stands in (`crm-owner-home.css`). `crm-operations-v6.js` waits for `window.crmHomeFirst` (first home load, 8 s at most) before its reads. The follow-up count is read together with the home (`crm-followups-today.js` skips its own read within 3 s). Staff pages unchanged. `index.html` fetches the base with its versioned URL instead of `no-store`, preconnects to Supabase; the base reads the profile in parallel with `getUser`.
- **Measured (owner, Ahmed's PC, 390 px, in-page timer).** Before: old dashboard visible at 1.47 s, new home at 8.25 s, base HTML 197 KB downloaded on every load. After: old dashboard never painted in any run; placeholder at 0.7–1.0 s; home at 1.3–1.7 s on repeat loads (3.6 s on the first load after a version change, 6.1 s once while the database was busy); base from cache. Not measured on a real phone network.
- **Counts.** Home tile «عروض ملاك جديدة» (open, last 7 days: 33) opened a page showing 93 (active with buyers): the page has «جديد هذا الأسبوع» and the tile opens on it; its batch reads run in parallel (about 4 s before); «house» shows as «بيت». Visits page «متأخرة» counted scheduled only (12) while the home counted scheduled, confirmed and postponed (14): the page uses the same rule, those visits get «تسجيل النتيجة», «confirmed» shows «مؤكدة». All five home tiles were opened: tile number = rows in the sheet (37, 56, 14, 2) and owner offers 33 = 33.
- **Database.** SQL75 `crm_paused_chats` runs `crm_chat_hold()` only where it can matter (identical output as owner, 33 ms instead of 100–550 ms; Barka still refused `42501`). `db/changes/20261110_live_chat_hold_RECORD.sql` records the live hold functions, which no file held.
- **Outreach.** `queue_requests` wrote `search_status='found'`, rejected by the check constraint: the update failed every hour since 9 Nov and the request came back each run. It writes `stopped` with «العميل قال حصل» in `next_action`. `whatsapp-outreach` is now a stub pinned to `609999d` (previously inline v4 = `bd80abf`), which also brings live the R1 hold guard committed 8 Nov; no queued row was held when deployed. Verified: the 06:10 UTC run paused the stuck request.
- **Phone.** A newly opened WhatsApp chat scrolls into view (it sat under the 340 px list). Client first-contact reads run two at a time and retry once: five at once timed out (`57014`) when several pages loaded together.
- **CI** had failed since 8 Nov on tests still checking replaced code (30-second staff rule, R13 visit results, the 9 Nov home, investor hold, `chat_hold` in the inbox). Tests follow the current code and cover the boot gate and the offers tile; CI prints failing test names as an annotation. First green run: `29f7e2c`.
- **R9 decided (Ahmed, 10 Nov).** Investors on the Muscat number are answered directly, as the live agent has done since `eeb5669` (9 Nov, live in `6a78db8`); only running deals wait for him. `docs/agent-rules.md` amended; no code change.
- **Open, for Ahmed.** (2) Five pairs of open deals for the same client and property, and five open deals on sold properties (Al Khoudh 7 villa 120 ×3, Al Rumais 59 Sultan 1 ×2): deals untouched. (3) 14 properties are `available` but archived. (4) The database is small (224 MB shared buffers, 60 connections) and in Tokyo (about 300 ms per request from Oman); bursts of reads hit the 8 s statement timeout. A larger compute or a nearer region is a paid decision. (5) Four scheduled jobs failed with «job startup timeout» at 05:50–05:55 UTC during this audit's page testing (none in the previous 7 days); the home «مشاكل» tile counts them until 24 h later.
- **Checked, unchanged.** Barka sees only Barka (710 chats), no investor records, projects, owner offers or Instagram catalog; owner-only functions refuse it. No open visit older than 5 days (R13); the 90-day close ran 05:40 UTC; 167 deal cards carry «💬 افتح الواتساب»; «🤫 وقّف العقل هنا» present; 38 of 38 voice notes in 3 days transcribed; `client_behavior_refresh` succeeding since 9 Nov 08:25 UTC. Not tried: any send, «كمّل يا عقل», mute, drag and drop, saving forms (all write real records), staff account screens, a real phone.
- **Rollback.** Revert the commits on main; `db/changes/75-paused-chats-fast.rollback.sql`; pin `whatsapp-outreach` back to `bd80abf`.

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
- A/B comparison of follow-up wording: built 11 Nov (R36, SQL93, see the top section).

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
- Open: note b498b41a (general 24h reminder), carousel/photos sending for rentals. (A/B assignment: built 11 Nov, R36, SQL93.)

### 9 Nov 2026 (11:30, investors)
- eeb5669: chats >23.5h since last inbound go to «متابعة اليوم» (outreach_queue request_followup) instead of drafts; function v51.
- 97384b4: brain.ts section «مستشار المستثمر» (Ahmed's consultant prompt); investors answered directly; unknown -> handoff. Project doc: claude/برومت-مستشار-المستثمرين-العقل.md. Project info comes only from project files.

## 9 نوفمبر (بعد الظهر)
- تفريغ صوتيات أحمد (gpt-4o-transcribe + قاموس)، لوحة «العقل موقوف عندهم»، زر «وقّف العقل هنا»، إعادة تصميم الرئيسية (بلاطات + نوافذ)، إغلاق صفقات الزيارة الراكدة بعد 90 يوم، إصلاح cron سلوك العملاء.
- R13: whatsapp-visit-followup-auto مثبت على 1627292، يقفل الزيارات الفائتة (عقار منتهي / 5 أيام بدون نتيجة) ويكتب ملاحظة للمحادثات الموقوفة. أول تشغيل: 14 زيارة انقفلت، 9 باقية حديثة (1–4 أيام).


## Price study reports in order — 11 Nov 2026 (evening)

Ahmed: the price-study reports reached him mixed (one client's parts interleaved, one arrived last). Now every report
(live «دراسة سعر» handoff or `price_study_batch`) is only queued as an `owner_price_study` event (status `detected`,
reason `queued` → `sending` → `applied`); `price_study_tick` (cron `owner_price_study_tick` every minute, SQL92, and
right after queuing) sends the oldest one only when nothing is sending and the last one finished 2+ minutes ago. Inside
one client every part waits (3 s after the details, 2.5 s after an image, 6 s after a video/document, 3 s before the end
line). A stuck `sending` row fails after 10 minutes. Function v8 → `7f00022`. All 9 open price studies were resent in
order at 17:19 Oman (#1 17:19, #2 17:22, then one every ~2–3 min). Media older than Meta keeps (chats d2bbc840 and
df4af2b4, sent 25 Oct – 3 Nov) come back `media_expired`: we keep no copy, so those images/videos cannot be resent.

Later the same evening (Ahmed): a resend batch is numbered per branch and grouped, Barka «1 من N» first, then Muscat «1 من N», each oldest first, so he sees how many each branch has. Function v9 → `fb4849c`. The 9 already sent keep their old 1–9 numbering.
