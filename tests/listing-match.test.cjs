'use strict';
// SQL123 (18 Nov 2026): «نزل عندنا … ممكن يناسب طلبك» is scored and capped, never repeats a unit of a group, and a price drop runs it.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),url=require('node:url');
const read=f=>fs.readFileSync(f,'utf8');
const lib=()=>import(url.pathToFileURL(path.resolve('supabase/functions/_shared/listing-match.mjs')).href);
const sql=read('db/changes/123-listing-match.forward.sql'),rb=read('db/changes/123-listing-match.rollback.sql');
const out=read('supabase/functions/whatsapp-outreach/index.ts');
const now=Date.parse('2026-11-18T08:00:00Z'),daysAgo=d=>new Date(now-d*86400000).toISOString();
const villa={type:'villa',area:'الصومحان الجنوبيه',wilayat:'بركاء',price:69000};

test('SQL123 migration copy is byte-identical',()=>{
  const m=fs.readdirSync('supabase/migrations').find(f=>f.endsWith('_listing_match_20261118.sql'));
  assert(m);assert.equal(read('supabase/migrations/'+m),sql);
});
test('the same area is «مطابق», the wilayat alone is «قريب» and needs a budget the price fits',async()=>{
  const {scoreRequest}=await lib();
  assert.equal(scoreRequest(villa,{preferred_areas:['الصومحان'],property_types:['villa'],budget_max:70000},daysAgo(3),now).level,'exact');
  assert.equal(scoreRequest(villa,{preferred_area:'بركاء الصومحان الجنوبية',budget_max:70000},daysAgo(3),now).level,'exact');
  assert.equal(scoreRequest(villa,{preferred_area:'بركاء',budget_max:70000},daysAgo(3),now).level,'near');
  assert.equal(scoreRequest(villa,{preferred_area:'بركاء'},daysAgo(3),now),null);
  assert.equal(scoreRequest(villa,{preferred_area:'الجنوبية',budget_max:70000},daysAgo(3),null),null);
  assert.equal(scoreRequest(villa,{preferred_area:'العامرات',budget_max:70000},daysAgo(3),now),null);
});
test('type, budget and recency',async()=>{
  const {scoreRequest}=await lib();
  assert.equal(scoreRequest(villa,{preferred_area:'الصومحان',property_types:['apartment'],budget_max:70000},daysAgo(3),now),null);
  assert.equal(scoreRequest(villa,{preferred_area:'الصومحان',budget_max:55000},daysAgo(3),now),null); // 69 > 55*1.15
  assert.equal(scoreRequest(villa,{preferred_area:'الصومحان'},daysAgo(90),now),null); // no budget, silent 90 days
  assert(scoreRequest(villa,{preferred_area:'الصومحان'},daysAgo(10),now));
  const close=scoreRequest(villa,{preferred_area:'الصومحان',property_types:['villa'],budget_max:70000},daysAgo(3),now).score;
  const far=scoreRequest(villa,{preferred_area:'الصومحان',property_types:['villa'],budget_max:150000},daysAgo(3),now).score;
  const old=scoreRequest(villa,{preferred_area:'الصومحان',property_types:['villa'],budget_max:70000},daysAgo(100),now).score;
  assert(close>far&&close>old);
});
test('rank: best score first, then the latest client message',async()=>{
  const {rankCandidates}=await lib();
  const r=rankCandidates([{score:50,lastInboundAt:daysAgo(1),id:'a'},{score:80,lastInboundAt:daysAgo(30),id:'b'},{score:50,lastInboundAt:daysAgo(0),id:'c'}]);
  assert.deepEqual(r.map(x=>x.id),['b','c','a']);
});
test('a price is «69 الف» / 69,000 / 69000, never a bare 69',async()=>{
  const {priceMentioned}=await lib();
  assert(priceMentioned('فيلا الصومحان بـ 69 الف',69000));assert(priceMentioned('السعر 69,000',69000));assert(priceMentioned('69000 ريال',69000));
  assert(!priceMentioned('رقمي 96899869123',69000));assert(!priceMentioned('شقة 690 ريال',69000));
  assert(priceMentioned('الايجار 250 ريال',250));assert(!priceMentioned('2500',250));
});
test('outreach: limit 20, unit group, price drop, preview writes nothing',()=>{
  assert(out.includes('from "../_shared/listing-match.mjs"'));
  assert(out.includes('picked.length >= LISTING_CAP'));
  assert(out.includes('db.rpc("crm_unit_sibling_ids"'));
  assert(out.includes('if (preview) return'));
  assert(out.includes('body.price_drop === true'));
  assert(!out.includes('.limit(500)'),'every active request is read, not the first 500');
});
test('SQL123: siblings for the service role only, trigger on a 2 percent price drop, test rows skipped not deleted',()=>{
  assert(/GRANT EXECUTE ON FUNCTION public\.crm_unit_sibling_ids\(uuid\) TO service_role/.test(sql));
  assert(/REVOKE ALL ON FUNCTION public\.crm_unit_sibling_ids\(uuid\) FROM PUBLIC, anon, authenticated/.test(sql));
  assert(sql.includes('new.price <= old.price * 0.98'));
  assert(sql.includes('UPDATE OF status, price'));
  assert(!/DELETE\s+FROM/i.test(sql));
  assert(rb.includes('UPDATE OF status ON'));
});
