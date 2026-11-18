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
  assert(read('crm-home-attention.js').includes("['owner','manager','agent'].includes(currentProfile.role)")); // SQL130: staff too
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
test('brain: vague call talk is asked first; a clear call request stays a silent handoff (decision 9, Ahmed 18 Nov)',()=>{
  const b=read('supabase/functions/whatsapp-reply-agent/brain.ts');
  assert.match(b,/كلام غامض عن اتصال بدون طلب صريح ولا موضوع .* ما يتحوّل/);
  assert.match(b,/تفضل وش استفسارك ؟/);
  assert.match(b,/الطلب الصريح \("اتصل علي"، "ممكن رقمك"، "متى تتصلون"\) تحويل ساكت/);
  assert.doesNotMatch(b,/"كلمني"، "ابي اتصال"\)/,'«ابي اتصال» is a clear request, not a vague example');
});
test('home rule (Ahmed 18 Nov): waiting buyers and contracts are tiles that open a sheet, never open boxes',()=>{
  const home=read('crm-owner-home.js'),att=read('crm-home-attention.js');
  assert.match(home,/data-kind="waiting"/);assert.match(home,/data-kind="contracts"/);
  assert.match(home,/crm-home-attention-updated/);
  assert.doesNotMatch(att,/crmHomeAttention'\)|getElementById\('crmHomeAttention'\)|page-header/);
  assert.match(read('AGENTS.md'),/لوحة العمل ما أريدها تكون ربشة/);
});
test('SQL129 + whatsapp-owner-hot-alert: «طلب اتصال» and CRM-only hot notifications reach Ahmed on WhatsApp, once',()=>{
  const s=read('db/changes/129-hot-alerts-whatsapp.forward.sql');
  copy('_hot_alerts_whatsapp_20261118.sql',s);
  assert.match(s,/'hot_notification:' \|\| NEW\.id::text/);
  assert.match(s,/interval '5 minutes'/);
  assert(read('supabase/functions/whatsapp-owner-hot-alert/index.ts').includes('(مشتري جاد|تفاوض|اجتماع|طلب اتصال)\\s*:/;'));
});
test('SQL130: staff read «مشترين واقفين» and «العقود» only where they can go',()=>{
  const s=read('db/changes/130-home-attention-staff.forward.sql');
  copy('_home_attention_staff_20261118.sql',s);
  assert.match(s,/can_access_whatsapp_conversation\(v_company, w\.id\)/);
  assert.match(s,/staff_can_access_branch\(v_company, p\.branch_key\)/);
  assert.match(read('crm-owner-home.js'),/const ha=canResume\(\)&&window\.crmHomeAttention/);
});
test('SQL131 + hot alerts: a sold / reserved property clears its serious-buyer alerts; notification rows show the real name',()=>{
  const s=read('db/changes/131-hot-buyer-property-gone.forward.sql');
  copy('_hot_buyer_property_gone_20261118.sql',s);
  assert.match(s,/d\.reservation_confirmed_at IS NOT NULL OR d\.stage IN \('closed', 'commission_collected', 'awaiting_finance'\)/);
  assert.match(read('crm-hot-alerts.js'),/const named=\[\.\.\.new Set/);
});
test('SQL132: no visit confirmation for a sold / reserved property; sold notices go by themselves inside the 24-hour window',()=>{
  const s=read('db/changes/132-sold-notice-auto.forward.sql');
  copy('_sold_notice_auto_20261118.sql',s);
  assert.match(s,/NOT IN \(''sold'', ''reserved''\)/);
  assert.match(s,/w\.last_inbound_at > now\(\) - interval '23 hours'/);
  assert.match(s,/'outreach_auto_sold_notice', '2-57\/5 \* \* \* \*'/);
});
test('SQL133: a sold notice goes by itself outside the window too (Ahmed: «إيوا، تلقائي»), only after the review',()=>{
  const s=read('db/changes/133-sold-notice-template.forward.sql');
  copy('_sold_notice_template_20261118.sql',s);
  assert.match(s,/q\.reviewed_at IS NOT NULL/);
  assert.doesNotMatch(s,/last_inbound_at > now\(\)/);
});
