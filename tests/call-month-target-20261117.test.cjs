'use strict';
// SQL113 (17 Nov 2026, Ahmed chose «10 باليوم، والشهر 100 بس»): the month has its own call target that the owner sets.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const f=fs.readFileSync('db/changes/113-call-month-target.forward.sql','utf8').replace(/\r\n/g,'\n');
const rb=fs.readFileSync('db/changes/113-call-month-target.rollback.sql','utf8').replace(/\r\n/g,'\n');
const s110=fs.readFileSync('db/changes/110-call-targets.forward.sql','utf8').replace(/\r\n/g,'\n');
const ui=fs.readFileSync('crm-calls-meetings.js','utf8'),index=fs.readFileSync('index.html','utf8');

test('guarded, mirrored, owner only, the rollback is the SQL110 body',()=>{
 assert(f.includes("'baebdf54686f30be195ab2c1687a2719'"));
 assert.equal(f,fs.readFileSync('supabase/migrations/20261117120000_call_month_target_20261117.sql','utf8').replace(/\r\n/g,'\n'));
 assert(f.includes("IF u IS NULL OR c IS NULL OR coalesce(public.my_role(), '') <> 'owner' THEN RAISE EXCEPTION 'owner_only'"));
 assert(f.includes('ALTER TABLE public.crm_call_month_targets ENABLE ROW LEVEL SECURITY;')&&f.includes('REVOKE ALL ON public.crm_call_month_targets FROM PUBLIC, anon, authenticated;'));
 const body=s=>s.slice(s.indexOf('AS $function$',s.indexOf('FUNCTION public.crm_calls_today()')),s.indexOf('END $function$;',s.indexOf('FUNCTION public.crm_calls_today()')));
 assert.equal(body(rb),body(s110),'the rollback gives back the exact SQL110 crm_calls_today');
});
test('the month uses the saved number when there is one; the day and the week are unchanged',()=>{
 assert(f.includes("SELECT CASE WHEN t.target IS NULL THEN s ELSE s || jsonb_build_object('target', t.target, 'fixed', true) END"));
 assert(f.includes("'month', crm_repair_private.call_month(c, u, m0, m1),")&&f.includes("'month', crm_repair_private.call_month(c, p.user_id, m0, m1))"));
 assert(f.includes("'week', crm_repair_private.call_sum(c, u, w0, w0 + 6),")&&f.includes("'target', crm_repair_private.call_day_target(c, u, d),"));
 // the merge itself: November with 100 saved
 const month=(s,t)=>t==null?s:{...s,target:t,fixed:true};
 assert.deepEqual(month({calls:4,target:200},100),{calls:4,target:100,fixed:true});
 assert.deepEqual(month({calls:4,target:200},null),{calls:4,target:200});
});
test('the owner sets the month in the call log; empty goes back to 10 × working days',()=>{
 assert(ui.includes("if(role()==='owner'&&callsToday&&callsToday.month)sums+="));
 assert(ui.includes("supa.rpc('crm_set_call_month_target',{p_month:muscatDay(0),p_target:n})"));
 assert(ui.includes("const raw=String(byId('ccmMonthTarget').value||'').trim(),n=raw===''?null:Math.round(Number(raw));"));
 assert(index.includes('crm-calls-meetings.js?v=20261118-d36'));
});
