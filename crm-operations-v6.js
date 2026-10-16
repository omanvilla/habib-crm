(function(){
  'use strict';
  const $id=id=>document.getElementById(id);
  const safe=v=>escapeHtml(String(v==null?'':v));
  const n=v=>Number(v||0).toLocaleString('en-US');
  const omanDate=d=>new Date(d).toLocaleDateString('en-CA',{timeZone:'Asia/Muscat'});
  const dateText=d=>d?new Date(d).toLocaleDateString('ar-OM-u-nu-latn',{timeZone:'Asia/Muscat'}):'—';
  // Calendar arithmetic uses UTC components of the Oman-local date.
  // Browser/device timezone must not move the period boundary.
  function period(kind){
    const today=omanDate(new Date()),date=new Date(today+'T12:00:00Z');
    const day=date.getUTCDay();
    const iso=d=>d.toISOString().slice(0,10);
    let from=today,to=iso(new Date(date.getTime()+86400000));
    if(['months3','months6','months9','year'].includes(kind)){const months={months3:3,months6:6,months9:9,year:12}[kind];from=iso(new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()-months,date.getUTCDate())));to=iso(new Date(date.getTime()+86400000));}
    if(kind==='month'){from=today.slice(0,7)+'-01';to=iso(new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,1)));}
    if(kind==='all')from=typeof currentCompany!=='undefined'&&currentCompany?.created_at?omanDate(currentCompany.created_at):null;
    return {from,to};
  }
  const metric=(label,value,hint='')=>'<span class="ops-metric"><strong>'+n(value)+'</strong><small>'+label+'</small>'+(hint?'<span class="ops-metric-help">'+hint+'</span>':'')+'</span>';
  function targetScore(row,kind){
    if(kind!=='month')return 'نتائج الفترة المختارة؛ لا تُقارن بهدف شهر واحد';
    const t={...(row.targets||{}),inventory_target:10},span=period(kind),month=period('month');
    const monthDays=(Date.parse(month.to+'T00:00:00Z')-Date.parse(month.from+'T00:00:00Z'))/86400000;
    const days=(Date.parse(span.to+'T00:00:00Z')-Date.parse(span.from+'T00:00:00Z'))/86400000;
    const goals=[['active_inventory','inventory_target',false],['inquiries','inquiries_target',true],['visits_done','visits_target',true],['sales','sold_target',true],['company_commission','commission_target',true]];
    if(kind==='week'&&span.from.slice(0,7)!==new Date(Date.parse(span.to+'T00:00:00Z')-86400000).toISOString().slice(0,7))return 'الأسبوع يعبر شهرين؛ مقارنة الأهداف تحتاج اعتماد طريقة توزيعها';
    const valid=goals.map(([key,target,flow])=>{let goal=t[target];if(goal==null||Number(goal)<=0||(key==='company_commission'&&row[key]==null))return null;goal=Number(goal)*(flow?days/monthDays:1);return Math.min(1,Number(row[key]||0)/goal)}).filter(x=>x!==null);
    return valid.length?'متوسط إنجاز الأهداف المعتمدة: '+Math.round(100*valid.reduce((a,b)=>a+b,0)/valid.length)+'% · محدد '+valid.length+' من '+goals.length+' أهداف؛ البقية غير محددة':'لم تُحدد أهداف كافية للتقييم';
  }
  const performanceLoads=new WeakMap();
  let teamPerformancePeriod='month';
  async function renderPerformance(kind,boxId='employeePerformanceResults'){
    const generation=crmSessionGeneration,user=currentUser&&currentUser.id;
    const box=$id(boxId);if(!box)return;
    const request={};performanceLoads.set(box,request);
    const isCurrent=()=>performanceLoads.get(box)===request&&crmSessionCurrent(generation,user);
    box.innerHTML='<p class="ops-state" role="status">جاري تحميل الأداء…</p>';
    try{
      const span=period(kind),r=await bounded(supa.rpc('crm_employee_performance',{p_from:span.from,p_to:span.to}));
      if(!isCurrent())return;
      if(r.error)throw r.error;
      const employees=r.data.employees||[];
      box.innerHTML='<div class="ops-performance-caption"><span>'+safe(r.data.from||span.from||'بداية الشركة')+' — '+safe(new Date(Date.parse(span.to+'T00:00:00Z')-86400000).toISOString().slice(0,10))+'</span><small>العقارات النشطة رصيد حالي؛ بقية الأرقام للفترة المختارة.</small></div>'+
      (employees.map(x=>'<article class="ops-person"><div class="ops-person-title"><strong>'+safe(x.name)+'</strong><span>'+safe(targetScore(x,kind))+'</span></div><div class="ops-metrics">'+
        metric('عقارات نشطة الآن',x.active_inventory,'مسندة للموظفة')+metric('عقارات أُضيفت خلال الفترة',x.new_properties,'إضافة عقار جديد إلى CRM')+metric('استفسارات عن عقار محدد',x.inquiries,'رسائل واردة رُبطت بعقار')+metric('استفسارات الفترة التي وصلت لزيارة',x.inquiry_to_visit,'قد تكون الزيارة في فترة لاحقة')+metric('زيارات حُجزت',x.visits_booked)+metric('زيارات تمت',x.visits_done)+metric('مبيعات الفترة المرتبطة بزيارة',x.visit_to_sale,'يشمل الزيارات السابقة للفترة')+metric('مبيعات أُغلقت',x.sales)+metric('أنشطة متابعة موثقة',x.activities,'مكالمات واجتماعات ومتابعات مسجلة')+metric('رسائل واتساب صادرة من الفريق',x.outbound_messages,'رسائل أرسلها موظف، دون الآلية')+'</div>'+
        (x.company_commission==null?'':'<div class="ops-commission"><span>عمولة الشركة من صفقات الفترة</span><strong>'+n(x.company_commission)+' <small>ر.ع</small></strong></div>')+'</article>').join('')||'<p class="ops-empty">لا يوجد موظفون نشطون.</p>')+
        '<details class="ops-metric-definitions"><summary>كيف تُحسب هذه الأرقام؟</summary><p>الاستفسار يُحسب عند وجود رسالة واردة مرتبطة بعقار محدد. الزيارة اليدوية تُحسب زيارة، ولا تتحول وحدها إلى استفسار وارد. مبيعات الفترة المرتبطة بزيارة تشمل البيع الذي أُغلق خلالها وكانت له زيارة مكتملة، حتى لو تمت الزيارة في شهر سابق. أنشطة المتابعة هي السجلات البشرية الفعلية؛ رسائل واتساب الآلية مستبعدة.</p><p>الإسناد المعتمد للعمل منذ 1 أغسطس 2026: مسقط لهديل وبركاء لمرام. رصيد العقارات المستهدف 10، وبقية الأهداف حسب اعتماد المالك.</p></details>';
    }catch(e){if(!isCurrent())return;box.innerHTML='<div class="ops-error" role="alert"><strong>تعذر تحميل الأداء</strong><span>'+safe(e.message)+'</span><button class="ops-action" data-performance-retry="'+safe(kind)+'" data-performance-box="'+safe(boxId)+'">إعادة المحاولة</button></div>'}
  }
  window.crmDashboardPerformancePeriod=function(kind){const panel=$id('opsPerformanceDetails');if(!currentProfile||!['owner','manager','agent'].includes(currentProfile.role))return;if(panel)panel.querySelectorAll('[data-period]').forEach(b=>b.classList.toggle('active',b.dataset.period===kind));renderPerformance(kind,'opsDashboardPerformanceResults')};
  window.crmPerformancePeriod=function(kind){teamPerformancePeriod=kind;document.querySelectorAll('.ops-period').forEach(b=>b.classList.toggle('active',b.dataset.period===kind));return renderPerformance(kind)};
  function addPerformance(){
    const target=$id('employeeTargetsPanel'),team=$id('page-team');if(!team||$id('employeePerformancePanel'))return;
    const card=document.createElement('div');card.className='card';card.id='employeePerformancePanel';
    card.innerHTML='<div class="card-body"><h3>أداء الفريق</h3><div class="ops-periods"><button class="btn-secondary ops-period active" data-period="month" onclick="crmPerformancePeriod(\'month\')">هذا الشهر</button><button class="btn-secondary ops-period" data-period="months3" onclick="crmPerformancePeriod(\'months3\')">آخر 3 أشهر</button><button class="btn-secondary ops-period" data-period="months6" onclick="crmPerformancePeriod(\'months6\')">آخر 6 أشهر</button><button class="btn-secondary ops-period" data-period="months9" onclick="crmPerformancePeriod(\'months9\')">آخر 9 أشهر</button><button class="btn-secondary ops-period" data-period="year" onclick="crmPerformancePeriod(\'year\')">آخر سنة</button><button class="btn-secondary ops-period" data-period="all" onclick="crmPerformancePeriod(\'all\')">من بداية الشركة</button></div><div id="employeePerformanceResults"></div></div>';
    if(target)target.closest('.card').after(card);else team.append(card);
  }
  const oldTeam=window.loadTeam;
  if(typeof oldTeam==='function')window.loadTeam=async function(){addPerformance();const result=await oldTeam.apply(this,arguments);await window.crmPerformancePeriod(teamPerformancePeriod);return result};
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
  // Each scope settles independently. A slow source never leaves the whole dashboard spinning.
  function bounded(promise, milliseconds=18000){
    if(typeof setTimeout!=='function')return Promise.resolve(promise);
    let timer;return Promise.race([Promise.resolve(promise),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('استغرق الاتصال وقتًا أطول من المعتاد. أعد المحاولة.')),milliseconds);})]).finally(()=>clearTimeout(timer));
  }
  const dashboardScopes=new Map();
  let dashboardScope='branches',dashboardSession='',dashboardCategory='all';
  const scopeTitle=scope=>scope==='investment'?'المستثمرون · عملي الخاص':currentProfile?.role==='owner'?'مسقط وبركاء والعمل العام':'عمل الفرع';
  const scopeDescription=scope=>scope==='investment'?'مسار الاستثمار · خاص بالمالك':currentProfile?.role==='owner'?'العمل المشترك · دون مسار المستثمرين':'السجلات المسموح بها لحسابك فقط';
  const countDefinitions=[
    ['followups_due','عملاء بمتابعة مستحقة','لديهم متابعة اليوم أو متأخرة','followups'],
    ['hot_requests','عملاء بفرص حارة','فرص نشطة لها تواصل حديث أو متابعة','hot'],
    ['viewings_today','زيارات اليوم','زيارات غير ملغاة مسجلة لليوم','visits'],
    ['open_deals','صفقات مفتوحة','صفقات لم تغلق ولم تُفقد','deals'],
    ['urgent_tasks','مهام عاجلة','متأخرة أو لليوم أو عالية الأولوية','tasks'],
    ['uncontacted','بانتظار توثيق التواصل','لم يسجل تواصل فعلي بعد','contact']
  ];
  function scopeButtons(){return [...dashboardScopes.keys()].map(scope=>'<button class="ops-filter '+(scope===dashboardScope?'active':'')+'" data-dashboard-scope="'+scope+'" aria-pressed="'+(scope===dashboardScope)+'">'+scopeTitle(scope)+'</button>').join('');}
  function scopeCard(scope,state){
    const selected=scope===dashboardScope,loading=state.status==='loading',failed=state.status==='error',counts=state.data?.counts||{};
    return '<section class="ops-summary-card '+(scope==='investment'?'ops-private-card':'')+'" data-dashboard-card="'+scope+'" aria-busy="'+loading+'"><header><div><h3>'+scopeTitle(scope)+'</h3><p>'+scopeDescription(scope)+'</p></div><span class="ops-scope-mark">'+(scope==='investment'?'خاص':'تشغيل')+'</span></header>'+
      (failed?'<div class="ops-error" role="alert"><strong>تعذر تحديث هذا الملخص</strong><span>'+safe(state.error)+'</span><button class="ops-action" data-dashboard-retry="'+scope+'">إعادة المحاولة</button></div>':'<div class="ops-count-grid">'+countDefinitions.map(([key,label,hint,category])=>'<button class="ops-count '+(Number(counts[key])>0&&['followups_due','urgent_tasks'].includes(key)?'ops-needs-action':'')+'" data-dashboard-scope="'+scope+'" data-dashboard-category="'+category+'" '+(loading?'disabled':'')+' title="'+hint+'"><strong>'+ (loading?'—':n(counts[key]))+'</strong><span>'+label+'</span></button>').join('')+'</div>')+
      '<footer><span role="status">'+(loading?'جاري تحميل المؤشرات…':failed?'آخر تحديث غير متاح':state.data.as_of?'بيانات يوم '+safe(String(state.data.as_of).slice(0,10)):'تم التحديث')+'</span><button class="ops-text-action" data-dashboard-scope="'+scope+'" '+(loading||failed?'disabled':'')+'>'+(selected?'عرض قائمة العمل':'فتح قائمة العمل')+'</button></footer></section>';
  }
  function requestRow(r,clients){
    const c=clients.get(r.client_id)||r.client||{};
    return '<div class="ops-work-row"><div><strong>'+safe(c.name||r.client_name||'عميل')+'</strong><span>'+safe(requestLabel(r))+'</span><small class="'+(r.next_followup&&workDate(r.next_followup)<omanDate(new Date())?'ops-overdue':'')+'">'+safe(r.next_followup?dueLabel(r.next_followup):'حدّد الخطوة التالية')+'</small>'+(r.next_action?'<small>التالي: '+safe(r.next_action)+'</small>':'')+'</div>'+workButton('request',canEdit()?'فتح الطلب':'ملف العميل',r.client_id,r.id)+'</div>';
  }
  const listFields={followups:'followups',hot:'hotRequests',visits:'visits',deals:'deals',tasks:'tasks',contact:'contactQueue'};
  function workSection(title,rows,empty,category){
    const state=dashboardScopes.get(dashboardScope),field=listFields[category],total=state?.data?.totals?.[field]??rows.length,shown=dashboardCategory==='all'?rows.slice(0,6):rows;
    const more=state?.more?.[category];
    return '<section class="ops-work-section" data-dashboard-list="'+category+'"><div class="ops-section-head"><h3>'+title+'</h3><span class="ops-list-count">'+n(total)+'</span></div>'+(shown.join('')||'<p class="ops-empty">'+empty+'</p>')+
      (total>shown.length?'<div class="ops-list-footer"><span>المعروض '+n(shown.length)+' من '+n(total)+' سجل</span>'+(dashboardCategory==='all'?'<button class="ops-text-action" data-dashboard-category="'+category+'">فتح القائمة</button>':'<button class="ops-text-action" data-dashboard-more="'+category+'" '+(more?.loading?'disabled':'')+'>'+(more?.loading?'جاري التحميل…':'عرض المزيد')+'</button>')+'</div>':'')+
      (more?.error?'<p class="ops-list-error" role="alert">'+safe(more.error)+'</p>':'')+'</section>';
  }

  function dashboardWork(data){
    const today=omanDate(new Date()),clients=new Map((data.clients||[]).map(c=>[c.id,c]));
    const requests=data.requests||[],followups=data.followups||requests.filter(r=>r.next_followup&&workDate(r.next_followup)<=today).sort((a,b)=>String(a.next_followup).localeCompare(String(b.next_followup))),hot=data.hotRequests||requests.filter(r=>(data.clientFilters?.hotfocus||[]).includes(r.client_id));
    const visits=(data.visits||[]).map(v=>'<div class="ops-work-row"><div><strong>'+safe(v.client?.name||v.client_name||clients.get(v.client_id)?.name||'عميل')+'</strong><span>'+safe(v.property?.title||v.property_title||'زيارة عقار')+'</span><small>'+safe(workDate(v.viewing_date))+' · <bdi dir="ltr">'+safe(String(v.viewing_time||'').slice(0,5)||'الوقت غير محدد')+'</bdi> · '+safe(({done:'تمت',confirmed:'مؤكدة',postponed:'مؤجلة',scheduled:'محجوزة',no_show:'لم يحضر'}[v.status]||v.status||'مسجلة'))+'</small></div>'+workButton('visit',canEdit()?'فتح الزيارة':'ملف العميل',v.client_id,v.request_id,v.id)+'</div>');
    const tasks=(data.tasks||[]).map(t=>'<div class="ops-work-row"><div><strong>'+safe(t.title)+'</strong><small class="'+(t.due_date&&workDate(t.due_date)<today?'ops-overdue':'')+'">'+safe(dueLabel(t.due_date))+(t.priority==='high'?' · أولوية عالية':'')+'</small></div>'+workButton('task',canEdit()?'فتح المهمة':'المهام',t.client_id,t.request_id,t.id)+'</div>');
    const deals=(data.deals||[]).map(d=>'<div class="ops-work-row"><div><strong>'+safe(d.client?.name||d.client_name||clients.get(d.client_id)?.name||'عميل')+'</strong><span>'+safe(d.property?.title||d.property_title||'صفقة عقارية')+'</span><small>'+safe(({negotiation:'تفاوض',viewing_scheduled:'زيارة مجدولة',viewed:'زيارة تمت',offer:'عرض',deposit:'عربون',contract:'عقد'}[d.stage])||(typeof stageAr==='function'?stageAr(d.stage):d.stage))+'</small></div>'+workButton('deal','فتح الصفقة',d.client_id,d.request_id,d.id)+'</div>');
    const contact=(data.contactQueue||[]).map(q=>'<div class="ops-work-row"><div><strong>'+safe(clients.get(q.client_id)?.name||q.client_name||'عميل')+'</strong><small>افتح الملف وسجّل التواصل الفعلي أو الخطوة القادمة</small></div>'+workButton('client','ملف العميل',q.client_id)+'</div>');
    const sections={followups:()=>workSection('المتابعات المستحقة',followups.map(r=>requestRow(r,clients)),'لا توجد متابعات مستحقة مسجلة.', 'followups'),hot:()=>workSection('الفرص الحارة النشطة',hot.map(r=>requestRow(r,clients)),'لا توجد فرص حارة نشطة حاليًا.','hot'),visits:()=>workSection('زيارات اليوم والزيارات القادمة',visits,'لا توجد زيارات مسجلة لليوم أو للأيام القادمة.','visits'),tasks:()=>workSection('المهام العاجلة أولًا',tasks,'لا توجد مهام عاجلة مسجلة.','tasks'),deals:()=>workSection('الصفقات المفتوحة',deals,'لا توجد صفقات مفتوحة حاليًا.','deals'),contact:()=>workSection('بانتظار توثيق التواصل',contact,'لا يوجد تواصل ينتظر التوثيق.','contact')};
    if(dashboardCategory!=='all'&&sections[dashboardCategory])return sections[dashboardCategory]();
    return '<div class="ops-day-grid">'+sections.followups()+sections.tasks()+sections.visits()+sections.deals()+'</div>';
  }
  function renderDashboard(){
    const box=$id('opsDailyWork');if(!box)return;
    if(!dashboardScopes.has(dashboardScope))dashboardScope='branches';
    const state=dashboardScopes.get(dashboardScope),owner=currentProfile?.role==='owner';
    if(!state)return;
    box.innerHTML='<div class="ops-summary-grid '+(owner?'':'ops-single-scope')+'">'+[...dashboardScopes].map(([scope,item])=>scopeCard(scope,item)).join('')+'</div><div class="ops-work-head"><div><h2>قائمة العمل</h2><p>خطوة تالية واضحة، من نفس السجل.</p></div>'+(owner?'<div class="ops-scope-tabs" aria-label="نطاق قائمة العمل">'+scopeButtons()+'</div>':'')+'</div><div class="ops-category-tabs" aria-label="نوع العمل">'+[['all','الأولوية الآن'],['followups','المتابعات'],['tasks','المهام'],['visits','الزيارات'],['deals','الصفقات'],['hot','الفرص الحارة'],['contact','التواصل']].map(([key,label])=>'<button class="ops-filter '+(dashboardCategory===key?'active':'')+'" data-dashboard-category="'+key+'" aria-pressed="'+(dashboardCategory===key)+'">'+label+'</button>').join('')+'</div><div id="opsScopeWork">'+
      (state.status==='loading'?'<div class="ops-state" role="status">جاري تحميل قائمة العمل…</div>':state.status==='error'?'<div class="ops-error" role="alert"><strong>قائمة العمل غير متاحة حاليًا</strong><span>أعد تحميل هذا القسم. يمكنك متابعة الأقسام الأخرى المتاحة.</span><button class="ops-action" data-dashboard-retry="'+dashboardScope+'">إعادة المحاولة</button></div>':dashboardScope==='investment'&&!Object.values(state.data.counts||{}).some(v=>Number(v)>0)&&!Object.values(state.data.totals||{}).some(v=>Number(v)>0)&&!['requests','followups','hotRequests','visits','deals','tasks','contactQueue'].some(key=>(state.data[key]||[]).length)?'<div class="ops-investment-empty"><div><strong>مساحتك الخاصة للمستثمرين جاهزة</strong><p>أضف المستثمر، ثم حدّد الخطوة القادمة وموعد متابعتها ليظهر العمل هنا.</p></div>'+workButton('new-investor','إضافة مستثمر')+'</div>':dashboardWork(state.data))+'</div>';
    // Legacy client filters are populated only with the selected scope; rows never mix scopes.
    window.dashboardClientFilters=state.data?.clientFilters||{uncontacted:[],due:[],hotfocus:[]};
    window.dashboardContactQueue=state.data?.contactQueue||[];
    window.dashboardWorkSnapshot=state.data||null;
  }
  async function loadDashboardScope(scope){
    if(scope==='investment'&&currentProfile?.role!=='owner')return;
    const generation=crmSessionGeneration,user=currentUser&&currentUser.id,request={status:'loading'};
    dashboardScopes.set(scope,request);renderDashboard();
    const current=()=>dashboardScopes.get(scope)===request&&crmSessionCurrent(generation,user);
    try{
      const r=await bounded(supa.rpc('crm_dashboard_work',{p_scope:scope,p_limit:20,p_offset:0}));
      if(!current())return;
      if(r.error)throw r.error;
      if(!r.data||!r.data.counts||r.data.scope!==scope)throw new Error('لم تكتمل بيانات هذا القسم. حاول تحديثه.');
      request.status='ready';request.data=r.data;
    }catch(e){if(!current())return;request.status='error';request.error=e.message||'تعذر الاتصال بالخادم.';}
    if(current())renderDashboard();
  }
  async function loadDashboardMore(category){
    const scope=dashboardScope,state=dashboardScopes.get(scope),field=listFields[category];if(!field||state?.status!=='ready'||state.more?.[category]?.loading)return;
    const generation=crmSessionGeneration,user=currentUser&&currentUser.id,offset=(state.data[field]||[]).length;
    state.more=state.more||{};state.more[category]={loading:true};renderDashboard();
    const current=()=>dashboardScopes.get(scope)===state&&crmSessionCurrent(generation,user);
    try{
      const r=await bounded(supa.rpc('crm_dashboard_work',{p_scope:scope,p_limit:20,p_offset:offset}));if(!current())return;
      if(r.error)throw r.error;if(r.data?.scope!==scope||!Array.isArray(r.data[field]))throw new Error('لم تكتمل القائمة. أعد المحاولة.');
      const append=(existing,added)=>[...new Map([...(existing||[]),...(added||[])].map(row=>[row.id||row.client_id,row])).values()];
      state.data[field]=append(state.data[field],r.data[field]);state.data.clients=append(state.data.clients,r.data.clients);state.data.totals=r.data.totals||state.data.totals;
      if(!r.data[field].length&&offset<Number(state.data.totals?.[field]||0))throw new Error('تغيّرت القائمة أثناء التحميل. حدّث الملخص للحصول على آخر البيانات.');
      state.more[category]={loading:false};
    }catch(e){if(!current())return;state.more[category]={loading:false,error:e.message||'تعذر تحميل بقية السجلات.'};}
    if(current())renderDashboard();
  }
  window.crmLoadDashboardWork=async function(){
    if(!currentUser||!currentProfile)return;
    const session=crmSessionGeneration+':'+currentUser.id;
    if(session!==dashboardSession){dashboardScopes.clear();dashboardScope='branches';dashboardCategory='all';dashboardSession=session;}
    const owner=currentProfile.role==='owner';
    if(!owner)dashboardScopes.delete('investment');
    const title=$id('opsDashboardTitle');if(title)title.textContent=owner?'لوحة الإدارة':'لوحة العمل';
    const description=$id('opsDashboardScopeNote');if(description)description.textContent=owner?'متابعة الفرعين وأعمال المستثمرين، كل مسار في مساحة واضحة.':'المتابعات والزيارات والمهام الخاصة بنطاق حسابك.';
    const date=$id('opsDashboardDate');if(date)date.textContent=new Date().toLocaleDateString('ar-OM-u-nu-latn',{timeZone:'Asia/Muscat',weekday:'long',day:'numeric',month:'long',year:'numeric'});
    const panel=$id('opsPerformanceDetails');if(panel){panel.hidden=!['owner','manager','agent'].includes(currentProfile.role);const heading=panel.querySelector('summary>span');if(heading)heading.textContent=owner||currentProfile.role==='manager'?'أداء الفريق خلال الفترة':'أدائي خلال الفترة';}
    if(typeof loadEmployeeTargetReminder==='function')loadEmployeeTargetReminder();
    const scopes=owner?['branches','investment']:['branches'];scopes.forEach(scope=>dashboardScopes.set(scope,{status:'loading'}));renderDashboard();
    await Promise.allSettled(scopes.map(loadDashboardScope));
  };
  window.loadDashboard=window.crmLoadDashboardWork;
  const propertyActionQueue=window.loadPropertyActionQueue;
  if(typeof propertyActionQueue==='function')window.loadPropertyActionQueue=function(target){if(target==='dashboard')return Promise.resolve();return propertyActionQueue.apply(this,arguments);};
  document.addEventListener('click',e=>{
    const more=e.target.closest('[data-dashboard-more]');if(more){loadDashboardMore(more.dataset.dashboardMore);return;}
    const performanceRetry=e.target.closest('[data-performance-retry]');if(performanceRetry){renderPerformance(performanceRetry.dataset.performanceRetry,performanceRetry.dataset.performanceBox);return;}
    const retry=e.target.closest('[data-dashboard-retry]');if(retry){loadDashboardScope(retry.dataset.dashboardRetry);return;}
    const control=e.target.closest('[data-dashboard-scope],[data-dashboard-category]');if(!control)return;
    const scope=control.dataset.dashboardScope,category=control.dataset.dashboardCategory;
    if(scope&&dashboardScopes.has(scope)){dashboardScope=scope;dashboardCategory=category||'all';}
    else if(category)dashboardCategory=category;
    renderDashboard();
  });
  const oldPhone=window.formatPhoneDisplay;
  if(typeof oldPhone==='function')window.formatPhoneDisplay=function(v){return oldPhone(v).replace(/<span dir="ltr"/g,'<bdi dir="ltr"').replace(/<\/span>/g,'</bdi>')};
  let propertySearch='',propertyBranch='',propertyArea='',propertyStatus='';
  const propertyStatusLabel=s=>({available:'متوفر',reserved:'محجوز',deposit:'عربون',negotiating:'تفاوض',sold:'مباع',not_available:'غير متاح'}[s]||s||'غير محدد');
  function propertyActions(p){
    const button=(action,label)=>'<button type="button" class="ops-action" data-work-action="'+action+'" data-work-id="'+safe(p.id)+'">'+label+'</button>';
    return '<div class="ops-property-actions">'+button('property','التفاصيل')+(canEdit()?(p.archived?button('restore-property','استعادة من الأرشيف'):button('edit-property','تعديل')+button('archive-property','أرشفة العقار')):'')+'</div>';
  }
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
      return heading+'<section class="ops-area"><h4>'+safe(g.area)+' <small>'+g.items.length+' عقارات</small></h4><div class="ops-property-grid">'+g.items.map(p=>'<article class="ops-property"><div class="ops-property-top"><span class="ops-status '+(!p.archived&&p.status==='available'?'ops-available':'')+'">'+safe((p.archived?'مؤرشف · ':'')+propertyStatusLabel(p.status))+'</span><bdi dir="ltr" class="ops-code">'+safe(p.property_code||'')+'</bdi></div><button type="button" class="ops-title" data-work-action="property" data-work-id="'+safe(p.id)+'">'+safe(p.title||'عقار')+'</button><div class="ops-property-price">'+n(p.price)+' <small>ر.ع</small></div><p>'+safe(typeof propTypeAr==='function'?propTypeAr(p.type):p.type||'')+(p.bedrooms?' · '+n(p.bedrooms)+' غرف':'')+(p.land_size?' · '+n(p.land_size)+' م²':'')+'</p><div class="ops-property-foot"><small>أضيف '+safe(dateText(p.created_at))+'</small>'+propertyActions(p)+'</div></article>').join('')+'</div></section>';
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
    if(isOwner())bar.innerHTML=['all','muscat','barka','investment','general'].map(k=>'<button class="btn-secondary '+(k===clientBranch?'active':'')+'" data-client-branch="'+k+'">'+({all:'الكل',muscat:'مسقط',barka:'بركاء',investment:'المستثمرين · خاص بالمالك',general:'غير محدد'}[k])+'</button>').join('');else bar.remove();
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
      return '<article class="ops-client"><div class="ops-client-head"><div><button class="ops-title" data-work-action="client" data-client-id="'+safe(c.id)+'">'+safe(c.name||'عميل')+'</button><div class="ops-client-contact"><bdi dir="ltr">'+safe(typeof crmPhoneText==='function'?crmPhoneText(c.phone):c.phone||'')+'</bdi><span>'+safe(c.lead_route==='barka'?'بركاء':c.lead_route==='muscat'?'مسقط':c.lead_route==='investment'?'المستثمرين · خاص بالمالك':'فرع غير مصنف')+'</span></div></div><span class="ops-status">'+safe(c.archived?'مؤرشف':(requests.length?requests.length+' طلب مستقل':'لا طلب نشط'))+'</span></div>'+
      (requests.map(r=>'<div class="ops-request"><div><strong>'+safe(requestLabel(r))+'</strong><small class="'+(r.next_followup&&workDate(r.next_followup)<today?'ops-overdue':'')+'">'+safe(dueLabel(r.next_followup))+' · '+safe(r.status==='paused'?'متوقف مؤقتاً':({new:'جديد',contacted:'تم التواصل',qualified:'مؤهل',viewing_scheduled:'زيارة محجوزة',viewed:'زيارة تمت',negotiation:'تفاوض'}[r.pipeline_stage]||'نشط'))+'</small>'+(r.next_action?'<small class="ops-next-action">التالي: '+safe(r.next_action)+'</small>':'')+'</div>'+workButton('request',canEdit()?'فتح الطلب':'تفاصيل العميل',c.id,r.id)+'</div>').join('')||'<p class="ops-note">لا يوجد طلب نشط مسجل. افتح الملف لمراجعة السياق أو إضافة طلب مستقل.</p>')+
      '<div class="ops-client-foot">'+workButton('client','ملف العميل',c.id)+(canEdit()?workButton(c.archived?'restore-client':'edit-client',c.archived?'استرجاع':'تعديل بيانات التواصل',c.id):'')+'</div></article>';
    }).join('');
  };
  window.crmResetOperations=function(){
    teamPerformancePeriod='month';dashboardScopes.clear();dashboardSession='';dashboardScope='branches';dashboardCategory='all';
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
      else if(action==='new-investor'&&isOwner()){openCreateModal('mClient');const investor=$id('cRoleInvestor');if(investor){investor.checked=true;updateClientInvestmentForm();}}
      else if(action==='clients'||action==='due-clients'){navigate('clients',null);clientWorkFilter=action==='due-clients'?'due':'all';}
      else if(action==='client')await viewClient(client);
      else if(action==='request'){await viewClient(client);if(canEdit()&&viewingClient&&viewingClient.id===client)await openClientRequestForm(request,client);else if(typeof client360SwitchTab==='function')client360SwitchTab('requests');}
      else if(action==='edit-client'&&canEdit())await editClient(client);
      else if(action==='restore-client'&&canEdit())restoreClientById(client);
      else if(action==='visit'){if(canEdit())await editViewing(id);else await viewClient(client);}
      else if(action==='visits')navigate('viewings',null);
      else if(action==='task'){if(canEdit())await editTask(id);else navigate('daily',null);}
      else if(action==='tasks')navigate('daily',null);
      else if(action==='deal'){if(canEdit()&&typeof editDeal==='function')await editDeal(id);else navigate('deals',null);}
      else if(['property','edit-property','archive-property','restore-property'].includes(action)){
        e.preventDefault();e.stopPropagation();
        const property=allProperties.find(p=>p.id===id);
        if(!property){showToast('العقار غير موجود في العرض الحالي. حدّث القائمة ثم حاول مجددًا.','error');return;}
        if(action==='property')await viewProperty(id);
        else if(!canEdit())showPermissionDenied();
        else if(action==='edit-property'&&!property.archived)await editProperty(id);
        else if(action==='archive-property'&&!property.archived)archivePropertyById(id);
        else if(action==='restore-property'&&property.archived)restorePropertyById(id);
      }
      else if(action==='clear-properties'){propertySearch=propertyBranch=propertyArea=propertyStatus='';['opsPropertySearch','opsPropertyBranch','opsPropertyStatus'].forEach(id=>{if($id(id))$id(id).value='';});renderOrganizedProperties();}
      else if(action==='clear-clients'){clientWorkFilter='all';renderClients();}
    }catch(err){showToast('تعذر فتح الإجراء: '+err.message,'error');}
  });
  // An owner CSV is based on actual visits. Inferred visit interest is shown separately from inbound leads.
  window.exportPropertyOwnerReport=async function(){
    const p=window.viewingProperty,generation=crmSessionGeneration,user=currentUser&&currentUser.id;if(!p||!user)return;
    try{const [ir,vr,mr]=await Promise.all([
      supa.from('property_inquiries').select('client_id,has_inbound_inquiry,inquiry_count,status,rejection_reason').eq('property_id',p.id),
      supa.from('viewings').select('client_id,status,archived').eq('property_id',p.id),
      supa.from('property_marketing_events').select('channel,event_type,published_at,views,plays,reach,total_interactions,last_synced_at,url,notes').eq('property_id',p.id).order('created_at',{ascending:false})]);
      if(!crmSessionCurrent(generation,user))return;
      [ir,vr,mr].forEach(r=>{if(r.error)throw r.error});const inbound=(ir.data||[]).filter(x=>x.has_inbound_inquiry),visits=(vr.data||[]).filter(x=>!x.archived),marketing=mr.data||[],visitedClients=new Set(visits.filter(x=>x.status!=='cancelled').map(x=>x.client_id));
      const rows=[['العقار',p.title],['المنطقة',p.area||''],['السعر',p.price||''],['تاريخ تسجيل العقار',dateText(p.created_at)],
        ['عملاء لديهم استفسار وارد مثبت',new Set(inbound.map(x=>x.client_id)).size],['اهتمامات مستنتجة من زيارة',new Set((ir.data||[]).filter(x=>!x.has_inbound_inquiry&&visitedClients.has(x.client_id)).map(x=>x.client_id)).size],
        ['زيارات حجزت',visits.filter(x=>x.status!=='cancelled').length],['زيارات تمت',visits.filter(x=>x.status==='done').length],
        ['زيارات ألغيت',visits.filter(x=>x.status==='cancelled').length],['في التفاوض',inbound.filter(x=>x.status==='negotiation').length],['لم يناسبه',inbound.filter(x=>x.status==='not_suitable').length],[],
        ['سجل التسويق'],['القناة','النشاط','التاريخ','المشاهدات','الوصول','التفاعلات','آخر تحديث','الرابط','ملاحظات']];
      marketing.forEach(m=>rows.push([m.channel||'',m.event_type||'',dateText(m.published_at),m.views??m.plays??'غير متاح',m.reach??'غير متاح',m.total_interactions??'غير متاح',m.last_synced_at?dateText(m.last_synced_at):'لم يحدث',m.url||'',m.notes||'']));
      if(!crmSessionCurrent(generation,user))return;
      downloadCSV('تقرير-أداء-'+(p.title||'العقار'),[],rows);
    }catch(e){if(crmSessionCurrent(generation,user))showToast('تعذر إعداد التقرير: '+e.message,'error')}
  };
  addPerformance();
  if(window.crmDashboardPending){window.crmDashboardPending=false;window.loadDashboard();}
})();
