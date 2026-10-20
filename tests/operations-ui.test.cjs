'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('crm-operations-v6.js','utf8');

function fixture(setup=()=>{}){
  const nodes=new Map(['employeePerformanceResults','opsDashboardPerformanceResults','opsPerformanceDetails','teamLeaderboard'].map(id=>[id,{id,innerHTML:'',textContent:'',querySelectorAll:()=>[],querySelector:()=>null}]));
  const pending=[];
  let finishTeam;
  const context={document:{getElementById:id=>nodes.get(id)||null,querySelectorAll:()=>[],addEventListener(){}},
    currentUser:{id:'TEST-owner'},currentProfile:{role:'owner'},currentCompany:{created_at:'2026-05-01'},crmSessionGeneration:1,
    escapeHtml:value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    supa:{rpc:async(name,args)=>new Promise(resolve=>pending.push({name,args,resolve}))},
    loadTeam:()=>new Promise(resolve=>{finishTeam=resolve})};
  context.crmSessionCurrent=(generation,user)=>context.crmSessionGeneration===generation&&context.currentUser?.id===user;
  context.window=context;setup(context,nodes);vm.createContext(context);vm.runInContext(source,context);
  return {context,nodes,pending,finishTeam:()=>finishTeam(),flush:()=>new Promise(resolve=>setImmediate(resolve))};
}
// The synthetic period caption identifies each delayed response; branch names remain stable.
const result=marker=>({data:{scope:'branch',from:marker,branches:[{id:'muscat',branch:'muscat',active_inventory:10,targets:{}}]},error:null});

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
  f.pending[0].resolve({data:{branches:[]},error:null});await f.flush();
  assert.match(f.nodes.get('employeePerformanceResults').innerHTML,/لا توجد فروع متاحة لهذا الحساب/);
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


test('report team uses the selected complete month and the same reservation and human-message metrics',async()=>{
  const f=fixture();
  f.context.crmReportPerformance('month',{from:'2024-10-01',to:'2024-11-01'});
  assert.deepEqual(JSON.parse(JSON.stringify(f.pending[0].args)),{p_from:'2024-10-01',p_to:'2024-11-01'});
  f.pending[0].resolve({data:{from:'2024-10-01',branches:[{id:'muscat',branch:'muscat',name:'TEST historical account',reservations:2,expected_commission:4500,commission_collected:0,inquiry_clients:7,replied_inquiry_clients:5,successful_staff_messages:13,targets:{}}]},error:null});
  await f.flush();const html=f.nodes.get('teamLeaderboard').innerHTML;
  assert.match(html,/2024-10-01/);assert.match(html,/2024-10-31/);
  assert.match(html,/حجوزات مؤكدة في الفترة/);assert.match(html,/4,500/);
  assert.match(html,/عملاء استفسروا عن عقار/);assert.match(html,/مستفسرون ردّ عليهم الفريق/);assert.match(html,/رسائل أرسلها الفريق/);
  assert.doesNotMatch(html,/رسائل واتساب صادرة من الفريق/);
});
test('missing performance response is an error, never an empty or zero result',async()=>{
 const f=fixture();f.context.crmPerformancePeriod('month');
 f.pending[0].resolve({data:{},error:null});await f.flush();
 assert.match(f.nodes.get('employeePerformanceResults').innerHTML,/تعذر تحميل الأداء/);
 assert.doesNotMatch(f.nodes.get('employeePerformanceResults').innerHTML,/لا توجد فروع متاحة لهذا الحساب/);
});

test('refreshing dashboard work refreshes only open performance and retains its selected rolling period',async()=>{
 const f=fixture(),panel=f.nodes.get('opsPerformanceDetails'),box=f.nodes.get('opsDashboardPerformanceResults');
 const initial=f.context.crmDashboardPerformancePeriod('months3');f.pending[0].resolve(result('TEST BEFORE MUTATION'));await initial;
 const span=JSON.parse(JSON.stringify(f.pending[0].args));panel.open=true;
 const refreshing=f.context.loadDashboard();assert.match(box.innerHTML,/جاري تحميل الأداء/);await f.flush();
 const reads=f.pending.slice(1);assert.deepEqual(reads.map(r=>r.name),['crm_dashboard_work','crm_dashboard_work','crm_branch_performance']);
 const performance=reads.find(r=>r.name==='crm_branch_performance');assert.deepEqual(JSON.parse(JSON.stringify(performance.args)),span);
 reads.forEach(r=>r.resolve(r.name==='crm_branch_performance'?result('TEST AFTER MUTATION'):{data:{scope:r.args.p_scope,counts:{}},error:null}));await refreshing;
 assert.match(box.innerHTML,/TEST AFTER MUTATION/);assert.doesNotMatch(box.innerHTML,/TEST BEFORE MUTATION/);
 assert.equal(f.nodes.get('employeePerformanceResults').innerHTML,'');assert.equal(f.nodes.get('teamLeaderboard').innerHTML,'');
 panel.open=false;const next=f.pending.length,closed=f.context.loadDashboard();await f.flush();
 assert.deepEqual(f.pending.slice(next).map(r=>r.name),['crm_dashboard_work','crm_dashboard_work']);f.pending.slice(next).forEach(r=>r.resolve({data:{scope:r.args.p_scope,counts:{}},error:null}));await closed;
});

test('a stale client-list completion cannot invalidate a fresh export snapshot',async()=>{
 const completions=[],downloads=[],toasts=[];
 const f=fixture((c,nodes)=>{
  for(const id of ['clientsList','opsClientBranches'])nodes.set(id,{id,innerHTML:'',querySelectorAll:()=>[]});
  c.isOwner=()=>true;c.canEdit=()=>false;c.allClients=[];c.clientWorkRequests=[];
  c.loadClients=()=>new Promise(resolve=>completions.push(resolve));c.renderClients=()=>c.crmRenderClientWorkList(c.allClients);
  c.exportClients=()=>downloads.push(c.allClients.map(x=>x.id));c.showToast=(...args)=>toasts.push(args);
 });
 const old=f.context.loadClients(),fresh=f.context.loadClients();f.context.allClients=[{id:'TEST_FRESH',name:'TEST Fresh'}];f.context.renderClients();completions[1](true);await fresh;
 completions[0](false);await old;f.context.exportClients();assert.deepEqual(Array.from(downloads[0]),['TEST_FRESH']);assert.equal(toasts.length,0);
});

test('normal property filters use the same displayed count and exact exported records',async()=>{
 const handlers={},downloads=[];
 const f=fixture((c,nodes)=>{
  for(const id of ['propertiesList','propertiesSub','opsPropertyStatus'])nodes.set(id,{id,innerHTML:'',textContent:'',value:'',querySelectorAll:()=>[]});
  c.document.addEventListener=(name,handler)=>(handlers[name]||(handlers[name]=[])).push(handler);
  c.isOwner=()=>true;c.canEdit=()=>false;c.allProperties=[{id:'TEST_1',title:'TEST One',status:'available',branch_key:'muscat'},{id:'TEST_2',title:'TEST Two',status:'reserved',branch_key:'muscat'},{id:'TEST_3',title:'TEST Three',status:'available',branch_key:'barka'}];
  c.loadProperties=async()=>true;c.exportProperties=()=>downloads.push(c.allProperties.map(p=>p.id));c.showToast=()=>assert.fail('valid property export must succeed');
 });
 await f.context.loadProperties();assert.match(f.nodes.get('propertiesSub').textContent,/^3 عقار/);
 const target=f.nodes.get('opsPropertyStatus');target.value='available';handlers.change.forEach(handler=>handler({target}));
 assert.match(f.nodes.get('propertiesSub').textContent,/^2 عقار مطابق · من 3/);assert.doesNotMatch(f.nodes.get('propertiesList').innerHTML,/TEST Two/);
 f.context.exportProperties();assert.deepEqual(Array.from(downloads[0]),['TEST_1','TEST_3']);assert.equal(f.context.allProperties.length,3);
});

test('session reset clears private client detail, property detail and period result caches',()=>{
 const privateIds=['cdTabJourney','cdActivities','cdTabRequests','cdTabInterests','cdTabListings','cdTabTasks','cdTabDeals','cdTabInfo','cdSmartMatches','cdClientAI','propertyDetailContent','opsDashboardPerformanceResults','employeePerformanceResults','teamLeaderboard','conversionFunnel'];
 const f=fixture((_c,nodes)=>privateIds.forEach(id=>{let html='TEST_PRIVATE_ACCOUNT_DATA';nodes.set(id,{id,get innerHTML(){return html;},set innerHTML(v){html=v;},set textContent(v){html=v;}});}));
 f.context.client360Data={client:{id:'TEST_PRIVATE_CLIENT'}};f.context.crmResetOperations();
 for(const id of privateIds)assert.equal(f.nodes.get(id).innerHTML,'',id);assert.equal(f.context.client360Data,null);
});
