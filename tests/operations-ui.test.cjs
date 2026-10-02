'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('crm-operations-v6.js','utf8');

function fixture(){
  const nodes=new Map(['employeePerformanceResults','opsDashboardPerformanceResults','opsPerformanceDetails'].map(id=>[id,{id,innerHTML:'',textContent:'',querySelectorAll:()=>[]}]));
  const pending=[];
  let finishTeam;
  const context={document:{getElementById:id=>nodes.get(id)||null,querySelectorAll:()=>[],addEventListener(){}},
    currentUser:{id:'TEST-owner'},currentProfile:{role:'owner'},currentCompany:{created_at:'2026-05-01'},crmSessionGeneration:1,
    escapeHtml:value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    supa:{rpc:async(name,args)=>new Promise(resolve=>pending.push({name,args,resolve}))},
    loadTeam:()=>new Promise(resolve=>{finishTeam=resolve})};
  context.crmSessionCurrent=(generation,user)=>context.crmSessionGeneration===generation&&context.currentUser?.id===user;
  context.window=context;vm.createContext(context);vm.runInContext(source,context);
  return {context,nodes,pending,finishTeam:()=>finishTeam(),flush:()=>new Promise(resolve=>setImmediate(resolve))};
}
const result=name=>({data:{from:'2026-10-01',employees:[{name,active_inventory:10,targets:{}}]},error:null});

test('late employee period result cannot overwrite the selected newer period',async()=>{
  for(const method of ['crmPerformancePeriod','crmDashboardPerformancePeriod']){
    const f=fixture(),box=f.nodes.get(method==='crmPerformancePeriod'?'employeePerformanceResults':'opsDashboardPerformanceResults');
    f.context[method]('month');f.context[method]('day');
    f.pending[1].resolve(result('TEST latest day'));await f.flush();
    f.pending[0].resolve(result('TEST stale month'));await f.flush();
    assert.match(box.innerHTML,/TEST latest day/);assert.doesNotMatch(box.innerHTML,/TEST stale month/);
  }
});
test('late employee period error cannot replace a newer successful result',async()=>{
  const f=fixture();f.context.crmPerformancePeriod('month');f.context.crmPerformancePeriod('day');
  f.pending[1].resolve(result('TEST latest day'));await f.flush();
  f.pending[0].resolve({error:{message:'TEST stale error'}});await f.flush();
  assert.match(f.nodes.get('employeePerformanceResults').innerHTML,/TEST latest day/);
  assert.doesNotMatch(f.nodes.get('employeePerformanceResults').innerHTML,/TEST stale error/);
});
test('team and dashboard performance loads remain independent',async()=>{
  const f=fixture();f.context.crmPerformancePeriod('month');f.context.crmDashboardPerformancePeriod('day');
  f.pending[1].resolve(result('TEST dashboard'));f.pending[0].resolve(result('TEST team'));await f.flush();
  assert.match(f.nodes.get('employeePerformanceResults').innerHTML,/TEST team/);
  assert.match(f.nodes.get('opsDashboardPerformanceResults').innerHTML,/TEST dashboard/);
});
test('performance response from a previous session cannot repopulate either panel',async()=>{
  const f=fixture();f.context.crmPerformancePeriod('month');f.context.crmDashboardPerformancePeriod('day');
  f.context.crmSessionGeneration++;f.context.currentUser={id:'TEST-other-user'};
  f.pending.forEach(p=>p.resolve(result('TEST previous account')));await f.flush();
  for(const node of f.nodes.values())assert.doesNotMatch(node.innerHTML,/TEST previous account/);
});
test('finishing team load preserves the period selected while it was loading',async()=>{
  const f=fixture(),loading=f.context.loadTeam();f.context.crmPerformancePeriod('day');
  f.finishTeam();await f.flush();
  assert.equal(f.pending[1].args.p_from,f.pending[0].args.p_from);
  assert.equal(f.pending[1].args.p_to,f.pending[0].args.p_to);
  f.pending[1].resolve(result('TEST day'));f.pending[0].resolve(result('TEST old day'));await loading;await f.flush();
});
test('empty employee list displays a clear empty state',async()=>{
  const f=fixture();f.context.crmPerformancePeriod('month');
  f.pending[0].resolve({data:{employees:[]},error:null});await f.flush();
  assert.match(f.nodes.get('employeePerformanceResults').innerHTML,/لا يوجد موظفون نشطون/);
});

function exportFixture(){
  const f=fixture(),queries=[],downloads=[],toasts=[];
  f.context.viewingProperty={id:'TEST-property',title:'TEST owner property',created_at:'2026-10-01'};
  f.context.downloadCSV=(...args)=>downloads.push(args);
  f.context.showToast=(...args)=>toasts.push(args);
  f.context.supa.from=table=>{
    const promise=new Promise(resolve=>queries.push({table,resolve}));
    const query={select(){return query},eq(){return query},order(){return query},then:promise.then.bind(promise)};
    return query;
  };
  return {...f,queries,downloads,toasts};
}
test('owner CSV downloads only while the session that requested it remains current',async()=>{
  for(const changed of ['none','logout','switch-user','same-user-new-session']){
    const f=exportFixture(),exporting=f.context.exportPropertyOwnerReport();
    if(changed==='logout'){f.context.currentUser=null;f.context.crmSessionGeneration++;}
    if(changed==='switch-user')f.context.currentUser={id:'TEST-other-user'};
    if(changed==='same-user-new-session')f.context.crmSessionGeneration++;
    f.queries.forEach(q=>q.resolve({data:[],error:null}));await exporting;
    assert.equal(f.downloads.length,changed==='none'?1:0,changed);
  }
});
test('an owner CSV error from an old session does not surface in the next account',async()=>{
  const f=exportFixture(),exporting=f.context.exportPropertyOwnerReport();
  f.context.currentUser={id:'TEST-other-user'};f.context.crmSessionGeneration++;
  f.queries.forEach(q=>q.resolve({data:null,error:{message:'TEST previous account error'}}));await exporting;
  assert.equal(f.downloads.length,0);assert.equal(f.toasts.length,0);
});
