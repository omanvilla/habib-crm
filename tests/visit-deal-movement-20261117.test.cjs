'use strict';
// SQL112 (17 Nov 2026, Ahmed: «نعم، صلّحه»): a visit deal's movement is the visit, the client's messages and a person's activity,
// never the day a card was created when it has a visit. The closer and the home tile use the same rule.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const f=fs.readFileSync('db/changes/112-visit-deal-real-movement.forward.sql','utf8').replace(/\r\n/g,'\n');
const rb=fs.readFileSync('db/changes/112-visit-deal-real-movement.rollback.sql','utf8').replace(/\r\n/g,'\n');

test('guarded on both live bodies and mirrored',()=>{
 assert(f.includes("'84fade95a6d5c387847b6cea0e18c275'")&&f.includes("'63b3617e705873462cf2baa3c37e121d'"));
 assert.equal(f,fs.readFileSync('supabase/migrations/20261117110000_visit_deal_real_movement_20261117.sql','utf8').replace(/\r\n/g,'\n'));
});
test('one movement rule: visit dates (creation only without a visit), merged cards, messages, a person\'s activity',()=>{
 const h=f.slice(f.indexOf('CREATE OR REPLACE FUNCTION crm_repair_private.visit_deal_last_move'),f.indexOf('CREATE OR REPLACE FUNCTION public.crm_close_stale_visit_deals'));
 assert(h.includes('coalesce(v.viewing_date, d.created_at::date),'));
 assert(h.includes('max(coalesce(mv.viewing_date, md.created_at::date))'));
 assert(h.includes("m.direction = 'inbound'")&&h.includes("a.actor_type = 'human'"));
 assert(!/greatest\([^;]*,\s*d\.created_at::date\s*,/.test(h),'the creation day is never a separate term');
 assert(f.includes('REVOKE ALL ON FUNCTION crm_repair_private.visit_deal_last_move(uuid) FROM PUBLIC, anon, authenticated;'));
 const closer=f.slice(f.indexOf('CREATE OR REPLACE FUNCTION public.crm_close_stale_visit_deals'),f.indexOf('DO $sql112$'));
 assert(closer.includes("and crm_repair_private.visit_deal_last_move(d.id) < (now() at time zone 'Asia/Muscat')::date - p_days"));
 assert(closer.includes("rr.code = 'no_response_after_visit'")&&closer.includes('تلقائي: الصفقة واقفة على الزيارة أكثر من 3 أشهر'),'same reason and note');
 assert(f.includes('AND d.merged_into_deal_id IS NULL AND crm_repair_private.visit_deal_last_move(d.id) < v_today - 30;'),'the home tile, same rule');
 // the 13 Sep legacy card from a 5 Jun visit, a duplicate merged on 5 Nov with the same June visit
 const move=(c)=>[c.visit||c.created,...(c.merged||[]).map(m=>m.visit||m.created),c.lastIn,c.lastHuman].filter(Boolean).sort().at(-1);
 assert.equal(move({visit:'2026-06-05',created:'2026-09-13',merged:[{visit:'2026-06-05',created:'2026-11-05'}]}),'2026-06-05');
 assert.equal(move({created:'2026-11-01'}),'2026-11-01','a card without a visit counts from its creation');
 assert.equal(move({visit:'2026-06-05',created:'2026-09-13',lastHuman:'2026-11-10'}),'2026-11-10','a call is movement');
});
test('the rollback restores the SQL77 closer and the SQL111 home statement',()=>{
 assert(rb.includes('coalesce((select max(md.created_at)::date from public.deals md where md.merged_into_deal_id = d.id), d.created_at::date),'));
 assert(rb.includes('EXECUTE replace(def, new_part, old_part);')&&rb.includes('DROP FUNCTION IF EXISTS crm_repair_private.visit_deal_last_move(uuid);'));
});
