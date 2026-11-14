'use strict';
// SQL96 (12 Nov 2026, Ahmed): «معاينة المكتب» on a «دراسة سعر» task. His note (typed or dictated) and up to 20 photos, owner
// only; Claude reads them through crm_price_study_inspection and sees inspected / inspected_at at the end of the queue.
// «أعد الدراسة بعد المعاينة» is the existing rejection with the note «معاينة المكتب». Nothing about approving or sending changes.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=p=>fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
const fwd=read('db/changes/96-price-study-inspection.forward.sql'),back=read('db/changes/96-price-study-inspection.rollback.sql');
const f94=read('db/changes/94-price-study-auto.forward.sql');
const fn=read('supabase/functions/price-study/index.ts');
const ui=read('crm-price-studies.js'),voice=read('crm-voice-input.js'),home=read('crm-owner-home.js'),index=read('index.html');
const doc=read('docs/ربط-التسعير-الآلي.md');
const queue=sql=>{const at=sql.indexOf('FUNCTION public.crm_price_study_queue()\n RETURNS TABLE'),end=sql.indexOf('REVOKE ALL ON FUNCTION public.crm_price_study_queue()',at);
  const part=sql.slice(at,end);return {columns:part.match(/RETURNS TABLE \(([\s\S]*?)\)\n LANGUAGE/)[1].replace(/\s+/g,' '),body:part.slice(part.indexOf('AS $function$'))};};

test('SQL96 is mirrored, refuses a changed queue and has a rollback',()=>{
  assert.equal(fwd,read('supabase/migrations/20261112150000_price_study_inspection_20261112.sql'));
  assert(fwd.startsWith('-- SQL96 ('));
  assert(fwd.includes("IF md5(pg_get_functiondef('public.crm_price_study_queue()'::regprocedure)) <> 'e57dd2e18c99365cd6163b492ba90dce' THEN"));
  for(const name of ['crm_price_study_inspection(uuid)','crm_price_study_inspection_save(uuid, text, date, text[])','crm_price_study_queue()'])
    assert(back.includes('DROP FUNCTION IF EXISTS public.'+name+';'),name);
  for(const p of ['crm_price_study_inspection_owner_insert','crm_price_study_inspection_owner_delete'])assert(back.includes('DROP POLICY IF EXISTS '+p+' ON storage.objects;'),p);
  // the rollback puts the SQL94 queue back word for word, and never drops saved inspections
  assert.deepEqual(queue(back),queue(f94));
  assert(back.includes('AND NOT EXISTS (SELECT 1 FROM public.owner_price_study_inspections) THEN'));
});
test('the queue keeps every SQL94 column in its place and adds inspected, inspected_at at the end; nothing else changes',()=>{
  const now=queue(fwd),was=queue(f94);
  assert.equal(now.columns,was.columns+', inspected boolean, inspected_at date');
  assert.equal(now.body.replace(',\n         (i.task_id is not null), i.inspected_at','').replace('    left join public.owner_price_study_inspections i on i.task_id = t.id\n',''),was.body);
  assert(fwd.includes('REVOKE ALL ON FUNCTION public.crm_price_study_queue() FROM PUBLIC, anon, authenticated;'),'closed to the browser again after the drop');
  assert(!/owner_net|commission/.test(now.body));
});
test('the inspection is owner only: no staff policy, no browser write to the table, photos only under inspections/',()=>{
  const policies=[...fwd.matchAll(/CREATE POLICY (\w+) ON ([\w.]+) FOR (\w+) TO authenticated\s+(?:USING|WITH CHECK) \(([^;]+)\);/g)];
  assert.deepEqual(policies.map(p=>p[3]).sort(),['DELETE','INSERT','SELECT']);
  for(const p of policies){assert(p[4].includes("(SELECT public.my_role()) = 'owner'"),p[1]);assert(!/manager|agent|viewer/.test(p[4]),p[1]);}
  for(const p of policies.filter(p=>p[2]==='storage.objects'))assert(p[4].includes("bucket_id = 'price-studies' AND (storage.foldername(name))[1] = 'inspections'"),p[1]);
  assert(fwd.includes('REVOKE ALL ON public.owner_price_study_inspections FROM anon, authenticated;'));
  assert(fwd.includes('GRANT SELECT ON public.owner_price_study_inspections TO authenticated;'));
  assert(!/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*owner_price_study_inspections TO authenticated/.test(fwd));
  // what Claude calls is closed to every browser role; the save checks the role itself and the task's company
  assert(fwd.includes('REVOKE ALL ON FUNCTION public.crm_price_study_inspection(uuid) FROM PUBLIC, anon, authenticated;'));
  assert(fwd.includes('REVOKE ALL ON FUNCTION public.crm_price_study_inspection_save(uuid, text, date, text[]) FROM PUBLIC, anon;'));
  assert.equal((fwd.match(/if public\.my_role\(\) is distinct from 'owner' then raise exception 'owner_only'/g)||[]).length,1);
  assert(fwd.includes('from public.tasks x where x.id = p_task_id and x.company_id = public.my_company();'));
  assert(fwd.includes("if t.title not ilike 'دراسة سعر%' then raise exception 'not_a_price_study_task'; end if;"));
});
test('up to 20 photos, each one of this task and really uploaded',()=>{
  assert(fwd.includes('CHECK (cardinality(photos) <= 20)'));
  assert(fwd.includes("if cardinality(v_photos) > 20 then raise exception 'at_most_20_photos'; end if;"));
  assert(fwd.includes("if v_path !~ ('^inspections/' || p_task_id::text || '/[0-9a-f-]{36}\\.(jpg|png|webp)$') then raise exception 'photo_path_not_of_this_task'; end if;"));
  assert(fwd.includes("if not exists (select 1 from storage.objects o where o.bucket_id = 'price-studies' and o.name = v_path) then raise exception 'photo_not_uploaded'; end if;"));
  assert(ui.includes("const BUCKET='price-studies',MAX_PHOTOS=20,RESTUDY_NOTE='معاينة المكتب';"));
  assert(ui.includes("const path='inspections/'+t+'/'+newId()+'.'+x.ext;"));
});
test('Claude gets the note, the date and 6-hour links to the photos of that task only',()=>{
  assert(fwd.includes('RETURNS TABLE (inspected_at date, note text, photos integer, photo_urls text[])'));
  assert(fwd.includes("jsonb_build_object('action', 'sign_inspection', 'task_id', p_task_id)::text"));
  assert(fn.includes('if (action === "sign_inspection") { const id = uuid(body?.task_id); return id ? json({ ok: true, photos: await signInspection(id) })'));
  assert(fn.includes('p.startsWith(`inspections/${taskId}/`)'));
  assert(fn.includes('const s = await db.storage.from(BUCKET).createSignedUrls(paths, 6 * 3600);'));
  // nothing of the inspection is ever sent: the function only signs links, behind the same secret as the rest
  const body=fn.slice(fn.indexOf('async function signInspection'),fn.indexOf('// ---------- the two reports'));
  assert(!/metaSend|tellAhmed|recordOut/.test(body));
});
test('the screen: the box on cards whose task is open and inside the task windows, owner only',()=>{
  new vm.Script(ui);new vm.Script(voice);new vm.Script(home);
  assert(ui.includes("+(i.task_id&&!['sent','sending','waiting_owner'].includes(i.status)?inspBox(i.task_id)"));
  assert(ui.includes("if(!ids.length||!isOwner()||typeof supa==='undefined')return;"));
  assert(ui.includes("if(!(modal.classList.contains('on')&&isOwner()&&ID.test(id)&&/^دراسة سعر/.test(title))){el.hidden=true;el.innerHTML='';delete el.dataset.task;return;}"));
  assert(ui.includes("supa.rpc('crm_price_study_inspection_save',{p_task_id:t,"));
  assert(ui.includes("<p class=\"cps-private\">لك فقط، ما يشوفها الموظف ولا المالك</p>"));
  assert(home.includes("if(sheetKind==='studies'){if(typeof window.crmPriceStudiesDraw==='function')window.crmPriceStudiesDraw(body);"));
  for(const f of ['crm-price-studies.js','crm-price-studies.css'])assert(index.includes(f+'?v=20261112-insp1'),f);
  assert(index.includes('crm-owner-home.js?v=20261114-use1'),'crm-owner-home.js moved on with R40, then SQL102');
});
test('«أعد الدراسة بعد المعاينة» only while the study waits for approval, through the existing rejection',()=>{
  assert(ui.includes("+(open?'<div class=\"cps-restudy\"><button type=\"button\" class=\"btn-secondary\" data-cps=\"restudy\" data-id=\"'+id+'\">أعد الدراسة بعد المعاينة</button>'"));
  assert(ui.includes("const id=esc(i.id),open=i.status==='awaiting_approval',"));
  assert(ui.includes("supa.rpc('crm_price_study_decide',{p_study_id:id,p_approve:false,p_note:RESTUDY_NOTE,p_owner_message:null})"));
  assert(ui.includes("if(!note&&!s.photos.length){toast('اكتب ملاحظة المعاينة أو أضف صورها أول','error');"),'no return to Claude without an inspection');
  assert.equal((ui.match(/p_approve:/g)||[]).length,2,'the only two calls that decide: the approval screen and the restudy button (always a rejection)');
});
test('voice: the same button and transcription on the inspection note and the rejection note; a failed one keeps the recording',()=>{
  assert(voice.includes("'#cnText','.rp-instr-text','.cfu-instr-text','textarea[data-insp-note]','textarea[data-cps-note]','textarea[data-cps-msg]',"));
  assert.equal((voice.match(/supa\.functions\.invoke\(/g)||[]).length,1,'one way to turn a recording into text');
  assert(voice.includes("const r=await supa.functions.invoke('crm-voice-transcribe',{body:{audio:await toB64(blob),mime:blob.type}});"));
  assert(voice.includes("}catch(e){\n      keep(btn,ta,blob);"));
  assert(voice.includes('التسجيل محفوظ تحت الخانة: اضغط «أعد التحويل» أو اسمعه واكتب بيدك'));
  assert(voice.includes("box.querySelector('.voice-retry').addEventListener('click',()=>transcribe(btn,ta,blob));"));
  // the text lands in the box for him to read and change; nothing is saved by the recording itself
  assert(!/supa\.(rpc|from)\(/.test(voice));
});
test('the file Claude reads names the function and the two columns',()=>{
  assert(doc.includes('public.crm_price_study_inspection('));
  assert(doc.includes('`inspected`')&&doc.includes('`inspected_at`'));
  assert(doc.includes('photo_urls'));
});
