'use strict';
const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'});
 const errors=[],failed=[],blocked=[];
 await context.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());if(r.method()!=='GET'||/supabase\.(co|com)$/.test(u.hostname)||u.pathname.includes('/functions/v1/')||u.pathname.includes('/rest/v1/')){blocked.push({method:r.method(),url:u.origin+u.pathname});return route.abort();}return route.continue();});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>failed.push({url:r.url(),error:r.failure()?.errorText}));
 await page.goto('https://omanvilla.github.io/habib-crm/',{waitUntil:'networkidle',timeout:60000});
 await page.waitForFunction(()=>window.APP_VERSION==='20261021-client-v17');await page.locator('#loginForm').waitFor({state:'visible'});
 const state=await page.evaluate(async()=>{
  const mod=await import('./supabase/functions/_shared/whatsapp-reply-preview.mjs?v=20261021-client-v17');
  const reply=mod.previewReply([{role:'customer',text:'هلا أرسل لي التفاصيل'}],[],'muscat');
  return {version:window.APP_VERSION,authenticated:false,chronology:!!window.CRMClientChronology,omanTime:CRMClientChronology.format('2026-10-20T20:05:00Z'),plannerLoaded:typeof mod.previewReply==='function',reply,trialVisible:!!document.querySelector('#crmReplyPreview'),scripts:[...document.scripts].filter(s=>s.src).map(s=>s.src)};
 });
 await page.screenshot({path:'public-verification/sign-in.png',fullPage:true});
 fs.writeFileSync('public-verification/startup.json',JSON.stringify({...state,errors,failed,blocked,productionWrites:0},null,2));
 console.log(JSON.stringify({version:state.version,plannerLoaded:state.plannerLoaded,omanTime:state.omanTime,errors,failed,blocked}));
 assert.equal(state.version,'20261021-client-v17');assert.equal(state.chronology,true);assert.equal(state.plannerLoaded,true);assert.equal(state.omanTime,'21/10/2026 · 00:05');assert.equal(state.reply.simulation,true);assert.equal(state.reply.send_allowed,false);assert.equal(state.trialVisible,false);assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);assert.deepEqual(blocked,[]);
 await browser.close();
})().catch(e=>{console.error(e);process.exitCode=1;});
