'use strict';
// Empty unauthenticated browser; never enter credentials or read/write business records.
const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
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
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 page.on('requestfailed',r=>failed.push({url:r.url(),error:r.failure()?.errorText}));
 await page.goto('https://omanvilla.github.io/habib-crm/',{waitUntil:'networkidle',timeout:60000});
 await page.waitForFunction(()=>window.APP_VERSION==='20261020-design-v14',null,{timeout:20000});
 await page.locator('#loginForm').waitFor({state:'visible',timeout:20000});
 await page.evaluate(()=>document.fonts.ready);
 const state=await page.evaluate(()=>({version:window.APP_VERSION,meta:document.querySelector('meta[name="app-version"]')?.content,
  loginVisible:!!document.querySelector('#authScreen')&&getComputedStyle(document.querySelector('#authScreen')).display!=='none'&&!document.querySelector('#authScreen').classList.contains('hidden'),
  scripts:[...document.scripts].filter(s=>s.src).map(s=>s.src),designClass:document.body.classList.contains('crm-design'),
  font:getComputedStyle(document.querySelector('#authScreen')).fontFamily,
  loadedFontFaces:[...document.fonts].filter(f=>f.status==='loaded').map(f=>({family:f.family,weight:f.weight})),
  iconRendererAvailable:typeof window.CRMDesign?.icon==='function',
  templatesPagePresent:!!document.getElementById('page-ai'),instagramInboxPresent:!!document.querySelector('#igInboxPanel,#igConversationList,#igCompose')}));
 await page.screenshot({path:'public-verification/unauthenticated-startup.png',fullPage:true});
 fs.writeFileSync('public-verification/startup.json',JSON.stringify({...state,authenticated:false,errors,failed,blocked,productionWrites:0,requests},null,2));
 console.log(JSON.stringify({version:state.version,loginVisible:state.loginVisible,designClass:state.designClass,font:state.font,errors,failed,blocked}));
 assert.equal(state.version,'20261020-design-v14');assert.equal(state.meta,state.version);assert.equal(state.loginVisible,true);
 assert.equal(state.designClass,true);assert.equal(state.iconRendererAvailable,true);assert(state.font.includes('IBM Plex Sans Arabic'));
 assert.equal(state.templatesPagePresent,false);assert.equal(state.instagramInboxPresent,false);
 for(const old of ['/modern-v17.js','/instagram-crm.js'])assert.equal(state.scripts.some(s=>s.includes(old)),false);
 for(const mod of ['crm-design-v14.js','crm-client-edit-v14.js','crm-instagram-performance.js','crm-workspace-v13.js'])assert(state.scripts.some(s=>s.includes(mod)));
 assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);assert.deepEqual(failed,[]);
 await browser.close();
})().catch(error=>{console.error(error);process.exit(1);});
