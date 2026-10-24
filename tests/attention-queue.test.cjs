'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const js=fs.readFileSync('crm-attention.js','utf8');
const sql=fs.readFileSync('db/changes/42-attention-queue.forward.sql','utf8');
const index=fs.readFileSync('index.html','utf8');
test('loader includes the attention module and stylesheet',()=>{
  assert.match(index,/crm-attention\.js\?v=/);assert.match(index,/crm-attention\.css\?v=/);
});
test('queue rows deep-link to the exact conversation and escape CRM text',()=>{
  assert(js.includes("openDashboardWhatsAppConversation(id)"));
  for(const field of ['row.name','row.sample','row.handoff_reason','row.conversation_id'])assert(js.includes('esc('+field),field);
  assert(!/innerHTML\s*=[^;]*\+\s*row\.(name|sample)\b/.test(js));
});
test('SQL keeps branch and investment separation on both functions',()=>{
  assert.match(sql,/v_owner OR crm_repair_private\.can_access_whatsapp_conversation\(v_company, c\.id\)/);
  assert.match(sql,/IF NOT crm_repair_private\.can_access_whatsapp_conversation\(v_company,w\.id\) THEN RAISE EXCEPTION 'not_assigned'/);
  assert.match(sql,/crm_repair_private\.staff_can_access_branch\(pr\.company_id,pr\.branch_key\)/);
  assert.match(sql,/REVOKE ALL ON FUNCTION public\.crm_classify_inquiry\(uuid,text,uuid\[\],text,uuid\[\]\) FROM PUBLIC, anon/);
  assert.match(sql,/REVOKE ALL ON FUNCTION public\.crm_attention_queue\(integer,integer\) FROM PUBLIC, anon/);
  assert.equal((sql.match(/SET search_path TO ''/g)||[]).length,2);
});
test('an explicit customer request for a person is not cleared by classification',()=>{
  assert.match(sql,/p_kind='non_real_estate' OR coalesce\(w\.handoff_reason,''\) LIKE '%تحديد%'/);
});
