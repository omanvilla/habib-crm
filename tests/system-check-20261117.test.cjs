'use strict';
// SQL116 (17 Nov 2026, Ahmed: «سوّ فحص شامل للنظام وعدّل عليه»): the missing-details list is limited to the caller's
// company, and the scheduled jobs no longer all start on the same second at :00 and :30.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const f=fs.readFileSync('db/changes/116-system-check.forward.sql','utf8').replace(/\r\n/g,'\n');
const rb=fs.readFileSync('db/changes/116-system-check.rollback.sql','utf8').replace(/\r\n/g,'\n');
const rows=s=>[...s.matchAll(/\('([a-z_]+)',\s+'([^']+)',\s+'([^']+)'\)/g)].map(m=>({job:m[1],old:m[2],now:m[3]}));
const minutes=schedule=>{const field=schedule.split(' ')[0];
 if(field==='*')return Array.from({length:60},(_,i)=>i);
 const step=field.match(/^(\*|(\d+)-(\d+))\/(\d+)$/);
 if(step){const from=step[2]?Number(step[2]):0,to=step[3]?Number(step[3]):59,out=[];for(let m=from;m<=to;m+=Number(step[4]))out.push(m);return out;}
 return field.split(',').map(Number);};

test('the migration copy is the forward file and the live body is md5-checked',()=>{
 assert.equal(f,fs.readFileSync('supabase/migrations/20261117160000_system_check_20261117.sql','utf8').replace(/\r\n/g,'\n'));
 assert(f.includes("<> 'a08d6e6de85b66b00c9f0d624218c9bb' THEN"));
});
test('the missing-details list is only the caller\'s company and stays closed to anon',()=>{
 assert(f.includes('where p.company_id = public.my_company()'));
 assert(f.includes('REVOKE ALL ON FUNCTION public.crm_properties_missing_details() FROM PUBLIC, anon;'));
 assert(f.includes("ALTER FUNCTION public.crm_property_missing(uuid) SET search_path = '';"));
 assert(!rb.includes('p.company_id = public.my_company()')&&rb.includes('RESET search_path'));
});
test('every moved job keeps its cadence and hours, and no minute starts more than two of them',()=>{
 const list=rows(f);assert.equal(list.length,8);
 for(const r of list){
  assert.equal(minutes(r.now).length,minutes(r.old).length,r.job+' keeps its number of runs per hour');
  assert.equal(r.now.split(' ').slice(1).join(' '),r.old.split(' ').slice(1).join(' '),r.job+' keeps its hours and days');
 }
 const perMinute=new Map();
 for(const r of list)for(const m of minutes(r.now))perMinute.set(m,(perMinute.get(m)||0)+1);
 assert(Math.max(...perMinute.values())<=2);
 // the two jobs left on the old slot (SQL115's sheet sync is not this file's to move) are alone there
 assert(!perMinute.has(0)&&!perMinute.has(30));
 assert(!list.some(r=>r.job==='owner_price_study_tick'||r.job==='outreach_send_approved'||r.job==='sheet_sync_every_5_min'));
});
test('a job that is no longer on the schedule read on 17 Nov is refused, and the rollback mirrors the list',()=>{
 assert(f.includes("RAISE EXCEPTION 'SQL116 refused: job % is not on «%» any more'"));
 assert.deepEqual(rows(rb),rows(f));
 assert(rb.includes('PERFORM cron.alter_job(v_id, schedule := r.old_schedule);'));
});
