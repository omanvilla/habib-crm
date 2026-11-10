'use strict';
// Property archive / restore UI (10 Nov 2026, Ahmed's instruction 3, contract A).
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const js=read('crm-property-archive.js'),css=read('crm-property-archive.css'),index=read('index.html'),base=read('app-base-v15.html');
const hot=read('crm-hot-alerts.js'),doc=read('docs/add-property-from-claude.md'),simpleCss=read('crm-simple-ui.css');

function load(extra){
  const toasts=[];
  const ctx={console,showToast:(m,t)=>toasts.push([m,t]),document:{readyState:'complete',getElementById:()=>null,addEventListener(){},createElement:()=>({})}};
  Object.assign(ctx,extra||{});
  ctx.window=ctx;vm.createContext(ctx);
  vm.runInContext(js,ctx,{filename:'crm-property-archive.js'});
  return {ctx,toasts};
}

test('loader adds the archive module after the property grid and phone layout modules',()=>{
  assert(index.includes('<link rel="stylesheet" href="crm-property-archive.css?v=20261110-arch1">'));
  const at=index.indexOf('<script src="crm-property-archive.js?v=20261110-arch1"><\\/script>');
  assert(at>0);
  assert(at>index.indexOf('crm-operations-v6.js?v='));
  assert(at>index.indexOf('crm-simple-ui.js?v='));
  assert(index.includes('crm-hot-alerts.js?v=20261110-arch1'));
  assert(index.includes("fetch('app-base-v15.html?v=20261110-arch1')"));
  new vm.Script(js,{filename:'crm-property-archive.js'});
});

test('archive and restore go through the contract A functions, never a direct properties write',()=>{
  assert(js.includes('window.deleteProperty=function(id,title)'));
  assert(js.includes('window.restoreProperty=function(id,title)'));
  assert(js.includes("supa.rpc('crm_property_archive_precheck',{p_property:ctx.id})"));
  assert(js.includes("supa.rpc('crm_archive_property',{p_property:ctx.id,p_reason:code,p_note:note||null,p_force:force})"));
  assert(js.includes("supa.rpc('crm_restore_property',payload)"));
  for(const key of ['p_has_agreement','p_agreement_start','p_duration_months','p_price','p_note'])assert(js.includes(key+':'),key);
  assert(js.includes("supa.from('property_archive_reasons').select('code,label_ar,status_after,manual_selectable,note_required,sort_order')"));
  assert(js.includes('manual_selectable===true'));
  assert(!/crmDataFrom\('properties'\)\.(update|insert|upsert|delete)/.test(js));
  assert(!/from\('properties'\)/.test(js));
  assert(!/archived\s*:\s*(true|false)/.test(js));
  // The owner alone may pass p_force (precheck can_force, else the profile role), and only after ticking the box;
  // branch accounts stay blocked.
  assert(js.includes("const canForce=ctx=>ctx.pre&&typeof ctx.pre.can_force==='boolean'?ctx.pre.can_force:owner();"));
  assert(js.includes('const force=!!(ctx.active&&canForce(ctx)&&forceEl&&forceEl.checked);'));
  assert(js.includes('if(ctx.active&&!canForce(ctx)){showError(d,STAFF_BLOCK);return;}'));
  // Restore is always a new contract: the confirmation is required before the RPC.
  assert(js.includes("if(!confirmEl||!confirmEl.checked){showError(d,'علّم «تأكدت من المالك إن العقار متاح» قبل الاستعادة',confirmEl);return;}"));
  // Deals UI is untouched: deal stages are only read for the warning.
  assert(!/editDeal|saveDeal|from\('deals'\)/.test(js));
});

test('dialogs carry the agreed Arabic copy and close with Escape unless a save is running',()=>{
  for(const text of ['أرشفة العقار — ليش؟','أعرف إن على العقار صفقة شغالة','استعادة العقار كعقد جديد','تأكدت من المالك إن العقار متاح','ينتظر الموافقة','العقار أصبح غير متاح'])assert(js.includes(text),text);
  assert(js.includes("if(e.key==='Escape'){e.preventDefault();if(d.dataset.busy!=='1')shut(d);}"));
  assert(js.includes("d.addEventListener('cancel',e=>{e.preventDefault();if(d.dataset.busy!=='1')shut(d);});"));
  assert(js.includes('d.showModal()'));
  assert(js.includes('value="3" inputmode="numeric"')&&js.includes('min="1" max="60"'));
  assert(js.includes("muscatToday=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Muscat'})"));
});

test('every dynamic value in the dialogs and banner is escaped',()=>{
  assert(js.includes("const esc=v=>String(v==null?'':v).replace(/[&<>\"']/g,c=>'&#'+c.charCodeAt(0)+';');"));
  for(const part of ["<bdi>'+esc(p.title||title||'عقار')+'</bdi>'","esc(p.area)","esc(r.label_ar)","esc(r.code)","esc(p.archive_note)","esc(p.id)","esc(k)+' ('+n+')'","esc(friendly(errText(e)))"])assert(js.includes(part),part);
  assert(!/'\+p\.(title|area|archive_note|archive_reason)\b/.test(js));
  assert(js.includes("box.textContent=text||''"));
});

test('archived rows read «📦 <reason>», never «متوفر»; withdrawn reads «مسحوب»',()=>{
  const {ctx}=load({propStatusAr:s=>({available:'✅ متوفر',not_available:'⚪ غير متاح'}[s]||s)});
  const label=ctx.CRMPropertyArchive.statusText;
  assert.equal(label({archived:true,status:'available',archive_reason:null},false),'📦 مؤرشف');
  assert.equal(label({archived:true,status:'withdrawn',archive_reason:'contract_expired'},false),'📦 انتهى عقد التسويق');
  assert.equal(label({archived:true,status:'sold',archive_reason:'sold_by_owner'},true),'📦 المالك باعه بنفسه أو عن طريق غيرنا');
  assert.equal(label({archived:true,status:'sold',archive_reason:'contract_expired'},false),'📦 انتهى عقد التسويق · مباع');
  assert.equal(label({archived:true,status:'reserved',archive_reason:'unrecorded'},false),'📦 سبب الأرشفة غير مسجل · محجوز');
  assert.equal(label({archived:true,status:'withdrawn',archive_reason:'unrecorded'},false),'📦 سبب الأرشفة غير مسجل');
  assert.equal(label({archived:true,status:'not_available',archive_reason:null},false),'📦 مؤرشف · غير متاح');
  assert.equal(label({archived:false,status:'withdrawn'},false),'مسحوب');
  assert.equal(label({archived:false,status:'withdrawn'},true),'⚪ مسحوب');
  assert.equal(label({archived:false,status:'available'},false),null);
  for(const code of ['contract_expired','owner_withdrew','sold_by_owner','sold_by_us','rented','duplicate','test_record','other','unrecorded',null])
    for(const status of ['available','withdrawn','not_available','sold','reserved'])assert(!label({archived:true,status,archive_reason:code},true).includes('متوفر'),code+' '+status);
  assert.equal(ctx.CRMPropertyArchive.reasonLabel('duplicate'),'سجل مكرر');
  assert.equal(ctx.propStatusAr('withdrawn'),'⚪ مسحوب');
  assert.equal(ctx.propStatusAr('available'),'✅ متوفر');
});

test('the reason list mirrors contract A, including which reasons need a note',()=>{
  for(const row of [
    "{code:'contract_expired',label_ar:'انتهى عقد التسويق',status_after:'withdrawn',manual_selectable:true,note_required:false",
    "{code:'owner_withdrew',label_ar:'المالك سحب العقار',status_after:'withdrawn',manual_selectable:true,note_required:false",
    "{code:'sold_by_owner',label_ar:'المالك باعه بنفسه أو عن طريق غيرنا',status_after:'sold',manual_selectable:true,note_required:false",
    "{code:'sold_by_us',label_ar:'انباع عن طريقنا',status_after:'sold',manual_selectable:true,note_required:false",
    "{code:'rented',label_ar:'انأجر',status_after:'not_available',manual_selectable:true,note_required:false",
    "{code:'duplicate',label_ar:'سجل مكرر',status_after:'not_available',manual_selectable:true,note_required:true",
    "{code:'test_record',label_ar:'سجل تجريبي أو خطأ إدخال',status_after:'not_available',manual_selectable:true,note_required:false",
    "{code:'other',label_ar:'سبب آخر',status_after:'not_available',manual_selectable:true,note_required:true",
    "{code:'unrecorded',label_ar:'سبب الأرشفة غير مسجل',status_after:'not_available',manual_selectable:false,note_required:false"
  ])assert(js.includes(row),row);
  assert(js.includes("if(r.note_required&&!note){showError(d,'اكتب ملاحظة لهذا السبب',noteEl);return;}"));
});

test('a completed sale refused while archiving says to pick «انباع عن طريقنا»; restore keeps its own wording',()=>{
  assert(js.includes("const ARCHIVE_CODES={property_has_completed_deal:'على العقار صفقة بيع مكتملة، فما يتأرشف إلا «مباع». اختر «انباع عن طريقنا»'};"));
  assert(js.includes("fail(ctx,'ما انحفظت الأرشفة: '+friendly(errText(e),'archive'))"));
  assert(js.includes("throw new Error(outText(out,'archive'));"));
  assert(js.includes("fail(ctx,'ما تمت الاستعادة: '+friendly(errText(e)))"));
  assert(js.includes("property_has_completed_deal:'على العقار صفقة بيع مكتملة، فما يرجع «متوفر»'"));
});

test('restore refuses a contract that already ended before calling the RPC, and the server code reads in Arabic',()=>{
  assert(js.includes("agreement_already_ended:'العقد اللي كتبته خلص قبل اليوم، خل البداية من اليوم أو زد المدة'"));
  assert(js.includes("if(/^\\d{4}-\\d{2}-\\d{2}$/.test(today)&&contractEnd(start,months)<today){showError(d,CODES.agreement_already_ended,field('start'));return;}"));
  const at=js.indexOf('function contractEnd(start,months){');
  assert(at>0);
  const contractEnd=vm.runInNewContext('('+js.slice(at,js.indexOf('\n  }\n',at)+4)+')');
  // What Postgres returned for (start + make_interval(months => n))::date, the check inside crm_restore_property.
  for(const [start,months,end] of [['2026-01-31',1,'2026-02-28'],['2024-01-31',1,'2024-02-29'],['2026-08-31',2,'2026-10-31'],['2025-11-30',3,'2026-02-28'],['2026-08-10',3,'2026-11-10'],['2021-12-15',60,'2026-12-15']])
    assert.equal(contractEnd(start,months),end,start+' + '+months);
});

test('archiving as «انباع عن طريقنا» says to record the sale on the buyer card first, or it closes with the rest',()=>{
  assert(js.includes("if(code==='sold_by_us'&&ctx.status!=='sold'&&deals.some(x=>x&&PRE_RESERVATION.includes(x.stage)))lines.push('إذا المشتري عنده صفقة مفتوحة، سجّل البيع عليها من «الصفقات» أول، وإلا بتنقفل مع الباقي بسبب «العقار أصبح غير متاح»');"));
});

test('an API error PGRST202 (archive function missing, SQL76 not applied) reads in Arabic',async()=>{
  assert(js.includes("const errText=e=>e&&e.code==='PGRST202'?RPC_MISSING:"));
  const err={code:'PGRST202',message:'Could not find the function in the schema cache'};
  const {ctx,toasts}=load({canEdit:()=>true,currentUser:{id:'TEST_USER'},crmDataFrom:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:err})})})})});
  ctx.deleteProperty('TEST_PROPERTY','TEST');
  await new Promise(r=>setTimeout(r,0));
  assert.deepEqual(toasts,[['تعذر فتح العقار: تحديث قاعدة البيانات للأرشيف ما انطبق بعد','error']]);
});

test('restoring a duplicate or test record asks for one more look before it is «متوفر» again',()=>{
  assert(js.includes("const recheck=p.archive_reason==='duplicate'?'مو نسخة ثانية من عقار موجود':p.archive_reason==='test_record'?'عقار حقيقي ومو تجربة':'';"));
  assert(js.includes("+(recheck?'<p class=\"cpa-warn\">'+esc('انأرشف لأنه «'+(r?r.label_ar:'سجل مكرر أو تجريبي')+'». تأكد إنه '+recheck+' قبل ما ترجعه «متوفر»')+'</p>':'')"));
});

test('a closed dialog leaves the page at once, so it is never found or reused',()=>{
  assert(js.includes("if(typeof d.close==='function'&&d.open){try{d.close();}catch(_){}}\n    if(dialog===d)dialog=null;\n    d.remove();"));
  assert(js.includes("closeDialog();const banner=byId('cpaArchiveBanner');if(banner)banner.remove();"));
});

test('the client «عقارات العميل» tab reads «مسحوب» instead of the raw withdrawn status',async()=>{
  const nodes=[{textContent:'فيلا · TEST · withdrawn'},{textContent:'فيلا · TEST · ✅ متوفر'},{textContent:'فيلا · TEST withdrawn area · ⚪ غير متاح'}];
  let calledWith=null;
  const {ctx}=load({loadClientListings:async function(id){calledWith=id;}});
  ctx.document.getElementById=id=>id==='cdTabListings'?{querySelectorAll:s=>s==='.listing-detail'?nodes:[]}:null;
  await ctx.loadClientListings('TEST_CLIENT');
  await new Promise(r=>setTimeout(r,0));
  assert.equal(calledWith,'TEST_CLIENT');
  assert.deepEqual(nodes.map(n=>n.textContent),['فيلا · TEST · ⚪ مسحوب','فيلا · TEST · ✅ متوفر','فيلا · TEST withdrawn area · ⚪ غير متاح']);
});

test('viewers cannot open the archive or restore dialogs',()=>{
  const {ctx,toasts}=load({canEdit:()=>false});
  ctx.deleteProperty('TEST_PROPERTY','TEST');
  ctx.restoreProperty('TEST_PROPERTY','TEST');
  assert.equal(toasts.length,2);
  assert.equal(toasts[0][0],'ليس لديك صلاحية الأرشفة');
  assert.equal(toasts[1][0],'ليس لديك صلاحية الاستعادة');
});

test('the property grid, phone cards and details get the archive label; edit stays hidden for archived rows',()=>{
  assert(js.includes("list.querySelectorAll('tr[data-property-row],.mobile-property-card,table.tbl tr[data-id]')"));
  assert(js.includes("chip=row.querySelector('.ops-status')")&&js.includes("chip=row.querySelector('.mobile-status-chip')"));
  assert(js.includes("const edit=byId('pdEditBtn');if(edit&&p.archived===true)edit.style.display='none';"));
  assert(js.includes("const BASE_DETAIL={available:'✅ متوفر',reserved:'⏳ محجوز',deposit:'💰 عربون',negotiating:'💬 تفاوض',sold:'🔴 مباع',not_available:'⚪ غير متاح'};"));
  assert(js.includes("withdrawn:'مسحوب'")&&js.includes("not_available:'غير متاح'"));
  assert(js.includes("window.renderPropertyDetail=function(){"));
});

test('phone layout: dialog fits 390px without horizontal scroll and the archive switch stays next to search',()=>{
  assert(css.includes('width:min(520px,calc(100% - 24px))'));
  assert(css.includes('overflow-x:hidden'));
  assert(css.includes('@media (max-width:480px)'));
  assert(css.includes('.cpa-dialog [hidden]{display:none!important}'));
  assert(!css.includes('uiPropertyArchive')&&!js.includes('uiPropertyArchive'));
  assert(simpleCss.includes('#opsPropertyFilters:not(.crm-filters-open)>label:has(#uiPropertyArchive){display:flex!important}'));
});

test('the new archive columns are read and exported with the other property columns',()=>{
  const prefix='const CRM_DATA_COLUMNS = ',start=base.indexOf(prefix);
  assert(start>=0);
  const end=base.lastIndexOf(';',base.indexOf('function crmDataFrom(',start));
  const columns=JSON.parse(base.slice(start+prefix.length,end));
  const added=['archive_reason','archive_note','archive_source','archive_evidence','relisted_at'];
  for(const list of [columns.properties.all,columns.properties.safe])for(const name of added)assert(list.includes(name),name);
  assert(!columns.properties.safe.includes('owner_net')&&!columns.properties.safe.includes('expected_commission'));
  const manifest=base.match(/"table":"properties","primary_key":\["id"\],"columns":"([^"]+)"/);
  assert(manifest);
  const exported=manifest[1].split(',');
  for(const name of added)assert(exported.includes(name),name);
});

test('the owner hot alert also lists a booked meeting as «📅 اجتماع»',()=>{
  assert(hot.includes('/^(مشتري جاد|تفاوض|طلب اتصال)/'));
  assert(hot.includes('!/^\\s*اجتماع/.test(why)'));
  assert(hot.includes("/^\\s*اجتماع/.test(why)?'📅 اجتماع':'🔥 مشتري جاد'"));
  assert(hot.includes('/^(🔥|📞|📅)/'));
  new vm.Script(hot,{filename:'crm-hot-alerts.js'});
});

test('Claude and the agent archive through archive_property_internal with a reason, never a raw update',()=>{
  assert(doc.includes('**لا تكتب** `update public.properties set archived = ...`'));
  assert(doc.includes('crm_repair_private.archive_property_internal('));
  assert(doc.includes("'agent',"));
  assert(doc.includes('public.crm_property_archive_precheck('));
  assert(doc.includes('public.crm_restore_property('));
  assert(doc.includes('"blocked":"active_deal"'));
  // reason_set on an archived row that is reserved (or has an active-stage deal) is blocked: report it, never force.
  assert(doc.includes('وما يتسجل السبب (المصدر `agent` ما يفرض أبداً)'));
  assert(doc.includes('في 10 نوفمبر هذا حال `f99087b9`'));
});
