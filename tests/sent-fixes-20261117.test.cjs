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
 // dry run on the branch: words between «عنها» and «انباعت», and another area offered: her named one goes instead
 const av2=[{id:'h59',branch_key:'barka',area:'بركاء الرميس',price:59000,marketing:'فيلا الرميس الإعلان'},{id:'s69',branch_key:'barka',area:'الصومحان الجنوبية',price:69000}];
 assert.deepEqual(decide(['الفيلا اللي سألتي عنها في الرميس بـ59 الف انباعت','بس عندنا فيلا في الصومحان الجنوبية بـ69 الف متوفره حالياً'],h,null,{available:av2,route:'barka'}).texts,['فيلا الرميس الإعلان','متى يناسبك تزور ؟']);
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
 // dry run on the branch: one unit's longest caption is a «تم البيع Sold out … نبارك للشاري» post; it is never sent
 const soldPost='تم البيع\nSold out\nنبارك للشاري والبائع\n'+'كلام '.repeat(60).trim();
 const withSold=[{id:'s3',branch_key:'barka',area:'الصومحان الجنوبية',type:'villa',owner_id:'o1',price:69000,marketing:soldPost},{id:'s2',branch_key:'barka',area:'الصومحان الجنوبية',type:'villa',owner_id:'o1',price:69000,marketing:ad}];
 assert.deepEqual(decide(['ارسل لي رابط الفيديو او صورة منه'],[IN('بكم الفلل الي ف الصومحان')],null,{available:withSold,route:'barka'}).texts,[ad,'متى يناسبك تزور ؟']);
 assert.deepEqual(decide(['ارسل لي رابط الفيديو او صورة منه'],[IN('بكم الفلل الي ف الصومحان')],null,{available:[withSold[0]],route:'barka'}).texts,['ارسل لي رابط الفيديو او صورة منه']);
 // «شفتك مصور بيت في رميس فله»: a villa and a rest house in Al Rumais; «فله» picks the villa
 const rumais=[{id:'h59',branch_key:'barka',area:'بركاء الرميس',type:'villa',price:59000,marketing:'فيلا الرميس '+'تفاصيل '.repeat(30).trim()},{id:'r109',branch_key:'barka',area:'بركاء الرميس',type:'rest_house',price:109000,marketing:'استراحة'}];
 assert.equal(decide(['ارسل لي رابط الفيديو او صورة منه'],[IN('شفتك مصور بيت في رميس فله')],null,{available:rumais,route:'barka'}).out.property_id,'h59');
 assert.equal(decide(['ارسل لي رابط الفيديو او صورة منه'],[IN('عندكم شي في الرميس')],null,{available:rumais,route:'barka'}).out.property_id,undefined);
 // two different properties in the area: the link question stays
 const two=[...available,{id:'x',branch_key:'barka',area:'الصومحان الجنوبية',price:90000,marketing:'غير'}];
 assert.deepEqual(decide(['ارسل لي رابط الفيديو او صورة منه'],[IN('بكم الفلل الي ف الصومحان')],null,{available:two,route:'barka'}).texts,['ارسل لي رابط الفيديو او صورة منه']);
});
test('the R11 check reads «ليوم» as a day too',()=>{
 assert(agent.includes('const TIME_SAID = /ا?ليوم|الحين'));
});
test('17 Nov: a reel captioned «تم البيع Sold out» is never an available property\'s video or ad text',()=>{
 const at=agent.indexOf('const soldCap = (c: any) =>');assert(at>0);
 const block=agent.slice(at,agent.indexOf('p.marketing =',at));
 // (Ahmed, same evening: the shared reel still goes for the units left; one without «تم البيع» is preferred)
 assert(block.includes('.sort((a: any, b: any) => (soldCap(a) ? 1 : 0) - (soldCap(b) ? 1 : 0) ||'),'a reel without the sold caption comes first');
 assert(block.includes('c.property_id === p.id && !soldCap(c)).map('),'the ad text skips it');
 const soldCap=new Function('c','return '+agent.slice(at).match(/const soldCap = \(c: any\) => (.*);/)[1].replace(/;$/,''));
 assert.equal(soldCap({caption:'⁨ تم البيع ✅ Sold out ✅ ولله الحمد ❤️ نبارك للشاري والبائع'}),true);
 assert.equal(soldCap({caption:'🏡 فيلا للبيع في الصومحان جنوب'}),false);
});
test('R92: an owner who will move in later if it does not sell is taken, with the line; «مسكونه سنه» when the model declined',()=>{
 const a=agent.indexOf('    // R92 (Ahmed 17 Nov 2026 evening'),b=agent.indexOf('    // R23, measured only:',a);assert(a>0&&b>a);
 const src=agent.slice(a,b).replace(/\((\w+): (?:string|any)\)/g,'($1)');
 const run=(texts,said,o={})=>{const out={category:'seller',action:'none',...(o.out||{})};const history=[...(o.before||[]),...said.map((b)=>({direction:'inbound',body:b}))];
  const r=new Function('out','texts','history','review',src+';return {out,texts};')(out,texts,history,false);return r;};
 const APOL=['نعتذر منك احنا ما نستلم عقارات مرهونة او ساكن فيها صاحبها','الله يسعدك 🌷'];
 const LINE='اذا تبي تعرضه معانا لازم يظل البيت فاضي فترة التسويق، واذا ما انباع بعدين لك الحرية تسكن فيه';
 // 060fadae without the mortgage: «محصلت حد صراحه وقلت بسكن فيها من بداية شهر ١٢»
 let r=run([...APOL],['امس مغسلنهن بالكامل','محصلت حد صراحه وقلت بسكن فيها من بداية شهر ١٢']);
 assert.deepEqual(r.texts,[LINE,'يناسبك ؟']);assert.equal(r.out.guard_future_live,true);
 // the intake goes on with the line first, once
 r=run(['ارسل الملكية والكروكي'],['بسكن فيها اذا ما انباعت']);assert.deepEqual(r.texts,[LINE,'ارسل الملكية والكروكي']);
 r=run(['ارسل الملكية والكروكي'],['بسكن فيها اذا ما انباعت'],{before:[{direction:'outbound',body:LINE}]});assert.deepEqual(r.texts,['ارسل الملكية والكروكي']);
 // the real chat had a mortgage: the apology stays; living there now stays declined
 assert.deepEqual(run([...APOL],['بسكن فيها من بداية شهر ١٢','في رهن']).texts,APOL);
 assert.deepEqual(run([...APOL],['حاليا ساكنين فيها وبعدين بنسكن غيرها']).texts,APOL);
 // «مسكونه سنه» with the apology written by the model
 assert.deepEqual(run([...APOL],['تعرض فيلا للبيع مسكونه سنه']).texts,['البيت الحين فاضي ولا مؤجر ولا ساكنين فيه ؟']);
 assert.deepEqual(run([...APOL],['البيت مسكون']).texts,APOL);
});
test('rows 1161-1200: «طيب» after the office sent the other number gets no second redirect',()=>{
 const R=['عقارك تتابعه معنا على رقم مسقط 71770030 واتساب','هذا الرقم خاص لعقارات بركاء'];
 let r=decide([...R],[IN('عندي ارض فالعامرات'),OUT('[contacts]'),OUT('تواصل على هذا الرقم'),IN('طيب')],{category:'seller'});
 assert.deepEqual(r.texts,[]);assert.equal(r.out.guard_ack_after_redirect,true);
 // the first redirect stays
 assert.deepEqual(decide([...R],[IN('عندي ارض فالعامرات')],{category:'seller'}).texts,R);
 // a real question after the redirect is answered
 assert.deepEqual(decide([...R],[OUT('تواصل على هذا الرقم'),IN('طيب وكم العمولة')],{category:'seller'}).texts.length>0,true);
});
test('rows 1201-1240: the opinion question after a visit does not come with «متى يناسبك تزور ؟»',()=>{
 const r=decide(['وايش انطباعك عن الفيلا بعد ما شفتها ؟','متى يناسبك تزور ؟'],[IN('بنمر اليوم نعاين الڤيلا'),OUT('عاينت الفيلا ؟'),IN('ايوا')]);
 assert.deepEqual(r.texts,['وايش انطباعك عن الفيلا بعد ما شفتها ؟']);
 // a visit question alone stays
 assert.deepEqual(decide(['متى يناسبك تزور ؟'],[IN('ممكن تفاصيل')]).texts,['متى يناسبك تزور ؟']);
});
test('rows 1241-1280: «تمام خذ راحتك» comes without «متى يناسبك تزور ؟»',()=>{
 assert.deepEqual(decide(['تمام خذ راحتك','متى يناسبك تزور ؟'],[IN('لكن انا مامن مسقط ف بنسق معك لما تكون لي جيه هناك')]).texts,['تمام خذ راحتك']);
 assert.deepEqual(decide(['تمام خذ راحتك'],[IN('بفكر')]).texts,['تمام خذ راحتك']);
});
test('rows 1321-1360: no commission lines after a decline; «جزا الله خيرا» is thanks',()=>{
 const DEC=['نعتذر منك احنا ما نستلم عقارات مرهونة','الله يسعدك 🌷'];
 assert.deepEqual(decide([...DEC],[IN('كيف طريقة الاعلان عن هذي الأرض..وبالنسبة للعمولة وغيره أريد أبيعها')],{category:'seller'}).texts,DEC);
 // the commission answer itself still goes to an owner who asks
 assert.equal(decide(['تمام'],[IN('كم العمولة حقكم')],{category:'seller'}).out.guard_commission,true);
 const w=agent.split('\n').find((l)=>l.startsWith('const THANKS_WORD ='));
 assert(new RegExp(w.match(/= \/(.*)\/i;/)[1],'i').test('جزا الله خيرا'));
});
