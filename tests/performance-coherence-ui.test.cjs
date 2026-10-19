'use strict';
// Presentation contract checks. SQL tests establish the underlying event dates,
// authorization and deduplication; these checks prevent UI cohort substitution.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('crm-operations-v6.js','utf8');
function fixture(role='owner'){
 const nodes=new Map(['employeePerformanceResults','opsDashboardPerformanceResults','opsPerformanceDetails','teamLeaderboard','conversionFunnel'].map(id=>[id,{id,innerHTML:'',querySelectorAll:()=>[]}])),$calls=[];
 const context={document:{getElementById:id=>nodes.get(id)||null,querySelectorAll:()=>[],addEventListener(){}},currentUser:{id:'TEST-owner'},currentProfile:{role},currentCompany:{created_at:'2026-05-01'},crmSessionGeneration:1,
  escapeHtml:value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),supa:{rpc:(name,args)=>new Promise(resolve=>$calls.push({name,args,resolve}))}};
 context.crmSessionCurrent=(generation,user)=>context.crmSessionGeneration===generation&&context.currentUser?.id===user;context.window=context;vm.createContext(context);vm.runInContext(source,context);
 return {context,nodes,calls:$calls,flush:()=>new Promise(resolve=>setImmediate(resolve))};
}
const employee=(extra={})=>({employee_id:'TEST-employee',name:'موظفة اصطناعية',inquiry_clients:13,inquiries:277,inquiry_property_pairs:16,replied_inquiry_clients:13,inquiry_to_visit:44,inquiry_pair_to_visit:1,successful_staff_messages:864,new_properties:2,
 active_inventory:98765,visits_booked:93,visits_done:8,visit_cohort_total:5,visit_cohort_done:4,visit_cohort_pending:1,visit_cohort_cancelled:0,
 reservations:2,active_reservations:1,cancelled_reservations:1,sales:1,visit_to_sale:1,activities:99,followup_clients:6,sales_without_reservation:0,
 expected_commission:4500,company_commission:2500,commission_collected:500.005,unknown_expected_commission:0,targets:{reservations_target:2,booking_commission_target:4000},...extra});
async function render(row,method='crmPerformancePeriod',role='owner'){
 const f=fixture(role);f.context[method]('month',{from:'2024-10-01',to:'2024-11-01'});f.calls[0].resolve({data:{from:'2024-10-01',employees:[row]},error:null});await f.flush();
 const box=method==='crmReportPerformance'?'teamLeaderboard':method==='crmDashboardPerformancePeriod'?'opsDashboardPerformanceResults':'employeePerformanceResults';
 return {html:f.nodes.get(box).innerHTML,f};
}
function value(html,key){
 const match=html.match(new RegExp('data-performance-metric="'+key+'"[\\s\\S]*?class="ops-performance-value">([^<]+)<'));
 assert(match,'missing displayed metric '+key);return match[1];
}
function stage(html,key){const start=html.indexOf('data-performance-stage="'+key+'"');assert(start>=0);return html.slice(start,html.indexOf('</section>',start));}
test('Dashboard, Team and Reports group inquiry clients, property links and human replies without adding them or showing current stock',async()=>{
 for(const method of ['crmDashboardPerformancePeriod','crmPerformancePeriod','crmReportPerformance']){
  const {html}=await render(employee(),method),inquiries=stage(html,'inquiries');
  assert.equal(value(inquiries,'inquiry_clients'),'13');assert.equal(value(inquiries,'inquiry_property_pairs'),'16');assert.equal(value(inquiries,'replied_inquiry_clients'),'13');assert.equal(value(inquiries,'inquiry_pair_to_visit'),'1');
  assert.equal(value(html,'successful_staff_messages'),'864');assert.equal(value(html,'new_properties'),'2');
  assert.doesNotMatch(html,/عقارات نشطة الآن|data-performance-metric="active_inventory"|98,765/);
  assert.match(html,/قد يستفسر العميل نفسه عن أكثر من عقار/);assert.match(html,/بتوقيت مسقط/);
 }
});
test('visit status breakdown uses one explicit appointment-date cohort, never booked-minus-completed from separate periods',async()=>{
 const {html}=await render(employee()),visits=stage(html,'visits');
 assert.equal(value(visits,'visit_cohort_total'),'5');assert.equal(value(visits,'visit_cohort_done'),'4');assert.equal(value(visits,'visit_cohort_pending'),'1');assert.equal(value(visits,'visit_cohort_cancelled'),'0');
 assert.doesNotMatch(visits,/>93<|>8<|>85</);assert.match(visits,/بتاريخ الزيارة المسجل/);
});
test('bookings, active/cancelled details, closed sales and milli-OMR receipts remain separate',async()=>{
 const {html}=await render(employee());
 for(const [key,want] of Object.entries({reservations:'2',active_reservations:'1',cancelled_reservations:'1',sales:'1',visit_to_sale:'1',expected_commission:'4,500',company_commission:'2,500',commission_collected:'500.005'}))assert.equal(value(html,key),want);
 assert.match(html,/إتمام البيع أو التحصيل لاحقًا لا يُزيلهما من ذلك الشهر/);assert.match(html,/هدف الحجوزات الشهري متحقق/);assert.doesNotMatch(html,/7,500\.005/);
});
test('documented follow-up clients use their own count instead of raw activity rows',async()=>{
 const {html}=await render(employee());assert.equal(value(html,'followup_clients'),'6');assert.doesNotMatch(html,/data-performance-metric="activities"|>99</);assert.match(html,/تواصل بشري موثق بنتيجة/);
});
test('missing additive cohort fields remain explicitly unavailable instead of being fabricated from legacy counts',async()=>{
 const row=employee();for(const key of ['inquiry_property_pairs','inquiry_pair_to_visit','visit_cohort_total','visit_cohort_done','visit_cohort_pending','visit_cohort_cancelled','followup_clients'])delete row[key];
 const {html}=await render(row);
 for(const key of ['inquiry_property_pairs','inquiry_pair_to_visit','visit_cohort_total','visit_cohort_done','visit_cohort_pending','visit_cohort_cancelled','followup_clients'])assert.equal(value(html,key),'—');
 assert.match(stage(html,'visits'),/غير متاحة حاليًا/);
});
test('masked financial values stay absent while genuine zero counts and receipts remain visible',async()=>{
 const {html:masked}=await render(employee({expected_commission:null,company_commission:null,commission_collected:null}),'crmPerformancePeriod','manager');
 assert.doesNotMatch(masked,/data-performance-metric="(?:expected_commission|company_commission|commission_collected)"|ops-performance-finance/);
 const {html:zero}=await render(employee({inquiry_clients:0,inquiry_property_pairs:0,followup_clients:0,commission_collected:0}));
 for(const key of ['inquiry_clients','inquiry_property_pairs','followup_clients','commission_collected'])assert.equal(value(zero,key),'0');
});
test('a completed sale missing its booking record is diagnosed and cannot satisfy a monthly booking goal through sales or cash',async()=>{
 const {html}=await render(employee({reservations:0,active_reservations:0,cancelled_reservations:0,expected_commission:0,sales:1,company_commission:2500,commission_collected:2500,sales_without_reservation:1}));
 assert.match(html,/1 من مبيعات الفترة تفتقد تاريخ حجز مؤكدًا/);assert.match(html,/هدف الحجوزات: 0 \/ 2/);assert.doesNotMatch(html,/هدف الحجوزات الشهري متحقق/);assert.equal(value(html,'commission_collected'),'2,500');
});

test('report journey uses the same real three-stage contract per employee without repeated finances or invalid conversion percentages',async()=>{
 const f=fixture(),pending=f.context.crmReportPerformance('month',{from:'2024-10-01',to:'2024-11-01'},'conversionFunnel');
 f.calls[0].resolve({data:{from:'2024-10-01',employees:[employee({name:'TEST Muscat'}),employee({name:'TEST Barka',inquiry_clients:4})]},error:null});await pending;
 const html=f.nodes.get('conversionFunnel').innerHTML;
 assert.equal((html.match(/data-performance-stage="inquiries"/g)||[]).length,2);
 assert.equal((html.match(/data-performance-stage="visits"/g)||[]).length,2);assert.equal((html.match(/data-performance-stage="deals"/g)||[]).length,2);
 assert.equal(value(html,'visit_cohort_total'),'5');assert.equal(value(html,'visit_cohort_done'),'4');assert.match(html,/TEST Muscat/);assert.match(html,/TEST Barka/);
 assert.doesNotMatch(html,/ops-performance-work|ops-performance-finance|من السابق|17 عميل|data-performance-metric="(?:successful_staff_messages|company_commission)"/);
 assert.match(html,/2024-10-01 — 2024-10-31 · بتوقيت مسقط/);
});
test('missing closed-sale commission is explicitly diagnosed while gross office basis is clearly labelled',async()=>{
 const {html}=await render(employee({company_commission:0,unknown_company_commission:1}));
 assert.match(html,/عمولات المكتب من المبيعات المكتملة في الفترة/);assert.match(html,/قبل خصم نصيب الموظفة/);
 assert.match(html,/مبيعات مكتملة لم تُحدد عمولة المكتب فيها: 1/);assert.match(html,/الإجمالي يشمل القيم المعروفة فقط/);
});
test('reports funnel entry delegates to the period RPC before unrelated client/deal reads, preserving Oman boundaries and lifetime',async()=>{
 const base=fs.readFileSync('app-base-v15.html','utf8');
 const fn=name=>{const m=new RegExp('(?:async )?function '+name+'\\(').exec(base);assert(m);for(let end=base.indexOf('}',m.index);end>=0;end=base.indexOf('}',end+1)){const text=base.slice(m.index,end+1);try{new vm.Script(text);return text;}catch{}}throw Error('missing function '+name);};
 for(const lifetime of [false,true]){
  const f=fixture(),c=f.context,notices=[];
  Object.assign(c,{isOwner:()=>true,reportLoadSeq:0,reportTab:'funnel',reportPeriod:lifetime?'all':'month',showReportNotice:text=>notices.push(text),getPeriodRange:()=>({start:new Date('2024-09-30T20:00:00Z'),end:new Date('2024-10-31T20:00:00Z')}),supa:{...c.supa,from:()=>assert.fail('journey must not infer metrics from a client/deal list')}});
  vm.runInContext(fn('renderFunnel')+'\n'+fn('loadReports'),c);const loading=c.loadReports();
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'crm_employee_performance');assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].args)),{p_from:lifetime?null:'2024-10-01',p_to:'2024-11-01'});
  f.calls[0].resolve({data:{from:'2024-10-01',employees:[employee()]},error:null});await loading;
  assert.match(notices[0],/بيانات المستثمرين الخاصة غير مشمولة/);assert.match(f.nodes.get('conversionFunnel').innerHTML,/data-performance-stage="visits"/);
 }
});
