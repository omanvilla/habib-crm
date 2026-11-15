'use strict';
// R74 to R79: Ahmed's six decisions of 15 Nov 2026 after the dry run on 124 chats, held by code (ownerDecisions in the reply agent).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const agent=fs.readFileSync('supabase/functions/whatsapp-reply-agent/index.ts','utf8').replace(/\r\n/g,'\n');
const pickA=(start,end)=>{const a=agent.indexOf(start);assert(a>=0,'missing: '+start);const b=agent.indexOf(end,a);assert(b>a,'no end: '+start);return agent.slice(a,b+end.length);};
const dsrc=['const THEIR_OFFICE','const ASK_CONFIRM','const WE_SHOW','const MY_OWN','const SILENT_TYPES','const COMMISSION_ASK','const COMMISSION_BUYER_LINES','const COMMISSION_OWNER_LINES','const ASK_LINK','const areaKey','const BOOKING_ASK','const BOOKING_NOT','const ASK_HOUR','const NEEDS_AHMED','const VIDEO_PROMISE','const FAREWELL','const FIXED_PRICE_LINE','const IG_CODE','const UNKNOWN_Q','const LOCATION_ASK','const AREA_REASON','const OUTSIDE_LOOK','const locationForArea','const LOCATION_HELD','const AREA_LINES','const INSIDE_VIDEO_ASK','const LAYOUT_ASK','const LAYOUT_LINES','const OUR_HOUR','const OWNER_TIME_LINE','const DEPOSIT_SAID','const REASON_Q','const VISIT_Q']
 .map((s)=>pickA(s,'\n')).join('')+pickA('function ownerDecisions','\n}\n');
const D=new Function(dsrc.replace(/(\w+): (?:string|any|unknown|number)(?:\[\])?(?=[,)])/g,'$1')+';return {ownerDecisions,THEIR_OFFICE,COMMISSION_BUYER_LINES,COMMISSION_OWNER_LINES,locationForArea,INSIDE_VIDEO_ASK,LAYOUT_ASK,LAYOUT_LINES,AREA_LINES,OWNER_TIME_LINE,DEPOSIT_SAID};')();
const IN=(b)=>({direction:'inbound',body:b}),OUT=(b)=>({direction:'outbound',body:b});
const MAP='https://maps.app.goo.gl/TEST',MAIN='https://www.instagram.com/reel/TESTMAIN/',INSIDE='https://www.instagram.com/reel/TESTINSIDE/';
const decide=(texts,history,out,c)=>{const o={action:'none',category:'buyer',...(out||{})};const burst=[];for(const h of history){if(h.direction==='outbound')burst.length=0;else burst.push(h.body);}
 const t=D.ownerDecisions(o,texts,{history,burstSaid:burst.join(' '),prop:{id:'TEST_PROP',map_url:MAP,videoInside:INSIDE},visitedProp:false,visitedAny:false,saidVisited:false,handoffOpen:false,hardHandoff:false,...(c||{})});return {out:o,texts:t};};

test('R74: the location goes to a client who needs it to judge the area, once, and no visit is recorded from it',()=>{
 for(const s of ['ي صديقي اريد اشوف الموقع هل مناسب لي او لا مو لازم للزياره','اذا ممكن الموقع عشان اعرف هل يناسبني او لا','اذا نظامك ما ممكن ترسل الموقع خلاص ما ممكن أزور الموقع لاني قلتلك انه زيارة الفيلا تعتمد ع الموقع','إذا ممكن اشوف الموقع اشوفه إذا يناسب او لا'])assert.equal(D.locationForArea(s),true,s);
 assert.equal(D.locationForArea('اريد اعرف المكان بالضبط ما اريد ازوره'),true,'sixth dry-run batch');
 for(const s of ['ممكن الموقع','طيب هات الموقع','رسل الموقع','اعرف اذا السعر مناسب','ممكن لوكيشن والصوره الله يخليك'])assert.equal(D.locationForArea(s),false,s);
 const chat=[IN('الموقع'),OUT('اللوكيشن نرسله قبل الزيارة عشان نتأكد إن العقار لسا متاح وما تتعنى على الفاضي'),IN('ي صديقي اريد اشوف الموقع هل مناسب لي او لا'),IN('مو لازم للزياره')];
 let r=decide(['الموقع نرسله قبل الزيارة فقط اخوي عشان نتأكد العقار متوفر وقتها'],chat);
 assert.equal(r.out.action,'send_location');assert.equal(r.out.location_for_area,true);assert.deepEqual(r.texts,D.AREA_LINES);
 r=decide(['ان شاء الله برسلك الموقع','متى يناسبك تزور ؟'],chat);assert.deepEqual(r.texts,D.AREA_LINES);
 // not twice, not without the reason, not for an owner, not without a map
 r=decide(['تمام'],[...chat,OUT(MAP),IN('اشوف الموقع يناسبني او لا')]);assert.equal(r.out.action,'none');
 r=decide(['ان شاء الله برسلك الموقع','متى يناسبك تزور ؟'],[IN('ممكن الموقع')]);assert.equal(r.out.action,'none');assert.equal(r.texts.length,2);
 r=decide(['x'],chat,{category:'seller'});assert.equal(r.out.action,'none');
 r=decide(['x'],chat,{},{prop:{id:'TEST_PROP',map_url:null}});assert.equal(r.out.action,'none');
 assert(agent.includes('if (sentIds.length && prop && !review && !out.location_for_area && ["send_location", "send_owner_number", "send_lockbox"].includes(out.action)) {'));
});
test('R75: a request for the inside video gets the reel marked «من الداخل», and nothing of ours is said about a video',()=>{
 for(const s of ['ممكن ترسلي فيديو من داخل البيت','شي مقطع فيديو من داخل !','اقصد من الداخل الفيديو','ف الفيديو ذاكر تواصلو معي ف الواتساب وبرسلكم الفيديو للفه من داخل ع طول'])assert(D.INSIDE_VIDEO_ASK.test(s),s);
 for(const s of ['هل متوفر فيديو للفله','ممكن الصور','ابي ادخل البيت'])assert(!D.INSIDE_VIDEO_ASK.test(s),s);
 let r=decide(['اي نعم الفيديو فيه تصوير من داخل الفيلا'],[OUT(MAIN),IN('ف الفيديو مذكور انه في فيديو للبيت من الداخل')]);
 assert.deepEqual(r.texts,['هذا الفيديو من الداخل',INSIDE,'متى يناسبك تزور ؟']);assert.equal(r.out.guard_inside_video,true);
 r=decide([MAIN,'متى يناسبك تزور ؟'],[IN('ممكن فيديو من داخل البيت')]);assert.deepEqual(r.texts,['هذا الفيديو من الداخل',INSIDE,'متى يناسبك تزور ؟']);
 r=decide(['ما عندنا تصوير ثاني للداخل'],[OUT(INSIDE),IN('ابي فيديو من الداخل')]);assert.deepEqual(r.texts,['الفيديو من الداخل ارسلته لك فوق','متى يناسبك تزور ؟']);
 r=decide(['ما عندنا تصوير ثاني للداخل'],[IN('ابي فيديو من الداخل')],{},{prop:{id:'TEST_PROP',videoInside:null}});assert.deepEqual(r.texts,['ما عندنا تصوير ثاني للداخل'],'a property with no inside reel is left alone');
 assert(agent.includes('.ilike("notes", "%من الداخل%")'));
 // «اقصد من الداخل» after the video question, and the long sentence of the real chat
 r=decide(['ما عندنا تصوير اضافي من الداخل'],[IN('هل متوفر فيديو للفله'),OUT(MAIN+' متى يناسبك تزور ؟'),IN('اقصد من الداخل'),IN('لأن أنا في الشرقيه')]);assert.equal(r.texts[1],INSIDE);
 assert(D.INSIDE_VIDEO_ASK.test('ف الفيديو مذكور انه في في يو للبيت من الداخل'));
});
test('the video is never promised: the reel goes now, or the promise is taken out; R74 drops a farewell before the location',()=>{
 const prop={id:'TEST_PROP',map_url:MAP,video:MAIN,videoInside:null};
 let r=decide(['ما عندنا صور للفيلا حالياً','تمام برسلك الفيديو'],[IN('ممكن صور الفيلا')],{action:'handoff',handoff_reason:'طلب فيديو للفيلا في الصومحان الجنوبية'},{prop});
 assert.deepEqual(r.texts,['ما عندنا صور للفيلا حالياً',MAIN]);assert.equal(r.out.action,'none');assert.equal(r.out.guard_video_promise,true);
 r=decide(['ما عندنا صور','تمام برسلك الفيديو'],[IN('فيه صور للمكان')],{action:'handoff',handoff_reason:'طلب فيديو وما عندنا رابط الفيديو'},{prop:{id:'TEST_PROP',video:null}});
 assert.deepEqual(r.texts,['ما عندنا صور']);assert.equal(r.out.action,'handoff','no reel: Ahmed still gets it, without the promise');
 r=decide(['الله يوفقك اخوي'],[IN('اذا ممكن الموقع عشان اعرف هل يناسبني او لا')]);assert.deepEqual(r.texts,D.AREA_LINES);
 assert(agent.includes('const welcome = /[ء-ي]/.test(burstSaid) ? "العفو" : "You\'re welcome";'));
 // a photo request gets the property's reel with «ما عندنا صور», once
 r=decide(['ما عندنا صور للفيلا حالياً','متى يناسبك تزور ؟'],[IN('ممكن صور الفيلا')],{},{prop});
 assert.deepEqual(r.texts,['ما عندنا صور للفيلا حالياً',MAIN,'متى يناسبك تزور ؟']);assert.equal(r.out.guard_photo_video,true);
 r=decide(['ما عندنا صور للفيلا حالياً','متى يناسبك تزور ؟'],[OUT(MAIN),IN('ممكن صور الفيلا')],{},{prop});assert.equal(r.texts.length,2);
 // no visit question when the property is not available and nothing is offered in its place
 r=decide(['تشرفنا هلال','الفيلا اللي سألت عنها في الشخاخيط ما متوفره حالياً','متى يناسبك تزور ؟'],[IN('هلال عزان')]);assert.deepEqual(r.texts,['تشرفنا هلال','الفيلا اللي سألت عنها في الشخاخيط ما متوفره حالياً']);
 r=decide(['الفيلا اللي سألت عنها ما متوفره حالياً بس عندنا فيلا في الصومحان بـ 69 الف','متى يناسبك تزور ؟'],[IN('متوفره ؟')]);assert.equal(r.texts.length,2);
 assert.equal(D.locationForArea('ممكن الموقع اشوف اهل إذا يناسبهم اليوم عصر راح افيدك'),false,'the family\'s time is not the area');
 // the fixed project line once
 const F='الاسعار تختلف حسب الوحدة والمساحة والمرحلة';
 r=decide([F,'العرض الحالي بدون دفعة مقدمة وساري لين 30 نوفمبر 2026 والاسعار تختلف حسب الوحدة والمساحة والمرحلة','يناسبك ؟'],[IN('ابا تفاصيل عنهم كلهم')],{category:'investor'});
 assert.deepEqual(r.texts,[F,'العرض الحالي بدون دفعة مقدمة وساري لين 30 نوفمبر 2026','يناسبك ؟']);
});
test('R76: a layout question handed over as unknown gets «الخرائط تختلف عن الواقع» and the visit question',()=>{
 for(const s of ['ممكن مساحات و تقسيمات الفلا قبل ازور الموقع','توزيع الغرف كيف','عندكم مخطط البيت','سؤال ما عندي جوابه: مساحات كل غرفة في الاستراحة'])assert(D.LAYOUT_ASK.test(s),s);
 assert(!D.LAYOUT_ASK.test('كم مساحة الارض'));
 let r=decide([],[IN('ممكن تفاصيل الغرف والمساحات قبل ما نقرر الزيارة')],{action:'handoff',handoff_reason:'سؤال ما عندي جوابه: مساحات كل غرفة في استراحة VVIP بالرميس'});
 assert.equal(r.out.action,'none');assert.equal(r.out.handoff_reason,null);assert.deepEqual(r.texts,D.LAYOUT_LINES);assert.match(D.LAYOUT_LINES[0],/الخرائط تختلف عن الواقع/);
 r=decide([],[IN('كم عمولة الاسكان')],{action:'handoff',handoff_reason:'سؤال ما عندي جوابه: كم عمولة الاسكان'});assert.equal(r.out.action,'handoff','another unknown question still goes to Ahmed');
 r=decide([],[IN('ممكن التقسيم')],{action:'handoff',handoff_reason:'سؤال ما عندي جوابه: تقسيم الفيلا'},{visitedProp:true});assert.equal(r.out.action,'handoff');
});
test('R77 / R78: no hour of ours when the owner arranges the visit; the reason is asked once',()=>{
 let r=decide(['الساعة 4 العصر مناسب ان شاء الله','تواصل مع صاحب العقار على الرقم المرسل ونسق معه الزيارة'],[IN('ان شاء الله بكره، الساعة كم مناسب لك؟')],{action:'send_owner_number'});
 assert.deepEqual(r.texts,[D.OWNER_TIME_LINE]);assert.equal(r.out.guard_owner_time,true);
 r=decide(['تشرفنا محمد','تواصل مع صاحب العقار مباشرة ونسق معه الزيارة'],[IN('بكره')],{action:'send_owner_number'});assert.equal(r.texts.length,2);assert.equal(r.out.guard_owner_time,undefined);
 r=decide(['البيت مفتوح تقدر تشوفه بكره الساعة 4 العصر'],[IN('بكره')],{action:'send_location'});assert.equal(r.texts.length,1,'our own visits keep their hour');
 const ask='اذا ما عليك امر ممكن تذكر لي الاسباب ليش ما ناسبتك الفيلا ؟';
 r=decide([ask],[OUT('كيف شفت الفيلا ؟'),IN('ما ناسبتني')]);assert.deepEqual(r.texts,[ask]);
 r=decide(['تمام',ask],[OUT(ask),IN('خلاص ما ناسبتني')]);assert.deepEqual(r.texts,['تمام']);assert.equal(r.out.guard_reason_once,true);
});
test('fifth dry-run batch: no hour asked where the owner lives; «يحتاج رد أحمد» becomes the silent handoff',()=>{
 const owner={id:'TEST_PROP',visit_method:'owner_lives'};
 let r=decide(['الزيارة تحتاج تنسيق مع المالك قبل يوم على الأقل','اسمك الكريم ؟ وكم الساعة تقريباً اليوم ؟'],[IN('اليوم العصر ممكن ؟')],{},{prop:owner});
 assert.deepEqual(r.texts,['الزيارة تحتاج تنسيق مع المالك قبل يوم على الأقل','اسمك الكريم ؟']);assert.equal(r.out.guard_owner_time,true);
 r=decide(['كم الساعة تقريباً بكره ؟'],[IN('بكره')],{},{prop:{id:'TEST_PROP',visit_method:'open'}});assert.equal(r.texts.length,1,'our own visits still ask the hour');
 r=decide(['موضوع إلغاء الشقق وتعديل المخطط يحتاج رد أحمد','اسمك الكريم ؟'],[IN('واذا بغيت اكنسل الشقق شي مخطط يكون بيت واحد ؟')]);
 assert.deepEqual(r.texts,[]);assert.equal(r.out.action,'handoff');assert.match(r.out.handoff_reason,/^سؤال ما عندي جوابه: واذا بغيت اكنسل الشقق/);
 r=decide(['تمام وصلت','الموضوع يحتاج رد أحمد'],[IN('x')],{action:'handoff',handoff_reason:'صفقة شغالة: x'});assert.equal(r.texts.length,2,'an existing handoff is left alone');
});
test('R80: who pays the commission, for a buyer and for an owner, never a figure',()=>{
 const ours={id:'TEST_PROP',owner_id:'TEST_OWNER',listing_purpose:'sale'};
 let r=decide([],[IN('العموله المكتب على من؟؟؟')],{action:'handoff',handoff_reason:'سؤال ما عندي جوابه: العمولة المكتب على من؟ عن فيلا الرميس'},{prop:ours,hardHandoff:true});
 assert.deepEqual(r.texts,D.COMMISSION_BUYER_LINES);assert.equal(r.out.action,'none');assert.equal(r.out.handoff_reason,null);
 r=decide(['تفاصيل العرض والعمولة يوضحها أحمد','ارسل الملكية والكروكي اذا ما عليك امر'],[IN('الملكيه والكروكي ايش رايك لم نتفق على تفاصيل العرض ومقدار عمولتك ؟')],{category:'seller',action:'handoff',handoff_reason:'سؤال عن العمولة'},{prop:null});
 assert.deepEqual(r.texts,['ارسل الملكية والكروكي اذا ما عليك امر',...D.COMMISSION_OWNER_LINES]);assert.equal(r.out.action,'none');
 assert(!D.COMMISSION_BUYER_LINES.concat(D.COMMISSION_OWNER_LINES).some((t)=>/[0-9٠-٩%٪]/.test(t)),'no figure');
 // left alone: a broker, a tenant, a buyer on no known property, a negotiation
 for(const [o,c] of [[{category:'broker'},{prop:ours}],[{category:'tenant'},{prop:ours}],[{},{prop:null}],[{action:'handoff',handoff_reason:'تفاوض: x'},{prop:ours,hardHandoff:true}]]){r=decide(['x'],[IN('كم العمولة')],o,c);assert.equal(r.out.guard_commission,undefined);}
});
test('R81: a buyer who asks about booking goes to Ahmed as «مشتري جاد:» with no reply, visited or not',()=>{
 let r=decide(['تمام الله يسهل'],[IN('اذا حجزت معاكم كم مدة الانتظار')]);
 assert.deepEqual(r.texts,[]);assert.equal(r.out.action,'handoff');assert.match(r.out.handoff_reason,/^مشتري جاد: يسأل عن الحجز: اذا حجزت معاكم/);
 r=decide([],[IN('ابي احجز الفيلا كيف الطريقة')],{action:'handoff',handoff_reason:'سؤال ما عندي جوابه: طريقة الحجز'},{hardHandoff:true});assert.match(r.out.handoff_reason,/^مشتري جاد:/);
 for(const s of ['ابي احجز موعد زيارة بكره','شي حجز تاريخ 2026/11/26 استراحة','ابي احجز الاستراحة ليلة الخميس','كم السعر'])
  {r=decide(['x'],[IN(s)]);assert.equal(r.out.guard_booking_serious,undefined,s);}
 r=decide(['x'],[IN('كم العربون')],{category:'investor'});assert.equal(r.out.guard_booking_serious,undefined,'a project buyer follows the meeting rules');
 r=decide([],[IN('كم العربون')],{action:'handoff',handoff_reason:'تفاوض: x'},{hardHandoff:true});assert.equal(r.out.handoff_reason,'تفاوض: x');
});
test('R82: a property named by its area that we no longer have gets «ما متوفره حالياً» and the nearest one, not a request for a link',()=>{
 const gone=[{id:'G1',type:'twin_villa',area:'الشخاخيط',price:69000,listing_purpose:'sale'}];
 const available=[{id:'A1',type:'villa',area:'الصومحان الجنوبية',price:69000,listing_purpose:'sale',branch_key:'barka'},{id:'A2',type:'villa',area:'الخوض',price:70000,listing_purpose:'sale',branch_key:'muscat'},{id:'A3',type:'land',area:'الرميس',price:68000,listing_purpose:'sale',branch_key:'barka'}];
 const c={prop:null,gone,available,route:'barka',typeLabel:(t)=>(/villa/.test(t)?'فيلا':'عقار')};
 let r=decide(['ارسل لي رابط الفيديو او صورة منه عشان ارسلك التفاصيل والسعر بالضبط','اسمك الكريم ؟'],[IN('فيلا الشخاخيط اريد موقعها الي مكونه م ٦ غرفه')],{},c);
 assert.deepEqual(r.texts,['فيلا الشخاخيط اللي سألت عنها ما متوفره حالياً','بس عندنا فيلا في الصومحان الجنوبية بـ 69 الف','تحب ارسلك تفاصيلها ؟']);
 r=decide(['اي فيلا بالضبط ؟'],[IN('فيلا الشخاخيط')],{},{...c,available:[available[1]]});assert.deepEqual(r.texts,['فيلا الشخاخيط اللي سألت عنها ما متوفره حالياً','اول ما يتوفر بتواصل معك']);
 // left alone: we still have one there, or no area of ours is named
 r=decide(['اي فيلا بالضبط ؟'],[IN('فيلا الشخاخيط')],{},{...c,available:[...available,{id:'A4',type:'villa',area:'الشخاخيط',price:75000,listing_purpose:'sale',branch_key:'barka'}]});assert.equal(r.out.guard_named_gone,undefined);
 r=decide(['اي فيلا بالضبط ؟'],[IN('تفاصيل الفله لو سمحت')],{},c);assert.equal(r.out.guard_named_gone,undefined);
});
test('R79: a visited client who asks about a deposit is «مشتري جاد:» so the WhatsApp alert goes',()=>{
 for(const s of ['هل يصير ادفع عربون لحجز الفلا','ابي احجز الفيلا','كم العربون'])assert(D.DEPOSIT_SAID.test(s),s);
 for(const s of ['شي حجز تاريخ 2026/11/26','احجز موعد زيارة'])assert(!D.DEPOSIT_SAID.test(s),s);
 const chat=[IN('شفت الفيلا و عجبتني هل يصير ادفع عربون لحجز الفلا و بعدها انهي اجراءاتي في شهر ٥ ؟'),OUT('اسمك الكريم ؟'),IN('حسناء')];
 const ho={action:'handoff',category:'active_deal',handoff_reason:'صفقة شغالة: حسناء زارت فيلا الرميس وتسأل عن دفع عربون',soft_handoff_no_reply:true};
 let r=decide([],chat,{...ho},{saidVisited:true});
 assert.equal(r.out.handoff_reason,'مشتري جاد: حسناء زارت فيلا الرميس وتسأل عن دفع عربون');assert.equal(r.out.guard_deposit_serious,true);assert.equal(r.out.soft_handoff_no_reply,undefined);
 for(const c of [{},{saidVisited:true,handoffOpen:true},{saidVisited:true,hardHandoff:true}]){r=decide([],chat,{...ho},c);assert.equal(r.out.guard_deposit_serious,undefined);}
 r=decide([],chat,{...ho,handoff_reason:'طلب اتصال: يبي أحمد يتصل'},{saidVisited:true});assert.equal(r.out.guard_deposit_serious,undefined);
 assert(agent.includes('texts = ownerDecisions(out, texts, { history, burstSaid, prop,'));
 assert(agent.indexOf('texts = ownerDecisions(')<agent.indexOf('analysis.branch_redirect = prop.branch_key;'),'the branch rule (R48) still runs after it');
});
test('a unit with no reel uses the reel of its sibling unit',()=>{
 assert(agent.includes('const sib = (props as any[]).find((q: any) => q.video && q.id !== p.id && q.owner_id && q.owner_id === p.owner_id && q.area === p.area && q.type === p.type'));
 assert(agent.indexOf('if (sib) p.video = sib.video;')>agent.indexOf('p.video = vids[0]?.permalink || null;'));
});
test('eighth dry-run batch: no claim about what the ordinary reel shows; the name question is not glued to another sentence',()=>{
 let r=decide(['هذا فيديو الفيلا من الداخل والخارج https://www.instagram.com/reel/TESTMAIN/','اسمك الكريم ؟'],[IN('ممكن تراويني الصور')],{},{prop:{id:'TEST_PROP',video:MAIN,videoInside:null}});
 assert.equal(r.texts[0],'هذا فيديو الفيلا https://www.instagram.com/reel/TESTMAIN/');assert.equal(r.texts[1],'اسمك الكريم ؟');
 r=decide(['مدينة السلطان هيثم بالسيب من المطور الأهلي صبور والتملك حر لأي جنسية واسمك الكريم ؟'],[IN('هل عندك عقار')],{category:'investor'});
 assert.deepEqual(r.texts,['مدينة السلطان هيثم بالسيب من المطور الأهلي صبور والتملك حر لأي جنسية']);
 r=decide(['هذا الفيديو من الداخل',INSIDE],[OUT(MAIN),IN('ابي فيديو من الداخل')]);assert.equal(r.texts[0],'هذا الفيديو من الداخل','the marked reel keeps its line');
});
test('ninth dry-run batch: an ad that mentions a commission is not a question; deleted messages get no answer',()=>{
 let r=decide(['اسمك الكريم ؟'],[IN('*متبقي فيلا فقط للحجز المسبق* الحضيّب السوادي بركاء السعر 75 الف شامل العمولة للتواصل')],{category:'seller'});
 assert.equal(r.out.guard_commission,undefined);
 for(const s of ['العموله المكتب على من؟؟؟','كم عمولتكم','من يدفع العمولة','ومقدار عمولتك ؟'])
  {r=decide(['x'],[IN(s)],{category:'seller'});assert.equal(r.out.guard_commission,true,s);}
 const del=(t)=>({direction:'inbound',body:null,message_type:t});
 r=decide(['اسمك الكريم ؟','ارسل الملكية اذا ما عليك امر'],[del('revoke'),del('revoke'),del('reaction')]);assert.deepEqual(r.texts,[]);assert.equal(r.out.guard_nothing_said,true);
 r=decide(['مرحبتين تفضل'],[del('revoke'),{direction:'inbound',body:'مرحبا',message_type:'text'}]);assert.equal(r.texts.length,1);
 r=decide(['ان شاء الله برسلك الموقع','متى يناسبك تزور ؟ واسمك الكريم ؟'],[IN('ممكن الموقع')]);assert.deepEqual(r.texts,['ان شاء الله برسلك الموقع','متى يناسبك تزور ؟']);
});
test('a deleted message that is not in the history gets no answer either',()=>{
 let r=decide(['اسمك الكريم ؟','ارسل الملكية اذا ما عليك امر'],[OUT('اسمك الكريم ؟')],{},{msgType:'revoke'});assert.deepEqual(r.texts,[]);assert.equal(r.out.guard_nothing_said,true);
 r=decide(['مرحبتين تفضل'],[IN('مرحبا')],{},{msgType:'text'});assert.equal(r.texts.length,1);
 assert(agent.includes('typeLabel: typeAr, msgType: msg.message_type });'));
});
test('tenth dry-run batch: a named area with one available property gets its details; a meeting at the client\'s office says so',()=>{
 const AD='للبيع | منزل + شقتين مؤجرة مسقط الحيل الجنوبية السعر: 130,000 ريال مساحة الأرض: 692 م² مساحة البناء: 430 م²';
 const c={prop:null,route:'muscat',available:[{id:'H1',area:'الحيل الجنوبية',branch_key:'muscat',marketing:AD},{id:'R1',area:'الرميس',branch_key:'barka',marketing:'x'},{id:'R2',area:'الرميس',branch_key:'barka',marketing:'y'}]};
 let r=decide(['قصدك البيت المعروض في الحيل الجنوبية ؟','اسمك الكريم ؟'],[IN('صباح الخير شفت بيت معروض فحيل الجنوبية الله يخليكم عطوني تفاصيل')],{},c);
 assert.deepEqual(r.texts,[AD,'متى يناسبك تزور ؟'],'«فحيل الجنوبية» is read as the area too');
 r=decide(['قصدك البيت المعروض في الحيل الجنوبية ؟','اسمك الكريم ؟'],[IN('شفت بيت معروض في الحيل الجنوبية عطوني تفاصيل')],{},c);
 assert.deepEqual(r.texts,[AD,'متى يناسبك تزور ؟']);assert.equal(r.out.property_id,'H1');
 r=decide(['اسمك الكريم ؟','ارسل تفاصيل البيت كاملة والمستندات والسعر اللي في بالك اذا ما عليك امر'],[IN('عارضين بيت للبيع ف الحيل الجنوبية')],{category:'seller'},c);
 assert.deepEqual(r.texts,[AD,'متى يناسبك تزور ؟']);assert.equal(r.out.category,'buyer');
});
test('tenth batch B: left alone',()=>{
 const AD='للبيع | منزل + شقتين مؤجرة مسقط الحيل الجنوبية السعر: 130,000 ريال مساحة الأرض: 692 م² مساحة البناء: 430 م²';
 const c={prop:null,route:'muscat',available:[{id:'H1',area:'الحيل الجنوبية',branch_key:'muscat',marketing:AD},{id:'R1',area:'الرميس',branch_key:'barka',marketing:'x'},{id:'R2',area:'الرميس',branch_key:'barka',marketing:'y'}]};
 let r;
 // left alone: his own property, two properties in the area, the ad already sent
 r=decide(['ارسل تفاصيل البيت'],[IN('عندي بيت عارضه للبيع في الحيل الجنوبية')],{category:'seller'},c);assert.equal(r.out.guard_named_available,undefined);
 r=decide(['تقصد تفاصيل الفيلا اللي في الرميس ؟'],[IN('فيلا الرميس')],{},{...c,route:'barka'});assert.equal(r.out.guard_named_available,undefined);
 r=decide(['قصدك البيت المعروض في الحيل الجنوبية ؟'],[OUT(AD),IN('البيت المعروض في الحيل الجنوبية')],{},c);assert.equal(r.out.guard_named_available,undefined);
});
test('tenth batch C: the client office wording',()=>{
 for(const s of ['متي بتيجي معنا المكتب','تشرفونا في مكتبنا بالخوير','متى تزورنا'])assert(D.THEIR_OFFICE.test(s),s);
 for(const s of ['ابي امر المكتب','متى اجي المكتب','اجتماع اونلاين'])assert(!D.THEIR_OFFICE.test(s),s);
 assert(agent.includes('theirOffice && mt?.place !== "online" ? "مكتب العميل" : MEETING_PLACE[mt?.place] || ""'));
});
test('eleventh dry-run batch: «اشوف البيت من الخارج» gets the location like R74',()=>{
 assert.equal(D.locationForArea('أنا اريد أشوف البيت من الخارج لان من سكان الحيل الشماليه'),true);
 assert.equal(D.locationForArea('ابي اشوف البيت من داخل'),false);
});
