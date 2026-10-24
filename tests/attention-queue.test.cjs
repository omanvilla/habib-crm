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
test('AI suggestion only fills the form; saving still goes through the classifier',()=>{
  assert(js.includes("supa.functions.invoke('inquiry-ai-suggest'"));
  assert(!/inquiry-ai-suggest[\s\S]{0,400}crm_classify_inquiry/.test(js.slice(js.indexOf('async function suggest('),js.indexOf('async function suggestBatch('))));
  assert(js.includes("currentProfile.role==='owner'?'<button type=\"button\" class=\"btn-secondary crm-attention-batch\""));
});
test('AI function checks caller access with RLS and keeps the Instagram catalog owner-only',()=>{
  const fn=fs.readFileSync('supabase/functions/inquiry-ai-suggest/index.ts','utf8');
  assert.match(fn,/userClient\.from\("whatsapp_conversations"\)/);
  assert.match(fn,/profile\.role === "owner"\s*\n\s*\? admin\.from\("instagram_media_catalog"\)/);
  assert.match(fn,/if \(profile\.role !== "owner"\) return json\(\{ ok: false, error: "owner_only" \}, 403\)/);
  assert(!fn.includes('metaSend'),'never sends WhatsApp messages');
});
test('SQL43 keeps cross-branch saved links for staff and records every automatic resolution',()=>{
  const s43=fs.readFileSync('db/changes/43-saved-link-reconcile.forward.sql','utf8');
  assert.match(s43,/w\.route_key IN \('barka','muscat'\) AND p\.branch_key IS DISTINCT FROM w\.route_key\) THEN CONTINUE/);
  assert.match(s43,/INSERT INTO crm_repair_private\.sql43_auto_resolved/);
  assert.match(s43,/handoff_reason IN \('استفسار عن عقار يحتاج تحديده وربطه بالعقار الصحيح','استفسار عن عقار محدد يحتاج تحديده'\)/);
});
