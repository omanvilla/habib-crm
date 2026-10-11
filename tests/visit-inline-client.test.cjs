'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../crm-visit-client.js'),'utf8');
const app=fs.readFileSync(path.join(__dirname,'../app-base-v15.html'),'utf8');
function harness(){
  const nodes=new Map(),calls=[],answers=[],attempts=new Map();let nextId=0,requestLoads=0;
  function make(id){
    const node={id,value:'',textContent:'',style:{},hidden:false,disabled:false,dataset:{},options:[],attrs:{},classList:{contains:()=>true},setAttribute(k,v){this.attrs[k]=v;},focus(){},appendChild(n){this.options.push(n);}};
    let html='',childIds=[];Object.defineProperty(node,'innerHTML',{get:()=>html,set(value){childIds.forEach(key=>nodes.delete(key));html=value;childIds=[...value.matchAll(/id="([^"]+)"/g)].map(x=>x[1]);childIds.forEach(key=>nodes.set(key,make(key)));}});return node;
  }
  ['mViewing','vNewClientBox','vNewClientToggle','vNewClientStatus','vClient','vClientCount','vRequestType','vProperty','vDate','vTime','vNextStep','vFollowupDate','vNotes'].forEach(id=>nodes.set(id,make(id)));
  nodes.get('vNewClientBox').hidden=true;nodes.get('vRequestType').value='buyer';
  for(const id of ['vProperty','vDate','vTime','vNextStep','vFollowupDate','vNotes'])nodes.get(id).value='preserve-'+id;
  const c={window:null,document:{getElementById:id=>nodes.get(id)||null,createElement:()=>make('option')},clearTimeout(){},editingViewing:null,currentUser:{id:'TEST-agent'},currentProfile:{company_id:'TEST-company'},crmSessionGeneration:1,viewingFormGeneration:1,viewingChoiceState:{client:{token:0,rows:[],timer:null}},crmSavingForms:new Set(),crmSaveAttempts:attempts,
    canEdit:()=>true,crmDigits:value=>String(value||'').replace(/[٠-٩]/g,ch=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(ch))),
    setupPhoneField(country,local){nodes.get(country).value='968';nodes.get(local).value='';},
    crmBeginSave(id){if(c.crmSavingForms.has(id))return false;c.crmSavingForms.add(id);return true;},crmEndSave:id=>c.crmSavingForms.delete(id),
    crmSaveKey(id,data){const text=JSON.stringify(data),old=attempts.get(id);if(old&&old.text===text)return old.key;const value={text,key:'TEST-new-'+(++nextId)};attempts.set(id,value);return value.key;},
    loadViewingClientProperty(){requestLoads++;}
  };
  c.window=c;c.$=id=>nodes.get(id);c.crmSessionCurrent=(gen,user)=>gen===c.crmSessionGeneration&&user===c.currentUser?.id;
  c.getFullPhone=(country,local)=>c.crmNormalizePhone(nodes.get(local).value,nodes.get(country).value);
  c.supa={from(table){const call={table,filters:[],action:'select'},q={select(columns){call.columns=columns;return q;},eq(k,v){call.filters.push([k,v]);return q;},limit(n){call.limit=n;return q;},single(){call.single=true;return q;},insert(data){call.action='insert';call.data=data;return q;},then(resolve,reject){calls.push(call);const answer=answers.shift();return Promise.resolve(typeof answer==='function'?answer(call):answer||{data:[],error:null}).then(resolve,reject);}};return q;}};
  vm.createContext(c);vm.runInContext(app.slice(app.indexOf('function crmNormalizePhone('),app.indexOf('const crmSavingForms=')),c);vm.runInContext(source,c);
  c.toggleViewingNewClient();nodes.get('vNewClientName').value='عميل اختبار';nodes.get('vNewClientPhoneLocal').value='٩١٢٣٤٥٦٧';
  return {c,nodes,calls,answers,loads:()=>requestLoads};
}
const ok=rows=>({data:rows,error:null}),saved={id:'TEST-new-1',name:'عميل اختبار',phone:'+96891234567',archived:false};
test('inline contact preserves visit fields and selects its acknowledged row without an inquiry or visit write',async()=>{
  const h=harness();h.nodes.get('vRequestType').value='tenant';h.answers.push(ok([]),ok(saved));await h.c.saveViewingNewClient();
  assert.equal(h.nodes.get('vClient').value,saved.id);assert.equal(h.loads(),1);assert.equal(h.nodes.get('vNewClientBox').hidden,true);
  for(const id of ['vProperty','vDate','vTime','vNextStep','vFollowupDate','vNotes'])assert.equal(h.nodes.get(id).value,'preserve-'+id);
  const insert=h.calls.find(x=>x.action==='insert');assert.equal(insert.data.phone,'+96891234567');assert.equal(insert.data.source,'other');assert.equal(insert.data.assigned_to,'TEST-agent');assert.equal(insert.data.client_type,'tenant');assert.equal(insert.data.is_buyer,false);assert.equal('lead_route' in insert.data,false);assert.ok(h.calls.every(x=>x.table==='clients'));assert.equal(h.c.crmSavingForms.size,0);
});
test('normalized-phone duplicate reuses only a visible company-scoped contact, preserving its name',async()=>{
  const h=harness();h.answers.push(ok([{...saved,id:'TEST-existing',name:'الاسم الأصلي'}]));await h.c.saveViewingNewClient();
  assert.equal(h.calls.length,1);assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].filters)),[['company_id','TEST-company'],['phone_normalized','+96891234567']]);assert.equal(h.nodes.get('vClient').value,'TEST-existing');assert.match(h.nodes.get('vClient').options[0].textContent,/الاسم الأصلي/);assert.match(h.nodes.get('vNewClientStatus').textContent,/دون تكراره/);
});
test('a committed insert with a lost response recovers the same visible id',async()=>{
  const h=harness();h.answers.push(ok([]),{error:{message:'network disconnected'}},ok([saved]));await h.c.saveViewingNewClient();
  assert.equal(h.nodes.get('vClient').value,saved.id);assert.deepEqual(JSON.parse(JSON.stringify(h.calls[2].filters)),[['company_id','TEST-company'],['id','TEST-new-1']]);assert.equal(h.calls.filter(x=>x.action==='insert').length,1);
});
test('retry after an uncertain failure retains the insert id and unsaved visit',async()=>{
  const h=harness();h.answers.push(ok([]),{error:{message:'network disconnected'}},ok([]));await h.c.saveViewingNewClient();
  assert.match(h.nodes.get('vNewClientStatus').textContent,/تعذر حفظ العميل/);assert.equal(h.nodes.get('vNewClientBox').hidden,false);
  h.answers.push(ok([]),ok(saved));await h.c.saveViewingNewClient();const inserts=h.calls.filter(x=>x.action==='insert');assert.equal(inserts.length,2);assert.equal(inserts[0].data.id,inserts[1].data.id);assert.equal(h.nodes.get('vNotes').value,'preserve-vNotes');
});
test('invisible duplicate has a generic error without leaking database details or bypassing RLS',async()=>{
  const h=harness();h.answers.push(ok([]),{error:{code:'23505',message:'PRIVATE other-branch client'}},ok([]),ok([]));await h.c.saveViewingNewClient();
  assert.equal(h.nodes.get('vClient').value,'');assert.match(h.nodes.get('vNewClientStatus').textContent,/راجع الرقم/);assert.doesNotMatch(h.nodes.get('vNewClientStatus').textContent,/PRIVATE|other-branch/);assert.ok(h.calls.every(x=>x.table==='clients'));assert.equal(h.c.crmSavingForms.size,0);
});
test('double submission shares one in-flight save and prevents concurrent visit saving',async()=>{
  const h=harness();let resolve;h.answers.push(new Promise(r=>{resolve=r;}),ok(saved));const first=h.c.saveViewingNewClient();await Promise.resolve();await h.c.saveViewingNewClient();
  assert.equal(h.calls.length,1);assert.equal(h.c.crmBeginSave('mViewing'),false);resolve(ok([]));await first;assert.equal(h.calls.filter(x=>x.action==='insert').length,1);
});
test('account change discards a pending lookup before it can insert or expose old contact data',async()=>{
  const h=harness();let resolve;h.answers.push(new Promise(r=>{resolve=r;}));const saving=h.c.saveViewingNewClient();await Promise.resolve();h.c.crmSessionGeneration++;h.c.currentUser={id:'TEST-other'};h.c.resetViewingNewClient();resolve(ok([saved]));await saving;
  assert.equal(h.calls.length,1);assert.equal(h.nodes.get('vClient').value,'');assert.equal(h.nodes.get('vNewClientStatus').textContent,'');assert.equal(h.c.crmSaveAttempts.size,0);
});
test('late old save cannot mutate a new visit or unlock the new operation',async()=>{
  const h=harness();let resolve;h.answers.push(ok([]),new Promise(r=>{resolve=r;}));const saving=h.c.saveViewingNewClient();while(h.calls.length<2)await Promise.resolve();
  h.c.viewingFormGeneration++;h.c.resetViewingNewClient();h.c.crmSavingForms.add('mViewing');resolve(ok(saved));await saving;
  assert.equal(h.nodes.get('vClient').value,'');assert.equal(h.nodes.get('vNewClientStatus').textContent,'');assert.equal(h.c.crmSavingForms.has('mViewing'),true);
});
test('invalid phone or missing name does not call the database; archived contacts stay archived',async()=>{
  const h=harness();h.nodes.get('vNewClientPhoneLocal').value='bad-phone';await h.c.saveViewingNewClient();assert.equal(h.calls.length,0);assert.match(h.nodes.get('vNewClientStatus').textContent,/رقم هاتف صحيح/);
  h.nodes.get('vNewClientPhoneLocal').value='91234567';h.nodes.get('vNewClientName').value=' ';await h.c.saveViewingNewClient();assert.equal(h.calls.length,0);
  h.nodes.get('vNewClientName').value='عميل';h.answers.push(ok([{...saved,archived:true}]));await h.c.saveViewingNewClient();assert.equal(h.nodes.get('vClient').value,'');assert.match(h.nodes.get('vNewClientStatus').textContent,/مؤرشف/);assert.equal(h.calls.length,1);
});
