'use strict';
// SQL164 (27 Nov 2026): recommendations 1, 2, 3, 5 of the full audit.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const read = f => fs.readFileSync(require('path').join(__dirname, '..', f), 'utf8');
const sql = read('db/changes/164-audit-followups.forward.sql');
const back = read('db/changes/164-audit-followups.rollback.sql');

test('waiting customers: one task per person, only its own tasks, nothing sent', () => {
  assert(sql.includes('CREATE TABLE IF NOT EXISTS crm_repair_private.waiting_tasks'));
  assert(/UPDATE public\.tasks tk SET done = true[\s\S]+FROM crm_repair_private\.waiting_tasks x/.test(sql), 'closes only tasks it made');
  assert(sql.includes("d.status = 'pending'") && sql.includes("d.error = 'no_reply_needed'"), 'skips Ahmed-approval and no-reply-needed chats');
  assert(sql.includes("'17 4-14/2 * * 0-4'"));
  assert(!/net\.http_post[\s\S]{0,400}whatsapp-send/.test(sql) && !/INSERT INTO public\.notifications/.test(sql));
  assert(!/REVOKE ALL/.test(sql), 'REVOKE ALL makes the connector ask for a confirmation nobody answers');
});

test('call list: answered studies first, then unanswered «study ready», with a reason', () => {
  assert(sql.includes("st.owner_reaction IN ('accepted', 'counter_offer')"));
  assert(sql.includes("ORDER BY (x->>'prio')::int, x->>'created_at' DESC"));
  const js = read('crm-calls-meetings.js');
  assert(js.includes("x.why?' · <b class=\"ccm-why\">'+esc(x.why)+'</b>'"));
  assert(read('index.html').includes('crm-calls-meetings.js?v=20261127-why1'));
});

test('load: price-study tick only when queued, sheet sync every 15 minutes, rollback restores both', () => {
  assert(/where exists \(select 1 from public\.whatsapp_automation_events e[\s\S]+'queued', 'sending'/.test(sql));
  assert(sql.includes("schedule := '*/15 * * * *'") && back.includes("schedule := '*/5 * * * *'"));
});

test('office: a job that never ran shows «ينتظر أول تشغيل»', () => {
  assert(sql.includes("WHEN rn.last_run IS NULL THEN 'soon'"));
  assert(read('crm-office.js').includes("w.status==='soon'?['off','ينتظر أول تشغيل']"));
  assert(read('index.html').includes('crm-office.js?v=20261127-soon1'));
});

test('the migration mirror is byte-identical', () => {
  assert.strictEqual(read('supabase/migrations/20261127140000_audit_followups.sql'), sql);
});
