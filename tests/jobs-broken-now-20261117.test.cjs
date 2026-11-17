'use strict';
// SQL111 (17 Nov 2026, Ahmed: «صلّح عنوان مهام مجدولة فشلت اليوم»): the home counts the jobs still broken now, not every failure of 24 hours.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const f=fs.readFileSync('db/changes/111-jobs-broken-now.forward.sql','utf8').replace(/\r\n/g,'\n');
const rb=fs.readFileSync('db/changes/111-jobs-broken-now.rollback.sql','utf8').replace(/\r\n/g,'\n');

test('the live body is md5-checked and only the failed-jobs statement is replaced',()=>{
 assert(f.includes("IF md5(def) <> 'b7fb01abebacab144c1f4d99074ac0c9' THEN"));
 assert(f.includes('EXECUTE replace(def, old_part, new_part);'));
 assert.equal(f,fs.readFileSync('supabase/migrations/20261117100000_jobs_broken_now_20261117.sql','utf8').replace(/\r\n/g,'\n'));
});
test('a job counts only when its last run failed; the title says «الحين»',()=>{
 assert(f.includes("SELECT DISTINCT ON (j.jobid) j.jobname, d.status FROM cron.job j JOIN cron.job_run_details d ON d.jobid = j.jobid"));
 assert(f.includes("ORDER BY j.jobid, d.start_time DESC) x\n   WHERE x.status = 'failed';"));
 assert(f.includes("'title', 'مهام مجدولة متعطلة الحين'"));
 // the rule itself on the 16 Nov case: twelve jobs failed once at 09:30, then each ran fine
 const runs=[];for(const j of ['a','b','c'])runs.push({j,t:1,s:'failed'},{j,t:2,s:'succeeded'});runs.push({j:'d',t:1,s:'succeeded'},{j:'d',t:2,s:'failed'});
 const last=new Map();for(const r of runs.sort((x,y)=>x.t-y.t))last.set(r.j,r.s);
 assert.deepEqual([...last].filter(([,s])=>s==='failed').map(([j])=>j),['d']);
});
test('the rollback puts the old statement back',()=>{
 assert(rb.includes("'title', 'مهام مجدولة فشلت اليوم'")&&rb.includes('EXECUTE replace(def, new_part, old_part);'));
});
