'use strict';
// 19 Nov 2026, from the first reply audit (Ahmed: «موافق، سجّلها»): R116 and R117.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const agent=fs.readFileSync('supabase/functions/whatsapp-reply-agent/index.ts','utf8').replace(/\r\n/g,'\n');
const pickFrom=(src)=>(start,end)=>{const a=src.indexOf(start);assert(a>=0,'missing: '+start);const b=src.indexOf(end,a);assert(b>a,'no end: '+start);return src.slice(a,b+end.length);};
const pickA=pickFrom(agent);
const dsrc=['const THEIR_OFFICE','const ASK_CONFIRM','const WE_SHOW','const MY_OWN','const SILENT_TYPES','const COMMISSION_ASK','const COMMISSION_BUYER_LINES','const COMMISSION_OWNER_LINES','const ASK_LINK','const areaKey','const BOOKING_ASK','const BOOKING_NOT','const ASK_HOUR','const NEEDS_AHMED','const VIDEO_PROMISE','const FAREWELL','const FIXED_PRICE_LINE','const IG_CODE','const UNKNOWN_Q','const LOCATION_ASK','const AREA_REASON','const OUTSIDE_LOOK','const locationForArea','const LOCATION_HELD','const AREA_LINES','const INSIDE_VIDEO_ASK','const LAYOUT_ASK','const LAYOUT_LINES','const OUR_HOUR','const HOUR_SAID','const OWNER_TIME_LINE','const DEPOSIT_SAID','const REASON_Q','const VISIT_Q','const R66_DETAILS_ASK','const R66_GENERIC']
 .map((s)=>pickA(s,'\n')).join('')+pickA('const PROJECT_MEDIA_ASK','\n')+pickA('function nearBarka','\n}\n')+pickA('function soldNoticeYes','\n}\n')+pickA('function ownerDecisions','\n}\n');
// (19 Nov: ownerDecisions now has «(… ) as any[]» casts, so the TypeScript casts are taken out too)
const D=new Function(dsrc.replace(/(\w+): (?:string|any|unknown|number)(?:\[\])?(?=[,)])/g,'$1').replace(/\) as (?:any|string|number)(?:\[\])?\)/g,'))').replace(/\): string\[\] \| null \{/g,') {')+';return {ownerDecisions};')();
const IN=(b,type)=>({direction:'inbound',body:b,message_type:type||'text'}),OUT=(b)=>({direction:'outbound',body:b});
const decide=(texts,history,out,c)=>{const o={action:'none',category:'buyer',...(out||{})};const burst=[];for(const h of history){if(h.direction==='outbound')burst.length=0;else if(h.body)burst.push(h.body);}
 const t=D.ownerDecisions(o,texts,{history,burstSaid:burst.join(' '),prop:null,visitedProp:false,visitedAny:false,saidVisited:false,handoffOpen:false,hardHandoff:false,...(c||{})});return {out:o,texts:t};};
const RUMAIS={id:'p1',map_url:'https://maps.app.goo.gl/As6gtsQ8QLjcZG3r5',visit_method:'open',video:'https://www.instagram.com/reel/DfrPGgoCOOp/'};

test('R116: an available home offered with no question gets its reel and the visit question (799202aa «ارسلي اشوف»)',()=>{
 const ad='عندنا فيلا في الصومحان الجنوبية بركاء بـ 69 الف متوفره\nواجهة واسعة ومساحة الأرض 400م² مع ارتداد أمامي 15 متر يوفر مساحة ممتازة للمواقف\nالفيلا مكونة من طابقين';
 const h=[OUT('بخصوص الفيلا اللي سألت عنها في بركاء الرميس انحجزت\nتحب تشوف خيارات ثانية ؟'),IN('ارسلي اشوف')];
 const r=decide([ad],h,null,{prop:{...RUMAIS,status:'available'}});
 assert.equal(r.out.guard_offer_question,true);
 assert.deepEqual(r.texts,[ad,RUMAIS.video,'متى يناسبك تزور ؟']);
 // the reel already sent in this chat is not sent again; a reply with a question, a tenant, a visited home: untouched
 assert.deepEqual(decide([ad],[OUT(RUMAIS.video),...h],null,{prop:RUMAIS}).texts,[ad,'متى يناسبك تزور ؟']);
 // the model asked the question itself: the reel goes before it (dry run of 799202aa on the branch)
 assert.deepEqual(decide([ad,'تحب تشوفها ؟'],h,null,{prop:RUMAIS}).texts,[ad,RUMAIS.video,'تحب تشوفها ؟']);
 assert.deepEqual(decide([ad,'تحب تشوفها ؟'],[OUT(RUMAIS.video),...h],null,{prop:RUMAIS}).texts,[ad,'تحب تشوفها ؟']);
 assert.equal(decide([ad],h,{category:'tenant'},{prop:RUMAIS}).out.guard_offer_question,undefined);
 assert.equal(decide([ad],h,null,{prop:RUMAIS,visitedProp:true}).out.guard_offer_question,undefined);
 assert.equal(decide(['تمام'],h,null,{prop:RUMAIS}).out.guard_offer_question,undefined);
});
test('R116: «اسمك الكريم ؟ ومتى يناسبك تزور ؟» becomes the visit question, then the name question (c53c9aee)',()=>{
 const r=decide(['بـ59 الف ما متوفر الحين الصراحة','فيلا للبيع في الصومحان جنوب','اسمك الكريم ؟ ومتى يناسبك تزور ؟'],[IN('زين اذا عندك خيارات ثانية ارسلي إذا ما عليك امر')]);
 assert.equal(r.out.guard_name_after_q,true);
 assert.deepEqual(r.texts.slice(-2),['متى يناسبك تزور ؟','اسمك الكريم ؟']);
});
test('R117: the pitch sentences of a reel caption are not sent (da239273)',()=>{
 const src=pickA('function publicText','\n}\n')+pickA('const CTA_RE','\n')+pickA('const AD_PITCH_RE','\n');
 const publicText=new Function(src.replace(/(\w+): (?:string|any|unknown|number)(?:\[\])?(?=[,)])/g,'$1')+';return publicText;')();
 const t=publicText('فيلا للبيع في الصومحان الجنوبية بركاء\n• حوش واسع للمواقف\nالباقي فلتين بس واللي يسبق يختار. تبي الموقع أو التفاصيل كاملة أو ترتيب معاينة؟ راسلني واتساب على 99999999 وأرد عليك على طول.');
 assert.equal(t,'فيلا للبيع في الصومحان الجنوبية بركاء\n• حوش واسع للمواقف');
 assert.equal(publicText('مجلس بمدخل خارجي. مطبخ راكب.'),'مجلس بمدخل خارجي. مطبخ راكب.');
});
test('R115: a yes to «انحجزت … خيارات ثانية» answered with «ما متوفر» only gets the nearest home (799202aa, one dry run of three)',()=>{
 const h=[OUT('بخصوص الفيلا اللي سألت عنها في بركاء الرميس انحجزت\nتحب تشوف خيارات ثانية ؟'),IN('ارسلي اشوف')];
 const av=[{id:'p9',type:'villa',area:'الصومحان الجنوبية',price:69000,branch_key:'barka',listing_purpose:'sale'}];
 const r=decide(['حاليا ما عندنا فيلا متوفره في الرميس','اول ما يتوفر بتواصل معك'],h,null,{available:av,route:'barka'});
 assert.equal(r.out.guard_sold_yes_nothing,true);assert.equal(r.out.property_id,'p9');
 assert.deepEqual(r.texts,['اقرب شي عندنا في الصومحان الجنوبية فيلا بـ69 الف','تحب ارسلك تفاصيلها ؟']);
 // «لا مشكور», or no sold notice before it: untouched
 assert.equal(decide(['حاليا ما عندنا فيلا متوفره في الرميس'],[h[0],IN('لا مشكور')],null,{available:av,route:'barka'}).out.guard_sold_yes_nothing,undefined);
 assert.equal(decide(['حاليا ما عندنا فيلا متوفره في الرميس'],[IN('عندكم فيلا في الرميس ؟')],null,{available:av,route:'barka'}).out.guard_sold_yes_nothing,undefined);
});
test('R115: «ما متوفر … اول ما يتوفر» with a visit question and nothing to visit gets the nearest home too (live check of v103)',()=>{
 const h=[OUT('بخصوص الفيلا اللي سألت عنها في بركاء الرميس انحجزت\nتحب تشوف خيارات ثانية ؟'),IN('ارسلي اشوف')];
 const av=[{id:'p9',type:'villa',area:'الصومحان الجنوبية',price:69000,branch_key:'barka',listing_purpose:'sale'}];
 const r=decide(['حالياً ما متوفر فيلا للبيع في الرميس بالمواصفات اللي طلبتها','اول ما يتوفر بتواصل معك','متى يناسبك تزور ؟'],h,null,{available:av,route:'barka'});
 assert.equal(r.out.guard_sold_yes_nothing,true);
 assert.deepEqual(r.texts,['اقرب شي عندنا في الصومحان الجنوبية فيلا بـ69 الف','تحب ارسلك تفاصيلها ؟']);
});
test('«عارض بيت للبيع في حي عاصم كم مطلوب» is a buyer asking our price, not an owner (Ahmed 23 Nov, 743468e3)',()=>{
 const owner=['وعليكم السلام ورحمة الله وبركاته','اسمك الكريم ؟','ارسل تفاصيل البيت كاملة والمستندات والسعر اللي في بالك اذا ما عليك امر'];
 const r=decide(owner,[IN('سلام عليكم ورحمة الله وبركاته \nعارض بيت للبيع في حي عاصم كم مطلوب')],{category:'seller'});
 assert.equal(r.out.category,'buyer');assert.equal(r.out.guard_our_price,true);
 assert(!r.texts.some((t)=>/المستندات/.test(t)));
 // an owner saying the house is his stays an owner
 assert.equal(decide(owner,[IN('عندي بيت عارضه للبيع في الرميس كم ممكن يجيب')],{category:'seller'}).out.category,'seller');
});
test('R118: an attachment WhatsApp could not show gets «ارسلها مرة ثانية» once (reply audit 22 Nov, cc5cd665)',()=>{
 const ask='الرسالة ما وضحت عندي ارسلها مرة ثانية اذا ما عليك امر';
 const r=decide([],[IN('','unsupported')],null,{msgType:'unsupported'});
 assert.deepEqual(r.texts,[ask]);assert.equal(r.out.guard_unsupported_ask,true);
 // asked already in this chat: silent as before; a reaction or a deleted message: silent as before
 assert.deepEqual(decide([],[OUT(ask),IN('','unsupported')],null,{msgType:'unsupported'}).texts,[]);
 assert.deepEqual(decide(['تمام'],[IN('','reaction')],null,{msgType:'reaction'}).texts,[]);
});
test('R120: an investor asking for videos or ads gets the project reel before the invitation (8930e472)',()=>{
 const inv=['بما انك حاليا في قطر الافضل نرتب لك اجتماع اونلاين مع المطور الأهلي صبور ونعرض لك الوحدات المتوفرة والتفاصيل','يناسبك ؟'];
 const reel='https://www.instagram.com/reel/DYRkEv2iDun/';
 const r=decide(inv,[IN('مبدأيا ممكن ترسل اذا معاك تصوير او اعلانات')],{category:'investor'},{projectReel:reel});
 assert.deepEqual(r.texts,['هذا فيديو عن المشروع\n'+reel,...inv]);
 assert.equal(decide(inv,[IN('تمام')],{category:'investor'},{projectReel:reel}).out.guard_project_reel,undefined);
});
test('R122: a nearest offer with no question gets «تقدر تزيد شوي ؟» or «تناسبك ؟» (63d66ac1)',()=>{
 const t=['وعليكم السلام ورحمة الله وبركاته','حالياً ما متوفر شقة للايجار في العذيبة بحدود 150 ريال','اقرب شقة عندنا في مدينة السلطان قابوس غرفة بـ250 ريال بالشهر والايجار من 6 شهور وطالع'];
 assert.equal(decide(t,[IN('هل متوفر شقق للايجار في العذيبة ؟ بسعر ١٥٠ ريال')],{category:'tenant'}).texts.at(-1),'تقدر تزيد شوي ؟');
 assert.equal(decide(['اقرب شي عندنا في الصومحان الجنوبية فيلا بـ69 الف'],[IN('عندكم فلل ؟')],{category:'buyer'}).texts.at(-1),'تناسبك ؟');
 assert.equal(decide([...t,'تناسبك ؟'],[IN('شقة ؟')],{category:'tenant'}).out.guard_nearest_question,undefined);
});
test('R123: «how can we view it ?» about an open house is answered, not handed over (a31871de)',()=>{
 const r=decide([],[IN('If under construction then how can we view it ?')],{action:'handoff',handoff_reason:'سؤال ما عندي جوابه: كيف يعاين'},{prop:{id:'p3',visit_method:'open'}});
 assert.equal(r.out.action,'none');assert.deepEqual(r.texts,['The house is open, you can visit it anytime','When would you like to visit?']);
 assert.equal(decide([],[IN('كيف نشوفه ؟')],{action:'handoff',handoff_reason:'سؤال ما عندي جوابه: x'},{prop:{id:'p3',visit_method:'lockbox'}}).out.action,'handoff');
});
test('R125: a room in Bidiya (English) gets the Muscat and Barka line in English (61597a60)',()=>{
 const r=decide(['For Muscat we have a one bedroom apartment in Sultan Qaboos City for 250 per month','May I know your name?'],[IN('Do you have a room in muscut bidiya')],{category:'tenant'});
 assert.deepEqual(r.texts,['Sorry, we currently work in Muscat and Barka only']);assert.equal(r.out.guard_far_request,true);
});
test('R121 and R124 are in the agent',()=>{
 assert(agent.includes('const MEET_ASK_CLIENT'));assert(agent.includes('out.guard_meet_ask = true'));
 assert(agent.includes('texts = ["للإيجار ولا للشراء ؟"]; out.guard_ask_purpose = true;'));
});
