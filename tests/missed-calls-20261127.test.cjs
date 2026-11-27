'use strict';
// SQL167 (27 Nov 2026, Ahmed): unanswered office calls move to WhatsApp; Maram calls back who did not write; Ahmed hears at once
// only when the caller has a viewing now or is at the property.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const read=f=>fs.readFileSync(f,'utf8');
const sql=read('db/changes/167-missed-calls.forward.sql'),rb=read('db/changes/167-missed-calls.rollback.sql');
const fn=read('supabase/functions/missed-call/index.ts');

test('SQL167 migration copy is byte-identical, switch off by default, nothing deleted',()=>{
  assert.equal(read('supabase/migrations/20261127170000_missed_calls.sql'),sql);
  assert(sql.includes('missed_call_auto boolean NOT NULL DEFAULT false'));
  assert(!/DELETE\s+FROM|DROP\s+TABLE/i.test(sql));
  assert(!/DROP\s+TABLE/i.test(rb));
});
test('device keys are stored hashed and the writer is the service role only',()=>{
  assert(sql.includes("key_hash = encode(sha256(convert_to(coalesce(p_key, ''), 'UTF8')), 'hex')"));
  assert(sql.includes('GRANT EXECUTE ON FUNCTION public.crm_missed_call_plan(text, text, boolean) TO service_role'));
  assert(sql.includes('REVOKE ALL ON FUNCTION public.crm_missed_call_plan(text, text, boolean) FROM PUBLIC, anon, authenticated'));
  assert(sql.includes('ENABLE ROW LEVEL SECURITY'));
});
test('dry run while the switch is off; one message per number per 12 hours; held chats left alone',()=>{
  assert(sql.includes("v_status := 'dry_run'"));
  assert(sql.includes("interval '12 hours'"));
  assert(sql.includes("v_hold IN ('negotiation', 'muted')"));
});
test('evening calls (rang through to Ahmed\'s iPhone) get the neutral wording and no call-back task',()=>{
  assert(sql.includes("'missed_call_evening_ar_v1'"));
  assert(sql.includes("AND m.period <> 'evening'"));
  assert(fn.includes('missed_call_evening_ar_v1'));
  assert(fn.includes('اكتب لنا موضوعك هنا ونرد عليك'));
});
test('the office wording has no commas or full stops',()=>{
  for(const m of fn.matchAll(/missed_call(?:_evening)?_ar_v1: "([^"]+)"/g)) assert(!/[،,.]/.test(m[1]),m[1]);
});
