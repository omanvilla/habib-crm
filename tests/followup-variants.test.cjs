'use strict';
// R36 / SQL93 (11 Nov 2026, Ahmed): A/B comparison of follow-up wordings. A is today's wording and stays the default;
// another wording works only after Ahmed wrote it, approved it on the screen and Meta approved its template on both numbers.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const fwd=fs.readFileSync('db/changes/93-followup-variants.forward.sql','utf8');
const back=fs.readFileSync('db/changes/93-followup-variants.rollback.sql','utf8');
const mirror=fs.readFileSync('supabase/migrations/20261112120000_followup_variants_20261111.sql','utf8');
const fn=fs.readFileSync('supabase/functions/whatsapp-visit-followup-auto/index.ts','utf8');
const tpl=fs.readFileSync('supabase/functions/whatsapp-visit-templates/index.ts','utf8');
const ui=fs.readFileSync('crm-followup-variants.js','utf8');
const list=fs.readFileSync('crm-followups-today.js','utf8');
const index=fs.readFileSync('index.html','utf8');
const rules=fs.readFileSync('docs/agent-rules.md','utf8');

test('SQL93 is mirrored and replaces no existing function',()=>{
  assert.equal(fwd,mirror);
  assert(fwd.includes('SQL93 ('));
  assert(!/CREATE OR REPLACE/.test(fwd),'only new objects: nothing live is replaced');
  assert(fwd.includes('CREATE TABLE public.whatsapp_followup_variants'));
  assert(fwd.includes("CHECK (status IN ('proposed', 'testing', 'winner', 'retired'))"));
  assert(fwd.includes('min_sample integer NOT NULL DEFAULT 20'));
  assert(fwd.includes('ALTER TABLE public.whatsapp_visit_followups ADD COLUMN variant_label text;'));
  assert(fwd.includes('ALTER TABLE public.whatsapp_outreach_queue ADD COLUMN variant_label text;'));
});
test('A is today\'s wording (R29, R35) and the default',()=>{
  assert(fwd.includes("('visit_step1', 'السلام عليكم كيف شفت {العقار} وايش انطباعك عنه ؟', 'visit_followup_1_ar_v2')"));
  assert(fwd.includes("('request_followup', E'بخصوص طلبك {الموضوع}\\nلين الحين تبحث ؟', 'request_followup_ar_v2')"));
  assert(fwd.includes("IF coalesce(v_tests, 0) = 0 THEN RETURN 'A'; END IF;"),'no live test wording: always A');
  assert(fwd.includes("IF v.label = 'A' THEN RAISE EXCEPTION 'variant_default'"),'A cannot be stopped');
});
test('a test wording needs Ahmed\'s approval and a UTILITY template approved on both numbers',()=>{
  assert(fwd.includes("VALUES (v_company, p_kind, v_label, v_text, 'proposed', auth.uid())"),'a new wording is only proposed');
  assert(fwd.includes("l.status IN ('testing', 'winner')"));
  assert(fwd.includes("AND upper(t.status) = 'APPROVED' AND upper(t.category) = 'UTILITY') = 2"),'both Barka and Muscat');
  assert(fwd.includes("AND (l.label = 'A' OR crm_repair_private.followup_variant_usable(p_company, l.template_name))"));
  for(const f of ['crm_followup_variant_save','crm_followup_variant_decide','crm_followup_variant_results'])
    assert(new RegExp('FUNCTION public\\.'+f+'\\([^)]*\\)[\\s\\S]{0,400}?owner_only').test(fwd),f+' is owner only');
  assert(fwd.includes('REVOKE ALL ON FUNCTION public.crm_followup_variants_settle() FROM PUBLIC, anon, authenticated;'));
});
test('same rule as the pinned replies: the winner 8 times in 10, the rest keep testing; winner only after the sample',()=>{
  assert(fwd.includes('IF v_winner IS NOT NULL AND random() < 0.8 THEN RETURN v_winner; END IF;'));
  assert(fwd.includes('ORDER BY crm_repair_private.followup_variant_used(p_company, p_kind, l.label, v_since), random()'));
  assert(fwd.includes("< v.min_sample THEN RAISE EXCEPTION 'variant_sample_small'"));
  assert(fwd.includes('CREATE UNIQUE INDEX whatsapp_followup_variants_one_winner'));
});
test('the triggers only label a row, and an error leaves the row as it was',()=>{
  assert.equal((fwd.match(/EXCEPTION WHEN OTHERS THEN\n  RETURN NEW;/g)||[]).length,2);
  assert(fwd.includes("IF NEW.step = 1 AND NEW.status = 'awaiting_approval' AND NEW.variant_label IS NULL THEN"));
  assert(fwd.includes("IF NEW.kind = 'request_followup' AND NEW.status = 'pending' AND NEW.template_name = 'request_followup_ar_v2'"));
  assert(fwd.includes('CREATE TRIGGER variant_assign_visit_followup BEFORE INSERT ON public.whatsapp_visit_followups'));
  assert(fwd.includes('CREATE TRIGGER variant_assign_request_followup BEFORE INSERT ON public.whatsapp_outreach_queue'));
});
test('a new wording follows the fixed writing rules',()=>{
  for(const e of ['variant_english','variant_number','variant_greeting','variant_promise','variant_banned_word','variant_one_question','variant_placeholder','variant_agent_unknown','variant_placeholder_edge','variant_duplicate','variant_limit'])
    assert(fwd.includes("'"+e+"'"),e);
  assert(fwd.includes("v_text !~ 'كيف\\s*شفت|قدرت[يوا]*\\s*تشوف'"),'the visit wording keeps the words the reply agent knows (R16)');
  const agent=fs.readFileSync('supabase/functions/whatsapp-reply-agent/index.ts','utf8');
  assert(agent.includes('const AFTER_VISIT_Q = /كيف\\s*لقي|كيف\\s*شفت|قدرت[يوا]*\\s*تشوف/;'),'if this changes, change variant_agent_unknown with it');
});
test('results are split Barka / Muscat / investors: sent, replied in 48 hours, visit, deal',()=>{
  assert(fwd.includes("FROM (VALUES ('barka'), ('muscat'), ('investor')) AS x(lane)"));
  assert(fwd.includes("w.message_timestamp <= s.sent_at + interval '48 hours'"));
  assert(fwd.includes('crm_repair_private.followup_lane('));
  for(const k of ["'sent'","'replied'","'visits'","'deals'"])assert(fwd.includes(k));
  assert(fwd.includes('f.variant_label IS NOT NULL'),'only follow-ups given a wording are counted');
});
test('rollback puts waiting follow-ups back on A and drops everything SQL93 added',()=>{
  assert(back.indexOf('UPDATE public.whatsapp_visit_followups')<back.indexOf('DROP TABLE IF EXISTS public.whatsapp_followup_variants'));
  for(const f of fwd.match(/CREATE FUNCTION ([a-z_.]+)\(/g).map(x=>x.slice(16,-1)))assert(back.includes('DROP FUNCTION IF EXISTS '+f+'('),f);
  assert(back.includes('DROP TRIGGER IF EXISTS variant_assign_visit_followup'));
  assert(back.includes('DROP TRIGGER IF EXISTS variant_assign_request_followup'));
  assert(back.includes('DROP COLUMN IF EXISTS variant_label'));
  assert(back.includes('whatsapp-visit-followup-auto -> 799141d'));
});

// the wording helpers, run as written in the function (types stripped)
function helpers(){
  const pick=name=>{const i=fn.indexOf(name);assert(i>=0,name);return i;};
  const from=pick('const GENERIC_VISIT_Q ='),named=fn.slice(from,fn.indexOf('async function reviewOne',from));
  const a=pick('const oneLine ='),b=fn.indexOf('// Which wording really went',a);
  const src=(named+fn.slice(a,b)).replace(/: string \| null/g,'').replace(/: (string|any|unknown)/g,'')+'\n({namedVisitQuestion,variantVisitQuestion,isVariantText,OPINION_Q});';
  return vm.runInNewContext(src,{});
}
test('A: the after-visit question is exactly what it was (R29)',()=>{
  const h=helpers();
  assert.equal(h.namedVisitQuestion('السلام عليكم قدرت تشوف العقار ؟','فيلا الرميس'),'السلام عليكم كيف شفت فيلا الرميس وايش انطباعك عنها ؟');
  assert.equal(h.namedVisitQuestion('السلام عليكم كيف لقيتي البيت ؟','بيت الحيل الجنوبية'),'السلام عليكم كيف شفتي بيت الحيل الجنوبية وايش انطباعك عنه ؟');
  // no wording row (A or no label): the text is returned untouched
  for(const t of ['السلام عليكم كيف شفت فيلا الرميس وايش انطباعك عنها ؟','السلام عليكم متى يناسبك تزور ؟',null])assert.equal(h.variantVisitQuestion(t,'فيلا الرميس',null),t);
});
test('B: the opinion question takes the test wording; a text written for one client is left alone',()=>{
  const h=helpers(),v={label:'B',text:'السلام عليكم كيف شفت {العقار} ناسبك ؟'};
  assert.equal(h.variantVisitQuestion('السلام عليكم كيف شفت فيلا الرميس وايش انطباعك عنها ؟','فيلا الرميس',v),'السلام عليكم كيف شفت فيلا الرميس ناسبك ؟');
  assert.equal(h.variantVisitQuestion('السلام عليكم قدرت تشوف العقار ؟','',v),'السلام عليكم كيف شفت العقار ناسبك ؟');
  assert.equal(h.variantVisitQuestion('السلام عليكم متى يناسبك تزور ؟','فيلا الرميس',v),'السلام عليكم متى يناسبك تزور ؟');
  assert(h.isVariantText('السلام عليكم كيف شفت فيلا الرميس ناسبك ؟',v.text,'{العقار}'));
  assert(!h.isVariantText('السلام عليكم متى يناسبك تزور ؟',v.text,'{العقار}'));
  assert(!h.isVariantText('السلام عليكم كيف شفت فيلا الرميس وايش انطباعك عنها ؟',v.text,'{العقار}'));
});
test('the follow-up function touches nothing for A and records which wording really went',()=>{
  assert(fn.includes('if (!l || l === "A") return null;'),'A and unlabelled rows read no wording');
  assert(fn.includes('if (kind === "visit" && Number(x.step) === 1 && !instruction) out.text = variantVisitQuestion('),'his instruction still wins');
  assert(fn.includes('const went = await sentVisitLabel(f, service, body).catch(() => undefined);'));
  assert(fn.includes('...(went === undefined ? {} : { variant_label: went })'));
  assert(fn.includes('...(q.variant_label ? { variant_label: null } : {})'),'review text inside the window is no wording\'s result');
  assert(fn.includes('await db.rpc("crm_followup_variants_settle")'));
  assert(fn.indexOf('crm_followup_variants_settle')<fn.indexOf('await confirmBeforeVisit(rt.company_id'),'back to A before anything is read or sent');
  assert(fn.includes('.eq("template_name", "request_followup_ar_v2").select("id");'),'today\'s template is still updated first, exactly as before');
});
test('an approved test wording gets its template on both numbers through whatsapp-visit-templates',()=>{
  assert(tpl.includes('.in("status", ["testing", "winner"]).neq("label", "A")'));
  assert(tpl.includes('.replace("{الموضوع}", "{{1}}")'));
  assert(tpl.includes('for (const { name, text, example } of wanted) {'));
  assert(tpl.includes('visit_followup_1_ar_v2: "السلام عليكم كيف شفت العقار وايش انطباعك عنه ؟"'),'the fixed templates are unchanged');
  assert(fwd.includes("body := jsonb_build_object('action', 'create')"));
});
test('the screen: owner only, inside «متابعات اليوم», results and a box to add a wording',()=>{
  assert(index.includes('crm-followup-variants.js?v=20261112-ab1"><'+String.fromCharCode(92)+'/script>'),'loaded inside the boot script with an escaped closing tag');
  assert(index.indexOf('crm-followups-today.js?v=')<index.indexOf('crm-followup-variants.js?v='));
  assert(list.includes("window.crmFollowupVariantsMount(box)"));
  assert(ui.includes("const show=isOwner()&&!box.hidden&&"));
  assert(ui.includes("supa.rpc('crm_followup_variant_results')"));
  assert(ui.includes("supa.rpc('crm_followup_variant_save',{p_kind:kind,p_text:text})"));
  assert(ui.includes("supa.rpc('crm_followup_variant_decide',{p_id:id,p_action:action})"));
  for(const w of ['انرسل','رد خلال 48 ساعة','زيارة','صفقة','بركاء','مسقط','المستثمرين','أضف صياغة','جرّبها','ثبّتها فايزة'])assert(ui.includes(w),w);
  assert(!/\b(alert|confirm|prompt)\(/.test(ui),'no browser dialogs: a second tap confirms');
});
test('R36 is recorded, R29 and R35 stay wording A, and no scenario still invites to the Mawaleh office',()=>{
  assert(rules.includes('| R36 |'));
  assert(rules.includes('R29 (سؤال بعد الزيارة) و R35 (قالب «بخصوص طلبك {الموضوع} لين الحين تبحث ؟») هم الصياغة A وما تغيروا'));
  assert(rules.includes('| R29 |')&&rules.includes('| R35 |'));
  const scenarios=rules.slice(rules.indexOf('## سيناريوهات لازم تنجح قبل أي نشر'));
  assert(!scenarios.includes('عزيمة المكتب في الموالح'));
  assert(!scenarios.includes('meeting {office,'));
  assert(scenarios.includes('مكتبهم بالعذيبة'));
  assert(scenarios.includes('| R36: ما في صياغة B معتمدة (الوضع العادي) |'));
});
