'use strict';
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const server=require('../preview/serve.cjs'),out=path.resolve('preview-results');
fs.mkdirSync(out,{recursive:true});
(async()=>{
 await new Promise(r=>server.listen(4173,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true}),report={synthetic:true,realEmployeeSessions:false,device:'Chromium desktop and viewport emulation, not physical phone',screens:[],checks:[],errors:[]};
 try{
 for(const mode of ['before','after'])for(const role of ['owner','muscat','barka']){
  const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block',acceptDownloads:true});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERROR',mode,role,e.message)});page.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',mode,role,m.text())});
  await context.route('**/*',route=>{const u=new URL(route.request().url());return u.hostname==='127.0.0.1'?route.continue():route.abort();});
  await page.goto('http://127.0.0.1:4173/'+mode+'/'+role+'/');
  try{await page.waitForFunction(()=>typeof currentProfile!=='undefined'&&currentProfile&&document.querySelector('#page-dash'),{timeout:12000});}catch(e){console.log('BOOT BODY',(await page.locator('body').innerText()).slice(0,5000));console.log('FIXTURE',await page.evaluate(()=>window.CRMPREVIEW&&({calls:CRMPREVIEW.calls,profile:CRMPREVIEW.profile})));await page.screenshot({path:path.join(out,'boot-failure-'+mode+'-'+role+'.png'),fullPage:true});throw e;}
  await page.waitForTimeout(1200);
  for(const screen of ['dashboard','properties','clients']){
   await page.evaluate(s=>navigate(s==='dashboard'?'dash':s,null),screen);await page.waitForTimeout(900);
   const name=mode+'-'+role+'-'+screen+'-desktop.png';await page.screenshot({path:path.join(out,name),fullPage:true});report.screens.push(name);
   if(mode==='after'){
    if(screen==='dashboard')assert(await page.locator('#opsDailyWork').innerText());
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
    await page.setViewportSize({width:390,height:844});
    const mobile=mode+'-'+role+'-'+screen+'-mobile.png';await page.screenshot({path:path.join(out,mobile),fullPage:true});report.screens.push(mobile);
    await page.setViewportSize({width:1440,height:1000});
   }
  }
  if(mode==='after'){
   // Download from the rendered property details, with synthetic repeated/cancelled visits.
   if(role==='owner'){
    await page.evaluate(()=>viewProperty(window.CRMPREVIEW.db.properties[0].id));await page.waitForTimeout(600);
    const downloadPromise=page.waitForEvent('download');
    await page.evaluate(()=>exportPropertyOwnerReport());
    const download=await downloadPromise;await download.saveAs(path.join(out,'owner-synthetic-report.csv'));
    const csv=fs.readFileSync(path.join(out,'owner-synthetic-report.csv'),'utf8');
    assert(csv.includes('زيارات ألغيت'));report.checks.push('CSV downloaded through Chromium; synthetic property report');
   }
   const blocked=await page.evaluate(async()=>({status:(await fetch('/after/'+window.CRMPREVIEW.actor+'/api/send',{method:'POST'})).status,send:await supa.functions.invoke('whatsapp-send',{body:{}})}));
   assert.equal(blocked.status,405);assert(blocked.send.error);report.checks.push(role+': server POST and fixture external sending denied');
   await page.evaluate(()=>clearSessionUI());assert.equal(await page.locator('#clientsList').innerText(),'');assert.equal(await page.locator('#propertiesList').innerText(),'');report.checks.push(role+': session UI cleared');
  }
  report.errors.push({mode,role,errors});await context.close();
 }
 fs.writeFileSync(path.join(out,'browser-report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
