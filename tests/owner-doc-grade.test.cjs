// SQL152 + R112 (Ahmed 21 Nov 2026): document grade A/B/C on every owner offer, and the short materials questionnaire.
const test=require('node:test'),assert=require('node:assert'),fs=require('fs');
const read=p=>fs.readFileSync(p,'utf8');
const fwd=read('db/changes/152-owner-doc-grade.forward.sql'),rb=read('db/changes/152-owner-doc-grade.rollback.sql');
const ui=read('crm-price-studies.js'),brain=read('supabase/functions/whatsapp-reply-agent/brain.ts');
test('the migration copy matches and nothing is dropped',()=>{
  assert.equal(fwd,read('supabase/migrations/20261121120000_owner_doc_grade_20261121.sql'));
  assert(!/DROP\s+TABLE|DELETE\s+FROM|DROP\s+COLUMN/i.test(fwd+rb));
});
test('the grade lives on the offer, only A, B or C, set by a function nobody signed in can call',()=>{
  assert(fwd.includes("doc_grade text CHECK (doc_grade IN ('A', 'B', 'C'))"));
  assert(fwd.includes('REVOKE ALL ON FUNCTION public.crm_price_study_grade(uuid, text, jsonb, text) FROM public, anon, authenticated;'));
  assert(fwd.includes("replace(d, 's.office_outreach,', 's.office_outreach, l.doc_grade, l.doc_checklist, l.doc_grade_note,')"));
});
test('the studies screen shows the grade and what is missing',()=>{
  assert(ui.includes("C:'ناقص الملكية أو الكروكي: لا دراسة ولا عرض لين تكمل الأوراق'"));
  assert(ui.includes('+gradeLine(i)+outreachLine(i)'));
  assert(read('index.html').includes('crm-price-studies.js?v=20261121-grade1'));
});
test('R112: one question about age and warranty for buildings, brands are never asked',()=>{
  assert(brain.includes('"البيت كم عمره تقريباً ؟ وفيه ضمان من المقاول على الانشائي او العزل ؟"'));
  assert(brain.includes('نوع التشطيب والأدوات الصحية والمكيفات والماركات لا تسأل عنها'));
});
