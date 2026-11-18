'use strict';
// Ahmed's check of 18 Nov 2026: SQL124 (price study tasks from owner offers), SQL125 (tasks close by themselves),
// SQL126 (waiting buyers and contracts at the top of the owner home).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const read=f=>fs.readFileSync(f,'utf8');
const s124=read('db/changes/124-price-study-from-offers.forward.sql'),s125=read('db/changes/125-tasks-autoclose.forward.sql'),s126=read('db/changes/126-home-attention.forward.sql');
const copy=(suffix,sql)=>{const m=fs.readdirSync('supabase/migrations').find(f=>f.endsWith(suffix));assert(m,suffix);assert.equal(read('supabase/migrations/'+m),sql);};
test('migration copies are byte-identical',()=>{copy('_price_study_from_offers_20261118.sql',s124);copy('_tasks_autoclose_20261118.sql',s125);copy('_home_attention_20261118.sql',s126);});
test('SQL124 keeps the queue columns and orders priority first',()=>{
  assert.match(s124,/RETURNS TABLE\(task_id uuid, state text, reject_note text, files_error text, next_version integer, task_title text, task_notes text, task_created_at timestamp with time zone, branch text, conversation_id uuid, owner_name text, property_kind text, kind_raw text, area text, wilayat text, owner_price numeric, land_size numeric, built_size numeric, plot_no text, offer_notes text, owner_lead_id uuid, chat_summary text, docs_saved integer, docs_not_saved integer, inspected boolean, inspected_at date\)/);
  assert.match(s124,/order by \(t\.priority = 'high'\) desc, t\.created_at/);
  assert.match(s124,/order by \(o\.id = t\.owner_lead_id\) desc nulls last/);
});
test('SQL124 opens tasks only for offers saved from 18 Nov, with a type, a place and a size',()=>{
  assert.match(s124,/o\.created_at >= timestamptz '2026-11-18 00:00:00\+04'/);
  assert.match(s124,/coalesce\(o\.land_size, 0\) > 0 OR coalesce\(o\.built_size, 0\) > 0/);
  assert.match(s124,/'owner_price_study_open_tasks', '4-54\/10 \* \* \* \*'/);
});
test('SQL125 never closes a price study on a message or a call',()=>{
  const msg=s125.slice(s125.indexOf('autoclose_on_message()'),s125.indexOf('autoclose_on_call()'));
  assert.doesNotMatch(msg,/'دراسة سعر'/);
  assert.match(s125,/autoclose_tasks\(NEW\.company_id, NEW\.client_id, 'دراسة سعر'/);
  assert.match(s125,/'reaction', 'edit', 'revoke', 'system', 'unsupported'/);
});
test('SQL126 is owner only and the screen is loaded',()=>{
  assert.equal((s126.match(/RAISE EXCEPTION 'owner_only'/g)||[]).length,3);
  assert.match(read('index.html'),/crm-home-attention\.js\?v=/);
  assert.match(read('crm-home-attention.js'),/currentProfile\.role==='owner'/);
});
test('price-study: another property of the same owner is not marked studied',()=>{
  const ps=read('supabase/functions/price-study/index.ts');
  assert.match(ps,/ownTask\.has\(x\.id\)/);
  assert.match(ps,/crm_price_study_buyers/);
});
test('SQL127 leaves job / visa / money chats out of the waiting buyers, never a client with a buyer request or a viewing',()=>{
  const s127=read('db/changes/127-waiting-not-buyers.forward.sql');
  copy('_waiting_not_buyers_20261118.sql',s127);
  assert.match(s127,/request_type = 'buyer'/);
  assert.match(s127,/from public\.viewings v where v\.client_id = p_client/);
  assert.match(s127,/ویزا/);
  assert.doesNotMatch(s127,/\|شاغر\|/);
});
test('SQL128 and the screen: staff see «عملاء يحتاجونك الحين» and share one «تم»',()=>{
  const s128=read('db/changes/128-hot-alerts-staff.forward.sql');
  copy('_hot_alerts_staff_20261118.sql',s128);
  assert.match(s128,/v_role NOT IN \('owner', 'manager', 'agent'\)/);
  assert.match(s128,/can_access_whatsapp_conversation\(v_company, p_conversation_id\)/);
  assert.match(read('crm-hot-alerts.js'),/if\(busy\|\|!canSee\(\)/);
});
test('brain: a call request with no topic is asked first, not handed over (Ahmed 18 Nov)',()=>{
  const b=read('supabase/functions/whatsapp-reply-agent/brain.ts');
  assert.match(b,/طلب الاتصال بدون موضوع واضح ما يتحوّل/);
  assert.match(b,/تفضل وش استفسارك ؟/);
});
