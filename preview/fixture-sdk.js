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
{id:uuid(105),name:'المستثمر الخاص الاصطناعي',phone:'+96800000005',assigned_to:owner,lead_route:'investment',client_type:'investor',is_investor:true,lead_temperature:'cold',status:'cold'},
{id:uuid(104),name:'بائعة بركاء التجريبية',phone:'+96800000004',assigned_to:barka,lead_route:'barka',client_type:'seller',is_seller:true,lead_temperature:'cold',status:'cold',preferred_area:'حي عاصم',human_contact_at:null}
].map((c,i)=>({...c,phone_normalized:c.phone,company_id:company,archived:false,followup_suppressed:false,created_at:relative(-i-2)+'T08:00:00Z',lead_score:i===1?80:40,notes:'بيانات اصطناعية؛ لا يوجد عميل حقيقي'}));
const requests=[
{id:uuid(206),client_id:uuid(105),assigned_to:owner,branch_key:'investment',route_key:'investment',request_type:'investor',preferred_area:null,pipeline_stage:'new'},
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
].map((p,i)=>({...p,type:p.type||'villa',company_id:company,added_by:p.sourced_by,owner_id:uuid(p.branch_key==='barka'?902:901),archived:false,images:[],created_at:relative(-i-1)+'T08:00:00Z',updated_at:now,expected_commission:900,owner_net:p.price-900}));
const visits=[
{id:uuid(401),client_id:uuid(101),request_id:uuid(201),property_id:uuid(301),agent_id:muscat,viewing_date:relative(0),viewing_time:'11:00:00',status:'confirmed'},
{id:uuid(402),client_id:uuid(102),request_id:uuid(202),property_id:uuid(302),agent_id:muscat,viewing_date:relative(1),viewing_time:'16:30:00',status:'scheduled'},
{id:uuid(403),client_id:uuid(103),request_id:uuid(204),property_id:uuid(304),agent_id:barka,viewing_date:relative(0),viewing_time:'17:00:00',status:'scheduled'},
{id:uuid(404),client_id:uuid(101),request_id:uuid(201),property_id:uuid(301),agent_id:muscat,viewing_date:relative(-4),viewing_time:'12:00:00',status:'done'},
{id:uuid(405),client_id:uuid(101),request_id:uuid(201),property_id:uuid(301),agent_id:muscat,viewing_date:relative(-3),viewing_time:'12:00:00',status:'done'},
{id:uuid(406),client_id:uuid(101),request_id:uuid(201),property_id:uuid(301),agent_id:muscat,viewing_date:relative(-2),viewing_time:'12:00:00',status:'cancelled'}
].map(v=>({...v,company_id:company,created_by:v.agent_id,created_at:now,archived:false,row_version:1,duration_minutes:60,pipeline_outcome:v.status==='done'?'followup':null}));
const db={profiles,companies:[{id:company,name:'أبناء حبيب · شركة اختبار',created_at:'2026-05-06T15:00:00Z',default_company_commission:0}],clients,client_requests:requests,properties,viewings:visits,
owners:[{id:uuid(901),company_id:company,added_by:muscat,name:'مالك مسقط الاصطناعي',phone:'+96800000011',owner_type:'owner',archived:false},{id:uuid(902),company_id:company,added_by:barka,name:'مالك بركاء الاصطناعي',phone:'+96800000012',owner_type:'owner',archived:false}],
company_lead_routes:[{id:uuid(1301),company_id:company,route_key:'muscat',label:'مسقط',assigned_to:muscat,is_active:true},{id:uuid(1302),company_id:company,route_key:'barka',label:'بركاء',assigned_to:barka,is_active:true}],
rejection_reasons:[{id:uuid(1401),company_id:null,code:'price_high',label_ar:'السعر أعلى من الميزانية',category:'price',is_active:true,sort_order:1},{id:uuid(1402),company_id:null,code:'location',label_ar:'الموقع غير مناسب',category:'property',is_active:true,sort_order:2}],
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
// Minimal synthetic model for the SQL target/private-property contract.
// It is not an implementation or test of production RLS.
function privateProperty(id){
 return (db.client_requests||[]).some(r=>r.subject_property_id===id&&(r.route_key==='investment'||r.branch_key==='investment'||db.clients.some(c=>c.id===r.client_id&&c.lead_route==='investment')));
}
function allowed(row,table){
 if(!row)return false;
 // Model owner-only investment reads for UI tests; real RLS is tested separately in SQL.
 if(profile.role!=='owner'){
  if(table==='properties'&&privateProperty(row.id))return false;
  const privateClient=id=>clients.some(c=>c.id===id&&c.lead_route==='investment');
  const request=requests.find(r=>r.id===row.request_id);
  if(row.lead_route==='investment'||row.route_key==='investment'||row.branch_key==='investment'||privateClient(row.client_id)||request&&(request.route_key==='investment'||request.branch_key==='investment'||privateClient(request.client_id)))return false;
 }
 if(profile.role!=='agent')return true;
 const branch=actor;
 if(['properties'].includes(table))return row.branch_key===branch;
 if(table==='clients')return row.lead_route===branch;
 if(table==='client_requests')return row.branch_key===branch;
 if(table==='owners')return properties.some(p=>p.owner_id===row.id&&p.branch_key===branch);
 if(table==='company_lead_routes')return row.route_key===branch;
 if(table==='rejection_reasons')return row.company_id==null||row.company_id===company;
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
 if(profile.role!=='owner')for(const field of ['owner_net','expected_commission','company_commission','agent_commission','commission_total','company_share','agent_share','broker_id','broker_commission','employee_commission_percent'])result[field]=null;
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
     if(table==='clients'&&record.phone){
      record.phone_normalized='+'+String(record.phone).replace(/\D/g,'');
      if(source.some(r=>r.company_id===record.company_id&&r.phone_normalized===record.phone_normalized))return {data:null,error:{code:'23505',message:'TEST duplicate normalized phone'}};
     }
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
  if(range&&table==='properties'&&Number(state.propertyPageSize)>0)rows=rows.slice(0,Number(state.propertyPageSize));
  if(limit!==null)rows=rows.slice(0,limit);
  const data=rows.map(decorate);
  return {data:head?null:single?(data[0]||null):data,count,error:single&&!data.length?{message:'TEST record not found'}:null};
 }).then(resolve,reject);}
 };return q;
}
// Branch API contracts are modeled separately from historical employee APIs.
// SQL acceptance tests prove their accounting and real authorization predicates.
const fixtureGoalFields={inventory_target:10,weekly_new_properties_target:2,daily_followups_target:10,weekly_viewings_target:5,reservations_target:2,booking_commission_target:4000};
const fixtureGoalKeys={inventory:'inventory_target',new_properties:'weekly_new_properties_target',followups:'daily_followups_target',viewings:'weekly_viewings_target',bookings:'reservations_target',expected_commission:'booking_commission_target'};
function fixtureBranchKeys(){return ['barka','muscat'].filter(branch=>profile.role!=='agent'||db.company_lead_routes.some(r=>r.route_key===branch&&r.is_active&&r.assigned_to===profile.id));}
function fixtureBranchGoal(branch,month){
 const stored=(db.branch_monthly_targets||[]).find(row=>row.branch_key===branch&&row.month_start===month),targets={...fixtureGoalFields};
 if(stored)for(const key of Object.keys(targets))targets[key]=stored[key];
 return {id:branch,branch,branch_key:branch,name:branch==='muscat'?'مسقط':'بركاء',month_start:month,goals:Object.fromEntries(Object.entries(fixtureGoalKeys).map(([key,column])=>[key,targets[column]])),targets,updated_at:stored?.updated_at||null,configured:!!stored};
}
const client={
from:query,
rpc:async(name,args={})=>{
 state.calls.push({rpc:name,args:structuredClone(args)});
 if(signedOut)return {data:null,error:{message:'TEST signed out'}};
 if(state.failNext===name){state.failNext=null;return {data:null,error:{message:'TEST simulated RPC failure'}};}
 if(['crm_branch_target_snapshot','crm_branch_performance','crm_branch_monthly_targets','crm_save_branch_monthly_targets'].includes(name)){
  if(profile.is_active===false||!['owner','manager','agent'].includes(profile.role))return {data:null,error:{message:'TEST branch access denied',code:'42501'}};
  const month=args.p_month||today.slice(0,7)+'-01';
  if(name==='crm_save_branch_monthly_targets'){
   if(profile.role!=='owner')return {data:null,error:{message:'TEST branch target save owner-only',code:'42501'}};
   const branch=args.p_branch,targets=args.p_targets;
   if(!['muscat','barka'].includes(branch)||!/^\d{4}-\d{2}-01$/.test(month)||!targets||Object.keys(targets).sort().join('|')!==Object.keys(fixtureGoalFields).sort().join('|')||Object.entries(targets).some(([key,value])=>!Number.isFinite(value)||value<0||(key!=='booking_commission_target'&&(!Number.isInteger(value)||value>1000))||(key==='booking_commission_target'&&Math.abs(value*1000-Math.round(value*1000))>0.000001)))return {data:null,error:{message:'TEST invalid branch targets',code:'22023'}};
   db.branch_monthly_targets=db.branch_monthly_targets||[];
   let row=db.branch_monthly_targets.find(r=>r.branch_key===branch&&r.month_start===month);
   const unchanged=row&&Object.keys(fixtureGoalFields).every(key=>row[key]===targets[key]);
   if(!unchanged&&(row?.updated_at||null)!==(args.p_expected_updated_at||null))return {data:null,error:{message:'TEST branch targets changed; reload before editing',code:'40001'}};
   if(!row){row={company_id:company,branch_key:branch,month_start:month};db.branch_monthly_targets.push(row);}
   if(!unchanged)Object.assign(row,targets,{updated_at:new Date().toISOString()});
   return {data:{scope:'branch',...fixtureBranchGoal(branch,month),replayed:!!unchanged},error:null};
  }
  if(name==='crm_branch_monthly_targets')return {data:{scope:'branch',month_start:month,branches:fixtureBranchKeys().map(branch=>fixtureBranchGoal(branch,month))},error:null};
  if(name==='crm_branch_target_snapshot'){
   const week=new Date(today+'T12:00:00Z');week.setUTCDate(week.getUTCDate()-week.getUTCDay());const weekStart=week.toISOString().slice(0,10);
   const branches=fixtureBranchKeys().map(branch=>{
    const eligible=db.properties.filter(p=>p.branch_key===branch&&!p.archived&&!privateProperty(p.id));
    const inventoryIds=eligible.filter(p=>p.status==='available').map(p=>p.id).sort(),newIds=eligible.filter(p=>{const day=new Date(p.created_at).toLocaleDateString('en-CA',{timeZone:'Asia/Muscat'});return Number(p.price)>0&&day>=weekStart&&day<=today;}).map(p=>p.id).sort();
    const followups=new Set((db.activities||[]).filter(a=>a.actor_type==='human'&&a.outcome&&a.type!=='note'&&(requests.find(r=>r.id===a.request_id)?.route_key||clients.find(c=>c.id===a.client_id)?.lead_route)===branch).map(a=>a.client_id)).size;
    return {...fixtureBranchGoal(branch,month),inventory:inventoryIds.length,inventory_property_ids:inventoryIds,new_properties:newIds.length,new_property_ids:newIds,followups,viewings:0,bookings:0,live_bookings:0,cancelled_bookings:0,expected_commission:0,collected_commission:0,sales_goal_met:false};
   });
   return {data:{scope:'branch',today,week_start:weekStart,week_end:new Date(week.getTime()+6*86400000).toISOString().slice(0,10),month_start:month,month_end:new Date(Date.UTC(Number(today.slice(0,4)),Number(today.slice(5,7)),0)).toISOString().slice(0,10),branches,employees:branches},error:null};
  }
  const branches=fixtureBranchKeys().map(branch=>({...fixtureBranchGoal(branch,month),employee_id:branch,active_inventory:properties.filter(p=>p.branch_key===branch&&!p.archived&&p.status==='available').length,new_properties:0,inquiries:branch==='muscat'?6:3,inquiry_property_pairs:branch==='muscat'?6:3,inquiry_pair_to_visit:0,inquiry_clients:branch==='muscat'?4:2,replied_inquiry_clients:branch==='muscat'?3:1,successful_staff_messages:branch==='muscat'?7:5,visits_booked:0,visits_done:0,sales:0,activities:0,outbound_messages:0,company_commission:20}));
  return {data:{scope:'branch',from:args.p_from,to:args.p_to,branches,employees:branches},error:null};
 }
 if(name==='crm_employee_target_snapshot'){
  if(profile.role==='viewer')return {data:null,error:{message:'TEST target access denied'}};
  const month=today.slice(0,7)+'-01',week=new Date(today+'T12:00:00Z');week.setUTCDate(week.getUTCDate()-week.getUTCDay());const weekStart=week.toISOString().slice(0,10);
  return {data:{today,week_start:week.toISOString().slice(0,10),week_end:new Date(week.getTime()+6*86400000).toISOString().slice(0,10),month_start:month,month_end:new Date(Date.UTC(Number(today.slice(0,4)),Number(today.slice(5,7)),0)).toISOString().slice(0,10),employees:profiles.filter(p=>p.role==='agent'&&(profile.role!=='agent'||p.id===profile.id)).map(p=>{
   const row=(db.employee_monthly_targets||[]).find(t=>t.employee_id===p.id&&t.month_start===month),branch=p.id===muscat?'muscat':'barka';
   const eligible=db.properties.filter(x=>x.branch_key===branch&&!x.archived&&!privateProperty(x.id));
   const inventoryIds=eligible.filter(x=>x.status==='available').map(x=>x.id).sort(),newIds=eligible.filter(x=>{const date=new Date(x.created_at).toLocaleDateString('en-CA',{timeZone:'Asia/Muscat'});return Number(x.price)>0&&date>=weekStart&&date<=today;}).map(x=>x.id).sort();
   return {id:p.id,name:p.full_name,branch,inventory:inventoryIds.length,inventory_property_ids:inventoryIds,new_properties:newIds.length,new_property_ids:newIds,followups:new Set((db.activities||[]).filter(a=>a.user_id===p.id&&a.actor_type==='human'&&a.outcome&&a.type!=='note').map(a=>a.client_id)).size,viewings:0,bookings:0,live_bookings:0,cancelled_bookings:0,expected_commission:0,collected_commission:0,sales_goal_met:false,goals:row?{inventory:row.inventory_target,new_properties:row.weekly_new_properties_target,followups:row.daily_followups_target,viewings:row.weekly_viewings_target,bookings:row.reservations_target,expected_commission:row.booking_commission_target}:{inventory:10,new_properties:2,followups:10,viewings:5,bookings:2,expected_commission:4000}};
  })},error:null};
 }
 if(name==='crm_log_human_activity'){
  const p=args.p_payload,id=args.p_idempotency_key;
  if(!['owner','manager','agent'].includes(profile.role)||!clients.some(c=>c.id===p.client_id&&allowed(c,'clients')))return {data:null,error:{message:'TEST activity scope denied'}};
  db.activities=db.activities||[];
  if(!db.activities.some(a=>a.id===id))db.activities.push({id,company_id:company,user_id:profile.id,...p,activity_type:p.type,activity_text:p.description,actor_type:'human',created_at:now,occurred_at:now});
  return {data:{ok:true,activity_id:id},error:null};
 }
 if(name==='crm_get_deal_workflow'){
  const deal=db.deals.find(d=>d.id===args.p_deal_id&&allowed(d,'deals'));
  return deal?{data:{deal:decorate(deal)},error:null}:{data:null,error:{message:'TEST fixture scope denial'}};
 }
 if(name==='crm_dashboard_work'){
  const scope=args.p_scope||'branches';if(scope==='investment'&&profile.role!=='owner')return {data:null,error:{message:'TEST owner only',code:'42501'}};
  const privateRow=row=>row?.lead_route==='investment'||row?.route_key==='investment'||row?.branch_key==='investment'||clients.find(c=>c.id===row?.client_id)?.lead_route==='investment'||requests.find(r=>r.id===row?.request_id)?.route_key==='investment';
  const scoped=(table)=>db[table].filter(row=>allowed(row,table)&&!!privateRow(row)===(scope==='investment'));
  const active=scoped('client_requests').filter(r=>r.status==='active'),cs=scoped('clients').filter(c=>!c.archived),due=active.filter(r=>r.next_followup&&r.next_followup.slice(0,10)<=today),hot=active.filter(r=>r.lead_temperature==='hot'),vs=scoped('viewings').filter(v=>!v.archived),ds=scoped('deals').filter(d=>!d.archived&&!['closed','commission_collected','lost'].includes(d.stage)),ts=scoped('tasks').filter(t=>!t.done),urgent=ts.filter(t=>t.priority==='high'||t.due_date&&t.due_date.slice(0,10)<=today),contact=cs.filter(c=>!c.human_contact_at).map(c=>({client_id:c.id})),unique=rows=>[...new Set(rows.map(r=>r.client_id))];
  const selectedVisits=vs.filter(v=>v.viewing_date===today&&v.status!=='cancelled'||v.viewing_date>today&&['scheduled','confirmed','postponed'].includes(v.status)),limit=Math.max(1,Math.min(200,args.p_limit||20)),offset=Math.max(0,args.p_offset||0),page=rows=>rows.slice(offset,offset+limit).map(decorate);
  return {data:{scope,as_of:today,generated_at:now,counts:{uncontacted:contact.length,followups_due:unique(due).length,hot_requests:unique(hot).length,viewings_today:vs.filter(v=>v.viewing_date===today&&v.status!=='cancelled').length,open_deals:ds.length,urgent_tasks:urgent.length,open_tasks:ts.length},requests:page(active),followups:page(due),hotRequests:page(hot),clients:cs,visits:page(selectedVisits),deals:page(ds),tasks:page(urgent),contactQueue:page(contact),totals:{requests:active.length,followups:due.length,hotRequests:hot.length,visits:selectedVisits.length,deals:ds.length,tasks:urgent.length,contactQueue:contact.length},clientFilters:{uncontacted:unique(contact),due:unique(due),hotfocus:unique(hot)}},error:null};
 }
 if(name==='crm_client_contact_queue')return {data:clients.filter(c=>allowed(c,'clients')&&!c.human_contact_at).map(c=>({client_id:c.id})),error:null};
 if(name==='crm_property_action_queue')return {data:[],error:null};
 // Distinct canned metric counts exercise frontend field mapping and role scope.
 // Their SQL calculation (unique clients, successful human messages) is tested separately.
 if(name==='crm_employee_performance')return {data:{from:args.p_from,to:args.p_to,employees:profiles.filter(p=>p.role==='agent'&&(profile.role!=='agent'||p.id===profile.id)).map(p=>({employee_id:p.id,name:p.full_name,active_inventory:properties.filter(x=>x.sourced_by===p.id&&!x.archived&&!['sold','not_available'].includes(x.status)).length,new_properties:0,inquiries:p.id===muscat?6:3,inquiry_property_pairs:p.id===muscat?6:3,inquiry_pair_to_visit:0,inquiry_clients:p.id===muscat?4:2,replied_inquiry_clients:p.id===muscat?3:1,successful_staff_messages:p.id===muscat?7:5,visits_booked:0,visits_done:0,sales:0,activities:0,outbound_messages:0,company_commission:20,targets:{inventory_target:10}}))},error:null};
 if(name==='crm_commission_report'){
  if(profile.role!=='owner')return {data:null,error:{message:'TEST company receipts are owner-only',code:'42501'}};
  // Frontend-only ledger model: receipts carry their own date. Real accounting,
  // role and concurrency behavior are verified by the independent SQL suites.
  const day=value=>value?new Date(value).toLocaleDateString('en-CA',{timeZone:'Asia/Muscat'}):null;
  const inPeriod=value=>value&&(!args.p_from||value>=args.p_from)&&(!args.p_to||value<args.p_to),milli=value=>Math.round(Number(value||0)*1000);
  const deals=db.deals.filter(d=>allowed(d,'deals')&&(d.reservation_confirmed_at||['closed','commission_collected'].includes(d.stage)));
  const ids=new Set(deals.map(d=>d.id)),receipts=(db.deal_commission_receipts||[]).filter(r=>ids.has(r.deal_id)&&!r.voided_at);
  const expected=deals.filter(d=>inPeriod(day(d.reservation_confirmed_at))).reduce((sum,d)=>sum+milli(d.expected_company_commission_at_reservation),0);
  const collected=receipts.filter(r=>inPeriod(r.received_on)).reduce((sum,r)=>sum+milli(r.amount),0);
  const outstanding=deals.filter(d=>d.stage!=='lost'&&!d.reservation_cancelled_at).reduce((sum,d)=>sum+Math.max(0,milli(d.expected_company_commission_at_reservation??d.company_commission)-receipts.filter(r=>r.deal_id===d.id).reduce((paid,r)=>paid+milli(r.amount),0)),0);
  const undated=deals.filter(d=>d.commission_status==='received'&&!d.commission_received_at&&!receipts.some(r=>r.deal_id===d.id)).length;
  return {data:{expected_commission:expected/1000,collected_commission:collected/1000,outstanding_commission:outstanding/1000,undated_received_deals:undated},error:null};
 }
 if(name==='crm_property_acquisition_funnel')return {data:[],error:null};
 if(name==='crm_client_360'){
  const client=db.clients.find(c=>c.id===args.p_client_id&&allowed(c,'clients'));
  if(!client)return {data:null,error:{message:'TEST client is outside the permitted scope',code:'42501'}};
  const rows=db.client_requests.filter(r=>r.client_id===client.id&&allowed(r,'client_requests'));
  // Canned presentation data follows the RPC envelope; SQL suites establish its calculations.
  return {data:{client,customer_kind:rows.length>1?'returning':'new',metrics:{requests_total:rows.length,active_requests:rows.filter(r=>r.status==='active').length,properties_inquired:0,properties_shown:0,properties_visited:0,rejected_properties:0,appointments_attended:0,appointments_no_show:0,negotiations:0,deposits:0,closed_deals:0,whatsapp_inbound:0,whatsapp_outbound:0,open_tasks:0,overdue_followups:0},requests:rows,property_journey:[],appointments:[],activities:[],open_tasks:[],deals:[],recent_whatsapp:[]},error:null};
 }
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
