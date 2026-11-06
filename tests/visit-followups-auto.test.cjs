'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const fn=fs.readFileSync('supabase/functions/whatsapp-visit-followup-auto/index.ts','utf8'),brain=fs.readFileSync('supabase/functions/whatsapp-reply-agent/brain.ts','utf8');
const sql=fs.readFileSync('db/changes/63-visit-followups-automatic.forward.sql','utf8');

test('only free text in the window goes out by itself',()=>{
 assert(fn.includes('if (!service) return "window_closed";'));
});
test('company numbers never message each other, and paused or handed-over chats wait',()=>{
 assert(fn.includes('numbers.includes(to)'));
 assert(fn.includes('client.followup_suppressed || client.archived || conv.agent_muted || conv.human_handoff_required'));
});
test('a client who wrote after the follow-up was prepared gets no follow-up',()=>{
 assert(fn.includes('return stop("superseded", "client_wrote_after")'));
});
test('it can be stopped and keeps to sending hours',()=>{
 assert(fn.includes('!rt.visit_followups_auto'));assert(fn.includes('hour < 9 || hour >= 21'));
});
test('passed visits are limited to the last 30 days, and none while a new visit is booked',()=>{
 assert(sql.includes("::date - 30"));assert(sql.includes('NOT EXISTS (SELECT 1 FROM public.viewings nx'));
});
test('negotiation gets no reply and goes to Ahmed',()=>{
 assert(brain.includes('التفاوض لأحمد بس. لا ترد عليه بأي شي'));
 assert(!brain.includes('"تمام بشوف مع المالك وارد عليك"، و action=handoff'));
});
test('interior photos of an occupied home get the fixed reply after checking the property',()=>{
 assert(brain.includes('البيت حالياً مسكون عشان كذا ما صورناه من الداخل'));
 assert(brain.includes('"الزيارة: المالك ساكن"'));
});
