'use strict';
// 18 Nov 2026: plan section 1 of docs/مراجعة-القرارات-20261118.md (Ahmed's answers, the numbers are the review's questions).
// Code guards in whatsapp-reply-agent/index.ts and the brain lines they back.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const agent=fs.readFileSync('supabase/functions/whatsapp-reply-agent/index.ts','utf8').replace(/\r\n/g,'\n');
const brain=fs.readFileSync('supabase/functions/whatsapp-reply-agent/brain.ts','utf8').replace(/\r\n/g,'\n');
const knowledge=fs.readFileSync('supabase/functions/whatsapp-reply-agent/knowledge.ts','utf8').replace(/\r\n/g,'\n');
const pickFrom=(src)=>(start,end)=>{const a=src.indexOf(start);assert(a>=0,'missing: '+start);const b=src.indexOf(end,a);assert(b>a,'no end: '+start);return src.slice(a,b+end.length);};
const pickA=pickFrom(agent);
const dsrc=['const THEIR_OFFICE','const ASK_CONFIRM','const WE_SHOW','const MY_OWN','const SILENT_TYPES','const COMMISSION_ASK','const COMMISSION_BUYER_LINES','const COMMISSION_OWNER_LINES','const ASK_LINK','const areaKey','const BOOKING_ASK','const BOOKING_NOT','const ASK_HOUR','const NEEDS_AHMED','const VIDEO_PROMISE','const FAREWELL','const FIXED_PRICE_LINE','const IG_CODE','const UNKNOWN_Q','const LOCATION_ASK','const AREA_REASON','const OUTSIDE_LOOK','const locationForArea','const LOCATION_HELD','const AREA_LINES','const INSIDE_VIDEO_ASK','const LAYOUT_ASK','const LAYOUT_LINES','const OUR_HOUR','const HOUR_SAID','const OWNER_TIME_LINE','const DEPOSIT_SAID','const REASON_Q','const VISIT_Q','const R66_DETAILS_ASK','const R66_GENERIC']
 .map((s)=>pickA(s,'\n')).join('')+pickA('function nearBarka','\n}\n')+pickA('function soldNoticeYes','\n}\n')+pickA('function ownerDecisions','\n}\n');
const D=new Function(dsrc.replace(/\): string\[\] \| null \{/g,'){').replace(/ as (?:string|any|unknown|number)(?:\[\])?(?=\))/g,'').replace(/(\w+): (?:string|any|unknown|number)(?:\[\])?(?=[,)])/g,'$1')+';return {ownerDecisions};')();
const IN=(b)=>({direction:'inbound',body:b,message_type:'text'}),OUT=(b)=>({direction:'outbound',body:b});
const decide=(texts,history,out,c)=>{const o={action:'none',category:'buyer',...(out||{})};const burst=[];for(const h of history){if(h.direction==='outbound')burst.length=0;else if(h.body)burst.push(h.body);}
 const t=D.ownerDecisions(o,texts,{history,burstSaid:burst.join(' '),prop:null,visitedProp:false,visitedAny:false,saidVisited:false,handoffOpen:false,hardHandoff:false,...(c||{})});return {out:o,texts:t};};

test('decision 17: a part of the day with no hour gets the location, then «كم الساعة تقريباً ؟» after the link',()=>{
 const open={id:'P1',visit_method:'open',map_url:'https://maps.app.goo.gl/TEST'};
 // the model held the location back and only asked the hour
 let r=decide(['كم الساعة تقريباً ؟'],[IN('بكره العصر')],{},{prop:open});
 assert.equal(r.out.action,'send_location');assert.deepEqual(r.texts,['البيت مفتوح تقدر تشوفه','كم الساعة تقريباً ؟']);assert.equal(r.out.guard_period_hour,true);
 r=decide(['كم الساعة تقريباً ؟'],[IN('بكره المغرب')],{},{prop:{...open,visit_method:'lockbox'}});assert.equal(r.out.action,'send_lockbox');
 // «الحين», a clock hour, the owner arranging it, a word that only contains «المسا»: untouched
 for(const said of ['بروح الحين','بكره العصر الساعة 5','كم المساحات'])assert.equal(decide(['كم الساعة تقريباً ؟'],[IN(said)],{},{prop:open}).out.guard_period_hour,undefined,said);
 assert.equal(decide(['كم الساعة تقريباً ؟'],[IN('بكره العصر')],{},{prop:{...open,visit_method:'owner_lives'}}).out.guard_period_hour,undefined);
 // the question goes after the location link in the one merged message
 assert(agent.includes('if (out.guard_period_hour && !redirectToMuscat) {'));
 assert(agent.indexOf('if (out.guard_period_hour && !redirectToMuscat) {')<agent.indexOf('const textParts = outgoingParts.filter('));
 assert(brain.includes('إذا قال فترة بس ("العصر"، "المغرب") بدون ساعة: خطوة 2 (اللوكيشن ينرسل) وبعده "كم الساعة تقريباً ؟" (قرار 17)'));
});

test('decisions 10 and 11: no meeting is booked over an unclarified Sultan Haitham price under 57,000',()=>{
 const block=pickA('    // decisions 10 and 11 (Ahmed 18 Nov 2026','    // R19 / R30 / R33 / R45: any meeting request')
  .replace(/\((\w+): (?:string|any)\)/g,'($1)').replace(/\((\w+): any, (\w+): number\)/g,'($1, $2)');
 const run=(history,o={},route='muscat')=>new Function('out','conv','history',block+'\nreturn out;')({action:'book_meeting',meeting:{place:'developer'},handoff_reason:'اجتماع: x',reply_messages:[],...o},{route_key:route},history);
 const INV='الافضل نرتب لك اجتماع مع المطور الأهلي صبور في مكتبهم بالعذيبة ونعرض لك الوحدات المتوفرة وجدول الدفع';
 // Faisal: the old 20,800 price, the invitation, then «ايوا»: the code used to book at once
 let o=run([IN('شقق وادي زها اللي كانت بـ20,800 لسا متوفرة؟'),OUT(INV+'\n\nيناسبك ؟'),IN('ايوا يناسبني')]);
 assert.equal(o.action,'none');assert.equal(o.handoff_reason,null);assert.equal(o.meeting,null);assert.equal(o.guard_under_57,true);
 assert.deepEqual(o.reply_messages,['المتوفر الحين في مدينة السلطان هيثم يبدأ من 57 الف','يناسبك ؟']);
 o=run([IN('ميزانيتي ٣٠ الف في مدينة السلطان هيثم'),OUT(INV),IN('تمام')]);assert.equal(o.guard_under_57,true,'a budget in Arabic digits');
 // once the office said it, or on the Barka number, or with no low figure: booked as before (R45)
 o=run([IN('شقق وادي زها اللي كانت بـ20,800'),OUT('المتوفر الحين في مدينة السلطان هيثم يبدأ من 57 الف\n\nيناسبك ؟'),IN('اوكي نرتب الاجتماع')]);assert.equal(o.action,'book_meeting');
 o=run([IN('شقق وادي زها اللي كانت بـ20,800'),OUT(INV),IN('ايوا')],{},'barka');assert.equal(o.action,'book_meeting');
 o=run([IN('الشراء بـ 50 الف يعطي إقامة ؟'),OUT(INV),IN('ايوا')]);assert.equal(o.action,'book_meeting','the residency figure is not a price');
 o=run([IN('عندي أرض 6000 م² ابي اعرضها في مدينة السلطان هيثم'),OUT(INV),IN('تمام')]);assert.equal(o.action,'book_meeting','a size is not a price');
 o=run([IN('ابي اجتماع عن عايدة ميزانيتي 40 الف')],{meeting:{place:'dar_global'}});assert.equal(o.action,'book_meeting','not a Sultan Haitham chat');
 assert(brain.includes('"يبدأ من 57 الف" بس للي يسأل عن مدينة السلطان هيثم'));
 assert(knowledge.includes('في مدينة السلطان هيثم المطور الوحيد اللي نشتغل معه الحين الأهلي صبور'));
 assert(knowledge.includes('57,000')&&!brain.includes('بس في مدينة السلطان هيثم عرض بدون دفعة مقدمة لين 30 نوفمبر'));
});

test('decision 15: the zero-down offer leaves the prompt and the reply from 1 Dec 2026; each mention is a line of its own',()=>{
 assert(agent.includes('const zeroDownOver = dayM >= "2026-12-01";'));
 const ZD=/بدون\s*دفع[ةه]\s*مقدم[ةه]|صفر\s*(ال)?مقدم|دفع[ةه]\s*صفر|zero\s*down/i;
 assert(agent.includes(ZD.source));
 // the lines that mention it carry nothing else Ahmed decided (the Barka rule, R18's figures, the two Sultan cities)
 for(const l of [...brain.split('\n'),...knowledge.split('\n')].filter((x)=>ZD.test(x)))assert(/^- (عرض صفر المقدم|مدينة السلطان هيثم: عرض بدون دفعة مقدمة|الاستثناء الوحيد للتاريخ)/.test(l),l.slice(0,80));
});

test('decisions 20, 21, 24, 27, 30, 69, 70: brain lines and code',()=>{
 // 20: Ahmed's water and electricity answer is read on its own, so the missing column never breaks a reply
 assert(agent.includes('.select("id,utilities_note")')&&agent.includes('الماي والكهرباء (جواب أحمد)'));
 assert(!/select\("id,title,[^"]*utilities_note/.test(agent),'not in the main property select');
 assert(brain.includes('شقق مدينة السلطان قابوس للإيجار: "الافضل تشوف الشقة اول"'));
 // 24: a location is no proof of a visit
 assert(brain.includes('اللوكيشن بروحه ما يكفي حتى لو انرسل، قرار 24'));
 assert(agent.includes('out.guard_fixed_from_start = true;'));
 // 27
 assert(brain.includes('مشتري بالبنك وما خلص أموره: بدون سؤال الزيارة (قرار 27)'));
 // 30: no «حياك», and a last pass takes commas out of what the code added
 assert(!agent.includes('"حياك الله خذ راحتك"')&&agent.includes('texts = ["تمام خذ راحتك"'));
 assert(agent.includes('.replace(/^\\s*حياك(\\s*الله)?(\\s+|$)/, "").replace(/[ \\t]*[،,][ \\t]*(?!\\d)/g, " ")'));
 // 69, 70, 22, 25, 12
 assert(!brain.includes('اذا سنحت الفرصة نجلس مع بعض')&&brain.includes('عميل يبي يجلس مع أحمد يستشيره (قرار 69)'));
 assert(brain.includes('إذا قال حصل: بدون رد ويوقف البحث (R50، قرار 70)'));
 assert(agent.includes('/لين الحين تبحث|نزل عندنا/.test(lastOutBody)'));
 assert(!brain.includes('فيلا الرميس 59')&&!brain.includes('بركاء، المصنعة'));
 assert(!brain.includes('الموضوع المحول "اجتماع:" وهو يسأل عن المشروع أو يغيّر الموعد: رد عادي'));
 assert(!brain.includes('وبيرد عليك واحد من الفريق'));
});

test('decision 42: a sold notice skipped because the client wrote opens the agent\'s first reply, once',()=>{
 assert(agent.includes('.eq("status", "skipped").in("reason", ["sold_client_wrote_after", "client_wrote_after"])'));
 assert(agent.includes('!props.some((p: any) => p.id === r.property_id)'),'only while the property is still gone');
 const at=(s)=>{const i=agent.indexOf(s);assert(i>=0,s);return i;};
 // added after the guards (the «never say sold about an available property» guard cannot drop it), before the send
 const add=at('if (soldLine && out.reply_messages.length && !ignored) {');
 assert(at('out.reply_messages = texts.slice(0, 3);')<add&&add<at('const wamid = await metaSend(tokens, phoneId, to, outgoing[i]);'));
 assert(agent.includes('if (!out.reply_messages.some((t: string) => /انحجز|انباع|ابتاع/.test(t))) out.reply_messages = [soldLine, ...out.reply_messages];'));
 // the model's own «انباعت» line about it gives way to the notice's wording («انحجزت»)
 assert(agent.includes('if (i >= 0 && out.reply_messages[i] !== soldLine) out.reply_messages[i] = soldLine;'));
 // marked only after a real send, and only when the final reply still says it
 const mark=at('update({ reason: "told_by_agent" })');
 assert(mark>at('const wamid = await metaSend(tokens, phoneId, to, outgoing[i]);'));
 assert(agent.includes('if (sentIds.length && !review && out.sold_told && out.reply_messages.some('));
});

test('decisions 67 and 68, and the private key-box photos (SQL137)',()=>{
 assert(!agent.includes('72 * 3600 * 1000'));
 assert(brain.includes('category=ignore و ignore_kind=not_real_estate (قرار 68: تنتجاهل بدون تنبيه)'));
 assert(agent.includes('async function lockboxLink(v: unknown): Promise<string> {')&&agent.includes('db.storage.from("property-keys").createSignedUrl(s, 600)'));
 assert(agent.includes('if (lockLink) actionMsgs.push({ type: "image", image: { link: lockLink } });'));
 assert(agent.includes('if (/^https:\\/\\//.test(s)) return s;'),'old https values still work');
 const f=fs.readFileSync('db/changes/139-zero-down-off.forward.sql','utf8').replace(/\r\n/g,'\n');
 assert.equal(f,fs.readFileSync('supabase/migrations/20261118084111_zero_down_off_20261118.sql','utf8').replace(/\r\n/g,'\n'));
 assert(f.includes("'5 20 30 11 *'")&&f.includes('SET active = false')&&f.includes("WHERE jobname = 'zero_down_pinned_off_20261201';\n$job$"));
 assert(!/\b(DELETE\s+FROM|DROP\s+(TABLE|FUNCTION|TRIGGER)|TRUNCATE)\b/i.test(f),'a deactivation, nothing removed');
});
