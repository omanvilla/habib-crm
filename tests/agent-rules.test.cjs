'use strict';
// Ahmed's fixed reply-agent rules (docs/agent-rules.md). A change that breaks one of these must be asked first.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const agent=fs.readFileSync('supabase/functions/whatsapp-reply-agent/index.ts','utf8');
const brain=fs.readFileSync('supabase/functions/whatsapp-reply-agent/brain.ts','utf8');
const knowledge=fs.readFileSync('supabase/functions/whatsapp-reply-agent/knowledge.ts','utf8');
const fu=fs.readFileSync('supabase/functions/whatsapp-visit-followup-auto/index.ts','utf8');
const outreach=fs.readFileSync('supabase/functions/whatsapp-outreach/index.ts','utf8');
const inbox=fs.readFileSync('supabase/functions/whatsapp-inbox/index.ts','utf8');
const sql=fs.readFileSync('db/changes/20261108_owner_hold_visit_first_APPLIED.sql','utf8');
const rules=fs.readFileSync('docs/agent-rules.md','utf8');

test('R1: a chat Ahmed typed in stays with him until he hands it back, for the agent and every follow-up',()=>{
 assert(sql.includes('create or replace function public.crm_chat_hold'));
 assert(agent.includes('db.rpc("crm_chat_hold"'));
 assert(!agent.includes('STAFF_GRACE_MS'),'the 6 Nov "carry on after 30 seconds" rule was replaced by R1');
 assert(fu.includes('db.rpc("crm_chat_hold"'));
 assert(outreach.includes('db.rpc("crm_chat_hold"'));
 assert(inbox.includes('agent_returned_at:nowIso'));
});
test('R2: no negotiation before a visit; a price question before it books the visit',()=>{
 assert(brain.includes('ما في تفاوض على أي عقار قبل ما العميل يزوره'));
 assert(agent.includes('NEGOTIATION_HANDOFF.test'));
 assert(agent.includes('"شوف العقار أول واذا ناسبك نتكلم في السعر"'));
 assert(agent.includes('زيارات العميل المسجلة'));
});
test('R3: a negotiation handoff is not closed by a staff reply',()=>{
 assert(sql.includes('and not crm_repair_private.is_hard_handoff(c.handoff_reason)'));
 assert(sql.includes('and not crm_repair_private.is_hard_handoff(NEW.handoff_reason)'));
});
test('R6: a sold property gets "sold" plus the nearest available one; twins only when the sizes match',()=>{
 assert(brain.includes('بعدها على طول اعرض أقرب عقار متاح للي سأل عنه'));
 assert(brain.includes('توين حقيقي'));
 assert(agent.includes('linkedSold'));
});
test('R9: investors and Muscat-area owners on the Barka number go to the Muscat number, nothing held',()=>{
 assert(agent.includes('redirectToMuscat'));
 // R9 as amended by Ahmed on 10 Nov: investors on the Muscat number are answered directly; only running deals wait for him.
 assert(agent.includes('!redirectToMuscat && out.category === "active_deal"'));
 assert(rules.includes('العقل يرد عليه مباشرة بدون انتظار موافقة'));
 assert(agent.includes('71770030'));
 assert(brain.includes('هذا الرقم خاص لعقارات بركاء'));
});
test('R10: inherited property is declined politely',()=>{
 assert(brain.includes('نعتذر منك احنا ما نستلم عقارات الورثة'));
});
test('the rules file keeps the change procedure',()=>{
 assert(rules.includes('اسأل أحمد قبل التعديل'));
});

// agent-prompt-sync copies the text between "= `" and the last backtick into whatsapp_agent_prompts (dry runs use the same regex).
const body=(s)=>{const m=s.match(/=\s*`([\s\S]*)`;?\s*$/);return m?m[1]:'';};
test('brain and knowledge stay one template string the prompt sync can read',()=>{
 for(const [name,src] of [['brain',brain],['knowledge',knowledge]]){
  assert.equal((src.match(/`/g)||[]).length,2,name+' is a single template literal');
  assert(!src.includes('${'),name+' has no interpolation');
  assert(body(src).length>1000,name+' body is long enough for agent-prompt-sync');
 }
 // 11 Nov 2026: R25–R31 grew it past 60,000; no hard limit downstream (compose_agent_brain only appends the lessons)
 assert(body(brain).length<66000,'the brain stays compact (Ahmed\'s open notes are appended after it)');
});
test('R18: only the figures Ahmed wrote; any other price gets the "it depends" line and a meeting',()=>{
 assert(knowledge.includes('57,000'),'Iconic Tower studio from 57,000');
 assert(knowledge.includes('30 نوفمبر 2026'),'the zero down payment offer and its end date');
 assert(knowledge.includes('الاسعار تختلف حسب الوحدة والمساحة والمرحلة'));
 assert(brain.includes('الاسعار تختلف حسب الوحدة والمساحة والمرحلة'));
 assert(!knowledge.includes('ما نذكر أي رقم عن مشروع'),'the 8 Nov no-figures rule was replaced by R18');
 assert(!brain.includes('وبرسل لك اخر جدول من المطور'),'a price question no longer ends in a silent handoff');
 assert(rules.includes('| R18 |'));
});
test('R18: Sabour\'s unreleased projects are named in no file (this test keeps only hashes of the names)',()=>{
 const crypto=require('node:crypto'),path=require('node:path');
 const SECRET=new Set(['69b7ac89d8b6ad734f85973a29449ec5b985ab733264f200bb84e97908738f9e','8f2346b0a320dfb595588c4a17db8782cf4ab25ddda7f48f912f13dbddcaf66a',
  '1389a795d06e45fb701f6a0346358d4f734a8b08b0064f65f0708e194f05524f','e1da408ecacc5444003fb2176176b0b89aa4ebc3463135cd85e2d36e088faf41',
  'd6ea0639122a60b912b22b6b18793e7505c5ddaa95a9bb1c09b750cdeacf60d8','2b4aa7eaf70a8d861403c308069a67313c7fef8831f3603890530fdd96d73385',
  '1406ccbdf9060d6b87378a912da20c3e8ffe2fd710e17966c7e84649d4df9e79','550867d3bcbb02f64b44bff3436bd7218deb721179444eb131235529e01f0cf6',
  '1d6717d20624c7d6dca15e40625edb3135f6710d60f48f22d84e7e5b9ab7464a','132c7c8344a9e85a5bb0ddbcdcaf733c366a0e2b986efd9d272ee703a6b344c8']);
 const sha=(w)=>crypto.createHash('sha256').update(w,'utf8').digest('hex');
 // the word after the valley prefix, without diacritics, alef forms, taa marbuta, alef maqsura or a leading article
 const norm=(w)=>w.replace(/[\p{M}\u0640]/gu,'').replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/^ال/,'').toLowerCase();
 const files=[];
 const walk=(d)=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){
  if(e.name==='.git'||e.name==='node_modules')continue;
  const p=path.join(d,e.name);
  // source files only: CI writes its *-output.txt reports into the checkout while the tests run
  if(e.isDirectory())walk(p);else if(/\.(ts|js|cjs|mjs|sql|md|html|css|json|ya?ml|sh|py)$/i.test(e.name))files.push(p);}};
 walk('.');
 const named=new Set();
 for(const f of files){
  const s=fs.readFileSync(f,'utf8');
  for(const m of s.matchAll(/وادي\s*["'«(]?\s*([\p{L}\p{M}]+)/gu))if(SECRET.has(sha(norm(m[1]))))named.add(f);
  for(const m of s.matchAll(/wadi[\s_-]*(?:al[\s_-]*)?([a-z]+)/gi))if(SECRET.has(sha(norm(m[1]))))named.add(f);
 }
 assert.deepEqual([...named],[],'these files name an unreleased project (R18, Ahmed 10 Nov): remove the name, do not respell it');
});
test('R19: the agent invites an interested lead itself and books the meeting with a soft handoff',()=>{
 assert(brain.includes('action=book_meeting'));
 assert(brain.includes('"اجتماع:"'));
 assert(brain.includes('المكتب في الموالح'));
 assert(agent.includes('"book_meeting"'),'the reply schema has the action the brain uses');
 assert(rules.includes('| R19 |'));
 // R19 covers an interested investor or project buyer on the Muscat number; anyone else asking to come by gets a reply and a
 // handoff with the time (R23), never a booking or a confirmation Ahmed did not give
 assert(brain.includes('على رقم مسقط بس: مستثمر أو مشتري مهتم بمشروع'));
 assert(brain.includes('handoff_reason يبدأ بـ "طلب موعد:"'));
 assert(!brain.includes('ولما يحدد نفس الشي (book_meeting)'),'a visitor or a Barka client is not booked at Mawaleh');
 assert(!brain.includes('book_meeting (place=office)'),'an owner is not booked: his old silent rule became R23, not R19');
 // the WhatsApp meeting alert is only claimed once whatsapp-owner-hot-alert accepts «اجتماع:» (it answers skipped:not_hot today)
 const hot=fs.readFileSync('supabase/functions/whatsapp-owner-hot-alert/index.ts','utf8');
 if(!/const HOT = [^\n]*اجتماع/.test(hot)){
  assert(!rules.includes('ينبه كمان على «اجتماع:»'),'R7 does not promise an alert the edge function skips');
  assert(rules.includes('فتنبيه الاجتماع على الواتساب لسا ما يشتغل'));
 }
});
test('R20: owner intake asks details, documents and price first; occupied or mortgaged is declined at once',()=>{
 assert(brain.includes('ارسل تفاصيل البيت كاملة والمستندات والسعر اللي في بالك اذا ما عليك امر'));
 assert(brain.includes('نعتذر منك احنا ما نستلم عقارات مرهونة او مسكونة'));
 assert(!brain.includes('سؤالين كل رسالة'),'the 8 Nov two-questions-per-message owner order was replaced by R20');
 assert(rules.includes('| R20 |'));
});
test('R21: "I will think and get back to you" gets a short reply without pressure; the follow-up asks once',()=>{
 assert(brain.includes('تمام خذ راحتك'));
 assert(!brain.includes('لا تتابعه، يبغى مساحة'),'the 9 Nov "do not follow up" line was replaced by R21');
 assert(rules.includes('| R21 |'));
});
test('R22: consultant loop, nearest alternative across branches, seriousness every turn',()=>{
 assert(brain.includes('ممنوع الاستبيان'));
 assert(brain.includes('اذا تقبل بركاء'));
 assert(brain.includes('seriousness_reason'));
 assert(brain.includes('ملف العميل'));
 assert(!brain.includes('سؤال واحد كل رسالة بالترتيب'),'the fixed investor question order is gone');
 assert(!knowledge.includes('كاش ولا أقساط. إذا أقساط كم يقدر شهرياً'));
 assert(agent.includes('seriousness_reason'),'the reply schema carries the seriousness the brain sets');
 assert(rules.includes('| R22 |'));
 // a project alternative (developer units, the zero down payment offer) is for the Muscat number only (R9, investment isolation)
 assert(brain.includes('رقم بركاء (R9): ما في بديل مشروع أبداً'));
 assert(brain.includes('وحدات المطور تنعرض على رقم مسقط بس'));
 assert(knowledge.includes('للرد على رقم مسقط بس'));
});
test('R23: only negotiation, serious buyer, price study, call request and running deals stay silent',()=>{
 assert(brain.includes('reply_messages=[] مع action=handoff بس في هالحالات'));
 assert(!brain.includes('أي handoff يكون reply_messages=[]'),'"every handoff is silent" was replaced by R23');
 assert(!brain.includes('اتأكد من وقت المكتب وارد عليك'),'a line PROMISE_RE deletes is not prescribed');
 assert(!brain.includes('خلني اتأكد لك من هالنقطة وارد عليك'),'a line PROMISE_RE deletes is not prescribed');
 assert(rules.includes('| R23 |'));
 // an open soft handoff (a booked meeting, the agent's own question) silences only urging or a repeated request
 assert(brain.includes('تسكت بس إذا العميل يستعجل أو يعيد نفس الطلب اللي ينتظر فيه أحمد'));
 // the agent's own question waits for the answer itself; an unknown property hands off with «ما عرفنا», which the 8 Nov auto-close knows
 assert(!brain.includes('handoff_reason يبدأ بـ "ريل مو مسجل:"'));
 assert(brain.includes('handoff_reason يبدأ بـ "ما عرفنا العقار:"'));
});
test('R24: an archived or withdrawn property is "not available now", never "sold", plus the nearest one',()=>{
 assert(brain.includes('عقارات ما عادت متوفرة (مو مباعة)'));
 assert(brain.includes('ما متوفره حالياً'));
 assert(!brain.includes('فلل الخوض اللي كانت باسم'),'the hand-written unavailable list is gone; the archive feeds it');
 assert(agent.includes('عقارات ما عادت متوفرة (مو مباعة)'),'the context block the brain relies on');
 assert(rules.includes('| R24 |'));
});
