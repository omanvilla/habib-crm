'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ops=fs.readFileSync('crm-operations-v6.js','utf8');
const webhook=fs.readFileSync('supabase/functions/whatsapp-webhook/index.ts','utf8');
function calendar(now,company={created_at:'2026-05-06T15:00:00Z'}){
  class FixedDate extends Date { constructor(...args){super(...(args.length?args:[now]));} }
  const start=ops.indexOf('  const omanDate'),end=ops.indexOf('  async function renderPerformance');
  return new Function('Date','currentCompany',ops.slice(start,end)+';return {period,targetScore};')(FixedDate,company);
}
function attribution(db,fetchMock){
  const begin=webhook.indexOf('function listingText'),end=webhook.indexOf('const BARKA_RE',begin);
  const js=webhook.slice(begin,end).replace('value: unknown','value')
    .replace('candidates: any[], candidate: any, message: string','candidates, candidate, message')
    .replaceAll('args:{messageId:string;clientId:string;conversationId:string;body:string;routeKey:string;messageAt:string}','args')
    .replaceAll('(x:any)','(x)').replaceAll('(p:any)','(p)').replaceAll('(value:string)','(value)');
  return new Function('supabase','CRM_COMPANY_ID','OPENAI_API_KEY','OPENAI_MODEL','fetch',js+';return {listingCandidateCorroborated,attributeSpecificListingText,queueListingReview};')(db,'test-company','mock-key','mock-model',fetchMock);
}
const candidates=[
  {id:'p1',property_code:'HB123',title:'فيلا اختبار في الخوض',area:'الخوض',price:120000},
  {id:'p2',property_code:'HB124',title:'فيلا ثانية في الخوض',area:'الخوض',price:125000}
];
test('Oman daily, Sunday week and month boundaries',()=>{
  const {period}=calendar('2026-09-30T09:00:00Z');
  assert.deepEqual(period('day'),{from:'2026-09-30',to:'2026-10-01'});
  assert.deepEqual(period('week'),{from:'2026-09-27',to:'2026-10-04'});
  assert.deepEqual(period('month'),{from:'2026-09-01',to:'2026-10-01'});
  assert.deepEqual(calendar('2026-09-30T21:00:00Z').period('day'),{from:'2026-10-01',to:'2026-10-02'});
});
test('Monthly targets scale by the actual month including leap February',()=>{
  assert.match(calendar('2026-09-30T09:00:00Z').targetScore({active_inventory:10,inquiries:1,targets:{inquiries_target:30}},'day'),/100%/);
  assert.match(calendar('2024-02-29T09:00:00Z').targetScore({active_inventory:10,inquiries:1,targets:{inquiries_target:29}},'day'),/100%/);
});
test('Listing evidence uses complete unique references and Arabic grouped prices',()=>{
  const f=attribution().listingCandidateCorroborated;
  assert.equal(f(candidates,candidates[0],'اريد تفاصيل HB123'),true);
  assert.equal(f(candidates,candidates[0],'اريد تفاصيل HB1234'),false);
  assert.equal(f(candidates,candidates[0],'الفيلا في الخوض سعرها ١٢٠٬٠٠٠ ريال'),true);
  assert.equal(f(candidates,candidates[0],'الفيلا في الخوض سعرها 1200000'),false);
  assert.equal(f(candidates,candidates[0],'اريد فيلا في الخوض'),false);
  assert.equal(f([candidates[0],{...candidates[1],title:candidates[0].title}],candidates[0],'اريد فيلا اختبار في الخوض'),false);
});
test('Unique no-link mention is recorded; ambiguity queues review and alerts without a send',async()=>{
  let writes=[],links=[],answer={references_specific_listing:true,property_id:'p1',confidence:.99,evidence:'الخوض'};
  function query(table){
    const q={select(){return q},eq(){return q},is(){return q},limit(){return Promise.resolve({data:candidates,error:null})},
      update(v){writes.push({table,v});return q},upsert(v){writes.push({table,v});return q},
      then(a,b){return Promise.resolve({error:null}).then(a,b)}};return q;
  }
  const db={from:query,rpc:async(name,args)=>{assert.equal(name,'record_property_link_inquiry_internal');links.push(args);return {error:null}}};
  const api=attribution(db,async()=>({ok:true,json:async()=>({output_text:JSON.stringify(answer)})}));
  const args={messageId:'msg1',clientId:'client',conversationId:'conv',body:'الفيلا في الخوض سعرها ١٢٠٬٠٠٠ ريال',routeKey:'muscat',messageAt:'2026-09-30'};
  await api.attributeSpecificListingText(args);
  assert.equal(links.length,1);
  assert.equal(writes.some(x=>x.v.property_match_status==='ai_verified'),true);
  writes=[];links=[];answer={...answer,property_id:null,confidence:.4};
  await api.attributeSpecificListingText({...args,messageId:'msg2',body:'الفيلا في الخوض اريدها'});
  assert.equal(links.length,0);
  assert.equal(writes.some(x=>x.table==='unmatched_property_links'),true);
  assert.equal(writes.some(x=>x.v.human_handoff_required===true),true);
});
test('Review write failure is surfaced for webhook retry',async()=>{
  const q={upsert(){return Promise.resolve({error:{message:'database unavailable'}})}};
  await assert.rejects(attribution({from:()=>q}).queueListingReview({messageId:'msg',body:'عقار',clientId:'client',conversationId:'conv'}),/property_ai_review/);
});

test('Standing inventory goal is explicitly 10; other missing goals are excluded',()=>{
 const {targetScore}=calendar('2026-09-30T09:00:00Z');
 assert.match(targetScore({active_inventory:7,targets:{}},'month'),/70%.*1 من 5/);
 assert.match(targetScore({active_inventory:1,inquiries:30,targets:{inquiries_target:30}},'month'),/55%.*2 من 5/);
});
test('Cross-month weekly score waits for approved target allocation',()=>{
 const {targetScore}=calendar('2026-09-30T09:00:00Z');
 assert.match(targetScore({active_inventory:10,targets:{inventory_target:10}},'week'),/يعبر شهرين/);
 assert(!targetScore({active_inventory:10,targets:{inventory_target:10}},'week').includes('%'));
});

test('Lifetime starts at company inception and does not compare to monthly goals',()=>{
 const {period,targetScore}=calendar('2026-10-01T10:00:00Z');
 assert.deepEqual(period('all'),{from:'2026-05-06',to:'2026-10-02'});
 assert.match(targetScore({active_inventory:12,targets:{inventory_target:10}},'all'),/إجمالي تاريخي/);
 assert(!targetScore({},'all').includes('%'));
});
test('Own company commission goal participates only when its value is visible',()=>{
 const score=calendar('2026-10-01T10:00:00Z').targetScore;
 assert.match(score({active_inventory:10,company_commission:50,targets:{commission_target:100}},'month'),/75%.*2 من 5/);
 assert.match(score({active_inventory:10,company_commission:null,targets:{commission_target:100}},'month'),/100%.*1 من 5/);
});

test('Target-month end is exclusive and does not lose the last day in Oman',()=>{
 const html=fs.readFileSync('app-base-v15.html','utf8');
 const fn=html.match(/function employeeTargetMonthEnd\(month\)\{([^\n]+)\}/)[1];
 const end=new Function('month',fn);
 assert.equal(end('2026-10-01'),'2026-11-01');
 assert.equal(end('2024-02-01'),'2024-03-01');
 assert.equal(end('2026-12-01'),'2027-01-01');
});

test('Acquisition requirement follows current shortage, not monthly additions',()=>{
 const html=fs.readFileSync('app-base-v15.html','utf8');
 const body=html.match(/function employeeInventoryDeficit\(active\)\{([^\n]+)\}/)[1],needed=new Function('active',body);
 assert.equal(needed(7),3);assert.equal(needed(8),2);assert.equal(needed(10),0);assert.equal(needed(12),0);assert.equal(needed(9),1);
 const score=calendar('2026-10-01T10:00:00Z').targetScore;
 assert.match(score({active_inventory:7,new_properties:0,targets:{new_properties_target:999}},'month'),/70%.*1 من 5/);
});
test('Arabic date labels retain Western numerals',()=>{
 const rendered=new Date('2026-10-01T10:25:00Z').toLocaleString('ar-OM-u-nu-latn',{timeZone:'Asia/Muscat'});
 assert(!/[\u0660-\u0669\u06f0-\u06f9]/.test(rendered));assert(/[0-9]/.test(rendered));
});
