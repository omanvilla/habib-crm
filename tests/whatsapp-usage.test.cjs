'use strict';
// SQL102 (Ahmed 14 Nov 2026): the system's WhatsApp replies per number this month, against Meta's 1,000 free service messages
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const read=(p)=>fs.readFileSync(p,'utf8');
const sql=read('db/changes/102-whatsapp-usage.forward.sql'),rb=read('db/changes/102-whatsapp-usage.rollback.sql'),home=read('crm-owner-home.js');
test('SQL102 only adds three functions and one cron job, and the migration is the same file',()=>{
  assert.equal(sql,read('supabase/migrations/20261114130000_whatsapp_usage_20261114.sql'));
  assert(sql.startsWith('-- SQL102 ('));
  assert(!/\b(ALTER TABLE|CREATE TABLE|DROP TABLE|DELETE FROM|TRUNCATE|CREATE TRIGGER|net\.http_post)\b/i.test(sql),'no table, no trigger, nothing is sent');
  for(const f of ['crm_repair_private.whatsapp_usage_rows(uuid)','public.crm_whatsapp_usage()','crm_repair_private.whatsapp_usage_alert()'])assert(rb.includes('DROP FUNCTION IF EXISTS '+f+';'),f);
  assert(rb.includes("cron.unschedule('crm_whatsapp_usage_alert')"));
});
test('the count is the system\'s own free-form messages of the Muscat month, never what was typed in the app',()=>{
  assert(sql.includes("COALESCE(w.channel_source, '') <> 'whatsapp_business_app' AND w.message_type <> 'template'"));
  assert(sql.includes("date_trunc('month', now() AT TIME ZONE 'Asia/Muscat') AT TIME ZONE 'Asia/Muscat'"));
  assert(sql.includes("l.route_key IN ('muscat','barka')"),'branch numbers only, never the owner\'s private line');
  assert(sql.includes("WHERE m.rn <= 5 AND m.delivery_status = 'failed') = 5) AS blocked"),'blocked = the last five system messages all failed');
});
test('the public function answers only the signed-in company and the private ones are closed',()=>{
  assert(sql.includes("public.my_company() IS NULL OR public.my_role() NOT IN ('owner','manager','agent') THEN '[]'::jsonb"));
  assert(sql.includes('crm_repair_private.whatsapp_usage_rows(public.my_company())'));
  assert(sql.includes('REVOKE ALL ON FUNCTION public.crm_whatsapp_usage() FROM PUBLIC, anon;'));
  assert(sql.includes('REVOKE ALL ON FUNCTION crm_repair_private.whatsapp_usage_rows(uuid) FROM PUBLIC, anon, authenticated;'));
  assert(sql.includes('REVOKE ALL ON FUNCTION crm_repair_private.whatsapp_usage_alert() FROM PUBLIC, anon, authenticated;'));
});
test('the alert is a CRM notification to the owner, not repeated: blocked once in 12 hours, near the limit once a month',()=>{
  assert(sql.includes("'system_alert', false, 'whatsapp', v_title, v_body"));
  assert(sql.includes("p.role = 'owner' AND p.is_active IS NOT FALSE"));
  assert(sql.includes("x.title = v_title AND x.created_at >= v_since"));
  assert(sql.includes("v_since := now() - interval '12 hours';")&&sql.includes('ELSIF u.used >= 800 THEN'));
  assert(sql.includes("cron.schedule('crm_whatsapp_usage_alert', '*/15 * * * *'"));
});
test('the home page draws the card after the first draw and escapes what it shows',()=>{
  assert(home.includes('<div id="cohUsage"></div>'));
  assert(home.includes("supa.rpc('crm_whatsapp_usage').then(r=>{if(seq!==sequence||!r||r.error)return;usage=r.data||[];drawUsage();});"));
  const src=home.slice(home.indexOf('  function drawUsage(){'),home.indexOf('  let autoNotes=[];'));
  const slot={innerHTML:'x'};
  const draw=(usage)=>{new Function('usage','byId','esc','num',src+';drawUsage();')(usage,()=>slot,(v)=>String(v==null?'':v).replace(/[&<>"']/g,(c)=>'&#'+c.charCodeAt(0)+';'),(v)=>Number(v||0).toLocaleString('en-US'));return slot.innerHTML;};
  let h=draw([{route_key:'barka',used:930,free_limit:1000,blocked:true},{route_key:'muscat',used:611,free_limit:1000,blocked:false}]);
  assert(h.includes('رقم بركاء')&&h.includes('930 / 1,000')&&h.includes('واقف: ردود النظام ما توصل'));
  assert(h.includes('رقم مسقط')&&h.includes('611 / 1,000')&&h.includes('width:61%'));
  h=draw([{route_key:'muscat',used:850,free_limit:1000,blocked:false}]);assert(h.includes('قرّب يخلص المجاني'));
  h=draw([{route_key:'owner',used:5,free_limit:1000}]);assert.equal(h,'','only the two branch numbers');
  assert.equal(draw([]),'');
  assert.match(read('index.html'),/crm-owner-home\.js\?v=20261114-ps1/);
});
test('the agent does not read its own undelivered messages as said to the customer (14 Nov, 131042)',()=>{
  const agent=read('supabase/functions/whatsapp-reply-agent/index.ts');
  assert(agent.includes('message_timestamp,delivery_status,matched_property_id'),'the history query reads the delivery status');
  assert(agent.includes('.reverse().filter((h: any) => !(h.direction === "outbound" && h.delivery_status === "failed"));'));
  assert(agent.includes('.eq("direction", "outbound").neq("delivery_status", "failed")'),'the 15-minute repeat check ignores refused messages too');
  const keep=(h)=>!(h.direction==='outbound'&&h.delivery_status==='failed');
  assert.deepEqual([{direction:'inbound',delivery_status:null},{direction:'outbound',delivery_status:'failed'},{direction:'outbound',delivery_status:'read'}].filter(keep).length,2);
});
