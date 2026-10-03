const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../app-base-v15.html'),'utf8');
function fn(name){const start=source.indexOf('function '+name+'(');assert(start>=0);for(let end=source.indexOf('}',start);end>=0;end=source.indexOf('}',end+1)){const text=source.slice(start,end+1);try{new vm.Script(text);return text;}catch{}}throw Error(name);}
function harness(){const nodes={dealsContent:{innerHTML:''}};const c={allDeals:[],canEdit:()=>true,canViewFinancials:()=>true,escapeHtml:x=>String(x),fmtDate:x=>String(x).slice(0,10),fmtMoney:x=>String(x),toLocalDateStr:()=> '2026-10-02',dealStageAr:x=>x,$:id=>nodes[id]};vm.createContext(c);vm.runInContext(fn('crmDealCustomerNotes')+'\n'+fn('renderPipeline'),c);return{c,nodes};}
test('system visit origin is not a rejection reason, and mixed customer notes survive unchanged',()=>{
 const {c}=harness(),origin='تم إنشاؤها تلقائياً من زيارة بتاريخ 2026-06-29';
 assert.equal(c.crmDealCustomerNotes(origin),'');assert.equal(c.crmDealCustomerNotes(origin+'\nالسعر أعلى من ميزانيتي'),'السعر أعلى من ميزانيتي');
 assert.equal(c.crmDealCustomerNotes('بطاقة Pipeline مرتبطة بزيارة CRM'),'');
 assert.equal(c.crmDealCustomerNotes('زيارة مناسبة بتاريخ 2026-06-29'),'زيارة مناسبة بتاريخ 2026-06-29');
});
test('lost card reports absent evidence honestly without changing the stored origin',()=>{
 const {c,nodes}=harness();c.allDeals=[{id:'SYNTHETIC',stage:'lost',notes:'تم إنشاؤها تلقائياً من زيارة بتاريخ 2026-06-29',created_at:'2026-06-29'}];
 const before=JSON.stringify(c.allDeals);c.renderPipeline();assert(nodes.dealsContent.innerHTML.includes('لا يوجد سبب مسجل'));assert(!nodes.dealsContent.innerHTML.includes('توجد ملاحظة قديمة؛'));assert.equal(JSON.stringify(c.allDeals),before);
});
test('completed historical card shows actual sale date instead of the entry date',()=>{
 const {c,nodes}=harness();c.allDeals=[{id:'SYNTHETIC',stage:'closed',closed_at:'2020-02-10T08:00:00Z',created_at:'2026-10-02',updated_at:'2026-10-02'}];c.renderPipeline();assert(nodes.dealsContent.innerHTML.includes('بيع: 2020-02-10'));assert(!nodes.dealsContent.innerHTML.includes('تحديث: 2026-10-02'));
});
test('deal export distinguishes sale, recording and rejection evidence without losing original notes',()=>{
 const {c}=harness();let exported;c.downloadCSV=(name,headers,rows)=>{exported={headers,rows}};vm.runInContext(fn('exportDeals'),c);
 c.allDeals=[{stage:'closed',closed_at:'2020-02-10T08:00:00Z',created_at:'2026-10-02'},{stage:'lost',created_at:'2026-10-02',notes:'بطاقة Pipeline مرتبطة بزيارة CRM'}];c.exportDeals();
 assert.equal(exported.rows[0][exported.headers.indexOf('تاريخ البيع')],'2020-02-10');assert.equal(exported.rows[0][exported.headers.indexOf('تاريخ التسجيل')],'2026-10-02');
 assert.equal(exported.rows[1][exported.headers.indexOf('تاريخ البيع')],'');assert.equal(exported.rows[1][exported.headers.indexOf('سبب الرفض الرئيسي')],'غير مسجل');assert.equal(exported.rows[1][exported.headers.indexOf('ملاحظات السجل الأصلية')],'بطاقة Pipeline مرتبطة بزيارة CRM');
});
test('a new primary selection replaces the draft selection without changing the other inquiry form',()=>{
 const {c}=harness();c.piStructuredSelected=new Set(['OLD']);c.ifStructuredSelected=new Set(['OTHER']);c.piStructuredPrimary='OLD';c.ifStructuredPrimary='OTHER';vm.runInContext(fn('toggleStructuredReason')+'\n'+fn('setStructuredPrimary'),c);
 c.toggleStructuredReason({dataset:{prefix:'pi'},value:'NEW'});assert.deepEqual([...c.piStructuredSelected],['NEW']);assert.equal(c.piStructuredPrimary,'NEW');assert.deepEqual([...c.ifStructuredSelected],['OTHER']);
 c.toggleStructuredReason({dataset:{prefix:'pi'},value:''});assert.equal(c.piStructuredSelected.size,0);assert.equal(c.piStructuredPrimary,null);
});
