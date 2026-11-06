/* Owner home page (5 November 2026). Four sections only: what needs a decision, problems, properties,
 * a short report. Reads crm_owner_home (owner only). Staff keep their own work page, and the owner's
 * full work list stays one click away, so nothing that can be edited by hand is lost.
 * If the data does not load, the old page stays as it was. */
(function(){
  'use strict';
  const byId=id=>document.getElementById(id);
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
  const num=v=>Number(v||0).toLocaleString('en-US');
  const isOwner=()=>typeof currentProfile!=='undefined'&&currentProfile&&currentProfile.role==='owner';
  const SHOWN=6;
  let sequence=0,showAll=false,visitsOpen=false;

  function mount(){
    const page=byId('page-dash');if(!page)return null;
    let box=byId('crmOwnerHome');
    if(box)return box;
    box=document.createElement('div');box.id='crmOwnerHome';box.className='coh';box.hidden=true;
    box.innerHTML=''
      +'<section class="card coh-sec"><h2 class="coh-title">يحتاج قرارك</h2><div id="cohDecide"></div><div id="cohTwins"></div><div id="cohIg"></div></section>'
      +'<section class="card coh-sec"><h2 class="coh-title">مشاكل</h2><div id="cohProblems"></div></section>'
      +'<section class="card coh-sec"><h2 class="coh-title">العقارات</h2><div id="cohProperties"></div></section>'
      +'<section class="card coh-sec"><h2 class="coh-title">تقرير قصير</h2><div id="cohReport"></div></section>'
      +'<button type="button" class="btn-secondary coh-full" data-coh="full" aria-expanded="false">قائمة العمل الكاملة</button>';
    const header=page.querySelector('.page-header');if(header)header.after(box);else page.prepend(box);
    return box;
  }
  function visitRow(v,late){
    return '<li class="coh-row"><div class="coh-info"><strong>'+esc(v.property||'عقار')+'</strong><small>'+esc(v.client||'—')+' · '
      +(late?'<span class="coh-late">فات موعدها '+esc(v.viewing_date)+'</span>':esc(v.viewing_date)+(v.viewing_time?' · <bdi dir="ltr">'+esc(String(v.viewing_time).slice(0,5))+'</bdi>':''))
      +'</small>'+(late&&v.notes?'<small class="coh-note">'+esc(v.notes)+'</small>':'')+'</div>'
      +'<button type="button" class="'+(late?'btn-primary':'btn-secondary')+' coh-go" data-cqv="result" data-id="'+esc(v.id)+'">سجّل النتيجة</button></li>';
  }
  function link(label,count,nav){
    return '<button type="button" class="coh-link" data-coh="nav" data-nav="'+esc(nav)+'"><span>'+esc(label)+'</span><b dir="ltr">'+num(count)+'</b></button>';
  }
  function drawDecide(d,pending){
    const links=[];
    if(pending)links.push(link('ردود تنتظر موافقتك',pending,'replies'));
    if(d.owner_leads_new)links.push(link('عروض ملاك جديدة هذا الأسبوع',d.owner_leads_new,'owner-leads'));
    const overdue=d.overdue||[],rows=showAll?overdue:overdue.slice(0,SHOWN);
    // Owner's decision 6 Nov: visit results are the AI's job (it reads the chats and records them). They are a box he can open,
    // not a decision. A serious buyer reaches him as «🔥 مشتري جاد» at the top of the page.
    if(Number(d.overdue_total))links.push('<button type="button" class="coh-link" data-coh="visits" aria-expanded="'+visitsOpen+'"><span>زيارات يتابعها الذكاء الاصطناعي</span><b dir="ltr">'+num(d.overdue_total)+'</b></button>');
    // Upcoming visits stay here until the first visit logged by itself from WhatsApp proves the logging works.
    const upcoming=Number(d.auto_visits)>0?[]:(d.upcoming||[]);
    let h=links.length?'<div class="coh-links">'+links.join('')+'</div>':'';
    if(visitsOpen&&overdue.length){
      h+='<div class="coh-subhead"><h3>زيارات فات موعدها بدون نتيجة</h3><button type="button" class="coh-add" data-cqv="new">+ زيارة ما كانت مسجّلة</button></div>'
        +'<p class="coh-since">الذكاء الاصطناعي يسأل العميل ويسجل النتيجة لحاله أول ما يرد. تقدر تسجلها أنت إذا تعرفها</p>';
      h+='<ul class="coh-list">'+rows.map(v=>visitRow(v,true)).join('')+'</ul>';
      if(overdue.length>SHOWN)h+='<button type="button" class="coh-more" data-coh="more">'+(showAll?'عرض أقل':'عرض الكل ('+num(overdue.length)+')')+'</button>';
    }
    if(!links.length&&!upcoming.length)h+='<p class="coh-empty">ما في شي يحتاج قرارك الحين</p>';
    if(upcoming.length)h+='<div class="coh-subhead"><h3>زيارات خلال أسبوع <b dir="ltr">'+num(upcoming.length)+'</b></h3></div><ul class="coh-list">'+upcoming.map(v=>visitRow(v,false)).join('')+'</ul>';
    byId('cohDecide').innerHTML=h;
    // The Instagram cards keep their own code and buttons; only their place on the page changes.
    const ig=byId('igDiscoveryAlert'),slot=byId('cohIg');if(ig&&slot&&ig.parentNode!==slot)slot.append(ig);
  }
  // Identical properties where a video is on one and not on the other. Nothing links before a yes.
  function drawTwins(groups){
    const open=(groups||[]).filter(g=>!g.dismissed&&g.properties.some(p=>Number(p.videos)<Number(g.videos)));
    byId('cohTwins').innerHTML=open.length?'<div class="coh-subhead"><h3>عقارات بنفس المواصفات <b dir="ltr">'+num(open.length)+'</b></h3></div><ul class="coh-list">'+open.map(g=>'<li class="coh-twin"><strong>'+g.properties.map(p=>esc(p.title)).join(' · ')+'</strong><small>'+g.properties.map(p=>num(p.videos)+' فيديو').join(' · ')+'</small><p>تربط كل الفيديوهات على الكل ؟ أداء الفيديو واستفساراته تنحسب لكل عقار</p><div class="coh-twin-actions"><button type="button" class="btn-primary" data-coh="twin-yes" data-key="'+esc(g.key)+'">نعم اربطهم</button><button type="button" class="btn-secondary" data-coh="twin-no" data-key="'+esc(g.key)+'">لا مختلفين</button></div></li>').join('')+'</ul>':'';
  }
  function drawProblems(list){
    byId('cohProblems').innerHTML=list.length?'<ul class="coh-list">'+list.map(p=>'<li class="coh-row coh-problem"><div class="coh-info"><strong>'+esc(p.title)+(p.count?' <b dir="ltr">'+num(p.count)+'</b>':'')+'</strong>'+(p.detail?'<small>'+esc(p.detail)+'</small>':'')+'</div>'
      +(p.nav?'<button type="button" class="btn-secondary coh-go" data-coh="nav" data-nav="'+esc(p.nav)+'">فتح</button>':'')+'</li>').join('')+'</ul>':'<p class="coh-empty">ما في مشاكل الحين</p>';
  }
  function drawProperties(p){
    const label={barka:'بركاء',muscat:'مسقط'};
    const cells=(p.branches||[]).map(b=>'<div class="coh-stat"><small>'+esc(label[b.branch]||b.branch)+'</small><strong dir="ltr">'+num(b.available)+'</strong><small>متاح من هدف 10 · '+num(b.reserved)+' محجوز</small></div>').join('');
    const noVideo=p.no_video||[];
    byId('cohProperties').innerHTML='<div class="coh-stats">'+cells+'<div class="coh-stat"><small>أضيفت هذا الأسبوع</small><strong dir="ltr">'+num(p.added_week)+'</strong></div><div class="coh-stat"><small>توفرها ما تأكد من شهر</small><strong dir="ltr">'+num(p.unchecked)+'</strong></div></div>'
      +(noVideo.length?'<div class="coh-novideo"><strong>متاحة من أكثر من 7 أيام بدون فيديو <b dir="ltr">'+num(noVideo.length)+'</b></strong><p>'+noVideo.map(esc).join(' · ')+'</p></div>':'')
      +'<button type="button" class="coh-more" data-coh="nav" data-nav="properties">كل العقارات</button>';
  }
  function drawReport(r){
    const cells=[['عملاء جدد',r.new_clients],['ردود الوكيل',r.agent_replies],['زيارات تمت',r.visits_done],['حجوزات هذا الشهر',r.bookings_month],['مبيعات هذا الشهر',r.sales_month]];
    byId('cohReport').innerHTML='<p class="coh-since">من يوم '+esc(r.week_start)+'</p><div class="coh-stats">'+cells.map(([l,v])=>'<div class="coh-stat"><small>'+esc(l)+'</small><strong dir="ltr">'+num(v)+'</strong></div>').join('')+'</div>'
      +'<button type="button" class="coh-more" data-coh="nav" data-nav="reports">التقارير الكاملة</button>';
  }
  let last=null;
  async function load(){
    const page=byId('page-dash'),box=mount();if(!page||!box)return;
    if(!isOwner()||typeof supa==='undefined'){box.hidden=true;page.classList.remove('coh-on');return;}
    const seq=++sequence;
    const [home,pending,twinGroups]=await Promise.all([supa.rpc('crm_owner_home'),typeof window.crmPendingReplies==='function'?window.crmPendingReplies().catch(()=>0):0,supa.rpc('crm_property_twins')]);
    if(seq!==sequence)return;
    if(home.error||!home.data){if(!last){box.hidden=true;page.classList.remove('coh-on');}return;}
    last={data:home.data,pending:pending||0,twins:twinGroups&&!twinGroups.error?twinGroups.data:[]};
    render();
    box.hidden=false;page.classList.add('coh-on');
  }
  function render(){
    if(!last)return;
    const d=last.data;
    drawDecide(d,last.pending);drawTwins(last.twins);drawProblems(d.problems||[]);drawProperties(d.properties||{});drawReport(d.report||{});
  }
  document.addEventListener('click',e=>{
    const b=e.target.closest('[data-coh]');if(!b)return;
    const act=b.dataset.coh;
    if(act==='more'){showAll=!showAll;render();}
    else if(act==='visits'){visitsOpen=!visitsOpen;render();}
    else if(act==='full'){const page=byId('page-dash'),open=page.classList.toggle('coh-full-open');b.setAttribute('aria-expanded',String(open));b.textContent=open?'إخفاء قائمة العمل الكاملة':'قائمة العمل الكاملة';}
    else if(act==='twin-yes'||act==='twin-no'){
      b.disabled=true;
      const toast=(m,t)=>{if(typeof showToast==='function')showToast(m,t);};
      const call=act==='twin-yes'?supa.rpc('crm_link_twin_group',{p_properties:b.dataset.key.split(',')}):supa.rpc('crm_dismiss_twin_group',{p_key:b.dataset.key});
      call.then(r=>{if(r.error)throw r.error;toast(act==='twin-yes'?'انربطت الفيديوهات على الكل':'تمام ما راح أسأل عنهم مرة ثانية','success');return window.crmOwnerHomeRefresh();}).catch(()=>{b.disabled=false;toast('ما انحفظ. جرب مرة ثانية','error');});
    }
    else if(act==='nav'&&typeof navigate==='function'){const nav=b.dataset.nav;navigate(nav,{replies:byId('navReplies'),'owner-leads':byId('navOwnerLeads')}[nav]||null);}
  });
  window.crmOwnerHomeRefresh=()=>load().catch(()=>{});
  const loadDash=window.loadDashboard;
  if(typeof loadDash==='function')window.loadDashboard=function(){const r=loadDash.apply(this,arguments);window.crmOwnerHomeRefresh();return r;};
})();
