'use strict';
// SQL170 (28 Nov 2026): grade-C tasks with no new document show as waiting_docs, not «new», and are not «unpriced».
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const fwd=fs.readFileSync('db/changes/170-price-study-waiting-docs.forward.sql','utf8');
const back=fs.readFileSync('db/changes/170-price-study-waiting-docs.rollback.sql','utf8');
const mirror=fs.readFileSync('supabase/migrations/20261128090000_price_study_waiting_docs.sql','utf8');
test('SQL170 is mirrored and reversible',()=>{
  assert.equal(fwd,mirror);
  assert(!back.includes('waiting_docs'));
  assert(back.includes('CREATE OR REPLACE FUNCTION public.crm_price_study_queue()'));
  assert(back.includes('CREATE OR REPLACE FUNCTION public.crm_price_study_unpriced_due()'));
});
test('waiting_docs needs grade C, no inspection and nothing sent after the grade',()=>{
  const a=fwd.indexOf("case when s.id is null\n"),b=fwd.indexOf("then 'waiting_docs'");
  assert(a>0&&b>a);const c=fwd.slice(a,b);
  assert(c.includes("l.doc_grade = 'C'"));
  assert(c.includes('i.task_id is null'));
  assert(c.includes('coalesce(d.message_timestamp, d.created_at) > l.doc_graded_at'));
  assert(c.includes("m.message_type in ('image', 'document', 'video')"));
});
test('the columns of the queue did not change',()=>{
  const sig=s=>s.slice(s.indexOf('RETURNS TABLE('),s.indexOf(')\n LANGUAGE sql'));
  assert.equal(sig(fwd),sig(back));
});
test('the daily unpriced line leaves waiting_docs out',()=>{
  assert(fwd.includes("and t.id not in (select q.task_id from public.crm_price_study_queue() q where q.state = 'waiting_docs')"));
});
