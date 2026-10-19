'use strict';
// UI/SDK contract checks using isolated synthetic records. Real SQL predicates,
// Auth and RLS are verified separately; this server cannot write to production.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const server=require('../preview/serve.cjs'),out=path.resolve('preview-results/inventory-targets');
fs.mkdirSync(out,{recursive:true});
const report={synthetic:true,realEmployeeSessions:false,productionWrites:0,externalRequests:[],errors:[],roles:[]};
const employee={muscat:'00000000-0000-4000-8000-000000000003',barka:'00000000-0000-4000-8000-000000000004'};
async function waitStock(page,branch,stock,goal=10){
 await page.waitForFunction(({id,value})=>document.querySelector('[data-target-employee="'+id+'"][data-target-property="inventory"] strong')?.textContent===value,{id:employee[branch],value:stock+' / '+goal});
}
async function openTarget(page,branch,kind,count){
 await page.locator('[data-target-employee="'+employee[branch]+'"][data-target-property="'+kind+'"]').click();
 await page.locator('#opsPropertyTargetScope').waitFor();
 await page.waitForFunction(count=>document.querySelector('#propertiesSub').textContent===count+' عقار مطابق · من '+count+' في نطاق الهدف',count);
 assert.equal(await page.locator('#propertiesList .ops-property').count(),count);
}
(async()=>{
 await new Promise(r=>server.listen(4195,'127.0.0.1',r));const browser=await chromium.launch({headless:true});
 try{
  for(const role of ['owner','barka','muscat']){
   const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'America/Los_Angeles'}),page=await context.newPage(),checks=[];
   await context.route('**/*',route=>{if(new URL(route.request().url()).hostname==='127.0.0.1')return route.continue();report.externalRequests.push(new URL(route.request().url()).origin);return route.abort();});
   page.on('pageerror',e=>report.errors.push(role+': '+e.message));page.on('dialog',dialog=>dialog.accept());
   await page.clock.install({time:new Date('2026-10-19T08:00:00Z')});
   await page.goto('http://127.0.0.1:4195/after/'+role+'/');await page.locator('#opsEmployeeTargets .ops-person').first().waitFor();await page.locator('#instantLoader').waitFor({state:'hidden'});
   await page.evaluate(()=>{
    const db=CRMPREVIEW.db,uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),templates=Object.fromEntries(['muscat','barka'].map(b=>[b,{...db.properties.find(p=>p.branch_key===b)}]));
    const make=(branch,n,extra={})=>({...templates[branch],id:uuid(n),property_code:'TEST-INV-'+n,title:'عقار اصطناعي '+branch+' '+n,area:n%2?'منطقة اصطناعية أ':'منطقة اصطناعية ب',status:'available',created_at:'2020-01-15T08:00:00Z',availability_checked_at:null,...extra});
    const rows=[];for(const [branch,count,start] of [['muscat',4,10000],['barka',15,10100]])for(let i=0;i<count;i++)rows.push(make(branch,start+i,{price:i===0?0:65000}));
    rows.push(make('barka',10200,{status:'reserved'}),make('muscat',10201,{status:'sold'}),make('barka',10202,{archived:true}),make('barka',10203,{title:'PRIVATE PROPERTY EXCLUDED',created_at:'2026-10-18T08:00:00Z'}));
    db.properties.splice(0,db.properties.length,...rows);
    db.client_requests.push({...db.client_requests.find(r=>r.route_key==='investment'),id:uuid(10300),subject_property_id:uuid(10203)});
    window.inventoryAddWeek=()=>{
     for(const [branch,start] of [['muscat',10400],['barka',10500]])db.properties.push(make(branch,start,{created_at:'2026-10-18T08:00:00Z'}),make(branch,start+1,{status:'sold',created_at:'2026-10-17T20:00:00Z'}),make(branch,start+2,{status:'reserved',created_at:'2026-10-17T19:59:59Z'}),make(branch,start+3,{status:'reserved',created_at:'2026-10-20T08:00:00Z'}),make(branch,start+4,{status:'reserved',price:0,created_at:'2026-10-18T08:00:00Z'}));
    };
    CRMPREVIEW.propertyPageSize=2;
    window.inventoryExports=[];downloadCSV=(name,headers,rows)=>window.inventoryExports.push({name,headers,rows:structuredClone(rows)});
    navigate('dash',null);
   });
   const branches=role==='owner'?['barka','muscat']:[role],branch=branches[0],stock=branch==='barka'?15:4;
   for(const b of branches){await waitStock(page,b,b==='barka'?15:4);assert.equal(await page.locator('[data-target-employee="'+employee[b]+'"][data-target-property="weekly"] strong').innerText(),'0 / 2');}
   assert.equal(await page.locator('#opsEmployeeTargets .ops-person').count(),branches.length);
   assert.match(await page.locator('#opsEmployeeTargets').innerText(),/المخزون المتاح حاليًا/);assert.match(await page.locator('#opsEmployeeTargets').innerText(),/هدفه مستقل عن إضافات الأسبوع/);
   checks.push('old null-timestamp available inventory is15 Barka/4 Muscat while weekly additions are0','inventory includes an available zero-price record and excludes archived/private/reserved/sold records');
   await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.screenshot({path:path.join(out,role+'-targets-mobile.png'),fullPage:true,animations:'disabled'});await page.setViewportSize({width:1440,height:1000});
   await page.evaluate(()=>navigate('properties',null));await page.locator('#propertiesList .ops-property').first().waitFor();
   if(role==='owner')await page.locator('#opsPropertyBranch').selectOption('muscat');
   const area=await page.locator('#opsPropertyArea option').nth(1).getAttribute('value');await page.locator('#opsPropertyArea').selectOption(area);await page.locator('#opsPropertyStatus').selectOption('reserved');await page.locator('#opsPropertySearch').fill('NO-MATCH-STALE');
   await page.evaluate(()=>navigate('dash',null));await waitStock(page,branch,stock);await openTarget(page,branch,'inventory',stock);
   for(const field of ['opsPropertySearch','opsPropertyArea'])assert.equal(await page.locator('#'+field).inputValue(),'');
   assert.equal(await page.locator('#opsPropertyBranch').inputValue(),branch);assert.equal(await page.locator('#opsPropertyStatus').inputValue(),'available');assert.equal(await page.locator('#opsPropertyBranch').isDisabled(),true);
   assert.equal(await page.locator('#page-properties .archive-toggle').isVisible(),false);assert.equal(await page.locator('#page-properties details.ops-secondary').isVisible(),false);assert.doesNotMatch(await page.locator('#propertiesList').innerText(),/PRIVATE PROPERTY EXCLUDED/);
   assert(await page.evaluate(b=>allProperties.every(p=>p.branch_key===b&&!p.archived&&p.status==='available'),branch));
   await page.evaluate(()=>exportProperties());assert.deepEqual(await page.evaluate(()=>inventoryExports.at(-1).rows.map(r=>r[0])),await page.locator('.ops-property > .ops-title').allTextContents());
   checks.push('inventory drilldown clears stale filters and reads every permitted ID across synthetic two-row API pages','inventory CSV contains only the rendered cohort');
   await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.equal(await page.locator('#page-properties .archive-toggle').isVisible(),false);assert.equal(await page.locator('#page-properties details.ops-secondary').isVisible(),false);await page.screenshot({path:path.join(out,role+'-inventory-mobile.png'),fullPage:true,animations:'disabled'});await page.setViewportSize({width:1440,height:1000});
   await page.locator('[data-work-action="clear-property-target"]').click();await page.waitForFunction(()=>!document.querySelector('#opsPropertyTargetScope'));assert.equal(await page.locator('#page-properties .archive-toggle').isVisible(),true);assert.equal(await page.locator('#opsPropertyBranch').isDisabled(),false);assert.equal(await page.locator('#opsPropertyBranch').inputValue(),'');
   await page.evaluate(()=>navigate('dash',null));await waitStock(page,branch,stock);
   const reads=await page.evaluate(()=>CRMPREVIEW.calls.filter(c=>c.table==='properties').length);await openTarget(page,branch,'weekly',0);
   assert.equal(await page.evaluate(()=>CRMPREVIEW.calls.filter(c=>c.table==='properties').length),reads,'known empty IDs need no property read');assert.match(await page.locator('#opsPropertyTargetScope').innerText(),/2026-10-18.*2026-10-24/);
   checks.push('clear scope restores normal controls and unscoped filters','known empty weekly cohort renders0 without an empty IN query','scope shows explicit Oman Sunday–Saturday week and current counted date');
   await page.evaluate(()=>{inventoryAddWeek();navigate('dash',null)});await waitStock(page,branch,stock+1);
   assert.equal(await page.locator('[data-target-employee="'+employee[branch]+'"][data-target-property="weekly"] strong').innerText(),'2 / 2');await openTarget(page,branch,'weekly',2);
   assert.equal(await page.locator('#opsPropertyStatus').inputValue(),'');assert(await page.evaluate(()=>allProperties.some(p=>p.status==='sold')));assert(await page.evaluate(()=>allProperties.some(p=>p.created_at==='2026-10-17T20:00:00Z')));
   await page.evaluate(()=>exportProperties());assert.deepEqual(await page.evaluate(()=>inventoryExports.at(-1).rows.map(r=>r[0])),await page.locator('.ops-property > .ops-title').allTextContents());
   checks.push('weekly2 includes sold and Oman-midnight additions independently of current stock','weekly details exclude prior-week/future/zero-price records and preserve CSV parity','target cards and scoped property list fit390px without horizontal overflow');
   if(role==='owner'){
    // The existing property form must trigger a fresh dashboard and scoped list.
    const editable=await page.evaluate(()=>allProperties.find(p=>p.status==='available').id);await page.evaluate(id=>editProperty(id),editable);await page.locator('#mProperty.on').waitFor();await page.locator('#pStatus').selectOption('reserved');await page.locator('#mProperty .modal-foot button').filter({hasText:'حفظ'}).click();await page.waitForFunction(()=>!document.querySelector('#mProperty').classList.contains('on'));await waitStock(page,'barka',15);
    assert.equal(await page.locator('[data-target-employee="'+employee.barka+'"][data-target-property="weekly"] strong').innerText(),'2 / 2');await page.waitForFunction(()=>allProperties.some(p=>p.status==='reserved'));
    const archive=page.locator('[data-work-action="archive-property"][data-work-id="'+editable+'"]');await archive.click();await page.waitForFunction(()=>document.querySelector('#propertiesSub').textContent==='1 عقار مطابق · من 1 في نطاق الهدف');
    await page.waitForFunction(id=>document.querySelector('[data-target-employee="'+id+'"][data-target-property="weekly"] strong')?.textContent==='1 / 2',employee.barka);
    await page.locator('[data-work-action="clear-property-target"]').click();await page.locator('#page-properties .archive-toggle button').nth(2).click();await page.locator('[data-work-action="restore-property"][data-work-id="'+editable+'"]').waitFor();await page.locator('[data-work-action="restore-property"][data-work-id="'+editable+'"]').click();await page.waitForFunction(id=>document.querySelector('[data-target-employee="'+id+'"][data-target-property="weekly"] strong')?.textContent==='2 / 2',employee.barka);
    checks.push('actual synthetic save/status/archive/restore refresh dashboard and scoped details without page reload');
    await page.evaluate(()=>{const p=CRMPREVIEW.db.profiles.find(x=>x.full_name.includes('بركاء'));CRMPREVIEW.db.employee_monthly_targets=[{id:'SYNTHETIC-GOAL',company_id:p.company_id,employee_id:p.id,month_start:'2026-10-01',inventory_target:12,weekly_new_properties_target:2,daily_followups_target:10,weekly_viewings_target:5,reservations_target:2,booking_commission_target:4000}];navigate('dash',null)});await waitStock(page,'barka',15,12);checks.push('saved inventory goal12 is rendered independently of weekly goal2');
    // Delay an ordinary read; its base renderer must not overwrite newer target rows.
    await page.evaluate(()=>{
     propViewMode='active';showArchivedProperties=false;
     window.inventoryOriginalDataFrom=crmDataFrom;window.inventoryDelayOrdinary=true;
     crmDataFrom=function(name){const q=window.inventoryOriginalDataFrom(name);if(name!=='properties'||!window.inventoryDelayOrdinary)return q;window.inventoryDelayOrdinary=false;const select=q.select;q.select=function(){const chain=select.apply(this,arguments),then=chain.then;chain.then=function(resolve,reject){return new Promise(r=>window.inventoryReleaseOrdinary=r).then(()=>then.call(chain,resolve,reject));};return chain;};return q;};
     window.inventoryOrdinary=loadProperties();
    });
    await page.waitForFunction(()=>typeof window.inventoryReleaseOrdinary==='function');await openTarget(page,'muscat','inventory',5);
    await page.evaluate(()=>{window.inventoryReleaseOrdinary();return window.inventoryOrdinary});assert.equal(await page.locator('.ops-property').count(),5);assert(await page.evaluate(()=>allProperties.every(p=>p.branch_key==='muscat')));assert.doesNotMatch(await page.locator('#propertiesList').innerText(),/PRIVATE PROPERTY EXCLUDED|barka/);await page.evaluate(()=>crmDataFrom=window.inventoryOriginalDataFrom);
    checks.push('late ordinary property response cannot overwrite newer scoped data, DOM, counters or export');
    await page.evaluate(()=>{window.inventoryOriginalRpc=supa.rpc;supa.rpc=async function(name,args){const r=await window.inventoryOriginalRpc.call(this,name,args);if(name==='crm_employee_target_snapshot')for(const x of r.data.employees)delete x.inventory_property_ids;return r;};window.inventoryBeforeMissing=CRMPREVIEW.calls.filter(c=>c.table==='properties').length;return loadProperties()});await page.locator('#propertiesList [role="alert"]').waitFor();assert.equal(await page.evaluate(()=>CRMPREVIEW.calls.filter(c=>c.table==='properties').length),await page.evaluate(()=>window.inventoryBeforeMissing));
    const exported=await page.evaluate(()=>inventoryExports.length);await page.evaluate(()=>exportProperties());assert.equal(await page.evaluate(()=>inventoryExports.length),exported);await page.evaluate(()=>supa.rpc=window.inventoryOriginalRpc);await page.locator('[data-work-action="retry-properties"]').click();await page.waitForFunction(()=>document.querySelectorAll('.ops-property').length===5);
    await page.evaluate(()=>{CRMPREVIEW.failNext='properties';return loadProperties()});await page.locator('#propertiesList [role="alert"]').waitFor();await page.evaluate(()=>exportProperties());assert.equal(await page.evaluate(()=>inventoryExports.length),exported);await page.locator('[data-work-action="retry-properties"]').click();await page.waitForFunction(()=>document.querySelectorAll('.ops-property').length===5);
    checks.push('missing SQL ID contract fails closed without broader property reads','property load failure preserves unavailable state and blocks stale CSV; retry recovers');
    await page.evaluate(()=>{window.inventoryChanged=null;supa.rpc=async function(name,args){const r=await window.inventoryOriginalRpc.call(this,name,args);if(name==='crm_employee_target_snapshot'){window.inventoryChanged=CRMPREVIEW.db.properties.find(p=>p.id===r.data.employees.find(x=>x.branch==='muscat').inventory_property_ids[0]);window.inventoryChanged.archived=true;}return r;};return loadProperties()});await page.locator('#propertiesList [role="alert"]').waitFor();assert.equal(await page.locator('.ops-property').count(),0);await page.evaluate(()=>{window.inventoryChanged.archived=false;supa.rpc=window.inventoryOriginalRpc;return loadProperties()});await page.waitForFunction(()=>document.querySelectorAll('.ops-property').length===5);checks.push('a property archived between snapshot and detail read is rejected instead of shown under current inventory');
    await page.evaluate(()=>{window.inventorySavedResult=null;supa.rpc=async function(name,args){const r=await window.inventoryOriginalRpc.call(this,name,args);if(name==='crm_employee_target_snapshot'){window.inventorySavedResult=r;return new Promise(resolve=>window.inventoryReleaseSession=()=>resolve(r));}return r;};window.inventoryOldSession=loadProperties()});await page.waitForFunction(()=>typeof window.inventoryReleaseSession==='function');await page.evaluate(()=>clearSessionUI());await page.evaluate(()=>{window.inventoryReleaseSession();return window.inventoryOldSession});
    assert.equal(await page.locator('#opsPropertyTargetScope').count(),0);assert.equal(await page.evaluate(()=>allProperties.length),0);await page.evaluate(()=>exportProperties());assert.equal(await page.evaluate(()=>inventoryExports.length),exported);checks.push('session reset clears target scope/IDs and ignores an old-account pending response');
   }else{
    assert.equal(await page.locator('[data-target-employee="'+employee[role==='barka'?'muscat':'barka']+'"]').count(),0);
    assert(await page.evaluate(b=>allProperties.every(p=>p.branch_key===b),role));checks.push('employee fixture exposes only its branch target and protected scoped property rows');
   }
   report.roles.push({role,checks});await context.close();
  }
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);report.passed=true;fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,roles:report.roles.map(r=>({role:r.role,checks:r.checks.length})),checks:report.roles.reduce((n,r)=>n+r.checks.length,0),synthetic:true,externalRequests:0,productionWrites:0}));
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
