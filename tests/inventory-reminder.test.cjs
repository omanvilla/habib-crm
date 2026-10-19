'use strict';
// Execute the real reminder against delayed, isolated RPC responses. No network
// or customer records are used; counts describe the current branch inventory.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('app-base-v15.html','utf8');
const start=source.indexOf('function employeeTargetMonth(){');
const end=source.indexOf('const employeeGoalFields=',start);
assert.ok(start>=0&&end>start,'employee reminder source exists');

function fixture(){
  const pending=[],warnings=[],card={style:{display:'none'}};
  let content='';
  const box={
    get innerHTML(){return content;},set innerHTML(value){content=String(value);},
    get textContent(){return content;},set textContent(value){content=String(value);}
  };
  const context={currentProfile:{role:'agent',company_id:'synthetic-company'},currentUser:{id:'synthetic-muscat'},crmSessionGeneration:1,
    $:id=>id==='employeeInventoryReminder'?card:id==='employeeInventoryReminderText'?box:null,
    console:{warn:(...args)=>warnings.push(args)},
    supa:{rpc:name=>new Promise((resolve,reject)=>pending.push({name,resolve,reject}))}};
  context.window=context;
  context.crmSessionCurrent=(generation,user)=>generation===context.crmSessionGeneration&&user===context.currentUser?.id;
  vm.createContext(context);vm.runInContext(source.slice(start,end),context);
  return {context,pending,warnings,card,box,snapshot:()=>({state:context.employeeInventoryState&&{...context.employeeInventoryState},content,display:card.style.display,warnings:warnings.length})};
}
const response=(inventory,id='synthetic-muscat')=>({data:{employees:[{id,inventory,goals:{inventory:10},new_properties:0}]},error:null});

for(const inventory of [15,4])test('latest inventory '+inventory+' cannot be overwritten by an older zero response',async()=>{
  const f=fixture(),older=f.context.loadEmployeeTargetReminder(),latest=f.context.loadEmployeeTargetReminder();
  assert.deepEqual(f.pending.map(x=>x.name),['crm_employee_target_snapshot','crm_employee_target_snapshot']);
  f.pending[1].resolve(response(inventory));await latest;
  const expected=f.snapshot();
  assert.deepEqual(expected.state,{active:inventory,required:10,needed:Math.max(0,10-inventory)});
  assert.equal(expected.display,inventory>=10?'none':'');
  if(inventory<10){assert.match(expected.content,/رصيد الفرع المتاح حاليًا 4 من 10/);assert.match(expected.content,/هدف الإضافات الأسبوعية مستقل/);}
  f.pending[0].resolve(response(0));await older;
  assert.deepEqual(f.snapshot(),expected);
});

test('an older RPC error cannot replace the latest shortage result',async()=>{
  const f=fixture(),older=f.context.loadEmployeeTargetReminder(),latest=f.context.loadEmployeeTargetReminder();
  f.pending[1].resolve(response(4));await latest;const expected=f.snapshot();
  f.pending[0].resolve({error:{message:'synthetic old RPC failure'}});await older;
  assert.deepEqual(f.snapshot(),expected);
});

test('an older network rejection cannot revive a satisfied inventory warning',async()=>{
  const f=fixture(),older=f.context.loadEmployeeTargetReminder(),latest=f.context.loadEmployeeTargetReminder();
  f.pending[1].resolve(response(15));await latest;const expected=f.snapshot();
  f.pending[0].reject(new Error('synthetic old network failure'));await older;
  assert.deepEqual(f.snapshot(),expected);
});

test('a current failure remains unavailable and a retry recovers the actual count',async()=>{
  const f=fixture(),failed=f.context.loadEmployeeTargetReminder();
  f.pending[0].resolve({error:{message:'synthetic current RPC failure'}});await failed;
  assert.equal(f.context.employeeInventoryState,null);assert.equal(f.card.style.display,'');
  assert.match(f.box.innerHTML,/تعذر التحقق من رصيد العقارات/);assert.match(f.box.innerHTML,/إعادة المحاولة/);
  assert.equal(f.warnings.length,1);
  const retry=f.context.loadEmployeeTargetReminder();f.pending[1].resolve(response(4));await retry;
  assert.deepEqual({...f.context.employeeInventoryState},{active:4,required:10,needed:6});
  assert.match(f.box.innerHTML,/رصيد الفرع المتاح حاليًا 4 من 10/);assert.doesNotMatch(f.box.innerHTML,/تعذر التحقق/);
});

test('success and failure from a previous session cannot render before the new session refresh',async()=>{
  for(const fail of [false,true]){
    const f=fixture(),older=f.context.loadEmployeeTargetReminder();
    f.context.currentUser={id:'synthetic-barka'};f.context.crmSessionGeneration++;
    f.context.employeeInventoryState=null;f.box.textContent='';f.card.style.display='none';
    const expected=f.snapshot();
    if(fail)f.pending[0].reject(new Error('synthetic previous-session failure'));
    else f.pending[0].resolve(response(0));
    await older;assert.deepEqual(f.snapshot(),expected);
    const latest=f.context.loadEmployeeTargetReminder();f.pending[1].resolve(response(4,'synthetic-barka'));await latest;
    assert.deepEqual({...f.context.employeeInventoryState},{active:4,required:10,needed:6});
    assert.match(f.box.innerHTML,/رصيد الفرع المتاح حاليًا 4 من 10/);
  }
});
