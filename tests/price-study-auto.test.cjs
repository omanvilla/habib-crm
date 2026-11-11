'use strict';
// SQL94 (11 Nov 2026, Ahmed): automatic price studies. Claude hands a study in through SQL, Ahmed approves it on the CRM,
// and only then the owner gets the message and the owner report. Owner net, commission and the internal report are owner-only.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const fwd=fs.readFileSync('db/changes/94-price-study-auto.forward.sql','utf8');
const mirror=fs.readFileSync('supabase/migrations/20261112130000_price_study_auto_20261111.sql','utf8');
const back=fs.readFileSync('db/changes/94-price-study-auto.rollback.sql','utf8');
const fn=fs.readFileSync('supabase/functions/price-study/index.ts','utf8');
const ui=fs.readFileSync('crm-price-studies.js','utf8'),home=fs.readFileSync('crm-owner-home.js','utf8'),index=fs.readFileSync('index.html','utf8');
const agent=fs.readFileSync('supabase/functions/whatsapp-reply-agent/index.ts','utf8');

test('SQL94 is mirrored and has a rollback for everything that acts on its own',()=>{
  assert.equal(fwd,mirror);
  assert(fwd.startsWith('-- SQL94 ('));
  for(const name of ['crm_price_study_queue()','crm_price_study_documents(uuid)','crm_price_study_chat(uuid)','crm_price_study_status(uuid)','crm_price_studies_pending()','crm_price_study_decide(uuid, boolean, text, text)',
    'crm_price_study_submit(uuid, numeric, numeric, numeric, numeric, numeric, text, text, text)'])assert(back.includes('DROP FUNCTION IF EXISTS public.'+name),name);
  assert(back.includes('DROP TRIGGER IF EXISTS crm_price_study_on_message ON public.whatsapp_messages;'));
  assert(back.includes('DROP TRIGGER IF EXISTS crm_price_study_on_handoff ON public.whatsapp_conversations;'));
});
test('owner net, commission and the internal report are owner-only: no staff policy, no browser write',()=>{
  const policies=[...fwd.matchAll(/CREATE POLICY (\w+) ON ([\w.]+) FOR (\w+) TO authenticated\s+USING \(([^;]+)\);/g)];
  assert.equal(policies.length,3);
  for(const p of policies){assert.equal(p[3],'SELECT',p[1]);assert(p[4].includes("(SELECT public.my_role()) = 'owner'"),p[1]);assert(!/manager|agent|viewer/.test(p[4]),p[1]);}
  assert(fwd.includes('REVOKE ALL ON public.owner_price_studies FROM anon, authenticated;'));
  assert(fwd.includes('GRANT SELECT ON public.owner_price_studies TO authenticated;'));
  assert(fwd.includes("VALUES ('price-studies', 'price-studies', false, 20971520)"),'the bucket is private');
  // what Claude calls is closed to every browser role; the two owner RPCs check the role themselves
  for(const f of ['crm_price_study_queue()','crm_price_study_documents(uuid)','crm_price_study_chat(uuid)','crm_price_study_status(uuid)','crm_price_study_submit(uuid, numeric, numeric, numeric, numeric, numeric, text, text, text)'])
    assert(fwd.includes('REVOKE ALL ON FUNCTION public.'+f+' FROM PUBLIC, anon, authenticated;'),f);
  assert.equal((fwd.match(/if public\.my_role\(\) is distinct from 'owner' then raise exception 'owner_only'/g)||[]).length,2);
  // the queue Claude reads carries no money of ours, and no message to Ahmed's phone carries it either
  const queue=fwd.slice(fwd.indexOf('FUNCTION public.crm_price_study_queue()'),fwd.indexOf('REVOKE ALL ON FUNCTION public.crm_price_study_queue()'));
  assert(!/owner_net|commission/.test(queue));
  const told=[...fn.matchAll(/tellAhmed\(secret,[\s\S]*?\`price_study_[a-z]+:\$\{[^}]+\}\`\)/g)].map(m=>m[0]);
  assert.equal(told.length,3);
  for(const t of told)assert(!/owner_net|commission|internal/.test(t),'no confidential figure in an alert');
});
test('nothing reaches an owner before the approval, and test mode only reaches the test numbers',()=>{
  assert(fwd.includes("ADD COLUMN IF NOT EXISTS price_study_send_mode text NOT NULL DEFAULT 'test'"));
  assert(fn.includes('.update({ status: "sending", updated_at: new Date().toISOString() }).eq("id", studyId).eq("status", from).select("*")'),'one send per approval');
  assert(fn.includes('if (action === "send") { const id = uuid(body?.study_id); return id ? json({ ok: true, result: await sendStudy(id, "approved") })'));
  assert(fn.includes('if (mode === "off") return await set("approved", "sending_off");'));
  assert(fn.includes('if (mode !== "live" && !isTest) return await set("approved", "test_mode_hold");'));
  assert.equal((fn.match(/sendStudy\(/g)||[]).length,3,'only the approval and the answer to the template deliver a study');
  assert(fn.includes('return await sendStudy(waiting.id, "waiting_owner");'));
  // only the decide RPC (owner) sets «approved»
  assert.equal((fwd.match(/set status = 'approved'/g)||[]).length,1);
  assert(fwd.includes("perform crm_repair_private.price_study_call(jsonb_build_object('action', 'send', 'study_id', s.id));"));
  assert(fwd.includes("if length(v_note) < 3 then raise exception 'reject_note_required'; end if;"));
});
test('outside the 24-hour window the approved template asks first; the study follows the owner\'s answer',()=>{
  assert(fn.includes('const TEMPLATE = "owner_price_study_ready_ar_v1";'));
  assert(fn.includes('const TEMPLATE_TEXT = "السلام عليكم دراسة سعر عقارك جاهزة نرسلها لك هنا ؟";'));
  assert(fn.includes('if (!(await templateApproved(conv.company_id, conv.route_key))) return await set("approved", "template_not_approved");'));
  assert(fn.includes('return await set("waiting_owner", null, { template_sent_at: new Date().toISOString() });'));
  assert(fwd.includes("s.status = 'waiting_owner'"));
});
test('after the send: the task closes, the offer becomes studied, the chat stays with Ahmed',()=>{
  assert(fn.includes('db.from("tasks").update({ done: true, completed_at: now }).eq("id", s.task_id)'));
  assert(fn.includes('.update({ status: "studied", notes:'));
  assert(fn.includes('handoff_reason: short(`دراسة سعر: انرسلت الدراسة للمالك ${dayAr()} · ${rest}`, 600)'),'the hold is kept, its reason says the study went');
  assert(!/human_handoff_required:\s*false/.test(fn));
  const src=home.match(/const isPricing=[^\n]+/)[0],isPricing=vm.runInNewContext(src+';isPricing');
  assert.equal(isPricing({reason:'دراسة سعر: انرسلت الدراسة للمالك 12 نوفمبر 2026 · فيلا في الخوض'}),false,'no longer «waiting for a price»');
  assert.equal(isPricing({reason:'دراسة سعر: فيلا في الخوض'}),true);
  // the reason still holds the agent back (reply agent and SQL hard handoff)
  assert(/^\s*دراسة سعر\s*:/.test('دراسة سعر: انرسلت الدراسة للمالك 12 نوفمبر 2026 · فيلا'));
});
test('the owner\'s answer after the price: «did not suit him» is written on his offer and Ahmed is told',()=>{
  assert(fn.includes('enum: ["accepted", "price_rejected", "counter_offer", "question", "other"]'));
  assert(fn.includes('const line = `رد المالك على دراسة السعر ${dayAr()}: ${what} «${quote}»`;'));
  assert(fn.includes('.eq("id", s.id).is("owner_reaction", null).select("id")'),'written once');
  assert(fwd.includes("CREATE TRIGGER crm_price_study_on_message AFTER INSERT OR UPDATE OF transcript ON public.whatsapp_messages"),'a voice note is read once its transcript is saved');
  assert(fwd.includes('return NEW; -- never block message saving'));
});
test('the owner\'s documents are copied while Meta still has them',()=>{
  assert(fwd.includes("perform crm_repair_private.price_study_call(jsonb_build_object('action', 'save_docs', 'conversation_id', NEW.id));"));
  assert(fn.includes('const path = `docs/${conv.id}/${m.id}.${ext}`;'));
  assert(fn.includes('createSignedUrls(saved.map((r: any) => r.storage_path), 6 * 3600)'));
  assert(fn.includes('const isPdf = bytes.length > 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;'));
});
test('the price-study function only answers the reply-agent secret',()=>{
  assert(fn.includes('const ok = secret ? await db.rpc("crm_reply_agent_secret_ok", { p_secret: secret }) : null;'));
  assert(fn.includes('if (!ok || ok.error || ok.data !== true) return json({ ok: false, error: "not_authorized" }, 403);'));
});
test('the approval screen compiles, is owner-only and is loaded after the home page',()=>{
  new vm.Script(ui);new vm.Script(home);
  assert(index.indexOf('crm-price-studies.js?v=')>index.indexOf('crm-owner-home.js?v='));
  assert(index.includes('crm-price-studies.css?v='));
  assert(!/<\/script><script src="crm-price-studies/.test(index),'closing tags inside the boot string stay escaped');
  assert(ui.includes("if(!isOwner()||typeof supa==='undefined'){data={items:[],send_mode:'test'};return 0;}"));
  assert(ui.includes("supa.rpc('crm_price_study_decide',args)"));
  assert(ui.includes("supa.storage.from('price-studies').createSignedUrl(path,600)"));
  assert(home.includes("if(st0){todo+=st0;t.push(tile('دراسات سعر جاهزة',st0,'data-coh=\"sheet\" data-kind=\"studies\"'"));
  assert(home.includes("(pricing||!canResume()||(!isOwner()&&isStudyChat(i))?''"),'staff never resume a price study chat');
});
test('R37: a declined property (heirs, mortgaged, occupied) closes its owner offer and opens no price study',()=>{
  assert(agent.includes('if (!review && out.category === "seller" && declining) {'));
  assert(agent.includes('.update({ status: "closed", notes: [l.notes, `ما نستلم: ${why} (${day})`]'));
  assert(agent.includes('if (!review && out.action === "handoff" && /^دراسة سعر/.test(String(out.handoff_reason || "")) && !out.reply_messages.some((t: string) => DECLINE_RE.test(t))) {'));
  const why=(reply,said)=>{const mortgaged=/مرهون|رهن/.test(said),occupied=/مسكون|ساكن|مستأجر|مأجر|مؤجر/.test(said);
    return /ورث|ترك[ةه]/.test(reply)?'ورثة':mortgaged&&occupied?'مرهون ومسكون':mortgaged?'مرهون':occupied?'مسكون':'مرهون أو مسكون';};
  assert(agent.includes('const why = /ورث|ترك[ةه]/.test(reply) ? "ورثة" : mortgaged && occupied ? "مرهون ومسكون" : mortgaged ? "مرهون" : occupied ? "مسكون" : "مرهون أو مسكون";'));
  assert.equal(why('نعتذر منك احنا ما نستلم عقارات الورثة',''),'ورثة');
  assert.equal(why('نعتذر منك احنا ما نستلم عقارات مرهونة او مسكونة','البيت عليه رهن للبنك'),'مرهون');
  assert.equal(why('نعتذر منك احنا ما نستلم عقارات مرهونة او مسكونة','ساكنين فيه الحين'),'مسكون');
  assert.equal(why('نعتذر منك احنا ما نستلم عقارات مرهونة او مسكونة','نعم'),'مرهون أو مسكون');
});
