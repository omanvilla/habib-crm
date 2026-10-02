'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../crm-deal-workflow.js'),'utf8');
function harness(){
  const nodes=new Map(),queries=[],rpc=[];
  const make=id=>({id,innerHTML:'',textContent:'',hidden:false,classList:{add(){},remove(){}},querySelectorAll:()=>[]});
  nodes.set('mDeal',make('mDeal'));nodes.set('dwError',make('dwError'));
  const c={document:{getElementById:id=>nodes.get(id)||null},currentUser:{id:'TEST-owner'},currentProfile:{role:'owner',company_id:'TEST-company'},crmSessionGeneration:1,
    canEdit:()=>true,isOwner:()=>c.currentProfile?.role==='owner',openModal(){},closeModal(){},clearSessionUI(){c.crmSessionGeneration++;c.currentUser=null;},showToast(){},crmSavingForms:new Set(),crmSaveAttempts:new Map(),
    crmDealCustomerNotes:raw=>String(raw||'').split(/\r?\n/).filter(line=>!/^تم إنشاؤها تلقائياً من زيارة بتاريخ [0-9T:.+Z/ -]+$/.test(line.trim())&&line.trim()!=='بطاقة Pipeline مرتبطة بزيارة CRM').join('\n').trim()};
  c.crmSessionCurrent=(generation,user)=>generation===c.crmSessionGeneration&&c.currentUser?.id===user;
  c.supa={from(table){let resolve;const promise=new Promise(r=>{resolve=r;});const query={select(){return query;},order(){return query;},eq(){return query;},in(){return query;},then:promise.then.bind(promise)};queries.push({table,resolve});return query;},rpc(name,args){rpc.push({name,args});return Promise.resolve({data:{deal:{id:args.p_deal_id}},error:null});}};
  c.crmDataFrom=table=>c.supa.from(table);c.window=c;vm.createContext(c);vm.runInContext(source,c);
  return {c,nodes,queries,rpc,helpers:c.crmDealWorkflow};
}
test('historical calendar dates remain valid and invalid leap dates do not silently roll over',()=>{
  const {helpers:h}=harness();assert.equal(h.validDate('2020-02-29'),true);assert.equal(h.validDate('2022-02-29'),false);assert.equal(h.validDate('2020-06-10'),true);assert.equal(h.validDate('2022-11-31'),false);assert.equal(h.day('2020-12-31T21:00:00Z'),'2021-01-01');
});
test('employee commission percentage uses commission after broker, never property sale price',()=>{
  const {helpers:h}=harness();const result=h.commission(1000,100,20,0);assert.equal(result.base,900);assert.equal(result.employee,180);assert.equal(result.company,720);assert.throws(()=>h.commission(100,101,null,0));assert.throws(()=>h.commission(100,0,101,0));assert.throws(()=>h.commission(100,0,null,101));
});
test('fixed historical employee amounts remain fixed without a chosen percentage',()=>{
  const {helpers:h}=harness();assert.equal(h.commission(1000,100,null,275).employee,275);assert.equal(h.commission(2000,100,null,275).employee,275);assert.equal(h.commission(1000,100,0,275).employee,0);
});
test('percentage preview matches the two-decimal database commission amounts',()=>{
  const {helpers:h}=harness(),result=h.commission(1,0,12.5,0);assert.equal(result.employee,0.13);assert.equal(result.company,0.87);
});
test('customer note edits retain the original system visit provenance',()=>{
  const {helpers:h}=harness(),origin='تم إنشاؤها تلقائياً من زيارة بتاريخ 2020-06-10';assert.equal(h.mergeNotes(origin+'\nكلام قديم','كلام جديد'),origin+'\nكلام جديد');assert.equal(h.mergeNotes(origin,''),origin);assert.equal(h.mergeNotes('بطاقة Pipeline مرتبطة بزيارة CRM','نص العميل'),'بطاقة Pipeline مرتبطة بزيارة CRM\nنص العميل');
});
test('amount parser accepts Arabic digits but rejects partial or negative amounts',()=>{
  const {helpers:h}=harness();assert.equal(h.amount('١٬٥٠٠٫٢٥','القيمة'),1500.25);assert.equal(h.amount('','القيمة'),null);assert.throws(()=>h.amount('12abc','القيمة'));assert.throws(()=>h.amount('-10','القيمة'));
});
test('closing the form discards an in-flight old account load before names can render',async()=>{
  const {c,nodes,queries}=harness(),opening=c.openModal('mDeal');assert.equal(queries.length,5);c.closeModal('mDeal');queries.forEach(q=>q.resolve({data:[],error:null}));await opening;assert.equal(nodes.get('mDeal').innerHTML,'');assert.equal(queries.some(q=>q.table==='owners'),false);
});
test('account reset clears modal data and abandoned saving locks',async()=>{
  const {c,nodes,queries}=harness(),opening=c.openModal('mDeal');c.crmSavingForms.add('mDeal');c.crmSaveAttempts.set('mDeal',{key:'synthetic'});c.clearSessionUI();queries.forEach(q=>q.resolve({data:[],error:null}));await opening;assert.equal(nodes.get('mDeal').innerHTML,'');assert.equal(c.crmSavingForms.has('mDeal'),false);assert.equal(c.crmSaveAttempts.has('mDeal'),false);
});
test('pipeline drag opens the guarded form instead of performing a direct deal write',async()=>{
  const {c,queries,rpc}=harness();c.draggedDealId='TEST-deal';const dropping=c.onDrop({preventDefault(){},currentTarget:{dataset:{stage:'closed'},classList:{remove(){}}}});assert.equal(rpc.length,1);assert.equal(rpc[0].name,'crm_get_deal_workflow');assert.equal(rpc[0].args.p_deal_id,'TEST-deal');c.closeModal('mDeal');queries.forEach(q=>q.resolve({data:[],error:null}));await dropping;assert.equal(rpc.length,1);
});
