/* Owner home page (redesigned 9 November 2026). One screen: a hello line, big tiles for what needs Ahmed now
 * (each opens a sheet over the page or its own page, so the home page stays short), small quick decisions,
 * hot-buyer alerts at the top, and one compact summary. The old work list stays one click away.
 * Reads crm_owner_home and crm_paused_chats (owner only). If the data does not load, the old page stays as it was. */
(function(){
  'use strict';
  const byId=id=>document.getElementById(id);
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
  const num=v=>Number(v||0).toLocaleString('en-US');
  const isOwner=()=>typeof currentProfile!=='undefined'&&currentProfile&&currentProfile.role==='owner';
  const toast=(m,t)=>{if(typeof showToast==='function')showToast(m,t);};
  const KIND={negotiation:'تفاوض أو مشتري جاد',handoff:'يحتاج قرارك',muted:'مكتوم عنهم',manual_reply:'رديت بنفسك'};
  const TITLES={followups:'متابعة اليوم',paused:'العقل موقوف عندهم',visits:'زيارات يتابعها الذكاء الاصطناعي',problems:'مشاكل تحتاج انتباه'};
  let sequence=0,sheetKind=null,pausedFilter='all',paused={items:[],total:0},last=null;

  function mount(){
    const page=byId('page-dash');if(!page)return null;
    let box=byId('crmOwnerHome');
    if(box)return box;
    box=document.createElement('div');box.id='crmOwnerHome';box.className='coh';box.hidden=true;
    box.innerHTML='<section class="coh-hello" id="cohHello"></section>'
      +'<section class="coh-now" aria-labelledby="cohNowTitle"><h2 class="coh-h" id="cohNowTitle">المطلوب منك الآن</h2><div id="cohTiles" class="coh-tiles"></div></section>'
      +'<section class="coh-quick" id="cohQuick"><div id="cohTwins"></div><div id="cohIg"></div></section>'
      +'<section class="card coh-sec" id="cohSummary"></section>'
      +'<button type="button" class="btn-secondary coh-full" data-coh="full" aria-expanded="false">قائمة العمل الكاملة</button>';
    const header=page.querySelector('.page-header');if(header)header.after(box);else page.prepend(box);
    return box;
  }
  function sheetEl(){
    let s=byId('cohSheet');if(s)return s;
    s=document.createElement('div');s.id='cohSheet';s.className='coh-sheet';s.hidden=true;
    s.innerHTML='<div class="coh-sheet-bg" data-coh="sclose"></div><div class="coh-sheet-box" role="dialog" aria-modal="true" aria-labelledby="cohSheetTitle"><header><h2 id="cohSheetTitle"></h2><button type="button" class="coh-sheet-x" data-coh="sclose" aria-label="إغلاق">✕</button></header><div id="cohSheetBody"></div></div>';
    document.body.append(s);return s;
  }
  const followupsCount=()=>typeof window.crmFollowupsCount==='function'?Number(window.crmFollowupsCount()||0):0;

  function tile(label,count,attrs,sub,urgent){
    return '<button type="button" class="coh-tile'+(urgent?' urgent':'')+'" '+attrs+'><b dir="ltr">'+num(count)+'</b><span>'+esc(label)+'</span><small>'+esc(sub)+'</small></button>';
  }
  function drawHello(total){
    const h=Number(new Intl.DateTimeFormat('en-GB',{hour:'numeric',hour12:false,timeZone:'Asia/Muscat'}).format(new Date()));
    const date=new Date().toLocaleDateString('ar-OM-u-nu-latn',{timeZone:'Asia/Muscat',weekday:'long',day:'numeric',month:'long'});
    const name=(byId('welcomeName')&&byId('welcomeName').textContent||'').trim();
    byId('cohHello').innerHTML='<strong>'+(h<12?'صباح الخير':'مساء الخير')+(name?' '+esc(name):'')+'</strong><span>'+esc(date)+'</span>'
      +'<p>'+(total?'عندك <b dir="ltr">'+num(total)+'</b> أشياء تحتاج تتابعها. ابدأ من الأعلى':'ما في شي يحتاج قرارك الحين')+'</p>';
  }
  function drawTiles(d,pending){
    const t=[];let todo=0;
    if(pending){todo+=pending;t.push(tile('ردود تنتظر موافقتك',pending,'data-coh="nav" data-nav="replies"','افتح واعتمد الرد',true));}
    const fu=followupsCount();
    if(fu){todo+=fu;t.push(tile('متابعة اليوم',fu,'data-coh="sheet" data-kind="followups"','أرسلها من واتساب',true));}
    if(paused.total){todo+=paused.total;t.push(tile('العقل موقوف عندهم',paused.total,'data-coh="sheet" data-kind="paused"','شوف السبب وكمّل',true));}
    if(d.owner_leads_new)t.push(tile('عروض ملاك جديدة',d.owner_leads_new,'data-coh="nav" data-nav="owner-leads"','يفتح صفحة العروض',false));
    if(Number(d.overdue_total))t.push(tile('زيارات يتابعها الذكاء الاصطناعي',d.overdue_total,'data-coh="sheet" data-kind="visits"','للاطلاع، العقل يسأل العميل',false));
    const pr=(d.problems||[]).length;
    if(pr)t.push(tile('مشاكل',pr,'data-coh="sheet" data-kind="problems"','تحتاج انتباه',false));
    byId('cohTiles').innerHTML=t.length?t.join(''):'<p class="coh-empty">ما في شي يحتاج قرارك الحين ✓</p>';
    drawHello(todo);
    const ig=byId('igDiscoveryAlert'),slot=byId('cohIg');if(ig&&slot&&ig.parentNode!==slot)slot.append(ig);
  }
  function visitRow(v){
    return '<li class="coh-row"><div class="coh-info"><strong>'+esc(v.property||'عقار')+'</strong><small>'+esc(v.client||'—')+' · <span class="coh-late">فات موعدها '+esc(v.viewing_date)+'</span></small>'+(v.notes?'<small class="coh-note">'+esc(v.notes)+'</small>':'')+'</div>'
      +'<button type="button" class="btn-secondary coh-go" data-cqv="result" data-id="'+esc(v.id)+'">سجّل النتيجة</button></li>';
  }
  function visitsHtml(){
    const o=(last&&last.data.overdue)||[];
    return '<p class="coh-since">الذكاء الاصطناعي يسأل العميل ويسجل النتيجة لحاله أول ما يرد. تقدر تسجلها أنت إذا تعرفها</p>'
      +'<button type="button" class="coh-add" data-cqv="new">+ زيارة ما كانت مسجّلة</button><ul class="coh-list">'+o.map(visitRow).join('')+'</ul>';
  }
  function problemsHtml(){
    const list=(last&&last.data.problems)||[];
    return list.length?'<ul class="coh-list">'+list.map(p=>'<li class="coh-row coh-problem"><div class="coh-info"><strong>'+esc(p.title)+(p.count?' <b dir="ltr">'+num(p.count)+'</b>':'')+'</strong>'+(p.detail?'<small>'+esc(p.detail)+'</small>':'')+'</div>'
      +(p.nav?'<button type="button" class="btn-secondary coh-go" data-coh="nav" data-nav="'+esc(p.nav)+'">فتح</button>':'')+'</li>').join('')+'</ul>':'<p class="coh-empty">ما في مشاكل الحين</p>';
  }
  function pausedHtml(){
    if(!paused.items.length)return '<p class="coh-empty">ما في أحد موقوف عنده العقل</p>';
    const counts={};paused.items.forEach(i=>{counts[i.kind]=(counts[i.kind]||0)+1;});
    const tabs=[['all','الكل',paused.items.length]].concat(Object.keys(KIND).filter(k=>counts[k]).map(k=>[k,KIND[k],counts[k]]))
      .map(([k,l,n])=>'<button type="button" class="cfu-tab'+(pausedFilter===k?' on':'')+'" data-coh="pfilter" data-v="'+k+'" aria-pressed="'+(pausedFilter===k)+'">'+esc(l)+' <b dir="ltr">'+n+'</b></button>').join('');
    const rows=paused.items.filter(i=>pausedFilter==='all'||i.kind===pausedFilter).map(i=>
      '<li class="coh-row coh-paused"><div class="coh-info"><strong>'+esc(i.name||'عميل')+' <small>'+esc(KIND[i.kind]||'')+'</small></strong>'
      +'<small class="coh-note">السبب: '+esc(i.reason)+'</small>'
      +(i.last_message?'<small class="coh-note">آخر رسالة منه: <span dir="auto">'+esc(i.last_message)+'</span></small>':'')
      +(i.summary?'<small class="coh-note">'+esc(i.summary)+'</small>':'')+'</div>'
      +'<div class="coh-paused-actions"><button type="button" class="btn-secondary coh-go" data-coh="popen" data-id="'+esc(i.conversation_id)+'">افتح المحادثة</button>'
      +'<button type="button" class="btn-primary coh-go" data-coh="presume" data-id="'+esc(i.conversation_id)+'">كمّل يا عقل</button></div></li>').join('');
    return '<div class="cfu-tabs coh-ptabs">'+tabs+'</div><ul class="coh-list">'+rows+'</ul>';
  }
  function drawSheet(){
    if(!sheetKind||sheetKind==='followups')return;
    const body=byId('cohSheetBody');if(!body)return;
    body.innerHTML=sheetKind==='paused'?pausedHtml():sheetKind==='visits'?visitsHtml():problemsHtml();
  }
  function openSheet(kind){
    const s=sheetEl();sheetKind=kind;byId('cohSheetTitle').textContent=TITLES[kind]||'';
    const body=byId('cohSheetBody');body.innerHTML='';
    if(kind==='followups'){
      const fu=byId('crmFollowups');if(!fu)return;
      body.append(fu);fu.hidden=false;
      const tg=fu.querySelector('.cfu-toggle[aria-expanded="false"]');if(tg)tg.click();
    }else drawSheet();
    s.hidden=false;document.body.classList.add('coh-lock');body.scrollTop=0;
  }
  function closeSheet(){
    const s=byId('cohSheet');if(!s||s.hidden)return;
    const fu=byId('crmFollowups'),home=byId('crmOwnerHome');
    if(fu&&fu.closest('#cohSheetBody')&&home)home.append(fu);
    s.hidden=true;sheetKind=null;document.body.classList.remove('coh-lock');
  }
  function drawTwins(groups){
    const open=(groups||[]).filter(g=>!g.dismissed&&g.properties.some(p=>Number(p.videos)<Number(g.videos)));
    byId('cohTwins').innerHTML=open.length?'<div class="card coh-sec"><div class="coh-subhead"><h3>قرار سريع: عقارات بنفس المواصفات <b dir="ltr">'+num(open.length)+'</b></h3></div><ul class="coh-list">'+open.map(g=>'<li class="coh-twin"><strong>'+g.properties.map(p=>esc(p.title)).join(' · ')+'</strong><small>'+g.properties.map(p=>num(p.videos)+' فيديو').join(' · ')+'</small><p>تربط كل الفيديوهات على الكل ؟ أداء الفيديو واستفساراته تنحسب لكل عقار</p><div class="coh-twin-actions"><button type="button" class="btn-primary" data-coh="twin-yes" data-key="'+esc(g.key)+'">نعم اربطهم</button><button type="button" class="btn-secondary" data-coh="twin-no" data-key="'+esc(g.key)+'">لا مختلفين</button></div></li>').join('')+'</ul></div>':'';
  }
  function drawSummary(d){
    const p=d.properties||{},r=d.report||{},label={barka:'بركاء',muscat:'مسقط'};
    const props=(p.branches||[]).map(b=>[(label[b.branch]||b.branch)+' متاح من 10',b.available]).concat([['أضيفت هذا الأسبوع',p.added_week],['توفرها ما تأكد من شهر',p.unchecked]]);
    const rep=[['عملاء جدد',r.new_clients],['ردود الوكيل',r.agent_replies],['زيارات تمت',r.visits_done],['حجوزات الشهر',r.bookings_month],['مبيعات الشهر',r.sales_month]];
    const cells=a=>a.map(([l,v])=>'<div class="coh-stat"><strong dir="ltr">'+num(v)+'</strong><small>'+esc(l)+'</small></div>').join('');
    const noVideo=p.no_video||[];
    byId('cohSummary').innerHTML='<h2 class="coh-h">ملخص</h2><h3 class="coh-h3">العقارات</h3><div class="coh-stats">'+cells(props)+'</div>'
      +'<h3 class="coh-h3">هذا الأسبوع <small>من '+esc(r.week_start||'')+'</small></h3><div class="coh-stats">'+cells(rep)+'</div>'
      +(noVideo.length?'<details class="coh-novideo"><summary>متاحة من أكثر من 7 أيام بدون فيديو <b dir="ltr">'+num(noVideo.length)+'</b></summary><p>'+noVideo.map(esc).join(' · ')+'</p></details>':'')
      +'<div class="coh-links2"><button type="button" class="coh-more" data-coh="nav" data-nav="properties">كل العقارات</button><button type="button" class="coh-more" data-coh="nav" data-nav="reports">التقارير الكاملة</button></div>';
  }
  async function load(){
    const page=byId('page-dash'),box=mount();if(!page||!box)return;
    if(!isOwner()||typeof supa==='undefined'){box.hidden=true;page.classList.remove('coh-on');return;}
    const seq=++sequence;
    const [home,pending,twinGroups,pz]=await Promise.all([supa.rpc('crm_owner_home'),typeof window.crmPendingReplies==='function'?window.crmPendingReplies().catch(()=>0):0,supa.rpc('crm_property_twins'),supa.rpc('crm_paused_chats')]);
    if(seq!==sequence)return;
    if(pz&&!pz.error&&pz.data)paused=pz.data;
    if(home.error||!home.data){if(!last){box.hidden=true;page.classList.remove('coh-on');}return;}
    last={data:home.data,pending:pending||0,twins:twinGroups&&!twinGroups.error?twinGroups.data:[]};
    render();
    box.hidden=false;page.classList.add('coh-on');
  }
  function render(){
    if(!last)return;
    const d=last.data;
    drawTiles(d,last.pending);drawTwins(last.twins);drawSummary(d);drawSheet();
  }
  document.addEventListener('crm-followups-updated',()=>{if(last)drawTiles(last.data,last.pending);});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeSheet();});
  document.addEventListener('click',e=>{
    const b=e.target.closest('[data-coh]');if(!b)return;
    const act=b.dataset.coh;
    if(act==='sheet')openSheet(b.dataset.kind);
    else if(act==='sclose')closeSheet();
    else if(act==='pfilter'){pausedFilter=b.dataset.v||'all';drawSheet();}
    else if(act==='full'){const page=byId('page-dash'),open=page.classList.toggle('coh-full-open');b.setAttribute('aria-expanded',String(open));b.textContent=open?'إخفاء قائمة العمل الكاملة':'قائمة العمل الكاملة';}
    else if(act==='popen'&&typeof navigate==='function'&&typeof openWhatsAppConversation==='function'){const id=b.dataset.id;closeSheet();navigate('whatsapp',null);setTimeout(()=>openWhatsAppConversation(id),300);}
    else if(act==='presume'&&typeof waInboxInvoke==='function'){
      b.disabled=true;const id=b.dataset.id;
      waInboxInvoke({action:'clear_handoff',conversation_id:id}).then(()=>{paused.items=paused.items.filter(i=>i.conversation_id!==id);paused.total=paused.items.length;if(last)drawTiles(last.data,last.pending);drawSheet();toast('رجّعتها للعقل','success');})
        .catch(()=>{b.disabled=false;toast('ما انحفظ. جرب مرة ثانية','error');});
    }
    else if(act==='twin-yes'||act==='twin-no'){
      b.disabled=true;
      const call=act==='twin-yes'?supa.rpc('crm_link_twin_group',{p_properties:b.dataset.key.split(',')}):supa.rpc('crm_dismiss_twin_group',{p_key:b.dataset.key});
      call.then(r=>{if(r.error)throw r.error;toast(act==='twin-yes'?'انربطت الفيديوهات على الكل':'تمام ما راح أسأل عنهم مرة ثانية','success');return window.crmOwnerHomeRefresh();}).catch(()=>{b.disabled=false;toast('ما انحفظ. جرب مرة ثانية','error');});
    }
    else if(act==='nav'&&typeof navigate==='function'){const nav=b.dataset.nav;closeSheet();navigate(nav,{replies:byId('navReplies'),'owner-leads':byId('navOwnerLeads')}[nav]||null);}
  });
  window.crmOwnerHomeRefresh=()=>load().catch(()=>{});
  const loadDash=window.loadDashboard;
  if(typeof loadDash==='function')window.loadDashboard=function(){const r=loadDash.apply(this,arguments);window.crmOwnerHomeRefresh();return r;};
})();
