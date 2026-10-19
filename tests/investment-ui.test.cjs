'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),crypto=require('node:crypto').webcrypto;
const app=fs.readFileSync(path.join(__dirname,'../app-base-v15.html'),'utf8');
function fn(name){const match=new RegExp('(?:async )?function '+name+'\\(').exec(app);assert(match,name);for(let end=app.indexOf('}',match.index);end>=0;end=app.indexOf('}',end+1)){const source=app.slice(match.index,end+1);try{new vm.Script(source);return source;}catch{}}throw Error('function '+name);}
function harness(role='owner'){
 const nodes=new Map(),calls=[],toasts=[],opened=[];let next=1;
 const el=id=>{if(!nodes.has(id))nodes.set(id,{id,value:'',checked:false,disabled:false,hidden:false,dataset:{},style:{},options:[],classList:{add(){},remove(){},toggle(){}},querySelectorAll:()=>[],appendChild(o){this.options.push(o);}});return nodes.get(id);};
 const c={window:null,document:{getElementById:el,createElement:()=>({}),querySelectorAll:()=>[]},$:el,currentUser:{id:'OWNER'},currentProfile:{id:'OWNER',company_id:'COMPANY',role},crmSessionGeneration:1,allClients:[],allMembers:[],viewingClient:null,editingClient:null,editingClientRequest:null,clientRequestFormClientId:'CLIENT',clientRequestFormInvestment:false,console,crypto,Date,Map,Set,setTimeout(){},clearTimeout(){},
 canEdit:()=>role!=='viewer',canManage:()=>['owner','manager'].includes(role),isOwner:()=>role==='owner',ensureCompany:async()=> 'COMPANY',escapeHtml:x=>String(x||'').replace(/[<>&"']/g,''),showToast:(text,kind)=>toasts.push({text,kind}),loadClients:async()=>{},loadDashboard:async()=>{},viewClient:async id=>opened.push(id),renderClientInfo:async()=>{},renderClientRequestsTab:async()=>{},logSystemActivity:async()=>{},calcLeadScore:()=>20,calcLeadTemperature:()=> 'cold',closeModal(){},crmBeginSave:()=>true,crmEndSave(){},crmFinishSave(){},crmSaveKey:()=> 'NEW-'+next++};
 c.window=c;c.crmSessionCurrent=(g,id)=>g===c.crmSessionGeneration&&id===c.currentUser?.id;
 c.supa={from(table){const state={table,operation:'select',filters:[]};const q=new Proxy({}, {get(_t,k){if(k==='then')return(ok,bad)=>{calls.push(state);return Promise.resolve(c.respond?c.respond(state):{data:state.operation==='select'?[]:{id:state.data.id||'SAVED'},error:null}).then(ok,bad)};return(...args)=>{if(['insert','update'].includes(k)){state.operation=k;state.data=args[0]}else state.filters.push([k,...args]);return q;};}});return q;}};
 vm.createContext(c);const load=(...names)=>names.forEach(name=>vm.runInContext(fn(name),c));
 load('crmDigits','parseNum','crmReadNumber','crmReadBudget','crmNormalizePhone','crmValidatedPhone','saveClient','saveNewClientRequest','crmInvestmentMilestones','crmInvestmentDateInput','crmReadInvestmentRequestFields','updateClientInvestmentForm');
 c.getFullPhone=(country,local)=>c.crmNormalizePhone(el(local).value,el(country).value||'968');
 el('cName').value='عميل اصطناعي';el('cPhoneLocal').value='٩٠٠٠٠٠٠٠';el('cRoleBuyer').checked=true;
 return {c,el,calls,toasts,opened,load};
}
test('new owner Investor persists canonical route and owner despite default buyer and selected employee',async()=>{
 const h=harness();h.el('cRoleInvestor').checked=true;h.el('cAssignedTo').value='STAFF';await h.c.saveClient();const row=h.calls.find(x=>x.operation==='insert').data;
 assert.equal(row.client_type,'investor');assert.equal(row.is_investor,true);assert.equal(row.lead_route,'investment');assert.equal(row.assigned_to,'OWNER');assert.equal(row.phone,'+96890000000');
});
test('new Investor normalized phone reuses existing branch record without moving or mutating it',async()=>{
 const h=harness();h.el('cRoleInvestor').checked=true;h.c.respond=()=>({data:[{id:'EXISTING',name:'الاسم السابق',lead_route:'barka'}],error:null});await h.c.saveClient();assert.deepEqual(h.opened,['EXISTING']);assert.equal(h.calls.length,1);assert.equal(h.calls[0].operation,'select');assert(h.calls[0].filters.some(f=>f[0]==='eq'&&f[1]==='company_id'&&f[2]==='COMPANY'));assert.match(h.toasts[0].text,/دون تغيير مساره/);
});
test('staff investor classification and ordinary legacy investor edits keep existing branch behavior',async()=>{
 for(const role of ['agent','manager']){const h=harness(role);h.el('cRoleInvestor').checked=true;await h.c.saveClient();assert(!Object.hasOwn(h.calls.find(x=>x.operation==='insert').data,'lead_route'));}
 for(const route of ['muscat','barka']){const h=harness();h.c.editingClient='LEGACY';h.c.viewingClient={id:'LEGACY',client_type:'investor',is_investor:true,lead_route:route,assigned_to:'STAFF'};h.el('cRoleInvestor').checked=true;await h.c.saveClient();const row=h.calls.find(x=>x.operation==='update').data;assert(!Object.hasOwn(row,'lead_route'));assert.equal(row.assigned_to,'STAFF');}
});
test('privacy notice is based on canonical investment route, not a legacy investor flag',()=>{
 const h=harness();h.el('cRoleInvestor').checked=true;h.c.updateClientInvestmentForm();assert.equal(h.el('cInvestmentNotice').hidden,false);assert.match(h.el('cInvestmentNotice').textContent,/خاص بالمالك/);assert.equal(h.el('cAssignedTo').disabled,true);
 h.c.editingClient='LEGACY';h.c.viewingClient={id:'LEGACY',lead_route:'barka',client_type:'investor'};h.c.updateClientInvestmentForm();assert.doesNotMatch(h.el('cInvestmentNotice').textContent,/خاص بالمالك/);assert.equal(h.el('cAssignedTo').disabled,false);
});
test('investment request saves optional empty qualification and no-response without rejection or geographical reassignment',async()=>{
 const h=harness();h.c.clientRequestFormInvestment=true;h.el('nrType').value='investor';h.el('nrBranch').value='investment';h.el('nrStatus').value='active';h.el('nrSearchStatus').value='no_response';h.el('nrPipelineStage').value='new';h.el('nrPriority').value='2';h.el('nrManualAssignee').value='STAFF';
 await h.c.saveNewClientRequest();const row=h.calls.find(x=>x.operation==='insert').data;assert.equal(row.request_type,'investor');assert.equal(row.branch_key,'investment');assert.equal(row.route_key,'investment');assert.equal(row.assigned_to,'OWNER');assert.equal(row.manual_assigned_to,'OWNER');assert.equal(row.status,'active');assert.equal(row.search_status,'no_response');assert.equal(row.financing_readiness,null);assert.equal(row.decision_maker_status,null);assert(!Object.hasOwn(row,'qualified_at'));
});
test('Oman milestone inputs save only explicit actual dates and preserve unedited timestamp precision',()=>{
 const h=harness();h.el('nrMilestone_first_human_response_at').value='2026-10-15T12:30';h.el('nrMilestone_first_mutual_dialogue_at').value='2026-10-15T13:00';h.el('nrMilestone_qualified_at').value='2026-10-15T14:00';
 const row=h.c.crmReadInvestmentRequestFields({qualified_at:'2026-10-15T10:00:42.123Z'});assert.equal(row.first_human_response_at,'2026-10-15T08:30:00.000Z');assert.equal(row.first_mutual_dialogue_at,'2026-10-15T09:00:00.000Z');assert(!Object.hasOwn(row,'qualified_at'));assert(!Object.hasOwn(row,'created_at'));assert(!Object.hasOwn(row,'closed_won_at'));
});
test('nonowner private request and forged investment route on branch client fail before any database write',async()=>{
 const a=harness('agent');a.c.clientRequestFormInvestment=true;a.el('nrBranch').value='investment';await a.c.saveNewClientRequest();assert.equal(a.calls.length,0);assert(a.toasts.some(x=>x.kind==='error'));
 const b=harness();b.el('nrBranch').value='investment';await b.c.saveNewClientRequest();assert.equal(b.calls.length,0);assert.match(b.toasts[0].text,/لن يتغير مسار/);
});
test('account switch while investor duplicate lookup is pending cannot insert or open previous identity',async()=>{
 const h=harness();h.el('cRoleInvestor').checked=true;let resolve;h.c.respond=()=>new Promise(r=>resolve=r);const save=h.c.saveClient();await new Promise(r=>setImmediate(r));h.c.crmSessionGeneration++;h.c.currentUser={id:'OTHER'};resolve({data:[{id:'PRIVATE'}],error:null});await save;assert.equal(h.calls.length,1);assert.deepEqual(h.opened,[]);assert.equal(h.toasts.length,0);
});
test('late owner request fetch cannot render a private form after account switch',async()=>{
 const h=harness();h.c.crmSavingForms=new Set();h.c.clientRequestFormGeneration=0;h.c.viewingClient={id:'PRIVATE_CLIENT',lead_route:'investment'};h.load('openClientRequestForm');let resolve;h.c.respond=()=>new Promise(r=>resolve=r);
 const opening=h.c.openClientRequestForm('PRIVATE_REQUEST','PRIVATE_CLIENT');await new Promise(r=>setImmediate(r));h.c.crmSessionGeneration++;h.c.currentUser={id:'STAFF'};h.c.viewingClient=null;h.el('mClientRequest').innerHTML='NEW_ACCOUNT_FORM';resolve({data:{id:'PRIVATE_REQUEST',client_id:'PRIVATE_CLIENT',notes:'PRIVATE'},error:null});await opening;assert.equal(h.el('mClientRequest').innerHTML,'NEW_ACCOUNT_FORM');assert.equal(h.toasts.length,0);
});
test('new client initializes phone synchronously and delayed form callbacks cannot erase entered phone',()=>{
 const h=harness(),timers=[];h.c.setTimeout=fn=>timers.push(fn);h.c.populateClientForm=()=>{};h.c.setupPhoneField=(_country,local)=>h.el(local).value='';h.load('openModal');h.c.openModal('mClient');h.el('cPhoneLocal').value='90000000';timers.forEach(fn=>fn());assert.equal(h.el('cPhoneLocal').value,'90000000');
});
test('budget patch leaves guarded request rendering intact and never performs a second private request read',async()=>{
 const h=harness();h.c.viewingClient={id:'MIXED_CLIENT'};const original=h.c.renderClientRequestsTab;h.el('cdTabRequests').innerHTML='TEST CURRENT REQUESTS';h.c.respond=()=>assert.fail('request budgets must use the already authorized row');
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../crm-v18-request-integrity-patch.js'),'utf8'),h.c);assert.equal(h.c.renderClientRequestsTab,original);await h.c.renderClientRequestsTab();
 assert.equal(h.calls.length,0);assert.equal(h.el('cdTabRequests').innerHTML,'TEST CURRENT REQUESTS');assert.equal(h.c.crmBudgetText(null,12000,false),'حتى 12,000 ر.ع');
});
test('late WhatsApp requirements cannot expose owner data in the same conversation after account switch',async()=>{
 const h=harness(),timers=[],inserted=[];h.c.document.readyState='loading';h.c.document.addEventListener=()=>{};h.c.setTimeout=(fn,delay)=>{if(delay===0)timers.push(fn);};h.c.renderWhatsAppChat=()=>{};h.c.waInboxActiveConversation={id:'SAME_CONVERSATION',client_id:'MIXED_CLIENT'};h.el('waClientStrip').insertBefore=node=>inserted.push(node);let resolve;h.c.respond=()=>new Promise(r=>resolve=r);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../crm-v18-routing-patch.js'),'utf8'),h.c);h.c.renderWhatsAppChat();timers.shift()();await new Promise(r=>setImmediate(r));h.c.crmSessionGeneration++;h.c.currentUser={id:'STAFF'};resolve({data:[{missing_required_fields:['PRIVATE_REQUIREMENT']}],error:null});await new Promise(r=>setImmediate(r));assert.deepEqual(inserted,[]);
});
test('late follow-up requirement alert cannot replace a new account notification snapshot',async()=>{
 const h=harness();h.c.document.readyState='loading';h.c.document.addEventListener=()=>{};h.c.runFollowUpEngine=async()=>{};h.c.fueData={alerts:[{rule:'NEW_ACCOUNT'}],totalCount:1};let resolve;h.c.respond=()=>new Promise(r=>resolve=r);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../crm-v18-routing-patch.js'),'utf8'),h.c);const run=h.c.runFollowUpEngine();await new Promise(r=>setImmediate(r));h.c.crmSessionGeneration++;h.c.currentUser={id:'STAFF'};resolve({data:[{client_id:'PRIVATE',missing_required_fields:['location'],client:{name:'PRIVATE'}}],error:null});await run;assert.equal(h.c.fueData.alerts.length,1);assert.equal(h.c.fueData.alerts[0].rule,'NEW_ACCOUNT');
});
