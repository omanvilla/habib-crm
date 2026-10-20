'use strict';
// Fresh empty browser: no sign-in, no production records, no POST/API/Edge calls.
const {chromium}=require('playwright');
const fs=require('node:fs');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
 const requests=[],blocked=[],errors=[],failed=[];
 await context.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url());
  if(req.method()!=='GET'||/supabase\.(co|com)$/.test(u.hostname)||u.pathname.includes('/functions/v1/')||u.pathname.includes('/rest/v1/')){
   blocked.push({method:req.method(),url:u.origin+u.pathname});return route.abort();
  }
  requests.push(req.url());return route.continue();
 });
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 page.on('requestfailed',request=>{if(!blocked.some(b=>request.url().startsWith(b.url)))failed.push({url:request.url(),error:request.failure()?.errorText});});
 await page.goto('https://omanvilla.github.io/habib-crm/',{waitUntil:'networkidle',timeout:60000});
 await page.waitForFunction(()=>window.APP_VERSION==='20261020-workspace-v13',{},{timeout:20000});
 await page.locator('#loginForm').waitFor({state:'visible',timeout:20000});
 const state=await page.evaluate(()=>({version:window.APP_VERSION,meta:document.querySelector('meta[name="app-version"]')?.content,
  loginVisible:!!document.querySelector('#authScreen')&&getComputedStyle(document.querySelector('#authScreen')).display!=='none'&&!document.querySelector('#authScreen').classList.contains('hidden'),
  scripts:[...document.scripts].filter(s=>s.src).map(s=>s.src),templatesPagePresent:!!document.getElementById('page-ai'),
  instagramInboxPresent:!!document.querySelector('#igInboxPanel,#igConversationList,#igCompose'),
  workspaceScriptLoaded:!![...document.scripts].find(s=>s.src.includes('crm-workspace-v13.js')),
  performanceScriptLoaded:!![...document.scripts].find(s=>s.src.includes('crm-instagram-performance.js'))}));
 await page.screenshot({path:'public-verification/unauthenticated-startup.png',fullPage:true});
 const report={...state,authenticated:false,errors,failed,blocked,productionWrites:0,requests};
 fs.writeFileSync('public-verification/startup.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({version:state.version,loginVisible:state.loginVisible,errors,blocked}));
 assert.equal(state.version,'20261020-workspace-v13');assert.equal(state.meta,state.version);assert.equal(state.loginVisible,true);
 assert.equal(state.templatesPagePresent,false);assert.equal(state.instagramInboxPresent,false);
 assert.equal(state.workspaceScriptLoaded,true);assert.equal(state.performanceScriptLoaded,true);
 assert.equal(state.scripts.some(s=>s.includes('/instagram-crm.js')),false);assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
 await browser.close();
})().catch(error=>{console.error(error);process.exit(1);});
