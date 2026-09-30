(function(){
  'use strict';
  const $id=id=>document.getElementById(id);
  const safe=v=>escapeHtml(String(v==null?'':v));
  const n=v=>Number(v||0).toLocaleString('en-US');
  const omanDate=d=>new Date(d).toLocaleDateString('en-CA',{timeZone:'Asia/Muscat'});
  const dateText=d=>d?new Date(d).toLocaleDateString('ar-OM',{timeZone:'Asia/Muscat'}):'—';
  function period(kind){
    const today=omanDate(new Date()),date=new Date(today+'T12:00:00+04:00');
    let start=today,end=new Date(date.getTime()+86400000);
    if(kind==='week'){const offset=date.getDay();start=omanDate(new Date(date.getTime()-offset*86400000));}
    if(kind==='month')start=today.slice(0,7)+'-01';
    return {from:start,to:kind==='day'?omanDate(end):kind==='week'?omanDate(new Date(date.getTime()+(7-date.getDay())*86400000)):omanDate(new Date(Number(today.slice(0,4)),Number(today.slice(5,7)),1))};
  }
  const metric=(label,value)=>'<span class="ops-metric"><strong>'+n(value)+'</strong><small>'+label+'</small></span>';
  function targetScore(row,kind){
    const t=row.targets||{},days=kind==='day'?1:kind==='week'?7:new Date(Number(period('month').to.slice(0,4)),Number(period('month').to.slice(5,7))-1,0).getDate();
    const monthDays=new Date(Number(period('month').to.slice(0,4)),Number(period('month').to.slice(5,7))-1,0).getDate();
    const goals=[['active_inventory','inventory_target',false],['new_properties','new_properties_target',true],['inquiries','inquiries_target',true],['visits_done','visits_target',true],['sales','sold_target',true]];
    const valid=goals.map(([key,target,flow])=>{let goal=t[target]??(target==='inventory_target'?10:null);if(goal==null||Number(goal)<=0)return null;goal=Number(goal)*(flow?days/monthDays:1);return Math.min(1,Number(row[key]||0)/goal)}).filter(x=>x!==null);
    return valid.length?'تحقيق الأهداف المحددة: '+Math.round(100*valid.reduce((a,b)=>a+b,0)/valid.length)+'% ('+valid.length+'/5)':'لم تُحدد أهداف كافية للتقييم';
  }
  async function renderPerformance(kind){
    const box=$id('employeePerformanceResults');if(!box)return;
    box.textContent='جاري حساب الأداء...';
    try{
      const span=period(kind),r=await supa.rpc('crm_employee_performance',{p_from:span.from,p_to:span.to});
      if(r.error)throw r.error;
      box.innerHTML='<p class="ops-note">'+safe(span.from)+' إلى '+safe(span.to)+' · الاستفسار المثبت برسالة واردة فقط. الزيارات والمبيعات نشاط مسجل خلال الفترة، ونسب التحويل تُحسب على مجموعة الاستفسارات أو الزيارات نفسها. لا تُنسب العقارات القديمة إلى موظف بالتخمين.</p>'+
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
  const oldDashboard=window.loadDashboard;
  if(typeof oldDashboard==='function')window.loadDashboard=async function(){const result=await oldDashboard.apply(this,arguments);if(currentProfile&&currentProfile.role==='agent'){
    let box=$id('employeePerformanceMini');if(!box){box=document.createElement('div');box.id='employeePerformanceMini';box.className='ops-mini';($id('employeeInventoryReminder')||$id('page-dash')).append(box)}
    const d=period('month'),r=await supa.rpc('crm_employee_performance',{p_from:d.from,p_to:d.to});if(!r.error&&r.data.employees?.[0]){const x=r.data.employees[0];box.textContent='هذا الشهر: '+n(x.new_properties)+' عقار جديد · '+n(x.inquiries)+' استفسارات مثبتة · '+n(x.visits_done)+' زيارات · '+n(x.sales)+' مبيعات';}
  }return result};
  const oldPhone=window.formatPhoneDisplay;
  if(typeof oldPhone==='function')window.formatPhoneDisplay=function(v){return oldPhone(v).replace(/<span dir="ltr"/g,'<bdi dir="ltr"').replace(/<\/span>/g,'</bdi>')};
  const oldProperties=window.loadProperties;
  if(typeof oldProperties==='function')window.loadProperties=async function(){await oldProperties.apply(this,arguments);const list=$id('propertiesList');if(!list||!allProperties?.length)return;
    const groups=new Map();allProperties.slice().sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).forEach(p=>{
      const branch=p.branch_key==='barka'?'بركاء':p.branch_key==='muscat'?'مسقط':'غير محدد';const area=p.area||'منطقة غير محددة',key=branch+'|'+area;
      if(!groups.has(key))groups.set(key,{branch,area,items:[]});groups.get(key).items.push(p)});
    const ordered=[...groups.values()].sort((a,b)=>['مسقط','بركاء','غير محدد'].indexOf(a.branch)-['مسقط','بركاء','غير محدد'].indexOf(b.branch)||a.area.localeCompare(b.area,'ar'));
    let last='';list.innerHTML=ordered.map(g=>{const heading=g.branch===last?'':'<h3 class="ops-branch">'+safe(g.branch)+'</h3>';last=g.branch;return heading+'<section class="ops-area"><h4>'+safe(g.area)+' <small>('+g.items.length+')</small></h4><div class="ops-property-grid">'+g.items.map(p=>'<button class="ops-property" onclick="viewProperty(\''+p.id+'\')"><strong>'+safe(p.title)+'</strong><span>'+safe(p.status==='sold'?'مباع':p.status==='available'?'متوفر':p.status||'—')+' · '+n(p.price)+' ر.ع</span><small>أضيف '+safe(dateText(p.created_at))+'</small></button>').join('')+'</div></section>'}).join('');
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
  // An owner CSV is based on actual visits. Inferred visit interest is shown separately from inbound leads.
  window.exportPropertyOwnerReport=async function(){
    const p=window.viewingProperty;if(!p)return;
    try{const [ir,vr,mr]=await Promise.all([
      supa.from('property_inquiries').select('client_id,has_inbound_inquiry,inquiry_count,status,rejection_reason').eq('property_id',p.id),
      supa.from('viewings').select('client_id,status,archived').eq('property_id',p.id),
      supa.from('property_marketing_events').select('channel,event_type,published_at,views,reach,total_interactions,last_synced_at,url,notes').eq('property_id',p.id).order('created_at',{ascending:false})]);
      [ir,vr,mr].forEach(r=>{if(r.error)throw r.error});const inbound=(ir.data||[]).filter(x=>x.has_inbound_inquiry),visits=(vr.data||[]).filter(x=>!x.archived),marketing=mr.data||[],visitedClients=new Set(visits.map(x=>x.client_id));
      const rows=[['العقار',p.title],['المنطقة',p.area||''],['السعر',p.price||''],['تاريخ تسجيل العقار',dateText(p.created_at)],
        ['عملاء لديهم استفسار وارد مثبت',new Set(inbound.map(x=>x.client_id)).size],['اهتمامات مستنتجة من زيارة',new Set((ir.data||[]).filter(x=>!x.has_inbound_inquiry&&visitedClients.has(x.client_id)).map(x=>x.client_id)).size],
        ['زيارات حجزت',visits.filter(x=>x.status!=='cancelled').length],['زيارات تمت',visits.filter(x=>x.status==='done').length],
        ['زيارات ألغيت',visits.filter(x=>x.status==='cancelled').length],['في التفاوض',inbound.filter(x=>x.status==='negotiation').length],['لم يناسبه',inbound.filter(x=>x.status==='not_suitable').length],[],
        ['سجل التسويق'],['القناة','النشاط','التاريخ','المشاهدات','الوصول','التفاعلات','آخر تحديث','الرابط','ملاحظات']];
      marketing.forEach(m=>rows.push([m.channel||'',m.event_type||'',dateText(m.published_at),m.views??'غير متاح',m.reach??'غير متاح',m.total_interactions??'غير متاح',m.last_synced_at?dateText(m.last_synced_at):'لم يحدث',m.url||'',m.notes||'']));
      downloadCSV('تقرير-أداء-'+(p.title||'العقار'),[],rows);
    }catch(e){showToast('تعذر إعداد التقرير: '+e.message,'error')}
  };
  addPerformance();
})();
