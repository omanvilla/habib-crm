'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app-base-v15.html','utf8');
const start=source.indexOf('async function saveExpense(){'),end=source.indexOf('\nfunction archiveExpense(',start);
function setup(respond=()=>({data:{id:'TEST-expense'},error:null})){
 const inputs={exDesc:{value:'Synthetic expense'},exAmount:{value:'15.005'},exDate:{value:'2026-10-01'},exCategory:{value:'other'},exPaymentMethod:{value:'cash'},exNotes:{value:''}};
 const state={busy:false,writes:[],toasts:[],closed:0,loads:0,stored:null};
 const context={Number,Math,currentUser:{id:'TEST-owner'},crmSessionGeneration:1,editingExpense:null,
 $:id=>inputs[id],canViewFinancials:()=>true,ensureCompany:async()=>'TEST-company',
 crmBeginSave:()=>{if(state.busy)return false;state.busy=true;return true;},crmEndSave:()=>state.busy=false,
 crmSaveKey:()=>'TEST-expense',crmFinishSave:()=>state.closed++,showToast:(message,type)=>state.toasts.push({message,type}),
 fmtMoney:x=>String(x),logSystemActivity:async()=>{},loadExpenses:()=>state.loads++,
 supa:{from(){let operation='select',data;const q={select(){return q;},eq(){return q;},insert(value){operation='insert';data=value;state.writes.push(value);state.stored=value;return q;},update(value){operation='update';data=value;state.writes.push(value);return q;},single:async()=>respond(operation,data,state)};return q;}}
 };
 context.crmSessionCurrent=(g,u)=>g===context.crmSessionGeneration&&u===context.currentUser?.id;
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);return {context,state,inputs};
}
test('expense save serializes double clicks and keeps milli-OMR amount',async()=>{
 let finish;const f=setup(()=>new Promise(r=>finish=r));
 const first=f.context.saveExpense();await new Promise(r=>setImmediate(r));
 await f.context.saveExpense();assert.equal(f.state.writes.length,1);assert.equal(f.state.writes[0].amount,15.005);
 finish({data:{id:'TEST-expense'},error:null});await first;assert.equal(f.state.closed,1);assert.equal(f.state.loads,1);assert.equal(f.state.busy,false);
});
test('lost expense acknowledgment retries the same id and confirms the exact stored record',async()=>{
 let attempt=0;const f=setup((op,data,state)=>op==='select'?{data:state.stored,error:null}:++attempt===1?{error:{message:'Network response lost'}}:{error:{code:'23505',message:'Duplicate id'}});
 await f.context.saveExpense();assert.equal(f.state.closed,0);assert.equal(f.inputs.exDesc.value,'Synthetic expense');
 await f.context.saveExpense();assert.equal(f.state.writes[0].id,f.state.writes[1].id);assert.equal(f.state.closed,1);assert.equal(f.state.loads,1);
});
test('zero, negative or excess-precision expense values never reach the database',async()=>{
 for(const amount of ['0','-1','1.2345','NaN']){const f=setup();f.inputs.exAmount.value=amount;await f.context.saveExpense();assert.equal(f.state.writes.length,0,amount);assert.equal(f.state.closed,0);}
});
test('old-session expense acknowledgment cannot clear a new account form',async()=>{
 let finish;const f=setup(()=>new Promise(r=>finish=r));const saving=f.context.saveExpense();await new Promise(r=>setImmediate(r));
 f.context.crmSessionGeneration++;f.context.currentUser={id:'TEST-other'};finish({data:{id:'TEST-expense'},error:null});await saving;
 assert.equal(f.state.closed,0);assert.equal(f.state.loads,0);assert.equal(f.state.toasts.length,0);assert.equal(f.inputs.exDesc.value,'Synthetic expense');
});
