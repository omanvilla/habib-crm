'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app-base-v15.html','utf8');
function fn(name){const m=new RegExp('(?:async )?function '+name+'\\(').exec(source);assert(m);for(let end=source.indexOf('}',m.index);end>=0;end=source.indexOf('}',end+1)){const text=source.slice(m.index,end+1);try{new vm.Script(text);return text;}catch{}}throw Error('missing '+name);}
function fixture(code){
 const nodes=new Map(),calls=[],toasts=[],errors=[],queries=[],warnings=[];
 const node=id=>{if(!nodes.has(id))nodes.set(id,{id,value:'',innerHTML:'',textContent:'',disabled:false,dataset:{},style:{}});return nodes.get(id);};
 const context={$:node,currentUser:{id:'TEST_OWNER'},currentProfile:{id:'TEST_OWNER',company_id:'TEST_COMPANY',role:'owner'},crmSessionGeneration:1,document:{visibilityState:'visible'},setTimeout,clearTimeout,
  escapeHtml:String,isOwner:()=>context.currentProfile?.role==='owner',showToast:(...args)=>toasts.push(args),showError:text=>errors.push(text),console:{warn:(...args)=>warnings.push(args)},crmBeginSave:()=>true,crmEndSave:()=>{},loadDashboard:()=>{},updateUserUI:()=>{},
  supa:{from:table=>{const filters=[],q={select:columns=>{q.columns=columns;return q;},eq:(key,value)=>{filters.push([key,value]);return q;},maybeSingle:()=>q,then:(resolve,reject)=>new Promise(r=>queries.push({table,columns:q.columns,filters,resolve:r})).then(resolve,reject)};return q;},auth:{signOut:async args=>{calls.push({signOut:args});return {error:null};}}}};
 context.crmSessionCurrent=(generation,user)=>generation===context.crmSessionGeneration&&user===context.currentUser?.id;
 context.clearSessionUI=()=>{calls.push({cleared:true});context.crmSessionGeneration++;context.currentUser=null;context.currentProfile=null;};
 context.window=context;vm.createContext(context);vm.runInContext(code,context);
 return {context,nodes,node,calls,toasts,errors,queries,warnings,flush:()=>new Promise(resolve=>setImmediate(resolve))};
}
const labelCode=['crmBranchName','crmReadBranchRows','crmMemberChoiceLabel'].map(fn).join('\n');
test('editing a property preserves the disabled historical source instead of selecting the current owner',async()=>{
 const f=fixture('let propertySourceLoadSeq=0;\n'+labelCode+'\n'+fn('populatePropertySourceSelect'));
 const pending=f.context.populatePropertySourceSelect('TEST_OLD_SOURCE');await f.flush();
 f.queries[0].resolve({data:[{id:'TEST_OWNER',role:'owner',is_active:true}],error:null});await f.flush();
 assert(f.queries[1].filters.some(([key,value])=>key==='id'&&value==='TEST_OLD_SOURCE'));
 f.queries[1].resolve({data:{id:'TEST_OLD_SOURCE',role:'agent',is_active:false,full_name:'صاحب سجل اصطناعي'},error:null});await pending;
 const select=f.node('pSourcedBy');assert.equal(select.value,'TEST_OLD_SOURCE');assert.equal(select.dataset.ready,'true');assert.match(select.innerHTML,/سجل سابق · صاحب سجل اصطناعي/);
});
test('a missing historical source fails closed and never offers the owner as a saveable fallback',async()=>{
 const f=fixture('let propertySourceLoadSeq=0;\n'+labelCode+'\n'+fn('populatePropertySourceSelect'));
 const pending=f.context.populatePropertySourceSelect('TEST_OLD_SOURCE');await f.flush();f.queries[0].resolve({data:[{id:'TEST_OWNER',role:'owner',is_active:true}],error:null});await f.flush();
 f.queries[1].resolve({data:null,error:{message:'TEST source lookup failed'}});await pending;
 assert.equal(f.node('pSourcedBy').dataset.ready,'false');assert.equal(f.node('pSourcedBy').disabled,true);assert.match(f.node('pSourcedBy').innerHTML,/تعذر تحميل/);assert.doesNotMatch(f.node('pSourcedBy').innerHTML,/TEST_OWNER/);
});
test('late property-source responses cannot select an earlier property or a previous session actor',async()=>{
 const f=fixture('let propertySourceLoadSeq=0;\n'+labelCode+'\n'+fn('populatePropertySourceSelect'));
 const old=f.context.populatePropertySourceSelect('TEST_OLD_SOURCE');await f.flush();f.queries[0].resolve({data:[],error:null});await f.flush();
 const current=f.context.populatePropertySourceSelect('TEST_OWNER');await f.flush();f.queries[2].resolve({data:[{id:'TEST_OWNER',role:'owner',is_active:true}],error:null});await current;
 f.queries[1].resolve({data:{id:'TEST_OLD_SOURCE',role:'agent',is_active:false,full_name:'OLD'},error:null});await old;assert.equal(f.node('pSourcedBy').value,'TEST_OWNER');assert.doesNotMatch(f.node('pSourcedBy').innerHTML,/TEST_OLD_SOURCE/);
});
const activeCode='let activeProfileCheck=null,lastActiveProfileCheck=0;\n'+fn('crmRevalidateActiveProfile');
test('an observed inactive account clears cached UI and signs out locally, including an already-issued session',async()=>{
 const f=fixture(activeCode),pending=f.context.crmRevalidateActiveProfile();await f.flush();f.queries[0].resolve({data:{is_active:false},error:null});await pending;
 assert.deepEqual(JSON.parse(JSON.stringify(f.calls)),[{cleared:true},{signOut:{scope:'local'}}]);assert.match(f.errors[0],/هذا الحساب معطّل/);assert.equal(f.context.currentUser,null);
});
test('a delayed inactive result cannot sign out the next account and repeated focus events share one check',async()=>{
 const f=fixture(activeCode),pending=f.context.crmRevalidateActiveProfile();await f.context.crmRevalidateActiveProfile();await f.flush();assert.equal(f.queries.length,1);
 f.context.currentUser={id:'TEST_NEXT_ACCOUNT'};f.context.crmSessionGeneration++;f.queries[0].resolve({data:{is_active:false},error:null});await pending;assert.deepEqual(f.calls,[]);assert.deepEqual(f.errors,[]);
});
test('network failure during an account-state check is reported to logs without inventing a deactivation',async()=>{
 const f=fixture(activeCode),pending=f.context.crmRevalidateActiveProfile();await f.flush();f.queries[0].resolve({data:null,error:{message:'TEST network unavailable'}});await pending;assert.equal(f.warnings.length,1);assert.deepEqual(f.calls,[]);assert.deepEqual(f.errors,[]);
});
test('a banned sign-in error is understandable in Arabic and never opens the application',async()=>{
 const f=fixture(fn('handleLogin'));f.context.clearAuthMessages=()=>{};f.context.loadApp=()=>assert.fail('banned login must not open CRM');f.context.supa.auth.signInWithPassword=async()=>({error:{message:'User is banned',code:'user_banned'}});
 f.node('loginEmail').value='synthetic@example.invalid';f.node('loginPwd').value='SYNTHETIC_TEST_VALUE';await f.context.handleLogin();assert.equal(f.errors[0],'هذا الحساب معطّل. تواصل مع الإدارة.');assert.equal(f.node('loginBtn').disabled,false);
});
test('branch target saves use the month and version loaded before Oman midnight, preserving all three decimal places',async()=>{
 const goalCode=source.slice(source.indexOf('const employeeGoalFields='),source.indexOf("document.addEventListener('click',e=>{const b=e.target.closest('[data-branch-goal-save]')"));
 const f=fixture(labelCode+'\n'+fn('employeeTargetMonth')+'\n'+goalCode),rpcCalls=[];let date='2026-10-31T19:59:00Z';
 f.context.Date=class extends Date{constructor(...args){super(...(args.length?args:[date]));}};
 f.context.supa.rpc=async(name,args)=>{rpcCalls.push({name,args:JSON.parse(JSON.stringify(args))});if(name==='crm_save_branch_monthly_targets')return {data:{branch_key:args.p_branch,month_start:args.p_month},error:null};return {data:{scope:'branch',month_start:args.p_month,branches:[{id:'muscat',branch:'muscat',updated_at:'2026-10-19T08:00:00Z',goals:{inventory:10,new_properties:2,followups:10,viewings:5,bookings:2,expected_commission:4000}}]},error:null};};
 await f.context.loadEmployeeTeamTargets();for(const [suffix,value] of [['Inv',10],['WeeklyNew',2],['Daily',13],['WeeklyVisits',5],['Bookings',2],['BookingComm',4000.005]])f.node('et'+suffix+'_muscat').value=String(value);
 date='2026-10-31T20:01:00Z';await f.context.saveEmployeeTarget('muscat');const saved=rpcCalls.find(c=>c.name==='crm_save_branch_monthly_targets');assert.equal(saved.args.p_month,'2026-10-01');assert.equal(saved.args.p_expected_updated_at,'2026-10-19T08:00:00Z');assert.equal(saved.args.p_targets.booking_commission_target,4000.005);assert.equal(rpcCalls.at(-1).args.p_month,'2026-11-01');assert.match(f.toasts[0][0],/مسقط لشهر 2026-10/);
});
