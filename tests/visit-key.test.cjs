'use strict';
// «الزيارة والمفتاح» (Ahmed, 14 Nov 2026): the property form reads and saves properties.visit_method / visit_instructions /
// lockbox_image_url, the property page shows the location, the linked Instagram posts with views and the marketing
// contract, and warns «حدد طريقة الزيارة» on an available property with no visit method. No SQL, no existing data changed.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=p=>fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
const vk=read('crm-visit-key.js'),index=read('index.html'),voice=read('crm-voice-input.js'),base=read('app-base-v15.html'),v17=read('crm-v17-patch.js');
const cut=(from,to)=>vk.slice(vk.indexOf(from),vk.indexOf(to,vk.indexOf(from)));

test('the module is loaded by the page, after the property modules, with the closing tag escaped',()=>{
  new vm.Script(vk);
  assert(index.includes('<script src="crm-calls-meetings.js?v=20261114-ccm1"><\\/script><script src="crm-visit-key.js?v=20261114-vk2"><\\/script><script>window.APP_VERSION='));
  assert.match(index,/crm-voice-input\.js\?v=20261114-vk1/);
  assert.equal(index.split('</script>').length-1,1,'only the page\'s own closing tag is unescaped');
});
test('the form section has the three boxes, and the list holds exactly the values the database accepts',()=>{
  for(const id of ['pVisitKey','pVisitMethod','pVisitInstructions','pLockboxFile','pLockboxPick','pLockboxRemove','pVisitWarn'])assert(vk.includes("'"+id+"'")||vk.includes('id="'+id+'"'),id);
  assert(vk.includes('<div class="form-section-title">🔑 الزيارة والمفتاح</div>'));
  const methods=JSON.parse(JSON.stringify(vm.runInNewContext(vk.match(/const METHODS=(\[\[.*?\]\]);/)[1])));
  assert.deepEqual(methods,[['open','مفتوح'],['lockbox','مفتاح في صندوق'],['owner_lives','المالك ساكن'],['office','عن طريق المكتب']]);
  assert(read('db/changes/20261105_live_sync_APPLIED.sql').includes("check (visit_method is null or visit_method in ('"+methods.map(m=>m[0]).join("','")+"'));"),'the CHECK on properties');
  assert(voice.includes("'#pVisitInstructions'"),'the 🎤 that turns a recording into text is on the instructions box');
  assert(vk.includes('<textarea class="fta" id="pVisitInstructions"')&&vk.includes("window.crmVoiceAttach(ta)"));
  assert(vk.includes('accept="image/jpeg,image/png,image/webp"')&&vk.includes('MAX_BYTES=5*1024*1024'));
});
test('nothing existing is changed: the columns are written only when the person changed them, after the property was saved',()=>{
  const capture=cut('  function capture(){','  function ownPath(');
  assert(capture.includes("if(!state||!byId('pVisitKey'))return null;"),'a row that could not be read is never written');
  assert(capture.includes("if(!Object.keys(changes).length&&!file&&!remove)return null;"),'no change, no write');
  assert(vk.includes("if(snap&&modal&&!modal.classList.contains('on'))await persist(snap);"),'only after the property\'s own save closed the window');
  assert(vk.includes("if(r.error||!r.data){note('تعذر تحميل بيانات الزيارة لهذا العقار؛ ما راح يتغير فيها شي."));
  assert.equal((vk.match(/\.update\(/g)||[]).length,1);
  assert(vk.includes("supa.from('properties').update(patch).eq('id',id).select('id');"));
  assert(vk.includes("if(text){await write(snap.id,snap.changes);textSaved=true;}"),'what was typed is saved before the photo is tried');
  assert(!/\.(insert|upsert|delete|rpc)\(/.test(vk),'one row, one update, nothing else');
  // the patch can only hold the three columns
  assert.deepEqual([...new Set([...vk.matchAll(/(?:changes|patch)\.([a-z_]+)=/g)].map(m=>m[1]))].sort(),['lockbox_image_url','visit_instructions','visit_method']);
});
test('the key box photo goes where the property photos go, and replacing it never removes a property photo',()=>{
  assert(vk.includes("const BUCKET='property-images'")&&vk.includes("const path=cid+'/'+snap.id+'/'+crmNewId()+'.'+IMAGE_EXT[snap.file.type];"),'the path the storage policy accepts');
  assert(vk.includes("upload(path,snap.file,{contentType:snap.file.type,cacheControl:'3600',upsert:false})"));
  assert(vk.includes("if(uploaded)try{await supa.storage.from(BUCKET).remove([uploaded]);}catch(_e){}"),'a photo whose save failed is not left behind');
  const ownPath=new Function('BUCKET','PUBLIC_MARK',cut('  function ownPath(','  const pause=')+';return ownPath;')('property-images','/storage/v1/object/public/property-images/');
  const url=p=>'https://x.supabase.co/storage/v1/object/public/property-images/'+p;
  assert.equal(ownPath(url('co/p1/a.jpg'),{id:'p1',images:null}),'co/p1/a.jpg');
  assert.equal(ownPath(url('co/p2/a.jpg'),{id:'p1',images:null}),null,'another property');
  assert.equal(ownPath('https://elsewhere.example/a.jpg',{id:'p1',images:null}),null,'a link from somewhere else');
  assert.equal(ownPath(url('co/p1/a.jpg'),{id:'p1',images:[{path:'co/p1/a.jpg',url:url('co/p1/a.jpg')}]}),null,'one of the property\'s photos');
  assert.equal(ownPath(url('co/p1/a.jpg'),{id:'p1',images:[url('co/p1/a.jpg')]}),null,'old photo lists are plain links');
});
test('the property page: location, Instagram links with views, the contract, and the warning',()=>{
  const detail=cut('  async function detail(){','  // ---- wiring');
  assert(detail.includes("supa.from('property_marketing_events').select('id,url,views,published_at,created_at').eq('property_id',id).eq('channel','instagram').not('url','is',null)"));
  assert(detail.includes("const missing=row.status==='available'&&row.archived!==true&&!METHOD_AR[row.visit_method];"));
  assert(vk.includes("const WARN='حدد طريقة الزيارة';")&&detail.includes("'<div class=\"vk-warn vk-warn-page\"><strong>⚠️ '+WARN+'</strong>"));
  assert(detail.includes("if(!window.viewingProperty||window.viewingProperty.id!==id||!host.isConnected)return;"),'an answer for a property that is no longer on screen is dropped');
  const draw=cut('  function draw(p,posts){','  async function detail(){');
  assert(draw.includes('فتح اللوكيشن ↗')&&draw.includes('روابط انستقرام المربوطة')&&draw.includes("num(m.views)+' مشاهدة'")&&draw.includes('🤝 عقد التسويق'));
  assert(draw.includes('target="_blank" rel="noopener"')&&vk.includes("return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';"),'only https links are drawn');
  // the form warns too, on the status chosen in the form
  assert(vk.includes("byId('pVisitWarn').hidden=!(state&&status&&status.value==='available'&&!method);"));
});
test('the marketing contract is read from the dates on the property',()=>{
  const contractText=new Function('num','day',cut('  function contractText(p){','  function field(')+';return contractText;')(v=>String(v),d=>d);
  const at=n=>new Date(Date.now()+4*3600000+n*86400000).toISOString().slice(0,10);
  assert.deepEqual(contractText({has_listing_agreement:false}),{text:'بدون عقد تسويق',tone:''});
  assert.deepEqual(contractText({has_listing_agreement:true,agreement_end_date:null}),{text:'فيه عقد تسويق، بدون تاريخ نهاية',tone:'warn'});
  assert.deepEqual(contractText({has_listing_agreement:true,agreement_end_date:at(40)}),{text:'ساري: باقي 40 يوم، لين '+at(40),tone:'ok'});
  assert.deepEqual(contractText({has_listing_agreement:true,agreement_end_date:at(3)}),{text:'قرب ينتهي: باقي 3 يوم، لين '+at(3),tone:'warn'});
  assert.deepEqual(contractText({has_listing_agreement:true,agreement_end_date:at(20),agreement_reminder_days:30}).tone,'warn','the property\'s own reminder days');
  assert.deepEqual(contractText({has_listing_agreement:true,agreement_end_date:at(-5)}),{text:'منتهي من 5 يوم ('+at(-5)+')',tone:'bad'});
});
test('the instructions and the key box photo stay inside the office',()=>{
  const draw=cut('  function draw(p,posts){','  async function detail(){');
  const inside=draw.slice(draw.indexOf('if(edit){'),draw.indexOf("h+='<div class=\"vk-block\"><div class=\"vk-label\">📱"));
  assert(inside.includes('p.visit_instructions')&&inside.includes('p.lockbox_image_url'));
  assert.equal(draw.split('visit_instructions').length-1,inside.split('visit_instructions').length-1,'drawn only for an account that may edit a property');
  assert.equal(draw.split('lockbox_image_url').length-1,inside.split('lockbox_image_url').length-1);
  assert(vk.includes("const mayEdit=()=>typeof canEdit==='function'&&canEdit();"));
  // the screens that build a message or a file for a customer, and the export, never name the two columns
  for(const [name,src] of [['app-base-v15.html',base],['crm-v17-patch.js',v17],['crm-funnel.js',read('crm-funnel.js')]])
    for(const col of ['visit_instructions','lockbox_image_url'])assert(!src.includes(col),name+' '+col);
});
test('each function of the page is wrapped once',()=>{
  assert(vk.includes("const done={edit:false,open:false,save:false,page:false};"));
  for(const k of ['edit','open','save','page'])assert(new RegExp("if\\(!done\\."+k+"&&typeof window\\.[A-Za-z]+==='function'\\)\\{\\n      const orig=window\\.[A-Za-z]+;done\\."+k+"=true;").test(vk),k);
  assert(vk.includes("if(!hook()){const timer=setInterval(()=>{if(hook())clearInterval(timer);},500);}"));
});
test('the save in use for the property form sends every box the form shows (found 14 Nov: four boxes were never saved)',()=>{
  // crm-v17-patch.js replaces the base saveProperty; unit name, price after the visit, electricity and water were only in the base one
  const save=v17.slice(v17.indexOf('window.saveProperty=async function(){'),v17.indexOf('var oldOpen=window.openModal;'));
  assert(save.includes("unit_label:el('pUnitLabel')?el('pUnitLabel').value.trim()||null:null,"));
  assert(save.includes("price_negotiable:el('pPriceNego')?(el('pPriceNego').value||null):null,"));
  assert(save.includes("electricity_connected:el('pElectricity')?(el('pElectricity').value||null):null,water_connected:el('pWater')?(el('pWater').value||null):null,"));
  for(const id of ['pUnitLabel','pPriceNego','pElectricity','pWater'])assert(base.includes('id="'+id+'"')&&base.includes("$('"+id+"').value=p."),id+' is on the form and filled when a property is opened');
  assert.match(index,/crm-v17-patch\.js\?v=20261114-save1/);
});
test('saving an existing property never clears its owner because the owner list was empty on screen (found 14 Nov)',()=>{
  // the list of owners is filled a few seconds after the page opens; a save before that sent owner_id null
  const save=v17.slice(v17.indexOf('window.saveProperty=async function(){'),v17.indexOf('var oldOpen=window.openModal;'));
  assert(save.includes("if(window.editingProperty&&!ownerId)delete data.owner_id;"));
  assert(save.indexOf("delete data.owner_id;")<save.indexOf("crmDataFrom('properties').update(data)"),'before the row is written');
  assert(save.includes("if(!window.editingProperty&&!ownerId)throw new Error('اختر المالك أو أضف مالكاً');"),'a new property still needs its owner');
});
