'use strict';
// Run the shipped renderer against isolated API responses. PostgreSQL tests
// independently prove the branch aggregation and actual access restrictions.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('crm-operations-v6.js','utf8');
function fixture(role='owner'){
 const nodes=new Map(['opsEmployeeTargets','employeePerformanceResults','opsDashboardPerformanceResults','opsPerformanceDetails','teamLeaderboard','conversionFunnel'].map(id=>[id,{id,innerHTML:'',textContent:'',querySelectorAll:()=>[]}])) ,calls=[],listeners=[];
 const context={document:{getElementById:id=>nodes.get(id)||null,querySelectorAll:()=>[],addEventListener:(event,fn)=>{if(event==='click')listeners.push(fn);}},currentUser:{id:'TEST_OWNER'},currentProfile:{role},crmSessionGeneration:1,
  escapeHtml:value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),supa:{rpc:(name,args)=>new Promise(resolve=>calls.push({name,args,resolve}))}};
 context.window=context;context.crmSessionCurrent=(generation,user)=>generation===context.crmSessionGeneration&&user===context.currentUser?.id;vm.createContext(context);vm.runInContext(source,context);
 return {context,nodes,calls,flush:()=>new Promise(resolve=>setImmediate(resolve)),targets:()=>listeners.forEach(fn=>fn({target:{closest:selector=>selector==='[data-target-retry]'?{}:null}}))};
}
const branch=(key,overrides={})=>({id:key,employee_id:key,branch:key,branch_key:key,name:key==='muscat'?'هديل (اسم الحساب السابق)':'مرام (اسم الحساب الحالي)',inventory:4,inventory_property_ids:['TEST_ONE','TEST_TWO','TEST_THREE','TEST_FOUR'],new_properties:0,new_property_ids:[],followups:0,viewings:0,bookings:0,live_bookings:0,cancelled_bookings:0,expected_commission:0,inquiry_clients:13,goals:{inventory:10,new_properties:2,followups:10,viewings:5,bookings:2,expected_commission:4000},targets:{reservations_target:2,booking_commission_target:4000},...overrides});
const response=branches=>({data:{scope:'branch',from:'2026-10-01',to:'2026-11-01',today:'2026-10-20',week_start:'2026-10-18',week_end:'2026-10-24',month_start:'2026-10-01',month_end:'2026-10-31',branches},error:null});
test('branch targets remain one card per branch when the Muscat account is disabled and names change',async()=>{
 const f=fixture();f.context.allMembers=[{id:'OLD_MUSCAT',full_name:'هديل',is_active:false},{id:'BARKA',full_name:'مرام',is_active:true},{id:'NEW_BARKA',full_name:'عضو ثان',is_active:true}];
 const supplied=response([branch('barka',{inventory:13}),branch('muscat')]),before=JSON.stringify(supplied);
 f.targets();assert.equal(f.calls[0].name,'crm_branch_target_snapshot');f.calls[0].resolve(supplied);await f.flush();
 const html=f.nodes.get('opsEmployeeTargets').innerHTML;
 assert.equal((html.match(/data-target-branch-card=/g)||[]).length,2);assert.match(html,/<strong>مسقط<\/strong>/);assert.match(html,/<strong>بركاء<\/strong>/);
 assert.match(html,/13 \/ 10/);assert.match(html,/4 \/ 10/);assert.doesNotMatch(html,/هديل|مرام|عضو ثان|OLD_MUSCAT|NEW_BARKA/);
 assert.equal(JSON.stringify(supplied),before,'rendering preserves original supplied actors and values');
 assert.match(html,/data-target-branch="barka"/);assert.match(html,/data-target-branch="muscat"/);assert.doesNotMatch(html,/data-target-employee=/);
});
test('dashboard, team and reports use the branch API and stable route label despite an arbitrary account display name',async()=>{
 for(const [method,box] of [['crmDashboardPerformancePeriod','opsDashboardPerformanceResults'],['crmPerformancePeriod','employeePerformanceResults'],['crmReportPerformance','teamLeaderboard']]){
  const f=fixture(),pending=f.context[method]('month',{from:'2026-10-01',to:'2026-11-01'});
  assert.equal(f.calls[0].name,'crm_branch_performance');f.calls[0].resolve(response([branch('muscat')]));await pending;
  const html=f.nodes.get(box).innerHTML;assert.match(html,/data-performance-branch="muscat"/);assert.match(html,/<strong>مسقط<\/strong>/);assert.doesNotMatch(html,/هديل|مرام|الإسناد المعتمد للعمل منذ 1 أغسطس/);
  assert.match(html,/رسائل أرسلها الفريق/);assert.match(html,/مستفسرون ردّ عليهم الفريق/);
 }
});
test('duplicate branch rows are rejected rather than displayed twice or summed',async()=>{
 for(const targets of [false,true]){
  const f=fixture();if(targets)f.targets();else f.context.crmPerformancePeriod('month');
  f.calls[0].resolve(response([branch('muscat'),branch('muscat',{inquiry_clients:99})]));await f.flush();
  const html=f.nodes.get(targets?'opsEmployeeTargets':'employeePerformanceResults').innerHTML;
  assert.match(html,/role="alert"/);assert.doesNotMatch(html,/data-performance-branch=|data-target-branch-card=|112|99/);
 }
});
test('an older employee UUID response cannot be relabelled as branch results',async()=>{
 const f=fixture(),pending=f.context.crmPerformancePeriod('month');
 f.calls[0].resolve({data:{employees:[branch('muscat',{id:'OLD_MUSCAT',employee_id:'OLD_MUSCAT'})]},error:null});await pending;
 const html=f.nodes.get('employeePerformanceResults').innerHTML;assert.match(html,/تعذر تحميل الأداء/);assert.doesNotMatch(html,/data-performance-branch=/);
});
test('private investment or unknown route entries fail closed instead of joining ordinary branch totals',async()=>{
 for(const key of ['investment','general','unrecognized']){
  const f=fixture(),pending=f.context.crmPerformancePeriod('month');f.calls[0].resolve(response([branch('muscat'),branch(key)]));await pending;
  assert.match(f.nodes.get('employeePerformanceResults').innerHTML,/role="alert"/);assert.doesNotMatch(f.nodes.get('employeePerformanceResults').innerHTML,/data-performance-branch=/);
 }
});
test('a current branch loading failure remains unavailable and stale successful results cannot restore old cards',async()=>{
 const f=fixture();f.targets();f.targets();f.calls[1].resolve({data:null,error:{message:'TEST unavailable'}});await f.flush();
 const latest=f.nodes.get('opsEmployeeTargets').innerHTML;assert.match(latest,/تعذر تحميل الأهداف/);
 f.calls[0].resolve(response([branch('muscat')]));await f.flush();assert.equal(f.nodes.get('opsEmployeeTargets').innerHTML,latest);
});
