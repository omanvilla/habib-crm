'use strict';
// 18 Nov 2026: decision 74 (step-3 template v3 on Muscat) and decision 77 (step F, the client who wrote to the wrong branch
// number is moved to the right one), docs/مراجعة-القرارات-20261118.md. SQL140.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const read=p=>fs.readFileSync(p,'utf8');
const tpl=read('supabase/functions/whatsapp-visit-templates/index.ts');
const sql=read('db/changes/140-step3-v3-branch-transfer.forward.sql'),back=read('db/changes/140-step3-v3-branch-transfer.rollback.sql');
const out=read('supabase/functions/whatsapp-outreach/index.ts');
const fn=read('supabase/functions/whatsapp-visit-followup-auto/index.ts');
const pick=(src,start,end)=>{const a=src.indexOf(start);assert(a>=0,start);return src.slice(a,src.indexOf(end,a)+end.length);};

test('the two texts Ahmed approved on 18 Nov go to Meta as written, with examples and quick replies',()=>{
  assert(tpl.includes('visit_followup_3_ar_v3: "السلام عليكم بخصوص زيارتك للعقار يوم {{1}} لين الحين تدور على عقار ؟"'));
  assert(tpl.includes('branch_transfer_ar_v1: "السلام عليكم بخصوص استفسارك عن عقار في {{1}} هذا رقم فرع {{2}} المسؤول عن المنطقة تقدر تكمل معنا هنا"'));
  assert(tpl.includes('visit_followup_3_ar_v3: ["15 أكتوبر"], branch_transfer_ar_v1: ["الرميس", "بركاء"]'));
  assert(tpl.includes('visit_followup_3_ar_v3: ["نعم", "لا"], branch_transfer_ar_v1: ["تمام"]'));
  assert(tpl.includes('{ type: "BUTTONS", buttons: BUTTONS[name].map((t) => ({ type: "QUICK_REPLY", text: t })) }'));
  assert(tpl.includes('components: templateComponents(name, text, example) }'));
  assert(tpl.includes('for (const { name, text, example } of wanted) {'));
  // no comma, no full stop in either text (owner style)
  for(const t of ['السلام عليكم بخصوص زيارتك للعقار يوم','السلام عليكم بخصوص استفسارك عن عقار في'])assert(!/[،,.!]/.test(tpl.split(t)[1].split('"')[0]));
});

test('SQL140: step 3 on Muscat takes v3 only once Meta approved it there as UTILITY; Barka keeps its choice',()=>{
  assert.match(sql,/WHEN p_step = 3 AND p_route = 'muscat' AND EXISTS \(SELECT 1 FROM public\.whatsapp_template_registry t\s+WHERE t\.route_key = p_route AND t\.template_name = 'visit_followup_3_ar_v3'\s+AND upper\(t\.status\) = 'APPROVED' AND upper\(t\.category\) = 'UTILITY'\) THEN 'visit_followup_3_ar_v3'/);
  assert(sql.includes("= 'visit_followup_3_ar_v3' THEN 'السلام عليكم بخصوص زيارتك للعقار يوم {{1}} لين الحين تدور على عقار ؟'"));
  assert(sql.includes("'أكتوبر'"));
  assert.match(sql,/CREATE TRIGGER crm_visit_followup_fill_day BEFORE INSERT ON public\.whatsapp_visit_followups/);
  assert(back.includes('DROP TRIGGER IF EXISTS crm_visit_followup_fill_day'));
});

test('the follow-up send gives the v3 template the visit day as its variable',()=>{
  const src=[pick(fn,'const AR_MONTHS','\n'),pick(fn,'const arDayMonth','\n')].join('\n').replace(/: unknown/g,'');
  const arDayMonth=new Function(src+';return arDayMonth;')();
  assert.equal(arDayMonth('2026-10-15'),'15 أكتوبر');
  assert.equal(arDayMonth('2026-01-03'),'3 يناير');
  assert.equal(arDayMonth(null),'');
  assert(fn.includes('if (!service && f.template_name === STEP3_V3_TPL && !day)'));
  assert(fn.includes('...(param ? { components: [{ type: "body", parameters: [{ type: "text", text: param }] }] } : {})'));
  assert(fn.includes('if (!service && !utility) return "waits_for_utility_template";'));
});

test('step F queue: right route only, never a company number, once in 30 days, service role only',()=>{
  const q=pick(sql,'CREATE OR REPLACE FUNCTION public.crm_branch_transfer_queue','$function$;\n');
  assert(q.includes("p_to_route = c.route_key THEN"));
  assert(q.includes("'company_number'"));
  assert(q.includes("q.kind = 'branch_transfer'")&&q.includes("interval '30 days'"));
  assert(q.includes("'السلام عليكم بخصوص استفسارك عن عقار في ' || v_area || ' هذا رقم فرع ' || v_branch || ' المسؤول عن المنطقة تقدر تكمل معنا هنا'"));
  for(const f of ['crm_branch_transfer_queue(uuid, text, text)','crm_branch_transfer_target(uuid)','crm_branch_transfer_close_source(uuid)']){
    assert(sql.includes(`REVOKE ALL ON FUNCTION public.${f} FROM PUBLIC, anon, authenticated;`),f);
    assert(sql.includes(`GRANT EXECUTE ON FUNCTION public.${f} TO service_role;`),f);
  }
  // it waits for the agent's own line on the wrong number, and drops after 24 hours without it
  const t=pick(sql,'CREATE OR REPLACE FUNCTION public.crm_branch_transfer_target','$function$;\n');
  assert(t.includes("m.direction = 'outbound' AND m.message_timestamp >= q.created_at - interval '1 minute'"));
  assert(t.includes("reason = 'source_reply_not_sent'"));
  // closing the wrong number touches only what waited there before the transfer, never sent messages or the chat
  const c=pick(sql,'CREATE OR REPLACE FUNCTION public.crm_branch_transfer_close_source','$function$;\n');
  assert.equal((c.match(/AND status = 'pending' AND created_at <= q\.created_at/g)||[]).length,2);
  assert(!/DELETE|whatsapp_conversations|whatsapp_messages/.test(c));
});

test('step F send: template only when APPROVED + UTILITY, company numbers refused, wrong number closed after',()=>{
  assert(out.includes('db.rpc("crm_branch_transfer_target", { p_queue: r.id })'));
  assert(out.includes('String(t.status).toUpperCase() === "APPROVED" && String(t.category).toUpperCase() === "UTILITY"'));
  assert(out.includes('!(transfer ? utilityTpl : approvedTpl).has(`${r.route_key}|${r.template_name}`)'));
  assert(out.includes('if (!to || company.includes(to))'));
  assert(out.includes('if (transfer) { const cs = await db.rpc("crm_branch_transfer_close_source", { p_queue: r.id });'));
  // still only 9am to 9pm, and still never to a chat Ahmed holds
  assert(out.includes('if (h < 9 || h >= 21) return { sent: 0, reason: "outside_sending_hours" };'));
  assert(out.includes('db.rpc("crm_chat_hold", { p_conversation: r.conversation_id })'));
});
