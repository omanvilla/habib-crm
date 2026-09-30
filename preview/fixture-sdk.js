/* Synthetic UI fixture only. It is not a Supabase authentication/RLS test. */
(function(){
'use strict';
const mode=location.pathname.includes('/before/')?'before':'after';
const actor=(location.pathname.match(/\/(?:before|after)\/(owner|muscat|barka|manager|viewer)\//)||[])[1]||'owner';
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const company=uuid(1),owner=uuid(2),muscat=uuid(3),barka=uuid(4);
const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Muscat'});
const relative=days=>new Date(Date.parse(today+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);
const now=relative(0)+'T08:00:00Z';
const profiles=[
{id:owner,company_id:company,role:'owner',full_name:'مالك تجريبي',is_active:true},
{id:muscat,company_id:company,role:'agent',full_name:'موظفة مسقط التجريبية',is_active:true},
{id:barka,company_id:company,role:'agent',full_name:'موظفة بركاء التجريبية',is_active:true},
{id:uuid(5),company_id:company,role:'manager',full_name:'مدير تجريبي غير مستخدم فعلياً',is_active:true},
{id:uuid(6),company_id:company,role:'viewer',full_name:'عرض تجريبي غير مستخدم فعلياً',is_active:true}
];
const profile=profiles.find(p=>p.id===({owner,muscat,barka,manager:uuid(5),viewer:uuid(6)}[actor]));
const clients=[
{id:uuid(101),name:'عميل مسقط التجريبي',phone:'+96800000001',assigned_to:muscat,lead_route:'muscat',client_type:'buyer',is_buyer:true,lead_temperature:'warm',status:'warm',preferred_area:'الخوض',budget_max:95000,next_followup:relative(-2),human_contact_at:now},
{id:uuid(102),name:'عميلة بطلبين مستقلين',phone:'+96800000002',assigned_to:muscat,lead_route:'muscat',client_type:'buyer',is_buyer:true,lead_temperature:'hot',status:'hot',preferred_area:'الموالح',budget_max:130000,human_contact_at:now},
{id:uuid(103),name:'عميل متابعة بركاء',phone:'+96800000003',assigned_to:barka,lead_route:'barka',client_type:'buyer',is_buyer:true,lead_temperature:'warm',status:'warm',preferred_area:'الصومحان',budget_max:68000,next_followup:relative(0),human_contact_at:now},
{id:uuid(104),name:'بائعة بركاء التجريبية',phone:'+96800000004',assigned_to:barka,lead_route:'barka',client_type:'seller',is_seller:true,lead_temperature:'cold',status:'cold',preferred_area:'حي عاصم',human_contact_at:null}
].map((c,i)=>({...c,company_id:company,archived:false,followup_suppressed:false,created_at:relative(-i-2)+'T08:00:00Z',lead_score:i===1?80:40,notes:'بيانات اصطناعية؛ لا يوجد عميل حقيقي'}));
const requests=[
{id:uuid(201),client_id:uuid(101),assigned_to:muscat,branch_key:'muscat',route_key:'muscat',request_type:'buyer',preferred_area:'الخوض',budget_min:70000,budget_max:95000,next_followup:relative(-2),pipeline_stage:'qualified',qualified_at:now},
{id:uuid(202),client_id:uuid(102),assigned_to:muscat,branch_key:'muscat',route_key:'muscat',request_type:'buyer',preferred_area:'الموالح',budget_min:100000,budget_max:130000,next_followup:relative(0),pipeline_stage:'negotiation'},
{id:uuid(203),client_id:uuid(102),assigned_to:muscat,branch_key:'muscat',route_key:'muscat',request_type:'tenant',preferred_area:'المعبيلة',budget_min:200,budget_max:350,next_followup:relative(3),pipeline_stage:'new'},
{id:uuid(204),client_id:uuid(103),assigned_to:barka,branch_key:'barka',route_key:'barka',request_type:'buyer',preferred_area:'الصومحان',budget_min:55000,budget_max:68000,next_followup:relative(0),pipeline_stage:'qualified',qualified_at:now},
{id:uuid(205),client_id:uuid(104),assigned_to:barka,branch_key:'barka',route_key:'barka',request_type:'seller',preferred_area:'حي عاصم',budget_max:75000,next_followup:null,pipeline_stage:'new'}
].map(r=>({...r,company_id:company,status:'active',lead_temperature:r.pipeline_stage==='qualified'?'hot':'warm',property_type:'villa',property_types:['villa'],preferred_areas:[r.preferred_area],created_at:relative(-5)+'T08:00:00Z',updated_at:now,created_via:'manual'}));
const properties=[
{id:uuid(301),title:'فيلا عائلية في الخوض',property_code:'TEST-M01',branch_key:'muscat',wilayat:'السيب',area:'الخوض',price:89000,status:'available',bedrooms:4,land_size:300,sourced_by:muscat},
{id:uuid(302),title:'فيلا الموالح بحديقة',property_code:'TEST-M02',branch_key:'muscat',wilayat:'السيب',area:'الموالح',price:125000,status:'negotiating',bedrooms:5,land_size:360,sourced_by:muscat},
{id:uuid(303),title:'شقة المعبيلة للإيجار',property_code:'TEST-M03',branch_key:'muscat',wilayat:'السيب',area:'المعبيلة',price:300,status:'available',bedrooms:2,land_size:110,type:'apartment',sourced_by:muscat},
{id:uuid(304),title:'فيلا الصومحان الجديدة',property_code:'TEST-B01',branch_key:'barka',wilayat:'بركاء',area:'الصومحان',price:65000,status:'reserved',bedrooms:4,land_size:330,sourced_by:barka},
{id:uuid(305),title:'فيلا حي عاصم',property_code:'TEST-B02',branch_key:'barka',wilayat:'بركاء',area:'حي عاصم',price:75000,status:'available',bedrooms:4,land_size:400,sourced_by:barka}
].map((p,i)=>({...p,type:p.type||'villa',company_id:company,added_by:p.sourced_by,archived:false,images:[],created_at:relative(-i-1)+'T08:00:00Z',updated_at:now,expected_commission:900,owner_net:p.price-900}));
const visits=[
{id:uuid(401),client_id:uuid(101),request_id:uuid(201),property_id:uuid(301),agent_id:muscat,viewing_date:relative(0),viewing_time:'11:00:00',status:'confirmed'},
{id:uuid(402),client_id:uuid(102),request_id:uuid(202),property_id:uuid(302),agent_id:muscat,viewing_date:relative(1),viewing_time:'16:30:00',status:'scheduled'},
{id:uuid(403),client_id:uuid(103),request_id:uuid(204),property_id:uuid(304),agent_id:barka,viewing_date:relative(0),viewing_time:'17:00:00',status:'scheduled'},
{id:uuid(404),client_id:uuid(101),request_id:uuid(201),property_id:uuid(301),agent_id:muscat,viewing_date:relative(-4),viewing_time:'12:00:00',status:'done'},
{id:uuid(405),client_id:uuid(101),request_id:uuid(201),property_id:uuid(301),agent_id:muscat,viewing_date:relative(-3),viewing_time:'12:00:00',status:'done'},
{id:uuid(406),client_id:uuid(101),request_id:uuid(201),property_id:uuid(301),agent_id:muscat,viewing_date:relative(-2),viewing_time:'12:00:00',status:'cancelled'}
].map(v=>({...v,company_id:company,created_by:v.agent_id,created_at:now,archived:false,row_version:1,duration_minutes:60,pipeline_outcome:v.status==='done'?'followup':null}));
const db={profiles,companies:[{id:company,name:'أبناء حبيب · شركة اختبار',default_company_commission:0}],clients,client_requests:requests,properties,viewings:visits,
tasks:[
{id:uuid(501),user_id:muscat,client_id:uuid(101),request_id:uuid(201),title:'تأكيد موعد زيارة الخوض',due_date:relative(0),priority:'high'},
{id:uuid(502),user_id:muscat,client_id:uuid(102),request_id:uuid(202),title:'توثيق نتيجة التفاوض على طلب الشراء',due_date:relative(-1),priority:'high'},
{id:uuid(503),user_id:barka,client_id:uuid(103),request_id:uuid(204),title:'متابعة تمويل الصومحان',due_date:relative(0),priority:'medium'}
].map(t=>({...t,company_id:company,done:false,created_at:now})),
deals:[{id:uuid(601),company_id:company,client_id:uuid(102),request_id:uuid(202),property_id:uuid(302),agent_id:muscat,stage:'negotiation',updated_at:now,created_at:now,company_commission:500}],
property_inquiries:[
{id:uuid(701),company_id:company,client_id:uuid(101),request_id:uuid(201),property_id:uuid(301),assigned_to:muscat,has_inbound_inquiry:true,inquiry_count:2,status:'viewed',source:'whatsapp'},
{id:uuid(702),company_id:company,client_id:uuid(102),request_id:uuid(202),property_id:uuid(302),assigned_to:muscat,has_inbound_inquiry:false,inquiry_count:1,status:'viewing_scheduled',source:'other'}
],
property_marketing_events:[
{id:uuid(801),company_id:company,property_id:uuid(301),channel:'instagram',event_type:'publish',views:0,reach:0,total_interactions:0,last_synced_at:now,published_at:now,sync_status:'synced',url:'https://www.instagram.com/reel/TESTZERO/',link_key:'instagram:TESTZERO',created_at:now},
{id:uuid(802),company_id:company,property_id:uuid(302),channel:'instagram',event_type:'publish',views:null,reach:null,total_interactions:null,last_synced_at:null,sync_status:'manual',url:'https://www.instagram.com/reel/TESTNULL/',link_key:'instagram:TESTNULL',created_at:now},
{id:uuid(803),company_id:company,property_id:uuid(304),channel:'instagram',event_type:'publish',views:1200,reach:800,total_interactions:30,last_synced_at:relative(-7)+'T08:00:00Z',sync_status:'error',sync_error:'TEST stale metric',url:'https://www.instagram.com/reel/TESTOLD/',link_key:'instagram:TESTOLD',created_at:now}
]};
const signedOutKey='crm-preview-signedout:'+location.pathname;
let signedOut=sessionStorage.getItem(signedOutKey)==='true',listeners=[],next=1000;
const state={actor,mode,profile,db,calls:[],failNext:null,externalRequests:0,synthetic:true};
window.CRMPREVIEW=state;
function allowed(row,table){
 if(!row)return false;
 if(profile.role!=='agent')return true;
 const branch=actor;
 if(['properties'].includes(table))return row.branch_key===branch;
 if(table==='clients')return row.lead_route===branch;
 if(table==='client_requests')return row.branch_key===branch;
 if(table==='profiles')return row.id===profile.id;
 if(table==='companies')return row.id===company;
 if(table==='tasks')return row.user_id===profile.id;
 if(row.property_id)return properties.some(p=>p.id===row.property_id&&p.branch_key===branch);
 if(row.client_id)return clients.some(c=>c.id===row.client_id&&c.lead_route===branch);
 return row.company_id===company&&(!row.user_id||row.user_id===profile.id);
}
function decorate(row){
 const result={...row};
 if(row.client_id)result.client=clients.find(c=>c.id===row.client_id);
 if(row.property_id)result.property=properties.find(p=>p.id===row.property_id);
 if(row.agent_id||row.assigned_to)result.agent=profiles.find(p=>p.id===(row.agent_id||row.assigned_to));
 if(profile.role!=='owner'){result.owner_net=null;result.expected_commission=null;result.company_commission=null;result.agent_commission=null;}
 return result;
}
function query(name){
 const table=({crm_properties_access:'properties',crm_deals_access:'deals'}[name]||name);
 let predicates=[],orders=[],range=null,limit=null,single=false,head=false,operation=null;
 const q={
 select(_columns,options){head=!!options?.head;return q;},
 eq(k,v){predicates.push(r=>r[k]===v);return q;},neq(k,v){predicates.push(r=>r[k]!==v);return q;},
 in(k,v){predicates.push(r=>v.includes(r[k]));return q;},
 gte(k,v){predicates.push(r=>r[k]>=v);return q;},gt(k,v){predicates.push(r=>r[k]>v);return q;},
 lte(k,v){predicates.push(r=>r[k]<=v);return q;},lt(k,v){predicates.push(r=>r[k]<v);return q;},
 is(k,v){predicates.push(r=>r[k]===v||(v===null&&r[k]==null));return q;},
 not(k,op,v){const values=String(v).replace(/[()]/g,'').split(',');predicates.push(r=>!values.includes(r[k]));return q;},
 ilike(k,v){predicates.push(r=>String(r[k]||'').toLowerCase().includes(String(v).replace(/%/g,'').toLowerCase()));return q;},
 or(){return q;},order(k,opts={}){orders.push([k,opts.ascending!==false]);return q;},
 range(a,b){range=[a,b];return q;},limit(v){limit=v;return q;},single(){single=true;return q;},maybeSingle(){single=true;return q;},
 insert(v){operation=['insert',v];return q;},update(v){operation=['update',v];return q;},upsert(v){operation=['upsert',v];return q;},
 delete(){operation=['delete'];return q;},
 then(resolve,reject){return Promise.resolve().then(()=>{
  state.calls.push({table,operation:operation?.[0]||'read'});
  if(signedOut)return {data:null,error:{message:'TEST session signed out'}};
  if(state.failNext===table){state.failNext=null;return {data:null,error:{message:'TEST simulated save/load failure'}};}
  let source=db[table]||[],rows=source.filter(r=>allowed(r,table)&&predicates.every(p=>p(r)));
  if(operation){
   if(operation[0]==='delete')return {data:null,error:{message:'TEST permanent delete disabled'}};
   if(operation[0]==='insert'||operation[0]==='upsert'){
    const values=Array.isArray(operation[1])?operation[1]:[operation[1]];
    rows=[];
    for(const value of values){
     const record={id:value.id||uuid(next++),company_id:company,created_at:now,updated_at:now,archived:false,...value};
     if(table==='clients'&&!record.lead_route)record.lead_route=actor==='barka'?'barka':'muscat';
     if(table==='client_requests'&&!record.branch_key)record.branch_key=actor==='barka'?'barka':'muscat';
     if(table==='properties'&&!record.branch_key)record.branch_key=record.wilayat==='بركاء'?'barka':'muscat';
     if(!allowed(record,table))return {data:null,error:{message:'TEST fixture scope denial'}};
     if(source.some(r=>r.id===record.id))return {data:null,error:{code:'23505',message:'TEST duplicate ID'}};
     source.push(record);rows.push(record);
    }
    db[table]=source;
   }else{
    if(!rows.length)return {data:null,error:{message:'TEST record not found'}};
    rows.forEach(r=>Object.assign(r,operation[1]));
   }
  }
  for(const [key,asc] of orders.slice().reverse())rows.sort((a,b)=>String(a[key]||'').localeCompare(String(b[key]||''))*(asc?1:-1));
  const count=rows.length;
  if(range)rows=rows.slice(range[0],range[1]+1);
  if(limit!==null)rows=rows.slice(0,limit);
  const data=rows.map(decorate);
  return {data:head?null:single?(data[0]||null):data,count,error:single&&!data.length?{message:'TEST record not found'}:null};
 }).then(resolve,reject);}
 };return q;
}
const client={
from:query,
rpc:async(name,args={})=>{
 state.calls.push({rpc:name});
 if(signedOut)return {data:null,error:{message:'TEST signed out'}};
 if(name==='crm_client_contact_queue')return {data:clients.filter(c=>allowed(c,'clients')&&!c.human_contact_at).map(c=>({client_id:c.id})),error:null};
 if(name==='crm_property_action_queue')return {data:[],error:null};
 if(name==='crm_employee_performance')return {data:{from:args.p_from,to:args.p_to,employees:profiles.filter(p=>p.role==='agent'&&(profile.role!=='agent'||p.id===profile.id)).map(p=>({employee_id:p.id,name:p.full_name,active_inventory:2,new_properties:0,inquiries:0,visits_booked:0,visits_done:0,sales:0,activities:0,outbound_messages:0,targets:{}}))},error:null};
 if(name==='crm_property_acquisition_funnel')return {data:[],error:null};
 if(name==='crm_client_360')return {data:{requests:requests.filter(r=>r.client_id===args.p_client_id&&allowed(r,'client_requests')),property_journey:[],appointments:[],activities:[],tasks:[],deals:[],whatsapp:[]},error:null};
 if(name==='crm_data_quality_summary')return {data:[],error:null};
 return {data:[],error:null};
},
auth:{
 getSession:async()=>({data:{session:signedOut?null:{user:{id:profile.id},access_token:'TEST_NOT_A_REAL_JWT'}}}),
 getUser:async()=>({data:{user:signedOut?null:{id:profile.id}}}),
 onAuthStateChange(fn){listeners.push(fn);return {data:{subscription:{unsubscribe(){}}}};},
 signOut:async()=>{signedOut=true;sessionStorage.setItem(signedOutKey,'true');listeners.forEach(fn=>fn('SIGNED_OUT',null));return {error:null};},
 signInWithPassword:async()=>({error:{message:'المعاينة لا تستقبل كلمات مرور؛ استخدم بدء جلسة المعاينة'}}),
 updateUser:async()=>({error:{message:'تغيير كلمة المرور معطل في المعاينة'}})
},
functions:{invoke:async(name,params)=>{
 state.calls.push({function:name,action:params?.body?.action,blocked:true});
 const action=params?.body?.action;
 if(name==='whatsapp-inbox'&&action==='list')return {data:{ok:true,conversations:[],unread_total:0},error:null};
 if(name==='instagram-api'&&action==='status')return {data:{ok:true,connected:false},error:null};
 return {data:null,error:{message:'TEST outbound, media download, AI and automation disabled'}};
}},
storage:{from:()=>({upload:async()=>({error:{message:'TEST uploads need an isolated Storage backend'}}),remove:async()=>({error:{message:'TEST delete disabled'}}),getPublicUrl:()=>({data:{publicUrl:''}})})},
channel(){const channel={on(){return channel},subscribe(){return channel},unsubscribe(){}};return channel;},removeChannel(){}
};
window.supabase={createClient:()=>client};
window.open=()=>{alert('فتح خدمات خارجية معطل في المعاينة');return null;};
document.addEventListener('click',e=>{const a=e.target.closest('a');if(a&&a.href&&!a.href.startsWith(location.origin)&&!a.href.startsWith('blob:')){e.preventDefault();alert('لا اتصال خارجي في المعاينة');}},true);
document.addEventListener('DOMContentLoaded',()=>{
 const banner=document.createElement('div');banner.id='crmPreviewSafety';banner.style.cssText='position:sticky;top:0;z-index:100000;background:#173e32;color:#fff;padding:10px 18px;font:12px Arial;direction:rtl;display:flex;gap:14px;flex-wrap:wrap;align-items:center';
 const phase=mode==='before'?'قبل':'بعد';
 banner.innerHTML='<strong>معاينة '+phase+' · بيانات اصطناعية · لا اتصال بالإنتاج</strong><span>الأدوار هنا محاكاة للواجهة، وليست جلسات الموظفين</span><a style="color:white" href="/'+(mode==='before'?'after':'before')+'/'+actor+'/">عرض '+(mode==='before'?'بعد':'قبل')+'</a>'+['owner','muscat','barka'].map(a=>'<a style="color:white" href="/'+mode+'/'+a+'/">'+({owner:'المالك',muscat:'مسقط',barka:'بركاء'}[a])+'</a>').join('')+'<button id="previewRestart">بدء جلسة معاينة جديدة</button>';
 document.body.prepend(banner);
 document.getElementById('previewRestart').onclick=()=>{sessionStorage.removeItem(signedOutKey);location.reload();};
 window.addEventListener('pagehide',()=>{state.externalRequests=0;});
});
})();