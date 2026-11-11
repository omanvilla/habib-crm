'use strict';
// SQL90 (12 Nov 2026): step 1 of the visit follow-up gets a version 2 Meta template without «كيف لقيته».
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const fwd=fs.readFileSync('db/changes/90-visit-followup-1-v2.forward.sql','utf8');
const mirror=fs.readFileSync('supabase/migrations/20261112090000_visit_followup_1_v2_20261112.sql','utf8');
const tpl=fs.readFileSync('supabase/functions/whatsapp-visit-templates/index.ts','utf8');
test('SQL90 adds the step-1 version 2 text, guarded and mirrored byte for byte',()=>{
  assert.equal(fwd,mirror);
  assert(fwd.includes("SQL90 ("));
  assert(fwd.includes("'fb45d5491d5e7c9e7f6daa7aba4b0232'"));
  assert(fwd.includes("WHEN p_step = 1 THEN 'السلام عليكم كيف شفت العقار وايش انطباعك عنه ؟'"));
  assert(!/لقيت/.test(fwd.replace(/^--.*$/mg,'')));
});
test('the template submitter knows visit_followup_1_ar_v2 with the same text',()=>{
  assert(tpl.includes('visit_followup_1_ar_v2: "السلام عليكم كيف شفت العقار وايش انطباعك عنه ؟"'));
});
