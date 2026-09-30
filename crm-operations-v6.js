(function(){
  'use strict';
  const $id=id=>document.getElementById(id);
  const safe=v=>escapeHtml(String(v==null?'':v));
  const n=v=>Number(v||0).toLocaleString('en-US');
  const omanDate=d=>new Date(d).toLocaleDateString('en-CA',{timeZone:'Asia/Muscat'});
  const dateText=d=>d?new Date(d).toLocaleDateString('ar-OM',{timeZone:'Asia/Muscat'}):'—';
  // Calendar arithmetic uses UTC components of the Oman-local date.
  // Browser/device timezone must not move the period boundary.
  function period(kind){
    const today=omanDate(new Date()),date=new Date(today+'T12:00:00Z');
    const day=date.getUTCDay();
    const iso=d=>d.toISOString().slice(0,10);
    let from=today,to=iso(new Date(date.getTime()+86400000));
    if(kind==='week'){from=iso(new Date(date.getTime()-day*86400000));to=iso(new Date(date.getTime()+(7-day)*86400000));}
    if(kind==='month'){from=today.slice(0,7)+'-01';to=iso(new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,1)));}
    return {from,to};
  }
  const metric=(label,value)=>'<span class="ops-metric"><strong>'+n(value)+'</strong><small>'+label+'</small></span>';
  function targetScore(row,kind){
    const t=row.targets||{},span=period(kind),month=period('month');
    const monthDays=(Date.parse(month.to+'T00:00:00Z')-Date.parse(month.from+'T00:00:00Z'))/86400000;
    const days=(Date.parse(span.to+'T00:00:00Z')-Date.parse(span.from+'T00:00:00Z'))/86400000;
    const goals=[['active_inventory','inventory_target',false],['new_properties','new_properties_target',true],['inquiries','inquiries_target',true],['visits_done','visits_target',true],['sales','sold_target',true]];
    if(kind==='week'&&span.from.slice(0,7)!==new Date(Date.parse(span.to+'T00:00:00Z')-86400000).toISOString().slice(0,7))return 'الأسبوع يعبر شهرين؛ مقارنة الأهداف تحتاج اعتماد طريقة توزيعها';
    const valid=goals.map(([key,target,flow])=>{let goal=t[target];if(goal==null||Number(goal)<=0)return null;goal=Number(goal)*(flow?days/monthDays:1);return Math.min(1,Number(row[key]||0)/goal)}).filter(x=>x!==null);
    return valid.length?'تحقيق الأهداف المحددة: '+Math.round(100*valid.reduce((a,b)=>a+b,0)/valid.length)+'% ('+valid.length+'/5)':'لم تُحدد أهداف كافية للتقييم';
  }
  async function renderPerformance(kind){
    const box=$id('employeePerformanceResults');if(!box)return;
    box.textContent='جاري حساب الأداء...';
    try{
      const span=period(kind),r=await supa.rpc('crm_employee_performance',{p_from:span.from,p_to:span.to});
      if(r.error)throw r.error;
      box.innerHTML='<p class="ops-note">'+safe(span.from)+' حتى قبل '+safe(span.to)+' · الاستفسار المثبت برسالة واردة فقط. الزيارات والمبيعات نشاط مسجل خلال الفترة، ونسب التحويل تُحسب على مجموعة الاستفسارات أو الزيارات نفسها. عرض المالك يشمل الإسنادات التاريخية، وعرض الموظف يقتصر على الفرع المسموح؛ لذلك قد تختلف الأرقام. لا تُنسب العقارات القديمة إلى موظف بالتخمين.</p>'+
      (r.data.employees||[]).map(x=>'<article class="ops-person"><div class="ops-person-title"><strong>'+safe(x.name)+'</strong><span>'+safe(targetScore(x,kind))+'</span></div><div class="ops-metrics">'+
        metric('عقارات نشطة وفّرها',x.active_inventory)+metric('عقارات جديدة',x.new_properties)+metric('استفسارات عقار مثبتة',x.inquiries)+metric('منها تحوّل إلى زيارة',x.inquiry_to_visit)+metric('زيارات حُجزت',x.visits_booked)+metric('زيارات تمت',x.visits_done)+metric('منها تحوّل إلى بيع',x.visit_to_sale)+metric('مبيعات أُغلقت',x.sales)+metric('تواصل يدوي موثق',x.activities)+metric('رسائل صادرة من الموظف',x.outbound_messages)+'</div>'+
        (x.company_commission==null?'':'<div class="ops-note">عمولة الشركة المسجلة: '+n(x.company_commission)+' ر.ع</div>')+'</article>').join('')||'<p>لا يوجد موظفون نشطون.</p>';
    }catch(e){box.innerHTML='<p role="alert">تعذر حساب الأداء: '+safe(e.message)+'</p>'}
  }
  window.crmPerformancePeriod=function(kind){document.querySelectorAll('.ops-period').forEach(b=>b.classList.toggle('active',b.dataset.period===kind));renderPerformance(kind)};
  function addPerformance(){
    const target=$id('employeeTargetsPanel'),team=$id('page-team');if(!team||$id('employeePerformancePanel'))return;
    const card=document.createElement('div');card.className='card';card.id='employeePerformancePanel';
    card.innerHTML='<div class="card-body"><h3>أداء الفريق</h3><div class="ops-periods"><button class="btn-secondary ops-period" data-period="day" onclick="crmPerformancePeriod(\'day\')">اليوم</button><button class="btn-secondary ops-period" data-period="week" onclick="crmPerformancePeriod(\'week\')">هذا الأسبوع</button><button class="btn-secondary ops-period active" data-period="month" onclick="crmPerformancePeriod(\'month\')">هذا الشهر</button></div><div id="employeePerformanceResults"></div></div>';
    if(target)target.closest('.card').after(card);else team.append(card);
  }
  const oldTeam=window.loadTeam;
  if(typeof oldTeam==='function')window.loadTeam=async function(){addPerformance();const result=await oldTeam.apply(this,arguments);await renderPerformance('month');return result};
  function workDate(value){return value?String(value).slice(0,10):'';}
  function requestLabel(r){
    return ({buyer:'شراء',seller:'بيع',tenant:'استئجار',landlord:'تأجير',investor:'استثمار',consultation:'استشارة'}[r.request_type]||'طلب')+(r.preferred_area?' · '+r.preferred_area:'');
  }
  function dueLabel(date){
    const d=workDate(date),today=omanDate(new Date());
    return !d?'متابعة غير محددة':d<today?'متأخرة · '+d:d===today?'اليوم':'المتابعة · '+d;
  }
  function workButton(action,label,client,request,id){
    return '<button class="ops-action" data-work-action="'+action+'" data-client-id="'+safe(client||'')+'" data-request-id="'+safe(request||'')+'" data-work-id="'+safe(id||'')+'">'+safe(label)+'</button>';
  }
  function renderDailyWork(snapshot){
    const box=$id('opsDailyWork');if(!box)return;
    if(!snapshot){box.innerHTML='<div class="ops-state" role="alert">تعذر تحديث عمل اليوم. '+workButton('refresh-day','إعادة المحاولة')+'</div>';return;}
    const tasksCard=$id('dashTasksCard');if(tasksCard)tasksCard.style.display='none';
    const today=omanDate(new Date()),clients=new Map(snapshot.clients.map(c=>[c.id,c]));
    const followups=snapshot.requests.filter(r=>r.next_followup&&workDate(r.next_followup)<=today)
      .sort((a,b)=>String(a.next_followup).localeCompare(String(b.next_followup)));
    const qualified=snapshot.requests.filter(r=>!followups.some(f=>f.id===r.id)&&(r.qualified_at||r.pipeline_stage==='qualified'));
    const requestRows=followups.concat(qualified).slice(0,6);
    const owner=currentProfile&&currentProfile.role==='owner';
    const row=(r)=>{const c=clients.get(r.client_id)||{};return '<div class="ops-work-row"><div><strong>'+safe(c.name||'عميل')+'</strong><span>'+safe(requestLabel(r))+'</span><small class="'+(r.next_followup&&workDate(r.next_followup)<today?'ops-overdue':'')+'">'+safe(r.next_followup?dueLabel(r.next_followup):'طلب مؤهل · حدّد الخطوة التالية')+'</small></div>'+workButton('request','فتح الطلب',r.client_id,r.id)+'</div>';};
    const visits=snapshot.visits.map(v=>'<div class="ops-work-row"><div><strong>'+safe(v.client?.name||'عميل')+'</strong><span>'+safe(v.property?.title||'عقار')+'</span><small>'+safe(workDate(v.viewing_date))+' · <bdi dir="ltr">'+safe(String(v.viewing_time||'').slice(0,5))+'</bdi> · '+safe(v.status==='confirmed'?'مؤكدة':v.status==='postponed'?'مؤجلة':'محجوزة')+'</small></div>'+workButton('visit',canEdit()?'تحديث الزيارة':'فتح العميل',v.client_id,v.request_id,v.id)+'</div>').join('');
    const tasks=snapshot.tasks.slice().sort((a,b)=>String(a.due_date||'9999').localeCompare(String(b.due_date||'9999'))).slice(0,5);
    box.innerHTML='<p class="ops-scope">'+(owner?'متابعة الفرعين · تظهر السجلات بحسب نطاق صلاحيتك':'عمل الفرع المسموح لحسابك · كل طلب مستقل عن بقية طلبات العميل')+'</p><div class="ops-day-grid"><section class="ops-work-section"><div class="ops-section-head"><h3>الطلبات التي تحتاج خطوة</h3>'+workButton('due-clients','كل المتابعات')+'</div>'+ (requestRows.map(row).join('')||'<div class="ops-state">لا توجد متابعة مستحقة أو طلبات مؤهلة دون خطوة. '+workButton('clients','فتح العملاء')+'</div>')+'</section><section class="ops-work-section"><div class="ops-section-head"><h3>الزيارات القادمة</h3>'+workButton('visits','الجدول')+'</div>'+(visits||'<div class="ops-state">لا توجد زيارات قادمة مسجلة.</div>')+'</section></div><section class="ops-work-section ops-task-section"><div class="ops-section-head"><h3>المهام التالية</h3>'+workButton('tasks','كل المهام')+'</div>'+(tasks.map(t=>'<div class="ops-work-row"><div><strong>'+safe(t.title)+'</strong><small>'+safe(dueLabel(t.due_date))+'</small></div>'+workButton('task',canEdit()?'فتح المهمة':'عرض المهام',t.client_id,t.request_id,t.id)+'</div>').join('')||'<div class="ops-state">لا توجد مهام مفتوحة. يمكنك إضافة مهمة عند تحديد خطوة متابعة.</div>')+'</section><details class="ops-work-section"><summary>صفقات تحتاج استكمالاً</summary>'+(snapshot.deals.map(d=>'<div class="ops-work-row"><div><strong>'+safe(d.client?.name||'عميل')+'</strong><span>'+safe(d.property?.title||'عقار')+'</span><small>'+safe(typeof stageAr==='function'?stageAr(d.stage):d.stage)+'</small></div>'+workButton('deal','فتح الصفقات',d.client_id,d.request_id,d.id)+'</div>').join('')||'<div class="ops-state">لا توجد صفقات مفتوحة.</div>')+'</details>';
  }
  const oldDashboard=window.loadDashboard;
  if(typeof oldDashboard==='function')window.loadDashboard=async function(){
    const user=currentUser&&currentUser.id,generation=crmSessionGeneration;
    const box=$id('opsDailyWork');if(box)box.innerHTML='<div class="ops-state" role="status">جاري ترتيب عمل اليوم…</div>';
    const result=await oldDashboard.apply(this,arguments);
    if(!crmSessionCurrent(generation,user))return result;
    renderDailyWork(window.dashboardWorkSnapshot);
    return result;
  };
  const oldPhone=window.formatPhoneDisplay;
  if(typeof oldPhone==='function')window.formatPhoneDisplay=function(v){return oldPhone(v).replace(/<span dir="ltr"/g,'<bdi dir="ltr"').replace(/<\/span>/g,'</bdi>')};
  let propertySearch='',propertyBranch='',propertyArea='',propertyStatus='';
  const propertyStatusLabel=s=>({available:'متوفر',reserved:'محجوز',deposit:'عربون',negotiating:'تفاوض',sold:'مباع',not_available:'غير متاح'}[s]||s||'غير محدد');
  function renderOrganizedProperties(){
    const list=$id('propertiesList');if(!list)return;
    const branchLabel=$id('opsPropertyBranchLabel');if(branchLabel)branchLabel.hidden=!isOwner();
    const areaSelect=$id('opsPropertyArea');
    if(areaSelect){const areas=[...new Set(allProperties.filter(p=>!propertyBranch||(p.branch_key||'unknown')===propertyBranch).map(p=>p.area||'غير محددة'))].sort((a,b)=>a.localeCompare(b,'ar'));
      if(propertyArea&&!areas.includes(propertyArea))propertyArea='';
      areaSelect.innerHTML='<option value="">كل المناطق</option>'+areas.map(a=>'<option value="'+safe(a)+'">'+safe(a)+'</option>').join('');areaSelect.value=propertyArea;}
    const items=allProperties.filter(p=>(!propertyBranch||(p.branch_key||'unknown')===propertyBranch)&&(!propertyArea||(p.area||'غير محددة')===propertyArea)&&(!propertyStatus||p.status===propertyStatus)&&(!propertySearch||[p.title,p.property_code,p.area,p.wilayat].join(' ').toLowerCase().includes(propertySearch)));
    if(!items.length){list.innerHTML='<div class="ops-state">لا توجد عقارات تطابق العرض الحالي.'+((propertySearch||propertyArea||propertyBranch||propertyStatus)?workButton('clear-properties','مسح الفلاتر'):'')+'</div>';return;}
    const groups=new Map();items.slice().sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).forEach(p=>{
      const branch=p.branch_key==='barka'?'بركاء':p.branch_key==='muscat'?'مسقط':'غير محدد',area=p.area||'منطقة غير محددة',key=branch+'|'+area;
      if(!groups.has(key))groups.set(key,{branch,area,items:[]});groups.get(key).items.push(p);});
    const ordered=[...groups.values()].sort((a,b)=>['مسقط','بركاء','غير محدد'].indexOf(a.branch)-['مسقط','بركاء','غير محدد'].indexOf(b.branch)||a.area.localeCompare(b.area,'ar'));
    let last='';list.innerHTML=ordered.map(g=>{
      const heading=g.branch===last?'':'<h3 class="ops-branch">'+safe(g.branch)+'</h3>';last=g.branch;
      return heading+'<section class="ops-area"><h4>'+safe(g.area)+' <small>'+g.items.length+' عقارات</small></h4><div class="ops-property-grid">'+g.items.map(p=>'<article class="ops-property"><div class="ops-property-top"><span class="ops-status '+(p.status==='available'?'ops-available':'')+'">'+safe(propertyStatusLabel(p.status))+'</span><bdi dir="ltr" class="ops-code">'+safe(p.property_code||'')+'</bdi></div><button class="ops-title" data-work-action="property" data-work-id="'+safe(p.id)+'">'+safe(p.title||'عقار')+'</button><div class="ops-property-price">'+n(p.price)+' <small>ر.ع</small></div><p>'+safe(typeof propTypeAr==='function'?propTypeAr(p.type):p.type||'')+(p.bedrooms?' · '+n(p.bedrooms)+' غرف':'')+(p.land_size?' · '+n(p.land_size)+' م²':'')+'</p><div class="ops-property-foot"><small>أضيف '+safe(dateText(p.created_at))+'</small>'+workButton('property','التفاصيل','','',p.id)+'</div></article>').join('')+'</div></section>';
    }).join('');
  }
  const oldProperties=window.loadProperties;
  if(typeof oldProperties==='function')window.loadProperties=async function(){
    const user=currentUser&&currentUser.id,generation=crmSessionGeneration;
    const loaded=await oldProperties.apply(this,arguments);
    if(loaded===false||!crmSessionCurrent(generation,user))return loaded;
    renderOrganizedProperties();return loaded;
  };
  const oldClients=window.renderClients;
  let clientBranch='all';
  if(typeof oldClients==='function')window.renderClients=function(){const list=$id('clientsList');if(!list)return oldClients.apply(this,arguments);
    let bar=$id('opsClientBranches');if(!bar){bar=document.createElement('div');bar.id='opsClientBranches';bar.className='ops-periods';list.parentNode.insertBefore(bar,list)}
    if(isOwner())bar.innerHTML=['all','muscat','barka','general'].map(k=>'<button class="btn-secondary '+(k===clientBranch?'active':'')+'" data-client-branch="'+k+'">'+({all:'الكل',muscat:'مسقط',barka:'بركاء',general:'غير محدد'}[k])+'</button>').join('');else bar.remove();
    if(clientBranch==='all'||!isOwner())return oldClients.apply(this,arguments);
    const original=allClients;try{allClients=original.filter(c=>c.lead_route===clientBranch);return oldClients.apply(this,arguments)}finally{allClients=original}
  };
  document.addEventListener('click',e=>{const b=e.target.closest('[data-client-branch]');if(b){clientBranch=b.dataset.clientBranch;renderClients()}});
  let clientWorkFilter='all';
  window.crmRenderClientWorkList=function(clients){
    const list=$id('clientsList');if(!list)return;
    const today=omanDate(new Date()),byClient=new Map();
    (clientWorkRequests||[]).forEach(r=>{if(!byClient.has(r.client_id))byClient.set(r.client_id,[]);byClient.get(r.client_id).push(r);});
    const matches=r=>clientWorkFilter==='all'||(clientWorkFilter==='due'&&r.next_followup&&workDate(r.next_followup)<=today)||(clientWorkFilter==='qualified'&&(r.qualified_at||r.pipeline_stage==='qualified'))||(clientWorkFilter==='unplanned'&&!r.next_followup);
    const bar=$id('opsClientsWork');if(bar)bar.innerHTML=[['all','كل العمل'],['due','المتابعة المستحقة'],['qualified','طلبات مؤهلة'],['unplanned','متابعة غير محددة']].map(([key,label])=>'<button class="ops-filter '+(clientWorkFilter===key?'active':'')+'" data-work-filter="'+key+'" aria-pressed="'+(clientWorkFilter===key)+'">'+label+'</button>').join('');
    const sorted=clients.filter(c=>clientWorkFilter==='all'||(byClient.get(c.id)||[]).some(matches)).slice().sort((a,b)=>{
      const earliest=c=>(byClient.get(c.id)||[]).map(r=>workDate(r.next_followup)||'9999').sort()[0]||'9999';
      return earliest(a).localeCompare(earliest(b))||String(b.created_at).localeCompare(String(a.created_at));});
    if(!sorted.length){list.innerHTML='<div class="ops-state">لا يوجد عملاء يطابقون هذا العرض. '+workButton('clear-clients','عرض الكل')+'</div>';return;}
    list.innerHTML=sorted.map(c=>{
      const requests=(byClient.get(c.id)||[]).slice().sort((a,b)=>String(a.next_followup||'9999').localeCompare(String(b.next_followup||'9999')));
      return '<article class="ops-client"><div class="ops-client-head"><div><button class="ops-title" data-work-action="client" data-client-id="'+safe(c.id)+'">'+safe(c.name||'عميل')+'</button><div class="ops-client-contact"><bdi dir="ltr">'+safe(typeof crmPhoneText==='function'?crmPhoneText(c.phone):c.phone||'')+'</bdi><span>'+safe(c.lead_route==='barka'?'بركاء':c.lead_route==='muscat'?'مسقط':'فرع غير مصنف')+'</span></div></div><span class="ops-status">'+safe(c.archived?'مؤرشف':(requests.length?requests.length+' طلب مستقل':'لا طلب نشط'))+'</span></div>'+
      (requests.map(r=>'<div class="ops-request"><div><strong>'+safe(requestLabel(r))+'</strong><small class="'+(r.next_followup&&workDate(r.next_followup)<today?'ops-overdue':'')+'">'+safe(dueLabel(r.next_followup))+' · '+safe(r.pipeline_stage==='qualified'?'مؤهل':r.pipeline_stage==='negotiation'?'تفاوض':r.status==='paused'?'متوقف مؤقتاً':'نشط')+'</small></div>'+workButton('request',canEdit()?'فتح الطلب':'تفاصيل العميل',c.id,r.id)+'</div>').join('')||'<p class="ops-note">لا يوجد طلب نشط مسجل. افتح الملف لمراجعة السياق أو إضافة طلب مستقل.</p>')+
      '<div class="ops-client-foot">'+workButton('client','ملف العميل',c.id)+(canEdit()?workButton(c.archived?'restore-client':'edit-client',c.archived?'استرجاع':'تعديل بيانات التواصل',c.id):'')+'</div></article>';
    }).join('');
  };
  window.crmResetOperations=function(){
    clientBranch='all';clientWorkFilter='all';propertySearch='';propertyBranch='';propertyArea='';propertyStatus='';
    ['opsPropertySearch','opsPropertyBranch','opsPropertyArea','opsPropertyStatus'].forEach(id=>{if($id(id))$id(id).value='';});
  };
  document.addEventListener('input',e=>{if(e.target.id==='opsPropertySearch'){propertySearch=e.target.value.trim().toLowerCase();renderOrganizedProperties();}});
  document.addEventListener('change',e=>{
    if(e.target.id==='opsPropertyBranch'){propertyBranch=e.target.value;propertyArea='';}
    else if(e.target.id==='opsPropertyArea')propertyArea=e.target.value;
    else if(e.target.id==='opsPropertyStatus')propertyStatus=e.target.value;
    else return;renderOrganizedProperties();
  });
  document.addEventListener('click',async e=>{
    const filter=e.target.closest('[data-work-filter]');if(filter){clientWorkFilter=filter.dataset.workFilter;renderClients();return;}
    const button=e.target.closest('[data-work-action]');if(!button)return;
    const action=button.dataset.workAction,id=button.dataset.workId,client=button.dataset.clientId,request=button.dataset.requestId;
    try{
      if(action==='refresh-day')await loadDashboard();
      else if(action==='clients'||action==='due-clients'){navigate('clients',null);clientWorkFilter=action==='due-clients'?'due':'all';}
      else if(action==='client')await viewClient(client);
      else if(action==='request'){await viewClient(client);if(canEdit()&&viewingClient&&viewingClient.id===client)await openClientRequestForm(request,client);else if(typeof client360SwitchTab==='function')client360SwitchTab('requests');}
      else if(action==='edit-client'&&canEdit())await editClient(client);
      else if(action==='restore-client'&&canEdit())restoreClientById(client);
      else if(action==='visit'){if(canEdit())await editViewing(id);else await viewClient(client);}
      else if(action==='visits')navigate('viewings',null);
      else if(action==='task'){if(canEdit())await editTask(id);else navigate('daily',null);}
      else if(action==='tasks')navigate('daily',null);
      else if(action==='deal')navigate('deals',null);
      else if(action==='property')await viewProperty(id);
      else if(action==='clear-properties'){propertySearch=propertyBranch=propertyArea=propertyStatus='';['opsPropertySearch','opsPropertyBranch','opsPropertyStatus'].forEach(id=>{if($id(id))$id(id).value='';});renderOrganizedProperties();}
      else if(action==='clear-clients'){clientWorkFilter='all';renderClients();}
    }catch(err){showToast('تعذر فتح الإجراء: '+err.message,'error');}
  });
  // An owner CSV is based on actual visits. Inferred visit interest is shown separately from inbound leads.
  window.exportPropertyOwnerReport=async function(){
    const p=window.viewingProperty;if(!p)return;
    try{const [ir,vr,mr]=await Promise.all([
      supa.from('property_inquiries').select('client_id,has_inbound_inquiry,inquiry_count,status,rejection_reason').eq('property_id',p.id),
      supa.from('viewings').select('client_id,status,archived').eq('property_id',p.id),
      supa.from('property_marketing_events').select('channel,event_type,published_at,views,plays,reach,total_interactions,last_synced_at,url,notes').eq('property_id',p.id).order('created_at',{ascending:false})]);
      [ir,vr,mr].forEach(r=>{if(r.error)throw r.error});const inbound=(ir.data||[]).filter(x=>x.has_inbound_inquiry),visits=(vr.data||[]).filter(x=>!x.archived),marketing=mr.data||[],visitedClients=new Set(visits.filter(x=>x.status!=='cancelled').map(x=>x.client_id));
      const rows=[['العقار',p.title],['المنطقة',p.area||''],['السعر',p.price||''],['تاريخ تسجيل العقار',dateText(p.created_at)],
        ['عملاء لديهم استفسار وارد مثبت',new Set(inbound.map(x=>x.client_id)).size],['اهتمامات مستنتجة من زيارة',new Set((ir.data||[]).filter(x=>!x.has_inbound_inquiry&&visitedClients.has(x.client_id)).map(x=>x.client_id)).size],
        ['زيارات حجزت',visits.filter(x=>x.status!=='cancelled').length],['زيارات تمت',visits.filter(x=>x.status==='done').length],
        ['زيارات ألغيت',visits.filter(x=>x.status==='cancelled').length],['في التفاوض',inbound.filter(x=>x.status==='negotiation').length],['لم يناسبه',inbound.filter(x=>x.status==='not_suitable').length],[],
        ['سجل التسويق'],['القناة','النشاط','التاريخ','المشاهدات','الوصول','التفاعلات','آخر تحديث','الرابط','ملاحظات']];
      marketing.forEach(m=>rows.push([m.channel||'',m.event_type||'',dateText(m.published_at),m.views??m.plays??'غير متاح',m.reach??'غير متاح',m.total_interactions??'غير متاح',m.last_synced_at?dateText(m.last_synced_at):'لم يحدث',m.url||'',m.notes||'']));
      downloadCSV('تقرير-أداء-'+(p.title||'العقار'),[],rows);
    }catch(e){showToast('تعذر إعداد التقرير: '+e.message,'error')}
  };
  addPerformance();
})();
