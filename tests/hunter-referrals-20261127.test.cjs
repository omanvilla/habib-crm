'use strict';
// SQL162 (27 Nov 2026, Ahmed: «نعم نروح على نصيحتك»): «صائد العقارات» + «مسؤول الإحالات». Call lists and tasks only, nothing sent.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const f=fs.readFileSync('db/changes/162-hunter-referrals.forward.sql','utf8').replace(/\r\n/g,'\n');
const rb=fs.readFileSync('db/changes/162-hunter-referrals.rollback.sql','utf8');
const calls=fs.readFileSync('crm-calls-meetings.js','utf8'),index=fs.readFileSync('index.html','utf8');

test('mirrored, private writers, read-only market table for the office',()=>{
 assert.equal(f,fs.readFileSync('supabase/migrations/20261127120000_hunter_referrals.sql','utf8').replace(/\r\n/g,'\n'));
 assert(f.includes('REVOKE ALL ON FUNCTION crm_repair_private.hunt_add(jsonb) FROM PUBLIC, anon, authenticated;'));
 assert(f.includes('REVOKE ALL ON FUNCTION crm_repair_private.referral_tasks_daily(integer) FROM PUBLIC, anon, authenticated;'));
 assert(f.includes('GRANT SELECT ON public.crm_hunt_leads TO authenticated;')&&!/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*crm_hunt_leads/.test(f));
 assert(f.includes("pr NOT BETWEEN 55000 AND 70000")&&f.includes("LIKE '%مكتب%'")&&f.includes("NOT LIKE '%بركاء%'"));
});

test('referrals: 30 days after the deal, at most p_max a day, Ahmed keeps his private line, no messages',()=>{
 assert(f.includes("one.done_at < now() - interval '30 days'"));
 assert(f.includes('IF room = 0 THEN RETURN 0; END IF;')&&f.includes('LIMIT room'));
 assert(f.includes("who := CASE WHEN x.private THEN boss ELSE coalesce(agent, boss) END;"));
 assert(f.includes("cron.schedule('crm_referral_tasks_daily', '15 4 * * 0-4'"));
 assert(!/whatsapp_messages\s*\(|net\.http_post|send_message/.test(f.split('-- ---------------- 3.')[0]));
});

test('office: two new desks, still no money; rollback restores the old functions',()=>{
 assert(f.includes("(11, 'hunter', 'صائد العقارات'")&&f.includes("(12, 'referrals', 'مسؤول الإحالات'"));
 assert(!/commission|owner_net|deal_value/.test(f.split('-- ---------------- 3.')[1]));
 assert(rb.includes("cron.unschedule")&&rb.includes('CREATE OR REPLACE FUNCTION public.crm_call_next')&&rb.includes('CREATE OR REPLACE FUNCTION public.crm_office_snapshot()'));
});

test('call list shows the hunter sellers with the ad link and logs them as advertisers',()=>{
 assert(index.includes('crm-calls-meetings.js?v=20261127-why1'));
 assert(calls.includes("x.hunt_id?'advertiser':'owner'")&&calls.includes('بائع مباشر من إعلان')&&calls.includes("/^https:\\/\\//.test(x.link||'')"));
});
