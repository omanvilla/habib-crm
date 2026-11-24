'use strict';
// SQL110 (17 Nov 2026, Ahmed): calls to owners and advertisers only, the next step by the result, 10 calls a working day, weekly and
// monthly targets, leave and official holidays, the reason of a short day, the call log.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const f=fs.readFileSync('db/changes/110-call-targets.forward.sql','utf8').replace(/\r\n/g,'\n');
const rb=fs.readFileSync('db/changes/110-call-targets.rollback.sql','utf8');
const ui=fs.readFileSync('crm-calls-meetings.js','utf8'),index=fs.readFileSync('index.html','utf8');

test('the forward file is guarded and mirrored, the rollback brings the old functions back',()=>{
 assert.equal(f,fs.readFileSync('supabase/migrations/20261117090000_call_targets_20261117.sql','utf8').replace(/\r\n/g,'\n'));
 for(const m of ['9c80e070a2df3ce6fdcb8d5b1a0c00bd','aabf3e2ad3ebeab245e9dde52e1a66ac','85e7b5d090c9b408915b7f639c9251fa'])assert(f.includes(m),m);
 assert(rb.includes("RETURN jsonb_build_object('target', 20,")&&rb.includes('CREATE FUNCTION public.crm_log_call(p_client uuid, p_kind text, p_result text, p_next text, p_note text, p_key uuid)'));
 assert(rb.includes('CREATE FUNCTION public.crm_log_call_number(p_phone text, p_name text, p_kind text, p_result text, p_next text, p_note text, p_key uuid)'));
});

test('only owners and advertisers; the next step follows the result; a call back needs its time and makes a task',()=>{
 const ins=f.slice(f.indexOf('CREATE OR REPLACE FUNCTION crm_repair_private.call_insert'),f.indexOf('DROP FUNCTION public.crm_log_call('));
 assert(ins.includes(`kinds jsonb := '{"advertiser":"اتصال على معلن","owner":"اتصال على مالك"}';`));
 assert(!ins.includes('after_visit'));
 assert(ins.includes("IF p_result IN ('no_answer', 'refused') THEN")&&ins.includes("RAISE EXCEPTION 'call_next_none_only'"));
 assert(ins.includes("ELSIF coalesce(p_next_step, '') NOT IN ('send_details', 'call_later') THEN"));
 assert(ins.includes("RAISE EXCEPTION 'call_back_time_required'"));
 assert(ins.includes("nxt := 'يرسل التفاصيل على الواتساب'")&&ins.includes("ELSE nxt := 'ما في خطوة';"));
 assert(ins.includes('INSERT INTO public.tasks (company_id, user_id, client_id, title, notes, due_date, priority, done)'));
 assert(f.includes('GRANT EXECUTE ON FUNCTION public.crm_log_call(uuid, text, text, text, timestamptz, text, uuid) TO authenticated;'));
 assert(f.includes('GRANT EXECUTE ON FUNCTION public.crm_log_call_number(text, text, text, text, text, timestamptz, text, uuid) TO authenticated;'));
 assert(f.includes('REVOKE ALL ON FUNCTION crm_repair_private.call_insert(uuid, uuid, uuid, uuid, text, text, text, timestamptz, text, text, jsonb) FROM PUBLIC, anon, authenticated;'));
});

test('10 a day Sunday to Thursday; Friday, Saturday, leave and official holidays count 0',()=>{
 const t=f.slice(f.indexOf('CREATE OR REPLACE FUNCTION crm_repair_private.call_day_target'),f.indexOf('-- one call by a person'));
 assert(t.includes('WHEN extract(isodow FROM p_day) IN (5, 6) THEN 0'));
 assert(t.includes("AND n.kind IN ('holiday', 'leave') AND (n.user_id IS NULL OR n.user_id = p_user)) THEN 0"));
 assert(t.includes('ELSE 10 END;'));
 // the same arithmetic in JS: a full week is 50, November 2026 is 220
 const target=(d,off)=>[5,6].includes(((d.getUTCDay()+6)%7)+1)||off.has(d.toISOString().slice(0,10))?0:10;
 const sum=(a,b,off=new Set())=>{let s=0;for(let d=new Date(a+'T00:00:00Z');d<=new Date(b+'T00:00:00Z');d=new Date(d.getTime()+86400000))s+=target(d,off);return s;};
 assert.equal(sum('2026-11-15','2026-11-21'),50);
 assert.equal(sum('2026-11-01','2026-11-30'),220);
 assert.equal(sum('2026-11-15','2026-11-21',new Set(['2026-11-18','2026-11-19','2026-11-20'])),30,'two leave days on working days, one on Friday');
 const today=f.slice(f.indexOf('CREATE FUNCTION public.crm_calls_today()'),f.indexOf('-- the call log:'));
 assert(today.includes("w0 := d - (extract(dow FROM d))::int;            -- Sunday"));
 assert(today.includes("'week', crm_repair_private.call_sum(c, u, w0, w0 + 6)")&&today.includes("'month', crm_repair_private.call_sum(c, u, m0, m1)"));
 assert(today.includes("'people', CASE WHEN r IN ('owner', 'manager') THEN"),'only the owner and the manager see each person');
});

test('a short day\'s reason: staff write their own, the owner writes anyone\'s or a holiday for all; busy needs words',()=>{
 const n=f.slice(f.indexOf('CREATE OR REPLACE FUNCTION public.crm_call_day_note('),f.indexOf('CREATE OR REPLACE FUNCTION public.crm_call_day_note_clear'));
 assert(n.includes("IF r NOT IN ('owner', 'manager') OR p_kind <> 'holiday' THEN RAISE EXCEPTION 'holiday_for_all_owner_only'"));
 assert(n.includes("IF who <> u AND r NOT IN ('owner', 'manager') THEN RAISE EXCEPTION 'own_days_only'"));
 assert(n.includes("IF p_kind IN ('busy', 'other') AND (txt IS NULL OR p_until IS NOT NULL OR p_day > today) THEN"));
 assert(n.includes("IF last_day < p_day OR last_day - p_day > 60 THEN"));
 assert(f.includes('ALTER TABLE public.crm_call_day_notes ENABLE ROW LEVEL SECURITY;')&&f.includes('REVOKE ALL ON public.crm_call_day_notes FROM PUBLIC, anon, authenticated;'));
 const log=f.slice(f.indexOf('CREATE OR REPLACE FUNCTION public.crm_calls_log'),f.indexOf('-- why a day is short.'));
 assert(log.includes("WHERE r IN ('owner', 'manager') OR p.user_id = u"),'staff see only their own days');
});

test('the call window: name then number, two kinds, the next step drawn from the result, the time for a call back',()=>{
 assert(ui.includes("const KINDS=[['owner','مالك'],['advertiser','معلن']];")&&!ui.includes('عميل بعد معاينة'));
 assert(ui.indexOf('for="ccmName"')<ui.indexOf('for="ccmPhone"'),'the name comes first');
 assert(ui.includes("const NEXT_FOR={agreed:[['send_details','يرسل التفاصيل على الواتساب'],['call_later','يتصل بعدين']],call_later:[['call_later','يتصل بعدين']]};"));
 for(const gone of ['دراسة سعر','\'زيارة\'','يتصل بكره'])assert(!ui.slice(0,ui.indexOf('2. meeting confirmation')).includes(gone),gone);
 assert(ui.includes("const common={p_kind:kind,p_result:result,p_next_step:next,p_next_at:at,"));
 assert(ui.includes("at=day+'T'+time+':00+04:00';"));
 // the next step for each result, run as plain JS
 const NEXT_FOR=eval('('+ui.match(/const NEXT_FOR=(\{.*?\});/)[1]+')');
 assert.equal(NEXT_FOR.no_answer,undefined);assert.equal(NEXT_FOR.refused,undefined);
 assert.deepEqual(NEXT_FOR.call_later.map(x=>x[0]),['call_later']);
});

test('the home shows today, the week and the month; the call log opens from it with each day and its reason',()=>{
 assert(ui.includes("data-ccm=\"open-log\">سجل الاتصالات</button>"));
 assert(ui.includes("'<b>الأسبوع</b> '+pair(callsToday.week)+' · <b>الشهر</b> '+pair(callsToday.month)"));
 assert(ui.includes("supa.rpc('crm_calls_log',{p_days:31})"));
 assert(ui.includes("supa.rpc('crm_call_day_note',"));
 const src=ui.slice(ui.indexOf('  function dayRow('),ui.indexOf('  function drawLog('));
 const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
 const DAY_KINDS={busy:'انشغل بشغل أهم',other:'سبب ثاني',leave:'إجازة',holiday:'إجازة رسمية'};
 const dayRow=new Function('esc','DAY_KINDS','fmtDay','fmtTime',src+';return dayRow;')(esc,DAY_KINDS,s=>s,()=>'');
 const p={user_id:'u1'};
 assert(dayRow(p,{day:'2026-11-16',target:10,calls:3,list:[]},'2026-11-17',true).includes('ناقص 7')&&dayRow(p,{day:'2026-11-16',target:10,calls:3,list:[]},'2026-11-17',true).includes('اكتب السبب'));
 assert(dayRow(p,{day:'2026-11-16',target:10,calls:12,list:[]},'2026-11-17',true).includes('فوق الهدف'));
 assert.equal(dayRow(p,{day:'2026-11-14',target:0,calls:0,list:[]},'2026-11-17',true),'','an empty weekend is not listed');
 const leave=dayRow(p,{day:'2026-11-18',target:0,calls:0,note:{kind:'holiday',note:'العيد الوطني',all:true},list:[]},'2026-11-17',true);
 assert(leave.includes('إجازة رسمية')&&leave.includes('(للكل)')&&!leave.includes('اكتب السبب'));
 const busy=dayRow(p,{day:'2026-11-16',target:10,calls:4,note:{kind:'busy',note:'تنازل'},list:[]},'2026-11-17',false);
 assert(busy.includes('انشغل بشغل أهم: تنازل')&&busy.includes('ناقص 6'),'the reason is shown and the day still counts short');
 assert(index.includes('crm-calls-meetings.js?v=20261124-study1')&&index.includes('crm-calls-meetings.css?v=20261117-goal1'));
});
