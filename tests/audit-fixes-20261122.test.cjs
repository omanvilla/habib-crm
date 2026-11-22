'use strict';
// 22 Nov 2026, the open findings of the reply audit (Ahmed: «تابع ملاحظات كلاود وعدلها»).
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

test('R22: the nearest home above the budget asks «تقدر تزيد شوي ؟» (اسماء الهنائي 35bb3ae0)',()=>{
 const reel='https://www.instagram.com/reel/DeYyyoRis2i/';
 const r=decide(['بـ60 الف ما عندنا فيلا متوفره الحين الصراحة','اقرب شي عندنا في الصومحان الجنوبية بـ69 الف مساحة الارض 400م والبناء 300م وتتكون من 4 غرف نوم ومجلس وصالة عائلية ومطبخ و6 دورات مياه وجلسات خارجية',reel],[IN('ما تتعدى ٦٠ الف'),IN('اسماء الهنائي')]);
 assert.equal(r.out.guard_budget_question,true);assert.equal(r.texts[r.texts.length-1],'تقدر تزيد شوي ؟');
 // a question already there, or no «اقرب شي»: untouched
 assert.equal(decide(['حالياً ما عندنا بيت بحدود 60 الف','اقرب شي عندنا فيلا في الصومحان الجنوبية بـ 69 الف تقدر تزيد شوي ؟'],[IN('الميزانيه حدود ٦٠')]).out.guard_budget_question,undefined);
 assert.equal(decide(['بـ74 الف ما عندنا حاليا فيلا متوفره في الرميس او النخيل','اول ما يتوفر بتواصل معك'],[IN('ما يزيد اكثر من 74 النهائي')]).out.guard_budget_question,undefined);
});
test('R45: the meeting invitation ends with «يناسبك ؟» (احمد الشريف d4d12e25)',()=>{
 const t=['العرض الحالي في مدينة السلطان هيثم بدون دفعة مقدمة وساري لين 30 نوفمبر 2026','الاسعار تختلف حسب الوحدة والمساحة والمرحلة','الافضل نرتب لك اجتماع مع المطور الأهلي صبور في مكتبهم بالعذيبة ونشرح لك الوحدات المتوفرة وجدول الدفع'];
 const r=decide(t,[IN('هل يوجد عندكم فلل بالتقسيط وبدون دفعة اولي\nوما هي الية التقسيط')],{category:'investor'});
 assert.equal(r.out.guard_invite_question,true);assert.equal(r.texts[r.texts.length-1],'يناسبك ؟');
 assert.equal(decide([...t,'يناسبك ؟'],[IN('فلل؟')],{category:'investor'}).out.guard_invite_question,undefined);
});
test('«كيف الحال ؟» gets «الحمدلله» (Azza 4b7e6a19)',()=>{
 const r=decide(['حالياً ما عندنا فلل متوفره في الرميس او حلبان','في حدود كم ميزانيتك ؟'],[IN('مـسـآ آلخ ـير'),IN('كيف الحال ؟'),IN('متوفر معكم فلل ف الرميس او حي عاصم او حلبان ؟')]);
 // on the first line, never a message of its own (live check of v106: a 4th message made the trimming drop the offer)
 assert.deepEqual(r.texts,['الحمدلله\nحالياً ما عندنا فلل متوفره في الرميس او حلبان','في حدود كم ميزانيتك ؟']);
 assert.deepEqual(decide(['وعليكم السلام ورحمة الله وبركاته','تفضل'],[IN('السلام عليكم كيفك')]).texts,['وعليكم السلام ورحمة الله وبركاته','الحمدلله\nتفضل']);
 assert.deepEqual(decide(['وعليكم السلام ورحمة الله وبركاته'],[IN('السلام عليكم كيفك')]).texts,['وعليكم السلام ورحمة الله وبركاته\nالحمدلله']);
 // no question about the state, an empty reply, or «الحمدلله» already there: untouched
 assert.equal(decide(['تفضل'],[IN('مساء الخير')]).out.guard_how_are_you,undefined);
 assert.deepEqual(decide([],[IN('كيف الحال')]).texts,[]);
 assert.equal(decide(['الحمدلله بخير','تفضل'],[IN('كيف الحال')]).out.guard_how_are_you,undefined);
});
test('R45: «ان شاء الله» after the invitation «… يناسبك ؟» is a yes (علي من الأحواز 2d32eee8)',()=>{
 const inv=OUT('الاسعار تختلف حسب الوحدة والمساحة والمرحلة\n\nالافضل نرتب لك اجتماع مع المطور الأهلي صبور في مكتبهم بالعذيبة ونعرض لك الوحدات المتوفرة وجدول الدفع\n\nيناسبك ؟');
 assert.equal(D.meetingYes([IN('للسكن، مع اهلي ان شاء الله'),inv,IN('هل يمكنك أن تعرض لي بعض الفيديوهات عن الفيلا من فضلك؟'),IN('ان شاء الله')]),'developer');
 assert.equal(D.meetingYes([inv,IN('تمام')]),'developer');
 assert.equal(D.meetingYes([OUT('نرتب لك اجتماع اونلاين مع المكتب'),OUT('يناسبك ؟'),IN('اوكي')]),'online');
 // no, later, thinking, nothing said, or our last message was not an invitation: null
 for(const s of ['لا مشكور','ان شاء الله بشوف وارد عليك','بعدين ان شاء الله','ما يناسبني الحين','كم السعر ؟']) assert.equal(D.meetingYes([inv,IN(s)]),null,s);
 assert.equal(D.meetingYes([inv]),null);
 assert.equal(D.meetingYes([OUT('متى يناسبك تزور ؟'),IN('ان شاء الله')]),null);
 assert.match(agent,/const place = meetingYes\(history\);/);
 // it runs before the under-57,000 check (decisions 10 and 11), so that check can still hold the booking
 assert(agent.indexOf('const place = meetingYes(history);')<agent.indexOf('out.guard_under_57 = true;'));
});
test('R9: the investor line is not followed by the Step F branch line (f0b8d16b)',()=>{
 const src=[pickA('const BRANCH_OLD_RE','\n'),pickA('const BRANCH_NEW_RE','\n'),pickA('function transferArea','\n}\n'),pickA('function branchTransferLines','\n}\n')].join('\n')
  .replace('(raw: unknown, branch: string)','(raw, branch)')
  .replace('(out: any, here: unknown, prop: any, branchOf: (k: any) => { name: string; number: string } | null)','(out, here, prop, branchOf)')
  .replace('const hit: { to: string; area: string }[] = []','const hit = []').replace('const req: string[] =','const req =')
  .replace('(to: string, owner: boolean, named: unknown)','(to, owner, named)').replace('(t: any)','(t)')
  .replace('branchOf(to)!;','branchOf(to);').replace(/n!\[/g,'n[');
 const btl=new Function(src+';return branchTransferLines;')();
 const branchOf=k=>k==='barka'?{name:'بركاء',number:'92344273'}:k==='muscat'?{name:'مسقط',number:'71770030'}:null;
 const lines=['الاستثمار والمشاريع تتابعها معنا على رقم مسقط 71770030 واتساب','هذا الرقم خاص لعقارات بركاء'];
 assert.equal(btl({reply_messages:lines,category:'investor',branch_transfer:{to:'muscat',area:'سلطنة عمان'}},'barka',null,branchOf),null);
 // a buyer's branch_transfer still adds its line
 assert.ok(btl({reply_messages:['تفضل'],category:'buyer',branch_transfer:{to:'muscat',area:'الحيل'}},'barka',null,branchOf));
});
test('R14 is checked again on the Step F lines (محمد الزدجالي 35b4ef9e)',()=>{
 assert.match(agent,/analysis\.r14_branch_line = true/);
 assert(agent.indexOf('analysis.r14_branch_line = true')>agent.indexOf('const stepF = branchTransferLines('));
});
test('last check: a nearest-home offer left with no question gets one; a general villa search is not told «الفيلا اللي سألت عنها انحجزت»',()=>{
 assert.match(agent,/texts\.push\(\/\[0-9٠-٩\]\/\.test\(String\(burstSaid \|\| ""\)\) \|\| out\.request\?\.budget_max \? "تقدر تزيد شوي ؟" : "متى يناسبك تزور ؟"\)/);
 assert(agent.indexOf('out.guard_budget_question = true;\n    }\n    // keep the question')>0);
 assert.match(agent,/if \(goneVilla && general\) \{/);
});
