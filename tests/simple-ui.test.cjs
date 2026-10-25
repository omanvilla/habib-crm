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
  const ctx={document:{getElementById:id=>id==='viewingsList'?node(id):null,createElement:()=>node('btn'),querySelectorAll:()=>[]},
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
