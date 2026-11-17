'use strict';
// 17 Nov 2026, audit of the replies really sent from 16 Nov 12:20 (Ahmed: «إيه صلّحهم»). Each case is the real chat; all
// were still wrong when run again on v85 (inline dry run, nothing sent). Held by code in ownerDecisions and watchVisit.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const agent=fs.readFileSync('supabase/functions/whatsapp-reply-agent/index.ts','utf8').replace(/\r\n/g,'\n');
const pickFrom=(src)=>(start,end)=>{const a=src.indexOf(start);assert(a>=0,'missing: '+start);const b=src.indexOf(end,a);assert(b>a,'no end: '+start);return src.slice(a,b+end.length);};
const pickA=pickFrom(agent);
const dsrc=['const THEIR_OFFICE','const ASK_CONFIRM','const WE_SHOW','const MY_OWN','const SILENT_TYPES','const COMMISSION_ASK','const COMMISSION_BUYER_LINES','const COMMISSION_OWNER_LINES','const ASK_LINK','const areaKey','const BOOKING_ASK','const BOOKING_NOT','const ASK_HOUR','const NEEDS_AHMED','const VIDEO_PROMISE','const FAREWELL','const FIXED_PRICE_LINE','const IG_CODE','const UNKNOWN_Q','const LOCATION_ASK','const AREA_REASON','const OUTSIDE_LOOK','const locationForArea','const LOCATION_HELD','const AREA_LINES','const INSIDE_VIDEO_ASK','const LAYOUT_ASK','const LAYOUT_LINES','const OUR_HOUR','const HOUR_SAID','const OWNER_TIME_LINE','const DEPOSIT_SAID','const REASON_Q','const VISIT_Q','const R66_DETAILS_ASK','const R66_GENERIC']
 .map((s)=>pickA(s,'\n')).join('')+pickA('function nearBarka','\n}\n')+pickA('function ownerDecisions','\n}\n');
const D=new Function(dsrc.replace(/(\w+): (?:string|any|unknown|number)(?:\[\])?(?=[,)])/g,'$1')+';return {ownerDecisions};')();
const IN=(b,type)=>({direction:'inbound',body:b,message_type:type||'text'}),OUT=(b)=>({direction:'outbound',body:b});
const decide=(texts,history,out,c)=>{const o={action:'none',category:'buyer',...(out||{})};const burst=[];for(const h of history){if(h.direction==='outbound')burst.length=0;else if(h.body)burst.push(h.body);}
 const t=D.ownerDecisions(o,texts,{history,burstSaid:burst.join(' '),prop:null,visitedProp:false,visitedAny:false,saidVisited:false,handoffOpen:false,hardHandoff:false,...(c||{})});return {out:o,texts:t};};
const RUMAIS={id:'p1',map_url:'https://maps.app.goo.gl/As6gtsQ8QLjcZG3r5',visit_method:'open',video:'https://www.instagram.com/reel/DfrPGgoCOOp/'};

test('R11: the location asked with the day goes now (401f1402 «امر ليوم»)',()=>{
 const h=[OUT('اقرب شي عندنا في الرميس 59 الف'),IN('ممكن ترسلي اذا صور'),IN('وزين ترسلي الموقع بحاول باذن الله امر ليوم')];
 const r=decide(['الصور ما متوفره عندنا هذا رابط الفيديو','https://www.instagram.com/reel/DfrPGgoCOOp/','متى يناسبك تزور ؟'],h,null,{prop:RUMAIS});
 assert.equal(r.out.action,'send_location');assert.equal(r.out.guard_location_day,true);
 assert.deepEqual(r.texts,['الصور ما متوفره عندنا هذا رابط الفيديو','https://www.instagram.com/reel/DfrPGgoCOOp/']);
 // dry run on the branch: «… خبرني عشان ارسل لك الموقع» does not stay beside the location
 assert.deepEqual(decide(['اذا تأكدت من الوقت يوم الخميس خبرني عشان ارسل لك الموقع'],[IN('اريد اعرف الموقع اول حاجه يمكن السبت')],null,{prop:RUMAIS}).texts,['تفضل هذا الموقع']);
 // not when the day does not work, not without a location ask, not for a house the owner lives in, not when it went already
 assert.equal(decide(['تمام'],[IN('ارسل الموقع بس اليوم ما اقدر')],null,{prop:RUMAIS}).out.action,'none');
 assert.equal(decide(['تمام'],[IN('بمر اليوم')],null,{prop:RUMAIS}).out.action,'none');
 assert.equal(decide(['تمام'],[IN('ارسل الموقع بجي بكره')],null,{prop:{...RUMAIS,visit_method:'owner_lives'}}).out.action,'none');
 assert.equal(decide(['تمام'],[OUT(RUMAIS.map_url),IN('ارسل الموقع بجي بكره')],null,{prop:RUMAIS}).out.action,'none');
 // «اليوم» inside another word is no day
 assert.equal(decide(['تمام'],[IN('ارسل الموقع واليومية كم')],null,{prop:RUMAIS}).out.action,'none');
});
test('R74: «أبغى أشوف وين عن الشارع، وإذا ناسبني بزور» gets the location to judge the area (f6bcc8ac)',()=>{
 const h=[IN('ممكن لوكيشن هذي الڤلل'),OUT('ان شاء الله برسلك الموقع\nمتى يناسبك تزور ؟'),IN('بس أرسل لي الموقع، أبغى أشوف وين عن الشارع وكذا، وإذا ناسبني إن شاء الله بزور المكان')];
 const r=decide(['اللوكيشن نرسله قبل الزيارة عشان نتأكد إن العقار لسا متاح وما تتعنى على الفاضي','متى يناسبك تزور ؟'],h,null,{prop:RUMAIS});
 assert.equal(r.out.action,'send_location');assert.equal(r.out.location_for_area,true);
 assert.deepEqual(r.texts,['تفضل هذا الموقع','شوف اذا المنطقة تناسبك وخبرني متى يناسبك تزور']);
 // 5161592b on the branch: the model's own «شوف الموقع اول واذا ناسبك خبرني» is not said before the same two lines
 const r2=decide(['تمام شوف الموقع اول واذا ناسبك خبرني'],[IN('ممكن موقعه الفلة اخي'),OUT('ان شاء الله برسلك الموقع'),IN('بس اريد اتاكد من لوكيش اذا مناسب لي او لا')],null,{prop:RUMAIS});
 assert.deepEqual(r2.texts,['تفضل هذا الموقع','شوف اذا المنطقة تناسبك وخبرني متى يناسبك تزور']);
});
test('a client who only arrived is not asked his opinion (007be129 «هذا هو», e06229f1 «جالس أشوفها»)',()=>{
 let r=decide(['حياك الله وايش انطباعك بعد ما شفتها ؟'],[OUT('تمام ان شاء الله'),IN('','image'),IN('هذا هو')]);
 assert.deepEqual(r.texts,['حياك الله خذ راحتك']);assert.equal(r.out.guard_arrived,true);
 r=decide(['كيف شفتها ؟'],[OUT('البيت مفتوح'),IN('أنا موجود حالياً في الفيلا. جالس أشوفها')]);
 assert.deepEqual(r.texts,['حياك الله خذ راحتك']);
 // he asks to go in: the open house is said (dry run on the branch)
 r=decide(['السعر 59 الف','وايش انطباعك ؟'],[IN('أنا موجود جنب الفيلا. إذا تأذن لي إني أدخل أشوف الفيلا')],null,{prop:RUMAIS});
 assert.deepEqual(r.texts,['السعر 59 الف','البيت مفتوح تفضل']);
 // dry run rows 777-816: «انا واصل»
 assert.deepEqual(decide(['حياك الله وايش انطباعك بعد ما شفتها ؟'],[OUT('البيت مفتوح'),IN('انا واصل')]).texts,['حياك الله خذ راحتك']);
 // rows 930-969: «انا قريبه», a photo, «هذا البيت» after «الاستاذ احمد وصل وينتظرك هناك»
 assert.deepEqual(decide(['حياك الله وايش انطباعك بعد ما شفتها ؟','اسمك الكريم ؟'],[OUT('الاستاذ احمد وصل وينتظرك هناك'),IN('انا قريبه'),IN('','image'),IN('هذا البيت')]).texts,['حياك الله','اسمك الكريم ؟']);
 // «هذا البيت» with an ad picture and no visit on our side is not an arrival
 assert.deepEqual(decide(['وايش انطباعك عنه ؟'],[OUT('مرحبتين تفضل'),IN('','image'),IN('هذا البيت')]).texts,['وايش انطباعك عنه ؟']);
 // after he saw it the question stays
 assert.deepEqual(decide(['وايش انطباعك ؟'],[OUT('حياك الله'),IN('وصلت وشفتها حلوة')]).texts,['وايش انطباعك ؟']);
 assert.deepEqual(decide(['كيف شفت فيلا الرميس ؟'],[OUT('حياك الله'),IN('خلصت الزيارة')]).texts,['كيف شفت فيلا الرميس ؟']);
});
test('the same «which property» ask is not sent twice: the second goes to Ahmed (4736075f)',()=>{
 const h=[IN('كم مساحة البناء لهذا البيت ؟'),IN('','video'),OUT('اكتب لي المنطقة او السعر اللي في الاعلان اذا ما عليك امر'),IN('السعر موجود في الفيديو اللي رسلته لك')];
 const r=decide(['اكتب لي السعر اللي ظاهر في الفيديو او المنطقة اذا ما عليك امر'],h);
 assert.deepEqual(r.texts,[]);assert.equal(r.out.action,'handoff');assert.match(r.out.handoff_reason,/^ما عرفنا: العميل أرسل العقار/);
 // the first ask stays
 assert.deepEqual(decide(['اكتب لي المنطقة او السعر اللي في الاعلان اذا ما عليك امر'],[IN('','video'),IN('كم السعر')]).texts,['اكتب لي المنطقة او السعر اللي في الاعلان اذا ما عليك امر']);
 // a known property is answered, never handed over for this
 assert.equal(decide(['اكتب لي السعر'],h,null,{prop:RUMAIS}).out.action,'none');
});
test('«بكم تعرض البيت للبيع ؟» is a buyer asking our price, not an owner (247f8277)',()=>{
 const r=decide(['وعليكم السلام ورحمة الله وبركاته','الحمدلله','ارسل تفاصيل البيت كاملة والسعر اللي في بالك اذا ما عليك امر'],[IN('سلام عليكم اخي كيف الحال'),IN('اخي بكم تعرض البيت للبيع'),IN('؟')],{category:'seller'});
 assert.equal(r.out.category,'buyer');
 assert.deepEqual(r.texts,['وعليكم السلام ورحمة الله وبركاته','الحمدلله','ارسل لي رابط الفيديو او صورة منه عشان ارسلك التفاصيل والسعر بالضبط']);
 // dry run on the branch: a model line about valuation does not ride along with the greeting
 assert.deepEqual(decide(['وعليكم السلام ورحمة الله وبركاته','الحمدلله التثمين تبيه للبنك ولا تبي تعرف سعر السوق ؟'],[IN('بكم تعرض البيت للبيع')],{category:'seller'}).texts,
  ['وعليكم السلام ورحمة الله وبركاته','ارسل لي رابط الفيديو او صورة منه عشان ارسلك التفاصيل والسعر بالضبط']);
 // an owner who says the house is his stays an owner
 assert.equal(decide(['ارسل التفاصيل'],[IN('عندي بيت بكم تعرضونه للبيع')],{category:'seller'}).out.category,'seller');
});
test('«موجود جنب الفيلا» is a visit now: saved at the current hour, not 16:00 (e06229f1)',()=>{
 const line=agent.split('\n').find((l)=>l.includes('const immediate ='));
 const re=new RegExp(line.match(/const immediate = \/(.*?)\/\.test\(lastIn\)/)[1]);
 assert(re.test('أنا موجود جنب الفيلا. إذا تأذن لي إني أدخل أشوف الفيلا'));
 assert(re.test('واقف عند البيت'));
 assert(!re.test('بمر بكره العصر'));
});
test('dry run rows 701-740: the property she named by area and price is not called sold (2abc2e0b)',()=>{
 const available=[{id:'h59',branch_key:'barka',area:'بركاء الرميس',price:59000},{id:'s69',branch_key:'barka',area:'الصومحان الجنوبية',price:69000}];
 const h=[IN('ممكن الموقع'),OUT('موقع ايش ؟'),IN('فلة الرميس اللي ب59 الف')];
 const r=decide(['الفيلا اللي سألتي عنها انباعت','بس عندنا فيلا ثانية في الرميس بـ 59 الف متوفرة حالياً','اسمك الكريم ؟ ومتى يناسبك تزورين ؟'],h,null,{available,route:'barka'});
 assert.deepEqual(r.texts,['عندنا فيلا في الرميس بـ 59 الف متوفرة حالياً','اسمك الكريم ؟ ومتى يناسبك تزورين ؟']);assert.equal(r.out.property_id,'h59');
 // live check after v91: «سألتِ» with a kasra
 assert.deepEqual(decide(['الفيلا اللي سألتِ عنها انباعت','بس عندنا فيلا ثانية في الرميس بـ 59 الف متوفره حالياً'],h,null,{available,route:'barka'}).texts,['عندنا فيلا في الرميس بـ 59 الف متوفره حالياً']);
 // with an ad sent (the sold one) the line stays
 const withAd=[IN('https://www.instagram.com/reel/DfeJC4ICmTO/'),IN('فلة الرميس اللي ب59 الف')];
 assert.equal(decide(['الفيلا اللي سألتي عنها انباعت','بس عندنا فيلا ثانية في الرميس بـ 59 الف'],withAd,null,{available,route:'barka'}).texts[0],'الفيلا اللي سألتي عنها انباعت');
 // another price: nothing changes
 assert.equal(decide(['الفيلا اللي سألتي عنها انباعت','بس عندنا فيلا ثانية'],[IN('فلة الرميس اللي ب75 الف')],null,{available,route:'barka'}).texts[0],'الفيلا اللي سألتي عنها انباعت');
});
test('dry run rows 701-740: the waiting-list line goes when something is offered; the full ad keeps the visit question',()=>{
 const r=decide(['الفيلا اللي سألت عنها ما متوفره حالياً','اول ما يتوفر بتواصل معك\nبس عندنا بيت في الحيل الجنوبية بـ 130 الف تحب ارسلك تفاصيله ؟'],[IN('نعم')]);
 assert.deepEqual(r.texts,['الفيلا اللي سألت عنها ما متوفره حالياً','بس عندنا بيت في الحيل الجنوبية بـ 130 الف تحب ارسلك تفاصيله ؟']);
 assert.deepEqual(decide(['الفيلا اللي سألت عنها ما متوفره حالياً','اول ما يتوفر بتواصل معك'],[IN('نعم')]).texts,['الفيلا اللي سألت عنها ما متوفره حالياً','اول ما يتوفر بتواصل معك']);
 const ad='للبيع توين فيلا في الرميس بركاء\n'+'تفاصيل '.repeat(40).trim();
 assert.deepEqual(decide(['الفيلا اللي سألت عنها انباعت',ad,'متى يناسبك تزور ؟'],[IN('ارسل التفاصيل')]).texts,['الفيلا اللي سألت عنها انباعت',ad,'متى يناسبك تزور ؟']);
});
test('dry run rows 711-776: the name question is not glued to the sold line; the next owner questions are not announced',()=>{
 const ad='للبيع توين فيلا في الرميس بركاء\n'+'تفاصيل '.repeat(40).trim();
 let r=decide(['الفيلا اللي سألت عنها انباعت واسمك الكريم ؟','بس عندنا فيلا ثانية في الرميس بـ 59 الف\n'+ad,'متى يناسبك تزور ؟'],[IN('ارسل التفاصيل')]);
 assert.deepEqual(r.texts,['الفيلا اللي سألت عنها انباعت','بس عندنا فيلا ثانية في الرميس بـ 59 الف\n'+ad,'اسمك الكريم ؟','متى يناسبك تزور ؟']);
 // a short line that is only a greeting with the name stays
 assert.deepEqual(decide(['تشرفنا واسمك الكريم ؟'],[IN('هلا')]).texts,['تشرفنا واسمك الكريم ؟']);
 r=decide(['اسمك الكريم ؟','ارسل الملكية والكروكي وشهادة اتمام البناء اذا ما عليك امر','وبعدها نسألك عن سكن المالك والرهن'],[IN('فيديو توضيحي للوصول منطقة جديدة')],{category:'seller'});
 assert.deepEqual(r.texts,['اسمك الكريم ؟','ارسل الملكية والكروكي وشهادة اتمام البناء اذا ما عليك امر']);
});
test('dry run rows 777-816: no visit question after the ad when the reply says the property is gone and offers nothing',()=>{
 const line=agent.split('\n').find((l)=>l.includes('const goneOnly ='));
 const goneOnly=new Function('texts',line.trim().replace(/^const goneOnly = /,'return ').replace(/;$/,''));
 assert.equal(goneOnly(['وعليكم السلام ورحمة الله وبركاته','الفيلا اللي ارسلتها ما متوفره حالياً']),true);
 assert.equal(goneOnly(['الفيلا اللي سألت عنها انباعت','بس عندنا فيلا ثانية في الرميس بـ 59 الف']),false);
 assert.equal(goneOnly(['الفيلا متوفرة حالياً']),false);
 assert(agent.includes('!asksVisit && !goneOnly && out.action === "none"'));
});
test('dry run rows 817-852: «بروم» / «لبرووم» get the prompt line',()=>{
 const P='ارسل على الفيديو نفسه في الانستجرام وراح يوصلك البرومبت';
 assert.deepEqual(decide(['اكتب لي طلبك اذا ما عليك امر'],[IN('بروم')],{category:'general'}).texts,[P]);
 assert.deepEqual(decide(['وعليكم السلام ورحمة الله وبركاته','تقصد البرومبت ولا عرض عقاري ؟','اسمك الكريم ؟'],[IN('سلام عليكم ممكن لبرووم')],{category:'general'}).texts,['وعليكم السلام ورحمة الله وبركاته',P]);
 // rows 853-892: «ماذا اقوول لشات جي بي تي» as a first message; once the line went, the brain answers what follows
 assert.deepEqual(decide([],[IN('ماذا اقوول لشات جي بي تي')],{category:'general'}).texts,[P]);
 assert.deepEqual(decide([],[OUT(P),IN('ماذا اقوول لشات جي بي تي')],{category:'general'}).texts,[]);
 // a word that only starts the same is not it
 assert.deepEqual(decide(['تفضل'],[IN('برومو العقار وصل ؟')],{category:'general'}).texts,['تفضل']);
});
test('rows 930-969: a location asked for a property nobody named gets the R23 question, not «تمام» alone',()=>{
 const r=decide(['تمام'],[IN('','image'),OUT('بتزورها اليوم ؟'),IN('اشوف الموقع اخي اذا ناسبني بزورها')]);
 assert.deepEqual(r.texts,['اكتب لي المنطقة او السعر اللي في الاعلان اذا ما عليك امر']);assert.equal(r.out.guard_location_which,true);
 // with the property known, R74 sends the location
 assert.equal(decide(['تمام'],[IN('اشوف الموقع اخي اذا ناسبني بزورها')],null,{prop:RUMAIS}).out.action,'send_location');
 // a real answer is left alone
 assert.deepEqual(decide(['ارسل لي رابط الفيديو'],[IN('ممكن الموقع')]).texts,['ارسل لي رابط الفيديو']);
});
test('rows 1046-1085: «مسكونه سنه» (how long it was lived in) gets the R91 question, not the apology',()=>{
 const line=agent.split('\n').find((l)=>l.includes('const LIVED_AGE ='));
 const LIVED_AGE=new RegExp(line.match(/const LIVED_AGE = \/(.*)\/;/)[1]);
 assert(LIVED_AGE.test('تعرض فيلا للبيع مسكونه سنه'));
 assert(LIVED_AGE.test('البيت مسكون من 3 سنوات'));
 assert(!LIVED_AGE.test('حاليا ساكنين فيها'));
 assert(!LIVED_AGE.test('البيت مسكون'));
 assert(agent.includes('texts = ["البيت الحين فاضي ولا مؤجر ولا ساكنين فيه ؟"]; out.action = "none"; delete out.guard_owner_decline; out.guard_lived_age = true;'));
});
test('rows 1086-1125: «بكم الفلل الي ف الصومحان» gets the Al Sawmhan ad (two units, one ad), not a link request',()=>{
 const ad='فيلا للبيع في الصومحان جنوب\n'+'تفاصيل '.repeat(30).trim();
 const available=[{id:'s2',branch_key:'barka',area:'الصومحان الجنوبية',price:69000,marketing:ad},{id:'s3',branch_key:'barka',area:'الصومحان الجنوبية',price:69000,marketing:ad},{id:'h59',branch_key:'barka',area:'بركاء الرميس',price:59000,marketing:'رميس'}];
 const r=decide(['ارسل لي رابط الفيديو او صورة منه عشان ارسلك التفاصيل والسعر بالضبط','اسمك الكريم ؟'],[IN('مرحبا'),IN('بكم الفلل الي ف الصومحان')],null,{available,route:'barka'});
 assert.deepEqual(r.texts,[ad,'متى يناسبك تزور ؟']);assert.equal(r.out.property_id,'s2');
 // dry run on the branch: the two units' ad texts differ (one has the reel caption); one owner, area, type and price = one offer, fullest ad
 const unitsDiffer=[{id:'s3',branch_key:'barka',area:'الصومحان الجنوبية',type:'villa',owner_id:'o1',price:69000,marketing:'قصير'},{id:'s2',branch_key:'barka',area:'الصومحان الجنوبية',type:'villa',owner_id:'o1',price:69000,marketing:ad}];
 assert.deepEqual(decide(['ارسل لي رابط الفيديو او صورة منه'],[IN('بكم الفلل الي ف الصومحان')],null,{available:unitsDiffer,route:'barka'}).texts,[ad,'متى يناسبك تزور ؟']);
 // two different properties in the area: the link question stays
 const two=[...available,{id:'x',branch_key:'barka',area:'الصومحان الجنوبية',price:90000,marketing:'غير'}];
 assert.deepEqual(decide(['ارسل لي رابط الفيديو او صورة منه'],[IN('بكم الفلل الي ف الصومحان')],null,{available:two,route:'barka'}).texts,['ارسل لي رابط الفيديو او صورة منه']);
});
test('the R11 check reads «ليوم» as a day too',()=>{
 assert(agent.includes('const TIME_SAID = /ا?ليوم|الحين'));
});
