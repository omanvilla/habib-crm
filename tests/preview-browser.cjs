'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const server=require('../preview/serve.cjs'),out=path.resolve('preview-results');
fs.mkdirSync(out,{recursive:true});
async function verifyPropertyActions(page,role,report){
 await page.evaluate(()=>navigate('properties',null));
 await page.locator('#propertiesList [data-work-action="archive-property"]').first().waitFor();
 const button=page.locator('#propertiesList [data-work-action="archive-property"]').first(),id=await button.getAttribute('data-work-id');
 const original=await page.evaluate(id=>({property:structuredClone(CRMPREVIEW.db.properties.find(p=>p.id===id)),visits:structuredClone(CRMPREVIEW.db.viewings.filter(v=>v.property_id===id)),deals:structuredClone(CRMPREVIEW.db.deals.filter(d=>d.property_id===id))}),id);
 await page.locator('#propertiesList [data-work-action="edit-property"][data-work-id="'+id+'"]').click();
 await page.locator('#mProperty.on').waitFor();assert.equal(await page.locator('#pTitle').inputValue(),original.property.title);
 await page.locator('#mProperty .modal-foot button').filter({hasText:'إلغاء'}).click();
 // A failed write must keep the visible property and its data intact.
 await page.evaluate(()=>CRMPREVIEW.failNext='properties');
 page.once('dialog',dialog=>dialog.accept());await button.click();
 await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('لم تتم الأرشفة'));
 assert.equal(await page.evaluate(id=>CRMPREVIEW.db.properties.find(p=>p.id===id).archived,id),false);
 page.once('dialog',dialog=>dialog.accept());await button.click();
 await page.waitForFunction(id=>CRMPREVIEW.db.properties.find(p=>p.id===id).archived,id);
 await page.locator('#page-properties .archive-toggle button[onclick*="archived"]').click();
 const restore=page.locator('#propertiesList [data-work-action="restore-property"][data-work-id="'+id+'"]');
 await restore.waitFor();assert.equal(await page.locator('#propertiesList [data-work-action="archive-property"][data-work-id="'+id+'"]').count(),0);
 page.once('dialog',dialog=>dialog.accept());await restore.click();
 await page.waitForFunction(id=>!CRMPREVIEW.db.properties.find(p=>p.id===id).archived,id);
 await page.locator('#page-properties .archive-toggle button[onclick*="active"]').click();
 await page.locator('#propertiesList [data-work-action="archive-property"][data-work-id="'+id+'"]').waitFor();
 const result=await page.evaluate(id=>({property:CRMPREVIEW.db.properties.find(p=>p.id===id),visits:CRMPREVIEW.db.viewings.filter(v=>v.property_id===id),deals:CRMPREVIEW.db.deals.filter(d=>d.property_id===id)}),id);
 assert.equal(result.property.status,original.property.status);assert.equal(result.property.created_at,original.property.created_at);
 assert.deepEqual(result.visits,original.visits);assert.deepEqual(result.deals,original.deals);
 report.checks.push(role+': rendered edit/archive/restore buttons; injected archive failure preserves record; confirmed archive/restore preserves business status, dates and related synthetic records');
}
async function verifyVisitWorkflow(page,role,report){
 await page.evaluate(()=>navigate('viewings',null));
 await page.locator('#page-viewings button[onclick*="mViewing"]').click();await page.locator('#mViewing.on').waitFor();
 const chosen=await page.evaluate(()=>{
  const branch=CRMPREVIEW.actor==='barka'?'barka':'muscat';
  return {client:CRMPREVIEW.db.clients.find(c=>c.lead_route===branch&&c.client_type==='buyer').id,property:CRMPREVIEW.db.properties.find(p=>p.branch_key===branch).id};
 });
 await page.waitForFunction(id=>Array.from(document.querySelector('#vClient').options).some(o=>o.value===id),chosen.client);
 await page.locator('#vClient').selectOption(chosen.client);
 await page.waitForFunction(id=>Array.from(document.querySelector('#vProperty').options).some(o=>o.value===id),chosen.property);
 await page.locator('#vProperty').selectOption(chosen.property);
 assert.equal(await page.locator('#vRequest').inputValue(),'');assert(!(await page.locator('#vRequest').isVisible()));
 assert.equal(await page.locator('#vRequest').evaluate(e=>e.required),false);
 assert(!(await page.locator('label[for="vRequestType"]').innerText()).includes('*'));
 assert.equal(await page.locator('#vLocation').count(),0);
 assert.equal(await page.locator('#vRequestHint button').count(),0);
 await page.locator('#vTime').fill('11:45');await page.locator('#vAttendance').selectOption('client_alone');
 await page.locator('#vNextStep').fill('تأكيد رغبة العميل في المتابعة');
 const date=await page.locator('#vDate').inputValue();await page.locator('#vFollowupDate').fill(date);
 await page.locator('#vNotes').fill('زيارة اصطناعية لا تتصل بالإنتاج');
 const before=await page.evaluate(()=>({db:JSON.stringify(CRMPREVIEW.db),calls:CRMPREVIEW.calls.length}));
 await page.evaluate(()=>CRMPREVIEW.failNext='crm_save_viewing_atomic');
 await page.locator('#mViewing .modal-foot button').filter({hasText:'حفظ'}).click();
 await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('TEST simulated RPC failure'));
 const saved=await page.evaluate(start=>CRMPREVIEW.calls.slice(start).find(c=>c.rpc==='crm_save_viewing_atomic'),before.calls);
 assert(saved,'Submitting a visit without manually choosing a request must reach the atomic RPC');
 assert.equal(saved.args.p_payload.client_id,chosen.client);assert.equal(saved.args.p_payload.property_id,chosen.property);
 assert(!saved.args.p_payload.request_id);assert.equal(saved.args.p_payload.request_type,'buyer');assert(!Object.hasOwn(saved.args.p_payload,'location'));
 assert.equal(saved.args.p_payload.viewing_time,'11:45');assert.equal(saved.args.p_payload.followup_date,date);
 assert.equal(saved.args.p_payload.attendance,'client_alone');assert.equal(saved.args.p_payload.next_step,'تأكيد رغبة العميل في المتابعة');
 assert.equal(await page.evaluate(()=>JSON.stringify(CRMPREVIEW.db)),before.db);
 assert(await page.locator('#mViewing.on').isVisible());assert.equal(await page.locator('#vNotes').inputValue(),'زيارة اصطناعية لا تتصل بالإنتاج');
 await page.locator('#vStatus').selectOption('done');await page.locator('#vPipelineOutcome').waitFor({state:'visible'});
 await page.locator('#vPipelineOutcome').selectOption('lost');await page.locator('#vRejectionReason').selectOption('price');
 assert.equal(await page.locator('#vOutcomeNote').inputValue(),'');
 const lossStart=await page.evaluate(()=>{CRMPREVIEW.failNext='crm_save_viewing_atomic';return CRMPREVIEW.calls.length});
 await page.locator('#mViewing .modal-foot button').filter({hasText:'حفظ'}).click();
 await page.waitForFunction(start=>CRMPREVIEW.calls.slice(start).some(c=>c.rpc==='crm_save_viewing_atomic'),lossStart);
 const lossPayload=await page.evaluate(start=>CRMPREVIEW.calls.slice(start).find(c=>c.rpc==='crm_save_viewing_atomic').args.p_payload,lossStart);
 assert.equal(lossPayload.rejection_reason,'price');assert.equal(lossPayload.outcome_note,null);
 const screen='after-'+role+'-visit-auto-request.png';await page.screenshot({path:path.join(out,screen),fullPage:true});report.screens.push(screen);
 await page.locator('#mViewing .modal-foot button').filter({hasText:'إلغاء'}).click();
 report.checks.push(role+': rendered visit submits an automatic request and omits detailed location; keeps attendance, follow-up and next action; lost outcome accepts a primary reason without customer words; rejected synthetic RPC retains form/data (backend creation tested separately)');
}
async function verifyDealWorkflow(page,role,report){
 await page.evaluate(()=>navigate('deals',null));
 await page.locator('#page-deals button[onclick*="openModal(\'mDeal\')"]').click();
 await page.locator('#dealWorkflowForm').waitFor();
 await page.waitForFunction(()=>!document.querySelector('#dwSave').disabled&&Array.from(document.querySelector('#dwClientChoice').options).some(o=>o.value==='__new__'));
 const branch=role==='barka'?'barka':'muscat';
 const visibleOptions=await page.locator('#dwPropertyChoice').innerText();
 if(role==='muscat')assert(!visibleOptions.includes('الصومحان'));if(role==='barka')assert(!visibleOptions.includes('الخوض'));
 assert.equal(await page.locator('#dwMode').inputValue(),'current');
 await page.locator('#dwMode').selectOption('historical');
 await page.locator('#dwClientChoice').selectOption('__new__');await page.locator('#dwClientName').fill('عميل صفقة تاريخية اصطناعي');await page.locator('#dwClientPhone').fill('+96800000991');
 await page.locator('#dwPropertyChoice').selectOption('__new__');await page.locator('#dwPropertyTitle').fill('فيلا صفقة تاريخية اصطناعية');await page.locator('#dwPropertyArea').fill(branch==='barka'?'بركاء':'الخوض');
 await page.locator('#dwPropertyType').selectOption('villa');await page.locator('#dwPropertyPrice').fill('80000');await page.locator('#dwPropertyBranch').selectOption(branch);
 await page.locator('#dwOwnerChoice').selectOption('__new__');await page.locator('#dwOwnerName').fill('مالك الصفقة الاصطناعي');await page.locator('#dwOwnerPhone').fill('+96800000992');
 const historicalDate=role==='owner'?'2020-06-10':'2022-05-12';
 await page.locator('#dwClosedOn').fill(historicalDate);await page.locator('#dwDealValue').fill('80000');
 await page.locator('#dwNotes').fill('إدخال قديم دون تاريخ زيارة معروف');
 if(role==='owner'){
  await page.locator('#dwCommissionTotal').fill('1000');await page.locator('#dwBrokerCommission').fill('100');await page.locator('#dwEmployeePercent').fill('20');
  assert.equal(await page.locator('#dwAgentShare').inputValue(),'180');assert.equal(await page.locator('#dwCompanyShare').inputValue(),'720');
  await page.locator('#dwCommissionStatus').selectOption('received');
  assert.equal(await page.locator('#dwReceivedOn').inputValue(),'');
 }else{
  assert.equal(await page.locator('#dwFinanceSection').count(),0);assert.equal(await page.locator('#dwCommissionTotal,#dwEmployeePercent,#dwAgentShare').count(),0);
 }
 const desktop='after-'+role+'-historical-deal-desktop.png';await page.screenshot({path:path.join(out,desktop),fullPage:true});report.screens.push(desktop);
 await page.setViewportSize({width:390,height:844});
 assert(await page.locator('#dealWorkflowForm').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'One-screen deal form must fit the emulated mobile width');
 const mobile='after-'+role+'-historical-deal-mobile.png';await page.screenshot({path:path.join(out,mobile),fullPage:true});report.screens.push(mobile);
 await page.setViewportSize({width:1440,height:1000});
 const historicalStart=await page.evaluate(()=>{CRMPREVIEW.failNext='crm_save_deal_workflow';return CRMPREVIEW.calls.length});
 await page.locator('#dwSave').click();
 await page.waitForFunction(start=>CRMPREVIEW.calls.slice(start).some(c=>c.rpc==='crm_save_deal_workflow'),historicalStart);
 await page.waitForFunction(()=>document.querySelector('#dwError').textContent.includes('TEST simulated RPC failure'));
 const historical=await page.evaluate(start=>CRMPREVIEW.calls.slice(start).find(c=>c.rpc==='crm_save_deal_workflow').args.p_payload,historicalStart);
 assert.equal(historical.deal.entry_mode,'historical');assert.equal(historical.deal.closed_on,historicalDate);
 assert(!historical.deal.viewing_id);assert(!historical.deal.visit_date);
 assert.equal(historical.client.name,'عميل صفقة تاريخية اصطناعي');assert.equal(historical.property.title,'فيلا صفقة تاريخية اصطناعية');assert.equal(historical.property.branch_key,branch);assert.equal(historical.owner.name,'مالك الصفقة الاصطناعي');
 if(role==='owner'){assert.equal(Number(historical.deal.financials.employee_commission_percent),20);assert.equal(historical.deal.financials.commission_received_on,null);}else assert(!historical.deal.financials);
 assert(await page.locator('#mDeal.on').isVisible());assert.equal(await page.locator('#dwClosedOn').inputValue(),historicalDate);
 await page.locator('#dwMode').selectOption('current');
 const today=await page.evaluate(()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Muscat'}));await page.locator('#dwClosedOn').fill(today);
 const currentStart=await page.evaluate(()=>CRMPREVIEW.calls.length);await page.locator('#dwSave').click();
 await page.waitForFunction(()=>document.querySelector('#dwError').textContent.includes('زيارة'));
 assert.equal(await page.evaluate(start=>CRMPREVIEW.calls.slice(start).filter(c=>c.rpc==='crm_save_deal_workflow').length,currentStart),0);
 await page.locator('#dwVisitDate').fill(today);
 if(role==='owner'){
  await page.locator('#dwSave').click();
  await page.waitForFunction(()=>/تحصيل|العمولة/.test(document.querySelector('#dwError').textContent));
  assert.equal(await page.evaluate(start=>CRMPREVIEW.calls.slice(start).filter(c=>c.rpc==='crm_save_deal_workflow').length,currentStart),0);
  await page.locator('#dwReceivedOn').fill(today);
 }
 await page.evaluate(()=>CRMPREVIEW.failNext='crm_save_deal_workflow');await page.locator('#dwSave').click();
 await page.waitForFunction(start=>CRMPREVIEW.calls.slice(start).some(c=>c.rpc==='crm_save_deal_workflow'),currentStart);
 const current=await page.evaluate(start=>CRMPREVIEW.calls.slice(start).find(c=>c.rpc==='crm_save_deal_workflow').args.p_payload,currentStart);
 assert.equal(current.deal.entry_mode,'current');assert.equal(current.deal.visit_date,today);assert.equal(current.deal.closed_on,today);
 await page.locator('#dwStage').selectOption('lost');assert(await page.locator('#dwLossSection').isVisible());
 assert(!(await page.locator('#dwNotesSection').isVisible()));assert(!(await page.locator('#dwFinanceSection').isVisible()));
 await page.locator('#dwLostReason').selectOption({index:1});assert.equal(await page.locator('#dwLostWords').inputValue(),'');
 const lossStart=await page.evaluate(()=>{CRMPREVIEW.failNext='crm_save_deal_workflow';return CRMPREVIEW.calls.length});await page.locator('#dwSave').click();
 await page.waitForFunction(start=>CRMPREVIEW.calls.slice(start).some(c=>c.rpc==='crm_save_deal_workflow'),lossStart);
 const loss=await page.evaluate(start=>CRMPREVIEW.calls.slice(start).find(c=>c.rpc==='crm_save_deal_workflow').args.p_payload,lossStart);
 assert(loss.deal.lost_reason_id);assert.equal(loss.deal.lost_reason_note,null);assert(!loss.deal.financials);
 await page.locator('#mDeal .modal-foot button').filter({hasText:'إلغاء'}).click();
 report.checks.push(role+': one-screen historical deal accepts '+historicalDate+' without inventing a visit, submits inline client/property/owner, preserves input on rejected RPC; current closed deal requires visit date'+(role==='owner'?' and received-commission date; per-deal percentage uses commission after broker before employee deduction':' and omits owner-only financial payload')+'; loss has one reason and optional customer words without financial fields; synthetic mobile-width form check');
}
(async()=>{
 await new Promise(r=>server.listen(4173,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true}),report={synthetic:true,realEmployeeSessions:false,device:'Chromium desktop and viewport emulation, not physical phone',screens:[],checks:[],errors:[]};
 try{
 for(const mode of ['before','after'])for(const role of ['owner','muscat','barka']){
  const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Muscat',serviceWorkers:'block',acceptDownloads:true});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERROR',mode,role,e.message)});page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',mode,role,m.text())});
  await context.route('**/*',route=>{const u=new URL(route.request().url());return u.hostname==='127.0.0.1'?route.continue():route.abort();});
  await page.goto('http://127.0.0.1:4173/'+mode+'/'+role+'/');
  try{await page.waitForFunction(()=>typeof currentProfile!=='undefined'&&currentProfile&&document.querySelector('#page-dash'),{timeout:12000});}catch(e){console.log('BOOT BODY',(await page.locator('body').innerText()).slice(0,5000));console.log('FIXTURE',await page.evaluate(()=>window.CRMPREVIEW&&({calls:CRMPREVIEW.calls,profile:CRMPREVIEW.profile})));await page.screenshot({path:path.join(out,'boot-failure-'+mode+'-'+role+'.png'),fullPage:true});throw e;}
  await page.waitForTimeout(1200);
  
  if(mode==='after'&&role!=='owner'){
   await page.evaluate(()=>loadEmployeeTargetReminder());
   assert(await page.locator('#employeeInventoryReminder').isVisible());
   assert.equal(await page.locator('#employeeInventoryReminder').evaluate(e=>e.closest('details')),null);
   const original=await page.evaluate(()=>JSON.parse(JSON.stringify(CRMPREVIEW.db.properties)));
   await page.evaluate(()=>{
     const state=CRMPREVIEW,property=state.db.properties.find(p=>p.sourced_by===state.profile.id);
     const active=state.db.properties.filter(p=>p.sourced_by===state.profile.id&&!p.archived&&!['sold','not_available'].includes(p.status)).length;
     for(let i=active;i<10;i++)state.db.properties.push({...property,id:'SYNTHETIC-STOCK-'+i,status:'available',archived:false});
   });
   await page.evaluate(()=>loadEmployeeTargetReminder());assert(!(await page.locator('#employeeInventoryReminder').isVisible()));
   await page.evaluate(()=>{const row=CRMPREVIEW.db.properties.find(p=>p.sourced_by===CRMPREVIEW.profile.id&&!p.archived&&!['sold','not_available'].includes(p.status));row.status='sold'});
   await page.evaluate(()=>loadEmployeeTargetReminder());assert(await page.locator('#employeeInventoryReminder').isVisible());
   assert.equal(await page.evaluate(()=>employeeInventoryState.needed),1);
   await page.evaluate(()=>{CRMPREVIEW.failNext='properties';return loadEmployeeTargetReminder()});assert((await page.locator('#employeeInventoryReminder').innerText()).includes('تعذر'));
   await page.evaluate(rows=>{CRMPREVIEW.db.properties.splice(0,CRMPREVIEW.db.properties.length,...rows)},original);
   await page.evaluate(()=>loadEmployeeTargetReminder());
   report.checks.push(role+': shortage reminder visible outside details, hidden at 10, restored at 9, load failure does not invent a shortage');
  }

  for(const screen of ['dashboard','properties','clients']){
   await page.evaluate(s=>navigate(s==='dashboard'?'dash':s,null),screen);await page.waitForTimeout(900);
   if(mode==='after'){const generated=await page.locator('#page-'+(screen==='dashboard'?'dash':screen)).innerText();assert(!/[\u0660-\u0669\u06f0-\u06f9]/.test(generated));}
   const name=mode+'-'+role+'-'+screen+'-desktop.png';await page.screenshot({path:path.join(out,name),fullPage:true});report.screens.push(name);
   if(mode==='after'){
    if(screen==='dashboard'){assert((await page.locator('#opsDailyWork').innerText()).includes('الزيارات القادمة'));await page.locator('#opsPerformanceDetails summary').click();await page.waitForTimeout(200);assert((await page.locator('#opsDashboardPerformanceResults').innerText()).includes('محدد 1 من 5'));await page.locator('#opsPerformanceDetails [data-period="all"]').click();await page.waitForTimeout(200);assert((await page.locator('#opsDashboardPerformanceResults').innerText()).includes('إجمالي تاريخي'));await page.screenshot({path:path.join(out,'after-'+role+'-performance-lifetime.png'),fullPage:true});await page.locator('#opsPerformanceDetails [data-period="month"]').click();await page.locator('#opsPerformanceDetails summary').click();}
    if(screen==='properties'){
     const text=await page.locator('#propertiesList').innerText();
     if(role==='muscat')assert(!text.includes('الصومحان'));if(role==='barka')assert(!text.includes('الخوض'));
     await page.locator('#opsPropertySearch').fill('لا يوجد هذا العقار');await page.waitForTimeout(200);
     assert.equal(await page.locator('[data-work-action="property"]').count(),0);
     await page.locator('#opsPropertySearch').fill('');
    }
    if(screen==='clients'){
     const text=await page.locator('#clientsList').innerText();
     if(role!=='barka'){assert(text.includes('عميلة بطلبين مستقلين'));assert(text.includes('الموالح'));assert(text.includes('المعبيلة'));}
     if(role==='muscat')assert(!text.includes('عميل متابعة بركاء'));if(role==='barka')assert(!text.includes('عميل مسقط التجريبي'));
    }
   }
    await page.setViewportSize({width:390,height:844});
    const mobile=mode+'-'+role+'-'+screen+'-mobile.png';await page.screenshot({path:path.join(out,mobile),fullPage:true});report.screens.push(mobile);
    await page.setViewportSize({width:1440,height:1000});
  }
  if(mode==='after'){
   // Download from the rendered property details, with synthetic repeated/cancelled visits.
   if(role==='owner'){
    await page.evaluate(()=>viewProperty(window.CRMPREVIEW.db.properties[0].id));await page.waitForTimeout(600);
    const downloadPromise=page.waitForEvent('download');
    await page.evaluate(()=>exportPropertyOwnerReport());
    const download=await downloadPromise;await download.saveAs(path.join(out,'owner-synthetic-report.csv'));
    const csv=fs.readFileSync(path.join(out,'owner-synthetic-report.csv'),'utf8');
    assert(csv.includes('زيارات ألغيت'));const records=csv.split('\n').map(line=>line.replace(/"/g,'').split(','));const numberFor=label=>Number(records.find(r=>r[0]===label)?.[1]);assert.equal(numberFor('عملاء لديهم استفسار وارد مثبت'),1);assert.equal(numberFor('زيارات تمت'),2);assert.equal(numberFor('زيارات ألغيت'),1);report.checks.push('CSV downloaded through Chromium; synthetic property report');
   }
   await page.evaluate(()=>document.querySelectorAll('.modal-ov.on').forEach(modal=>closeModal(modal.id)));
   await verifyPropertyActions(page,role,report);
   await verifyVisitWorkflow(page,role,report);
   await verifyDealWorkflow(page,role,report);
   
   await page.evaluate(()=>navigate('clients',null));await page.waitForTimeout(500);
   const requestButton=page.locator('#clientsList [data-work-action="request"]').first();
   const chosen=await requestButton.getAttribute('data-request-id');
   await requestButton.click();await page.locator('#mClientRequest.on').waitFor();
   assert.equal(await page.evaluate(()=>editingClientRequest.id),chosen);
   const unchanged=await page.evaluate(()=>JSON.stringify(CRMPREVIEW.db.client_requests));
   await page.locator('#nrBudgetMin').fill('900000');await page.locator('#nrBudgetMax').fill('1');
   await page.locator('#mClientRequest button').filter({hasText:'حفظ الطلب'}).click();await page.waitForTimeout(200);
   assert.equal(await page.evaluate(()=>JSON.stringify(CRMPREVIEW.db.client_requests)),unchanged);
   assert(await page.locator('#mClientRequest').evaluate(e=>e.classList.contains('on')));
   await page.locator('#nrBudgetMin').fill('100');await page.locator('#nrBudgetMax').fill('200');
   await page.locator('#nrNextAction').fill('إجراء اختبار مستقل');
   await page.evaluate(()=>CRMPREVIEW.failNext='client_requests');
   await page.locator('#mClientRequest button').filter({hasText:'حفظ الطلب'}).click();await page.waitForTimeout(200);
   assert.equal(await page.evaluate(()=>JSON.stringify(CRMPREVIEW.db.client_requests)),unchanged);
   await page.screenshot({path:path.join(out,'after-'+role+'-save-failure.png'),fullPage:true});
   await page.locator('#mClientRequest button').filter({hasText:'حفظ الطلب'}).click();await page.waitForTimeout(500);
   const changed=await page.evaluate(id=>CRMPREVIEW.db.client_requests.find(r=>r.id===id),chosen);
   assert.equal(changed.next_action,'إجراء اختبار مستقل');
   const originals=JSON.parse(unchanged),latest=await page.evaluate(()=>CRMPREVIEW.db.client_requests);
   assert.equal(latest.length,originals.length);assert.deepEqual(latest.filter(r=>r.id!==chosen),originals.filter(r=>r.id!==chosen));
   report.checks.push(role+': real click opens correct independent request; invalid budget and injected save failure preserve data; successful in-memory edit preserves other request');
   await page.evaluate(()=>navigate('properties',null));await page.waitForTimeout(400);
   await page.evaluate(()=>{CRMPREVIEW.failNext='properties';return loadProperties()});assert((await page.locator('#propertiesList').innerText()).includes('تعذر'));
   await page.screenshot({path:path.join(out,'after-'+role+'-load-failure.png'),fullPage:true});
   await page.evaluate(()=>loadProperties());

   const blocked=await page.evaluate(async()=>({status:(await fetch('/after/'+window.CRMPREVIEW.actor+'/api/send',{method:'POST'})).status,send:await supa.functions.invoke('whatsapp-send',{body:{}})}));
   assert.equal(blocked.status,405);assert(blocked.send.error);report.checks.push(role+': server POST and fixture external sending denied');
   await page.evaluate(()=>logout());await page.waitForTimeout(500);assert.equal(await page.locator('#clientsList').innerText(),'');assert.equal(await page.locator('#propertiesList').innerText(),'');report.checks.push(role+': logout reload clears UI');await page.locator('#previewRestart').click();await page.waitForFunction(()=>typeof currentProfile!=='undefined'&&currentProfile);await page.reload();await page.waitForFunction(()=>typeof currentProfile!=='undefined'&&currentProfile);assert.equal(await page.evaluate(()=>currentProfile.role),role==='owner'?'owner':'agent');report.checks.push(role+': synthetic session restart and reload');
  }
  report.errors.push({mode,role,errors});await context.close();
 }
 assert.equal(report.errors.flatMap(x=>x.errors).length,0);
 fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify(report,null,2));
 
 const pairs=['owner','muscat','barka'].flatMap(role=>['dashboard','properties','clients'].map(screen=>'<section><h2>'+role+' · '+screen+'</h2><div class="pair"><figure><figcaption>قبل</figcaption><img src="before-'+role+'-'+screen+'-desktop.png"></figure><figure><figcaption>بعد</figcaption><img src="after-'+role+'-'+screen+'-desktop.png"></figure></div><details><summary>بعد — محاكاة مقاس الهاتف</summary><img src="after-'+role+'-'+screen+'-mobile.png"></details></section>'));
 fs.writeFileSync(path.join(out,'index.html'),'<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>معاينة CRM</title><style>body{background:#eef3f2;color:#18372f;font:16px Arial;margin:24px}section{background:white;padding:20px;border-radius:16px;margin:24px 0}.pair{display:grid;grid-template-columns:1fr 1fr;gap:18px}figure{margin:0}img{width:100%;height:auto;border:1px solid #dde8e2}figcaption{padding:12px}details img{max-width:390px}@media(max-width:800px){.pair{grid-template-columns:1fr}}</style><h1>صور فعلية للمعاينة الاصطناعية — 2026-10-01</h1><p>التقطها Chromium. ليست جلسات الموظفين الفعلية ولا إثباتاً لصلاحيات الخادم. فتح هذا الملف محلياً لا يتصل بالإنتاج. الهاتف محاكاة مقاس شاشة.</p>'+pairs.join('')+'</html>');

 console.log(JSON.stringify(report,null,2));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
