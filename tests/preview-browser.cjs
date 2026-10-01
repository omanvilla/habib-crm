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
    if(screen==='dashboard'){assert((await page.locator('#opsDailyWork').innerText()).includes('الزيارات القادمة'));await page.locator('#opsPerformanceDetails summary').click();await page.waitForTimeout(200);assert((await page.locator('#opsDashboardPerformanceResults').innerText()).includes('محدد 1 من 6'));await page.locator('#opsPerformanceDetails [data-period="all"]').click();await page.waitForTimeout(200);assert((await page.locator('#opsDashboardPerformanceResults').innerText()).includes('إجمالي تاريخي'));await page.screenshot({path:path.join(out,'after-'+role+'-performance-lifetime.png'),fullPage:true});await page.locator('#opsPerformanceDetails [data-period="month"]').click();await page.locator('#opsPerformanceDetails summary').click();}
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
