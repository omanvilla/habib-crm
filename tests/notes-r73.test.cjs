'use strict';
// 15 Nov 2026, Ahmed:
// R73 (note 5b7d5e71 on chat 20318506): a follow-up reads the chat first and never asks a question the client already answered.
// A handoff with no reply never waits on «ردود تنتظر موافقتك» (the card of a visited client asking about a deposit).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const agent=fs.readFileSync('supabase/functions/whatsapp-reply-agent/index.ts','utf8').replace(/\r\n/g,'\n');
const fu=fs.readFileSync('supabase/functions/whatsapp-visit-followup-auto/index.ts','utf8').replace(/\r\n/g,'\n');
const pick=(start,end)=>{const a=fu.indexOf(start);assert(a>=0,'missing: '+start);const b=fu.indexOf(end,a);assert(b>a,'no end: '+start);return fu.slice(a,b+end.length);};
const untype=(s)=>s.replace(/: \{ day: string; who: string; text: string \}\[\]/g,'').replace(/(\w+): (?:unknown|string|any|number)(?:\[\])?(?=[,)])/g,'$1').replace(/\(v, n = (\d+)\)/g,'(v, n = $1)');
const src=untype([pick('const short =','\n'),pick('const normAr =','\n'),pick('const R73_DID_VISIT_Q','\n'),pick('const R73_OPINION_Q','\n'),pick('const R73_NOT_VISITED','\n'),pick('const R73_GREET','\n'),
 pick('function chatTurns','\n}\n'),pick('const questionsOf','\n'),pick('const sameQuestion','\n'),pick('function repeatsAnswered','\n}\n'),pick('function answeredGuard','\n}\n')].join('\n'));
const {answeredGuard,R73_NOT_VISITED,normAr}=new Function(src+';return {answeredGuard,R73_NOT_VISITED,normAr};')();

const VILLA='فيلا بركاء الرميس';
const before=['[2026-11-13] العميل: بكرة العصر','[2026-11-13] المكتب: البيت مفتوح تقدر تشوفه بكره العصر','[2026-11-14] المكتب: السلام عليكم نأكد موعد زيارة العقار في بركاء الرميس اليوم الساعة 4 العصر ؟'];
const visit=(chat,extra)=>({group:false,kind:'visit',chat:chat.join('\n'),visitDay:'2026-11-14',visitDone:false,today:'2026-11-15',name:VILLA,...(extra||{})});
const didVisit=()=>({decision:'followup',text:'السلام عليكم هل قدرت تزور '+VILLA+' ؟',reason:'حدد موعد وما جاء',auto_ok:true,stage:'booked_no_show',offer_no:null});
const opinion=()=>({decision:'followup',text:'السلام عليكم كيف شفت '+VILLA+' وايش انطباعك عنها ؟',reason:'',auto_ok:true,stage:'visited_not_asked',offer_no:null});

test('R73: the real chat of 15 Nov. The client said he got busy, so «هل قدرت تزور» is not asked and nothing goes by itself',()=>{
 const chat=[...before,'[2026-11-15] المكتب: اهلا اخ حمود','[2026-11-15] المكتب: السلام عليكم كيف شفت '+VILLA+' وايش انطباعك عنها ؟',
  '[2026-11-15] العميل: حياك أخي الكريم.','','للأسف نشغلت. احاول هذه الأيام. إن شاء الله','[2026-11-15] العميل: شكرا على التواصل'];
 const r=answeredGuard(didVisit(),visit(chat));
 assert.equal(r.text,'السلام عليكم بخصوص '+VILLA+' تحب نحدد لك موعد ثاني ؟');
 assert.equal(r.auto_ok,false);assert.equal(r.guard,'guard_answered_not_visited');assert.equal(r.stage,'booked_no_show');assert.match(r.reason,/^\(R73\)/);
 // the opinion question is as wrong for him as «قدرت تزور»
 const o=answeredGuard(opinion(),visit(chat));assert.equal(o.guard,'guard_answered_not_visited');assert.doesNotMatch(o.text,/كيف شفت/);
 // the after-visit path (R47) reads the mark and leaves the row for the office
 assert(fu.includes('if (/\\(R73\\)/.test(String(f.data?.review_reason || ""))) { out.after_visit_held_answered'));
 assert(fu.indexOf('out.after_visit_held_answered')<fu.indexOf('const s = await sendOne(f.data, numbers, "after_visit");'));
});
test('R73: ways of saying «I did not go» are read, and ordinary words are not',()=>{
 for(const s of ['ما قدرت اروح','والله ما رحت','انشغلت اليوم','للأسف نشغلت','ما حصلت وقت','تأجل الموعد','لسا ما زرت','بحاول هالاسبوع','احاول هذه الأيام','ما مريت عليه'])assert(R73_NOT_VISITED.test(normAr(s)),s);
 for(const s of ['حلوه الفيلا','شفتها وعجبتني','كم السعر النهائي','ما شفت مثلها','تمام','ان شاء الله'])assert(!R73_NOT_VISITED.test(normAr(s)),s);
});
test('R73: the visit question the office already asked and the client answered is not asked again',()=>{
 const chat=[...before,'[2026-11-14] المكتب: السلام عليكم كيف شفت '+VILLA+' وايش انطباعك عنها ؟','[2026-11-14] العميل: حلوه بس بعيده شوي'];
 const r=answeredGuard(opinion(),visit(chat));
 assert.equal(r.decision,'skip');assert.equal(r.text,null);assert.equal(r.guard,'guard_question_answered');assert.match(r.reason,/^\(R73\)/);
 // a recorded visit: «ما قدرت …» in his answer is about something else, the asked-and-answered rule still holds
 const done=answeredGuard(opinion(),visit([...before,'[2026-11-14] المكتب: زرت الفيلا ؟','[2026-11-14] العميل: ايوه بس ما قدرت ادخل الملحق'],{visitDone:true}));
 assert.equal(done.guard,'guard_question_answered');
});
test('R73 leaves R47 alone: nobody asked, or the question got no answer, so the opinion question still goes',()=>{
 const silent=answeredGuard(opinion(),visit(before));assert.equal(silent.decision,'followup');assert.equal(silent.auto_ok,true);assert.equal(silent.guard,undefined);
 const other=answeredGuard(opinion(),visit([...before,'[2026-11-14] العميل: وصلت البيت','[2026-11-14] المكتب: حياك الله']));
 assert.equal(other.auto_ok,true);assert.match(other.text,/كيف شفت/);
 const unanswered=answeredGuard(opinion(),visit([...before,'[2026-11-14] المكتب: السلام عليكم كيف شفت '+VILLA+' وايش انطباعك عنها ؟']));
 assert.equal(unanswered.decision,'followup');assert.equal(unanswered.guard,undefined);
 // an old «ما قدرت» from before the day of the visit does not count
 const old=answeredGuard(opinion(),visit(['[2026-11-10] العميل: ما قدرت اجي اليوم',...before]));assert.equal(old.guard,undefined);
});
test('R73: a question asked in the last three days and answered waits for the office; an older one and a group message do not',()=>{
 const ask=()=>({decision:'followup',text:'السلام عليكم متى يناسبك تزور ؟',reason:'',auto_ok:true,stage:'asked_no_visit',offer_no:null});
 const recent=['[2026-11-14] المكتب: متى يناسبك تزور ؟','[2026-11-14] العميل: بشوف وبخبرك'];
 const r=answeredGuard(ask(),{group:false,kind:'request',chat:recent.join('\n'),today:'2026-11-15'});
 assert.equal(r.auto_ok,false);assert.equal(r.guard,'guard_repeated_question');assert.equal(r.text,'السلام عليكم متى يناسبك تزور ؟');assert.match(r.reason,/^\(R73\)/);
 const older=answeredGuard(ask(),{group:false,kind:'request',chat:['[2026-11-02] المكتب: متى يناسبك تزور ؟','[2026-11-02] العميل: بشوف وبخبرك'].join('\n'),today:'2026-11-15'});
 assert.equal(older.auto_ok,true);assert.equal(older.guard,undefined);
 const noAnswer=answeredGuard(ask(),{group:false,kind:'request',chat:'[2026-11-14] المكتب: متى يناسبك تزور ؟',today:'2026-11-15'});assert.equal(noAnswer.auto_ok,true);
 const group=answeredGuard(ask(),{group:true,kind:'request',chat:recent.join('\n'),today:'2026-11-15'});assert.equal(group.auto_ok,true);
});
test('R73 is wired after the review and the prompt no longer tells it to ask «هل قدر يزور»',()=>{
 assert(fu.includes('answeredGuard(out, { group, kind, chat: chatRead, visitDay, visitDone, today: todayRead, name });'));
 assert(fu.includes('out.chat_read = chat; out.today_read = today;'));
 assert(fu.includes('delete out.chat_read; delete out.today_read;'),'the chat is never stored on the row');
 assert(!fu.includes('اسأله هل قدر يزور بدل سؤال الرأي'));
 assert(fu.includes('- اقرأ المحادثة قبل السؤال (R73'));
});
test('a handoff with no reply never waits for approval: the chat goes to Ahmed at once',()=>{
 const a=agent.indexOf('const silentHandoff = !dry && !review && !out.reply_messages.length && out.action === "handoff";');
 const hold=agent.indexOf('if (dry || holdForOwner || (rt.reply_agent_mode === "approval" && !autoSend)) {');
 const mark=agent.indexOf('if (out.action === "handoff" || meetingBooked) Object.assign(convPatch, { human_handoff_required: true');
 assert(a>0&&a<hold&&hold<mark);
 const block=agent.slice(hold,agent.indexOf('// the customer wrote again while this reply was being prepared'));
 assert(block.includes('if (silentHandoff) analysis.silent_handoff_direct = true;\n      else {'),'only a draft with something to approve is kept pending');
 assert(block.includes('status: nothing ? "skipped" : "pending"'));
});

// ---- the dry run of 15 Nov 2026 on the last 124 chats: four mistakes held by code ----
const pickA=(start,end)=>{const a=agent.indexOf(start);assert(a>=0,'missing: '+start);const b=agent.indexOf(end,a);assert(b>a,'no end: '+start);return agent.slice(a,b+end.length);};
const {thanksOnly}=new Function([pickA('const CLOSING_WORDS','\n'),pickA('const THANKS_WORD','\n'),pickA('const THANKS_FILLER','\n'),pickA('const thanksOnly','\n')].join('\n').replace(/\(s: string\)/,'(s)')+';return {thanksOnly};')();
const r50=agent.slice(agent.indexOf('    let lastOutBody = "";'),agent.indexOf('    // the ad text goes once per conversation'));
const answer=(said,last,texts,o)=>{const out={action:'none',...(o||{})};
 return new Function('out','texts','history','burstSaid','closedAfterBooking','thanksOnly','REASON_Q',r50+'\nreturn {out,texts};')(out,texts||['تحب تشوف خيارات ثانية ؟'],(o&&o.history)||[{direction:'outbound',body:last},{direction:'inbound',body:said}],said,()=>false,thanksOnly,/الاسباب|ليش\s*ما\s*ناسب/);};

test('R50 after any follow-up of ours: a client who names what he found, or stopped buying, gets no reply and his search ends',()=>{
 const booked='السلام عليكم بخصوص فيلا الصومحان الجنوبية اللي سألت عنها انحجزت وحدة منها والمتبقي الثانية والثالثة تحب تشوفها ؟';
 const gone='السلام عليكم بخصوص فيلا الشخاخيط اللي سألتي عنها ما متوفره حالياً بس عندنا فيلا في الصومحان الجنوبية بـ 69 الف';
 for(const [said,last] of [['شكرًا وجدت خيار مناسب أكثر لي',booked],['وعليكم السلام بس خلاص جزاك الله خير اخذت بيت في سيب',booked],['وعليكم السلام.. خلاص اخوي حصلنا فيلا بقيمه أقل اشكرك',gone],['لا عزيزي حاليا متوقف عن الشراء',booked]]){
  const r=answer(said,last);assert.deepEqual(r.texts,[],said);assert.equal(r.out.search_stopped,true,said);}
 // not the end of a search: no property named, a question, a denial, or not after a follow-up of ours
 for(const [said,last] of [['حصلت رقمكم من صديق ارسل التفاصيل',gone],['حصلتوا شي ثاني ؟',gone],['لسا ما حصلت بيت',booked],['اخذت بيت في سيب','متى يناسبك تزور ؟'],['تمام ارسل التفاصيل',booked]]){
  const r=answer(said,last);assert.equal(r.out.search_stopped,undefined,said);assert.equal(r.texts.length,1,said);}
 assert.equal(answer('اخذت بيت في سيب',booked,['تمام'],{action:'handoff'}).out.search_stopped,undefined,'a handoff is left alone');
});
test('R49 by code: thanks alone get «العفو» alone',()=>{
 for(const s of ['تم جزاك الله خير','شكرا','بارك الله فيك','وعليكم السلام ورحمة الله وبركاته أخي شكرا جزيلا لك','تسلم الغالي','يعطيك العافية اخوي','مشكور ما قصرت'])assert.equal(thanksOnly(s),true,s);
 for(const s of ['شكرا كم السعر ؟','لا شكرًا ما اريد في بركاء','تمام','ان شاء الله','شكرا بس ابي الموقع','طيب','بكون شاكر لك وربي يبارك لك يا اخي الكريم في رزقك'])assert.equal(thanksOnly(s),false,s);
 const last='المالك ساكن في البيت وما عندنا صور من الداخل عشان الخصوصية';
 // a reply that repeats our last lines to a client who only thanked becomes «العفو»
 let r=answer('تم جزاك الله خير',last,['بحكم إن المالك ساكن في البيت ما صورنا البيت من الداخل عشان الخصوصية','بس نقدر نرتب لك زيارة وتشوف البيت من الداخل على راحتك']);
 assert.deepEqual(r.texts,['العفو']);assert.equal(r.out.guard_thanks_only,true);
 r=answer('شكرا',last,['العفو']);assert.equal(r.out.guard_thanks_only,undefined);
 r=answer('شكرا',last,[]);assert.deepEqual(r.texts,[],'the model chose to say nothing');
 r=answer('شكرا',last,['البيت مفتوح تقدر تشوفه'],{action:'send_location'});assert.equal(r.texts[0],'البيت مفتوح تقدر تشوفه','a location going out is left alone');
 r=answer('شكرا كم السعر ؟',last,['السعر 59 الف']);assert.deepEqual(r.texts,['السعر 59 الف']);
});
test('R56 apology is not sent twice, and nothing is glued to the fixed project line',()=>{
 assert(agent.includes('const told = history.some((h: any) => h.direction === "outbound" && OUT_OF_AREA_SAID.test(String(h.body || "")));'));
 assert(agent.includes('texts = told ? [] : [...(salam ? [salam] : []), ...OUT_OF_AREA_LINES, ...(salam ? [] : ["الله يسعدك 🌷"])];'));
 assert(agent.includes('if (told) out.guard_owner_area_repeat = true;'));
 const glued=new Function('fixedLine','return '+pickA('(t: string) => t.length <= 200 && t.includes(fixedLine)',';').replace('(t: string)','(t)').replace(/;$/,''))('الاسعار تختلف حسب الوحدة والمساحة والمرحلة');
 assert.equal(glued('الاسعار تختلف حسب الوحدة والمساحة والمرحلة وما عندي سعر محدد لغرفتين وصالة قبل اختيار الوحدة'),true);
 assert.equal(glued('الاسعار تختلف حسب الوحدة والمساحة والمرحلة'),false);
 assert.equal(glued('الاسعار تختلف حسب الوحدة والمساحة والمرحلة والافضل نرتب لك اجتماع مع المطور'),false);
 assert(agent.includes('texts = texts.map((t) => (glued(t) ? fixedLine : t)).filter((t, i, a) => a.indexOf(t) === i);'));
});

