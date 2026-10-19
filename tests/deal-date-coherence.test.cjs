'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const base=fs.readFileSync(path.join(__dirname,'../app-base-v15.html'),'utf8');
const workflow=fs.readFileSync(path.join(__dirname,'../crm-deal-workflow.js'),'utf8');
function fn(source,name){let start=source.indexOf('function '+name+'(');assert(start>=0);if(source.slice(start-6,start)==='async ')start-=6;for(let end=source.indexOf('}',start);end>=0;end=source.indexOf('}',end+1)){const text=source.slice(start,end+1);try{new vm.Script(text);return text;}catch{}}throw Error(name);}
function dates(){const c={Intl,Date,escapeHtml:x=>String(x||'')};vm.createContext(c);vm.runInContext(fn(base,'crmDealCalendarDate')+'\n'+fn(base,'crmDealDatesHtml'),c);return c;}
test('cards and CSV use the Oman booking date, independent of sale and recording dates',()=>{
 const c=dates(),d={reservation_confirmed_at:'2025-09-30T20:30:00Z',closed_at:'2025-11-03T08:00:00Z',created_at:'2025-11-10',stage:'closed'};
 const html=c.crmDealDatesHtml(d);assert.match(html,/2025-10-01/);assert.match(html,/2025-11-03/);assert(!html.includes('2025-11-10'));
 let out;c.allDeals=[d];c.dealStageAr=x=>x;c.downloadCSV=(_,headers,rows)=>{out={headers,rows};};vm.runInContext(fn(base,'exportDeals'),c);c.exportDeals();
 assert.equal(out.rows[0][out.headers.indexOf('تاريخ دفع العربون')],'2025-10-01');assert.equal(out.rows[0][out.headers.indexOf('تاريخ البيع')],'2025-11-03');assert(!JSON.stringify(out.rows).includes('<'));
});
test('unknown booking dates remain unknown and a missing API field is not called an empty booking',()=>{
 const c=dates(),d={stage:'commission_collected',closed_at:'2025-10-03',created_at:'2025-09-16',reservation_confirmed_at:null};
 const before=JSON.stringify(d);assert.match(c.crmDealDatesHtml(d),/غير مسجل/);assert(!c.crmDealDatesHtml(d).includes('2025-09-16'));assert.equal(JSON.stringify(d),before);
 delete d.reservation_confirmed_at;assert.match(c.crmDealDatesHtml(d),/تعذر تحميله/);assert.equal(c.crmDealCalendarDate('not-a-date'),'');
});
test('saved deal timeline separates actual visit, booking, sale and every receipt date, with staff financial masking',()=>{
 const c={Intl,Date,day:null};vm.createContext(c);vm.runInContext(fn(workflow,'day')+'\n'+fn(workflow,'savedDates'),c);
 const d={viewing_id:'SYNTHETIC-VISIT',reservation_confirmed_at:'2025-10-31T08:00:00Z',closed_at:'2025-11-03T08:00:00Z',receipts:[{received_on:'2025-11-07'},{received_on:'2025-11-07'},{received_on:'2025-12-02'}],commission_received_at:'2025-12-02'};
 const a=c.savedDates(d,[{id:'SYNTHETIC-VISIT',viewing_date:'2025-08-25'}],true);assert.deepEqual(Array.from(a,x=>x.value),['2025-08-25','2025-10-31','2025-11-03','2025-11-07، 2025-12-02']);
 assert.equal(c.savedDates(d,[],false).length,3);assert.match(c.savedDates(d,[],false)[0].value,/تعذر/);
 d.reservation_confirmed_at=null;d.receipts=[];d.commission_received_at=null;d.commission_status='received';
 assert.equal(c.savedDates(d,[],true)[1].value,'غير مسجل');assert.equal(c.savedDates(d,[],true)[3].value,'تاريخ التحصيل غير مسجل');
});
function loadHarness(name){
 const pending=[],nodes={dealsContent:{innerHTML:'unchanged'},dealsSub:{textContent:''},cdTabDeals:{innerHTML:''}};
 const c={currentUser:{id:'SYNTHETIC-USER'},crmSessionGeneration:1,viewingClient:{id:'SYNTHETIC-A'},dealsLoadSequence:0,clientDealsLoadSequence:0,allDeals:[],allPropertyInquiries:[],renderDeals(){c.rendered=(c.rendered||0)+1;},$:id=>nodes[id],crmReadAll:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))};
 c.crmSessionCurrent=(g,u)=>g===c.crmSessionGeneration&&u===c.currentUser?.id;
 vm.createContext(c);vm.runInContext(fn(base,name),c);return{c,pending,nodes};
}
test('a late deal list cannot replace a newer list or restore another session data',async()=>{
 const{c,pending,nodes}=loadHarness('loadDeals');const first=c.loadDeals(),second=c.loadDeals();pending[2].resolve([{id:'NEW'}]);pending[3].resolve([]);await second;pending[0].resolve([{id:'OLD'}]);pending[1].resolve([]);await first;assert.equal(c.allDeals[0].id,'NEW');assert.equal(c.rendered,1);
 const last=c.loadDeals();c.crmSessionGeneration++;c.currentUser=null;nodes.dealsContent.innerHTML='signed out';pending[4].reject(Error('stale database detail'));pending[5].resolve([]);await last;assert.equal(nodes.dealsContent.innerHTML,'signed out');
});
test('failed client-deal loads display retry rather than a false empty result and cannot overwrite another client',async()=>{
 const{c,pending,nodes}=loadHarness('renderClientDealsTab');const first=c.renderClientDealsTab();c.viewingClient={id:'SYNTHETIC-B'};const second=c.renderClientDealsTab();pending[1].reject(Error('private backend detail'));await second;assert.match(nodes.cdTabDeals.innerHTML,/تعذر تحميل/);assert(!nodes.cdTabDeals.innerHTML.includes('private backend'));
 const kept=nodes.cdTabDeals.innerHTML;pending[0].resolve([]);await first;assert.equal(nodes.cdTabDeals.innerHTML,kept);
});
