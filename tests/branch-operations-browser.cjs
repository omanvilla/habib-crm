'use strict';
// All records, accounts and writes below are synthetic. The server has no live
// API and the browser blocks every external request. SQL/Auth evidence is separate.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const server=require('../preview/serve.cjs'),out=path.resolve('preview-results/branch-operations');fs.mkdirSync(out,{recursive:true});
const report={synthetic:true,productionWrites:0,externalRequests:[],errors:[],roles:[]};
const defaults={inventory_target:10,weekly_new_properties_target:2,daily_followups_target:10,weekly_viewings_target:5,reservations_target:2,booking_commission_target:4000};
(async()=>{
 await new Promise(resolve=>server.listen(4200,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true});
 try{
  for(const role of ['owner','barka']){
   const context=await browser.newContext({viewport:{width:1440,height:1050},timezoneId:'America/Los_Angeles'}),page=await context.newPage(),checks=[];
   await context.route('**/*',route=>{if(new URL(route.request().url()).hostname==='127.0.0.1')return route.continue();report.externalRequests.push(new URL(route.request().url()).origin);return route.abort();});
   page.on('pageerror',error=>report.errors.push(role+': '+error.message));await page.clock.install({time:new Date('2026-10-20T08:00:00Z')});
   await page.goto('http://127.0.0.1:4200/after/'+role+'/');await page.locator('#opsEmployeeTargets .ops-person').first().waitFor();await page.locator('#instantLoader').waitFor({state:'hidden'});
   if(role==='owner'){
    const before=await page.evaluate(defaults=>{
     const db=CRMPREVIEW.db,muscat=db.company_lead_routes.find(r=>r.route_key==='muscat'),barka=db.company_lead_routes.find(r=>r.route_key==='barka'),old=db.profiles.find(p=>p.id===muscat.assigned_to);
     old.full_name='هديل الاصطناعية';old.is_active=false;muscat.assigned_to=currentUser.id;muscat.whatsapp_number='+96800001001';muscat.meta_phone_number_id='SYNTHETIC_MUSCAT_PHONE';
     db.profiles.find(p=>p.id===barka.assigned_to).full_name='مرام الاصطناعية';db.profiles.push({id:'00000000-0000-4000-8000-000000060001',company_id:currentProfile.company_id,full_name:'حساب بركاء الثاني الاصطناعي',email:'second@example.invalid',role:'agent',is_active:true});
     db.company_lead_routes.push({id:'00000000-0000-4000-8000-000000060002',company_id:currentProfile.company_id,route_key:'investment',assigned_to:currentUser.id,is_active:true,owner_only_inbox:true,transport_route_key:'muscat',whatsapp_number:null,meta_phone_number_id:null},{id:'00000000-0000-4000-8000-000000060003',company_id:currentProfile.company_id,route_key:'general',assigned_to:null,is_active:false,whatsapp_number:null});
     db.employee_monthly_targets=[{id:'TEST_HISTORICAL_GOAL',employee_id:old.id,month_start:'2026-09-01',...defaults}];
     db.branch_monthly_targets=[{company_id:currentProfile.company_id,branch_key:'barka',month_start:'2026-10-01',updated_at:'2026-10-19T08:00:00Z',...defaults,inventory_target:12}];
     const property=db.properties.find(p=>p.branch_key==='muscat'&&p.status==='available');window.branchHistoryBefore=JSON.stringify([db.clients,db.deals,db.employee_monthly_targets]);
     navigate('dash',null);return {source:old.id,property:property.id,addedBy:property.added_by};
    },defaults);
    await page.waitForFunction(()=>document.querySelector('[data-target-branch-card="barka"] [data-target-property="inventory"] strong')?.textContent.endsWith('/ 12'));
    assert.deepEqual(await page.locator('#opsEmployeeTargets .ops-person-title strong').allTextContents(),['بركاء','مسقط']);assert.equal(await page.locator('#opsEmployeeTargets .ops-person').count(),2);
    assert.doesNotMatch(await page.locator('#opsEmployeeTargets').innerText(),/هديل|مرام|حساب بركاء الثاني/);checks.push('both branch goals remain present after former Muscat account deactivation and a second active Barka account; no duplicate cards');
    await page.evaluate(()=>navigate('team',null));await page.locator('[data-branch-target-form="muscat"]').waitFor();await page.locator('#employeePerformanceResults [data-performance-branch="muscat"]').waitFor();
    assert.equal(await page.locator('#teamAccountManagement').getAttribute('open'),null);assert.doesNotMatch(await page.locator('#page-team').innerText(),/هديل|مرام|حساب بركاء الثاني/);
    assert.equal(await page.locator('#teamList .team-stats').count(),0);checks.push('branch goals and performance lead the Team page; account administration is collapsed and no person cards imitate branch totals');
    await page.locator('#etDaily_barka').fill('13');await page.evaluate(()=>CRMPREVIEW.failNext='crm_save_branch_monthly_targets');await page.locator('[data-branch-goal-save="barka"]').click();
    await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('تعذر حفظ الأهداف'));assert.equal(await page.locator('#etDaily_barka').inputValue(),'13');
    await page.locator('[data-branch-goal-save="barka"]').click();await page.waitForFunction(()=>CRMPREVIEW.db.branch_monthly_targets.some(r=>r.branch_key==='barka'&&r.daily_followups_target===13));await page.waitForFunction(()=>document.querySelector('#etDaily_barka').value==='13');
    await page.evaluate(()=>{const row=CRMPREVIEW.db.branch_monthly_targets.find(r=>r.branch_key==='barka');row.daily_followups_target=21;row.updated_at='2026-10-20T08:00:01Z';});
    await page.locator('#etDaily_barka').fill('17');await page.locator('[data-branch-goal-save="barka"]').click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('تغيّرت أهداف الفرع'));
    assert.equal(await page.locator('#etDaily_barka').inputValue(),'17');assert.equal(await page.evaluate(()=>CRMPREVIEW.db.branch_monthly_targets.find(r=>r.branch_key==='barka').daily_followups_target),21);
    await page.locator('#employeeTargetsPanel button').filter({hasText:'تحديث الأهداف'}).click();await page.waitForFunction(()=>document.querySelector('#etDaily_barka').value==='21');
    checks.push('target transport failure retains input; acknowledged branch save persists; a stale edit is refused and explicit reload restores the newer value');
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.screenshot({path:path.join(out,'owner-branches-mobile.png'),fullPage:true,animations:'disabled'});await page.setViewportSize({width:1440,height:1050});
    await page.evaluate(async()=>{navigate('settings',null);await loadLeadRouting();});await page.locator('[data-lead-route="investment"]').waitFor();
    const investment=page.locator('[data-lead-route="investment"]');assert.equal(await investment.locator('button').count(),0);assert.equal(await page.locator('#routePhone_investment').inputValue(),'+96800001001');assert(await page.locator('#routePhone_investment').isDisabled());assert(await page.locator('#routeAgent_investment').isDisabled());
    await page.evaluate(()=>launchWhatsAppEmbeddedSignup('investment'));assert.match(await page.locator('#toast').innerText(),/رقم مسقط/);await page.evaluate(()=>saveLeadRouting());await page.waitForFunction(()=>!crmSavingForms.has('leadRoutingRows'));
    assert.equal(await page.evaluate(()=>CRMPREVIEW.db.company_lead_routes.find(r=>r.route_key==='general').is_active),false);
    assert.deepEqual(await page.evaluate(()=>{const r=CRMPREVIEW.db.company_lead_routes.find(r=>r.route_key==='investment');return [r.transport_route_key,r.whatsapp_number,r.owner_only_inbox];}),['muscat',null,true]);
    await page.evaluate(async()=>{CRMPREVIEW.db.company_lead_routes.find(r=>r.route_key==='general').is_active=true;await loadLeadRouting();await saveLeadRouting();});assert.equal(await page.evaluate(()=>CRMPREVIEW.db.company_lead_routes.find(r=>r.route_key==='general').is_active),true);
    checks.push('investment reception displays Muscat number read-only without Meta onboarding; saves preserve disabled and enabled general-route states and the private transport alias');
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.screenshot({path:path.join(out,'owner-routing-mobile.png'),fullPage:true,animations:'disabled'});await page.setViewportSize({width:1440,height:1050});
    await page.evaluate(async id=>{navigate('properties',null);await loadProperties();editProperty(id);},before.property);await page.locator('#mProperty.on').waitFor();
    await page.waitForFunction(id=>document.querySelector('#pSourcedBy').dataset.ready==='true'&&document.querySelector('#pSourcedBy').value===id,before.source);assert.match(await page.locator('#pSourcedBy option:checked').innerText(),/سجل سابق/);
    await page.locator('#pDesc').fill('تعديل ملاحظة مع الحفاظ على مصدر الإضافة — اختبار اصطناعي');await page.locator('#mProperty .modal-foot button').filter({hasText:'حفظ'}).click();await page.locator('#mProperty.on').waitFor({state:'hidden'});
    assert.deepEqual(await page.evaluate(id=>{const p=CRMPREVIEW.db.properties.find(p=>p.id===id);return [p.sourced_by,p.added_by];},before.property),[before.source,before.addedBy]);
    assert(await page.evaluate(()=>branchHistoryBefore===JSON.stringify([CRMPREVIEW.db.clients,CRMPREVIEW.db.deals,CRMPREVIEW.db.employee_monthly_targets])));checks.push('unrelated property edit preserves inactive original source and creator; client/deal/historical-target records remain unchanged');
   }else{
    assert.equal(await page.locator('#userName').innerText(),'بركاء');assert.equal(await page.locator('#welcomeName').innerText(),'بركاء');assert.deepEqual(await page.locator('#opsEmployeeTargets .ops-person-title strong').allTextContents(),['بركاء']);
    await page.locator('#opsPerformanceDetails > summary').click();await page.locator('#opsDashboardPerformanceResults [data-performance-branch="barka"]').waitFor();assert.equal(await page.locator('[data-performance-branch="muscat"]').count(),0);
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.screenshot({path:path.join(out,'barka-branch-mobile.png'),fullPage:true,animations:'disabled'});checks.push('Barka account keeps its login identity internally while sidebar, goals and performance use only its branch on390px');
    await page.evaluate(async()=>{CRMPREVIEW.db.profiles.find(p=>p.id===currentUser.id).is_active=false;lastActiveProfileCheck=0;await crmRevalidateActiveProfile();});
    await page.locator('#authScreen').waitFor({state:'visible'});
    assert.deepEqual(await page.evaluate(()=>({user:currentUser?.id||null,targets:document.getElementById('opsEmployeeTargets')?.textContent||'',performance:document.getElementById('opsDashboardPerformanceResults')?.textContent||''})),{user:null,targets:'',performance:''});
    checks.push('a synthetic deactivation observed on the active session clears cached targets/performance and returns to sign-in');
   }
   report.roles.push({role,checks});await context.close();
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);report.checkCount=report.roles.reduce((sum,row)=>sum+row.checks.length,0);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);server.close();process.exitCode=1});
