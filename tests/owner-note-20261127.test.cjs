'use strict';
// 27 Nov 2026, Ahmed's note on Achar Delight («طلب اللوكيشن وبيروح يزور ليش ما رسلتله ؟»).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const agent=fs.readFileSync('supabase/functions/whatsapp-reply-agent/index.ts','utf8').replace(/\r\n/g,'\n');
const pickFrom=(src)=>(start,end)=>{const a=src.indexOf(start);assert(a>=0,'missing: '+start);const b=src.indexOf(end,a);assert(b>a,'no end: '+start);return src.slice(a,b+end.length);};
const pickA=pickFrom(agent);
const strip=(s)=>s.replace(/(\w+): (?:string|any|unknown|number)(?:\[\])?(?=[,)])/g,'$1').replace(/\) as (?:any|string|number)(?:\[\])?\)/g,'))').replace(/\): string\[\] \| null \{/g,') {').replace(/\): string \| null \{/g,') {');
const dsrc=['const THEIR_OFFICE','const ASK_CONFIRM','const WE_SHOW','const MY_OWN','const SILENT_TYPES','const COMMISSION_ASK','const COMMISSION_BUYER_LINES','const COMMISSION_OWNER_LINES','const ASK_LINK','const areaKey','const BOOKING_ASK','const BOOKING_NOT','const ASK_HOUR','const NEEDS_AHMED','const VIDEO_PROMISE','const FAREWELL','const FIXED_PRICE_LINE','const IG_CODE','const UNKNOWN_Q','const LOCATION_ASK','const AREA_REASON','const OUTSIDE_LOOK','const locationForArea','const LOCATION_HELD','const AREA_LINES','const INSIDE_VIDEO_ASK','const LAYOUT_ASK','const LAYOUT_LINES','const OUR_HOUR','const HOUR_SAID','const OWNER_TIME_LINE','const DEPOSIT_SAID','const REASON_Q','const VISIT_Q','const R66_DETAILS_ASK','const R66_GENERIC','const INVITE_RE','const MEETING_YES','const MEETING_NO']
 .map((s)=>pickA(s,'\n')).join('')+pickA('function nearBarka','\n}\n')+pickA('function soldNoticeYes','\n}\n')+pickA('function meetingYes','\n}\n')+pickA('function ownerDecisions','\n}\n');
const D=new Function(strip(dsrc)+';return {ownerDecisions,meetingYes};')();
const IN=(b)=>({direction:'inbound',body:b,message_type:'text'}),OUT=(b)=>({direction:'outbound',body:b});

const decide=(texts,history,out,c)=>{const o={action:'none',category:'buyer',...(out||{})};const burst=[];for(const h of history){if(h.direction==='outbound')burst.length=0;else if(h.body)burst.push(h.body);}
 const t=D.ownerDecisions(o,texts,{history,burstSaid:burst.join(' '),prop:null,visitedProp:false,visitedAny:false,saidVisited:false,handoffOpen:false,hardHandoff:false,...(c||{})});return {out:o,texts:t};};
const prop={id:'p1',visit_method:'open',map_url:'https://maps.google.com/?q=23.657852,57.896679'};
test('«ف حدود س ٥» is an hour: the location goes with no «كم الساعة تقريباً ؟» (Achar Delight df33354a)',()=>{
 const r=decide(['البيت مفتوح تقدر تشوفه اليوم الساعة 5'],[IN('ممكن اللوكيشن \nاليوم ف حدود س ٥ بروح اشوفها')],{action:'send_location',property_id:'p1'},{prop});
 assert.equal(r.out.guard_hour_asked,undefined);assert.equal(r.out.guard_period_hour,undefined);
 assert.ok(!r.texts.some((t)=>/كم\s*الساع/.test(t)));assert.equal(r.texts[0],'البيت مفتوح تقدر تشوفه اليوم الساعة 5');
});
test('«ساعه 5» and «حوالي ٤» are hours too; «بكره» alone still gets the hour question',()=>{
 for(const said of ['بكره ساعه 5 ممكن اللوكيشن','ممكن اللوكيشن بجي حوالي ٤']){
  const r=decide(['البيت مفتوح تقدر تشوفه بكره الساعة 4 العصر'],[IN(said)],{action:'send_location',property_id:'p1'},{prop});
  assert.equal(r.out.guard_hour_asked,undefined,said);
 }
 const r=decide(['البيت مفتوح تقدر تشوفه بكره الساعة 4 العصر'],[IN('ممكن اللوكيشن بكره')],{action:'send_location',property_id:'p1'},{prop});
 assert.equal(r.out.guard_hour_asked,true);assert.ok(r.texts.some((t)=>/كم\s*الساع/.test(t)));
 // a price or a count is not an hour
 const p=decide(['البيت مفتوح تقدر تشوفه بكره الساعة 4 العصر'],[IN('سعره 69 ولا ممكن اللوكيشن بكره')],{action:'send_location',property_id:'p1'},{prop});
 assert.equal(p.out.guard_hour_asked,true);
});
