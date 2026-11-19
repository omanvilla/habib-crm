'use strict';
// 17 Nov 2026 (Ahmed: «تعمل فحص للوحه العمل ... وتلغي اي شي متشابه وتبسط الصفحه ولكن تكون عمليه ومفيده»). Display only.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const home=fs.readFileSync('crm-owner-home.js','utf8'),css=fs.readFileSync('crm-owner-home.css','utf8');
const calls=fs.readFileSync('crm-calls-meetings.js','utf8'),index=fs.readFileSync('index.html','utf8');
const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
const num=v=>Number(v||0).toLocaleString('en-US');

test('the greeting is one line; the count of things to do is on the tiles only',()=>{
 const src=home.slice(home.indexOf('  function drawHello(total){'),home.indexOf('  function drawTiles('));
 assert(!src.includes('أشياء تحتاج تتابعها'));
 assert(src.includes("(h<12?'صباح الخير':'مساء الخير')"));
});

test('yesterday\'s unasked visits open from the visits tile, not as a card above the greeting',()=>{
 assert(home.includes("window.crmVisitsUnaskedHtml==='function'"),'the visits sheet shows them first');
 assert(home.includes("document.addEventListener('crm-visits-unasked-updated'"));
 assert(calls.includes('window.crmVisitsUnaskedCount=()=>unasked.length;'));
 assert(calls.includes("document.dispatchEvent(new CustomEvent('crm-visits-unasked-updated'));"));
 assert(css.includes('#crmOwnerHome:not([hidden])>#crmVisitsUnasked{display:none!important}'),'hidden on the home even if drawn before it opened');
 // the tile: urgent and counted when there are unasked visits, the old quiet tile otherwise
 const src=home.slice(home.indexOf('    const un0=unaskedCount();'),home.indexOf('    const pr=(d.problems||[]).length;'));
 const run=(overdue,un)=>{const t=[];let todo=0;const d={overdue_total:overdue};const unaskedCount=()=>un;
  const tile=(l,c,a,s,u)=>({l,c,s,u});new Function('t','d','unaskedCount','tile','let todo=0;'+src+';return todo;')(t,d,unaskedCount,tile);return t;};
 assert.deepEqual(run(0,0),[]);
 assert.deepEqual(run(11,0),[{l:'زيارات يتابعها الذكاء الاصطناعي',c:11,s:'للاطلاع، العقل يسأل العميل',u:false}]);
 assert.deepEqual(run(11,2),[{l:'زيارات يتابعها الذكاء الاصطناعي',c:13,s:'2 معاينة أمس بدون سؤال، شيكها',u:true}]);
 assert.equal(run(0,3)[0].c,3);
});

test('the call button on the home keeps its count; its explanation is inside the call window',()=>{
 const homeCall=calls.slice(calls.indexOf('  function paintHomeCall(){'),calls.indexOf('  function openCall('));
 assert(!homeCall.includes('ccm-note'));
 assert(calls.includes("(byNumber?'<small class=\"ccm-note\">سجّل كل اتصال على مالك أو معلن"));
 assert(homeCall.includes('اتصالات الموظفين:'),'the owner still sees each person\'s calls');
});

test('system updates fold into one closed line and keep «تم» on each',()=>{
 const src=home.slice(home.indexOf('  function drawAuto(){'),home.indexOf('  function drawTwins('));
 const slot={innerHTML:'',querySelector:()=>null};
 new Function('byId','esc','num','autoNotes',src+';drawAuto();')(()=>slot,esc,num,[{id:'a1',type:'deal_auto_closed',title:'انقفلت صفقة',body:'x',created_at:'2026-11-17T05:00:00Z'}]);
 assert(slot.innerHTML.startsWith('<details class="card coh-sec coh-fold">'),'closed by default');
 assert(slot.innerHTML.includes('data-coh="auto-done" data-id="a1"'));
});

test('the usage card is one line while both numbers are far from the limit',()=>{
 const src=home.slice(home.indexOf('  function drawUsage(){'),home.indexOf('  let autoNotes=[];'));
 const slot={innerHTML:''};
 const draw=u=>{new Function('usage','byId','esc','num',src+';drawUsage();')(u,()=>slot,esc,num);return slot.innerHTML;};
 let h=draw([{route_key:'barka',used:412,free_limit:1000},{route_key:'muscat',used:611,free_limit:1000}]);
 assert(h.startsWith('<p class="coh-usage-line">')&&h.includes('412 / 1,000')&&h.includes('611 / 1,000'));
 h=draw([{route_key:'barka',used:412,free_limit:1000},{route_key:'muscat',used:800,free_limit:1000}]);
 assert(h.includes('قرّب يخلص المجاني'),'80% and more gets the full card');
});

test('the summary counts the company target of 25 and drops the links the side menu already has',()=>{
 assert(home.includes('const INVENTORY_TARGET=25;'));
 assert(!home.includes("' متاح من 10'"));
 assert(!home.includes('data-nav="properties">كل العقارات'));
 const src=home.slice(home.indexOf('  function drawSummary(d){'),home.indexOf('  async function load(){'));
 const box={innerHTML:''};
 new Function('d','byId','esc','num','INVENTORY_TARGET',src+';drawSummary(d);')({properties:{branches:[{branch:'barka',available:4},{branch:'muscat',available:2}],added_week:0,unchecked:5},report:{week_start:'2026-11-15',new_clients:42}},()=>box,esc,num,25);
 assert(box.innerHTML.includes('<strong dir="ltr">6</strong><small>متاح للشركة من 25</small>'));
 assert(box.innerHTML.includes('<small>متاح بركاء</small>')&&box.innerHTML.includes('<small>متاح مسقط</small>'));
});

test('the agent\'s inventory reminder is not said twice on the home; the four shortcuts stay (the old work list went 19 Nov)',()=>{
 assert(css.includes('#page-dash.coh-on>#employeeInventoryReminder{display:none!important}'));
 assert(!home.includes('قائمة العمل الكاملة'));
 const base=fs.readFileSync('app-base-v15.html','utf8');
 assert.equal((base.slice(base.indexOf('<div class="dash-toolbar"'),base.indexOf('</div></div>',base.indexOf('<div class="dash-toolbar"'))).match(/class="qa-btn"/g)||[]).length,4);
 assert(/crm-owner-home\.js\?v=202611(19|2\d)-/.test(index)&&/crm-owner-home\.css\?v=202611(1[89]|2\d)-/.test(index)&&index.includes('crm-calls-meetings.js?v=20261119-open1'));
});
