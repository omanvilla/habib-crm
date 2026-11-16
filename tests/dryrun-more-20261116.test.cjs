'use strict';
// 16 Nov 2026, dry run of more chats after R91 (Ahmed: «كمل اختبار على محادثات اكثر»): what today's code still got wrong,
// held by code in ownerDecisions: R34 (the privacy line went with the reel link and no visit offer, c151bb05) and R78 (the
// «what did not suit you in what you saw» question to clients who never visited, 550b4985 and de9733c5).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const agent=fs.readFileSync('supabase/functions/whatsapp-reply-agent/index.ts','utf8').replace(/\r\n/g,'\n');
const pickFrom=(src)=>(start,end)=>{const a=src.indexOf(start);assert(a>=0,'missing: '+start);const b=src.indexOf(end,a);assert(b>a,'no end: '+start);return src.slice(a,b+end.length);};
const pickA=pickFrom(agent);
const dsrc=['const THEIR_OFFICE','const ASK_CONFIRM','const WE_SHOW','const MY_OWN','const SILENT_TYPES','const COMMISSION_ASK','const COMMISSION_BUYER_LINES','const COMMISSION_OWNER_LINES','const ASK_LINK','const areaKey','const BOOKING_ASK','const BOOKING_NOT','const ASK_HOUR','const NEEDS_AHMED','const VIDEO_PROMISE','const FAREWELL','const FIXED_PRICE_LINE','const IG_CODE','const UNKNOWN_Q','const LOCATION_ASK','const AREA_REASON','const OUTSIDE_LOOK','const locationForArea','const LOCATION_HELD','const AREA_LINES','const INSIDE_VIDEO_ASK','const LAYOUT_ASK','const LAYOUT_LINES','const OUR_HOUR','const HOUR_SAID','const OWNER_TIME_LINE','const DEPOSIT_SAID','const REASON_Q','const VISIT_Q','const R66_DETAILS_ASK','const R66_GENERIC']
 .map((s)=>pickA(s,'\n')).join('')+pickA('function nearBarka','\n}\n')+pickA('function ownerDecisions','\n}\n');
const D=new Function(dsrc.replace(/(\w+): (?:string|any|unknown|number)(?:\[\])?(?=[,)])/g,'$1')+';return {ownerDecisions};')();
const IN=(b,type)=>({direction:'inbound',body:b,message_type:type||'text'}),OUT=(b)=>({direction:'outbound',body:b});
const decide=(texts,history,out,c)=>{const o={action:'none',category:'buyer',...(out||{})};const burst=[];for(const h of history){if(h.direction==='outbound')burst.length=0;else burst.push(h.body);}
 const t=D.ownerDecisions(o,texts,{history,burstSaid:burst.join(' '),prop:null,visitedProp:false,visitedAny:false,saidVisited:false,handoffOpen:false,hardHandoff:false,...(c||{})});return {out:o,texts:t};};

test('R34: the privacy line for a house the owner lives in comes with the visit offer, never with the reel link',()=>{
 // c151bb05, 16 Nov 10:48 (and the same on today's code): «ما رحت .. انتظر صور الشقق من المالك»
 const h=[OUT('السلام عليكم كيف شفت العقار وايش انطباعك عنه ؟'),IN('وعليكم السلام'),IN('ما رحت .. انتظر صور الشقق من المالك')];
 let r=decide(['بحكم إن المالك ساكن في البيت ما صورنا البيت من الداخل عشان الخصوصية','https://www.instagram.com/reel/DfBvGuAtTMe/'],h);
 assert.deepEqual(r.texts,['بحكم إن المالك ساكن في البيت ما صورنا البيت من الداخل عشان الخصوصية','بس نقدر نرتب لك زيارة وتشوف البيت من الداخل على راحتك','متى يناسبك ؟']);
 assert.equal(r.out.guard_privacy_visit,true);
 // the full answer of R34 is left as it is
 const full=['بحكم إن المالك ساكن في البيت ما صورنا البيت من الداخل عشان الخصوصية','بس نقدر نرتب لك زيارة وتشوف البيت من الداخل على راحتك','متى يناسبك ؟'];
 assert.deepEqual(decide(full,h).texts,full);
 // a reel link without the privacy line is not touched
 assert.deepEqual(decide(['https://www.instagram.com/reel/abc/','متى يناسبك تزور ؟'],h).texts,['https://www.instagram.com/reel/abc/','متى يناسبك تزور ؟']);
});
test('R78: «ما ناسبك في اللي شفته» only after a visit',()=>{
 // 550b4985: a reel nobody recognised and «ممكن تفاصيل», ten hours later «؟؟»
 const reel=[OUT('هل الفيلا ما ناسبتك ؟ في حال ما ناسبتك ممكن تذكريلي الاسباب اذا ما عليك امر'),IN('https://www.instagram.com/reel/De4Qqj8u33f/?mdxt=x'),IN('ممكن تفاصيل'),IN('؟؟')];
 let r=decide(['اسمك الكريم ؟','ايش اللي ناقصك او ما ناسبك في اللي شفتيه ؟'],reel);
 assert.deepEqual(r.texts,['اسمك الكريم ؟','اكتب لي المنطقة او السعر اللي في الاعلان اذا ما عليك امر']);assert.equal(r.out.guard_seen_q,true);
 // de9733c5: the office sent the owner's number; «رسلت لهم ما ردوا علي»: nothing to say from the agent, Ahmed is told
 const noAnswer=[IN('ممكن تفاصيل و الموقع'),OUT('[contacts]'),OUT('اهلين تواصل على هالرقم'),IN('رسلت لهم ما ردوا علي')];
 r=decide(['اسمك الكريم ؟','ايش اللي ناقصك او ما ناسبك في اللي شفته ؟'],noAnswer);
 assert.deepEqual(r.texts,[]);assert.equal(r.out.action,'handoff');assert.match(r.out.handoff_reason,/^ما عرفنا: العميل ما زار/);
 // after a recorded visit, or the client's own words, the question stays (R78 still asks it once)
 const seen=['ايش اللي ناقصك او ما ناسبك في اللي شفته ؟'];
 assert.deepEqual(decide(seen,noAnswer,{},{visitedSome:true}).texts,seen);
 assert.deepEqual(decide(seen,noAnswer,{},{saidVisited:true}).texts,seen);
 assert.deepEqual(decide(seen,noAnswer,{},{visitedProp:true}).texts,seen);
});
test('the two guards live in ownerDecisions and the call passes visitedSome',()=>{
 assert(agent.includes('visitedAny: !out.property_id && visitedIds.size > 0, visitedSome: visitedIds.size > 0,'));
});
test('«اسمك الكريم ؟» stuck inside the sold line moves before the last question',()=>{
 // 307af714: «نستفسر عن هذا الإعلان» for the Al Haram villa that was sold
 const h=[IN('نستفسر عن هذا الإعلان')];
 let r=decide(['الفيلا اللي سألت عنها في الهرم بـ 62 الف انباعت\nاسمك الكريم ؟','بس عندنا توين فيلا في الرميس بـ 59 الف متوفرة حالياً\nالسعر: 59,000 ريال عماني','متى يناسبك تزور ؟'],h);
 assert.deepEqual(r.texts,['الفيلا اللي سألت عنها في الهرم بـ 62 الف انباعت','بس عندنا توين فيلا في الرميس بـ 59 الف متوفرة حالياً\nالسعر: 59,000 ريال عماني','اسمك الكريم ؟','متى يناسبك تزور ؟']);
 assert.equal(r.out.guard_name_last,true);
 // no question at the end: it goes last
 r=decide(['الفيلا ما متوفره حالياً\nاسمك الكريم ؟','عندنا بيت في الحيل الجنوبية بـ 130 الف'],h);
 assert.deepEqual(r.texts,['الفيلا ما متوفره حالياً','عندنا بيت في الحيل الجنوبية بـ 130 الف','اسمك الكريم ؟']);
 // the name question as its own message, or in the last message, is left where it is (R20: the owner's first reply starts with it)
 for(const t of [['اسمك الكريم ؟','ارسل تفاصيل البيت كاملة والمستندات والسعر اللي في بالك اذا ما عليك امر'],['الفيلا ما متوفره حالياً','اسمك الكريم ؟\nفي اي منطقة تبحث ؟']])
  assert.deepEqual(decide(t,h).texts,t);
});
