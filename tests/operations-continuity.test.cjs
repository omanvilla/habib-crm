'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ops=fs.readFileSync('crm-operations-v6.js','utf8');
const matcherModule=import('../supabase/functions/_shared/property-inquiry-matcher.mjs');
const serviceModule=import('../supabase/functions/_shared/property-inquiry-service.mjs');
function calendar(now,company={created_at:'2026-05-06T15:00:00Z'}){
  class FixedDate extends Date { constructor(...args){super(...(args.length?args:[now]));} }
  const start=ops.indexOf('  const omanDate'),end=ops.indexOf('  function targetMetric');
  return new Function('Date','currentCompany','n',ops.slice(start,end)+';return {period,targetScore};')(FixedDate,company,v=>Number(v||0).toLocaleString('en-US'));
}
function inquiryFixture(body,{inventory=candidates,reviewError=null}={}){
  const message={id:'msg1',company_id:'test-company',client_id:'client',conversation_id:'conv',
    direction:'inbound',message_type:'text',body,message_timestamp:'2026-09-30T08:00:00Z',matched_property_id:null};
  const conversation={id:'conv',company_id:'test-company',client_id:'client',route_key:'muscat',
    human_handoff_required:false,handoff_reason:null};
  const writes=[],calls=[];
  function query(table){
    const filters={};let operation='select',value;
    const q={select(){return q},eq(key,v){filters[key]=v;return q},is(){return q},
      update(v){operation='update';value=v;return q},upsert(v){operation='upsert';value=v;return q},
      maybeSingle(){return q},then(resolve,reject){return Promise.resolve().then(()=>{
        if(operation==='select'){
          assert.equal(filters.company_id,'test-company');
          return {data:table==='whatsapp_messages'?message:conversation,error:null};
        }
        writes.push({table,operation,value});
        return {data:null,error:table==='unmatched_property_links'?reviewError:null};
      }).then(resolve,reject)}};return q;
  }
  const db={from:query,rpc:async(name,args)=>{
    calls.push({name,args});
    if(name==='crm_property_inquiry_candidates')return {data:{candidates:inventory,has_more:false},error:null};
    assert.equal(name,'crm_apply_verified_property_inquiries');
    return {data:{matched_count:args.p_matches.length,property_ids:args.p_matches.map(x=>x.property_id),review_required:args.p_needs_review},error:null};
  }};
  return {writes,calls,service:async()=> (await serviceModule).createPropertyInquiryService({db,companyId:'test-company',
    fetchImpl:async()=>{throw new Error('A direct reference must not call or send to an external service');}})};
}
const candidates=[
  {id:'p1',property_code:'HB123',title:'فيلا اختبار في الخوض',area:'الخوض',price:120000},
  {id:'p2',property_code:'HB124',title:'فيلا ثانية في الخوض',area:'الخوض',price:125000}
];
test('rolling months clamp to the last valid day in Oman, including leap years',()=>{
 assert.deepEqual(calendar('2026-05-31T09:00:00Z').period('months3'),{from:'2026-02-28',to:'2026-06-01'});
 assert.deepEqual(calendar('2024-05-31T09:00:00Z').period('months3'),{from:'2024-02-29',to:'2024-06-01'});
 assert.deepEqual(calendar('2024-02-29T21:00:00Z').period('year'),{from:'2023-03-01',to:'2024-03-02'});
 assert.deepEqual(calendar('2024-02-29T09:00:00Z').period('year'),{from:'2023-02-28',to:'2024-03-01'});
});
test('Oman monthly report boundaries and local midnight',()=>{
 const {period}=calendar('2026-09-30T09:00:00Z');
 assert.deepEqual(period('month'),{from:'2026-09-01',to:'2026-10-01'});
 assert.deepEqual(calendar('2026-09-30T21:00:00Z').period('month'),{from:'2026-10-01',to:'2026-11-01'});
});

test('Only monthly reservation results are compared against the monthly goal',()=>{
 const {targetScore}=calendar('2026-09-30T09:00:00Z');
 assert.match(targetScore({reservations:2},'month'),/متحقق/);
 assert.match(targetScore({reservations:2},'year'),/لا تُقارن بهدف شهر واحد/);
});

test('Listing evidence uses complete unique references and Arabic grouped prices',async()=>{
  const {matchListingReferences}=await matcherModule;
  const matches=(body,inventory=candidates)=>matchListingReferences(body,inventory).matches.map(x=>x.property_id);
  assert.deepEqual(matches('اريد تفاصيل HB123'),['p1']);
  assert.deepEqual(matches('اريد تفاصيل HB1234'),[]);
  assert.deepEqual(matches('الفيلا في الخوض سعرها ١٢٠٬٠٠٠ ريال'),['p1']);
  assert.deepEqual(matches('الفيلا في الخوض سعرها 1200000'),[]);
  assert.deepEqual(matches('اريد فيلا في الخوض'),[]);
  assert.deepEqual(matches('اريد فيلا اختبار في الخوض',[candidates[0],{...candidates[1],title:candidates[0].title}]),[]);
});
test('Unique no-link mention is recorded atomically; ambiguity queues review and alerts without a send',async()=>{
  const direct=inquiryFixture('الفيلا في الخوض سعرها ١٢٠٬٠٠٠ ريال');
  const result=await (await direct.service()).attributeInbound('msg1');
  assert.deepEqual(result.property_ids,['p1']);
  const applied=direct.calls.filter(x=>x.name==='crm_apply_verified_property_inquiries');
  assert.equal(applied.length,1);
  assert.equal(applied[0].args.p_message_id,'msg1');
  assert.equal(applied[0].args.p_matches[0].method,'ai_verified');
  assert.deepEqual(applied[0].args.p_matches[0].evidence.source_message_ids,['msg1']);
  assert.equal(direct.writes.length,0,'Atomic RPC owns attribution and valid message status together');
  const ambiguous=inquiryFixture('الفيلا في الخوض اريدها');
  const review=await (await ambiguous.service()).attributeInbound('msg1');
  assert.equal(review.review_required,true);
  assert.equal(ambiguous.calls.some(x=>x.name==='crm_apply_verified_property_inquiries'),false);
  assert.equal(ambiguous.writes.some(x=>x.table==='unmatched_property_links'&&x.value.status==='pending'),true);
  assert.equal(ambiguous.writes.some(x=>x.table==='whatsapp_messages'&&x.value.property_match_status==='pending_manual'),true);
  assert.equal(ambiguous.writes.some(x=>x.table==='whatsapp_conversations'&&x.value.human_handoff_required===true),true);
});
test('Review write failure is surfaced for webhook retry without reporting a successful alert',async()=>{
  const fixture=inquiryFixture('ممكن تفاصيل العقار',{reviewError:{message:'database unavailable'}});
  await assert.rejects((await fixture.service()).queueReview('msg1'),/property_inquiry_review_queue:database unavailable/);
  assert.equal(fixture.writes.length,1);
  assert.equal(fixture.writes[0].table,'unmatched_property_links');
});

test('Closing a sale or receiving commission cannot independently meet the booking target',()=>{
 const {targetScore}=calendar('2026-09-30T09:00:00Z');
 assert.match(targetScore({reservations:0,sales:20,company_commission:9000,commission_collected:9000},'month'),/0 \/ 2/);
});

test('Multi-month report keeps target comparisons separate',()=>{
 const {targetScore}=calendar('2026-09-30T09:00:00Z');
 assert.match(targetScore({reservations:20},'months3'),/لا تُقارن بهدف شهر واحد/);
});

test('Lifetime asks the backend for earliest historical business evidence and does not compare to monthly goals',()=>{
 const {period,targetScore}=calendar('2026-10-01T10:00:00Z');
 assert.deepEqual(period('all'),{from:null,to:'2026-10-02'});
 assert.match(targetScore({active_inventory:12,targets:{inventory_target:10}},'all'),/لا تُقارن بهدف شهر واحد/);
 assert(!targetScore({},'all').includes('%'));
});
test('Expected booking commission OR reservation count meets the monthly target',()=>{
 const score=calendar('2026-10-01T10:00:00Z').targetScore;
 assert.match(score({reservations:1,expected_commission:4000},'month'),/متحقق/);
 assert.match(score({reservations:2,expected_commission:null},'month'),/متحقق/);
 assert.match(score({reservations:1,expected_commission:null},'month'),/محجوبة/);
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
 assert.match(score({active_inventory:7,new_properties:0,reservations:0,targets:{new_properties_target:999}},'month'),/0 \/ 2/);
});
test('Arabic date labels retain Western numerals',()=>{
 const rendered=new Date('2026-10-01T10:25:00Z').toLocaleString('ar-OM-u-nu-latn',{timeZone:'Asia/Muscat'});
 assert(!/[\u0660-\u0669\u06f0-\u06f9]/.test(rendered));assert(/[0-9]/.test(rendered));
});
