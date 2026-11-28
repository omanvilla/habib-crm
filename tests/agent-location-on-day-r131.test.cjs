'use strict';
// R131 (Ahmed 28 Nov 2026): an open house gets its location as soon as the client says when he goes; an unsure day gets one
// soft line asking him to say it, for his own sake. Real chats of 28 Nov (Saud, «………..», فاحص كهرباء, ALWALEED).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const agent=fs.readFileSync('supabase/functions/whatsapp-reply-agent/index.ts','utf8').replace(/\r\n/g,'\n');
const pickA=(start,end)=>{const a=agent.indexOf(start);assert(a>=0,'missing: '+start);const b=agent.indexOf(end,a);assert(b>a,'no end: '+start);return agent.slice(a,b+end.length);};
const src=fs.readFileSync('tests/owner-decisions.test.cjs','utf8');
const list=src.match(/const dsrc=\[([^\]]*)\]/)[1];
const names=eval('['+list+']');
const dsrc=names.map((s)=>pickA(s,'\n')).join('')+pickA('const R66_DETAILS_ASK','\n')+pickA('const R66_GENERIC','\n')+pickA('function nearBarka','\n}\n')+pickA('function soldNoticeYes','\n}\n')+pickA('function ownerDecisions','\n}\n');
const D=new Function(dsrc.replace(/\): string\[\] \| null \{/g,'){').replace(/ as (?:string|any|unknown|number)(?:\[\])?(?=\))/g,'').replace(/(\w+): (?:string|any|unknown|number)(?:\[\])?(?=[,)])/g,'$1')+';return {ownerDecisions};')();
const IN=(b)=>({direction:'inbound',body:b}),OUT=(b)=>({direction:'outbound',body:b});
const MAP='https://maps.google.com/?q=23.697748,57.982735';
const PROP={id:'p',map_url:MAP,visit_method:'open',status:'available'};
const decide=(texts,history,out,c)=>{const o={action:'none',category:'buyer',...(out||{})};const burst=[];for(const h of history){if(h.direction==='outbound')burst.length=0;else burst.push(h.body);}
 const t=D.ownerDecisions(o,texts,{history,burstSaid:burst.join(' '),prop:PROP,visitedProp:false,visitedAny:false,saidVisited:false,handoffOpen:false,hardHandoff:false,...(c||{})});return {out:o,texts:t};};
const LOC='تفضل هذا الموقع، الفيلا مفتوحة تقدر تشوفها على راحتك';
const SOFT='واذا تأكدت من اليوم خبرني عشان اسجل لك الزيارة واتأكد ما في احد ثاني يزورها بنفس الوقت 🌷';

test('R131: a sure day today gets the location and the visit is noted',()=>{
 const r=decide(['تمام ان شاء الله','ان شاء الله برسلك الموقع'],[OUT('فيلا جديدة للبيع في الرميس بركاء'),OUT('متى يناسبك تزور ؟'),IN('اليوم العصر')]);
 assert.equal(r.out.action,'send_location',' (R130 takes «اليوم» first)');assert(r.texts.some((t)=>/تفضل هذا الموقع/.test(t)));assert(!r.texts.some((t)=>/برسلك/.test(t)));assert.equal(r.out.no_location_visit,undefined);
 const r1=decide(['تمام'],[OUT('متى يناسبك تزور ؟'),IN('بمر العصر')]);assert.equal(r1.out.action,'send_location');assert.equal(r1.out.no_location_visit,undefined);
});
test('R131: a vague day gets the location and the soft day line, and no visit at today\'s hour',()=>{
 const h=[IN('ممكن تفاصيل الفيلا'),IN('و اللوكيشن'),OUT('فيلا جديدة الرميس بركاء السعر 64 الف'),IN('والله يمكن الويكند الجاي'),IN('لانه حاليا م موجود')];
 const r=decide(['تمام خذ راحتك اذا تحدد يوم الزيارة والوقت خبرني'],h);
 assert.equal(r.out.action,'send_location');assert.deepEqual(r.texts,[LOC,SOFT]);assert.equal(r.out.no_location_visit,true);
 const r2=decide(['تمام خذ راحتك واذا عرفت الوقت المناسب خبرني'],[OUT('متى يناسبك تزور ؟'),IN('من ارجع من دوام اشوف اقرب فرصه وبجي اشوف لبيت')]);
 assert.deepEqual(r2.texts,[LOC,SOFT]);
});
test('R131: another day is sent without noting today',()=>{
 const r=decide(['تمام'],[OUT('متى يناسبك تزور ؟'),IN('بكره ان شاء الله')]);
 assert.equal(r.out.action,'send_location');assert.deepEqual(r.texts,['تمام',LOC]);assert.equal(r.out.no_location_visit,true);
 const r2=decide(['تمام'],[OUT('متى يناسبك تزور ؟'),IN('بكره ان شاء الله')],{viewing_date:'2026-11-29'});
 assert.equal(r2.out.no_location_visit,undefined,'a day the model resolved is noted');
});
test('R131: «ما يناسبني إلا الخميس» is a day, not a refusal',()=>{
 assert.equal(decide(['تمام'],[OUT('متى يناسبك تزور ؟'),IN('ما يناسبني الا الخميس')]).out.action,'send_location');
});
test('R131: left alone',()=>{
 const base=[OUT('متى يناسبك تزور ؟'),IN('بكره ان شاء الله')];
 assert.equal(decide(['تمام'],base,null,{prop:{...PROP,visit_method:null}}).out.action,'none','method not set');
 assert.equal(decide(['تمام'],base,null,{prop:{...PROP,visit_method:'owner_lives'}}).out.action,'none','owner lives');
 assert.equal(decide(['تمام'],base,null,{prop:{...PROP,status:'sold'}}).out.action,'none','not available');
 assert.equal(decide(['تمام'],[OUT(MAP),...base]).out.action,'none','sent before');
 assert.equal(decide(['تمام'],base,{category:'seller'}).out.action,'none','seller');
 assert.equal(decide(['تمام'],[OUT('متى يناسبك تزور ؟'),IN('اليوم ما اقدر')]).out.action,'none','day does not work');
 assert.equal(decide(['تمام'],[OUT('متى يناسبك تزور ؟'),IN('شكرا ما ناسبني')]).out.action,'none','not interested');
 assert.equal(decide(['x'],base,{action:'handoff',handoff_reason:'تفاوض على السعر'}).out.action,'handoff','other handoff');
 assert.equal(decide(['تمام'],[OUT('السعر 64 الف'),IN('تمام شكرا')]).out.action,'none','no day said');
 assert.equal(decide(['تمام'],[OUT('السعر 64 الف'),IN('اليوم شفت الاعلان')]).out.action,'none','a day word with no visit talk');
});
test('R131: wired into R11 and the visit block',()=>{
 assert(agent.includes('&& !TIME_SAID.test(recentIn) && !out.guard_location_on_day) {'));
 assert(agent.includes('!out.location_for_area && !out.no_location_visit && ["send_location"'));
});
