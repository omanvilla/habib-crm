'use strict';
// Execute production read functions with deferred, isolated responses. These
// scenarios verify privacy/order and failure behavior, not database RLS itself.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app-base-v15.html','utf8');
const functionSource=name=>{
 const match=new RegExp('(?:async )?function '+name+'\\(').exec(source);assert(match,'missing '+name);
 for(let end=source.indexOf('}',match.index);end>=0;end=source.indexOf('}',end+1)){
  const candidate=source.slice(match.index,end+1);try{new vm.Script(candidate);return candidate;}catch{}
 }
 throw new Error('Cannot parse '+name);
};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const rows=data=>({data,count:data.length,error:null});
function harness(){
 const nodes=new Map(),calls=[],errors=[],toasts=[];
 function el(id){if(!nodes.has(id)){let html='';nodes.set(id,{id,get innerHTML(){return html;},set innerHTML(v){html=v;},get textContent(){return html;},set textContent(v){html=v;},querySelectorAll:()=>[],querySelector:()=>null,style:{},value:'',classList:{toggle(){}}});}return nodes.get(id);}
 const c={console:{error:(...args)=>errors.push(args),warn:(...args)=>errors.push(args)},document:{getElementById:el,querySelectorAll:()=>[],addEventListener(){}},$:el,
  currentUser:{id:'TEST_ACTOR'},crmSessionGeneration:1,currentProfile:{role:'owner'},viewingClient:{id:'TEST_A',phone:'TEST_PHONE_A'},allClients:[],clientWorkRequests:[],allTasks:[],showArchivedClients:false,
  escapeHtml:value=>String(value??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x])),
  activityIcon:()=>'',activityLabel:x=>x,timeAgo:x=>x||'',fmtDate:x=>x||'',fmtMoney:x=>String(x),requestTypeAr:x=>x||'',requestStatusAr:x=>x||'',requestSearchAr:x=>x||'',propTypeAr:x=>x||'',propertyInquiryStatusAr:x=>x||'',propertyRejectReasonAr:x=>x||'',inquiryDueBadge:x=>x||'',
  canEdit:()=>true,isOwner:()=>true,client360UniqueByProperty:x=>x,client360PropertyListHtml:()=>'',renderTaskCard:t=>'<p>'+t.title+'</p>',
  findPropertiesForBuyer:async()=>[],findBuyersForSeller:async()=>[],updateRoleCounts(){},renderClients(){el('clientsList').innerHTML=c.allClients.map(x=>x.id).join(',');},navigate(){},renderClientDetail(){},showToast:(...args)=>toasts.push(args)};
 function query(table){
  const state={table,filters:[]},q={};
  for(const method of ['select','eq','in','order','range','single'])q[method]=(...args)=>{if(method==='range')state.range=args;else if(method==='select')state.columns=args[0];else state.filters.push([method,...args]);return q;};
  q.then=(resolve,reject)=>new Promise(finish=>calls.push({...state,finish})).then(resolve,reject);return q;
 }
 c.supa={from:query,rpc:(name,args)=>new Promise(finish=>calls.push({rpc:name,args,finish}))};c.crmDataFrom=table=>query('crm_'+table+'_access');c.window=c;
 vm.createContext(c);
 function load(...names){names.forEach(name=>vm.runInContext(functionSource(name),c));}
 load('crmSessionCurrent','crmReadAll','crmBeginClientDetailRead','crmClientDetailReadError','client360Metric');
 return {c,el,calls,errors,toasts,load};
}
const client360=(id,body=id)=>({data:{client:{id},metrics:{requests_total:0,properties_inquired:0},requests:[],property_journey:[],appointments:[],open_tasks:[],recent_whatsapp:[{body,direction:'inbound'}]},error:null});
const cases=[
 ['loadClient360','cdTabJourney',id=>client360(id)],
 ['loadClientActivities','cdActivities',id=>rows([{id,activity_type:'call',activity_text:id}])],
 ['renderClientRequestsTab','cdTabRequests',id=>rows([{id,request_type:'buyer',preferred_area:id}])],
 ['loadClientInterests','cdTabInterests',id=>rows([{id,property_id:id,property:{title:id}}])],
 ['loadClientListings','cdTabListings',id=>rows([{id,title:id}])],
 ['renderClientTasksTab','cdTabTasks',id=>rows([{id,title:id}])]
];
for(const [method,pane,response] of cases){
 test(method+': late A success or error cannot replace selected client B',async()=>{
  for(const oldError of [false,true]){
   const h=harness();h.load(method);const a=h.c[method]();await tick();
   h.c.viewingClient={id:'TEST_B',phone:'TEST_PHONE_B'};const b=h.c[method]();await tick();
   h.calls[1].finish(response('TEST_B'));await b;
   const html=h.el(pane).innerHTML;assert.match(html,/TEST_B/);
   h.calls[0].finish(oldError?{data:null,error:{message:'TEST_OLD_SECRET_ERROR'}}:response('TEST_A'));await a;
   assert.equal(h.el(pane).innerHTML,html);assert.equal(h.errors.length,0);
   if(method==='loadClient360')assert.equal(h.c.client360Data.client.id,'TEST_B');
   if(method==='renderClientTasksTab')assert.deepEqual(Array.from(h.c.allTasks,x=>x.id),['TEST_B']);
  }
 });
 test(method+': same client ID in a renewed session cannot receive an earlier session response',async()=>{
  for(const oldError of [false,true]){
   const h=harness();h.load(method);const pending=h.c[method]();await tick();
   h.c.crmSessionGeneration++;h.c.viewingClient={id:'TEST_A'};h.el(pane).innerHTML='TEST_NEW_SESSION';h.c.client360Data={client:{id:'TEST_NEW_SESSION'}};
   h.calls[0].finish(oldError?{data:null,error:{message:'TEST_OLD_SESSION_ERROR'}}:response('TEST_A'));await pending;
   assert.equal(h.el(pane).innerHTML,'TEST_NEW_SESSION');assert.equal(h.errors.length,0);
   assert.equal(h.c.client360Data.client.id,'TEST_NEW_SESSION');
  }
 });
 test(method+': source failure is visible, logged intact, and retry replaces it with a genuine empty result',async()=>{
  const h=harness();h.load(method);h.el(pane).innerHTML='TEST_STALE_RECORD';const error={message:'TEST_DATABASE_PERMISSION_FAILURE',code:'42501'};
  const failed=h.c[method]();await tick();assert.doesNotMatch(h.el(pane).innerHTML,/TEST_STALE_RECORD/);h.calls[0].finish({data:null,error});await failed;
  assert.match(h.el(pane).innerHTML,/role="alert"/);assert.match(h.el(pane).innerHTML,/إعادة المحاولة/);assert.doesNotMatch(h.el(pane).innerHTML,/لا توجد|لا يوجد|TEST_DATABASE_PERMISSION_FAILURE/);
  assert.equal(h.errors[0][1],error);
  const retry=h.c[method]();await tick();h.calls[1].finish(method==='loadClient360'?{data:{client:{id:'TEST_A'},metrics:{requests_total:0},property_journey:[]},error:null}:rows([]));await retry;
  assert.doesNotMatch(h.el(pane).innerHTML,/role="alert"/);assert.match(h.el(pane).innerHTML,/لا توجد|لا يوجد|c360-metric-num">0</);
 });
}
test('Client360 rejects a missing/mismatched response rather than displaying a fabricated all-zero profile',async()=>{
 for(const data of [{},{client:{id:'TEST_OTHER'},metrics:{}},{client:{id:'TEST_A'}}]){
  const h=harness();h.load('loadClient360');h.c.client360Data={client:{id:'TEST_OLD'}};const pending=h.c.loadClient360();
  assert.equal(h.c.client360Data,null);h.calls[0].finish({data,error:null});await pending;
  assert.match(h.el('cdTabJourney').innerHTML,/role="alert"/);assert.doesNotMatch(h.el('cdTabJourney').innerHTML,/c360-metric-num/);assert.equal(h.c.client360Data,null);
 }
 const h=harness();assert.match(h.c.client360Metric('Known',0,''),/c360-metric-num">0</);assert.match(h.c.client360Metric('Unknown',undefined,''),/c360-metric-num">—</);
});
test('latest same-client 360 reload wins even when the preceding request fails afterward',async()=>{
 const h=harness();h.load('loadClient360');const old=h.c.loadClient360(),latest=h.c.loadClient360();
 h.calls[1].finish(client360('TEST_A','TEST_LATEST'));await latest;const html=h.el('cdTabJourney').innerHTML;
 h.calls[0].finish({error:{message:'TEST_STALE_FAILURE'}});await old;assert.equal(h.el('cdTabJourney').innerHTML,html);assert.equal(h.c.client360Data.recent_whatsapp[0].body,'TEST_LATEST');
});
test('client selection A then B preserves B when A finishes or fails late, and ignores logout responses',async()=>{
 for(const oldError of [false,true]){
  const h=harness();h.load('viewClient');const opened=[];h.c.renderClientDetail=()=>opened.push(h.c.viewingClient.id);
  const a=h.c.viewClient('TEST_A'),b=h.c.viewClient('TEST_B');await tick();h.calls[1].finish({data:{id:'TEST_B'},error:null});await b;
  h.calls[0].finish(oldError?{error:{message:'TEST_OLD_ERROR'}}:{data:{id:'TEST_A'},error:null});await a;
  assert.equal(h.c.viewingClient.id,'TEST_B');assert.deepEqual(opened,['TEST_B']);assert.equal(h.toasts.length,0);
  const next=h.c.viewClient('TEST_A');await tick();h.c.currentUser=null;h.c.crmSessionGeneration++;h.c.viewingClient=null;h.calls[2].finish({data:{id:'TEST_A'},error:null});await next;assert.equal(h.c.viewingClient,null);
 }
});
test('client list keeps the latest same-session refresh and archive choice instead of late rows or errors',async()=>{
 for(const staleError of [false,true]){
  const h=harness();h.load('loadClients');const old=h.c.loadClients();await tick();
  h.c.showArchivedClients=true;const fresh=h.c.loadClients();await tick();
  h.calls[2].finish(rows([{id:'TEST_ARCHIVED',archived:true},{id:'TEST_ACTIVE',archived:false}]));h.calls[3].finish(rows([{id:'TEST_FRESH_REQUEST'}]));await fresh;
  h.calls[0].finish(staleError?{error:{message:'TEST_OLD_LIST_FAILURE'}}:rows([{id:'TEST_STALE',archived:false}]));h.calls[1].finish(rows([]));assert.equal(await old,false);
  assert.deepEqual(Array.from(h.c.allClients,x=>x.id),['TEST_ARCHIVED']);assert.deepEqual(Array.from(h.c.clientWorkRequests,x=>x.id),['TEST_FRESH_REQUEST']);assert.equal(h.el('clientsList').innerHTML,'TEST_ARCHIVED');
 }
});
test('activity history reads beyond an API page and rejects a partial later-page failure',async()=>{
 for(const fail of [false,true]){
  const h=harness();h.load('loadClientActivities');const first=Array.from({length:500},(_,i)=>({id:'TEST_'+i,activity_type:'call',activity_text:'TEST_NOTE_'+i}));
  const pending=h.c.loadClientActivities();await tick();h.calls[0].finish({data:first,count:501,error:null});await tick();
  assert.deepEqual(h.calls[1].range,[500,999]);h.calls[1].finish(fail?{error:{message:'TEST_LATER_PAGE_FAILURE'}}:{data:[{id:'TEST_LAST',activity_text:'TEST_LAST_NOTE'}],count:501,error:null});await pending;
  if(fail){assert.match(h.el('cdActivities').innerHTML,/role="alert"/);assert.doesNotMatch(h.el('cdActivities').innerHTML,/TEST_NOTE_0/);}else assert.match(h.el('cdActivities').innerHTML,/TEST_LAST_NOTE/);
 }
});
test('smart-match detail discards downstream lookup results after client or session changes',async()=>{
 for(const changed of ['client','session','logout']){
  const h=harness();h.load('findSmartMatches');let finish;h.c.findPropertiesForBuyer=()=>new Promise(resolve=>{finish=resolve;});
  const pending=h.c.findSmartMatches();await tick();h.calls[0].finish(rows([{id:'TEST_REQUEST',request_type:'buyer'}]));await tick();
  if(changed==='client')h.c.viewingClient={id:'TEST_B'};else h.c.crmSessionGeneration++;if(changed==='logout'){h.c.currentUser=null;h.c.viewingClient=null;}
  h.el('cdSmartMatches').innerHTML='TEST_CURRENT';finish([{id:'TEST_OLD',title:'TEST_OLD_PRIVATE_PROPERTY'}]);await pending;
  assert.equal(h.el('cdSmartMatches').innerHTML,'TEST_CURRENT');assert.equal(h.errors.length,0);
 }
});

test('same-date request cards keep the exact row budget without a second query or positional patch',async()=>{
 const h=harness();h.load('renderClientRequestsTab');
 vm.runInContext(fs.readFileSync('crm-v18-request-integrity-patch.js','utf8'),h.c);
 const pending=h.c.renderClientRequestsTab();await tick();
 const records=[{id:'TEST_REQUEST_B',request_type:'buyer',created_at:'2026-10-19T08:00:00Z',budget_min:9000,budget_max:null},{id:'TEST_REQUEST_A',request_type:'buyer',created_at:'2026-10-19T08:00:00Z',budget_min:null,budget_max:12500}];
 h.calls[0].finish(rows(records));await pending;assert.equal(h.calls.length,1,'no positional budget enrichment read');
 assert(h.calls[0].filters.some(f=>f[0]==='order'&&f[1]==='id'));
 const cards=h.el('cdTabRequests').innerHTML.split('data-client-request-id="').slice(1),byId=new Map(cards.map(card=>[card.slice(0,card.indexOf('"')),card]));
 assert.match(byId.get('TEST_REQUEST_A'),/حتى 12,500 ر.ع/);assert.doesNotMatch(byId.get('TEST_REQUEST_A'),/9,000/);
 assert.match(byId.get('TEST_REQUEST_B'),/من 9,000 ر.ع/);assert.doesNotMatch(byId.get('TEST_REQUEST_B'),/12,500/);
});

test('interest history and Client360 display actual last contact without substituting the original inbound inquiry date',async()=>{
 for(const contact of ['2026-10-19T08:30:00Z',null]){
  const h=harness();h.load('loadClientInterests');const pending=h.c.loadClientInterests();await tick();
  h.calls[0].finish(rows([{id:'TEST_RELATION',property_id:'TEST_PROPERTY',property:{title:'TEST Property'},status:'followup',last_inquiry_at:'2026-08-25T08:00:00Z',last_contact_at:contact}]));await pending;
  const html=h.el('cdTabInterests').innerHTML;assert.match(html,/آخر تواصل/);assert.doesNotMatch(html,/2026-08-25/);
  assert(html.includes('<td>followup</td><td>'+(contact||'—')+'</td>'));
  h.load('loadClient360');const profile=client360('TEST_A');profile.data.property_journey=[{property_id:'TEST_PROPERTY',property_title:'TEST Property',status:'followup',last_inquiry_at:'2026-08-25T08:00:00Z',last_contact_at:contact}];
  const loading=h.c.loadClient360();h.calls[1].finish(profile);await loading;
  const journey=h.el('cdTabJourney').innerHTML;assert.match(journey,/آخر تواصل/);assert.doesNotMatch(journey,/2026-08-25/);
  assert(journey.includes('<td>followup</td><td>'+(contact||'—')+'</td>'));
 }
});
