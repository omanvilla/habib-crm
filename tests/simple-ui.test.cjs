'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const vm=require('node:vm');
const index=fs.readFileSync('index.html','utf8');
const base=fs.readFileSync('app-base-v15.html','utf8');
const simple=fs.readFileSync('crm-simple-ui.js','utf8');
const tasks=fs.readFileSync('crm-v18-task-priority-patch.js','utf8');
const attention=fs.readFileSync('crm-attention.js','utf8');

test('loader includes the simplification module after the modules it builds on',()=>{
  assert.match(index,/crm-simple-ui\.css\?v=/);
  assert(index.indexOf('crm-simple-ui.js?v=')>index.indexOf('crm-design-v14.js?v='));
  assert(index.indexOf('crm-simple-ui.js?v=')>index.indexOf('crm-whatsapp-chat.js?v='));
});

test('staff selectors and task rows name the branch, never an e-mail address',()=>{
  const start=base.indexOf('function crmMemberChoiceLabel(');
  const body=base.slice(start,base.indexOf('\nfunction ',start+10));
  const ctx={leadRouteData:{a:{route_key:'barka',assigned_to:'U1'}},currentUser:{id:'X'},window:{}};
  vm.createContext(ctx);
  vm.runInContext(base.slice(base.indexOf('function crmBranchName('),base.indexOf('\n',base.indexOf('function crmBranchName(')))+'\n'+body,ctx);
  assert.equal(ctx.crmMemberChoiceLabel({id:'U1',role:'agent',email:'staff@example.invalid'}),'بركاء');
  assert.equal(ctx.crmMemberChoiceLabel({id:'U2',role:'agent',email:'staff@example.invalid'}),'حساب فريق');
});

function runTasks(rows,edit){
  const nodes={};
  const node=id=>nodes[id]||(nodes[id]={innerHTML:'',textContent:'',style:{}});
  const ctx={document:{getElementById:node,createElement:()=>({}),body:{appendChild(){}}},allTasks:rows,taskFilter:'all',
    daysUntil:d=>d==='2026-10-20'?-5:d==='2026-10-25'?0:3,canEdit:()=>edit,escapeHtml:s=>String(s).replace(/</g,'&lt;'),
    crmRecordBranchLabel:()=>'مسقط',supa:{}};
  ctx.window=ctx;vm.createContext(ctx);vm.runInContext(tasks,ctx);
  node('mTaskDetails');ctx.renderTasks();
  return nodes.tasksList.innerHTML;
}

test('tasks page renders one escaped table row per open task, overdue first',()=>{
  const html=runTasks([
    {id:'t1',title:'اتصال <b>',priority:'low',due_date:'2026-10-28',client:{name:'عميل'},client_id:'c1'},
    {id:'t2',title:'متابعة',priority:'high',due_date:'2026-10-20'},
    {id:'t3',title:'مكتملة',done:true}
  ],true);
  assert.match(html,/<table class="crm-grid" aria-label="قائمة المهام">/);
  assert.equal((html.match(/data-task-row=/g)||[]).length,2);
  assert(html.indexOf('t2')<html.indexOf('t1'));
  assert.match(html,/crm-grid-overdue">متأخرة 5 يوم/);
  assert(!html.includes('<b>'));
  assert.match(html,/<td>مسقط<\/td>/);
  assert.match(html,/deleteTask\('t1'\)/);
});

test('read-only accounts get no edit or delete actions on task rows',()=>{
  const html=runTasks([{id:'t1',title:'x',priority:'med'}],false);
  assert(!html.includes('deleteTask('));assert(!html.includes('editTask('));assert.match(html,/ disabled>/);
});

test('visits render as rows that reuse the existing edit and delete flows',()=>{
  const nodes={};const node=id=>nodes[id]||(nodes[id]={innerHTML:'',dataset:{},classList:{add(){},toggle(){},contains(){return false}},addEventListener(){},after(){},querySelectorAll:()=>[]});
  const ctx={document:{getElementById:id=>id==='viewingsList'?node(id):null,createElement:()=>node('btn'),querySelectorAll:()=>[],querySelector:()=>null},
    MutationObserver:class{observe(){}},requestAnimationFrame:f=>f(),setTimeout:()=>0,
    renderViewings(){},navigate(){},escapeHtml:s=>String(s).replace(/</g,'&lt;'),toLocalDateStr:()=>'2026-10-25',viewingTab:'all',
    crmRecordBranchLabel:()=>'بركاء',
    allViewings:[{id:'v1',status:'scheduled',viewing_date:'2026-10-20',client:{name:'<i>',phone:'+968 9000'},client_id:'c1',property:{title:'فيلا'}},
                 {id:'v2',status:'done',viewing_date:'2026-10-01',property:null,client:null}]};
  ctx.window=ctx;vm.createContext(ctx);vm.runInContext(simple,ctx);ctx.renderViewings();
  const html=nodes.viewingsList.innerHTML;
  assert.match(html,/aria-label="قائمة الزيارات"/);
  assert.match(html,/crm-grid-late/);assert.match(html,/تسجيل النتيجة/);
  assert.match(html,/editViewing\('v1'\)/);assert.match(html,/deleteViewing\('v2'\)/);
  assert(!html.includes('<i>'));
  assert(html.indexOf('متأخرة وتحتاج نتيجة')<html.indexOf('سجلات سابقة'));
});

test('dashboard queue stays collapsed to a short preview and keeps the owner-only batch button',()=>{
  assert.match(attention,/const PREVIEW=3/);
  assert.match(attention,/items\.slice\(0,PREVIEW\)/);
  assert.match(attention,/catch\(e\)\{return false;\}/);
  assert(attention.includes("currentProfile.role==='owner'?'<button type=\"button\" class=\"btn-secondary crm-attention-batch\""));
});

// Phase 2 renderers run against a minimal DOM: only the target list node exists.
function phase2(extra){
  const nodes={};const node=id=>nodes[id]||(nodes[id]={id,innerHTML:'',textContent:'',value:'',dataset:{},querySelectorAll:()=>[],classList:{add(){},toggle(){},contains(){return false}}});
  const ctx={document:{getElementById:id=>['ownersList','depositsList','calContent','calTitle','ownerSearchQ'].includes(id)?node(id):null,querySelector:()=>null,querySelectorAll:()=>[],createElement:()=>node('x')},
    MutationObserver:class{observe(){}},requestAnimationFrame:f=>f(),setTimeout:()=>0,navigate(){},
    renderViewings(){},renderCalList(){},renderOwners(){},renderDeposits(){},setCalView(){},
    escapeHtml:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),canEdit:()=>true,canDelete:()=>false,...extra};
  ctx.window=ctx;vm.createContext(ctx);vm.runInContext(simple,ctx);return {ctx,node};
}

test('owners render as escaped rows with property counts and no raw phone markup',async()=>{
  const {ctx,node}=phase2({allOwners:[{id:'o1',name:'<b>مالك</b>',phone:'96891234567',owner_type:'broker',exclusive:true}],ownerTypeFilter:'all',
    formatPhoneDisplay:p=>'<span style="x">+968 9123 4567</span>',
    crmDataFrom:()=>({select:()=>({eq:async()=>({data:[{owner_id:'o1',status:'available'},{owner_id:'o1',status:'sold'}]})})})});
  await ctx.renderOwners();
  const html=node('ownersList').innerHTML;
  assert.match(html,/aria-label="قائمة الملاك"/);assert(!html.includes('<b>'));assert(!html.includes('<span style'));
  assert.match(html,/\+968 9123 4567/);assert.match(html,/<td>وسيط<\/td>/);
  assert.match(html,/crm-grid-num">2<\/td><td class="crm-grid-num">1<\/td><td class="crm-grid-num">1</);
  assert(!html.includes('archive-owner'),'archive needs delete permission');
});

test('empty owners and deposits pages explain what to do next',async()=>{
  const {ctx,node}=phase2({allOwners:[],ownerTypeFilter:'all',allDeposits:[],depositTab:'all',getDepositStatus:()=>'active'});
  await ctx.renderOwners();ctx.renderDeposits();
  assert.match(node('ownersList').innerHTML,/لا يوجد ملاك بعد[\s\S]*openModal\('mOwner'\)/);
  assert.match(node('depositsList').innerHTML,/لا توجد عرابين بعد[\s\S]*openModal\('mDeposit'\)/);
});

test('deposits render one row each with the remaining-time status',()=>{
  const soon=new Date(Date.now()+3*864e5).toISOString().slice(0,10);
  const {ctx,node}=phase2({depositTab:'all',getDepositStatus:d=>d.status,fmtMoney:v=>v+' ر.ع',fmtDate:v=>v,
    allDeposits:[{id:'d1',amount:500,status:'active',expiry_date:soon,payment_method:'cash',received_by:'company',deal:{client:{name:'<i>'},property:{title:'فيلا'}}},
                 {id:'d2',amount:900,status:'applied'}]});
  ctx.renderDeposits();
  const html=node('depositsList').innerHTML;
  assert.match(html,/aria-label="قائمة العرابين"/);assert(!html.includes('<i>'));
  assert.match(html,/crm-grid-soon">باقي [34] أيام/);assert.match(html,/طُبّق في الصفقة/);
  assert.match(html,/كاش · الشركة/);assert.match(html,/editDeposit\('d1'\)/);
});

test('calendar list groups open items into overdue, today and later, and skips finished ones',()=>{
  const day=n=>{const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()+n);return d.toISOString().slice(0,10);};
  const {ctx,node}=phase2({toLocalDateStr:d=>new Date(d.getTime()-d.getTimezoneOffset()*6e4).toISOString().slice(0,10),
    allEvents:[{type:'task',title:'متأخرة',date:day(-2),raw:{id:'t1'}},{type:'event',title:'اليوم <x>',date:day(0),evtType:'visit'},
               {type:'task',title:'منتهية',date:day(0),done:true,raw:{id:'t2'}},{type:'event',title:'حدث قديم',date:day(-3)}]});
  ctx.renderCalList();
  const html=node('calContent').innerHTML;
  assert(html.indexOf('>متأخرة <span>1')<html.indexOf('>اليوم <span>1'));
  assert.match(html,/openTaskDetails\('t1'\)/);assert(!html.includes('منتهية'));assert(!html.includes('حدث قديم'));assert(!html.includes('<x>'));
});

test('menu, top bar and page titles use the same short names',()=>{
  for(const [nav,title] of [['المهام','المهام'],['النسخ الاحتياطي','النسخ الاحتياطي'],['الفروع','الفروع']]){
    assert(base.includes('<span class="nav-text">'+nav+'</span>'),nav);
    assert(base.includes('<div class="page-title"><span>'+title+'</span></div>'),title);
  }
  for(const name of ['العملاء','العقارات','الملاك','الزيارات','العربون','التقويم','واتساب'])assert(base.includes('<div class="page-title"><span>'+name+'</span></div>'),name);
  assert(!base.includes('Backup</span>'));assert(!/'إدارة <em>/.test(base.match(/const t=\{[^}]*\}/)[0].replace("deals:'إدارة <em>الصفقات</em>'",'')));
  assert(base.includes('<div class="page-title">إدارة <span>الصفقات والزيارات</span></div>'),'Deals page is left as it was');
});

test('quick guide opens once per account and the top-bar button reopens it',()=>{
  assert.match(simple,/'crmGuideSeen:'\+/);
  assert.match(simple,/localStorage\.setItem\(guideKey\(\),'1'\)/);
  assert.match(simple,/!seen&&!guideOffered/);
  assert.match(simple,/onclick="crmOpenGuide\(\)" title="دليل سريع"/);
  assert.equal((simple.match(/\{nav:'/g)||[]).length,4);
});

test('deposit cells show amounts and dates as text, never as raw markup',()=>{
  const {ctx,node}=phase2({depositTab:'all',getDepositStatus:d=>d.status,
    fmtMoney:v=>'<span dir="ltr" style="display:inline-block">'+v+'</span> ر.ع',fmtDate:v=>'<span dir="ltr">8</span> يونيو <span dir="ltr">2026</span>',
    allDeposits:[{id:'d1',amount:'1,000',status:'active',payment_date:'2026-06-08',deal:{client:{name:'ع'},property:{title:'ف'}}}]});
  ctx.renderDeposits();
  const html=node('depositsList').innerHTML;
  assert(!html.includes('&lt;span'),'escaped markup would show as text');
  assert.match(html,/1,000 ر\.ع/);assert.match(html,/8 يونيو 2026/);
  assert.match(html,/<td>—<\/td><td class="crm-grid-actions">/,'missing payment details show a single dash');
});

test('sold-value chart uses a wide canvas with readable labels and plain-text tooltips',()=>{
  const start=base.indexOf('function renderRevenueLineChart('),body=base.slice(start,base.indexOf('\nfunction renderRevenueDetails(',start));
  assert.match(body,/const w=600,h=200/);
  assert.match(body,/font-size:11px/);assert(!body.includes('font-size:5px'));
  assert.match(body,/String\(fmtMoney\(m\.value\)\)\.replace\(\/<\[\^>\]\*>\/g,''\)/);
});

test('activity, expense and duplicate-client notes name the branch, not the employee',()=>{
  assert(!/escapeHtml\(a\.user\.full_name/.test(base));
  assert(!/escapeHtml\(e\.user\.full_name/.test(base));
  assert(!/escapeHtml\(c\.agent\.full_name\)/.test(base));
  assert.equal((base.match(/crmMemberChoiceLabel\(a\.user\)/g)||[]).length,2);
  assert(base.includes("sel.innerHTML='<option value=\"\">— أنا —</option>'"));
});

test('a new deposit confirms the deal reservation through one RPC instead of writing two tables',()=>{
  const start=base.indexOf('async function saveDeposit('),body=base.slice(start,base.indexOf('\nfunction depositErrorText(',start));
  assert.match(body,/supa\.rpc\('crm_record_deposit',\{p_deal_id:deal,p_payment_date:date,p_amount:amount/);
  assert(!body.includes("from('deposits').insert"),'deposits rows for reservations are created by the database');
  assert(!body.includes("update({stage:'deposit'})"),'the deal stage moves only with a confirmed reservation');
  assert.match(body,/if\(!existingDeposit\.from_reservation\)Object\.assign\(data,\{deal_id:deal,amount:amount,payment_date:date\}\)/);
  assert(!/fmtMoney\(amount\)/.test(body),'activity text stays plain');
});

test('SQL48 mirrors every paid reservation into deposits and keeps the deal authoritative',()=>{
  const sql=fs.readFileSync('db/changes/48-deposits-from-reservations.forward.sql','utf8');
  const rollback=fs.readFileSync('db/changes/48-deposits-from-reservations.rollback.sql','utf8');
  assert.match(sql,/CREATE UNIQUE INDEX IF NOT EXISTS deposits_one_reservation_per_deal ON public\.deposits\(deal_id\) WHERE from_reservation/);
  assert.match(sql,/AFTER INSERT OR UPDATE OF reservation_confirmed_at, deposit_amount, reservation_cancelled_at, client_id, property_id, stage ON public\.deals/);
  assert.match(sql,/v_result:=public\.crm_confirm_paid_reservation\(p_deal_id,p_payment_date,p_amount,NULL\)/,'deal access and validation stay in the existing reservation function');
  assert.match(sql,/RAISE EXCEPTION 'reservation_deposit_managed_by_deal'/);
  assert.match(sql,/REVOKE ALL ON FUNCTION public\.crm_record_deposit\([^)]*\) FROM PUBLIC, anon;/);
  assert.equal((sql.match(/SECURITY DEFINER SET search_path TO ''/g)||[]).length,3);
  assert(!/UPDATE public\.deals/.test(sql),'the backfill never rewrites deals');
  assert.match(rollback,/DROP TRIGGER IF EXISTS crm_sync_deposit_from_reservation ON public\.deals/);
});

test('reservation deposits open their deal instead of offering delete, and cancelled bookings are labelled',()=>{
  const {ctx,node}=phase2({depositTab:'all',getDepositStatus:d=>d.status,fmtMoney:v=>v+' ر.ع',fmtDate:v=>v,
    allDeposits:[{id:'r1',deal_id:'deal1',amount:500,status:'cancelled',from_reservation:true,payment_date:'2026-10-20'},
                 {id:'m1',deal_id:'deal2',amount:300,status:'active',payment_date:'2026-10-01'}]});
  ctx.renderDeposits();
  const html=node('depositsList').innerHTML;
  assert.match(html,/editDeal\('deal1'\)/);assert(!html.includes("deleteDeposit('r1')"));
  assert.match(html,/deleteDeposit\('m1'\)/);
  assert.match(html,/الحجز ملغى/);assert.match(html,/من الصفقة<\/span>/);
});
