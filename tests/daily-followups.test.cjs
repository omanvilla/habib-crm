'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const js=fs.readFileSync('crm-followups-today.js','utf8'),fn=fs.readFileSync('supabase/functions/whatsapp-visit-followup-auto/index.ts','utf8'),agent=fs.readFileSync('supabase/functions/whatsapp-reply-agent/index.ts','utf8'),index=fs.readFileSync('index.html','utf8');
const sql=fs.readFileSync('db/changes/64-daily-followups-list.forward.sql','utf8');

test('the button opens the client chat with the prepared text',()=>{
 assert(js.includes("'https://wa.me/'+d+'?text='+encodeURIComponent(text||'')"));
 assert.match(index,/crm-followups-today\.js\?v=/);
});
test('the button asks for WhatsApp Business on the phone',()=>{
 assert(js.includes('package=com.whatsapp.w4b'));
 assert(js.includes("'whatsapp-smb://send?phone='"));
});
test('nothing is on the list or sent before its chat is read; closed topics leave',()=>{
 const review=fs.readFileSync('db/changes/65-followup-review.forward.sql','utf8');
 assert(review.includes("f.status = 'awaiting_approval' AND f.reviewed_at IS NOT NULL"));
 assert(fn.includes('if (!f.reviewed_at || !f.auto_ok || Date.now() < autoAfter(f.reviewed_at)) continue;'));
 assert(fn.includes('out.auto_ok = false;'));
 assert(fn.includes('out.text.slice(0, out.text.indexOf("؟") + 1)'));
 const clock=fs.readFileSync('db/changes/66-followup-wait-from-review.forward.sql','utf8');
 assert(clock.includes('public.crm_followup_auto_after(i.reviewed_at)'));
 assert(fn.includes('enum: ["followup", "skip", "wait_for_match"]'));
 assert(fn.includes('[رسالة صوتية قديمة ما انقرت]'));
});
test('silence after getting the details is not a reason to follow up; the preview writes nothing',()=>{
 assert(fn.includes('سكوته جواب'));
 const body=fn.slice(fn.indexOf('async function preview('),fn.indexOf('async function reviewAll('));
 assert(body.includes('.is("reason", null)'));
 assert(!body.includes('.update(')&&!body.includes('.insert('));
});
test('90 minutes after a visit: free text only, and nothing if someone already wrote',()=>{
 const sql=fs.readFileSync('db/changes/68-followup-after-visit.forward.sql','utf8');
 assert(sql.includes("<= now() - interval '90 minutes'"));
 assert(sql.includes("li.last_in > now() - interval '23 hours 30 minutes'"));
 assert(sql.includes("li.last_in <= v.visit_at + interval '30 minutes'"));
 assert(sql.includes("m.actor_type = 'human' AND m.message_timestamp > v.visit_at + interval '30 minutes'"));
 assert(fn.includes('if (freeOnly && !service) return "window_closed";'));
 assert(fn.includes('await sendOne(f.data, numbers, true)'));
 assert(fn.includes('if (rt.visit_followups_auto) await afterVisit('));
});
test('a visit confirmation goes only inside the window, once, when a reply would still cover the visit',()=>{
 const sql=fs.readFileSync('db/changes/70-visit-confirm.forward.sql','utf8');
 assert(sql.includes("li.last_in + interval '24 hours' > now() + interval '10 minutes'"));
 assert(sql.includes("li.last_in + interval '24 hours' < v.visit_at + interval '90 minutes'"));
 assert(sql.includes("v.visit_at + interval '90 minutes' <= now() + interval '24 hours'"));
 assert(sql.includes("m.raw_payload->>'source' = 'visit_confirm'"));
 assert(fn.includes('await confirmBeforeVisit('));
 const part=fn.slice(fn.indexOf('async function confirmBeforeVisit('),fn.indexOf('async function sendOne('));
 assert(part.includes('type: "text"')&&!part.includes('type: "template"'));
});
test('a client the review removed does not come back through another request',()=>{
 const sql=fs.readFileSync('db/changes/67-followup-removed-stay-removed.forward.sql','utf8');
 assert(sql.includes('BEFORE INSERT ON public.whatsapp_outreach_queue'));
 assert(sql.includes("NEW.reason IS NOT NULL THEN RETURN NEW"));
 assert(sql.includes('RETURN NULL'));
});
test('a message from a person takes the client off the list',()=>{
 assert(sql.includes("WHEN (new.direction = 'outbound' AND new.actor_type = 'human')"));
});
test('a branch account sees its own branch only',()=>{
 assert(sql.includes('WHERE v_owner OR crm_repair_private.staff_can_access_branch(v_company, i.route_key)'));
});
test('it reaches his list first; nothing goes by itself before 10am the next day, at most 20 a day',()=>{
 assert(sql.includes("+ 1) + time '10:00'"));
 assert(fn.includes('DAILY_LIMIT = 20'));
 assert(js.includes("'إذا ما أرسلت، ينرسل تلقائي '"));
});
test('marketing cost never goes out by itself, and a failed send stays on the list',()=>{
 assert(fn.includes('if (!service && !utility) return "waits_for_utility_template";'));
 assert(fn.includes('status: "awaiting_approval", error: why'));
});
test('a client changing or putting off a visit updates it, keeping any notes',()=>{
 assert(agent.includes('"cancelled", "postponed"]'));
 assert(agent.includes('w = await db.from("viewings").update({ status: "postponed", notes: addNote() })'));
 assert(agent.includes('الساعة ${String(v.viewing_time'));
});
test('a follow-up does not carry time words from an old chat',()=>{
 assert(fn.includes('لا تنقل كلمات وقت من كلام قديم'));
});
test('every follow-up starts with a greeting, on one line, and the review sees the saved name for feminine address',()=>{
 assert(fn.includes('if (out.text && !out.text.startsWith("السلام عليكم"))'));
 assert(fn.includes('.replace(/\\s+/g, " ").trim() : null;'));
 assert(fn.includes('يفيد بس لمعرفة إذا امرأة'));
 // the R21 question too (review 10 Nov: its examples started with «هلا», which REVIEW_RULES bans in follow-ups)
 assert(fn.includes('return s ? `السلام عليكم ${s}` : "";')&&fn.includes('s.startsWith("السلام عليكم") && s.endsWith("؟")'));
 assert(fn.includes('الوعود، كلمة هلا.')&&fn.includes('(^|\\s)هلا+(\\s|$)'));
});
test('the whole voice note is read before a follow-up reaches him',()=>{
 assert(fn.includes('short(body, 3000)'));
 assert(fn.includes('throw new Error("voice_note_pending")'));
});
test('the optional rented units note is a reference for the follow-ups and has a place on the form',()=>{
 const form=fs.readFileSync('crm-rented-units.js','utf8');
 assert(form.includes("update({rented_units:"));
 assert(fn.includes('المؤجر حالياً'));
 assert(index.includes('crm-rented-units.js?v='));
});
test('the agent asks a name once, never guesses, and notes when it was not given',()=>{
 const brain=fs.readFileSync('supabase/functions/whatsapp-reply-agent/brain.ts','utf8');
 assert(brain.includes('اسأله عن اسمه مرة وحدة بس'));
 assert(brain.includes('لا تناديه به ولا تخمن اسمه'));
 assert(agent.includes('ما ذكر اسمه، الاسم المسجل من الواتساب مو اسمه الحقيقي'));
 assert(agent.includes('"client_name_stated", "name_declined"]'));
 assert(agent.includes('rental_terms,rented_units"'));
});
// R1 (8 Nov): the 30-second rule is gone; crm_chat_hold() decides, and a follow-up sent from the daily list does not count.
test('the agent stays quiet after a typed office message until handed back (R1)',()=>{
 assert(agent.includes('const hold = await db.rpc("crm_chat_hold", { p_conversation: conv.id });'));
 assert(agent.includes('if (hold.data === "manual_reply") { await watch(); return fail("staff_active"); }'));
 assert(agent.includes('if (hold.error) { await watch(); return fail("hold_check_failed"); }'),'fails closed');
});
test('AI instruction on a follow-up: owner and staff (R28), rewrites from the whole chat, nothing sent, saved as a lesson',()=>{
 const sql72=fs.readFileSync('db/changes/72-followup-owner-instruction.forward.sql','utf8');
 const rb72=fs.readFileSync('db/changes/72-followup-owner-instruction.rollback.sql','utf8');
 assert(sql72.includes('CASE WHEN v_owner THEN i.owner_instruction END'));
 assert(rb72.includes('DROP COLUMN IF EXISTS owner_instruction')&&!rb72.split('ALTER TABLE')[0].includes('owner_instruction'));
 const part=fn.slice(fn.indexOf('async function instruct('),fn.indexOf('async function alertOwner('));
 assert(part.includes('await judge(kind, x, companyId, await availableText(companyId), instruction)'));
 assert(part.includes('source: "followup_instruction"')&&part.includes('apply_now: true')&&part.includes('by_staff: !byOwner'),'every instruction is a lesson; staff ones are marked (R28)');
 assert(!part.includes('metaSend')&&!part.includes('sendOne'));
 assert(fn.includes('!["owner", "manager", "agent"].includes(prof.data.role)')&&fn.includes('instruction, prof.data.role === "owner")'));
 assert(fn.includes('if (x.conversation_id && !instruction)'));
 assert(fn.includes('دروس من صاحب المكتب من أوامر سابقة'));
 // removed by an instruction stays removed: same review_ markers as the review
 const apply=fn.slice(fn.indexOf('async function applyDecision('),fn.indexOf('async function availableText('));
 assert(apply.includes('error: `review_${out.decision}`')&&apply.includes('reason: `review_${out.decision}`'));
 assert(js.includes("supa.functions.invoke('whatsapp-visit-followup-auto',{body:{kind:item.source,id:item.id,instruction}})"));
 assert(js.includes('انكتبت حسب أمرك')&&js.includes('if(!canInstruct())return'));
});
test('inside the 24 hour window the AI sends the review text at once, free text only, not over an unread voice note',()=>{
 const part=fn.slice(fn.indexOf('async function sendInWindow('),fn.indexOf('// "اليوم الساعة 4 العصر"'));
 assert(part.includes('await sendOne(f, numbers, true)'));
 assert(part.includes('type: "text"')&&!part.includes('type: "template"'));
 assert(part.includes('if (await unreadVoiceNearEnd('));
 assert(part.includes('numbers.includes(to)'));
 assert(part.includes('conv.agent_muted || conv.human_handoff_required'));
 assert(fn.includes('if (!rt.visit_followups_auto) continue;\n    await sendInWindow('));
});
test('visit results are the AI job: read from the chat, saved on the visit, a serious buyer alerts the owner',()=>{
 const part=fn.slice(fn.indexOf('async function visitResults('),fn.indexOf('// "اليوم الساعة 4 العصر"'));
 assert(part.includes('if (r.confidence >= 0.75)'));
 assert(part.includes('.eq("row_version", v.row_version).in("status", ["scheduled", "confirmed", "postponed"])'));
 assert(part.includes('ai_checked_at: now'));
 assert(part.includes('if (at && at > Math.max(...since) && budget > 0) {'),'the chat is read only when the client wrote after the visit and the last check');
 // R13 (9 Nov): no visit stays open; a chat held by Ahmed is noted and left open
 assert(part.includes('[موقوفة عند أحمد]')&&part.includes('if (held) {'));
 assert(part.includes('["sold", "withdrawn"].includes(pr.status) || pr.archived === true'));
 assert(part.includes('} else if (daysOver >= NO_RESULT_DAYS) {'));
 assert(!part.includes('metaSend'));
 assert(fn.includes('pipeline_outcome: o?.outcome'));
 assert(fn.includes('title: `🔥 مشتري جاد: ${name || "عميل"}`'));
 const home=fs.readFileSync('crm-owner-home.js','utf8');
 assert(home.includes('زيارات يتابعها الذكاء الاصطناعي')&&home.includes("if(Number(d.overdue_total))"));
 const hot=fs.readFileSync('crm-hot-alerts.js','utf8');
 assert(hot.includes("/^(مشتري جاد|تفاوض|طلب اتصال)/")&&hot.includes("isOwner()"));
 assert(index.includes('crm-hot-alerts.js?v='));
});
test('a saved visit result sends the visit follow-up back to review; property types read in Arabic',()=>{
 assert(fn.includes('if (patch) await db.from("whatsapp_visit_followups").update({ reviewed_at: null }).eq("viewing_id", v.id).eq("status", "awaiting_approval");'));
 assert(fn.includes('house: "بيت"'));
});
test('the hot client alert opens the chat in WhatsApp Business',()=>{
 const hot=fs.readFileSync('crm-hot-alerts.js','utf8');
 assert(hot.includes('package=com.whatsapp.w4b')&&hot.includes("'whatsapp-smb://send?phone='"));
 assert(hot.includes('class="btn-primary cha-open" href="'));
});
test('«تم» on a handed-over chat is saved in the database for every device (SQL74)',()=>{
 const hot=fs.readFileSync('crm-hot-alerts.js','utf8');
 assert(hot.includes("supa.rpc('crm_hot_alert_done',{p_conversation_id:n.conversation_id})"));
 assert(hot.includes('if(w.owner_alert_done_at&&new Date(w.owner_alert_done_at)>=new Date(at))continue;'));
 assert(!hot.includes('hidden[n.id]=Date.now()'));
 const sql=fs.readFileSync('db/changes/74-hot-alert-done.forward.sql','utf8');
 assert(sql.includes("public.my_role() IS DISTINCT FROM 'owner'")&&sql.includes('REVOKE ALL ON FUNCTION public.crm_hot_alert_done(uuid) FROM PUBLIC, anon;'));
 assert.equal(sql,fs.readFileSync('supabase/migrations/20261106140000_hot_alert_done_20261106.sql','utf8'));
});
test('a visit follow-up asks the client about the property by name, never a generic «شفت العقار ؟»',()=>{
 const pick=(start,end)=>{const a=fn.indexOf(start);assert(a>=0,start);return fn.slice(a,fn.indexOf(end,a)+end.length);};
 const src=[pick('const TYPE_AR','\n'),pick('const typeAr','\n'),pick('function propertyName','\n}\n'),pick('const GENERIC_VISIT_Q','\n'),pick('function namedVisitQuestion','\n}\n')].join('\n')
  .replace(/: Record<string, string>/,'').replace(/\((\w+): (?:any|unknown|string \| null|string)(?:, (\w+): (?:any|string))?\)/g,(m,a,b)=>'('+a+(b?', '+b:'')+')');
 const {propertyName,namedVisitQuestion}=new Function(src+';return {propertyName,namedVisitQuestion};')();
 const name=propertyName({type:'villa',area:'الرميس'});
 assert.equal(name,'فيلا الرميس');
 // R29 (Ahmed 11 Nov): the opinion in plain words, never «كيف لقيت» (read as «did you find the place ?»)
 assert.equal(namedVisitQuestion('السلام عليكم بخصوص الزيارة قدرت تشوف العقار ؟',name),'السلام عليكم كيف شفت فيلا الرميس ؟ عجبتك ولا ما ناسبتك ؟');
 assert.equal(namedVisitQuestion('السلام عليكم قدرتي تشوفين العقار ؟',propertyName({type:'house',area:'الحيل الجنوبية'})),'السلام عليكم كيف شفتي بيت الحيل الجنوبية ؟ عجبتك ولا ما ناسبتك ؟');
 assert.equal(namedVisitQuestion('السلام عليكم كيف لقيتي فيلا الشخاخيط ؟','فيلا الشخاخيط'),'السلام عليكم كيف شفتي فيلا الشخاخيط ؟ عجبتك ولا ما ناسبتك ؟');
 assert.equal(namedVisitQuestion('السلام عليكم كيف لقيت الفيلا ؟',''),'السلام عليكم كيف شفت الفيلا ؟ عجبتك ولا ما ناسبتك ؟');
 assert.equal(namedVisitQuestion('السلام عليكم قدرت تشوف العقار ؟',''),'السلام عليكم قدرت تشوف العقار ؟');
 assert(fn.includes('if (kind === "visit") out.text = namedVisitQuestion(out.text, name);'));
 assert(fn.includes('ممنوع سؤال عام مثل "قدرت تشوف العقار ؟"'));
});
// Audit 10 Nov: the lessons are stored oldest first, and the review kept the first 6,000 characters, so Ahmed's newest were cut.
test('the follow-up review keeps the newest of Ahmed\'s lessons when they are long',()=>{
 const a=fn.indexOf('function newestPart');assert(a>=0);
 const src=fn.slice(a,fn.indexOf('\n}\n',a)+3).replace('(text: unknown, n = 6000)','(text, n = 6000)');
 const newestPart=new Function(src+';return newestPart;')();
 const lesson=(d,w,k)=>'- ['+d+'] '+w.repeat(k);
 const newest='- [10/11] تابع اللي قال بشوف وبرد عليك';
 const kept=newestPart([lesson('01/11','قديم ',800),lesson('05/11','وسط ',800),newest].join('\n'),6000);
 assert(kept.endsWith(newest));
 assert(kept.startsWith('…- [05/11]'),'starts at a whole lesson');
 assert(!kept.includes('[01/11]')&&kept.length<=6001);
 assert.equal(newestPart('  - [10/11] قصير  ',6000),'- [10/11] قصير');
 assert(fn.includes('lessonsCache = { at: Date.now(), text: newestPart(r.data?.content, 6000) };'));
 assert(!fn.includes('short(r.data?.content || "", 6000)'));
});
