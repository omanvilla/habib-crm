'use strict';
// SQL171 (28 Nov 2026, Ahmed «نعم للكل»): the documents reminder also reaches C-graded owners who sent nothing since the grade.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const fwd=fs.readFileSync('db/changes/171-owner-docs-grade-c.forward.sql','utf8');
const back=fs.readFileSync('db/changes/171-owner-docs-grade-c.rollback.sql','utf8');
const mirror=fs.readFileSync('supabase/migrations/20261128100000_owner_docs_grade_c.sql','utf8');
test('SQL171 is mirrored; rollback is the ungraded-only reminder',()=>{
  assert.equal(fwd,mirror);
  assert(back.includes("WHERE l.status = 'open' AND l.doc_grade IS NULL AND l.created_at > now() - interval '21 days'"));
  assert(!back.includes('v_ref'));
});
test('C offers: nothing sent after the grade, not a rental, silence counted from the grade',()=>{
  assert(fwd.includes("l.doc_grade = 'C' AND l.doc_graded_at IS NOT NULL"));
  assert(fwd.includes("!~ '(تأجير|ايجار|إيجار)'"));
  assert(fwd.includes('m2.message_timestamp > l.doc_graded_at'));
  assert(fwd.includes("v_ref := CASE WHEN r.doc_grade = 'C' THEN greatest(coalesce(r.ask_at, '-infinity'), r.doc_graded_at) ELSE r.ask_at END;"));
});
test('the holds and offers from buyer requests stay out',()=>{
  assert(fwd.includes('AND l.source_request_id IS NULL'));
  assert(fwd.includes('CONTINUE WHEN public.crm_chat_hold(r.conv_id) IS NOT NULL;'));
  assert(fwd.includes('NOT coalesce(c.agent_muted, false)'));
});
