'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('app-base-v15.html','utf8');
const segment=(from,to)=>source.slice(source.indexOf(from),source.indexOf(to,source.indexOf(from)));
const code=[segment('async function populateTaskSelects()','async function loadTasks()'),segment('async function editTask(id)','const taskTogglePending'),segment('async function populateViewingForm(viewing)','function clearViewingForm()'),segment('async function editViewing(id)','function deleteViewing(id)')].join('\n');
function fixture(){
  const nodes=new Map(),pending=[],toasts=[],opened=[];
  const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',innerHTML:'',style:{},classList:{add:className=>opened.push([id,className])},insertAdjacentHTML:(_position,html)=>{node(id).innerHTML+=html;}});return nodes.get(id);};
  const query=table=>{const q={table,select:()=>q,eq:()=>q,order:()=>q,single:()=>new Promise(resolve=>pending.push({table,resolve}))};return q;};
  const context={$:node,currentUser:{id:'synthetic-owner'},currentProfile:{full_name:'SYNTHETIC OWNER'},crmSessionGeneration:1,
    currentCompany:{id:'synthetic-company'},allTasks:[],allMembers:[],crmSavingForms:new Set(),crmSaveAttempts:new Set(),viewingFormGeneration:0,viewingRequestGeneration:0,
    supa:{from:query},crmDataFrom:query,crmReadAll:factory=>{const q=factory();return new Promise(resolve=>pending.push({table:q.table,resolve}));},
    canEdit:()=>true,canManage:()=>true,escapeHtml:String,roleAr:String,showPermissionDenied:()=>{},showToast:(...args)=>toasts.push(args),
    updateViewingOutcomeFields:()=>{},loadViewingChoices:async()=>{}};
  context.crmSessionCurrent=(generation,user)=>generation===context.crmSessionGeneration&&user===context.currentUser?.id;
  context.window=context;vm.createContext(context);vm.runInContext(code,context);
  return {context,nodes,node,pending,toasts,opened,flush:()=>new Promise(resolve=>setImmediate(resolve)),
    switchSession:()=>{context.crmSessionGeneration++;context.currentUser={id:'synthetic-agent'};context.currentProfile={full_name:'SYNTHETIC AGENT'};context.allTasks=[];context.editingTask=null;context.editingViewing=null;opened.length=0;for(const n of nodes.values()){n.value=n.textContent=n.innerHTML='';}}};
}

test('late task/visit lookup cannot reopen owner records after a session switch',async()=>{
  for(const method of ['editTask','editViewing'])for(const fail of [false,true]){
    const f=fixture(),loading=f.context[method]('synthetic-private-record');f.switchSession();
    f.pending[0].resolve(fail?{error:{message:'SYNTHETIC PRIVATE ERROR'}}:{data:{id:'synthetic-private-record',title:'SYNTHETIC PRIVATE TASK',notes:'SYNTHETIC PRIVATE NOTES',viewing_date:'2026-10-15'},error:null});
    await loading;assert.deepEqual(f.opened,[]);assert.deepEqual(f.toasts,[]);assert.equal(f.context.allTasks.length,0);
    assert.equal(JSON.stringify([...f.nodes.values()]).includes('SYNTHETIC PRIVATE'),false);
  }
});

test('late client/deal options do not repopulate task dropdowns in the next account',async()=>{
  const f=fixture(),loading=f.context.populateTaskSelects();f.switchSession();
  f.pending.forEach(p=>p.resolve([{id:'synthetic-private',name:'SYNTHETIC PRIVATE CLIENT',client:{name:'SYNTHETIC PRIVATE DEAL'}}]));
  assert.equal(await loading,false);assert.equal(f.node('tClient').innerHTML,'');assert.equal(f.node('tDeal').innerHTML,'');assert.deepEqual(f.toasts,[]);
});

test('session switch while editing cached task options does not reopen the task form',async()=>{
  const f=fixture();f.context.allTasks=[{id:'synthetic-private',title:'SYNTHETIC PRIVATE TASK',client_id:'synthetic-client'}];
  const loading=f.context.editTask('synthetic-private');f.switchSession();f.pending.forEach(p=>p.resolve([]));await loading;
  assert.deepEqual(f.opened,[]);assert.equal(f.node('tTitle').value,'');assert.equal(f.node('tClient').value,'');assert.equal(f.context.editingTask,null);
});

test('late viewing assignee and request responses do not populate the next session',async()=>{
  const f=fixture(),loading=f.context.populateViewingForm({agent_id:'synthetic-other-owner'});f.switchSession();
  f.pending[0].resolve({data:{id:'synthetic-other-owner',full_name:'SYNTHETIC PRIVATE ASSIGNEE'},error:null});await loading;
  assert.equal(f.node('vAgent').innerHTML,'');assert.deepEqual(f.toasts,[]);
  f.node('vClient').value='synthetic-client';const request=f.context.loadViewingClientProperty('synthetic-private-request');f.switchSession();
  f.pending[1].resolve({data:{id:'synthetic-private-request',request_type:'investor'},error:null});await request;
  assert.equal(f.node('vRequest').innerHTML,'');assert.equal(f.node('vRequestType').value,'');assert.deepEqual(f.toasts,[]);
});

test('current-session task opens normally with its permitted client and deal selections',async()=>{
  const f=fixture(),loading=f.context.editTask('synthetic-task');
  f.pending[0].resolve({data:{id:'synthetic-task',title:'SYNTHETIC CURRENT TASK',client_id:'synthetic-client',deal_id:'synthetic-deal',user_id:'synthetic-owner'},error:null});await f.flush();
  f.pending[1].resolve([{id:'synthetic-client',name:'SYNTHETIC CLIENT'}]);f.pending[2].resolve([{id:'synthetic-deal',client:{name:'SYNTHETIC CLIENT'}}]);await loading;
  assert.equal(f.node('tTitle').value,'SYNTHETIC CURRENT TASK');assert.equal(f.node('tClient').value,'synthetic-client');assert.equal(f.node('tDeal').value,'synthetic-deal');
  assert.deepEqual(f.opened,[['mTask','on']]);assert.deepEqual(f.toasts,[]);
});
