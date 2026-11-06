'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const js=fs.readFileSync('crm-followups-today.js','utf8'),fn=fs.readFileSync('supabase/functions/whatsapp-visit-followup-auto/index.ts','utf8'),agent=fs.readFileSync('supabase/functions/whatsapp-reply-agent/index.ts','utf8'),index=fs.readFileSync('index.html','utf8');
const sql=fs.readFileSync('db/changes/64-daily-followups-list.forward.sql','utf8');

test('the button opens the client chat with the prepared text',()=>{
 assert(js.includes("'https://wa.me/'+d+'?text='+encodeURIComponent(text||'')"));
 assert.match(index,/crm-followups-today\.js\?v=/);
});
test('the button asks for WhatsApp Business on the phone',()=>{
 assert(js.includes('package=com.whatsapp.w4b'));
 assert(js.includes("'whatsapp-smb://send?phone='"));
});
test('nothing is on the list or sent before its chat is read; closed topics leave',()=>{
 const review=fs.readFileSync('db/changes/65-followup-review.forward.sql','utf8');
 assert(review.includes("f.status = 'awaiting_approval' AND f.reviewed_at IS NOT NULL"));
 assert(fn.includes('if (!f.reviewed_at || !f.auto_ok || Date.now() < autoAfter(f.reviewed_at)) continue;'));
 assert(fn.includes('out.auto_ok = false;'));
 assert(fn.includes('out.text.slice(0, out.text.indexOf("؟") + 1)'));
 const clock=fs.readFileSync('db/changes/66-followup-wait-from-review.forward.sql','utf8');
 assert(clock.includes('public.crm_followup_auto_after(i.reviewed_at)'));
 assert(fn.includes('enum: ["followup", "skip", "wait_for_match"]'));
 assert(fn.includes('[رسالة صوتية قديمة ما انقرت]'));
});
test('silence after getting the details is not a reason to follow up; the preview writes nothing',()=>{
 assert(fn.includes('سكوته جواب'));
 const body=fn.slice(fn.indexOf('async function preview('),fn.indexOf('async function reviewAll('));
 assert(body.includes('.is("reason", null)'));
 assert(!body.includes('.update(')&&!body.includes('.insert('));
});
test('90 minutes after a visit: free text only, and nothing if someone already wrote',()=>{
 const sql=fs.readFileSync('db/changes/68-followup-after-visit.forward.sql','utf8');
 assert(sql.includes("<= now() - interval '90 minutes'"));
 assert(sql.includes("li.last_in > now() - interval '23 hours 30 minutes'"));
 assert(sql.includes("li.last_in <= v.visit_at + interval '30 minutes'"));
 assert(sql.includes("m.actor_type = 'human' AND m.message_timestamp > v.visit_at + interval '30 minutes'"));
 assert(fn.includes('if (!service) return "window_closed";'));
 assert(fn.includes('await sendOne(f.data, numbers)'));
 assert(fn.includes('if (rt.visit_followups_auto) await afterVisit('));
});
test('a visit confirmation goes only inside the window, once, when a reply would still cover the visit',()=>{
 const sql=fs.readFileSync('db/changes/70-visit-confirm.forward.sql','utf8');
 assert(sql.includes("li.last_in + interval '24 hours' > now() + interval '10 minutes'"));
 assert(sql.includes("li.last_in + interval '24 hours' < v.visit_at + interval '90 minutes'"));
 assert(sql.includes("v.visit_at + interval '90 minutes' <= now() + interval '24 hours'"));
 assert(sql.includes("m.raw_payload->>'source' = 'visit_confirm'"));
 assert(fn.includes('await confirmBeforeVisit('));
 const part=fn.slice(fn.indexOf('async function confirmBeforeVisit('),fn.indexOf('async function sendOne('));
 assert(part.includes('type: "text"')&&!part.includes('type: "template"'));
});
test('a client the review removed does not come back through another request',()=>{
 const sql=fs.readFileSync('db/changes/67-followup-removed-stay-removed.forward.sql','utf8');
 assert(sql.includes('BEFORE INSERT ON public.whatsapp_outreach_queue'));
 assert(sql.includes("NEW.reason IS NOT NULL THEN RETURN NEW"));
 assert(sql.includes('RETURN NULL'));
});
test('a message from a person takes the client off the list',()=>{
 assert(sql.includes("WHEN (new.direction = 'outbound' AND new.actor_type = 'human')"));
});
test('a branch account sees its own branch only',()=>{
 assert(sql.includes('WHERE v_owner OR crm_repair_private.staff_can_access_branch(v_company, i.route_key)'));
});
test('nothing goes out by itself before 10am the next day',()=>{
 assert(sql.includes("+ 1) + time '10:00'"));
});
test('no paid template goes out by itself: it stays on his list; a failed send stays too',()=>{
 assert(!fn.includes('type: "template"'));
 assert(!fn.includes('status: "approved"'));
 assert(fn.includes('status: "awaiting_approval", error: why'));
});
test('the whole voice note is read before a follow-up reaches him',()=>{
 assert(fn.includes('short(body, 3000)'));
 assert(fn.includes('throw new Error("voice_note_pending")'));
});
test('the optional rented units note is a reference for the follow-ups and has a place on the form',()=>{
 const form=fs.readFileSync('crm-rented-units.js','utf8');
 assert(form.includes("update({rented_units:"));
 assert(fn.includes('المؤجر حالياً'));
 assert(index.includes('crm-rented-units.js?v='));
});
test('the agent asks a name once, never guesses, and notes when it was not given',()=>{
 const brain=fs.readFileSync('supabase/functions/whatsapp-reply-agent/brain.ts','utf8');
 assert(brain.includes('اسأله عن اسمه مرة وحدة بس'));
 assert(brain.includes('لا تناديه به ولا تخمن اسمه'));
 assert(agent.includes('ما ذكر اسمه، الاسم المسجل من الواتساب مو اسمه الحقيقي'));
 assert(agent.includes('"client_name_stated", "name_declined"]'));
 assert(agent.includes('rental_terms,rented_units"'));
});
test('the agent carries on after a message from the list, and stays quiet after any other',()=>{
 assert(agent.includes('if (!review && staffInChat && !fromList)'));
});
