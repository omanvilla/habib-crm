'use strict';
// SQL166 (27 Nov 2026, Ahmed): the new-listing alert goes by itself to every matching buyer, a details message a day later when
// unanswered, then nothing; «حصلت / خلاص ما ابحث» gets one line and closes the requests.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),url=require('node:url');
const read=f=>fs.readFileSync(f,'utf8');
const lib=()=>import(url.pathToFileURL(path.resolve('supabase/functions/_shared/listing-match.mjs')).href);
const sql=read('db/changes/166-new-listing-auto.forward.sql'),rb=read('db/changes/166-new-listing-auto.rollback.sql');
const out=read('supabase/functions/whatsapp-outreach/index.ts'),agent=read('supabase/functions/whatsapp-reply-agent/index.ts');
const review=read('supabase/functions/whatsapp-visit-followup-auto/index.ts');
const now=Date.parse('2026-11-27T08:00:00Z'),daysAgo=d=>new Date(now-d*86400000).toISOString();
const villa={type:'villa',area:'الصومحان الجنوبيه',wilayat:'بركاء',price:69000};

test('SQL166 migration copy is byte-identical, switch is off by default, nothing deleted',()=>{
  assert.equal(read('supabase/migrations/20261127160000_new_listing_auto.sql'),sql);
  assert(sql.includes('new_listing_auto boolean NOT NULL DEFAULT false'));
  assert(!/DELETE\s+FROM|DROP\s+TABLE/i.test(sql));
  assert(sql.includes('q.reviewed_at IS NOT NULL')&&sql.includes('r.new_listing_auto'));
  assert(sql.includes("'queue_listing_details'"));
  assert(rb.includes("DROP COLUMN IF EXISTS new_listing_auto"));
});
test('every matching buyer (cap 200 only as a safety stop); «قريب» only when no other area was named',async()=>{
  const {scoreRequest,LISTING_CAP}=await lib();
  assert.equal(LISTING_CAP,200);
  assert.equal(scoreRequest(villa,{preferred_area:'بركاء',budget_max:70000},daysAgo(3),now).level,'near');
  assert.equal(scoreRequest(villa,{preferred_area:'الرميس',wilayat:'بركاء',budget_max:70000},daysAgo(3),now),null);
  assert.equal(scoreRequest(villa,{preferred_areas:['رميس و المنومة'],budget_max:100000},daysAgo(3),now),null);
  assert.equal(scoreRequest(villa,{preferred_area:'الصومحان',budget_max:70000},daysAgo(3),now).level,'exact');
});
test('the weekly gap no longer holds a new listing; two days do',()=>{
  assert(out.includes('.eq("status", "sent").gte("sent_at", new Date(Date.now() - 2 * DAY).toISOString())'));
  assert(!out.includes('.in("status", ["pending", "approved", "sent"]).gte("created_at", new Date(Date.now() - 7 * DAY).toISOString())).data || []).map((m: any) => m.client_id));'));
});
test('step 2: once, a day after, only when the client wrote nothing, property still available, switch on',()=>{
  assert(out.includes('case "queue_listing_details"'));
  assert(out.includes('kind: "new_listing_details"')&&out.includes('.eq("kind", "new_listing_details").eq("property_id", s.property_id).eq("client_id", s.client_id)'));
  assert(out.includes('.lte("sent_at", new Date(now - DAY).toISOString())'));
  assert(out.includes('skip: "client_wrote"')&&out.includes('skip: "property_gone"')&&out.includes('skip: "auto_off"'));
  assert(out.includes('property_details_ar_v1: { category: "MARKETING", body: "هذي تفاصيل {{1}}\\n{{2}}\\nتحب نرتب لك زيارة ؟"'));
});
test('the review knows a kept new listing now goes by itself',()=>{
  assert(review.includes('SQL166، أحمد 27 نوفمبر: «على طول توصل له رسالة»'));
});
test('reply agent: «حصلت» = مبروك, «خلاص ما ابحث» = goodbye, a pause or a correction is not an end',()=>{
  const grab=n=>{const m=agent.match(new RegExp(`const ${n} = (/.+/);`));assert(m,n);return eval(m[1]);};
  const NO_LONGER_RE=grab('NO_LONGER_RE'),PAUSE_WORDS=grab('PAUSE_WORDS');
  const noLonger=t=>NO_LONGER_RE.test(t)&&t.trim().length<=40&&!PAUSE_WORDS.test(t)&&!/(^|\s)(عن|ابي|ابغ|اريد|بس|لكن|ارض|فيلا|فل[ةه]|شق|بيت|منزل|استراح)/.test(t);
  assert(agent.includes(String.raw`const noLonger = (t = "") => NO_LONGER_RE.test(t) && t.trim().length <= 40 && !PAUSE_WORDS.test(t) && !/(^|\s)(عن|ابي|ابغ|اريد|بس|لكن|ارض|فيلا|فل[ةه]|شق|بيت|منزل|استراح)/.test(t);`));
  for(const t of ['خلاص ما ابحث','ما عاد ابحث','ما ادور','مب محتاج'])assert(noLonger(t),t);
  for(const t of ['حاليا ما ابحث','ما ابحث الحين بعد شهرين','ما ابحث عن فيلا ابي ارض','ما ابحث بس اسأل'])assert(!noLonger(t),t);
  assert(agent.includes('"مبروك 🌷 الله يتمم لك على خير"')&&agent.includes('"حياك الله 🌷 إذا احتجت شي مستقبلاً احنا موجودين"'));
  assert(agent.includes('status: "cancelled", closed_reason'),'requests are closed, not deleted');
});
