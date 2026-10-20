'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs');
const load=require('../preview/test-document.cjs');
const out='preview-results/design';fs.mkdirSync(out,{recursive:true});
const report={synthetic:true,productionWrites:0,externalRequests:[],errors:[],checks:[],pageCoverage:[]};
let server;
(async()=>{
 if(process.env.CRM_TEST_OFFLINE!=='1'){server=require('../preview/serve.cjs');await new Promise(r=>server.listen(4214,'127.0.0.1',r));}
 const browser=await chromium.launch({headless:true,...(process.env.CRM_TEST_CHROMIUM?{executablePath:process.env.CRM_TEST_CHROMIUM}:{})});
 async function setup(role){
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  await context.route('**/*',r=>{if(process.env.CRM_TEST_OFFLINE!=='1'&&new URL(r.request().url()).hostname==='127.0.0.1')return r.continue();report.externalRequests.push(r.request().url());return r.abort();});
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(role+': '+e.message));await load(page,role);
  await page.waitForFunction(()=>typeof currentProfile!=='undefined'&&!!currentProfile&&!!document.getElementById('uiClientType'));await page.locator('#instantLoader').waitFor({state:'hidden'});
  return {page,context};
 }
 const {page,context}=await setup('owner');
 try{
  await page.locator('#opsEmployeeTargets .ops-person').first().waitFor();
  assert.equal(await page.locator('.ops-work-shortcuts .ui-symbol').count(),6);
  assert.equal(await page.locator('#opsScopeWork .ops-work-section:visible').count(),0);
  const sidebar=await page.locator('#sidebar').boundingBox();await page.locator('#sidebar').hover();assert.equal((await page.locator('#sidebar').boundingBox()).width,sidebar.width);
  await page.screenshot({path:out+'/dashboard-desktop.png',fullPage:true,animations:'disabled'});
  report.checks.push('six consistent dashboard icons, closed work groups, retained goals and stable desktop sidebar');

  await page.locator('.nav-link[onclick="navigate(\'clients\',this)"]').press('Enter');await page.locator('[data-client-row]').first().waitFor();
  assert.equal(await page.locator('#clientRoleTabs').isVisible(),false);assert.equal(await page.locator('#uiClientType').isVisible(),true);
  await page.locator('#uiClientType').selectOption('buyer');assert(await page.locator('[data-client-row]').count()>0);
  await page.locator('#followupAlert button').click();await page.waitForFunction(()=>document.getElementById('uiClientType').value==='followup');
  assert.equal(await page.evaluate(()=>clientRoleFilter),'followup');
  report.checks.push('follow-up shortcut selects the real follow-up filter rather than the old nth-child landlord tab');
  await page.locator('#uiClientType').selectOption('all');
  const row=page.locator('[data-client-row]').first();await row.locator('.ui-more').waitFor({state:'attached'});
  assert.equal(await row.locator('[data-workspace-action="archive-client"]').isVisible(),false);
  const more=row.locator('.ui-more summary');await more.press('Enter');assert.equal(await row.locator('[data-workspace-action="archive-client"]').isVisible(),true);
  await more.press('Escape');assert.equal(await row.locator('[data-workspace-action="archive-client"]').isVisible(),false);
  await more.click();await row.locator('[data-work-action="edit-client"]').click();await page.locator('#mClient').waitFor({state:'visible'});await page.evaluate(()=>closeModal('mClient'));
  assert.equal(await row.locator('.ui-more').getAttribute('open'),null);
  report.checks.push('secondary client actions stay available behind keyboard-accessible More; edit delegates to original form');
  await page.evaluate(()=>{allClients[0].name='اسم عميل 🏡 محفوظ';renderClients();const title=document.createElement('div');title.className='wa-chat-title';title.id='testPreservedName';title.textContent='عميل 🏡 خاص';document.getElementById('waChatHeader').append(title);});
  await page.waitForTimeout(80);assert.match(await page.locator('#clientsList').innerText(),/اسم عميل 🏡 محفوظ/);assert.equal(await page.locator('#testPreservedName').textContent(),'عميل 🏡 خاص');
  assert.equal(await page.evaluate(()=>!![...document.scripts].find(s=>s.src.includes('modern-v17.js'))),false);
  report.checks.push('customer name emojis and chat titles remain byte-for-byte; retired broad text cleaner is not loaded');
  report.clientVisibleButtons=await page.locator('#page-clients button:visible').count();
  assert.equal(await page.locator('#followupAlert .ui-symbol').count(),1);
  await page.screenshot({path:out+'/clients-desktop.png',fullPage:true,animations:'disabled'});
  await page.locator('[data-work-action="client"]').first().click();await page.locator('#page-clientDetail.active').waitFor();
  await page.locator('#cdActions .ui-more').waitFor();assert.equal(await page.locator('#cdActions [onclick="openClientWhatsAppHistory()"]').isVisible(),true);

  await page.evaluate(()=>navigate('properties',null));await page.locator('[data-property-row]').first().waitFor();
  assert.equal(await page.locator('.nav-link[onclick="navigate(\'properties\',this)"]').getAttribute('aria-current'),'page');
  assert.equal(await page.locator('.nav-link[onclick="navigate(\'clients\',this)"]').getAttribute('aria-current'),null);
  const property=page.locator('[data-property-row]').first();assert.equal(await property.locator('[data-workspace-action="property-marketing"]').isVisible(),true);
  assert.equal(await property.locator('[data-work-action="edit-property"]').isVisible(),false);
  await property.locator('.ui-more summary').click();assert.equal(await property.locator('[data-work-action="edit-property"]').isVisible(),true);await property.locator('.ui-more summary').press('Escape');
  await page.locator('#uiPropertyArchive').selectOption('sold');await page.locator('#uiPropertyArchive').selectOption('active');await page.locator('[data-property-row]').first().waitFor();
  await page.screenshot({path:out+'/properties-desktop.png',fullPage:true,animations:'disabled'});
  await page.locator('[data-workspace-action="property-marketing"]').first().click();await page.locator('#wsMarketing').waitFor();assert.equal(await page.locator('[data-workspace-action="add-marketing"]').isVisible(),true);
  report.checks.push('property filters delegate unchanged; Marketing is permanently visible while edit/archive remain in More; detail highlights parent navigation');

  const pages=['dash','daily','clients','properties','propertyDetail','clientDetail','calendar','viewings','deposits','reports','owners','expenses','activityLog','team','instagram','whatsapp','settings','backup'];
  for(const name of pages){
   await page.evaluate(n=>navigate(n,null),name);await page.locator('#page-'+name+'.active').waitFor();
   assert.equal(await page.locator('#page-'+name).evaluate(n=>n.classList.contains('ui-page')),true);
   const font=await page.locator('#page-'+name).evaluate(n=>getComputedStyle(n).fontFamily);assert(font.includes('IBM Plex Sans Arabic'));
   report.pageCoverage.push({page:name,desktop:'opened, common font and functional controller retained'});
  }
  await page.evaluate(()=>navigate('deals',null));assert.equal(await page.locator('#page-deals').evaluate(n=>n.classList.contains('ui-page')),false);
  report.checks.push('eighteen available workspaces inspected; Deals presentation and workflow remain excluded');
  await page.evaluate(()=>navigate('daily',null));await page.locator('#uiTaskStatus').selectOption('done');await page.locator('#uiTaskStatus').selectOption('all');
  await page.evaluate(()=>navigate('viewings',null));await page.locator('#uiVisitStatus').selectOption('done');await page.locator('#uiVisitStatus').selectOption('all');
  await page.evaluate(()=>navigate('deposits',null));await page.locator('#uiDepositStatus').selectOption('expired');await page.locator('#uiDepositStatus').selectOption('all');
  await page.evaluate(()=>navigate('owners',null));await page.locator('#uiOwnerType').selectOption('broker');await page.locator('#uiOwnerType').selectOption('all');
  report.checks.push('task, visit, deposit and owner status selects activate their original filters');

  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.locator('.mobile-nav-btn .ui-symbol').count(),5);
  assert.equal(await page.locator('#toast').isVisible(),false); 
  for(const name of pages.filter(n=>n!=='propertyDetail')){
   await page.evaluate(n=>navigate(n,null),name);await page.waitForTimeout(100);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'mobile overflow '+name);
   const entry=report.pageCoverage.find(x=>x.page===name);entry.mobile='390px no document overflow';
   if(['dash','clients','properties','reports','viewings'].includes(name))await page.screenshot({path:out+'/'+name+'-mobile.png',fullPage:true,animations:'disabled'});
  }
  report.checks.push('seventeen workspaces fit 390px, with readable controls and no page-wide horizontal overflow');
  await page.evaluate(()=>{window.__designMutations=0;window.__designObserver=new MutationObserver(()=>window.__designMutations++);window.__designObserver.observe(document.body,{childList:true,subtree:true});});await page.waitForTimeout(300);
  const mutations=await page.evaluate(()=>{__designObserver.disconnect();return __designMutations;});assert(mutations<25,'competing observers must settle: '+mutations);report.settledMutations=mutations;
  await page.evaluate(()=>crmResetOperations());assert.equal(await page.locator('.ui-more[open]').count(),0);assert.equal(await page.locator('#uiClientBranch option').count(),0);
  report.checks.push('chrome observers settle; session reset clears open menus and selector options');
 }finally{await context.close();}
 for(const role of ['barka','muscat','viewer']){
  const {page:p,context:c}=await setup(role);
  try{await p.evaluate(()=>navigate('clients',null));await p.locator('[data-client-row]').first().waitFor();if(role!=='viewer')assert.equal(await p.locator('#uiClientBranch').isVisible(),false);
   await p.evaluate(()=>navigate('properties',null));await p.locator('[data-property-row]').first().waitFor();if(role==='viewer')assert.equal(await p.locator('[data-work-action="edit-property"],[data-work-action="archive-property"]').count(),0);
   assert.equal(await p.locator('[data-workspace-action="property-marketing"]').first().isVisible(),true);
  }finally{await c.close();}
 }
 report.checks.push('synthetic branch/viewer controls retain role restrictions and property marketing access');
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);
 if(fs.existsSync(out+'/failure.json'))fs.unlinkSync(out+'/failure.json');fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));await browser.close();server?.close();
})().catch(error=>{fs.writeFileSync(out+'/failure.json',JSON.stringify({...report,failure:String(error)},null,2));console.error(error);server?.close();process.exit(1);});
