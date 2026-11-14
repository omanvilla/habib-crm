// 13 Nov 2026 (Ahmed): the report about a property for its owner. It opens on the screen to be read first, then is saved as
// a PDF, copied as text or downloaded for Excel; the CRM sends nothing. It replaced the raw CSV of crm-operations-v6.js.
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('crm-owner-report.js','utf8'),css=fs.readFileSync('crm-owner-report.css','utf8');
const index=fs.readFileSync('index.html','utf8'),base=fs.readFileSync('app-base-v15.html','utf8');

function fixture(){
  const queries=[],downloads=[],toasts=[],shownNodes=[],classes=new Set(),selected=[];
  const node=()=>{const n={attrs:{},innerHTML:'',parentNode:null,listeners:{},setAttribute(k,v){n.attrs[k]=v;},addEventListener(k,f){n.listeners[k]=f;},appendChild(){},
    removeChild(){}};return n;};
  const body={appendChild(n){n.parentNode=body;shownNodes.push(n);},removeChild(n){n.parentNode=null;shownNodes.splice(shownNodes.indexOf(n),1);},
    classList:{add:(...c)=>c.forEach(x=>classes.add(x)),remove:(...c)=>c.forEach(x=>classes.delete(x))}};
  const context={URL,document:{body,title:'TEST CRM',createElement:node,addEventListener(){}},navigator:{},
    currentUser:{id:'TEST-owner'},currentCompany:{name:'TEST Office'},crmSessionGeneration:1,
    viewingProperty:{id:'TEST-property',title:'TEST owner property',area:'TEST area',wilayat:'TEST wilayat',price:59000,created_at:'2026-10-13T08:00:00+00:00',has_listing_agreement:false},
    downloadCSV:(...args)=>downloads.push(args),showToast:(...args)=>toasts.push(args),
    supa:{from:table=>{const promise=new Promise(resolve=>queries.push({table,resolve}));
      const query={select(columns){selected.push({table,columns});return query;},eq(){return query;},order(){return query;},then:promise.then.bind(promise)};return query;}}};
  context.crmSessionCurrent=(generation,user)=>context.crmSessionGeneration===generation&&context.currentUser?.id===user;
  context.crmResetOperations=()=>{context.resetRan=true;};
  context.window=context;vm.createContext(context);vm.runInContext(source,context);
  return {context,queries,downloads,toasts,shownNodes,classes,selected};
}
const NOW=new Date('2026-11-13T10:00:00+04:00');
const INQUIRIES=[
  {client_id:'TEST-c1',has_inbound_inquiry:true,status:'inquiry',rejection_reason:null},
  {client_id:'TEST-c1',has_inbound_inquiry:true,status:'viewed',rejection_reason:null},
  {client_id:'TEST-c2',has_inbound_inquiry:true,status:'not_suitable',rejection_reason:'location'},
  {client_id:'TEST-c3',has_inbound_inquiry:false,status:'not_suitable',rejection_reason:'layout'},
  {client_id:'TEST-c4',has_inbound_inquiry:false,status:'not_suitable',rejection_reason:'location'},
  {client_id:'TEST-c5',has_inbound_inquiry:true,status:'not_suitable',rejection_reason:'property_unavailable'},
  {client_id:'TEST-c6',has_inbound_inquiry:true,status:'not_suitable',rejection_reason:'client_not_ready'},
  {client_id:'TEST-c7',has_inbound_inquiry:true,status:'negotiation',rejection_reason:null}];
const VIEWINGS=[
  {client_id:'TEST-c1',status:'done',archived:false},{client_id:'TEST-c3',status:'done',archived:false},{client_id:'TEST-c4',status:'no_show',archived:false},
  {client_id:'TEST-c8',status:'scheduled',archived:false},{client_id:'TEST-c9',status:'cancelled',archived:false},{client_id:'TEST-c9',status:'done',archived:true}];
const MARKETING=[
  {channel:'instagram',event_type:'publish',published_at:'2026-11-02T10:00:00+00:00',views:8124,plays:null,reach:5999,total_interactions:313,last_synced_at:'2026-11-13T05:00:00+00:00',url:'https://www.instagram.com/reel/TESTb/',notes:'TEST INTERNAL NOTE linked by the office'},
  {channel:'instagram',event_type:'publish',published_at:'2026-10-13T10:00:00+00:00',views:null,plays:41480,reach:32683,total_interactions:938,last_synced_at:'2026-11-12T05:00:00+00:00',url:'https://www.instagram.com/reel/TESTa/',notes:null},
  {channel:'youtube',event_type:'publish',published_at:null,views:null,plays:null,reach:null,total_interactions:null,last_synced_at:null,url:'javascript:alert(1)',notes:'TEST INTERNAL NOTE 2'}];
const model=()=>fixture().context.crmOwnerReport.build({title:'TEST owner property',area:'TEST area',wilayat:'TEST wilayat',price:59000,created_at:'2026-10-13T08:00:00+00:00',has_listing_agreement:false,company_name:'TEST Office'},INQUIRIES,VIEWINGS,MARKETING,NOW);

test('the numbers: period, totals, visits by what happened, clients counted apart',()=>{
  const m=model();
  assert.equal(m.place,'TEST area ، TEST wilayat');
  assert.equal(fixture().context.crmOwnerReport.build({title:'TEST',area:'بركاء الرميس',wilayat:'بركاء',created_at:'2026-10-13T08:00:00+00:00'},[],[],[],NOW).place,'بركاء الرميس','a wilayat the area already names is not repeated');
  assert.equal(m.startKind,'registered');assert.equal(m.days,31,'13 Oct to 13 Nov by the Muscat calendar');
  assert.equal(m.marketing.count,3);
  assert.deepEqual(JSON.parse(JSON.stringify(m.marketing.views)),{total:49604,known:2},'plays stand in for views; the post with no number is not a zero');
  assert.deepEqual(JSON.parse(JSON.stringify(m.marketing.interactions)),{total:1251,known:2});
  assert.deepEqual(JSON.parse(JSON.stringify(m.marketing.channels.map(c=>[c.label,c.count,c.views.known]))),[['إنستغرام',2,2],['يوتيوب',1,0]]);
  assert.equal(m.marketing.posts[0].url,'https://www.instagram.com/reel/TESTa/','oldest post first');
  assert.equal(m.marketing.posts[2].url,'','only http(s) links are kept');
  assert.deepEqual(JSON.parse(JSON.stringify(m.clients)),{inbound:5,visitOnly:2},'c1 counted once; c3 and c4 are known only from a visit');
  assert.deepEqual(JSON.parse(JSON.stringify(m.visits)),{done:2,scheduled:1,noShow:1,cancelled:1},'an archived visit is not counted');
  assert.equal(m.feedback.negotiation,1);
  assert.equal(m.feedback.notSuitable,4,'«the property was no longer available» is not an opinion on the property');
  assert.deepEqual(JSON.parse(JSON.stringify(m.feedback.reasons)),[{label:'الموقع',count:2},{label:'تقسيم الغرف',count:1},{label:'أسباب أخرى',count:1}]);
});
test('a listing agreement gives the start of the period',()=>{
  const f=fixture(),m=f.context.crmOwnerReport.build({title:'TEST',created_at:'2026-10-14T08:00:00+00:00',has_listing_agreement:true,agreement_start_date:'2026-09-28'},[],[],[],NOW);
  assert.equal(m.startKind,'agreement');assert.equal(m.days,46);
  assert.equal(m.marketing.count,0);assert.equal(m.marketing.views.known,0);
  assert.match(f.context.crmOwnerReport.html(m),/لا توجد منشورات مسجلة/);
  assert.match(f.context.crmOwnerReport.html(m),/من بداية الاتفاقية/);
});
test('what the owner reads: Arabic words, totals, «غير متاح» for a missing number, and never an office note',()=>{
  const f=fixture(),m=model(),api=f.context.crmOwnerReport,html=api.html(m),text=api.text(m),rows=JSON.parse(JSON.stringify(api.csvRows(m)));
  for(const out of [html,text,JSON.stringify(rows)]){
    assert(!out.includes('TEST INTERNAL NOTE'),'office notes stay in the office');
    assert(!/instagram(?!\.com)|publish|youtube/.test(out),'no raw channel or activity keys');
    assert(out.includes('49,604')||out.includes('49604'),'total views');
    assert(out.includes('غير متاح'),'a number Meta did not give is not a zero');
  }
  assert(html.includes('TEST Office')&&html.includes('تقرير أداء العقار')&&html.includes('59,000 ر.ع')&&html.includes('(31 يوم)'));
  assert(html.includes('المشاهدات متاحة لـ 2 من 3 منشورات'));
  assert(html.includes('حجز ولم يحضر')&&html.includes('زيارات مجدولة')&&html.includes('السبب: الموقع'));
  assert(!html.includes('javascript:'),'an unsafe link is never written');
  assert(html.includes('href="https://www.instagram.com/reel/TESTa/" target="_blank" rel="noopener noreferrer"'));
  assert(text.startsWith('تقرير أداء العقار\nالعقار: TEST owner property')&&text.includes('• مجموع المشاهدات: 49,604')&&text.includes('• زيارات تمت: 2'));
  assert.deepEqual(rows.find(r=>r[0]==='مجموع المشاهدات'),['مجموع المشاهدات',49604]);
  assert.deepEqual(rows.find(r=>r[0]==='زيارات ألغيت'),['زيارات ألغيت',1]);
  assert.deepEqual(rows.find(r=>r[0]==='القناة'),['القناة','النشاط','التاريخ','المشاهدات','الوصول','التفاعلات','الرابط'],'no notes column');
  const escaped=api.html(api.build({title:'<img src=x onerror=1>',created_at:'2026-10-13T08:00:00+00:00'},[],[],[],NOW));
  assert(!escaped.includes('<img')&&escaped.includes('&lt;img'));
});
test('the button opens the report on the screen; nothing is downloaded or sent by itself',async()=>{
  const f=fixture(),opening=f.context.exportPropertyOwnerReport();
  assert.deepEqual(f.queries.map(q=>q.table),['property_inquiries','viewings','property_marketing_events']);
  assert(!f.selected.some(s=>/notes|\*/.test(s.columns)),'the office notes are not even read');
  f.queries[0].resolve({data:INQUIRIES,error:null});f.queries[1].resolve({data:VIEWINGS,error:null});f.queries[2].resolve({data:MARKETING,error:null});await opening;
  assert.equal(f.shownNodes.length,1);assert.equal(f.downloads.length,0);assert.equal(f.toasts.length,0);
  const node=f.shownNodes[0];
  assert.equal(node.id,'crmOwnerReport');assert(f.classes.has('cor-open'));
  assert(node.innerHTML.includes('data-cor="print"')&&node.innerHTML.includes('data-cor="copy"')&&node.innerHTML.includes('data-cor="excel"')&&node.innerHTML.includes('data-cor="close"'));
  assert(node.innerHTML.includes('لا يُرسل أي شيء للمالك من النظام')&&node.innerHTML.includes('TEST owner property'));
  const press=action=>node.listeners.click({target:{closest:()=>({getAttribute:()=>action})}});
  press('excel');assert.equal(f.downloads.length,1);assert.equal(f.downloads[0][0],'تقرير-أداء-TEST owner property');
  press('close');assert.equal(f.shownNodes.length,0);assert(!f.classes.has('cor-open'));
});
test('the report appears only for the session and the property that asked for it',async()=>{
  for(const changed of ['none','logout','switch-user','same-user-new-session','other-property']){
    const f=fixture(),opening=f.context.exportPropertyOwnerReport();
    if(changed==='logout'){f.context.currentUser=null;f.context.crmSessionGeneration++;}
    if(changed==='switch-user')f.context.currentUser={id:'TEST-other-user'};
    if(changed==='same-user-new-session')f.context.crmSessionGeneration++;
    if(changed==='other-property')f.context.viewingProperty={id:'TEST-other-property',title:'TEST other'};
    f.queries.forEach(q=>q.resolve({data:[],error:null}));await opening;
    assert.equal(f.shownNodes.length,changed==='none'?1:0,changed);assert.equal(f.toasts.length,0,changed);
  }
});
test('an error from an old session does not surface in the next account; a current one says so',async()=>{
  const old=fixture(),stale=old.context.exportPropertyOwnerReport();
  old.context.currentUser={id:'TEST-other-user'};old.context.crmSessionGeneration++;
  old.queries.forEach(q=>q.resolve({data:null,error:{message:'TEST previous account error'}}));await stale;
  assert.equal(old.shownNodes.length,0);assert.equal(old.toasts.length,0);
  const f=fixture(),failing=f.context.exportPropertyOwnerReport();
  f.queries.forEach(q=>q.resolve({data:null,error:{message:'TEST read error'}}));await failing;
  assert.equal(f.shownNodes.length,0);assert.equal(f.toasts.length,1);assert.match(f.toasts[0][0],/تعذر إعداد التقرير: TEST read error/);
});
// On the real page currentUser, crmSessionGeneration, supa and currentCompany are «let» variables of app-base-v15.html, not
// properties of window. The first version read them from window and the button did nothing (seen on the live page, 13 Nov).
test('the report opens when the session variables are page variables, as in app-base-v15.html',async()=>{
  const f=fixture(),c=f.context;
  const kept={supa:c.supa};
  for(const key of ['currentUser','crmSessionGeneration','supa','currentCompany'])delete c[key];
  c.__supa=kept.supa;
  vm.runInContext("let currentUser={id:'TEST-owner'},crmSessionGeneration=1,supa=__supa,currentCompany={name:'TEST Office'};",c);
  c.crmSessionCurrent=(generation,user)=>vm.runInContext('crmSessionGeneration',c)===generation&&vm.runInContext('currentUser&&currentUser.id',c)===user;
  assert.equal('currentUser' in c,false);assert.equal('supa' in c,false);
  assert(/\blet currentUser\b/.test(base)&&/\blet crmSessionGeneration\b/.test(base)&&/\bconst supa\b/.test(base),'the page still declares them this way');
  const opening=c.exportPropertyOwnerReport();
  assert.equal(f.queries.length,3,'the three reads started');
  f.queries.forEach(q=>q.resolve({data:[],error:null}));await opening;
  assert.equal(f.shownNodes.length,1);assert(f.shownNodes[0].innerHTML.includes('TEST Office'));
  const stale=c.exportPropertyOwnerReport();vm.runInContext('crmSessionGeneration++',c);
  f.queries.slice(3).forEach(q=>q.resolve({data:[],error:null}));await stale;
  assert.equal(f.shownNodes.length,1,'a report asked for by the earlier session is not drawn');
});
test('the report leaves the screen when the session is reset',async()=>{
  const f=fixture(),opening=f.context.exportPropertyOwnerReport();
  f.queries.forEach(q=>q.resolve({data:[],error:null}));await opening;assert.equal(f.shownNodes.length,1);
  f.context.crmResetOperations();
  assert.equal(f.shownNodes.length,0);assert.equal(f.context.resetRan,true,'the reset it wraps still runs');
});
test('loaded after the operations module, printed alone, and the button no longer says CSV',()=>{
  const close='"><'+String.fromCharCode(92)+'/script>';
  assert(index.includes('crm-owner-report.js?v=20261113-rep1'+close),'inside the boot script with an escaped closing tag');
  assert(index.indexOf('crm-owner-report.js?v=')>index.indexOf('crm-operations-v6.js?v='),'after crmResetOperations exists');
  assert(index.includes('<link rel="stylesheet" href="crm-owner-report.css?v=20261113-rep1">'));
  assert(index.includes('app-base-v15.html?v=20261114-util1')&&index.includes('crm-operations-v6.js?v=20261113-rep1'));
  assert(base.includes('onclick="exportPropertyOwnerReport()">📤 تقرير المالك</button>')&&!base.includes('تقرير المالك CSV'));
  assert(css.includes('body.cor-printing>*:not(#crmOwnerReport){display:none!important}')&&css.includes('body.cor-printing .cor-bar,body.cor-printing .cor-hint{display:none!important}'));
  assert(!/fetch\(|whatsapp-send|functions\/v1/.test(source),'the module sends nothing anywhere');
});
