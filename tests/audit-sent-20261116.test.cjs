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
const dsrc=['const THEIR_OFFICE','const ASK_CONFIRM','const WE_SHOW','const MY_OWN','const SILENT_TYPES','const COMMISSION_ASK','const COMMISSION_BUYER_LINES','const COMMISSION_OWNER_LINES','const ASK_LINK','const areaKey','const BOOKING_ASK','const BOOKING_NOT','const ASK_HOUR','const NEEDS_AHMED','const VIDEO_PROMISE','const FAREWELL','const FIXED_PRICE_LINE','const IG_CODE','const UNKNOWN_Q','const LOCATION_ASK','const AREA_REASON','const OUTSIDE_LOOK','const locationForArea','const LOCATION_HELD','const AREA_LINES','const INSIDE_VIDEO_ASK','const LAYOUT_ASK','const LAYOUT_LINES','const OUR_HOUR','const HOUR_SAID','const OWNER_TIME_LINE','const DEPOSIT_SAID','const REASON_Q','const VISIT_Q','const R66_DETAILS_ASK','const R66_GENERIC']
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

// ---- dry run of 16 Nov on rows 513 to 552 of the list (chats of 28 Oct, the published code plus the fixes above) ----
test('R77: a client who names the day for a house the owner lives in gets the owner number, not the name question alone',()=>{
 const LINE='تواصل مع صاحب العقار مباشرة ونسق معه وقت الزيارة',prop={id:'H1',visit_method:'owner_lives'},day={viewing_date:'2026-10-29'};
 const chat=[OUT('رسلت لك بعض التفاصيل'),IN('متى ممكن الزيارة؟'),IN('بكرة ممكن؟')];
 // chat 97963490: «متى ممكن الزيارة؟» «بكرة ممكن؟» came back as «اسمك الكريم ؟» only, and on a second run with «خبرني باليوم والوقت»
 let r=decide(['كم الساعة تقريباً ؟','اسمك الكريم ؟'],chat,day,{prop});
 assert.equal(r.out.action,'send_owner_number');assert.deepEqual(r.texts,[LINE,'اسمك الكريم ؟']);assert.equal(r.out.guard_owner_number_day,true);
 r=decide(['اسمك الكريم ؟','اذا حاب تزور البيت الحين خبرني باليوم والوقت المناسب'],chat,day,{prop});
 assert.equal(r.out.action,'send_owner_number');assert.deepEqual(r.texts,[LINE,'اسمك الكريم ؟']);
 r=decide(['كم الساعة تقريباً يوم السبت ؟'],[IN('السبت ان شاء الله')],day,{prop});assert.equal(r.out.action,'send_owner_number');assert.deepEqual(r.texts,[LINE]);
 r=decide(['ممكن بكره بس','اسمك الكريم ؟'],chat,day,{prop});assert.equal(r.out.action,'send_owner_number');assert.deepEqual(r.texts,[LINE,'اسمك الكريم ؟'],'third run of the same message');
 // left alone: no day named, the model read no visit, another sentence left, the number already went, an open house
 r=decide(['كم الساعة تقريباً ؟','اسمك الكريم ؟'],[IN('متى ممكن الزيارة؟')],day,{prop});assert.equal(r.out.action,'none');assert.deepEqual(r.texts,['اسمك الكريم ؟']);
 r=decide(['اسمك الكريم ؟'],[IN('بكره بسأل البنك')],{},{prop});assert.equal(r.out.action,'none');
 r=decide(['الزيارة تحتاج تنسيق مع المالك قبل يوم','كم الساعة تقريباً ؟'],[IN('بكره')],day,{prop});assert.equal(r.out.action,'none');assert.deepEqual(r.texts,['الزيارة تحتاج تنسيق مع المالك قبل يوم']);
 r=decide(['اسمك الكريم ؟'],[OUT(LINE),IN('بكره ان شاء الله')],day,{prop});assert.equal(r.out.action,'none');
 r=decide(['كم الساعة تقريباً ؟'],[IN('بكره')],day,{prop:{id:'O1',visit_method:'open'}});assert.equal(r.out.action,'none');assert.deepEqual(r.texts,['كم الساعة تقريباً ؟']);
});
test('the name question is not glued inside the visit question; R66 leaves no «تقدر تزيد شوي ؟» behind; a bare thanks gets no branch line',()=>{
 let r=decide(['الكروكي نسلمه للمشتري بعدين','متى يناسبك تزور واسمك الكريم ؟'],[IN('ممكن الكروكي')],{});
 assert.deepEqual(r.texts,['الكروكي نسلمه للمشتري بعدين','متى يناسبك تزور ؟']);
 const c={route:'muscat',available:[{id:'B1',branch_key:'barka',area:'الصومحان الجنوبية'}],prop:{id:'B1',branch_key:'barka'}};
 r=decide(['الاقرب عندنا فيلا في الصومحان الجنوبية بـ69 الف','تقدر تزيد شوي ؟'],[IN('65')],{request:{areas:['مسقط']}},c);
 assert.deepEqual(r.texts,['اول ما يتوفر بتواصل معك']);
 // second run of chat 5b58c79e: the offer came back without «عندنا»
 r=decide(['الفيلا في الصومحان سعرها 69 الف وتحتاج تزيد 4 آلاف'],[IN('65')],{request:{areas:['مسقط']}},c);assert.deepEqual(r.texts,['اول ما يتوفر بتواصل معك']);
 r=decide(['الفيلا في الصومحان سعرها 69 الف'],[OUT('اذا تقبل بركاء عندنا فيلا في الصومحان الجنوبية بـ 69 الف'),IN('كم سعرها')],{},c);assert.deepEqual(r.texts,['الفيلا في الصومحان سعرها 69 الف'],'the office raised it before: R48 answers');
 r=decide(['لا الصومحان في بركاء مو مسقط'],[IN('65')],{},c);assert.deepEqual(r.texts,['لا الصومحان في بركاء مو مسقط'],'a plain answer about the place is not an offer');
 // chat 90f3bf27 (Barka number, a Muscat house): «شكرا» came back as «العفو» with the branch line after it
 assert(agent.includes("} else if (!bKeep && said.length && !hasLine && !bSent && !offer && !(said.length === 1 && /^(العفو|You're welcome)\\s*$/.test(said[0]))) {"));
});

// ---- Ahmed's answers of 16 Nov 2026: R84 (the hour is asked, not named), R85 / SQL106 (confirmation one hour before), R86 (strangers) ----
test('R84: a day with no hour gets «كم الساعة تقريباً ؟», not an hour of ours; the location still goes',()=>{
 const prop={id:'P1',visit_method:'open'},loc={action:'send_location',viewing_time:'16:00'};
 // chats 765fe454 and 42ce77f2 (14 Nov): «بكره» / «بكره الاحد» got «… بكره الساعة 4 العصر»
 let r=decide(['البيت مفتوح تقدرون تشوفونه بكره الساعة 4 العصر'],[OUT('متى يناسبكم تزورون ؟'),IN('بكره')],loc,{prop});
 assert.deepEqual(r.texts,['البيت مفتوح تقدرون تشوفونه بكره','كم الساعة تقريباً ؟']);assert.equal(r.out.action,'send_location');assert.equal(r.out.viewing_time,null);assert.equal(r.out.guard_hour_asked,true);
 r=decide(['تمام بكره 4 العصر البيت مفتوح تقدر تشوفه'],[IN('بكره الاحد')],loc,{prop});assert.deepEqual(r.texts,['تمام بكره البيت مفتوح تقدر تشوفه','كم الساعة تقريباً ؟']);
 // he said the hour or the part of the day himself, he is on his way, the owner arranges it, the location is for the area: untouched
 const keep=['البيت مفتوح تقدر تشوفه بكره الساعة 4 العصر'];
 for(const said of ['بكرة العصر','بكره الساعة 5','باكر العصر، أن شاء الله على ساعة ٥ مناسب','بروح الحين','انا في الطريق']){r=decide(keep,[IN(said)],loc,{prop});assert.deepEqual(r.texts,keep,said);}
 r=decide(keep,[IN('بكره')],{...loc,location_for_area:true},{prop});assert.deepEqual(r.texts,keep);
 r=decide(keep,[IN('بكره')],loc,{prop:{id:'H1',visit_method:'owner_lives'}});assert.deepEqual(r.texts,keep);
 r=decide(keep,[IN('بكره')],{action:'none',category:'seller'},{prop});assert.deepEqual(r.texts,keep);
 // the visit saved with no hour is marked, and its confirmation names the day only
 assert(agent.includes('${time ? "" : " (الساعة ما تحددت)"}'));
 assert(fu.includes('visitWhen(v.viewing_date, HOUR_UNKNOWN.test(String(vn.data?.notes || "")) ? null : v.viewing_time)'));
});
test('R85 / SQL106: the visit confirmation goes one hour before the visit, guarded and mirrored',()=>{
 const f=fs.readFileSync('db/changes/106-visit-confirm-hour-before.forward.sql','utf8').replace(/\r\n/g,'\n'),rb=fs.readFileSync('db/changes/106-visit-confirm-hour-before.rollback.sql','utf8').replace(/\r\n/g,'\n');
 assert.equal(f,fs.readFileSync('supabase/migrations/20261116090000_visit_confirm_hour_before_20261116.sql','utf8').replace(/\r\n/g,'\n'));
 assert(f.includes("<> '2a4692f084801b40138100555fa08aba'"),'refuses a body that changed since SQL70');
 assert(f.includes("now() >= v.visit_at - interval '60 minutes' AND now() < v.visit_at - interval '15 minutes'"));
 assert(f.includes("v.created_at < now() - interval '60 minutes' AND li.last_in < now() - interval '30 minutes'"));
 assert(f.includes("OR (li.last_in + interval '24 hours' < v.visit_at - interval '60 minutes'"),'the window closing earlier keeps the SQL70 moment');
 assert(f.includes("li.last_in + interval '24 hours' > now() + interval '10 minutes'")&&f.includes("m.raw_payload->>'source' = 'visit_confirm'")&&f.includes("m.actor_type = 'human'"));
 assert(f.includes('REVOKE ALL ON FUNCTION public.crm_visit_confirm_candidates() FROM PUBLIC, anon, authenticated;'));
 assert(!rb.includes("interval '60 minutes'")&&rb.includes("li.last_in + interval '24 hours' < v.visit_at + interval '90 minutes'"));
});
test('R86: a stranger opener from a number outside Oman is ignored for good',()=>{
 const S=new Function(pickA('const STRANGER_OPENER','\n')+';return STRANGER_OPENER;')();
 for(const s of ['سيدي الرئيس، هل هذا أنت حقاً؟','هل هذا أنت؟','هل سبق لك أن زرت الصين؟ أعتقد أنني رأيتك من قبل في غوانزو.','Is this really you?'])assert(S.test(s),s);
 for(const s of ['هل هذا البيت متوفر ؟','هل هذا انت اللي عارض البيت في الرميس','السلام عليكم','من معاي تكرما؟'])assert(!S.test(s),s);
 assert(agent.includes('if (STRANGER_OPENER.test(asked) && !/^968/.test(to) && !out.property_id && !history.some((h: any) => h.matched_property_id) && ["general", "unclear", "ignore"].includes(out.category)'));
 assert(agent.includes('out.category = "ignore"; out.ignore_kind = "stranger"; out.guard_stranger = true;'));
 assert(agent.includes('stranger: "رسالة مشبوهة من رقم غريب"'));
});
test('R84 with no location going out, and the last orphan after R66',()=>{
 const prop={id:'P1',visit_method:'open'};
 // the location went earlier in the chat; «بكره» still got an hour of ours
 let r=decide(['تمام ان شاء الله البيت مفتوح تقدرون تشوفونه بكره الساعة 4'],[IN('ممكن الموقع'),OUT('https://maps.app.goo.gl/TEST'),IN('بكره')],{action:'none',viewing_time:'16:00'},{prop});
 assert.deepEqual(r.texts,['تمام ان شاء الله البيت مفتوح تقدرون تشوفونه بكره','كم الساعة تقريباً ؟']);assert.equal(r.out.viewing_time,null);
 // he said an hour earlier in the chat, the line is about yesterday, the line is not about seeing the house: untouched
 const line=['البيت مفتوح تقدر تشوفه بكره الساعة 5'];
 r=decide(line,[IN('بجي الساعة 5'),OUT('تمام'),IN('خلها بكره'),IN('نفس الوقت'),IN('اوكي'),IN('تمام')],{action:'none'},{prop});assert.deepEqual(r.texts,line);
 r=decide(['الزيارة كانت مسجلة أمس الساعة 4','اذا حاب تزور اليوم خبرني'],[IN('ما رحت')],{action:'none'},{prop});assert.equal(r.texts.length,2);assert.equal(r.out.guard_hour_asked,undefined);
 r=decide(['الدوام من الساعة 8 الصبح'],[IN('متى تداومون')],{action:'none'},{prop});assert.deepEqual(r.texts,['الدوام من الساعة 8 الصبح']);
 // fourth run of chat 5b58c79e: «اذا يناسبك تزيدها نرتب لك زيارة» stayed after the Barka offer was taken out
 const c={route:'muscat',available:[{id:'B1',branch_key:'barka',area:'الصومحان الجنوبية'}],prop:{id:'B1',branch_key:'barka'}};
 r=decide(['اقرب شي عندنا فيلا في الصومحان بـ 69 الف','اذا يناسبك تزيدها نرتب لك زيارة'],[IN('65')],{request:{areas:['مسقط']}},c);assert.deepEqual(r.texts,['اول ما يتوفر بتواصل معك']);
});
test('last runs of 16 Nov: the Barka branch line as an offer, and «قبل بيوم» when the day named is ahead',()=>{
 const c={route:'muscat',available:[{id:'B1',branch_key:'barka',area:'الصومحان الجنوبية'}],prop:{id:'B1',branch_key:'barka'}};
 let r=decide(['هذا العقار تتابعه معنا على رقم بركاء 92344273 واتساب','اول ما يتوفر بتواصل معك'],[IN('65')],{request:{areas:['مسقط']}},c);
 assert.deepEqual(r.texts,['اول ما يتوفر بتواصل معك']);
 r=decide(['هذا العقار تتابعه معنا على رقم بركاء 92344273 واتساب'],[OUT('هذا العقار تتابعه معنا على رقم بركاء 92344273 واتساب'),IN('طيب')],{},c);assert.equal(r.texts.length,1,'the line was already said in this chat: R48 decides');
 const LINE='تواصل مع صاحب العقار مباشرة ونسق معه وقت الزيارة',prop={id:'H1',visit_method:'owner_lives'},chat=[IN('متى ممكن الزيارة؟'),IN('بكرة ممكن؟')];
 r=decide(['ممكن بكره بس الزيارة تحتاج تنسيق مع المالك قبل بيوم','اسمك الكريم ؟'],chat,{viewing_date:'2099-01-01'},{prop});
 assert.equal(r.out.action,'send_owner_number');assert.deepEqual(r.texts,[LINE,'اسمك الكريم ؟']);
 r=decide(['الزيارة تحتاج تنسيق مع المالك قبل بيوم'],chat,{viewing_date:'2020-01-01'},{prop});assert.equal(r.out.action,'none','a day that is not ahead still waits');
 r=decide(['بكره صعب، يوم ثاني يناسبك ؟'],chat,{viewing_date:'2099-01-01'},{prop});assert.equal(r.out.action,'none');
});

// ---- R87 / SQL107 (Ahmed 16 Nov 2026): a call is logged by the number, from the home page; the agent leaves that number to the office ----
test('R87 / SQL107: the call by number, the agent stays out of a number the staff called, the button is on the home page',()=>{
 const f=fs.readFileSync('db/changes/107-call-by-number.forward.sql','utf8').replace(/\r\n/g,'\n'),rb=fs.readFileSync('db/changes/107-call-by-number.rollback.sql','utf8');
 assert.equal(f,fs.readFileSync('supabase/migrations/20261116100000_call_by_number_20261116.sql','utf8').replace(/\r\n/g,'\n'));
 assert(f.includes("coalesce(public.my_role(), '') NOT IN ('owner', 'manager', 'agent')"),'staff only');
 assert(f.includes("IF length(d) < 8 OR length(d) > 15 THEN RAISE EXCEPTION 'call_phone_required'"));
 assert(f.includes('crm_repair_private.can_access_client(c, k.id)'),'a client of another branch is not attached');
 assert(f.includes("'call_phone', d, 'call_name', nm, 'source', 'crm_log_call_number'"));
 assert(f.includes('REVOKE ALL ON FUNCTION public.crm_log_call_number(text, text, text, text, text, text, uuid) FROM PUBLIC, anon;'));
 assert(f.includes("a.after_data ->> 'call_kind' IN ('owner', 'advertiser')")&&f.includes("a.occurred_at > now() - interval '14 days'"));
 assert(f.includes('REVOKE ALL ON FUNCTION public.crm_staff_called(uuid, text) FROM PUBLIC, anon, authenticated;'),'the lookup is the agent\'s only');
 assert(rb.includes('DROP FUNCTION IF EXISTS public.crm_staff_called(uuid, text);')&&rb.includes('DROP FUNCTION IF EXISTS public.crm_log_call_number('));
 // the agent: before the model, never on «كمّل يا عقل», nothing written by an inline dry run, handed back when the handoff changed after the call
 const a=agent.indexOf('const called = await db.rpc("crm_staff_called", { p_company: msg.company_id, p_phone: to });');
 assert(a>0&&a<agent.indexOf('// the owner of a property we list writes to us: Ahmed answers owners himself'));
 assert(agent.includes('if (!review && !resume) {\n      const called = await db.rpc("crm_staff_called"'));
 assert(agent.includes('new Date(call.at).getTime() > new Date(conv.handoff_updated_at || 0).getTime()'));
 assert(agent.includes('if (!inline && !(conv.human_handoff_required && mine)) {'));
 assert(agent.includes('await watch(); return fail("staff_called");'));
 // the screen
 const ui=fs.readFileSync('crm-calls-meetings.js','utf8'),index=fs.readFileSync('index.html','utf8');
 assert(ui.includes("document.querySelector('#crmOwnerHome .coh-now')")&&ui.includes('data-ccm="open-number"'));
 assert(ui.includes("supa.rpc('crm_log_call_number',{p_phone:phone,p_name:byId('ccmName').value||'',...common})"));
 assert(ui.includes("supa.rpc('crm_log_call',{p_client:viewingClient.id,...common})"),'the client page keeps its own call');
 assert(index.includes('crm-calls-meetings.js?v=20261117-goal1')&&index.includes('crm-calls-meetings.css?v=20261117-goal1'));
});
test('the dashboard of 16 Nov: one alert per client and kind, a past meeting leaves, the owner sees each person\'s calls',()=>{
 const hot=fs.readFileSync('crm-hot-alerts.js','utf8'),ui=fs.readFileSync('crm-calls-meetings.js','utf8'),index=fs.readFileSync('index.html','utf8');
 assert(hot.includes("if(kind==='meeting'&&day&&day<today)return false;"));
 assert(hot.includes("const key=n.client_id+'|'+kind;if(once.has(key))return false;once.add(key);return true;"));
 assert(hot.indexOf('list.sort((a,b)=>String(b.created_at)')<hot.indexOf('once.has(key)'),'the newest of each client is the one kept');
 assert(ui.includes('if(callsToday&&manages()){')&&ui.includes('اتصالات الموظفين:'));
 assert(index.includes('crm-hot-alerts.js?v=20261116-once1')&&index.includes('crm-calls-meetings.js?v=20261117-goal1'));
});

// ---- R88 / SQL108 (Ahmed 16 Nov 2026): a study by the phone's WhatsApp, an owner we do not price, the priced leave the list ----
test('R88 / SQL108: the study goes by the phone, the pricing list drops what is priced or not ours, the report opens in the chat',()=>{
 const f=fs.readFileSync('db/changes/108-study-sent-by-phone.forward.sql','utf8').replace(/\r\n/g,'\n'),rb=fs.readFileSync('db/changes/108-study-sent-by-phone.rollback.sql','utf8');
 assert.equal(f,fs.readFileSync('supabase/migrations/20261116110000_study_sent_by_phone_20261116.sql','utf8').replace(/\r\n/g,'\n'));
 assert(f.includes("IF st NOT IN ('waiting_owner', 'approved', 'send_failed') THEN RAISE EXCEPTION 'study_not_waiting'"));
 assert(f.includes("jsonb_build_object('action', 'sent_by_phone', 'study_id', p_study_id, 'by', u)"));
 assert(f.includes("IF why IS NULL THEN RAISE EXCEPTION 'reason_required'")&&f.includes("s.status IN ('submitted', 'awaiting_approval', 'approved', 'waiting_owner', 'send_failed')"),'a study already sent is never cancelled');
 assert(f.includes('REVOKE ALL ON FUNCTION public.crm_price_study_sent_by_phone(uuid) FROM PUBLIC, anon;')&&f.includes('REVOKE ALL ON FUNCTION public.crm_price_study_drop(uuid, text) FROM PUBLIC, anon;'));
 assert(rb.includes('DROP FUNCTION IF EXISTS public.crm_price_study_sent_by_phone(uuid);')&&rb.includes('DROP FUNCTION IF EXISTS public.crm_price_study_drop(uuid, text);'));
 const ps=fs.readFileSync('supabase/functions/price-study/index.ts','utf8');
 assert(ps.includes('if (action === "sent_by_phone") {')&&ps.includes('.in("status", ["waiting_owner", "approved", "send_failed"])'));
 assert(ps.includes('const after = conv ? await afterSent(s, conv, now) : ["conversation"];')&&ps.includes('const after = await afterSent(s, conv, now);'),'the phone send closes like the automatic one');
 assert(ps.includes('media_id: (extra as any)?.media?.id ?? null'),'the report sent to the owner opens from the chat');
 assert(!/sentByPhone[\s\S]{0,900}metaSend\(/.test(ps.slice(ps.indexOf('async function sentByPhone'),ps.indexOf('async function afterSent'))),'recording sends nothing');
 const ui=fs.readFileSync('crm-price-studies.js','utf8'),home=fs.readFileSync('crm-owner-home.js','utf8'),index=fs.readFileSync('index.html','utf8');
 assert(ui.includes("(i.status==='waiting_owner'||retry?'<div class=\"cps-phone\">")&&ui.includes('data-cps="phone-done"'));
 assert(ui.includes("'?text='+encodeURIComponent(String(s.owner_message||''))")&&ui.includes("supa.rpc('crm_price_study_sent_by_phone',{p_study_id:id})"));
 assert(ui.includes("window.crmPriceStudyChats=()=>new Set("));
 assert(home.includes("window.crmPriceStudyChats().has(i&&i.conversation_id));")&&home.includes("supa.rpc('crm_price_study_drop',{p_conversation_id:id,p_reason:why.trim()})"));
 assert(index.includes('crm-price-studies.js?v=20261116-ps3')&&index.includes('crm-owner-home.js?v=20261117-snap1'));
});

// ---- R89 (Ahmed 16 Nov 2026, Jehan): the client confirmed a meeting time while the agent stays out → Ahmed's WhatsApp ----
test('R89: a confirmed meeting or call time in a chat the agent stays out of reaches Ahmed on WhatsApp; an open-house visit does not',()=>{
 const src=['const MEET_TALK','const MEET_TIME','const MEET_VISIT','const MEET_YES'].map((s)=>pickA(s,'\n')).join('')+pickA('function meetingConfirmed','\n}\n');
 const M=new Function(src.replace(/(\w+): (?:string|any|unknown|number)(?:\[\])?(?=[,)])/g,'$1')+';return meetingConfirmed;')();
 const O=(b)=>({direction:'outbound',body:b,message_timestamp:'2026-11-16T04:18:00Z'}),I=(b)=>({direction:'inbound',body:b});
 // the real chat fb51edfd, 16 Nov 08:18 and 08:22
 let r=M([I('الصباح ع الساعه 10 كذا'),O('ان شاء الله نتواصل باكر'),O('اهلين صباح الخير'),O('اليوم مناسب للتواصل الساعة 10:00 صباح، صحيح؟'),I('نعم بإذن الله')]);
 assert.equal(r.ours,'اليوم مناسب للتواصل الساعة 10:00 صباح، صحيح؟');assert.equal(r.said,'نعم بإذن الله');assert.equal(r.at,'2026-11-16T04:18:00Z');
 for(const [ours,said] of [['نأكد الاجتماع اونلاين بكره الساعة 5 ؟','تمام 👍'],['تمر المكتب يوم الاحد الساعة 11 ؟','ايوه ان شاء الله'],['اتصل عليك اليوم الساعة 4 العصر ؟','اوكي'],['Meeting online today 10:00 ?','Yes']])assert(M([O(ours),I(said)]),ours);
 r=M([O('الاجتماع بكره الساعة 5 يناسبك ؟'),I('نعم'),I('بإذن الله')]);assert.equal(r.said,'نعم بإذن الله','two short messages are one answer');
 // not a confirmation, not a meeting, a visit to an open house, a long answer, nothing from us
 for(const [ours,said] of [['الاجتماع بكره الساعة 5 يناسبك ؟','لا ما يناسبني'],['الاجتماع بكره الساعة 5 يناسبك ؟','ممكن نخليه الساعة 7'],['البيت مفتوح تقدر تشوفه بكره الساعة 4','تمام'],['نأكد موعد زيارة العقار في بركاء الرميس اليوم الساعة 4 العصر ؟','نعم'],['السعر 59 الف','تمام'],['الاجتماع يناسبك ؟','نعم'],['كم الساعة تقريباً ؟ عشان ارسل لك اللوكيشن','اوكي']])assert.equal(M([O(ours),I(said)]),null,ours+' / '+said);
 assert.equal(M([I('نعم')]),null);assert.equal(M([O('الاجتماع بكره الساعة 5 ؟')]),null);
 // wired where the agent stays out, once per proposal, nothing sent by an inline dry run
 assert(agent.includes('return (await meetingAlert("human_handoff_open")) || fail("human_handoff_open"); }')&&agent.includes('return (await meetingAlert("staff_active")) || fail("staff_active"); }'));
 assert(agent.includes('const key = `meeting_confirmed:${conv.id}:${m.at}`;')&&agent.includes('.eq("payload->>event_key", key).limit(1);'));
 assert(agent.indexOf('if (inline) return json({ ok: true, inline: true, ignored: why, meeting_confirmed_alert: text });')<agent.indexOf('action: "notify_owner", company_id: msg.company_id, route_key: conv.route_key'));
});

// ---- R90 (Ahmed 16 Nov 2026): the owner answered the template that she no longer wants the study, and it went to her anyway ----
test('R90: an owner who says he no longer wants the study, sold the property or asks us not to send gets nothing; Ahmed is told',()=>{
 const ps=fs.readFileSync('supabase/functions/price-study/index.ts','utf8').replace(/\r\n/g,'\n');
 const pk=(start)=>{const a=ps.indexOf(start);assert(a>=0,start);return ps.slice(a,ps.indexOf('\n',a)+1);};
 const declined=new Function((pk('const SAID_NO')+pk('const OWNER_DECLINED')+pk('const ownerDeclined')).replace(/\(t: unknown\)/,'(t)')+';return ownerDeclined;')();
 // the real answer of chat dee610c9, 16 Nov 08:44
 assert.equal(declined('أهلين أختي الله يسلمك، أنا غيرت رأيي خلاص ما أحتاجه، يعطيكم العافية'),true);
 for(const s of ['لا','لا شكرا','خلاص بعته','الارض انباعت','لا ترسلها','ما ابغى الدراسة','ما عاد احتاجها','الغي الدراسة','سحبت العرض','ما ناوي ابيع الحين'])assert.equal(declined(s),true,s);
 for(const s of ['نعم ارسلها','ايوا لو سمحت','شخباركم','تمام','ارسلها الله يعطيك العافية','وعليكم السلام ارسل','ابيها اليوم اذا ممكن',''])assert.equal(declined(s),false,s);
 assert(ps.includes('&& ownerDeclined(msg.transcript || msg.body)) {'));
 assert(ps.indexOf('ownerDeclined(msg.transcript || msg.body)')<ps.indexOf('return await sendStudy(waiting.id, "waiting_owner");'),'checked before the study is sent');
 assert(ps.includes('send_error: "owner_said_no_to_the_template"'));
});
