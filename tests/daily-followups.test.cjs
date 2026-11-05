'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const js=fs.readFileSync('crm-followups-today.js','utf8'),fn=fs.readFileSync('supabase/functions/whatsapp-visit-followup-auto/index.ts','utf8'),agent=fs.readFileSync('supabase/functions/whatsapp-reply-agent/index.ts','utf8'),index=fs.readFileSync('index.html','utf8');
const sql=fs.readFileSync('db/changes/64-daily-followups-list.forward.sql','utf8');

test('the button opens the client chat with the prepared text',()=>{
 assert(js.includes("'https://wa.me/'+d+'?text='+encodeURIComponent(text||'')"));
 assert.match(index,/crm-followups-today\.js\?v=/);
});
test('a message from a person takes the client off the list',()=>{
 assert(sql.includes("WHEN (new.direction = 'outbound' AND new.actor_type = 'human')"));
});
test('a branch account sees its own branch only',()=>{
 assert(sql.includes('WHERE v_owner OR crm_repair_private.staff_can_access_branch(v_company, i.route_key)'));
});
test('nothing goes out by itself before 10am the next day, and at most 20 a day',()=>{
 assert(sql.includes("+ 1) + time '10:00'"));
 assert(fn.includes('if (Date.now() < autoAfter(f.created_at)) continue;'));
 assert(fn.includes('DAILY_LIMIT = 20'));
});
test('marketing cost never goes out by itself, and a failed send stays on the list',()=>{
 assert(fn.includes('if (!service && !utility) return "waits_for_utility_template";'));
 assert(fn.includes('status: "awaiting_approval", error: why'));
});
test('the agent carries on after a message from the list, and stays quiet after any other',()=>{
 assert(agent.includes('if (!review && staffInChat && !fromList)'));
});
