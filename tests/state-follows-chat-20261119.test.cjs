// SQL148 (19 Nov 2026): CRM state follows the chat (visits on a gone property, stale handoffs, answered meetings).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const sql = fs.readFileSync('db/changes/148-crm-state-follows-chat.forward.sql', 'utf8');
const mig = fs.readFileSync('supabase/migrations/20261119110000_crm_state_follows_chat_20261119.sql', 'utf8');
const back = fs.readFileSync('db/changes/148-crm-state-follows-chat.rollback.sql', 'utf8');
const hot = fs.readFileSync('crm-hot-alerts.js', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');

test('the migration copy matches the change file, and nothing is deleted', () => {
  assert.strictEqual(mig, sql);
  assert(!/\bDELETE\s+FROM\b|\bTRUNCATE\b|\bDROP\s+TABLE\b/i.test(sql));
});

test('أ: a «انحجز / انباع» message cancels only coming visits on a sold or reserved property, with the reason', () => {
  assert.match(sql, /'\(انحجز\|انباع\|تم البيع\|تم الحجز\)'/);
  assert.match(sql, /p\.status IN \('sold', 'reserved'\)/);
  assert.match(sql, /v\.viewing_date >= v_today/);
  assert.match(sql, /وانبلغ العميل/);
  // a signed-in person can still put a visit back; only the system is held
  assert.match(sql, /IF auth\.uid\(\) IS NOT NULL OR NEW\.status NOT IN/);
});

test('ب: an old client message never renews a hot handoff or alerts again', () => {
  assert.match(sql, /NEW\.last_inbound_at <= OLD\.owner_alert_done_at/);
  assert.match(sql, /NEW\.handoff_updated_at := OLD\.handoff_updated_at/);
  assert.match(sql, /NEW\.is_read := true/);
  assert.match(sql, /AND NOT coalesce\(NEW\.is_read, false\)\)\s*\n\s*EXECUTE FUNCTION crm_repair_private\.hot_notification_to_whatsapp/);
  assert.match(back, /crm_hot_notification_to_whatsapp AFTER INSERT/);
});

test('ب: «عملاء يحتاجونك» shows who wrote last and when', () => {
  assert.match(sql, /'العميل'[\s\S]*'العقل'[\s\S]*'أحمد'/);
  assert.match(hot, /supa\.rpc\('crm_last_message_by_clients',\{p_clients:lc\}\)/);
  assert.match(hot, /'آخر رسالة: '\+esc\(n\.last\.who\)/);
  assert(index.includes('crm-hot-alerts.js?v=20261119-open2'));
});

test('ج: a person answering with a day, an hour or a location relabels the meeting task, which stays open', () => {
  assert.match(sql, /replace\(t\.title, '\(ينتظر تأكيدك\)', '\(انرد عليه، ينتظر يحدد اليوم\)'\)/);
  assert.match(sql, /NEW\.actor_type <> 'human'/);
  assert(!/done = true/.test(sql.split('meeting_answered_by_person')[1] || ''));
});

test('«كمّل يا عقل» never runs the agent on a client message older than 24 hours', () => {
  const inbox = fs.readFileSync('supabase/functions/whatsapp-inbox/index.ts', 'utf8');
  const home = fs.readFileSync('crm-owner-home.js', 'utf8'), base = fs.readFileSync('app-base-v15.html', 'utf8');
  const i = inbox.indexOf('resume:"too_old"'), f = inbox.indexOf('functions/v1/whatsapp-reply-agent');
  assert(i > 0 && f > i, 'the age check comes before the agent call');
  assert.match(inbox, /if\(Date\.now\(\)-inAt>24\*3600000\)/);
  assert.match(home, /res\.resume==='too_old'/);
  assert.match(base, /res\.resume==='too_old'/);
  assert(index.includes('crm-owner-home.js?v=20261119-old24') && index.includes('app-base-v15.html?v=20261119-old24'));
});
