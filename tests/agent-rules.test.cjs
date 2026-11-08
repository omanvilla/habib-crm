'use strict';
// Ahmed's fixed reply-agent rules (docs/agent-rules.md). A change that breaks one of these must be asked first.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const agent=fs.readFileSync('supabase/functions/whatsapp-reply-agent/index.ts','utf8');
const brain=fs.readFileSync('supabase/functions/whatsapp-reply-agent/brain.ts','utf8');
const fu=fs.readFileSync('supabase/functions/whatsapp-visit-followup-auto/index.ts','utf8');
const outreach=fs.readFileSync('supabase/functions/whatsapp-outreach/index.ts','utf8');
const inbox=fs.readFileSync('supabase/functions/whatsapp-inbox/index.ts','utf8');
const sql=fs.readFileSync('db/changes/20261108_owner_hold_visit_first_APPLIED.sql','utf8');
const rules=fs.readFileSync('docs/agent-rules.md','utf8');

test('R1: a chat Ahmed typed in stays with him until he hands it back, for the agent and every follow-up',()=>{
 assert(sql.includes('create or replace function public.crm_chat_hold'));
 assert(agent.includes('db.rpc("crm_chat_hold"'));
 assert(!agent.includes('STAFF_GRACE_MS'),'the 6 Nov "carry on after 30 seconds" rule was replaced by R1');
 assert(fu.includes('db.rpc("crm_chat_hold"'));
 assert(outreach.includes('db.rpc("crm_chat_hold"'));
 assert(inbox.includes('agent_returned_at:nowIso'));
});
test('R2: no negotiation before a visit; a price question before it books the visit',()=>{
 assert(brain.includes('ما في تفاوض على أي عقار قبل ما العميل يزوره'));
 assert(agent.includes('NEGOTIATION_HANDOFF.test'));
 assert(agent.includes('"شوف العقار أول واذا ناسبك نتكلم في السعر"'));
 assert(agent.includes('زيارات العميل المسجلة'));
});
test('R3: a negotiation handoff is not closed by a staff reply',()=>{
 assert(sql.includes('and not crm_repair_private.is_hard_handoff(c.handoff_reason)'));
 assert(sql.includes('and not crm_repair_private.is_hard_handoff(NEW.handoff_reason)'));
});
test('the rules file keeps the change procedure',()=>{
 assert(rules.includes('اسأل أحمد قبل التعديل'));
});
