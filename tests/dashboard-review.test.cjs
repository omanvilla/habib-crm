'use strict';
// Independent regression coverage: delayed/failed backend work must not mix
// owner workspaces, cross sessions, or leave an indefinitely loading dashboard.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('crm-operations-v6.js','utf8');

function fixture(role='owner'){
  const nodes=new Map(['opsDailyWork','opsDashboardTitle','opsDashboardScopeNote','opsDashboardDate','opsPerformanceDetails','opsDashboardPerformanceResults'].map(id=>[id,{id,innerHTML:'',textContent:'',querySelector:()=>null,querySelectorAll:()=>[]}]));
  const pending=[],listeners=[],timers=new Map();let timerId=0;
  const context={document:{getElementById:id=>nodes.get(id)||null,querySelectorAll:()=>[],addEventListener:(name,fn)=>{if(name==='click')listeners.push(fn);}},
    currentUser:{id:'synthetic-'+role},currentProfile:{role},currentCompany:{created_at:'2026-01-01'},crmSessionGeneration:1,
    canEdit:()=>role!=='viewer',isOwner:()=>context.currentProfile.role==='owner',
    escapeHtml:value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    supa:{rpc:(name,args)=>new Promise(resolve=>pending.push({name,args,resolve}))},
    setTimeout:callback=>{const id=++timerId;timers.set(id,callback);return id;},clearTimeout:id=>timers.delete(id)};
  context.crmSessionCurrent=(generation,user)=>context.crmSessionGeneration===generation&&context.currentUser?.id===user;
  context.window=context;vm.createContext(context);vm.runInContext(source,context);
  return {context,nodes,pending,timers,html:()=>nodes.get('opsDailyWork').innerHTML,
    flush:()=>new Promise(resolve=>setImmediate(resolve)),
    fireTimers:()=>{for(const callback of [...timers.values()])callback();},
    click:(selector,dataset)=>listeners.forEach(fn=>fn({target:{closest:q=>q===selector?{dataset}:null}}))};
}
function result(scope,marker){return {error:null,data:{scope,as_of:'2026-10-15',generated_at:'2026-10-15T10:00:00Z',counts:{followups_due:1,hot_requests:0,viewings_today:0,open_deals:0,urgent_tasks:0,uncontacted:0},
  requests:[{id:'synthetic-request-'+marker,client_id:'synthetic-client-'+marker,request_type:'buyer',next_followup:'2020-01-01'}],
  followups:[{id:'synthetic-request-'+marker,client_id:'synthetic-client-'+marker,request_type:'buyer',next_followup:'2020-01-01'}],
  clients:[{id:'synthetic-client-'+marker,name:marker}],hotRequests:[],visits:[],tasks:[],deals:[],contactQueue:[],
  totals:{followups:1,hot:0,visits:0,tasks:0,deals:0,contact:0},clientFilters:{due:['synthetic-client-'+marker],uncontacted:[],hotfocus:[]}}};}

test('one unavailable owner workspace preserves the successful branch work',async()=>{
  const f=fixture(),loading=f.context.loadDashboard();
  assert.deepEqual(f.pending.map(x=>x.args.p_scope),['branches','investment']);
  f.pending[0].resolve(result('branches','SYNTHETIC BRANCH WORK'));await f.flush();
  assert.match(f.html(),/SYNTHETIC BRANCH WORK/);
  f.pending[1].resolve({error:{message:'SYNTHETIC INVESTMENT FAILURE'}});await loading;
  assert.match(f.html(),/SYNTHETIC BRANCH WORK/);assert.match(f.html(),/SYNTHETIC INVESTMENT FAILURE/);
  assert.doesNotMatch(f.html(),/aria-busy="true"/);assert.equal(f.timers.size,0);
});

test('older refresh results cannot replace newer workspace counts or rows',async()=>{
  const f=fixture(),old=f.context.loadDashboard(),latest=f.context.loadDashboard();
  for(const call of f.pending.slice(2))call.resolve(result(call.args.p_scope,'SYNTHETIC CURRENT '+call.args.p_scope));
  await latest;assert.match(f.html(),/SYNTHETIC CURRENT branches/);
  for(const call of f.pending.slice(0,2))call.resolve(result(call.args.p_scope,'SYNTHETIC STALE '+call.args.p_scope));
  await old;assert.match(f.html(),/SYNTHETIC CURRENT branches/);assert.doesNotMatch(f.html(),/SYNTHETIC STALE/);
});

test('owner replies arriving after an employee session starts cannot render private data',async()=>{
  const f=fixture(),old=f.context.loadDashboard();
  f.context.currentUser={id:'synthetic-muscat'};f.context.currentProfile={role:'agent'};f.context.crmSessionGeneration++;
  f.context.crmResetOperations();const employee=f.context.loadDashboard();
  assert.equal(f.pending.length,3);assert.equal(f.pending[2].args.p_scope,'branches');
  f.pending[2].resolve(result('branches','SYNTHETIC EMPLOYEE WORK'));await employee;
  for(const call of f.pending.slice(0,2))call.resolve(result(call.args.p_scope,'SYNTHETIC OWNER PRIVATE'));
  await old;assert.match(f.html(),/SYNTHETIC EMPLOYEE WORK/);assert.doesNotMatch(f.html(),/SYNTHETIC OWNER PRIVATE|data-dashboard-card="investment"/);
});

test('timeouts settle both cards and a scoped retry can recover without stale late data',async()=>{
  const f=fixture(),loading=f.context.loadDashboard();f.fireTimers();await loading;
  assert.doesNotMatch(f.html(),/aria-busy="true"/);assert.match(f.html(),/تعذر تحديث هذا الملخص/);
  f.click('[data-dashboard-retry]',{dashboardRetry:'branches'});
  assert.equal(f.pending.length,3);f.pending[2].resolve(result('branches','SYNTHETIC RECOVERED'));await f.flush();
  assert.match(f.html(),/SYNTHETIC RECOVERED/);
  for(const call of f.pending.slice(0,2))call.resolve(result(call.args.p_scope,'SYNTHETIC TOO LATE'));await f.flush();
  assert.match(f.html(),/SYNTHETIC RECOVERED/);assert.doesNotMatch(f.html(),/SYNTHETIC TOO LATE/);
});

test('performance timeout displays a terminal retry state and ignores its late response',async()=>{
  const f=fixture();f.context.crmDashboardPerformancePeriod('month');f.fireTimers();await f.flush();
  const box=f.nodes.get('opsDashboardPerformanceResults');assert.match(box.innerHTML,/data-performance-retry/);
  f.pending[0].resolve({data:{employees:[{name:'SYNTHETIC LATE PERFORMANCE',targets:{}}]},error:null});await f.flush();
  assert.doesNotMatch(box.innerHTML,/SYNTHETIC LATE PERFORMANCE/);assert.match(box.innerHTML,/data-performance-retry/);
});
