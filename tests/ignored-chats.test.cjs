'use strict';
// R40 / R41 / R42 (Ahmed, 12 Nov 2026): ignored chats, a question the agent cannot answer, a fixed price after the visit.
const test=require('node:test');const assert=require('node:assert');const fs=require('fs');
const read=f=>fs.readFileSync(f,'utf8');
const agent=read('supabase/functions/whatsapp-reply-agent/index.ts');
const brain=read('supabase/functions/whatsapp-reply-agent/brain.ts');
const sql=read('db/changes/98-ignored-chats.forward.sql');
const rb=read('db/changes/98-ignored-chats.rollback.sql');
const home=read('crm-owner-home.js');
const base=read('app-base-v15.html');
test('R40: the agent marks jobs, broker sign-ups, foreign brokers, banks and service offers as ignored and says nothing',()=>{
  assert(agent.includes('"unclear", "ignore"]'));
  assert(agent.includes('ignore_kind: { type: ["string", "null"], enum: ["job", "broker_signup", "foreign_broker", "bank", "service", null] }'));
  assert(agent.includes('required: ["reply_messages", "category", "ignore_kind",'));
  assert(agent.includes('if (ignored) { out.reply_messages = []; out.action = "none"; out.handoff_reason = null; }'));
  assert(agent.includes('agent_muted: true, agent_muted_reason: `متجاهل: ${IGNORE_LABEL[out.ignore_kind]}`, ignored_at: now'));
  for(const k of ['job: يطلب وظيفة','broker_signup: يبي يتسجل وسيط','foreign_broker: وسيط أو شركة من برا عمان','bank: موظف بنك','service: يعرض علينا خدمة'])assert(brain.includes(k),k);
  assert(!brain.includes('لا ترد بشي أبداً.\n- اللي يطلب مساعدة مالية')||brain.includes('ignore_kind=job'));
});
test('R40: the ignored chats leave the paused list, have their own list and can be given back',()=>{
  assert(sql.includes('and c.ignored_at is null'));
  assert(sql.includes("'ignored', (select count(*)"));
  assert(sql.includes('CREATE OR REPLACE FUNCTION public.crm_ignored_chats()'));
  assert(sql.includes('CREATE OR REPLACE FUNCTION public.crm_set_chat_ignored(p_conversation uuid, p_ignored boolean)'));
  assert(sql.includes('REVOKE ALL ON FUNCTION public.crm_set_chat_ignored(uuid, boolean) FROM PUBLIC, anon;'));
  assert(rb.includes('DROP FUNCTION IF EXISTS public.crm_ignored_chats();')&&!rb.includes('ignored_at is null'));
  assert(home.includes("data-coh=\"ptoggle-ignored\"")&&home.includes("supa.rpc('crm_ignored_chats')"));
  assert(home.includes("data-coh=\"pignore\"")&&home.includes("data-coh=\"punignore\"")&&home.includes("supa.rpc('crm_set_chat_ignored'"));
});
test('R41: a question with no written answer gets no reply and a hard handoff with its own tab',()=>{
  assert(agent.includes('const HARD_HANDOFF = /^\\s*(تفاوض|مشتري جاد|دراسة سعر|سؤال ما عندي جوابه|اجتماع)\\s*:/;'));
  assert(agent.includes('if (out.action === "handoff" && UNKNOWN_Q.test(String(out.handoff_reason || ""))) out.reply_messages = [];'));
  assert(brain.includes('handoff_reason يبدأ بـ "سؤال ما عندي جوابه:"'));
  assert(!brain.includes('"السموحة ما عندي معلومة مؤكدة عن [الشي]"'));
  assert(sql.includes("(تفاوض|مشتري جاد|دراسة سعر|سؤال ما عندي جوابه)"));
  assert(sql.includes("then 'unknown_q'")&&home.includes("unknown_q:'سؤال ما يعرف جوابه'"));
});
test('R42: the price can be fixed or negotiable; the agent reads it and the form saves it',()=>{
  assert(sql.includes("CHECK (price_negotiable IS NULL OR price_negotiable IN ('fixed','negotiable'))"));
  assert(sql.includes('    t.unit_label,\n    t.price_negotiable\n'));
  assert(agent.includes('p.price_negotiable === "fixed" ? " | السعر: ثابت"'));
  assert(brain.includes('"بالنسبة للسعر نعم ثابت لهذه [الفيلا / البيت / الشقة / الأرض]"'));
  assert(base.includes('id="pPriceNego"')&&base.includes("price_negotiable:$('pPriceNego')?($('pPriceNego').value||null):null,"));
  assert(base.includes('"relisted_at", "unit_label", "price_negotiable", "electricity_connected", "water_connected"]')&&base.includes('relisted_at,unit_label,price_negotiable,electricity_connected,water_connected"'));
});
