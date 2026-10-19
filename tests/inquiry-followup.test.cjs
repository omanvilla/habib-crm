'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const source=fs.readFileSync('app-base-v15.html','utf8');
function fn(name){
 const match=new RegExp('(?:async )?function '+name+'\\(').exec(source);assert(match,name);
 for(let end=source.indexOf('}',match.index);end>=0;end=source.indexOf('}',end+1)){
  const text=source.slice(match.index,end+1);try{new vm.Script(text);return text;}catch{}
 }
 throw new Error('cannot extract '+name);
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(responder){
 const elements=new Map(),state={calls:[],toasts:[],errors:[],closed:0,loads:[],canEdit:true};
 const el=id=>{if(!elements.has(id))elements.set(id,{value:'',innerHTML:'',textContent:'',style:{},querySelectorAll:()=>[],classList:{add(){},remove(){}}});return elements.get(id);};
 const q={id:'TEST-inquiry',client_id:'TEST-client',property_id:'TEST-property',request_id:'TEST-request',status:'followup',updated_at:'2026-10-19T08:00:00.000Z',first_inquiry_at:'2026-08-25T08:00:00Z',last_inquiry_at:'2026-09-01T08:00:00Z',last_contact_at:'2026-09-15T08:00:00Z',followup_note:'TEST previous outcome <img onerror=alert(1)>',next_followup:'2026-10-20',client:{name:'TEST client'},property:{title:'TEST property'}};
 const c={crypto:webcrypto,console:{error:(...args)=>state.errors.push(args)},$:el,currentUser:{id:'TEST-agent'},currentProfile:{role:'agent'},crmSessionGeneration:1,
  crmSavingForms:new Set(),crmSaveAttempts:new Map(),allPropertyInquiries:[q],editingFollowupInquiryId:q.id,inquiryFollowupOpenSeq:0,
  ifStructuredSelected:new Set(),ifStructuredPrimary:null,viewingClient:{id:q.client_id},viewingProperty:{id:q.property_id},
  canEdit:()=>state.canEdit,showToast:(message,type)=>state.toasts.push({message,type}),closeModal:()=>state.closed++,
  propertyInquiryStatusAr:x=>x,fmtDate:x=>x||'—',escapeHtml:x=>String(x??'').replaceAll('<','&lt;').replaceAll('>','&gt;'),
  loadStructuredReasons:async()=>{},ensureDealFromInquiry:()=>{throw new Error('Non-atomic deal fallback forbidden');},logActivity:()=>{throw new Error('Generic system-note logging forbidden');}
 };
 c.window=c;for(const name of ['loadDeals','loadDashboard','loadClientActivities','loadClientInterests','loadClient360','renderClientRequestsTab','loadPropertyPerformance','loadPropertyDecisionPanel'])c[name]=()=>state.loads.push(name);
 c.supa={from:()=>{throw new Error('Follow-up must be a single atomic RPC');},rpc:async(name,args)=>{
  state.calls.push({name,args:structuredClone(args)});
  if(responder)return responder(name,args,state);
  return {data:{ok:true,inquiry_id:q.id,activity_id:args.p_idempotency_key,contact_recorded:!!args.p_payload.outcome,inquiry:{...q,status:args.p_payload.status,updated_at:'2026-10-19T09:00:00Z',followup_note:args.p_payload.outcome||q.followup_note}},error:null};
 }};
 el('ifStatus').value='followup';el('ifNote').value='TEST new actual outcome';el('ifNextFollowup').value='2026-10-20';el('ifNextAction').value='TEST next action';el('ifRejectPhase').value='unknown';
 vm.createContext(c);for(const name of ['crmNewId','crmBeginSave','crmEndSave','crmSaveKey','crmFinishSave','crmSessionCurrent','updateInquiryFollowupFields','openInquiryFollowup','saveInquiryFollowup'])vm.runInContext(fn(name),c);
 return {c,state,el,q};
}
test('opening a follow-up shows escaped prior evidence, separate dates, and an empty new outcome',async()=>{
 const h=setup();await h.c.openInquiryFollowup(h.q.id);
 assert.equal(h.el('ifNote').value,'');assert.equal(h.el('ifNextAction').value,'');
 const html=h.el('ifSummary').innerHTML;assert.match(html,/آخر استفسار/);assert.match(html,/آخر متابعة/);
 assert.match(html,/2026-09-01/);assert.match(html,/2026-09-15/);assert.match(html,/TEST previous outcome &lt;img/);assert.doesNotMatch(html,/<img/);
});
test('manual follow-up is one acknowledged RPC with stable original inquiry dates and linked refresh',async()=>{
 const h=setup();await h.c.saveInquiryFollowup();assert.equal(h.state.calls.length,1);
 const call=h.state.calls[0];assert.equal(call.name,'crm_save_inquiry_followup');assert.equal(call.args.p_payload.outcome,'TEST new actual outcome');
 assert.equal(call.args.p_payload.expected_updated_at,'2026-10-19T08:00:00.000Z');
 assert(!Object.hasOwn(call.args.p_payload,'last_inquiry_at'));assert(!Object.hasOwn(call.args.p_payload,'first_inquiry_at'));
 assert.equal(h.q.last_inquiry_at,'2026-09-01T08:00:00Z');assert.equal(h.state.closed,1);
 assert.equal(h.state.toasts.at(-1).type,'success');
 assert.deepEqual(h.state.loads,['loadDeals','loadDashboard','loadClientActivities','loadClientInterests','loadClient360','renderClientRequestsTab','loadPropertyPerformance','loadPropertyDecisionPanel']);
});
test('blank new outcome never copies old evidence into a fresh contact payload',async()=>{
 const h=setup();h.el('ifNote').value='  ';await h.c.saveInquiryFollowup();
 assert.equal(h.state.calls[0].args.p_payload.outcome,null);assert.equal(h.q.followup_note,'TEST previous outcome <img onerror=alert(1)>');
 assert.match(h.state.toasts.at(-1).message,/لم تُسجّل محاولة تواصل جديدة/);
});
test('double click serializes and a lost response retries the identical operation key and payload',async()=>{
 let finish;const h=setup(()=>new Promise(resolve=>finish=resolve));
 const saving=h.c.saveInquiryFollowup();await tick();await h.c.saveInquiryFollowup();assert.equal(h.state.calls.length,1);
 finish({data:null,error:{message:'TEST connection lost'}});await saving;
 assert.equal(h.state.closed,0);assert.equal(h.el('ifNote').value,'TEST new actual outcome');assert.equal(h.c.crmSavingForms.size,0);
 const retry=h.c.saveInquiryFollowup();await tick();assert.equal(h.state.calls.length,2);
 assert.deepEqual(h.state.calls[0].args,h.state.calls[1].args);
 finish({data:{ok:true,inquiry_id:h.q.id,activity_id:h.state.calls[1].args.p_idempotency_key,contact_recorded:true,inquiry:{...h.q},replayed:true},error:null});await retry;
 assert.equal(h.state.closed,1);assert.equal(h.state.loads.filter(x=>x==='loadDashboard').length,1);
});
test('failed stage evidence or stale record keeps typed input and never shows false success',async()=>{
 for(const message of ['inquiry_requires_paid_reservation_workflow','inquiry_requires_actual_viewing','inquiry_requires_deal_workflow','inquiry_changed_reload_before_saving']){
  const h=setup(()=>({data:null,error:{message}}));await h.c.saveInquiryFollowup();
  assert.equal(h.state.closed,0,message);assert.equal(h.state.loads.length,0,message);assert.equal(h.el('ifNote').value,'TEST new actual outcome',message);
  assert.equal(h.state.toasts.at(-1).type,'error');assert.doesNotMatch(h.state.toasts.at(-1).message,/inquiry_/);assert.equal(h.state.errors[0][1].message,message);
 }
});
test('missing acknowledgment cannot clear the form or pretend a follow-up was saved',async()=>{
 for(const data of [null,{}, {ok:true,inquiry_id:'TEST-wrong',activity_id:'TEST-id',inquiry:{id:'TEST-wrong'}}]){
  const h=setup(()=>({data,error:null}));await h.c.saveInquiryFollowup();assert.equal(h.state.closed,0);assert.equal(h.state.loads.length,0);assert.equal(h.state.toasts.at(-1).type,'error');
 }
});
test('a late old-session acknowledgment cannot refresh or close the new account form',async()=>{
 let finish;const h=setup(()=>new Promise(resolve=>finish=resolve));const saving=h.c.saveInquiryFollowup();await tick();
 h.c.crmSessionGeneration++;h.c.currentUser={id:'TEST-other'};h.el('ifNote').value='TEST new session draft';
 finish({data:{ok:true,inquiry_id:h.q.id,activity_id:'TEST-id',contact_recorded:true,inquiry:{...h.q}},error:null});await saving;
 assert.equal(h.state.closed,0);assert.equal(h.state.loads.length,0);assert.equal(h.state.toasts.length,0);assert.equal(h.el('ifNote').value,'TEST new session draft');
});
test('another open client/property is never repainted by a completed follow-up',async()=>{
 const h=setup();h.c.viewingClient={id:'TEST-other-client'};h.c.viewingProperty={id:'TEST-other-property'};await h.c.saveInquiryFollowup();
 assert.deepEqual(h.state.loads,['loadDeals','loadDashboard']);
});
test('missing follow-up date, rejection reason, or editing permission prevents any write',async()=>{
 const cases=[h=>h.el('ifNextFollowup').value='',h=>h.el('ifStatus').value='not_suitable',h=>h.state.canEdit=false];
 for(const change of cases){const h=setup();change(h);await h.c.saveInquiryFollowup();assert.equal(h.state.calls.length,0);assert.equal(h.state.closed,0);}
});
