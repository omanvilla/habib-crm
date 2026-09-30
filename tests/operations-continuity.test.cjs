'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ops=fs.readFileSync('crm-operations-v6.js','utf8');
const webhook=fs.readFileSync('supabase/functions/whatsapp-webhook/index.ts','utf8');
function calendar(now){
  class FixedDate extends Date { constructor(...args){super(...(args.length?args:[now]));} }
  const start=ops.indexOf('  const omanDate'),end=ops.indexOf('  async function renderPerformance');
  return new Function('Date',ops.slice(start,end)+';return {period,targetScore};')(FixedDate);
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
