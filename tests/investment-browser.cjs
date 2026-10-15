'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const server=require('../preview/serve.cjs'),out=path.resolve('preview-results/investment');fs.mkdirSync(out,{recursive:true});
(async()=>{
 await new Promise(r=>server.listen(4185,'127.0.0.1',r));const browser=await chromium.launch({headless:true});
 const report={synthetic:true,realEmployeeSessions:false,securityEvidence:'UI fixture scope only; isolated PostgreSQL tests verify database authorization',checks:[],errors:[]};
 try{
 for(const role of ['owner','muscat','barka','manager','viewer']){
  console.log('Investment synthetic browser:',role);
  const context=await browser.newContext({viewport:{width:1400,height:1000}}),page=await context.newPage();
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  page.on('pageerror',e=>report.errors.push(role+': '+e.message));
  await page.goto('http://127.0.0.1:4185/after/'+role+'/');await page.waitForFunction(()=>typeof currentProfile!=='undefined'&&currentProfile&&typeof window.crmRenderClientWorkList==='function');
  await page.evaluate(()=>navigate('clients',null));await page.waitForFunction(()=>document.querySelector('#clientsList .ops-client'));
  const privateName='المستثمر الخاص الاصطناعي';
  if(role==='owner'){
   assert((await page.locator('#clientsList').innerText()).includes(privateName));assert.equal(await page.locator('[data-client-branch="investment"]').count(),1);
   await page.locator('[data-client-branch="investment"]').click();assert(!(await page.locator('#clientsList').innerText()).includes('عميل مسقط التجريبي'));assert((await page.locator('#clientsList').innerText()).includes('خاص بالمالك'));await page.locator('[data-client-branch="all"]').click();
   const originalBranch=await page.evaluate(()=>JSON.stringify(CRMPREVIEW.db.clients.filter(c=>['muscat','barka'].includes(c.lead_route))));
   await page.evaluate(()=>openCreateModal('mClient'));await page.locator('#mClient.on').waitFor();await page.locator('#cName').fill('المستثمر الجديد الاصطناعي');await page.locator('#cPhoneLocal').fill('٩٠٠٠٠٩٩٠');await page.locator('#cRoleInvestor').check();
   assert(await page.locator('#cInvestmentNotice').isVisible());assert.match(await page.locator('#cInvestmentNotice').innerText(),/المسار: المستثمرين.*خاص بالمالك/);assert(await page.locator('#cAssignedTo').isDisabled());
   await page.locator('#mClient .modal-foot button').filter({hasText:'حفظ'}).click();try{await page.waitForFunction(()=>CRMPREVIEW.db.clients.some(c=>c.phone==='+96890000990'),null,{timeout:5000});}catch(e){console.log(await page.evaluate(()=>({toast:document.querySelector('#toast').textContent,phone:document.querySelector('#cPhoneLocal').value,country:document.querySelector('#cPhoneCountry').value,roles:[document.querySelector('#cRoleInvestor').checked,document.querySelector('#cRoleBuyer').checked],added:CRMPREVIEW.db.clients.slice(-2),calls:CRMPREVIEW.calls.slice(-6)})));throw e;}
   const investor=await page.evaluate(()=>CRMPREVIEW.db.clients.find(c=>c.phone==='+96890000990'));assert.equal(investor.lead_route,'investment');assert.equal(investor.client_type,'investor');assert.equal(investor.assigned_to,await page.evaluate(()=>currentUser.id));
   await page.evaluate(id=>viewClient(id),investor.id);await page.evaluate(()=>client360SwitchTab('requests'));await page.locator('#cdTabRequests [onclick="openNewRequestForClient()"]').click();await page.locator('#mClientRequest.on').waitFor();
   assert.equal(await page.locator('#nrType').inputValue(),'investor');assert.equal(await page.locator('#nrBranch').inputValue(),'investment');assert(await page.locator('#nrBranch').isDisabled());
   // An unknown budget/area/next action is valid for gradual investor qualification.
   await page.locator('#mClientRequest button').filter({hasText:'حفظ الطلب'}).click();await page.waitForFunction(id=>CRMPREVIEW.db.client_requests.some(r=>r.client_id===id),investor.id);
   const request=await page.evaluate(id=>CRMPREVIEW.db.client_requests.find(r=>r.client_id===id),investor.id);assert.equal(request.route_key,'investment');assert.equal(request.branch_key,'investment');assert.equal(request.request_type,'investor');
   await page.evaluate(id=>editClientRequest(id),request.id);await page.locator('#mClientRequest.on').waitFor();
   await page.locator('#nrAreas').fill('بركاء، مسقط');await page.locator('#nrBudgetMax').fill('١٥٠٠٠٠');await page.locator('#nrFinanceReadiness').selectOption('cash_confirmed');await page.locator('#nrDecisionMaker').selectOption('joint_family');await page.locator('#nrSearchStatus').selectOption('no_response');await page.locator('#nrNextAction').fill('متابعة المستثمر عندما يعود');
   await page.locator('#mClientRequest details summary').click();await page.locator('#nrMilestone_first_human_response_at').fill('2026-10-12T10:30');await page.locator('#nrMilestone_first_mutual_dialogue_at').fill('2026-10-12T11:00');
   await page.setViewportSize({width:390,height:844});assert.equal(await page.locator('#mClientRequest .modal-box').evaluate(e=>e.scrollWidth>e.clientWidth+2),false);await page.screenshot({path:path.join(out,'owner-investor-request-mobile.png'),fullPage:true});await page.setViewportSize({width:1400,height:1000});
   await page.locator('#mClientRequest button').filter({hasText:'حفظ الطلب'}).click();await page.waitForFunction(id=>CRMPREVIEW.db.client_requests.find(r=>r.id===id)?.next_action==='متابعة المستثمر عندما يعود',request.id);
   const saved=await page.evaluate(id=>CRMPREVIEW.db.client_requests.find(r=>r.id===id),request.id);assert.equal(saved.status,'active');assert.equal(saved.search_status,'no_response');assert.equal(saved.route_key,'investment');assert.equal(saved.budget_max,150000);assert.equal(saved.first_human_response_at,'2026-10-12T06:30:00.000Z');assert.equal(saved.first_mutual_dialogue_at,'2026-10-12T07:00:00.000Z');assert(!saved.qualified_at);assert.equal(saved.created_at,request.created_at);
   await page.evaluate(()=>client360SwitchTab('info'));await page.waitForFunction(()=>document.querySelector('#cdTabInfo').textContent.includes('السيولة مؤكدة'));assert.match(await page.locator('#cdTabInfo').innerText(),/خاص بالمالك/);
   await page.locator('#cdTabInfo details summary').click();assert.match(await page.locator('#cdTabInfo').innerText(),/غير موثق/);await page.screenshot({path:path.join(out,'owner-investor-detail.png'),fullPage:true});
   const count=await page.evaluate(()=>CRMPREVIEW.db.clients.length);
   await page.evaluate(()=>openCreateModal('mClient'));await page.locator('#cName').fill('اسم جديد لعميل قديم');await page.locator('#cPhoneLocal').fill('+96800000003');await page.evaluate(()=>checkDuplicatePhone());await page.locator('#cRoleInvestor').check();await page.locator('#mClient .modal-foot button').filter({hasText:'حفظ'}).click();await page.waitForFunction(()=>viewingClient?.phone==='+96800000003');assert.equal(await page.evaluate(()=>CRMPREVIEW.db.clients.length),count);assert.equal(await page.evaluate(()=>JSON.stringify(CRMPREVIEW.db.clients.filter(c=>['muscat','barka'].includes(c.lead_route)))),originalBranch);
   report.checks.push('Owner: canonical investor client/create and request/create/edit, optional qualification, actual Oman timestamps, mobile width, no-response preserved as active, duplicate reused without branch mutation, investment filter and privacy labels.');
  }else{
   assert(!(await page.locator('#clientsList').innerText()).includes(privateName));assert.equal(await page.locator('[data-client-branch="investment"]').count(),0);
   await page.evaluate(()=>loadViewingChoices('client',false));assert(!(await page.locator('#vClient').innerText()).includes(privateName));
   if(role!=='viewer'){
    await page.evaluate(()=>openCreateModal('mClient'));await page.locator('#cRoleInvestor').check();assert.equal(await page.locator('#cInvestmentNotice').isVisible(),false);await page.locator('#mClient .modal-foot button').filter({hasText:'إلغاء'}).click();
    const existing=await page.evaluate(()=>allClients[0].id);await page.evaluate(id=>viewClient(id),existing);await page.evaluate(()=>openNewRequestForClient());await page.locator('#mClientRequest.on').waitFor();assert.equal(await page.locator('#nrBranch option[value="investment"]').count(),0);await page.locator('#mClientRequest button').filter({hasText:'إلغاء'}).click();
   }
   report.checks.push(role+': scoped synthetic client list and full visit selector omit investment; private route/filter unavailable; existing branch investor classification retained where editable.');
  }
  await context.close();
 }
 assert.deepEqual(report.errors,[]);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
