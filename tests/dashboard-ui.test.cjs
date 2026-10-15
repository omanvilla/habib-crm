'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
 const listeners=[],calls=[],nodes=new Map(['opsDailyWork','opsPerformanceDetails','opsDashboardTitle','opsDashboardScopeNote','opsDashboardDate'].map(id=>[id,{innerHTML:'',querySelector:()=>null,querySelectorAll:()=>[]}]))
 const payload=scope=>({scope,as_of:'2026-10-15',counts:{uncontacted:0,followups_due:0,hot_requests:0,viewings_today:0,open_deals:0,urgent_tasks:0},requests:[],followups:[],hotRequests:[],visits:[],deals:[],tasks:[],contactQueue:[],clients:[],totals:{},clientFilters:{uncontacted:[],due:[],hotfocus:[]}}),data={branches:payload('branches'),investment:payload('investment')};
 const c={document:{getElementById:id=>nodes.get(id)||null,querySelectorAll:()=>[],addEventListener:(name,fn)=>{if(name==='click')listeners.push(fn)}},currentUser:{id:'SYNTHETIC-OWNER'},currentProfile:{role:'owner'},crmSessionGeneration:1,canEdit:()=>true,isOwner:()=>true,escapeHtml:v=>String(v).replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x])),loadPropertyActionQueue:async target=>calls.push({propertyQueue:target}),supa:{rpc:async(name,args)=>{calls.push({name,args});return{data:data[args.p_scope],error:null};}}};
 c.crmSessionCurrent=(g,u)=>g===c.crmSessionGeneration&&u===c.currentUser?.id;c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync('crm-operations-v6.js','utf8'),c);
 return {c,data,calls,html:()=>nodes.get('opsDailyWork').innerHTML,click:(selector,dataset)=>listeners.forEach(fn=>fn({target:{closest:q=>q===selector?{dataset}:null}}))};
}
test('a future investment visit remains actionable when all today counters are zero',async()=>{
 const f=fixture();f.data.investment.visits=[{id:'SYNTHETIC-FUTURE',client_id:'SYNTHETIC-PRIVATE',client:{name:'SYNTHETIC FUTURE PRIVATE VISIT'},viewing_date:'2030-01-02',viewing_time:'10:00',status:'scheduled'}];f.data.investment.totals={visits:1};
 await f.c.loadDashboard();assert.doesNotMatch(f.html(),/SYNTHETIC FUTURE PRIVATE VISIT/);
 f.click('[data-dashboard-scope],[data-dashboard-category]',{dashboardScope:'investment'});
 assert.match(f.html(),/SYNTHETIC FUTURE PRIVATE VISIT/);assert.doesNotMatch(f.html(),/مساحتك الخاصة للمستثمرين جاهزة/);assert.match(f.html(),/data-work-id="SYNTHETIC-FUTURE"/);
});
test('empty investment state offers new investor entry without changing the branch summary',async()=>{
 const f=fixture();await f.c.loadDashboard();f.click('[data-dashboard-scope],[data-dashboard-category]',{dashboardScope:'investment'});
 assert.match(f.html(),/data-work-action="new-investor"/);assert.match(f.html(),/data-dashboard-card="branches"/);
});
test('dashboard property reminders are paused while the properties page keeps the same loader',async()=>{
 const f=fixture();await f.c.loadPropertyActionQueue('dashboard');await f.c.loadPropertyActionQueue('properties');assert.deepEqual(f.calls,[{propertyQueue:'properties'}]);
});
test('private names and request notes are escaped before insertion into the dashboard',async()=>{
 const f=fixture();f.data.investment.counts.followups_due=1;f.data.investment.followups=[{id:'SYNTHETIC-R',client_id:'SYNTHETIC-C',next_action:'<img src=x onerror=alert(1)>',next_followup:'2020-01-01'}];f.data.investment.clients=[{id:'SYNTHETIC-C',name:'<script>private</script>'}];await f.c.loadDashboard();f.click('[data-dashboard-scope],[data-dashboard-category]',{dashboardScope:'investment'});
 assert.doesNotMatch(f.html(),/<script>|<img src=x/);assert.match(f.html(),/&lt;script&gt;private/);assert.match(f.html(),/&lt;img src=x/);
});
