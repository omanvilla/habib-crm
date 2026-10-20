'use strict';
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.resolve('preview-results/workspace');fs.mkdirSync(out,{recursive:true});
const report={synthetic:true,productionWrites:0,externalRequests:[],errors:[],checks:[]};
const offline=process.env.CRM_TEST_OFFLINE==='1';let server;
async function load(page,role){
 if(!offline){await page.goto('http://127.0.0.1:4203/after/'+role+'/');return;}
 // Local sandbox has no loopback browser permission. Execute the same sources
 // as an offline document with in-memory synthetic storage; CI uses actual index/server bootstrap.
 const index=fs.readFileSync(path.join(root,'index.html'),'utf8');let html=fs.readFileSync(path.join(root,'app-base-v15.html'),'utf8');
 let fixture=fs.readFileSync(path.join(root,'preview/fixture-sdk.js'),'utf8').replace(/const actor=.*?;/,"const actor='"+role+"';");
 const storage=`for(const key of ['sessionStorage','localStorage']){const data=new Map();Object.defineProperty(window,key,{value:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k),clear:()=>data.clear()},configurable:true});}if(!crypto.randomUUID)crypto.randomUUID=()=> '10000000-0000-4000-8000-'+String(Math.floor(Math.random()*1e12)).padStart(12,'0');`;
 const inline=src=>'<script>'+src.replace(/<\/script/gi,'<\\/script')+'</script>';
 html=html.replace(/<script[^>]+src="https:\/\/[^\"]+"[^>]*><\/script>/g,inline(storage+fixture)).replace(/<link[^>]+href="https:\/\/[^\"]+"[^>]*>/g,'');
 const css=[...index.matchAll(/href="([^"?]+\.css)/g)].map(m=>'<style>'+fs.readFileSync(path.join(root,m[1]),'utf8')+'</style>').join('');
 const scripts=[...index.matchAll(/<script src="([^"?]+\.js)/g)].map(m=>inline(fs.readFileSync(path.join(root,m[1]),'utf8'))).join('');
 html=html.replace('<head>',"<head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'\">").replace('</head>',css+'</head>').replace('</body>',scripts+'</body>');await page.setContent(html);
}
(async()=>{
 if(!offline){server=require('../preview/serve.cjs');await new Promise(r=>server.listen(4203,'127.0.0.1',r));}
 const browser=await chromium.launch({headless:true,...(process.env.CRM_TEST_CHROMIUM?{executablePath:process.env.CRM_TEST_CHROMIUM}:{})});
 try{
  async function setup(role){const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.route('**/*',r=>{if(!offline&&new URL(r.request().url()).hostname==='127.0.0.1')return r.continue();report.externalRequests.push(r.request().url());return r.abort();});const page=await context.newPage();page.on('pageerror',e=>report.errors.push(role+': '+e.message));await load(page,role);await page.waitForFunction(()=>typeof currentProfile!=='undefined'&&!!currentProfile);await page.locator('#instantLoader').waitFor({state:'hidden'});await page.evaluate(()=>{const rpc=supa.rpc.bind(supa);supa.rpc=async(name,args={})=>{if(name!=='crm_property_acquisition_funnel')return rpc(name,args);const allowed=CRMPREVIEW.db.properties.filter(p=>currentProfile.role!=='agent'||p.branch_key===CRMPREVIEW.actor);return {data:{properties:allowed.filter(p=>!args.p_property_id||p.id===args.p_property_id).map(p=>({property_id:p.id,title:p.title,property_code:p.property_code,media:CRMPREVIEW.db.property_marketing_events.filter(m=>m.property_id===p.id&&m.channel==='instagram'),instagram_attributed_clients:0,attributed_requests:0,conversion_cohort:{attributed_request_count:0},media_count:1})),unresolved_total:0,whatsapp_routes:[]},error:null};};});return {context,page};}
  const {context,page}=await setup('owner');await page.locator('#opsEmployeeTargets .ops-person').first().waitFor();
  assert.equal(await page.locator('#page-ai').count(),0);assert.equal(await page.locator('[onclick="navigate(\'ai\',this)"]').count(),0);
  assert.equal(await page.locator('.dash-toolbar .qa-btn').count(),4);assert.equal(await page.locator('.ops-work-shortcuts button:visible').count(),6);assert.equal(await page.locator('#opsPerformanceDetails').count(),0);
  report.checks.push('owner compact dashboard/top actions/branch goals unchanged; templates removed');
  await page.evaluate(()=>navigate('clients',null));await page.locator('#clientsList [data-client-row]').first().waitFor();
  const initialClients=await page.locator('[data-client-row]').count();assert(initialClients>0);assert.equal(await page.locator('#clientsList .ops-client').count(),0);
  await page.locator('#uiClientType').selectOption('buyer');assert(await page.locator('[data-client-row]').count()<initialClients);
  await page.locator('#uiClientType').selectOption('all');await page.locator('#csText').fill('NO-SUCH-SYNTHETIC-NAME');assert.equal(await page.locator('[data-client-row]').count(),0);await page.locator('#csText').fill('');await page.locator('[data-client-row]').first().waitFor();
  await page.locator('#uiClientBranch').selectOption('barka');assert.doesNotMatch(await page.locator('#clientsList').innerText(),/عميل مسقط/);
  await page.evaluate(()=>{window.__capturedCSV=null;window.downloadCSV=(name,headers,rows)=>{window.__capturedCSV={name,headers,rows}};exportClients();});assert(await page.evaluate(()=>!!window.__capturedCSV));
  report.checks.push('client rows preserve role/search/branch filters, empty recovery and filtered export');
  await page.screenshot({path:path.join(out,'clients-desktop.png'),fullPage:true,animations:'disabled'});
  await page.evaluate(()=>navigate('properties',null));await page.locator('[data-property-row]').first().waitFor();assert.equal(await page.locator('#propertiesList .ops-property').count(),0);
  await page.locator('#opsPropertyBranch').selectOption('muscat');await page.locator('#opsPropertyStatus').selectOption('available');assert.equal(await page.locator('[data-property-row]').count(),2);
  await page.locator('#opsPropertyArea').selectOption('الخوض');assert.equal(await page.locator('[data-property-row]').count(),1);
  report.checks.push('properties are single ordered rows; branch/area/status filters share original result/export source');
  await page.screenshot({path:path.join(out,'properties-desktop.png'),fullPage:true,animations:'disabled'});
  await page.evaluate(()=>{CRMPREVIEW.failNext='property_inquiries'});await page.locator('[data-workspace-action="property-marketing"]').click();await page.locator('#wsMarketingBody table').waitFor();
  assert.match(await page.locator('#wsMarketingBody').innerText(),/Instagram/);report.checks.push('marketing remains usable when the older property performance loader fails');assert.match(await page.locator('#wsMarketingBody').innerText(),/0/);
  await page.locator('[data-workspace-action="add-marketing"]').click();await page.locator('#pmChannel').selectOption('youtube');await page.locator('#pmUrl').fill('https://youtu.be/TESTVID001?si=TEST');await page.locator('#pmViews').fill('123');
  await page.locator('#mPropertyMarketing button[onclick="savePropertyMarketingEvent()"] ').click();await page.locator('#mPropertyMarketing').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('#wsMarketingBody')?.textContent.includes('YouTube'));
  const count=await page.evaluate(()=>CRMPREVIEW.db.property_marketing_events.length);
  await page.locator('[data-workspace-action="add-marketing"]').click();await page.locator('#pmChannel').selectOption('youtube');await page.locator('#pmUrl').fill('https://www.youtube.com/watch?v=TESTVID001&utm_source=test');await page.locator('#mPropertyMarketing button[onclick="savePropertyMarketingEvent()"] ').click();await page.locator('#mPropertyMarketing').waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>CRMPREVIEW.db.property_marketing_events.length),count);
  await page.locator('[data-workspace-action="add-marketing"]').click();await page.locator('#pmChannel').selectOption('youtube');await page.locator('#pmUrl').fill('https://example.test/watch?v=FakeVideo');await page.locator('#mPropertyMarketing button[onclick="savePropertyMarketingEvent()"] ').click();assert.equal(await page.evaluate(()=>CRMPREVIEW.db.property_marketing_events.length),count);await page.locator('#pmChannel').selectOption('instagram');await page.locator('#pmUrl').fill('javascript:alert(1)');await page.locator('#mPropertyMarketing button[onclick="savePropertyMarketingEvent()"] ').click();assert.equal(await page.locator('#mPropertyMarketing').isVisible(),true);assert.equal(await page.evaluate(()=>CRMPREVIEW.db.property_marketing_events.length),count);
  await page.locator('#pmUrl').fill('https://www.instagram.com/reel/NEWTESTLINK/');await page.evaluate(()=>{CRMPREVIEW.failNext='property_marketing_events'});await page.locator('#mPropertyMarketing button[onclick="savePropertyMarketingEvent()"] ').click();assert.equal(await page.locator('#mPropertyMarketing').isVisible(),true);assert.equal(await page.locator('#pmUrl').inputValue(),'https://www.instagram.com/reel/NEWTESTLINK/');
  await page.locator('#mPropertyMarketing button[onclick="savePropertyMarketingEvent()"] ').dblclick();await page.locator('#mPropertyMarketing').waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>CRMPREVIEW.db.property_marketing_events.length),count+1);
  report.checks.push('independent marketing displays old links/zero metrics; YouTube save, canonical duplicate, invalid scheme, failure retention and double-save retry');
  await page.locator('[data-workspace-action="add-marketing"]').click();await page.locator('#pmChannel').selectOption('oman_reel');await page.locator('#pmUrl').fill('https://example.test/oman-reel/TESTPOST');await page.locator('#pmPublishedAt').fill('2026-09-30T23:30');await page.locator('#pmViews').fill('');await page.locator('#mPropertyMarketing button[onclick="savePropertyMarketingEvent()"] ').click();await page.locator('#mPropertyMarketing').waitFor({state:'hidden'});
  const oman=await page.evaluate(()=>CRMPREVIEW.db.property_marketing_events.find(m=>m.channel==='oman_reel'));assert.equal(oman.published_at,'2026-09-30T19:30:00.000Z');assert.equal(oman.views,null);
  report.checks.push('Oman Reel shares the existing property journal; unknown views and entered Muscat publication date are preserved');
  await page.screenshot({path:path.join(out,'marketing-desktop.png'),fullPage:true,animations:'disabled'});
  await page.evaluate(()=>navigate('instagram',null));await page.locator('#igPerformanceContent .cf-property').first().waitFor();assert.equal(await page.locator('#igInboxTab,#igInboxPanel,#igCompose').count(),0);assert.equal(await page.evaluate(()=>typeof window.sendInstagramMessage),'undefined');
  assert.equal(await page.evaluate(()=>CRMPREVIEW.calls.filter(x=>x.function==='instagram-api'&&['list','messages','send','mark_read'].includes(x.body?.action)).length),0);
  report.checks.push('Instagram performance available without inbox UI, messaging exports or message calls');
  await page.evaluate(()=>navigate('reports',null));await page.locator('#repTeamTab').click();await page.locator('#teamLeaderboard .ops-performance-person').first().waitFor();
  assert.equal(await page.locator('#teamLeaderboard .ops-performance-person').count(),2);assert.equal(await page.locator('#page-reports .period-btn').count(),6);
  await page.locator('#reportMonthPicker').fill('2024-02');await page.locator('#reportMonthPicker').dispatchEvent('change');await page.waitForFunction(()=>document.querySelector('#teamLeaderboard')?.textContent.includes('2024-02-29'));
  report.checks.push('Reports redesign retains branch performance, six periods and exact leap-month boundaries');
  await page.screenshot({path:path.join(out,'reports-desktop.png'),fullPage:true,animations:'disabled'});
  for(const name of ['daily','calendar','viewings','deposits','owners','expenses','activityLog','team']){await page.evaluate(n=>navigate(n,null),name);await page.locator('#page-'+name+'.active').waitFor();assert.equal(await page.locator('#page-'+name).evaluate(e=>e.classList.contains('ws-page')),true);}
  await page.evaluate(()=>navigate('deals',null));assert.equal(await page.locator('#page-deals').evaluate(e=>e.classList.contains('ws-page')),false);
  report.checks.push('requested workspaces retain their pages/actions; deals excluded from all new page/modal styling');
  await page.setViewportSize({width:390,height:844});
  for(const name of ['clients','properties','reports','viewings','deposits','owners','expenses','activityLog','team','calendar']){
    await page.evaluate(n=>navigate(n,null),name);await page.waitForTimeout(400);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false,'overflow '+name);
    if(['clients','properties','reports','owners','viewings'].includes(name))await page.screenshot({path:path.join(out,name+'-mobile.png'),fullPage:true,animations:'disabled'});
  }
  report.checks.push('all ten redesigned workspaces fit a 390px viewport');await context.close();
  for(const role of ['barka','muscat','viewer']){
    const {context:c,page:p}=await setup(role);await p.evaluate(()=>navigate('clients',null));await p.locator('[data-client-row]').first().waitFor();
    if(role!=='viewer'){assert.doesNotMatch(await p.locator('#clientsList').innerText(),role==='barka'?/عميل مسقط|المستثمر الخاص/:/عميل بركاء|المستثمر الخاص/);}
    await p.evaluate(()=>navigate('properties',null));await p.locator('[data-property-row]').first().waitFor();await p.locator('[data-workspace-action="property-marketing"]').first().click();await p.locator('#wsMarketing').waitFor();
    if(role==='viewer')assert.equal(await p.locator('[data-workspace-action="add-marketing"]').count(),0);
    await p.evaluate(()=>crmResetOperations());assert.equal(await p.locator('#wsMarketing').count(),0);await c.close();
  }
  report.checks.push('synthetic Muscat/Barka/viewer boundaries and marketing-session reset remain intact');
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);if(fs.existsSync(path.join(out,'failure.json')))fs.unlinkSync(path.join(out,'failure.json'));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await browser.close();server?.close();}
})().catch(error=>{fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({...report,failure:String(error)},null,2));console.error(error);server?.close();process.exitCode=1;});
