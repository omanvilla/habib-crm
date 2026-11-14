'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const fn=fs.readFileSync('supabase/functions/whatsapp-visit-followup-auto/index.ts','utf8'),brain=fs.readFileSync('supabase/functions/whatsapp-reply-agent/brain.ts','utf8');
const sql=fs.readFileSync('db/changes/63-visit-followups-automatic.forward.sql','utf8');

test('only a utility template or free text in the window goes out, so no marketing cost',()=>{
 assert(fn.includes('if (!service && !utility) return "waits_for_utility_template";'));
});
test('company numbers never message each other, and paused or handed-over chats wait',()=>{
 assert(fn.includes('numbers.includes(to)'));
 assert(fn.includes('client.followup_suppressed || client.archived || conv.agent_muted || conv.human_handoff_required'));
});
test('a client who wrote after the follow-up was prepared gets no follow-up',()=>{
 assert(fn.includes('return stop("superseded", "client_wrote_after")'));
});
test('it can be stopped and keeps to sending hours',()=>{
 assert(fn.includes('!rt.visit_followups_auto'));assert(fn.includes('hour < 9 || hour >= 21'));
});
test('passed visits are limited to the last 30 days, and none while a new visit is booked',()=>{
 assert(sql.includes("::date - 30"));assert(sql.includes('NOT EXISTS (SELECT 1 FROM public.viewings nx'));
});
test('negotiation gets no reply and goes to Ahmed',()=>{
 assert(brain.includes('التفاوض لأحمد بس. لا ترد عليه بأي شي'));
 assert(!brain.includes('"تمام بشوف مع المالك وارد عليك"، و action=handoff'));
});
test('interior photos of an occupied home get the fixed reply after checking the property',()=>{
 assert(brain.includes('بحكم إن المالك ساكن في البيت ما صورنا البيت من الداخل عشان الخصوصية'));assert(brain.includes('لا تعد بصور أبداً ولا تسأل "أرسل لك الصور ؟"'),'R34');
 assert(brain.includes('"الزيارة: المالك ساكن"'));
});
// Ahmed 10 Nov (point 1): every visit result is recorded by the AI, also for a visit already saved "done" with no opinion.
test('a visit recorded done with no opinion gets the client opinion only, never a new status',()=>{
 const part=fn.slice(fn.indexOf('async function visitResults('),fn.indexOf('// "اليوم الساعة 4 العصر"'));
 assert(fn.includes('OPINION_DAYS = 30'));
 assert(part.includes('.eq("status", "done").is("client_feedback", null).is("pipeline_outcome", null)'));
 assert(part.includes('for (const v of [...(vs.data || []), ...(ds.data || [])]) {'));
 assert(part.includes('if (at && at > Math.max(...since) && budget > 0) {'),'read only when the client wrote after the visit day and the last check');
 const donePatch=part.slice(part.indexOf('if (done) {'),part.indexOf('} else if (r.result === "done") {'));
 assert(donePatch.includes('client_feedback: o.feedback')&&donePatch.includes('liked: o.liked')&&donePatch.includes('pipeline_outcome: o.outcome'));
 assert(donePatch.includes('rejection_reason: r.opinion === "disliked"')&&donePatch.includes('outcome_note: short(r.note, 500), notes }'));
 assert(!donePatch.includes('status:'),'the opinion only');
 assert(part.includes('.eq("row_version", v.row_version).eq("status", "done").is("client_feedback", null)'),'an opinion saved by the office meanwhile is kept');
 assert(part.includes('.eq("row_version", v.row_version).in("status", ["scheduled", "confirmed", "postponed"])'),'open visits as before');
 assert(part.includes('if (!patch && !done) {'),'the R13 closing rules stay for open visits only');
 assert(part.includes('if (done && writing) {')&&part.includes('update({ ai_checked_at: new Date().toISOString() })'),'a refused save is not re-read by the model every run');
 assert(part.includes('if (held) {')&&part.includes('رأي العميل بعد الزيارة ينتظرك'));
 assert(fn.includes('const r = again || await judgeResult(v, today, done);'));
 assert(fn.includes('instructions: opinionOnly ? OPINION_RULES : RESULT_RULES')&&fn.includes('الزيارة مسجلة إنها تمت'));
 assert(part.includes('if (done && (["sold", "withdrawn", "not_available"].includes(pr.status) || pr.archived === true)) continue;'),'a deal the property automation closed is not moved again');
 assert(fn.includes('const doneOnly = input.preview_results === "done";'));
});
// Review 10 Nov (AGENTS.md deals rule): sync_viewing_to_crm moves the card from the opinion («negotiate» -> negotiation and
// «disliked» -> lost on any card not closed, a booking too; «liked» reopens a lost card), so the AI writes one only while the
// client's card is still at the visit and the property is available.
test('an opinion is written only while the card is at the visit and the property is available',async()=>{
 const a=fn.indexOf('const VISIT_STAGES');assert(a>=0);
 const src=fn.slice(a,fn.indexOf('\n}\n',fn.indexOf('async function opinionBlocked'))+3).replace(/: any/g,'');
 const fake=(cards,prop,cardsError)=>({from:()=>{const q={select:()=>q,eq:()=>q,limit:async()=>({data:cards,error:cardsError||null}),maybeSingle:async()=>({data:prop,error:null})};return q;}});
 const gate=(cards,prop,err)=>new Function('db',src+';return opinionBlocked;')(fake(cards,prop,err))({company_id:'c',client_id:'k',property_id:'p'});
 const free={status:'available',archived:false};
 assert.equal(await gate([{stage:'visit'}],free),'');
 assert.equal(await gate([{stage:'new'}],free),'');
 assert.equal(await gate([],free),'','no card yet: the visit makes the one card');
 assert.equal(await gate([{stage:'viewing_postponed'},{stage:'lost',merged_into_deal_id:'x'}],free),'','a merged duplicate does not count');
 for(const stage of ['negotiation','deposit','awaiting_finance','finance_approved','awaiting_clearance','ownership_transfer','closed','commission_collected'])assert.equal(await gate([{stage}],free),'deal_moved_on',stage);
 assert.equal(await gate([{stage:'visit'},{stage:'lost'}],free),'deal_lost','a card Ahmed or the property automation closed is not reopened');
 assert.equal(await gate([{stage:'visit'}],{status:'reserved',archived:false}),'property_not_available');
 assert.equal(await gate([{stage:'visit'}],{status:'available',archived:true}),'property_not_available');
 assert.equal(await gate([{stage:'visit'}],free,{message:'boom'}),'check_failed','fails closed');
 assert.equal(await gate([{stage:'visit'}],null),'check_failed');
});
test('the done-visit pass checks the card before reading and again before writing; an open visit keeps its result',()=>{
 const part=fn.slice(fn.indexOf('async function visitResults('),fn.indexOf('// "اليوم الساعة 4 العصر"'));
 // it waits for SQL77 and its 77b cleanup: before them an opinion could add a second card or stop 77b (a merged card exists after)
 assert(part.includes('const merged = await db.from("deals").select("id").not("merged_into_deal_id", "is", null).limit(1);'));
 assert(part.includes('const ds: any = opinionPass')&&part.includes(': { data: [] };'));
 // before the chat is read, and before the held note («رأي العميل ينتظرك» is wrong for a booked deal)
 assert(part.includes('if (done && !gates.has(key)) gates.set(key, await opinionBlocked(v));'));
 const early=part.indexOf('if (done && gates.get(key)) {');
 assert(early>0&&early<part.indexOf('if (held) {')&&early<part.indexOf('await judgeResult('));
 // again just before the write; then only the check is stamped
 const donePatch=part.slice(part.indexOf('if (done) {'),part.indexOf('} else if (r.result === "done") {'));
 assert(donePatch.includes('if (patch && !again) {')&&donePatch.includes('const why = await opinionBlocked(v);')&&donePatch.includes('if (why) patch = null;'));
 assert(donePatch.includes('if (why === "check_failed") throw new Error("deal_check_failed");'));
 // an open visit is still closed done (R13), without the opinion when its card is past the visit or the property is not available
 assert(part.includes('if (why && why !== "deal_lost") { o = undefined;')&&part.includes('rejection_reason: o && r.opinion === "disliked"'));
 assert(fn.includes('...(doneOnly ? { left_to_ahmed: (await opinionBlocked(v)) || null } : {})'));
});
// R21 (Ahmed 10 Nov): «بشوف وبرد عليك» gets ONE light question before the 24 hour window closes, then space.
test('R21: the words that start it, and a line the code would never send by itself',()=>{
 const pick=(start,end)=>{const a=fn.indexOf(start);assert(a>=0,start);return fn.slice(a,fn.indexOf(end,a)+end.length);};
 const src=[pick('const TYPE_AR','\n'),pick('function arabicOnly','\n}\n'),pick('const normAr','\n'),pick('const THINK_RE','\n'),pick('function thinkingText','\n}\n'),pick('const THINK_BAD','\n'),pick('function thinkingOk','\n}\n')].join('\n')
  .replace(/: Record<string, string>/,'').replace('(text: string | null): { text: string | null; latin: boolean }','(text)').replace(/\((\w+): (?:unknown|string)\)/g,'($1)');
 const {normAr,THINK_RE,thinkingText,thinkingOk}=new Function(src+';return {normAr,THINK_RE,thinkingText,thinkingOk};')();
 const think=(s)=>THINK_RE.test(normAr(s));
 assert.equal(normAr('إن شاء الله بَشُوف  وبَرُد عَلَيك يا أخي'),'ان شاء الله بشوف وبرد عليك يا اخي');
 for(const s of ['أن شاءالله بشوف و برد عليك','بَشُوف وبَرُد عَلَيك','نعم شفتها بس بشوف الاهل وبرجع لك لو قررنا','برد عليك','بشوف وارد عليك','بشاور الأهل','بكلم الأهل وأخبرك','بفكر فيها','ان شاء الله أخبرك','بعطيك خبر','خلني افكر','بشوف اشاور فيها هل يناسبهن او لا'])assert(think(s),s);
 for(const s of ['كم السعر ؟','متى أقدر أزور ؟','تمام شكراً','وين الموقع','السلام عليكم','عندي فكرة ثانية'])assert(!think(s),s);
 // like every follow-up it starts with «السلام عليكم» (REVIEW_RULES); «هلا» is banned in follow-ups and Ahmed's note gave no wording
 assert.equal(thinkingText('السلام عليكم، شاورت الأهل؟ ونبي نعرف'),'السلام عليكم شاورت الأهل ؟');
 assert.equal(thinkingText('شاورت الأهل؟'),'السلام عليكم شاورت الأهل ؟','the greeting is added');
 assert.equal(thinkingText('سلام عليكم شفت الموضوع؟'),'السلام عليكم شفت الموضوع ؟','never two greetings');
 assert.equal(thinkingText(null),'');
 assert(thinkingOk('السلام عليكم شاورت الأهل ؟')&&thinkingOk('السلام عليكم أحمد شفت الموضوع ؟')&&thinkingOk(thinkingText('فكرت في الموضوع ؟')));
 for(const s of ['هلا شاورت الأهل ؟','السلام عليكم هلا شاورت الأهل ؟',thinkingText('هلا، شاورت الأهل؟'),thinkingText('هلا والله شفت الموضوع ؟'),'شاورت الأهل ؟','السلام عليكم شاورت الأهل','السلام عليكم ؟','السلام عليكم شاورت ؟',
  'السلام عليكم السعر صار 57 ألف ؟','السلام عليكم خلني أتأكد وارد عليك ؟','السلام عليكم احجز لك قبل لا ينباع ؟','السلام عليكم did you decide ؟','السلام عليكم شفت وادي زها ؟'])assert(!thinkingOk(s),s);
 const rules=fn.slice(fn.indexOf('const THINK_RULES'),fn.indexOf('const thinkSchema'));
 assert(rules.includes('"السلام عليكم شاورت الأهل ؟"')&&!rules.includes('"هلا')&&rules.includes('وكلمة هلا'));
});
test('R21: once per chat, 18 to 23 hours after his last words, behind the same guards and send helper',()=>{
 const part=fn.slice(fn.indexOf('async function thinkingFollowups('),fn.indexOf('const RESULT_RULES'));
 assert(fn.includes('THINK_PER_RUN = 10, THINK_EVERY_DAYS = 14'));
 assert(fn.includes('if (nowMs - lastAt < 18 * HOUR_MS || nowMs - lastAt > 23 * HOUR_MS) return null;'));
 assert(fn.includes('m.channel_source !== "crm_reply_agent"'),'after his words only the reply agent answer to them');
 assert(part.includes('q.status === "sent" || new Date(q.created_at).getTime() > moment.lastAt'),'once in 14 days, and one reading of this silence');
 assert(part.includes('if (c.agent_muted || c.human_handoff_required) continue;'));
 assert(part.includes('db.rpc("crm_chat_hold", { p_conversation: c.id })')&&part.includes('if (holdR.data) { skip("held_owner_chat"); continue; }'));
 assert(part.includes('client.followup_suppressed || client.archived'));
 assert(part.includes('numbers.includes(to)')&&part.includes('skip("staff_number")')&&part.includes('skip("property_owner")'));
 assert(part.includes('.in("stage", ACTIVE_DEAL_STAGES)')&&part.includes('skip("other_followup_queued")'));
 assert(part.includes('if (await unreadVoiceNearEnd(c.id))'));
 assert(part.indexOf('if (dry) { items.push(')>0&&part.indexOf('if (dry) { items.push(')<part.indexOf('.insert('),'the preview inserts and sends nothing');
 assert(part.includes('kind: "thinking_followup"')&&part.includes('await sendQueueText(ins.data, numbers)'));
 assert(!part.includes('type: "template"')&&!part.includes('metaSend'));
 assert(fn.includes('const claim = await db.from("whatsapp_outreach_queue").update({ status: "sent", reason: "auto_in_window" })'));
 assert(fn.includes('source: thinking ? "thinking_followup" : "request_followup"'));
 assert(fn.includes('update(thinking ? { status: "failed", error: why } : { status: "pending", reason: null, error: why })'));
 assert(fn.includes('await sendInWindow(rt.company_id, numbers, out);\n    // R21')&&fn.includes('\n    await thinkingFollowups(rt.company_id, numbers, out);\n'),'after the visit_followups_auto switch, inside the sending hours');
 assert(fn.includes('if (input?.preview_thinking) {')&&fn.includes('.filter(Boolean), {}, true);'));
});
// R55 (Ahmed 14 Nov 2026 «نعم، سوّها», from Maram's note of 11 Nov): a short rent the office does not have (a rest house booked
// for a day) gets no follow-up, and «للإيجار أو الشراء ؟» is never asked a client who already said which. Held by code.
test('R55: a rest house booked for a day gets no follow-up, and rent-or-buy is not asked again',()=>{
 const pick=(start,end)=>{const a=fn.indexOf(start);assert(a>=0,start);return fn.slice(a,fn.indexOf(end,a)+end.length);};
 const src=[pick('const short =','\n'),pick('const normAr','\n'),pick('const R55_RENT','\n'),pick('const R55_BUY','\n'),pick('const R55_LEISURE','\n'),pick('const R55_BOOK','\n'),pick('const R55_SHORT','\n'),pick('const R55_DATE','\n'),pick('const R55_ASK','\n'),pick('const R55_STAGES','\n'),pick('const r55Norm','\n'),pick('function shortRentGuard','\n}\n'),pick('const takesShortRent','\n')].join('\n')
  .replace('(v: unknown, n = 500)','(v, n = 500)').replace('(out: any, clientSaid: string, shortRentAvailable: boolean, fallback: string)','(out, clientSaid, shortRentAvailable, fallback)').replace(/\((\w+): (?:unknown|string|any)\)/g,'($1)');
 const {shortRentGuard,takesShortRent}=new Function(src+';return {shortRentGuard,takesShortRent};')();
 const o=(x)=>({decision:'followup',text:null,subject:null,reason:'',stage:'asked_no_visit',auto_ok:true,offer_no:null,...x});
 const run=(x,said,shortAvailable=false,fallback='بخصوص طلبك استراحة لين الحين تبحث ؟')=>shortRentGuard(o(x),said,shortAvailable,fallback);
 // Maram's client (8b3d1cca): «شي حجز تاريخ 2026/11/26», «استراحة», and the follow-up asked rent or buy
 const booked='السلام عليكم\nاخبارك عساك طيب\nمن فضلك شي حجز تاريخ \n2026/11/26\nلك الشكر\nاستراحة\nمن فضلك ارسل تفاصيل المرافق';
 const ask='السلام عليكم الاستراحة للإيجار أو الشراء ؟';
 let r=run({text:ask,subject:'استراحة',reason:'سأل عن استراحة'},booked);
 assert.equal(r.decision,'skip');assert.equal(r.text,null);assert.equal(r.auto_ok,false);assert.equal(r.guard,'guard_short_rent');assert(r.reason.startsWith('(R55)'));
 r=run({decision:'wait_for_match',reason:'يبحث عن استراحة للإيجار بتاريخ 26 نوفمبر وما عندنا'},booked);
 assert.equal(r.decision,'skip','no «اول ما يتوفر» for a short rent');assert.equal(r.guard,'guard_short_rent');
 r=run({decision:'wait_for_match',reason:'يبي شقة إيجار يومي'},'عندكم شقة ايجار يومي ؟');assert.equal(r.decision,'skip');
 r=run({text:'السلام عليكم لين الحين تبحث عن استراحة ؟'},'ابي حجز استراحة ٢٦/١١');assert.equal(r.decision,'skip','Arabic digits');
 // a short rent IS on the list: the review decides, only the rent-or-buy question goes
 r=run({text:ask,subject:'استراحة'},booked,true);
 assert.equal(r.decision,'followup');assert.equal(r.text,'السلام عليكم بخصوص طلبك استراحة لين الحين تبحث ؟');assert.equal(r.auto_ok,false);assert.equal(r.guard,'guard_rent_or_buy');
 // the review already said skip, or the follow-up is about something else: untouched
 r=run({decision:'skip',reason:'موضوعه انتهى'},booked);assert.equal(r.guard,undefined);assert.equal(r.reason,'موضوعه انتهى');
 r=run({text:'السلام عليكم كيف شفت فيلا الرميس وايش انطباعك عنها ؟',subject:'فيلا الرميس',reason:'زار فيلا الرميس',stage:'visited_not_asked'},booked);
 assert.equal(r.decision,'followup');assert.equal(r.guard,undefined);
 r=run({text:'السلام عليكم متى يناسبك تزور فيلا الرميس ؟',subject:'فيلا الرميس',reason:'سأل عن فيلا الرميس'},booked);
 assert.equal(r.decision,'followup','a later subject that is not the rent');assert.equal(r.guard,undefined);
 // never a buyer, a visit booking, a yearly tenant who visits tonight, or «اليومين»
 for(const said of ['كم سعر الاستراحة اللي للبيع ؟\nابي ازورها بتاريخ 20/11','ابي احجز موعد زيارة للاستراحة بتاريخ 20/11','ابي اشتري استراحة يوم واحد اشوفها','عندكم استراحة ؟']){
  r=run({text:'السلام عليكم متى يناسبك تزور الاستراحة ؟',subject:'استراحة',reason:'سأل عن الاستراحة'},said);assert.equal(r.decision,'followup',said);assert.equal(r.guard,undefined,said);}
 for(const said of ['ابي شقة للايجار\nاقدر اشوفها الليله ؟','ابي بيت ايجار بمر عليكم اليومين الجايه']){
  r=run({text:'السلام عليكم متى يناسبك تزور الشقة ؟',subject:'شقة للإيجار',reason:'يبي شقة للإيجار'},said);assert.equal(r.decision,'followup',said);assert.equal(r.guard,undefined,said);}
 // rent or buy: removed when he said which, kept when he never did
 for(const q of ['السلام عليكم البيت للايجار ولا للشراء ؟','السلام عليكم قصدك ايجار لو شراء ؟','السلام عليكم تبحث عن شراء او ايجار ؟']){
  r=run({text:q,subject:'بيت في بركاء'},'ابي بيت للإيجار في بركاء',false,'بخصوص طلبك بيت في بركاء لين الحين تبحث ؟');
  assert.equal(r.text,'السلام عليكم بخصوص طلبك بيت في بركاء لين الحين تبحث ؟',q);assert.equal(r.guard,'guard_rent_or_buy',q);assert.equal(r.auto_ok,false);}
 r=run({text:'السلام عليكم البيت للايجار ولا للشراء ؟'},'ابي اشتري بيت',false,'');assert.equal(r.decision,'skip','nothing left to send');assert.equal(r.text,null);
 r=run({text:ask,subject:'استراحة'},'عندكم استراحة ؟');assert.equal(r.text,ask,'he never said which: the question stays');assert.equal(r.guard,undefined);
 // which rents take a day or a week
 assert.equal(takesShortRent({listing_purpose:'rent',rental_terms:['6m','yearly'],type:'apartment'}),false);
 assert.equal(takesShortRent({listing_purpose:'rent',rental_terms:['daily'],type:'apartment'}),true);
 assert.equal(takesShortRent({listing_purpose:'rent',rental_terms:null,type:'resthouse'}),true,'terms not written = not refused');
 assert.equal(takesShortRent({listing_purpose:'sale',rental_terms:null,type:'resthouse'}),false);
 // wired in: after the review, not over an instruction, not on a message prepared for everyone; the list shows the terms
 assert(fn.includes('shortRentGuard(out, clientSaid, (await availableList(companyId)).shortRent, fallback);'));
 assert(fn.includes('if (!instruction && !(kind === "request" && ["property_sold", "new_listing"].includes(String(x.kind)))) {'));
 assert(fn.includes('delete out.client_said;'));
 assert(fn.includes('shortRent: rows.some(takesShortRent)')&&fn.includes('${rentTerms(p)}')&&fn.includes('rented_units,rental_terms")'));
 assert(fn.includes('- الإيجار القصير (R55، أحمد 14 نوفمبر)')&&fn.includes('لا تسأل "للإيجار أو الشراء ؟" أبداً إذا العميل قال قصده'));
 assert(fn.includes('decision: r.decision, guard: r.guard || null, stage: r.stage'));
});

// R60 / R63 / R64 (the open «ملاحظة لـ Claude» notes of 14 Nov 2026): a client who refused a place is not offered the same
// area again, a client looking for a higher bank valuation gets no follow-up, and a client who was given the owner's number
// is asked whether he visited, not when he will. Held by code after the review answers.
test('R60 / R63 / R64: refused area, valuation raise and owner contact are held by code',()=>{
 const pick=(start,end)=>{const a=fn.indexOf(start);assert(a>=0,start);return fn.slice(a,fn.indexOf(end,a)+end.length);};
 const src=[pick('const short =','\n'),pick('const normAr','\n'),pick('const R63_VALUATION','\n'),pick('const R60_GENERIC','\n'),pick('const areaWords','\n'),pick('const R60_PLACE','\n'),pick('const refusedPlace','\n'),pick('const R64_OWNER','\n'),pick('const R64_WHEN','\n'),pick('const R41_UNSURE','\n'),pick('function notesGuard','\n}\n')].join('\n')
  .replace('(v: unknown, n = 500)','(v, n = 500)').replace('(out: any, group: boolean, clientSaid: string, officeSaid: string, refusedAreas: string[], offerLabel: string, fallback = "")','(out, group, clientSaid, officeSaid, refusedAreas, offerLabel, fallback = "")').replace(/\((\w+): (?:unknown|string|any)\)/g,'($1)');
 const {notesGuard,refusedPlace,areaWords}=new Function(src+';return {notesGuard,refusedPlace,areaWords};')();
 const o=(x)=>({decision:'followup',text:'السلام عليكم بخصوص طلبك لين الحين تبحث ؟',subject:null,reason:'',stage:'asked_no_visit',auto_ok:true,offer_no:null,...x});
 // R63: «عندك حد يرفع التثمين» in his last lines = no follow-up; an ordinary valuation question of an owner is not that
 let r=notesGuard(o({}),false,'السلام عليكم\nعندك حد يرفع التثمين ابا اخذ هالفيلا\nعندي 40 الف شخصي ابا اغطيهم كلهم مع السكني','',[], '');
 assert.equal(r.decision,'skip');assert.equal(r.text,null);assert.equal(r.guard,'guard_valuation');assert(r.reason.startsWith('(R63)'));
 r=notesGuard(o({}),false,'ابي تثمين للارض كم تسوى','',[], '');assert.equal(r.decision,'followup');
 r=notesGuard(o({}),false,['يرفع التثمين'].concat(Array(12).fill('كم سعر الفيلا')).join('\n'),'',[], '');assert.equal(r.decision,'followup');
 // R60: the visit that was refused for its place
 assert.equal(refusedPlace({status:'done',rejection_reason:'location'}),true);
 assert.equal(refusedPlace({status:'done',liked:false,outcome_note:'جميلة لكن موقعها بعيد عن الدوام'}),true);
 assert.equal(refusedPlace({status:'done',liked:false,rejection_reason:'finishing',outcome_note:'عيوب في التشطيب'}),false);
 assert.equal(refusedPlace({status:'cancelled',rejection_reason:'location'}),false);
 assert.deepEqual(areaWords('بركاء الرميس'),['رميس']);
 // offered by number: same area = wait for a match; another area stays
 r=notesGuard(o({stage:'visited_no_fit',offer_no:3,text:'السلام عليكم عندنا فيلا ثانية تحب ارسلك تفاصيلها ؟'}),false,'موقعها بعيد','',['بركاء الرميس'],'فيلا في الرميس بـ 59 الف');
 assert.equal(r.decision,'wait_for_match');assert.equal(r.text,null);assert.equal(r.offer_no,null);assert.equal(r.guard,'guard_refused_location');assert(r.reason.startsWith('(R60)'));
 r=notesGuard(o({stage:'visited_no_fit',offer_no:5}),false,'موقعها بعيد','',['بركاء الرميس'],'فيلا في الصومحان بـ 69 الف');
 assert.equal(r.decision,'followup');
 // offered in words (the 12 Nov text), and a message prepared for everyone leaves his row
 r=notesGuard(o({text:'السلام عليكم الفيلا اللي سألت عنها في الرميس انباعت بس عندنا فيلا ثانية في الرميس بـ 59 الف تحب ارسلك تفاصيلها ؟'}),false,'','',['الرميس'],'');
 assert.equal(r.decision,'wait_for_match');
 r=notesGuard(o({text:'السلام عليكم نزل عندنا بيت في الرميس تحب ارسلك تفاصيله ؟'}),true,'','',['بركاء الرميس'],'');
 assert.equal(r.decision,'skip');
 // naming the property he saw is not an offer, and no refused visit = nothing changes
 r=notesGuard(o({text:'السلام عليكم كيف شفت فيلا الرميس وايش انطباعك عنها ؟'}),false,'','',['الرميس'],'');assert.equal(r.decision,'followup');
 r=notesGuard(o({offer_no:3}),false,'','',[],'فيلا في الرميس بـ 59 الف');assert.equal(r.decision,'followup');
 // R64: the owner's contact went out, so the question is «did you visit», and it waits for the office
 r=notesGuard(o({text:'السلام عليكم بخصوص البيت في الحيل الجنوبية متى يناسبك تزوره ؟',subject:'بيت الحيل الجنوبية'}),false,'تمام اخوي','[contacts]\nتواصل مع المالك مباشرة للزيارة',[], '');
 assert.equal(r.text,'السلام عليكم بخصوص بيت الحيل الجنوبية قدرت تزور العقار ؟');assert.equal(r.auto_ok,false);assert.equal(r.guard,'guard_owner_contact');assert.equal(r.decision,'followup');
 r=notesGuard(o({text:'السلام عليكم متى يناسبك تزورين البيت ؟'}),false,'','نسقي مع صاحب العقار',[], '');
 assert.equal(r.text,'السلام عليكم متى يناسبك تزورين البيت ؟');
 r=notesGuard(o({text:'السلام عليكم متى يناسبك تزورين البيت ؟'}),false,'','تواصل مع صاحب العقار',[], '');
 assert.equal(r.text,'السلام عليكم قدرتي تزورين العقار ؟');
 r=notesGuard(o({text:'السلام عليكم بخصوص البيت متى يناسبك تزوره ؟'}),false,'','تمام البيت مفتوح',[], '');
 assert.equal(r.text,'السلام عليكم بخصوص البيت متى يناسبك تزوره ؟');
 // wiring and the words the review reads
 // R41 in a follow-up: an answer we do not have is never written; the row's own wording goes and waits for the office
 r=notesGuard(o({text:'السلام عليكم بخصوص سؤالك عن الواي فاي ما عندي تأكيد إذا شامل أو لا متى يناسبك تزور الشقة وتشوفها ؟'}),false,'','',[], '','بخصوص طلبك شقة في الخوير لين الحين تبحث ؟');
 assert.equal(r.text,'السلام عليكم بخصوص طلبك شقة في الخوير لين الحين تبحث ؟');assert.equal(r.auto_ok,false);assert.equal(r.guard,'guard_unsure_answer');assert(r.reason.startsWith('(R41)'));
 r=notesGuard(o({text:'السلام عليكم ما عندنا سبب مؤكد لانخفاض الايجار متى يناسبك تزور ؟'}),false,'','',[], '','');assert.equal(r.decision,'skip');assert.equal(r.text,null);
 r=notesGuard(o({text:'السلام عليكم عندنا شقة في الخوير تحب ارسلك تفاصيلها ؟'}),false,'','',[], '','x');assert.equal(r.guard,undefined);
 assert(fn.includes('notesGuard(out, group, clientSaid, officeSaid, refusedAreas, offerLabel, kind === "request"'));
 assert(fn.includes('- الموقع ما ناسبه (R60')&&fn.includes('- رفع التثمين (R63')&&fn.includes('- رقم صاحب العقار (R64'));
});
