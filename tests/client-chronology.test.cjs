'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function harness(rpc){const ctx={Intl,Date,Set,Map,Error,supa:{rpc}};vm.createContext(ctx);vm.runInContext(fs.readFileSync('crm-client-chronology.js','utf8'),ctx);return ctx.CRMClientChronology;}
test('newest first-contact wins, not most recent follow-up or import timestamp; stable ties and unknown bottom',()=>{
 const c=harness(),rows=[{id:'old',first_contact_at:'2024-01-01T00:00:00Z',created_at:'2026-10-21T10:00:00Z'},{id:'new',first_contact_at:'2026-10-21T07:12:00Z',next_followup:'2027-01-01'},{id:'manual',created_at:'2026-10-20T07:00:00Z'},{id:'unknown'},{id:'tie',first_contact_at:'2026-10-21T07:12:00Z'}];
 assert.deepEqual(rows.sort(c.compare).map(r=>r.id),['new','tie','manual','old','unknown']);assert.match(c.arrival(rows[2]).label,/أول تواصل غير مسجل/);
});
test('Oman midnight and date/time use Western digits independent of host timezone',()=>{
 const c=harness();assert.equal(c.format('2026-10-20T20:05:00Z'),'21/10/2026 · 00:05');assert.equal(c.format('2026-10-21T07:12:00Z'),'21/10/2026 · 11:12');assert.equal(c.format(null),'غير مسجل');
});
test('400-row bounded reads cover complete inventory without N+1 and preserve immutable clients',async()=>{
 const calls=[],c=harness(async(n,a)=>{calls.push(a.p_client_ids.length);return {data:a.p_client_ids.map(id=>({client_id:id,first_contact_at:id==='0'?'2026-10-01T10:00:00Z':null,first_contact_source:id==='0'?'whatsapp':null}))};});const rows=Array.from({length:901},(_,i)=>({id:String(i),created_at:'2026-09-01T00:00:00Z'}));const result=await c.enrich(rows);assert.deepEqual(calls,[400,400,101]);assert.equal(result.length,901);assert.equal(result[0].first_contact_source,'whatsapp');assert.equal(rows[0].first_contact_at,undefined);
});
test('failed/partial/mismatched timestamp reads are errors, never fabricated zero or partially sorted list',async()=>{
 for(const response of [{error:{message:'offline'}},{data:[]},{data:[{client_id:'other',first_contact_at:null}]},{data:[{client_id:'a',first_contact_at:'bad',first_contact_source:'whatsapp'}]}])await assert.rejects(harness(async()=>response).enrich([{id:'a'}]));
});
test('session/selection change discards late first-contact responses',async()=>{let active=true;const c=harness(async()=>{active=false;return {data:[{client_id:'a',first_contact_at:null}]};});assert.equal((await c.enrich([{id:'a'}],()=>active)).length,0);});
