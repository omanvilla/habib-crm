'use strict';
// SQL117 (17 Nov 2026, Ahmed: «نظّف السجلات القديمة» then «نعم، سوّها»): a weekly job deletes old raw webhook rows and old
// cron runs by the rule he approved; the request history is never pruned.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const f=fs.readFileSync('db/changes/117-prune-old-logs.forward.sql','utf8').replace(/\r\n/g,'\n');
const rb=fs.readFileSync('db/changes/117-prune-old-logs.rollback.sql','utf8').replace(/\r\n/g,'\n');
const body=f.slice(f.indexOf('CREATE OR REPLACE FUNCTION'),f.indexOf('END $$;'));

test('the migration copy is the forward file',()=>{
 assert.equal(f,fs.readFileSync('supabase/migrations/20261117170000_prune_old_logs_20261117.sql','utf8').replace(/\r\n/g,'\n'));
});
test('only the two logs are deleted, by the approved rule',()=>{
 assert.deepEqual([...body.matchAll(/DELETE FROM ([a-z_.]+)/g)].map(m=>m[1]),['public.whatsapp_webhook_events','cron.job_run_details']);
 assert(body.includes("created_at < now() - interval '30 days' AND processed AND NOT coalesce(dead_letter, false)"));
 assert(body.includes("start_time < now() - interval '14 days'"));
 assert(!body.includes('client_request_events')&&!body.includes('whatsapp_messages'));
});
test('backend only, once a week, and the rollback removes both',()=>{
 assert(f.includes('REVOKE ALL ON FUNCTION crm_repair_private.prune_old_logs() FROM PUBLIC, anon, authenticated;'));
 assert(f.includes("SELECT cron.schedule('crm_prune_old_logs', '35 1 * * 5', 'select crm_repair_private.prune_old_logs()');"));
 assert(rb.includes("SELECT cron.unschedule('crm_prune_old_logs');")&&rb.includes('DROP FUNCTION IF EXISTS crm_repair_private.prune_old_logs();'));
});
