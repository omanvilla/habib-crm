// SQL150 (Ahmed 21 Nov 2026): a study for an owner the office called stays inside the office when his price fits, and
// «دراسة سعر عقارك جاهزة نرسلها لك هنا ؟» is not sent any more.
const test=require('node:test'),assert=require('node:assert'),fs=require('fs');
const read=p=>fs.readFileSync(p,'utf8');
const fwd=read('db/changes/150-price-study-office-outreach.forward.sql'),rb=read('db/changes/150-price-study-office-outreach.rollback.sql');
const fn=read('supabase/functions/price-study/index.ts'),ui=read('crm-price-studies.js');

test('the migration file and the supabase copy are the same',()=>{
  assert.equal(fwd,read('supabase/migrations/20261121100000_price_study_office_outreach_20261121.sql'));
  assert(fwd.startsWith('-- SQL150 ('));
});
test('office_outreach comes from «اتصال المكتب» on the chat, set when the study is handed in',()=>{
  assert(fwd.includes("c.handoff_reason ilike 'اتصال المكتب%' or c.owner_alert_done_reason ilike 'اتصال المكتب%'"));
  assert(fwd.includes('BEFORE INSERT ON public.owner_price_studies'));
  assert(fwd.includes("'cancelled', 'kept_internal'"));
  assert(fwd.includes('s.office_outreach'),'the screen gets the flag');
  assert(rb.includes("WHERE status = 'kept_internal'"),'the rollback keeps those studies held, not lost');
});
test('a fitting price stays inside the office and opens «زيارة وتوقيع»; a higher price is sent',()=>{
  assert(fn.includes('if (s.office_outreach && (!ask || ask <= Number(s.asking_price || 0))) return await keptInternal(s, conv, lead, property, ask, "office");'));
  const k=fn.slice(fn.indexOf('async function keptInternal'),fn.indexOf('async function sentByPhone'));
  assert(k.includes('status: "kept_internal"'));
  assert(!k.includes('metaSend'),'nothing goes to the owner');
  assert(k.includes('زيارة وتوقيع'));
  assert(k.includes('.ilike("title", "زيارة وتوقيع%")'),'one open visit task per offer');
});
test('outside the 24-hour window only the full template goes (report as header), never the old question template',()=>{
  const out=fn.slice(fn.indexOf('if (!inWindow) {'),fn.indexOf('let textId'));
  assert(out.includes('const tpl = await fullTemplateApproved(conv.company_id, conv.route_key, kind);'));
  assert(out.includes('if (!tpl) return await set("approved", "template_not_approved");'));
  assert(out.includes('{ type: "header", parameters: [{ type: "document"'));
  assert(out.includes('const kind = s.office_outreach ? "high" : "full";'));
  assert(!out.includes('templateApproved(conv.company_id, conv.route_key);'),'the old question template is not used');
  assert(fn.includes('name: "owner_price_study_full_ar_v1"')&&fn.includes('name: "owner_price_study_high_ar_v1"'));
  assert(fn.includes('{ type: "HEADER", format: "DOCUMENT", example: { header_handle: [h.handle] } }'));
});
test('a villa or building gets no number before the inspection (21 Nov 2026); land is unchanged',()=>{
  assert(fn.includes('if (isBuilding(lead) && !(await inspected(s.task_id))) return await keptInternal(s, conv, lead, property, ask, "building");'));
  assert(fn.includes('const BUILDING_KINDS = new Set(["villa", "house", "building", "apartment", "twin_villa", "chalet", "resthouse", "shop", "farm"]);'));
  assert(!fn.slice(fn.indexOf('const BUILDING_KINDS'),fn.indexOf('const isBuilding')).includes('"land"'));
  assert(fn.includes('.from("owner_price_study_inspections").select("task_id,note,photos")'));
  assert(ui.includes('فيلا أو مبنى بدون معاينة: ما نرسل رقم للمالك قبل المعاينة.'));
});
test('the screen says what «موافق» does for an office-call owner',()=>{
  assert(ui.includes("if(i.status==='kept_internal')"));
  assert(ui.includes('من اتصال المكتب: المالك ما طلب دراسة.'));
  assert(ui.includes('held_by_ahmed_new_flow:'));
});
