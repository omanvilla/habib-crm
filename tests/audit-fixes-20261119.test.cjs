'use strict';
// 19 Nov 2026, from the first reply audit (Ahmed: «موافق، سجّلها»): R116 and R117.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const agent=fs.readFileSync('supabase/functions/whatsapp-reply-agent/index.ts','utf8').replace(/\r\n/g,'\n');
const pickFrom=(src)=>(start,end)=>{const a=src.indexOf(start);assert(a>=0,'missing: '+start);const b=src.indexOf(end,a);assert(b>a,'no end: '+start);return src.slice(a,b+end.length);};
const pickA=pickFrom(agent);
const dsrc=['const THEIR_OFFICE','const ASK_CONFIRM','const WE_SHOW','const MY_OWN','const SILENT_TYPES','const COMMISSION_ASK','const COMMISSION_BUYER_LINES','const COMMISSION_OWNER_LINES','const ASK_LINK','const areaKey','const BOOKING_ASK','const BOOKING_NOT','const ASK_HOUR','const NEEDS_AHMED','const VIDEO_PROMISE','const FAREWELL','const FIXED_PRICE_LINE','const IG_CODE','const UNKNOWN_Q','const LOCATION_ASK','const AREA_REASON','const OUTSIDE_LOOK','const locationForArea','const LOCATION_HELD','const AREA_LINES','const INSIDE_VIDEO_ASK','const LAYOUT_ASK','const LAYOUT_LINES','const OUR_HOUR','const HOUR_SAID','const OWNER_TIME_LINE','const DEPOSIT_SAID','const REASON_Q','const VISIT_Q','const R66_DETAILS_ASK','const R66_GENERIC']
 .map((s)=>pickA(s,'\n')).join('')+pickA('function nearBarka','\n}\n')+pickA('function soldNoticeYes','\n}\n')+pickA('function ownerDecisions','\n}\n');
// (19 Nov: ownerDecisions now has «(… ) as any[]» casts, so the TypeScript casts are taken out too)
const D=new Function(dsrc.replace(/(\w+): (?:string|any|unknown|number)(?:\[\])?(?=[,)])/g,'$1').replace(/\) as (?:any|string|number)(?:\[\])?\)/g,'))')+';return {ownerDecisions};')();
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
