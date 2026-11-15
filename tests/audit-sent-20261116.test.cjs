'use strict';
// 16 Nov 2026: audit of the replies and follow-ups really sent between 11 and 15 Nov (Ahmed: «اريدك تبحث في المحادثات وتكتشف
// الاخطاء بدون ما انا اروح وابحث»). What today's code still got wrong, held by code:
// the reply agent (ownerDecisions): «الرميس ولا الرميس», «ويناسبك ؟», Barka offered on the Muscat number in other words (R66);
// the follow-ups: a visit question to a client who never got the location or the owner's number (R83), and anything but the
// opinion question going by itself after a visit (R47 / R73).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const agent=fs.readFileSync('supabase/functions/whatsapp-reply-agent/index.ts','utf8').replace(/\r\n/g,'\n');
const fu=fs.readFileSync('supabase/functions/whatsapp-visit-followup-auto/index.ts','utf8').replace(/\r\n/g,'\n');
const pickFrom=(src)=>(start,end)=>{const a=src.indexOf(start);assert(a>=0,'missing: '+start);const b=src.indexOf(end,a);assert(b>a,'no end: '+start);return src.slice(a,b+end.length);};
const pickA=pickFrom(agent),pick=pickFrom(fu);
const dsrc=['const THEIR_OFFICE','const ASK_CONFIRM','const WE_SHOW','const MY_OWN','const SILENT_TYPES','const COMMISSION_ASK','const COMMISSION_BUYER_LINES','const COMMISSION_OWNER_LINES','const ASK_LINK','const areaKey','const BOOKING_ASK','const BOOKING_NOT','const ASK_HOUR','const NEEDS_AHMED','const VIDEO_PROMISE','const FAREWELL','const FIXED_PRICE_LINE','const IG_CODE','const UNKNOWN_Q','const LOCATION_ASK','const AREA_REASON','const OUTSIDE_LOOK','const locationForArea','const LOCATION_HELD','const AREA_LINES','const INSIDE_VIDEO_ASK','const LAYOUT_ASK','const LAYOUT_LINES','const OUR_HOUR','const OWNER_TIME_LINE','const DEPOSIT_SAID','const REASON_Q','const VISIT_Q','const R66_DETAILS_ASK','const R66_GENERIC']
 .map((s)=>pickA(s,'\n')).join('')+pickA('function nearBarka','\n}\n')+pickA('function ownerDecisions','\n}\n');
const D=new Function(dsrc.replace(/(\w+): (?:string|any|unknown|number)(?:\[\])?(?=[,)])/g,'$1')+';return {ownerDecisions};')();
const IN=(b,type)=>({direction:'inbound',body:b,message_type:type||'text'}),OUT=(b)=>({direction:'outbound',body:b});
const decide=(texts,history,out,c)=>{const o={action:'none',category:'buyer',...(out||{})};const burst=[];for(const h of history){if(h.direction==='outbound')burst.length=0;else burst.push(h.body);}
 const t=D.ownerDecisions(o,texts,{history,burstSaid:burst.join(' '),prop:null,visitedProp:false,visitedAny:false,saidVisited:false,handoffOpen:false,hardHandoff:false,...(c||{})});return {out:o,texts:t};};

test('R44: «حي عاصم» written as «الرميس» no longer leaves the same place twice in one line',()=>{
 // chat 97f4e834, 15 Nov 09:30 (an owner) and chat 99b00f78, 14 Nov 16:57 (a buyer), after the replacement
 let r=decide(['الصور والسعر وصلن عادل','الفيلا في أي منطقة بالضبط الرميس ولا الرميس ؟'],[IN('عادل العامري 77 الف')],{category:'seller',guard_r44:true});
 assert.deepEqual(r.texts,['الصور والسعر وصلن عادل','الفيلا في أي منطقة بالضبط الرميس ؟']);
 r=decide(['حاليا ما متوفر عندنا فيلا بالرميس قريب الشارع العام او الرميس بهالحدود','اول ما يتوفر بتواصل معك'],[IN('ابغى فالرميس قريب الشارع العام حي عاصم')],{guard_r44:true});
 assert.equal(r.texts[0],'حاليا ما متوفر عندنا فيلا بالرميس قريب الشارع العام بهالحدود');
 r=decide(['تمام اول ما يتوفر فيلا في الرميس قرب الشارع العام او الرميس وبحدود 64 الف بتواصل معك'],[IN('64 الف')],{guard_r44:true});
 assert.equal(r.texts[0],'تمام اول ما يتوفر فيلا في الرميس قرب الشارع العام وبحدود 64 الف بتواصل معك');
 // only after the replacement, and two different places stay
 r=decide(['تقصد فيلا الرميس ولا الرميس الثانية ؟'],[IN('الفيلا')],{});assert.equal(r.texts[0],'تقصد فيلا الرميس ولا الرميس الثانية ؟');
 r=decide(['تقصد فيلا الرميس ولا الشخاخيط ؟'],[IN('الفيلا')],{guard_r44:true});assert.equal(r.texts[0],'تقصد فيلا الرميس ولا الشخاخيط ؟');
});
test('R45: «متى يناسبك ؟» cut to «يناسبك ؟» is not left glued as «ويناسبك ؟»',()=>{
 // chat 3a69247f, 15 Nov 14:12 and 14:14, and the dry run of 16 Nov on the same message
 let r=decide(['مشروع ذي اليزن في مطرح فيه شقق','الافضل نرتب لك اجتماع مع المطور ونعرض لك الوحدات المتوفرة ويناسبك ؟'],[IN('هل متوفر شقق في مشروع ذي اليزن؟')],{category:'investor'});
 assert.equal(r.texts[1],'الافضل نرتب لك اجتماع مع المطور ونعرض لك الوحدات المتوفرة يناسبك ؟');
 r=decide(['يناسبك ؟'],[IN('نعم')],{category:'investor'});assert.deepEqual(r.texts,['يناسبك ؟']);
 r=decide(['عندنا فيلا في الرميس','ويناسبك تزور بكره ؟'],[IN('فيلا')],{});assert.equal(r.texts[1],'ويناسبك تزور بكره ؟');
});
test('R66: Barka is not offered on the Muscat number in other words either',()=>{
 const available=[{id:'B1',branch_key:'barka',area:'الصومحان الجنوبية'},{id:'B2',branch_key:'barka',area:'بركاء الرميس'},{id:'M1',branch_key:'muscat',area:'الحيل الجنوبية'}];
 const c={route:'muscat',available,prop:{id:'B1',branch_key:'barka'}};
 // chat 5b58c79e (Muscat number): «راتبي 600 … هل ممكن امتلك بيت», then «65». Dry run of 16 Nov on today's code:
 const chat=[IN('أنا موظف في شركة وراتبي 600 هل من ممكن امتلك بيت'),OUT('اذا عرفت مبلغ التمويل خبرني عشان نرشح لك البيت المناسب'),IN('65')];
 let r=decide(['الاقرب لمبلغ التمويل عندنا فيلا في الصومحان الجنوبية بـ69 الف وتحتاج تزيد 4 آلاف'],chat,{property_id:'B1'},c);
 assert.deepEqual(r.texts,['في اي منطقة تبحث ؟']);assert.equal(r.out.guard_barka_offer,true);assert.equal(r.out.property_id,null);
 r=decide(['بـ65 الف اقرب شي عندنا فيلا في الرميس بـ 59 الف','تحب ارسلك تفاصيلها ؟'],chat,{request:{areas:['الخوض']}},c);
 assert.deepEqual(r.texts,['اول ما يتوفر بتواصل معك']);
 r=decide(['اقرب شي عندنا فيلا في الصومحان بـ 69 الف','متى يناسبك تزور ؟'],chat,{},c);assert.deepEqual(r.texts,['في اي منطقة تبحث ؟']);
 // the branch line of R48 is not added after it
 assert(agent.includes('prop.branch_key !== conv.route_key && !out.guard_barka_offer) {'));
 // left alone: he looks near Barka, he sent the property himself, the Barka number, a Muscat property, a handoff
 const keep=['الاقرب عندنا فيلا في الصومحان الجنوبية بـ69 الف'];
 r=decide(keep,[IN('ابحث عن فيلا في المعبيلة بحدود 65')],{},c);assert.deepEqual(r.texts,keep);
 r=decide(keep,[IN('ابي بيت قريب من الرميس')],{},c);assert.deepEqual(r.texts,keep);
 r=decide(keep,[IN('https://www.instagram.com/reel/TEST/'),IN('كم السعر')],{},c);assert.deepEqual(r.texts,keep);
 r=decide(keep,[IN('ممكن تفاصيل','image')],{},c);assert.deepEqual(r.texts,keep);
 r=decide(keep,chat,{},{...c,route:'barka'});assert.deepEqual(r.texts,keep);
 r=decide(['عندنا بيت في الحيل الجنوبية بـ 130 الف'],chat,{},c);assert.deepEqual(r.texts,['عندنا بيت في الحيل الجنوبية بـ 130 الف']);
 r=decide(keep,chat,{action:'handoff',handoff_reason:'سؤال ما عندي جوابه: التمويل'},c);assert.deepEqual(r.texts,keep);
 r=decide(keep,chat,{category:'seller'},c);assert.deepEqual(r.texts,keep);
});

// ---- the follow-ups ----
const untype=(s)=>s.replace(/: \{ day: string; who: string; text: string \}\[\]/g,'').replace(/(\w+): (?:unknown|string|any|number)(?:\[\])?(?=[,)])/g,'$1');
const fsrc=untype([pick('const short =','\n'),pick('const normAr =','\n'),pick('const R64_OWNER','\n'),pick('const R73_DID_VISIT_Q','\n'),pick('const R73_OPINION_Q','\n'),pick('const R73_NOT_VISITED','\n'),
 pick('function chatTurns','\n}\n'),pick('const R83_PLACE','\n'),pick('const R83_WAS_THERE','\n'),pick('function placeGuard','\n}\n'),pick('const EN_VISIT','\n'),pick('function heldForOffice','\n}\n')].join('\n'));
const {placeGuard,heldForOffice,EN_VISIT}=new Function(fsrc+';return {placeGuard,heldForOffice,EN_VISIT};')();
const HOUSE='بيت الحيل الجنوبية',VILLA='فيلا بركاء الرميس';
const opinion=(name,pron)=>({decision:'followup',text:'السلام عليكم كيف شفت '+name+' وايش انطباعك '+(pron||'عنها')+' ؟',reason:'موعد الزيارة اليوم وما نعرف إذا شافه',auto_ok:true,stage:'visited_not_asked',offer_no:null});
const o=(chat,extra)=>({group:false,kind:'visit',chat:chat.join('\n'),visitDay:'2026-11-15',visitDone:false,name:HOUSE,...(extra||{})});

test('R83: the two real chats of 15 Nov. No location and no owner number went out, so «كيف شفت» is not asked and nothing goes by itself',()=>{
 // chat 2d248def: the owner lives in the house, his number was never sent
 const hail=['[2026-11-14] المكتب: السلام عليكم بخصوص منزل الحيل الجنوبية اللي سألت عن موقعه متى يناسبك تزوره ؟','[2026-11-14] العميل: وعليكم السلام ورحمة الله وبركاته، ان شاء الله بكره، الساعة كم مناسب لك؟','[2026-11-14] المكتب: كم الساعة تقريباً ؟ عشان أرسل لك رقم صاحب العقار وتنسق معه الزيارة','اسمك الكريم ؟'];
 let r=placeGuard(opinion(HOUSE,'عنه'),o(hail));
 assert.equal(r.text,'السلام عليكم بخصوص '+HOUSE+' تحب نحدد لك موعد ثاني ؟');assert.equal(r.auto_ok,false);assert.equal(r.guard,'guard_place_not_sent');assert.equal(r.stage,'booked_no_show');assert.match(r.reason,/^\(R83\)/);
 // chat ffcf5a56: the ad and the reel went out, the location waited for a day and an hour
 const rumais=['[2026-11-15] العميل: [رسالة صوتية: إذا ممكن ترسل التفاصيل والموقع وين بالضبط؟]','[2026-11-15] المكتب: للبيع توين فيلا في الرميس بركاء','[2026-11-15] العميل: ممتاز معكم فيديو او صور للفلا','ان شاء الله احاول اليوم المساء او بكره',
  '[2026-11-15] المكتب: https://www.instagram.com/reel/DfrPGgoCOOp/','اذا ما عليك امر حدد لي اليوم والوقت تقريباً عشان ارسل لك الموقع'];
 r=placeGuard(opinion(VILLA),o(rumais,{name:VILLA}));assert.equal(r.guard,'guard_place_not_sent');assert.doesNotMatch(r.text,/كيف شفت/);
 assert.equal(heldForOffice({review_reason:r.reason,client_stage:r.stage,owner_text:r.text}),'marked');
});
test('R83 leaves R47 alone when the place reached the client, the visit is recorded done, or he wrote that he went',()=>{
 const sent=['[2026-11-14] العميل: بكره العصر','[2026-11-14] المكتب: البيت مفتوح تقدر تشوفه','https://maps.app.goo.gl/TEST?g_st=ac'];
 let r=placeGuard(opinion(VILLA),o(sent));assert.equal(r.guard,undefined);assert.equal(r.auto_ok,true);assert.match(r.text,/كيف شفت/);
 r=placeGuard(opinion(VILLA),o(['[2026-11-14] العميل: بكره','[2026-11-14] المكتب: https://maps.google.com/?q=23.6,57.8']));assert.equal(r.guard,undefined);
 r=placeGuard(opinion(HOUSE),o(['[2026-11-14] العميل: بكره الساعة 5','[2026-11-14] المكتب: تواصل مع صاحب العقار مباشرة ونسق معه وقت الزيارة','[2026-11-14] المكتب: [contacts]']));assert.equal(r.guard,undefined);
 r=placeGuard(opinion(HOUSE),o(['[2026-11-14] العميل: بكره','[2026-11-14] المكتب: [location]']));assert.equal(r.guard,undefined);
 const none=['[2026-11-14] العميل: بكره ان شاء الله','[2026-11-14] المكتب: كم الساعة تقريباً ؟'];
 r=placeGuard(opinion(HOUSE),o(none,{visitDone:true}));assert.equal(r.guard,undefined);
 r=placeGuard(opinion(HOUSE),o([...none,'[2026-11-15] العميل: انا واصل عند البيت']));assert.equal(r.guard,undefined);
 r=placeGuard(opinion(HOUSE),o([...none,'[2026-11-15] العميل: ما رحت اليوم']));assert.equal(r.guard,'guard_place_not_sent','«ما رحت» is not «رحت»');
 // not a visit question, a request follow-up, a message for everyone, a skip, no chat read
 r=placeGuard({decision:'followup',text:'السلام عليكم بخصوص '+HOUSE+' تحب نحدد لك موعد ثاني ؟',reason:'',auto_ok:false},o(none));assert.equal(r.guard,undefined);
 r=placeGuard(opinion(HOUSE),o(none,{kind:'request'}));assert.equal(r.guard,undefined);
 r=placeGuard(opinion(HOUSE),o(none,{group:true}));assert.equal(r.guard,undefined);
 r=placeGuard({decision:'skip',text:null,reason:''},o(none));assert.equal(r.guard,undefined);
 r=placeGuard(opinion(HOUSE),o([]));assert.equal(r.guard,undefined);
 // «قدرت تزور» is a visit question too
 r=placeGuard({decision:'followup',text:'السلام عليكم هل قدرت تزور '+HOUSE+' ؟',reason:'',auto_ok:true},o(none));assert.equal(r.guard,'guard_place_not_sent');
});
test('R47 / R73: after a visit only the opinion question goes by itself',()=>{
 // 15 Nov 17:30, chat 42ce77f2: «تحب نحدد لك موعد ثاني ؟» went by itself although the row said auto_ok=false, «حدد زيارة وما جاء»
 assert.equal(heldForOffice({auto_ok:false,client_stage:'booked_no_show',review_reason:'[حدد زيارة وما جاء] اشترط مشاهدة فيديو من الداخل',owner_text:'السلام عليكم بخصوص موعد زيارة '+VILLA+' تحب نحدد لك موعد ثاني ؟'}),'no_show');
 // 15 Nov 14:45, chat a6110345: a question of the review's own
 assert.equal(heldForOffice({client_stage:'visited_not_asked',review_reason:'',owner_text:'السلام عليكم عادل قدرت الأهل يشوفوا '+VILLA+' وايش كان رأيهم فيها ؟'}),'not_opinion');
 assert.equal(heldForOffice({client_stage:'visited_not_asked',review_reason:'(R73) قال بنفسه إنه ما زار',owner_text:'x'}),'marked');
 assert.equal(heldForOffice({client_stage:'visited_not_asked',review_reason:'[زار وما انسأل عن رأيه]',owner_text:'السلام عليكم كيف شفت '+VILLA+' وايش انطباعك عنها ؟'}),'');
 assert.equal(heldForOffice({client_stage:'visited_not_asked',review_reason:'',owner_text:'حياك الله، وايش انطباعك بعد الزيارة ؟'}),'');
 assert.equal(heldForOffice({client_stage:'visited_not_asked',review_reason:'(R69)',owner_text:EN_VISIT}),'');
 // wired in: after the visit before the send, in the open window for the marked rows, and in the review after R73
 const a=fu.indexOf('{ const why = heldForOffice(f.data); if (why) {'),s=fu.indexOf('const s = await sendOne(f.data, numbers, true);');
 assert(a>0&&a<s,'held before the send');
 assert(fu.includes('if (/\\((R73|R83)\\)/.test(String(f.review_reason || ""))) { out.in_window_held_marked'));
 assert(fu.indexOf('answeredGuard(out, { group, kind, chat: chatRead')<fu.indexOf('placeGuard(out, { group, kind, chat: chatRead'));
});
