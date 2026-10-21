'use strict';
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out='preview-results/marketing';fs.mkdirSync(out,{recursive:true});
const report={synthetic:true,productionWrites:0,externalRequests:[],errors:[],checks:[]};
const offline=process.env.CRM_TEST_OFFLINE==='1';let server;
async function load(page,role){
 if(!offline)return page.goto('http://127.0.0.1:4215/after/'+role+'/');
 let html=fs.readFileSync('app-base-v15.html','utf8'),index=fs.readFileSync('index.html','utf8');
 const inline=s=>'<script>'+s.replace(/<\/script/gi,'<\\/script')+'</script>';
 const storage="for(const key of ['sessionStorage','localStorage']){const m=new Map();Object.defineProperty(window,key,{value:{getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),clear:()=>m.clear()},configurable:true});}if(!crypto.randomUUID)crypto.randomUUID=()=> '10000000-0000-4000-8000-'+String(Math.floor(Math.random()*1e12)).padStart(12,'0');";
 const fixture=fs.readFileSync('preview/fixture-sdk.js','utf8').replace(/const actor=.*?;/,"const actor='"+role+"';");
 html=html.replace(/<script[^>]+src="https:\/\/[^\"]+"[^>]*><\/script>/g,inline(storage+fixture)).replace(/<link[^>]+href="https:\/\/[^\"]+"[^>]*>/g,'');
 html=html.replace('</head>',[...index.matchAll(/href="([^"?]+\.css)/g)].map(m=>'<style>'+fs.readFileSync(m[1],'utf8')+'</style>').join('')+'</head>');
 html=html.replace('</body>',[...index.matchAll(/<script src="([^"?]+\.js)/g)].map(m=>inline(fs.readFileSync(m[1],'utf8'))).join('')+'</body>');
 html=html.replace('<head>',"<head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'\">");
 await page.setContent(html);
}
(async()=>{
 if(!offline){server=require('../preview/serve.cjs');await new Promise(r=>server.listen(4215,'127.0.0.1',r));}
 const browser=await chromium.launch({headless:true,...(process.env.CRM_TEST_CHROMIUM?{executablePath:process.env.CRM_TEST_CHROMIUM}:{})});
 try{
  async function setup(role){const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.route('**/*',r=>{if(!offline&&new URL(r.request().url()).hostname==='127.0.0.1')return r.continue();report.externalRequests.push(r.request().url());return r.abort();});const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await load(page,role);await page.waitForFunction(()=>!!currentProfile);await page.locator('#instantLoader').waitFor({state:'hidden'});await page.evaluate(()=>navigate('properties',null));await page.locator('[data-property-row]').first().waitFor();return {page,context};}
  const {page,context}=await setup('owner');await page.locator('#opsPropertyBranch').selectOption('muscat');await page.locator('#opsPropertyArea').selectOption('الخوض');await page.locator('[data-workspace-action="property-marketing"]').click();await page.locator('#wsMarketingBody table').waitFor();
  const initial=await page.evaluate(()=>JSON.stringify(CRMPREVIEW.db.property_marketing_events));
  const open=async p=>{await p.locator('[data-workspace-action="add-marketing"]').click();};
  const save=async p=>{await p.locator('#mPropertyMarketing button[onclick="savePropertyMarketingEvent()"] ').click();};
  await open(page);await page.locator('#pmUrl').fill('https://www.instagram.com/reel/TESTOLD/?utm_source=other');await save(page);await page.waitForFunction(()=>document.querySelector('#pmSaveFeedback')?.textContent.includes('مسجل مسبقًا'));
  const oldTitle=await page.evaluate(()=>CRMPREVIEW.db.properties.find(p=>p.id===CRMPREVIEW.db.property_marketing_events.find(m=>m.link_key==='instagram:TESTOLD').property_id).title);
  assert((await page.locator('#pmSaveFeedback').innerText()).includes(oldTitle));assert.equal(await page.locator('#mPropertyMarketing').isVisible(),true);assert.equal(await page.evaluate(()=>JSON.stringify(CRMPREVIEW.db.property_marketing_events)),initial);
  report.checks.push('owner: another-property duplicate names only its permitted property; form stays open and all old rows unchanged');
  await page.screenshot({path:path.join(out,'duplicate-visible-desktop.png'),fullPage:true});
  await page.locator('#pmUrl').fill('https://www.instagram.com/p/TESTZERO/?utm_source=alias');await save(page);await page.locator('#mPropertyMarketing').waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>JSON.stringify(CRMPREVIEW.db.property_marketing_events)),initial);report.checks.push('same shortcode via post/reel alias reuses the current-property record without replacing date or zero metrics');
  await open(page);await page.locator('#pmUrl').fill('https://www.instagram.com/reel/TESTNEWV15/');await page.locator('#pmPublishedAt').fill('2026-10-20T10:43');await page.locator('#pmViews').fill('');await save(page);await page.locator('#mPropertyMarketing').waitFor({state:'hidden'});
  const row=await page.evaluate(()=>CRMPREVIEW.db.property_marketing_events.find(m=>m.link_key==='instagram:TESTNEWV15'));assert(row);assert.equal(row.published_at,'2026-10-20T06:43:00.000Z');assert.equal(row.views,null);report.checks.push('new unique video saves with explicit Muscat date, null unknown views and one row');
  await open(page);await page.locator('#pmUrl').fill('https://www.instagram.com/p/TESTNEWV15/');await page.locator('#pmEventType').selectOption('update');await page.locator('#pmViews').fill('25');await save(page);await page.waitForFunction(()=>document.querySelector('#pmSaveFeedback')?.textContent.includes('لم نغيّر'));assert.equal(await page.locator('#pmViews').inputValue(),'25');assert.equal(await page.evaluate(()=>CRMPREVIEW.db.property_marketing_events.find(m=>m.link_key==='instagram:TESTNEWV15').views),null);report.checks.push('duplicate metric event is explicit and never falsely reports updated metrics');
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'duplicate-mobile.png'),fullPage:true});assert(await page.locator('#pmSaveFeedback').isVisible());await context.close();
  const staff=await setup('barka'),p=staff.page;await p.locator('[data-workspace-action="property-marketing"]').first().click();await p.locator('#wsMarketingBody table').waitFor();await open(p);await p.locator('#pmUrl').fill('https://www.instagram.com/reel/TESTZERO/');await save(p);await p.waitForFunction(()=>document.querySelector('#pmSaveFeedback')?.textContent.includes('تعارض مع سجل موجود'));assert.doesNotMatch(await p.locator('#pmSaveFeedback').innerText(),/الخوض|TEST-M01|00000000/);assert.equal(await p.locator('#mPropertyMarketing').isVisible(),true);assert.equal(await p.evaluate(()=>CRMPREVIEW.db.property_marketing_events.length),3);report.checks.push('Barka: hidden cross-branch duplicate stays unnamed; index conflict does not bypass scope or add a row');await staff.context.close();
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.externalRequests,[]);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await browser.close();server?.close();}
})().catch(error=>{fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({...report,failure:String(error)},null,2));console.error(error);server?.close();process.exitCode=1;});
