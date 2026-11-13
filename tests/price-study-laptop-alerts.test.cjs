'use strict';
// SQL99 (13 Nov 2026, Ahmed): «افتح اللابتوب» alerts for «دراسة سعر» tasks. The scheduled tasks «تسعير آلي: الأراضي» and
// «تسعير آلي: العقارات الجاهزة» run on his laptop. A new study: one line more in the report he already gets. Two counted hours
// with no study handed in: one alert, once. A study he rejected: the type, the area and the same line. Every kind of
// property (his choice). Everything is added; the reply agent, the approval, the queue and the sending are not touched.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const read=p=>fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
const fwd=read('db/changes/99-price-study-laptop-alerts.forward.sql'),back=read('db/changes/99-price-study-laptop-alerts.rollback.sql');
const f94=read('db/changes/94-price-study-auto.forward.sql'),f96=read('db/changes/96-price-study-inspection.forward.sql');
const fn=read('supabase/functions/price-study/index.ts'),hot=read('supabase/functions/whatsapp-owner-hot-alert/index.ts');
const LINE='افتح اللابتوب وتطبيق Claude عشان يتسعر';
const code=fwd.replace(/^--.*$/gm,'');

test('SQL99 is mirrored, only adds, and the rollback removes all of it',()=>{
  assert.equal(fwd,read('supabase/migrations/20261113160000_price_study_laptop_alerts_20261113.sql'));
  assert(fwd.startsWith('-- SQL99 ('));
  // nothing of SQL94 to SQL96 is replaced: every function made here is new, and no table or policy is touched
  const made=[...fwd.matchAll(/CREATE OR REPLACE FUNCTION ([\w.]+)\(/g)].map(m=>m[1]);
  assert.deepEqual(made,['crm_repair_private.price_study_run_minutes','crm_repair_private.price_study_brief','public.crm_price_study_unpriced_due','public.crm_price_study_requeued','crm_repair_private.price_study_on_reject']);
  for(const name of made)for(const old of [f94,f96])assert(!old.includes('FUNCTION '+name+'('),name+' is new');
  assert(!/\b(ALTER TABLE|CREATE TABLE|CREATE POLICY|DROP POLICY|DROP FUNCTION|DELETE FROM|UPDATE public\.)/i.test(code));
  // the functions the scheduled tasks call keep their names, inputs and columns: none of them is named in the code at all
  for(const f of ['crm_price_study_queue','crm_price_study_submit','crm_price_study_chat','crm_price_study_documents','crm_price_study_inspection','crm_price_study_status','crm_price_study_decide','crm_price_studies_pending'])
    assert(!code.includes(f),f+' is not touched');
  for(const f of ['public.crm_price_study_requeued(uuid)','public.crm_price_study_unpriced_due()','crm_repair_private.price_study_on_reject()','crm_repair_private.price_study_brief(uuid)','crm_repair_private.price_study_run_minutes(timestamptz, timestamptz)'])
    assert(back.includes('DROP FUNCTION IF EXISTS '+f+';'),f);
  assert(back.includes('DROP TRIGGER IF EXISTS crm_price_study_on_reject ON public.owner_price_studies;'));
  assert(back.includes("PERFORM cron.unschedule('owner_price_study_unpriced');"));
  assert(back.indexOf('DROP TRIGGER')<back.indexOf('DROP FUNCTION'),'the trigger goes before its function');
});
test('closed to every browser role; only the edge function (service role) reads what is due',()=>{
  for(const f of ['crm_repair_private.price_study_run_minutes(timestamptz, timestamptz)','crm_repair_private.price_study_brief(uuid)','public.crm_price_study_unpriced_due()','public.crm_price_study_requeued(uuid)','crm_repair_private.price_study_on_reject()'])
    assert(fwd.includes('REVOKE ALL ON FUNCTION '+f+' FROM PUBLIC, anon, authenticated;'),f);
  assert.deepEqual([...fwd.matchAll(/GRANT EXECUTE ON FUNCTION ([^ ]+) TO (\w+);/g)].map(m=>m[1]+'>'+m[2]),['public.crm_price_study_unpriced_due()>service_role','public.crm_price_study_requeued(uuid)>service_role']);
  assert(!/TO (anon|authenticated)\b/.test(fwd));
  // no money of ours in anything an alert is built from
  assert(!/owner_net|commission|market_value|asking_price|internal_report/.test(fwd));
});
test('an alert names the property as Claude\'s queue does: the same chat, the same owner offer, the same kind',()=>{
  const lateral=sql=>sql.slice(sql.indexOf('left join lateral (\n      select o.* from public.owner_leads o'),sql.indexOf(') l on true'));
  assert(lateral(fwd).length>100);
  assert.equal(lateral(fwd),lateral(f96));
  assert(fwd.includes('left join public.whatsapp_conversations c on c.id = crm_repair_private.price_study_conversation(t.id)'));
  assert(fwd.includes('crm_repair_private.price_study_kind(l.kind, l.built_size), l.kind, l.area, l.wilayat'));
  // every kind of property: no alert is limited to lands
  assert(!/property_kind\s*(=|<>|in\b)/.test(code));
});
test('alert 2: two counted hours, no study row at all, once, only tasks opened from 13 Nov, never at night',()=>{
  const due=fwd.slice(fwd.indexOf('FUNCTION public.crm_price_study_unpriced_due()'),fwd.indexOf('REVOKE ALL ON FUNCTION public.crm_price_study_unpriced_due()'));
  assert(due.includes("where t.title ilike 'دراسة سعر%' and not coalesce(t.done, false)"));
  assert(due.includes("and t.created_at >= timestamptz '2026-11-13 00:00:00+04'"));
  assert(due.includes('and not exists (select 1 from public.owner_price_studies s where s.task_id = t.id)'),'any study row, whatever its status, stops it');
  assert(due.includes('and m.minutes >= 120 and m.minutes < 180'));
  assert(due.includes("and (now() at time zone 'Asia/Muscat')::time >= time '07:00'")&&due.includes("and (now() at time zone 'Asia/Muscat')::time < time '23:15'"));
  assert(due.includes("and e.reason = 'price_study_unpriced:' || t.id::text"));
  assert(due.includes("e.action_type = 'owner_notify' and e.status = 'applied'"),'a failed send does not count as told');
  // the hours the scheduled tasks run
  assert(fwd.includes("(select ((d + time '07:00') at time zone 'Asia/Muscat') as s, ((d + time '23:00') at time zone 'Asia/Muscat') as e) w"));
  assert(fwd.includes("SELECT cron.schedule('owner_price_study_unpriced', '*/10 * * * *', $job$"));
  assert(fwd.includes('where exists (select 1 from public.crm_price_study_unpriced_due());'),'idle unless a task is due');
  assert(fwd.includes("crm_repair_private.price_study_call('{\"action\":\"unpriced_tick\"}'::jsonb, 60000)"));
});
test('alert 3: the moment a study becomes rejected, for its latest version on an open task, once per rejection',()=>{
  assert(fwd.includes("CREATE TRIGGER crm_price_study_on_reject AFTER UPDATE OF status ON public.owner_price_studies\n  FOR EACH ROW WHEN (NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM NEW.status)"));
  const trg=fwd.slice(fwd.indexOf('FUNCTION crm_repair_private.price_study_on_reject()'),fwd.indexOf('REVOKE ALL ON FUNCTION crm_repair_private.price_study_on_reject()'));
  assert(trg.includes("perform crm_repair_private.price_study_call(jsonb_build_object('action', 'requeue_alert', 'study_id', NEW.id), 60000);"));
  assert(trg.includes('exception when others then\n  return NEW;'),'never blocks his decision');
  const rq=fwd.slice(fwd.indexOf('FUNCTION public.crm_price_study_requeued(uuid)'),fwd.indexOf('REVOKE ALL ON FUNCTION public.crm_price_study_requeued(uuid)'));
  assert(rq.includes("where s.id = p_study_id and s.status = 'rejected'"));
  assert(rq.includes("and t.title ilike 'دراسة سعر%' and not coalesce(t.done, false)"));
  assert(rq.includes("where x.task_id = s.task_id and x.status <> 'cancelled' and x.version > s.version)"));
  assert(rq.includes("and e.reason = 'price_study_requeued:' || s.id::text"));
});
test('the edge function only builds the two texts and sends them to Ahmed; the words are his',()=>{
  assert(fn.includes('if (action === "unpriced_tick") return json({ ok: true, results: await unpricedTick(secret) });'));
  assert(fn.includes('if (action === "requeue_alert") { const id = uuid(body?.study_id); return id ? json({ ok: true, result: await requeueAlert(id, secret) })'));
  const part=fn.slice(fn.indexOf('// ---------- «افتح اللابتوب» alerts'),fn.indexOf('// ---------- the template at Meta'));
  assert(part.includes('const LAPTOP_LINE = "'+LINE+'";'));
  assert(part.includes('"⏰ العقار لسه ما تسعّر، تأكد إن اللابتوب شغال",'));
  assert(part.includes('`price_study_unpriced:${r.task_id}`')&&part.includes('`price_study_requeued:${studyId}`'));
  assert(part.includes('await db.rpc("crm_price_study_unpriced_due")')&&part.includes('await db.rpc("crm_price_study_requeued", { p_study_id: studyId })'));
  // to Ahmed's own number only: nothing is sent to an owner, written in a chat, or changed on a study, a task or an offer
  assert.equal((part.match(/tellAhmed\(/g)||[]).length,2);
  assert(!/metaSend|metaUpload|recordOut|sendStudy|\.update\(|\.insert\(|\.upsert\(|\.delete\(/.test(part));
  assert(!/owner_net|commission|market_value|asking_price|internal/.test(part));
  // the type and the area in both, and the line of alert 3 is the line of alert 1
  assert.equal((part.match(/`العقار: \$\{propertyLine\(r\)\}`,/g)||[]).length,2);
  const requeue=part.slice(part.indexOf('async function requeueAlert'));
  assert(requeue.includes('`العقار: ${propertyLine(r)}`,\n    LAPTOP_LINE,'));
});
test('alert 1: the line is added to the report of every new study, not sent as a second message',()=>{
  assert(hot.includes('const LAPTOP_LINE = "'+LINE+'";'));
  assert(hot.includes('const laptop = `\\n${LAPTOP_LINE}`;'));
  assert(hot.includes('const first = await metaText(tokens, phoneId, to, short(head, 3900 - laptop.length) + laptop);'),'the line is never the part that gets cut');
  assert.equal((hot.match(/LAPTOP_LINE/g)||[]).length,2,'defined once, used once');
  const body=hot.slice(hot.indexOf('async function priceStudy('),hot.indexOf('// Ahmed 11 Nov: price study reports go one client at a time'));
  assert(body.includes('const laptop = '));
  assert.equal((body.match(/await metaText\(/g)||[]).length,2,'the details and the end line, as before');
});
test('the reply agent and the approval are not part of this',()=>{
  for(const f of ['supabase/functions/whatsapp-reply-agent/index.ts','supabase/functions/whatsapp-reply-agent/brain.ts','crm-price-studies.js'])
    assert(!read(f).includes('اللابتوب'),f);
});
