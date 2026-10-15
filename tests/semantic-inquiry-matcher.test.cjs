'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const api = import('../supabase/functions/_shared/property-inquiry-matcher.mjs');
const inventory = [
  {id:'k135',title:'فيلا حديثة للبيع بالخوض السابعة',area:'الخوض السابعة',price:135000,property_code:'HB135'},
  {id:'k109',title:'فيلا مميزة الخوض الرابعة',area:'الخوض الرابعة',price:109000},
  {id:'m120',title:'فيلا مودرن في المعبيلة',area:'المعبيلة',price:120000},
];
const ids = result => result.matches.map(x => x.property_id).sort();
test('Arabic, Persian, grouped, decimal and thousand prices normalize without touching original evidence', async () => {
  const {normalizeListingText,matchListingReferences:match} = await api;
  assert.equal(normalizeListingText('١٣٥٬٠٠٠ ۱۳۵ ألف 135k 135,000'), '135000 135000 135000 135000');
  assert.equal(normalizeListingText('١٣٥٫٥ ألف'), '135500');
  for(const price of ['135 ألف','١٣٥ألف','۱۳۵ ألف','135k','135,000','١٣٥٬٠٠٠','135']) {
    const text=`ممكن تفاصيل الفيلا في الخوض ${price}`;
    const result=match(text,inventory);assert.deepEqual(ids(result),['k135'],price);
    assert.equal(result.matches[0].quote,text);assert.equal(result.matches[0].matched_facts.price,135000);
  }
});
test('Terse known area and shorthand price resolves a single listing',async()=>{
  const {matchListingReferences:match}=await api;
  assert.deepEqual(ids(match('الخوض 135',inventory)),['k135']);
  assert.deepEqual(ids(match('الخوض135',inventory)),['k135']);
  assert.deepEqual(ids(match('ممكن تفاصيل الفيلا فالخوض ب١٣٥ ألف',inventory)),['k135']);
  assert.deepEqual(ids(match('Al Khoudh 135k',inventory)),['k135']);
  assert.deepEqual(ids(match('الخوض الرابعة 135 ألف',inventory)),[]);
  assert.deepEqual(ids(match('الخوض 7 135 ألف',inventory)),['k135']);
  const realPatterns=[...inventory,{id:'r59',title:'فيلا في بركاء الرميس',area:'بركاء الرميس',price:59000},{id:'k120',area:'الخوض',price:120000}];
  assert.deepEqual(ids(match('السلام عليكم اخي كيف الحال\nبغيت موقع الفلل الي في الرميس معروضات ب٥٩',realPatterns)),['r59']);
  assert.deepEqual(ids(match('في بيت ثاني نفس الشي ب ١٢٠ فالخوض ممكن اروح اعاينه اليوم ع العصر',realPatterns)),['k120']);
});
test('Generic search and budget is not a specific listing inquiry',async()=>{
  const {matchListingReferences:match,isPropertyRequest}=await api;
  for(const text of ['أبحث عن فيلا بالخوض بحدود 135 ألف','عندكم فلل في الخوض','ميزانيتي 135 ألف واريد فيلا في الخوض','أريد فيلا بالخوض 135 ألف','هل عندكم فيلا في الخوض 135 ألف']) {
    const r=match(text,inventory);assert.deepEqual(ids(r),[],text);assert.equal(r.generalRequest,true,text);
  }
  assert.equal(isPropertyRequest('عندكم فلل في الخوض'),true);
  assert.equal(isPropertyRequest('أبحث عن فيلا في الخوض'),true);
  assert.equal(isPropertyRequest('ممكن تفاصيل'),true);
  assert.equal(isPropertyRequest('كم السعر'),true);
  assert.equal(isPropertyRequest('هل هذه متوفرة'),true);
  assert.equal(isPropertyRequest('الموقع'),true);
  assert.equal(isPropertyRequest('عندكم بيوت ثانية'),true);
  assert.deepEqual(ids(match('الموقع',inventory)),[]);
  assert.equal(isPropertyRequest('السلام عليكم'),false);
});
test('Audited natural follow-up phrases are genuine asks but still need property evidence',async()=>{
  const {matchListingReferences:match,isPropertyRequest}=await api;
  for(const text of ['ممكن التفاصيل','ارسلي مال الرميس','ارسلي تفاصل فيلا صومحان','كلمتك بخصوص الفيلا للبيع بالحوض السابعه','لو سمحت تبعتيلى الموقع']) {
    assert.equal(isPropertyRequest(text),true,text);assert.deepEqual(ids(match(text,inventory)),[],text);
  }
  for(const text of ['ارسلي كلمة السر','ارسلي العقد القديم','لو سمحت','شكرا','مرحبا','تجربة اختبار']) assert.equal(isPropertyRequest(text),false,text);
});
test('Rejections, seller offers and unrelated business text cannot create inbound inquiries',async()=>{
  const {matchListingReferences:match,isPropertyRequest}=await api;
  for(const text of ['لا أريد الفيلا في الخوض 135 ألف','غير مهتم فيلا الخوض 135','الفيلا في الخوض 135 ما ناسبني','أنا المالك عندي فيلا في الخوض للبيع 135 ألف','رقم العميل 1350000','موديل السيارة 2020']) {
    assert.deepEqual(ids(match(text,inventory)),[],text);assert.equal(isPropertyRequest(text),false,text);
  }
});
test('Duplicate area/price, title and code never pick an arbitrary candidate',async()=>{
  const {matchListingReferences:match}=await api;
  const duplicate=[...inventory,{...inventory[0],id:'duplicate',area:'الخوض الرابعة',title:'فيلا أخرى بالخوض'}];
  const area=match('الخوض 135 ألف',duplicate);assert.equal(area.ambiguous,true);assert.deepEqual(ids(area),[]);
  const code=match('ممكن تفاصيل HB135',duplicate);assert.equal(code.ambiguous,true);assert.deepEqual(ids(code),[]);
  assert.deepEqual(ids(match('الخوض السابعة 135 ألف',duplicate)),['k135']);
});
test('Independent area-price segments link several listings without cross pairing prices',async()=>{
  const {matchListingReferences:match}=await api;
  const all=[...inventory,{id:'wrong1',area:'الخوض',price:120000},{id:'wrong2',area:'المعبيلة',price:135000}];
  assert.deepEqual(ids(match('ممكن تفاصيل الخوض 135 ألف والمعبيلة 120 ألف',all)),['k135','m120']);
  assert.deepEqual(ids(match('فيلا الخوض السابعة سعرها 135 ألف\nفيلا المعبيلة سعرها 120 ألف',all,{requireIntent:false})),['k135','m120']);
});
test('Long listing sections bind their own area and price, including multiple staff descriptions',async()=>{
  const {matchListingReferences:match}=await api;
  const details='تحتوي على غرف نوم واسعة ومجلس وصالة عائلية ومطبخ مستقل ومواقف للسيارات وتشطيبات حديثة ونوافذ واسعة ومرافق متكاملة ومدخل مستقل وحديقة خاصة ومكان مخصص للغسيل والتخزين';
  const first=`فيلا في الخوض ${details} مساحة الأرض 300 متر والبناء 441 متر والسعر 135 ألف ريال`;
  const second=`فيلا في المعبيلة ${details} مساحة الأرض 400 متر والبناء 350 متر والسعر 120 ألف ريال`;
  const rows=[...inventory,{id:'wrong1',area:'الخوض',price:120000},{id:'wrong2',area:'المعبيلة',price:135000}];
  assert.deepEqual(ids(match(first,rows,{requireIntent:false})),['k135']);
  assert.deepEqual(ids(match(`${first}\n\n${second}`,rows,{requireIntent:false})),['k135','m120']);
  assert.deepEqual(ids(match(`ممكن تفاصيل ${first}`,rows)),['k135']);
  const competing=match(`فيلا في الخوض بالقرب من المعبيلة ${details} السعر 135 ألف`,rows,{requireIntent:false});
  assert.deepEqual(ids(competing),[]);assert.equal(competing.ambiguous,true);
  const competingDistricts=match(`فيلا في الخوض الرابعة أو الخوض السابعة ${details} السعر 135 ألف`,rows,{requireIntent:false});
  assert.deepEqual(ids(competingDistricts),[]);assert.equal(competingDistricts.ambiguous,true);
  assert.deepEqual(ids(match(`ابحث عن فيلا بالخوض ${details} ميزانيتي 135 ألف`,rows)),[]);
});
test('Unique exact title/code, code boundaries, and blank titles are checked',async()=>{
  const {matchListingReferences:match}=await api;
  assert.deepEqual(ids(match('اريد تفاصيل HB135',inventory)),['k135']);
  assert.deepEqual(ids(match('HB135',inventory)),['k135']);
  assert.deepEqual(ids(match('اريد تفاصيل HB1356',inventory)),[]);
  assert.deepEqual(ids(match('ممكن تفاصيل الخوض 135 ألف',[...inventory,{id:'numeric-code',property_code:'135000',area:'بركاء',price:59000} ])),['k135']);
  assert.deepEqual(ids(match('رمز العقار 135000',[{id:'numeric-code',property_code:'135000'}])),['numeric-code']);
  assert.deepEqual(ids(match('ممكن تفاصيل فيلا مميزة الخوض الرابعة',inventory)),['k109']);
  assert.deepEqual(ids(match('شكرا',inventory)),[]);
});
test('Room counts, dimensions, phone numbers and years are not shorthand prices',async()=>{
  const {matchListingReferences:match}=await api;
  const tricky=[...inventory,{id:'year',area:'الخوض',price:2020},{id:'land',area:'الخوض',price:300000}];
  assert.deepEqual(ids(match('ممكن تفاصيل الخوض 300 متر',tricky)),[]);
  assert.deepEqual(ids(match('ممكن تفاصيل الخوض اتصل 91350000',tricky)),[]);
  assert.deepEqual(ids(match('ممكن تفاصيل الخوض من سنة 2020',tricky)),[]);
  assert.deepEqual(ids(match('ممكن تفاصيل الفيلا بالخوض مساحتها 135',tricky)),[]);
  assert.deepEqual(ids(match('ممكن تفاصيل الفيلا بالخوض رقم القطعة135',tricky)),[]);
  assert.deepEqual(ids(match('ممكن تفاصيل الفيلا بالخوض رقم الهاتف135000',tricky)),[]);
  assert.deepEqual(ids(match('ممكن تفاصيل الفيلا بالخوض رقم العقار135000',tricky)),[]);
  assert.deepEqual(ids(match('ممكن تفاصيل الخوض 135000.00',tricky)),['k135']);
});
test('Exact title cannot override contradictory explicit price, while known code/link retains identity',async()=>{
  const {matchListingReferences:match}=await api;
  const rows=[{id:'fourth109',title:'فيلا الخوض الرابعة',area:'الخوض الرابعة',price:109000,property_code:'KH4',marketing_urls:['https://instagram.com/reel/UniqueKH4/']},inventory[0]];
  const contradictory=match('ممكن تفاصيل فيلا الخوض الرابعة 135 ألف',rows);
  assert.deepEqual(ids(contradictory),[]);assert.equal(contradictory.ambiguous,true);
  assert.deepEqual(ids(match('ممكن تفاصيل فيلا الخوض الرابعة 109 ألف',rows)),['fourth109']);
  assert.deepEqual(ids(match('ممكن تفاصيل فيلا الخوض الرابعة 135 ألف KH4',rows)),['fourth109']);
  assert.deepEqual(ids(match('ممكن تفاصيل فيلا الخوض الرابعة 135 ألف https://instagram.com/reel/UniqueKH4/',rows)),['fourth109']);
  assert.deepEqual(ids(match('ممكن تفاصيل فيلا الخوض الرابعة مساحتها 135 متر',rows)),['fourth109']);
});
test('Human response eligibility excludes automation, inbound messages and failed sends',async()=>{
  const {isHumanListingResponse:human,matchListingReferences:match}=await api;
  const message={direction:'outbound',actor_type:'human',body:'فيلا الخوض السابعة 135 ألف',delivery_status:'sent'};
  assert.equal(human(message),true);assert.equal(human({...message,actor_type:'automated'}),false);
  assert.equal(human({...message,direction:'inbound'}),false);assert.equal(human({...message,delivery_status:'failed'}),false);
  assert.deepEqual(ids(match(message.body,inventory,{requireIntent:false})),['k135']);
});
test('Exact saved links preserve shortcode case and uniqueness; unknown URLs never guess',async()=>{
  const {matchListingReferences:match,normalizeListingUrl}=await api;
  const rows=[{...inventory[0],marketing_urls:['https://www.instagram.com/reel/AbC123/?igsh=one']},inventory[1]];
  const url='https://instagram.com/reel/AbC123/?igsh=two';
  assert.equal(normalizeListingUrl(url),'instagram:AbC123');
  assert.deepEqual(ids(match(url,rows)),['k135']);
  assert.deepEqual(ids(match(url.replace('AbC123','abc123'),rows)),[]);
  assert.deepEqual(ids(match('https://instagram.com/omanvilla',rows)),[]);
  const duplicate=match(url,[...rows,{...rows[0],id:'duplicate'}]);assert.equal(duplicate.ambiguous,true);assert.deepEqual(ids(duplicate),[]);
  const exactDespiteSharedPrice=match(`ممكن تفاصيل الخوض 135 ألف ${url}`,[...rows,{...inventory[0],id:'same-price',property_code:null}]);
  assert.deepEqual(ids(exactDespiteSharedPrice),['k135']);assert.equal(exactDespiteSharedPrice.ambiguous,false);
  assert.equal(exactDespiteSharedPrice.matches[0].matched_facts.kind,'exact_link');
});
test('Matcher is deterministic, handles inventory beyond eighty rows, and never mutates inputs',async()=>{
  const {matchListingReferences:match}=await api;
  const rows=[...Array.from({length:90},(_,i)=>({id:`other${i}`,area:'بركاء',price:60000+i})),...inventory];
  const before=JSON.stringify(rows),first=match('الخوض 135',rows);
  assert.deepEqual(ids(first),['k135']);assert.deepEqual(match('الخوض 135',rows),first);assert.equal(JSON.stringify(rows),before);
});
