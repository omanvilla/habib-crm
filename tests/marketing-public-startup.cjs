'use strict';
const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'}),errors=[],failed=[],blocked=[];
  await context.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());if(req.method()!=='GET'||/supabase\.(co|com)$/.test(u.hostname)||u.pathname.includes('/rest/v1/')||u.pathname.includes('/functions/v1/')){blocked.push({method:req.method(),url:u.origin+u.pathname});return route.abort();}return route.continue();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>failed.push({url:r.url(),error:r.failure()?.errorText}));
  await page.goto('https://omanvilla.github.io/habib-crm/',{waitUntil:'networkidle',timeout:60000});
  await page.waitForFunction(()=>window.APP_VERSION==='20261021-marketing-v15',{}, {timeout:20000});await page.locator('#loginForm').waitFor({state:'visible'});
  const observed=await page.evaluate(()=>({version:window.APP_VERSION,meta:document.querySelector('meta[name="app-version"]')?.content,marketingSaver:typeof window.savePropertyMarketingEvent==='function',workspaceScript:[...document.scripts].find(s=>s.src.includes('crm-workspace-v13.js'))?.src,templatesPagePresent:!!document.getElementById('page-ai'),instagramInboxPresent:!!document.querySelector('#igInboxPanel,#igConversationList,#igCompose')}));
  const result={...observed,authenticated:false,loginVisible:await page.locator('#loginForm').isVisible(),errors,failed,blocked,productionWrites:0};
  fs.writeFileSync('public-verification/startup.json',JSON.stringify(result,null,2));await page.screenshot({path:'public-verification/login.png',fullPage:true});console.log(JSON.stringify(result,null,2));
  assert.equal(observed.version,'20261021-marketing-v15');assert.equal(observed.meta,observed.version);assert.equal(observed.marketingSaver,true);assert(observed.workspaceScript.includes('v=20261021-marketing-v15'));assert.equal(result.loginVisible,true);assert.equal(observed.templatesPagePresent,false);assert.equal(observed.instagramInboxPresent,false);assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);assert.deepEqual(failed,[]);
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
