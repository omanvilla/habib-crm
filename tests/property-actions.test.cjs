'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'app-base-v15.html'),'utf8');
const operations=fs.readFileSync(path.join(root,'crm-operations-v6.js'),'utf8');
function baseFunction(name){
  const match=new RegExp('(?:async )?function '+name+'\\(').exec(source);
  assert(match,'Missing base action '+name);
  for(let end=source.indexOf('}',match.index);end>=0;end=source.indexOf('}',end+1)){
    const candidate=source.slice(match.index,end+1);
    try{new vm.Script(candidate);return candidate}catch{}
  }
  throw new Error('Cannot extract '+name);
}
function harness(role='owner'){
  const nodes=new Map(),listeners={},calls=[],writes=[],confirmations=[],toasts=[];
  const rows=[
    {id:'TEST_ACTIVE',title:'TEST Active',status:'available',archived:false,branch_key:'muscat',area:'TEST Area',created_at:'2026-01-01'},
    {id:'TEST_SOLD',title:'TEST Sold',status:'sold',archived:false,branch_key:'muscat',area:'TEST Area',created_at:'2022-01-01'},
    {id:'TEST_ARCHIVED',title:'TEST Archived',status:'sold',archived:true,branch_key:'muscat',area:'TEST Area',created_at:'2020-01-01'}
  ];
  const el=id=>nodes.get(id)||null;
  for(const id of ['propertiesList','opsPropertyBranchLabel','opsPropertyArea'])nodes.set(id,{innerHTML:'',value:'',hidden:false});
  const c={console,Date,Map,Set,WeakMap,currentProfile:{role},currentUser:{id:'TEST_USER'},crmSessionGeneration:1,allProperties:[],propViewMode:'active',
    document:{getElementById:el,addEventListener(type,callback){(listeners[type]??=[]).push(callback)}},
    escapeHtml:v=>String(v).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])),
    canEdit:()=>['owner','manager','agent'].includes(c.currentProfile.role),isOwner:()=>c.currentProfile.role==='owner',
    crmSessionCurrent:(generation,user)=>generation===c.crmSessionGeneration&&user===c.currentUser?.id,
    loadProperties:async()=>{c.allProperties=rows.filter(p=>c.propViewMode==='archived'?p.archived:c.propViewMode==='sold'?!p.archived&&p.status==='sold':!p.archived&&p.status!=='sold')},
    loadDashboard:async()=>{},viewProperty:async id=>calls.push(['view',id]),editProperty:async id=>calls.push(['edit',id]),
    showToast:(message,type)=>toasts.push({message,type}),showPermissionDenied:()=>calls.push(['denied']),
    confirmAction:(title,message,icon,callback)=>confirmations.push({title,message,callback}),logSystemActivity:async()=>{},
    crmDataFrom:table=>{
      const write={table},q={update(payload){write.payload=payload;return q},eq(key,value){write[key]=value;return q},select(){return q},single(){return q},then(resolve,reject){
        writes.push(write);const row=rows.find(p=>p.id===write.id);
        if(row)Object.assign(row,write.payload);
        return Promise.resolve({data:row?{id:row.id}:null,error:row?null:{message:'TEST denied'}}).then(resolve,reject);
      }};return q;
    }
  };
  c.window=c;vm.createContext(c);
  for(const fn of ['deleteProperty','archivePropertyById','restoreProperty','restorePropertyById'])vm.runInContext(baseFunction(fn),c);
  vm.runInContext(operations,c);
  async function click(action,id){
    const button={dataset:{workAction:action,workId:id}},event={prevented:false,stopped:false,
      target:{closest:selector=>selector==='[data-work-action]'?button:null},
      preventDefault(){this.prevented=true},stopPropagation(){this.stopped=true}};
    for(const callback of listeners.click)await callback(event);
    return event;
  }
  return {c,rows,calls,writes,confirmations,toasts,click,html:()=>el('propertiesList').innerHTML};
}
test('editable roles retain useful archive controls in active/sold views and restoration in archive',async()=>{
  for(const role of ['owner','manager','agent']){
    const h=harness(role);
    for(const mode of ['active','sold']){
      h.c.propViewMode=mode;await h.c.loadProperties();
      assert.match(h.html(),/data-work-action="edit-property"/);
      assert.match(h.html(),/data-work-action="archive-property"[^>]*>أرشفة العقار/);
      assert.doesNotMatch(h.html(),/data-work-action="restore-property"/);
    }
    h.c.propViewMode='archived';await h.c.loadProperties();
    assert.match(h.html(),/مؤرشف · مباع/);
    assert.match(h.html(),/data-work-action="restore-property"[^>]*>استعادة من الأرشيف/);
    assert.doesNotMatch(h.html(),/data-work-action="(?:edit|archive)-property"/);
    assert.doesNotMatch(h.html(),/permanentDelete|حذف نهائي/);
  }
});
test('viewer only sees details and stale edit/archive/restore controls recheck permissions',async()=>{
  const h=harness('viewer');
  for(const mode of ['active','sold','archived']){
    h.c.propViewMode=mode;await h.c.loadProperties();
    assert.match(h.html(),/data-work-action="property"/);
    assert.doesNotMatch(h.html(),/data-work-action="(?:edit|archive|restore)-property"/);
    for(const action of ['edit-property','archive-property','restore-property'])await h.click(action,h.c.allProperties[0].id);
  }
  assert.equal(h.calls.filter(x=>x[0]==='denied').length,9);
  assert.equal(h.writes.length,0);assert.equal(h.confirmations.length,0);
});
test('property actions dispatch one purpose and consume navigation events; unknown/current-state mismatches do nothing',async()=>{
  const h=harness();await h.c.loadProperties();
  for(const action of ['property','edit-property','archive-property']){
    const event=await h.click(action,'TEST_ACTIVE');assert(event.prevented);assert(event.stopped);
  }
  assert.deepEqual(h.calls,[['view','TEST_ACTIVE'],['edit','TEST_ACTIVE']]);assert.equal(h.confirmations.length,1);
  await h.click('restore-property','TEST_ACTIVE');await h.click('archive-property','TEST_NOT_VISIBLE');
  assert.equal(h.confirmations.length,1);assert.equal(h.writes.length,0);
  assert.match(h.toasts[0].message,/غير موجود/);
});
test('archiving and restoring a sold property preserves sale state and historical identity',async()=>{
  const h=harness();h.c.propViewMode='sold';await h.c.loadProperties();
  const sold=h.rows.find(p=>p.id==='TEST_SOLD'),original={...sold};
  await h.click('archive-property',sold.id);
  assert.equal(h.writes.length,0);assert.match(h.confirmations[0].message,/يمكن استعادته/);
  await h.confirmations.shift().callback();await Promise.resolve();
  assert.equal(sold.archived,true);assert.equal(sold.status,'sold');assert.equal(sold.created_at,original.created_at);
  assert.doesNotMatch(h.html(),/TEST_SOLD/);
  h.c.propViewMode='archived';await h.c.loadProperties();
  assert.match(h.html(),/TEST_SOLD/);await h.click('restore-property',sold.id);
  await h.confirmations.shift().callback();await Promise.resolve();
  assert.equal(sold.archived,false);assert.equal(sold.status,'sold');assert.equal(sold.created_at,original.created_at);
  assert.doesNotMatch(h.html(),/TEST_SOLD/);
  h.c.propViewMode='sold';await h.c.loadProperties();assert.match(h.html(),/TEST_SOLD/);
  assert.equal(h.writes.length,2);assert(h.writes.every(w=>w.table==='properties'));
  assert.deepEqual(h.writes.map(w=>Object.keys(w.payload).sort()),[['archived','archived_at','archived_by'],['archived','archived_at','archived_by']]);
});
