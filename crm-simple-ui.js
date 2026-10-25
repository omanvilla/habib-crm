/* Interface simplification, phase 1 (25 October 2026).
 * - Visits page renders as one row per visit, like the client/property grids.
 * - On phones, list pages show only the search box; the other filters open from one button.
 * - On phones, every .crm-grid table turns into compact cards labelled from its headers.
 * Data loading, permissions and actions are unchanged: rows call the existing
 * editViewing/deleteViewing/viewClient functions. */
(function(){
  'use strict';
  const esc=v=>typeof escapeHtml==='function'?escapeHtml(String(v==null?'':v)):String(v==null?'':v).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
  const byId=id=>document.getElementById(id);
  const plain=v=>String(v==null?'':v).replace(/<[^>]*>/g,'');

  // ---- Visits as rows -------------------------------------------------------
  const statusLabels={scheduled:'مجدولة',done:'تمت',no_show:'لم يحضر',cancelled:'ألغيت',postponed:'تأجلت'};
  const groupTitles=['متأخرة وتحتاج نتيجة','اليوم','قادمة','سجلات سابقة'];
  function visitDate(v){
    if(!v.viewing_date)return '—';
    const d=new Date(String(v.viewing_date).slice(0,10)+'T12:00:00');
    if(isNaN(d))return String(v.viewing_date);
    return d.toLocaleDateString('ar-OM-u-nu-latn',{weekday:'short',day:'numeric',month:'short'});
  }
  function visitRow(v,today){
    const overdue=v.status==='scheduled'&&(v.viewing_date||'')<today,id=esc(v.id);
    const phone=v.client&&v.client.phone?String(v.client.phone).replace(/[^0-9+]/g,'').replace(/^\+/,''):'';
    const branch=typeof crmRecordBranchLabel==='function'?crmRecordBranchLabel(v):'';
    return '<tr'+(overdue?' class="crm-grid-late"':'')+'>'
      +'<td class="'+(overdue?'crm-grid-overdue':'')+'"><bdi>'+esc(visitDate(v))+'</bdi>'+(v.viewing_time?' <small dir="ltr">'+esc(String(v.viewing_time).slice(0,5))+'</small>':'')+(overdue?' <span class="crm-grid-chip crm-grid-chip-late">متأخرة</span>':'')+'</td>'
      +'<td class="crm-grid-name">'+esc(v.property&&v.property.title||'عقار غير محدد')+(v.property&&v.property.area?' <small>'+esc(v.property.area)+'</small>':'')+'</td>'
      +'<td>'+(v.client&&v.client_id?'<button type="button" class="crm-grid-link" onclick="viewClient(\''+esc(v.client_id)+'\')">'+esc(v.client.name)+'</button>':esc(v.client&&v.client.name||'—'))+'</td>'
      +'<td>'+esc(branch||'—')+'</td>'
      +'<td><span class="viewing-status '+esc(v.status)+'">'+esc(statusLabels[v.status]||v.status||'—')+'</span></td>'
      +'<td class="crm-grid-actions"><button type="button" class="ops-action" onclick="editViewing(\''+id+'\')">'+(overdue?'تسجيل النتيجة':'تعديل')+'</button>'
      +(phone?'<a class="ops-action" href="https://api.whatsapp.com/send?phone='+esc(phone)+'" target="_blank" rel="noopener">واتساب</a>':'')
      +'<button type="button" class="ops-action crm-grid-danger" onclick="deleteViewing(\''+id+'\')">حذف</button></td></tr>';
  }
  if(typeof window.renderViewings==='function'){
    window.renderViewings=function(){
      const list=byId('viewingsList');if(!list)return;
      const today=typeof toLocalDateStr==='function'?toLocalDateStr(new Date()):new Date().toISOString().slice(0,10);
      const tab=typeof viewingTab==='undefined'?'all':viewingTab,all=typeof allViewings==='undefined'?[]:allViewings;
      let rows=all;
      if(tab==='upcoming')rows=all.filter(v=>v.status==='scheduled'&&(v.viewing_date||'')>=today);
      else if(tab==='overdue')rows=all.filter(v=>v.status==='scheduled'&&(v.viewing_date||'')<today);
      else if(tab==='today')rows=all.filter(v=>(v.viewing_date||'').substring(0,10)===today);
      else if(tab==='done')rows=all.filter(v=>v.status==='done');
      else if(tab==='no_show')rows=all.filter(v=>v.status==='no_show');
      if(!rows.length){list.innerHTML='<div class="empty"><div class="empty-ico">👁</div><div class="empty-title">لا توجد زيارات</div><div class="empty-desc">اضغط «زيارة جديدة» لجدولة زيارة لعميل.</div></div>';return;}
      const group=v=>v.status==='scheduled'?(v.viewing_date<today?0:v.viewing_date===today?1:2):3;
      rows=[...rows].sort((a,b)=>group(a)-group(b)||(group(a)===3?String(b.viewing_date||'').localeCompare(String(a.viewing_date||'')):String(a.viewing_date||'').localeCompare(String(b.viewing_date||'')))||String(a.viewing_time||'').localeCompare(String(b.viewing_time||'')));
      let body='',last=-1;
      for(const v of rows){
        const g=group(v);
        if(tab==='all'&&g!==last){body+='<tr class="crm-grid-group"><td colspan="6">'+groupTitles[g]+'</td></tr>';last=g;}
        body+=visitRow(v,today);
      }
      list.innerHTML='<div class="crm-grid-wrap"><table class="crm-grid" aria-label="قائمة الزيارات"><thead><tr><th>الموعد</th><th>العقار</th><th>العميل</th><th>الفرع</th><th>الحالة</th><th>إجراءات</th></tr></thead><tbody>'+body+'</tbody></table></div>';
    };
  }

  // ---- Phone layout: search first, other filters behind one button ---------
  const FILTERS=['uiClientFilters','opsPropertyFilters'];
  function activeCount(box){
    return [...box.querySelectorAll('select')].filter(s=>s.selectedIndex>0).length;
  }
  function syncToggle(box,button){
    const n=activeCount(box),open=box.classList.contains('crm-filters-open');
    button.textContent=open?'إخفاء الفلاتر':'الفلاتر'+(n?' ('+n+')':'');
    button.setAttribute('aria-expanded',String(open));
  }
  function enhanceFilters(){
    for(const id of FILTERS){
      const box=byId(id);if(!box||box.dataset.crmToggle)continue;
      box.dataset.crmToggle='1';box.classList.add('crm-filter-target');
      const button=document.createElement('button');button.type='button';button.className='crm-filter-toggle btn-secondary';
      box.after(button);syncToggle(box,button);
      button.addEventListener('click',()=>{box.classList.toggle('crm-filters-open');const panel=box.closest('.ws-filter-panel');if(panel)panel.classList.toggle('crm-filters-open',box.classList.contains('crm-filters-open'));syncToggle(box,button);});
      box.addEventListener('change',()=>syncToggle(box,button));
    }
  }

  // ---- Phone layout: label each grid cell from its column header ------------
  // Rows appended later ("show more") are labelled too: only unlabelled rows are touched.
  function labelGrids(root){
    for(const table of root.querySelectorAll('table.crm-grid')){
      const heads=[...table.querySelectorAll('thead th')].map(th=>th.textContent.trim());
      for(const tr of table.querySelectorAll('tbody tr:not([data-labelled])')){
        [...tr.children].forEach((td,i)=>{if(heads[i]&&td.colSpan===1)td.dataset.label=heads[i];});
        tr.dataset.labelled='1';
      }
    }
  }
  const LISTS=['clientsList','propertiesList','tasksList','viewingsList','ownersList','depositsList'];
  let pending=0;
  const observer=new MutationObserver(()=>{if(pending)return;pending=requestAnimationFrame(()=>{pending=0;for(const id of LISTS){const el=byId(id);if(el)labelGrids(el);}});});
  function watchLists(){
    for(const id of LISTS){const el=byId(id);if(el&&!el.dataset.crmWatched){el.dataset.crmWatched='1';observer.observe(el,{childList:true,subtree:true});labelGrids(el);}}
  }

  // ---- Phase 2: shared empty state -----------------------------------------
  function emptyState(icon,title,desc,button){
    return '<div class="empty crm-empty"><div class="empty-ico">'+icon+'</div><div class="empty-title">'+esc(title)+'</div><div class="empty-desc">'+esc(desc)+'</div>'
      +(button?'<button type="button" class="btn-primary crm-empty-action" onclick="'+button.action+'">'+esc(button.label)+'</button>':'')+'</div>';
  }
  window.crmEmptyState=emptyState;
  const canEditNow=()=>typeof canEdit==='function'&&canEdit();

  // ---- Phase 2: sidebar groups ----------------------------------------------
  const NAV_GROUPS=[
    ['اليوم',['dash','daily','whatsapp','calendar','viewings']],
    ['العملاء والعقارات',['clients','properties','owners','instagram']],
    ['المبيعات',['deals','deposits']],
    ['التقارير',['reports','expenses','activityLog']],
    ['الإدارة',['team','backup','settings','ai']]
  ];
  const navKey=link=>((link.getAttribute('onclick')||'').match(/navigate\('([^']+)'/)||[])[1]||'';
  function groupNav(){
    const area=document.querySelector('#sidebar .nav-area');if(!area)return;
    let groups=area.querySelectorAll('.crm-nav-group');
    if(!groups.length){
      area.insertAdjacentHTML('afterbegin',NAV_GROUPS.map(([label],i)=>'<div class="nav-group crm-nav-group" data-crm-group="'+i+'"><div class="nav-label">'+label+'</div></div>').join(''));
      groups=area.querySelectorAll('.crm-nav-group');
    }
    for(const link of area.querySelectorAll('.nav-link')){
      const key=navKey(link),index=NAV_GROUPS.findIndex(g=>g[1].includes(key));
      const target=groups[index<0?NAV_GROUPS.length-1:index];
      if(link.parentElement!==target){
        const order=NAV_GROUPS[index<0?NAV_GROUPS.length-1:index][1];
        const next=[...target.querySelectorAll('.nav-link')].find(l=>order.indexOf(navKey(l))>order.indexOf(key));
        target.insertBefore(link,next||null);
      }
      const text=(link.querySelector('.nav-text')||link).textContent.trim();
      if(text&&link.title!==text)link.title=text;
    }
    // The backup page is owner-only; staff no longer see a link that opens a locked page.
    const backup=byId('navBackup');if(backup&&typeof isOwner==='function'&&currentProfileReady())backup.style.display=isOwner()?'':'none';
    for(const old of area.querySelectorAll('.nav-group:not(.crm-nav-group)'))if(!old.querySelector('.nav-link'))old.remove();
    for(const g of groups)g.hidden=![...g.querySelectorAll('.nav-link')].some(l=>l.style.display!=='none');
  }
  const currentProfileReady=()=>typeof currentProfile!=='undefined'&&!!currentProfile;

  // ---- Phase 2: calendar opens on an agenda list ---------------------------
  if(typeof window.renderCalList==='function'){
    try{if(typeof calView!=='undefined'&&calView==='month'){calView='list';document.querySelectorAll('.cal-vbtn').forEach(b=>b.classList.toggle('active',b.id==='calVList'));}}catch(e){}
    const dayKey=d=>typeof toLocalDateStr==='function'?toLocalDateStr(d):d.toISOString().slice(0,10);
    window.renderCalList=function(){
      const title=byId('calTitle'),content=byId('calContent');if(!content)return;
      if(title)title.textContent='المواعيد والمهام';
      const today=new Date();today.setHours(0,0,0,0);
      const t0=dayKey(today),t1=dayKey(new Date(today.getTime()+864e5)),t7=dayKey(new Date(today.getTime()+7*864e5));
      const items=(typeof allEvents==='undefined'?[]:allEvents).filter(e=>e.date&&!e.done);
      const buckets=[['متأخرة',[]],['اليوم',[]],['غدًا',[]],['خلال 7 أيام',[]],['لاحقًا',[]]];
      for(const e of items){
        const d=String(e.date).slice(0,10);
        const i=d<t0?(e.type==='task'?0:-1):d===t0?1:d===t1?2:d<=t7?3:4;
        if(i>=0)buckets[i][1].push(e);
      }
      buckets.forEach(b=>b[1].sort((a,c)=>String(a.date).localeCompare(String(c.date))||String(a.time||'').localeCompare(String(c.time||''))));
      if(!buckets.some(b=>b[1].length)){content.innerHTML=emptyState('📅','لا توجد مواعيد قادمة','المهام والزيارات والمواعيد تظهر هنا حسب اليوم.',canEditNow()?{label:'+ موعد جديد',action:"openModal('mEvent')"}:null);return;}
      let h='<div class="crm-agenda">';
      for(const [label,list] of buckets){
        if(!list.length)continue;
        h+='<section class="crm-agenda-group'+(label==='متأخرة'?' late':'')+'"><h4>'+label+' <span>'+list.length+'</span></h4><ul>';
        for(const e of list.slice(0,label==='لاحقًا'?20:100)){
          const d=new Date(String(e.date).slice(0,10)+'T12:00:00');
          const when=d.toLocaleDateString('ar-OM-u-nu-latn',{weekday:'short',day:'numeric',month:'short'})+(e.time?' · '+String(e.time).slice(0,5):'');
          const kind=e.type==='task'?'مهمة':e.evtType==='visit'?'زيارة':e.evtType==='meeting'?'اجتماع':e.evtType==='call'?'اتصال':'موعد';
          const open=e.type==='task'&&e.raw&&e.raw.id?"openTaskDetails('"+esc(e.raw.id)+"')":"showDayDetails('"+esc(String(e.date).slice(0,10))+"')";
          h+='<li><button type="button" class="crm-agenda-item" onclick="'+open+'"><span class="crm-agenda-when"><bdi>'+esc(when)+'</bdi></span><span class="crm-agenda-kind k-'+(e.type==='task'?'task':'event')+'">'+kind+'</span><span class="crm-agenda-title">'+esc(e.title)+'</span>'
            +(e.client&&e.client.name?'<span class="crm-agenda-client">'+esc(e.client.name)+'</span>':'')+'</button></li>';
        }
        h+='</ul>'+(label==='لاحقًا'&&list.length>20?'<p class="crm-agenda-more">و'+(list.length-20)+' أخرى — استخدم عرض الشهر</p>':'')+'</section>';
      }
      content.innerHTML=h+'</div>';
    };
  }
  const calNavState=()=>{const page=byId('page-calendar');if(page)page.classList.toggle('crm-cal-list',typeof calView!=='undefined'&&calView==='list');};
  if(typeof window.setCalView==='function'){const set=window.setCalView;window.setCalView=function(){const r=set.apply(this,arguments);calNavState();return r;};}

  // ---- Phase 2: owners as rows ---------------------------------------------
  const ownerTypes={owner:'مالك',broker:'وسيط',agency:'مكتب',developer:'مطوّر'};
  if(typeof window.renderOwners==='function'){
    window.renderOwners=async function(){
      const list=byId('ownersList');if(!list)return;
      const all=typeof allOwners==='undefined'?[]:allOwners,filter=typeof ownerTypeFilter==='undefined'?'all':ownerTypeFilter;
      const q=(byId('ownerSearchQ')?byId('ownerSearchQ').value:'').trim().toLowerCase();
      let rows=all;
      if(filter&&filter!=='all')rows=rows.filter(o=>(o.owner_type||'owner')===filter);
      if(q)rows=rows.filter(o=>(o.name||'').toLowerCase().includes(q)||(o.phone||'').includes(q));
      const set=(id,n)=>{const el=byId(id);if(el)el.textContent=n;};
      set('cntOwAll',all.length);set('cntOwOwner',all.filter(o=>(o.owner_type||'owner')==='owner').length);set('cntOwBroker',all.filter(o=>o.owner_type==='broker').length);
      set('cntOwAgency',all.filter(o=>o.owner_type==='agency').length);set('cntOwDev',all.filter(o=>o.owner_type==='developer').length);
      if(!rows.length){list.innerHTML=q||filter!=='all'?emptyState('🔍','لا توجد نتائج','جرّب كلمة بحث أخرى أو اختر «الكل».'):emptyState('🏛','لا يوجد ملاك بعد','المالك هو صاحب العقار أو الوسيط الذي جاء منه. أضفه مرة واحدة ثم اربطه بعقاراته.',canEditNow()?{label:'+ مالك جديد',action:"openModal('mOwner')"}:null);return;}
      const counts={};
      try{const r=await crmDataFrom('properties').select('owner_id, status').eq('archived',false);(r.data||[]).forEach(p=>{const c=counts[p.owner_id]||(counts[p.owner_id]={total:0,available:0,sold:0});c.total++;if(p.status==='available')c.available++;if(p.status==='sold')c.sold++;});}catch(e){}
      // formatPhoneDisplay returns markup; keep only its text and escape it below.
      const phoneText=p=>typeof formatPhoneDisplay==='function'?plain(formatPhoneDisplay(p)):p;
      list.innerHTML='<div class="crm-grid-wrap"><table class="crm-grid" aria-label="قائمة الملاك"><thead><tr><th>الاسم</th><th>النوع</th><th>الهاتف</th><th>العقارات</th><th>متاح</th><th>مباع</th><th>إجراءات</th></tr></thead><tbody>'
        +rows.map(o=>{const s=counts[o.id]||{total:0,available:0,sold:0},id=esc(o.id),wa=o.phone?String(o.phone).replace(/[^0-9+]/g,'').replace(/^\+/,''):'';
          return '<tr><td class="crm-grid-name">'+(canEditNow()?'<button type="button" class="ops-title" onclick="editOwner(\''+id+'\')">'+esc(o.name||'—')+'</button>':esc(o.name||'—'))+(o.exclusive?'<span class="crm-grid-chip">حصري</span>':'')+'</td>'
            +'<td>'+esc(ownerTypes[o.owner_type||'owner']||o.owner_type)+'</td><td><bdi dir="ltr">'+esc(o.phone?phoneText(o.phone):'—')+'</bdi></td>'
            +'<td class="crm-grid-num">'+s.total+'</td><td class="crm-grid-num">'+s.available+'</td><td class="crm-grid-num">'+s.sold+'</td>'
            +'<td class="crm-grid-actions">'+(canEditNow()?'<button type="button" class="ops-action" onclick="editOwner(\''+id+'\')">تعديل</button>':'')
            +(wa?'<a class="ops-action" href="https://api.whatsapp.com/send?phone='+esc(wa)+'" target="_blank" rel="noopener">واتساب</a>':'')
            +(typeof canDelete==='function'&&canDelete()?'<button type="button" class="ops-action crm-grid-danger" data-crm-action="archive-owner" data-record-id="'+id+'">أرشفة</button>':'')+'</td></tr>';}).join('')
        +'</tbody></table></div>';
    };
  }

  // ---- Phase 2: deposits as rows -------------------------------------------
  if(typeof window.renderDeposits==='function'){
    const methods={cash:'كاش',transfer:'تحويل',cheque:'شيك'},receivers={company:'الشركة',owner:'المالك'};
    window.renderDeposits=function(){
      const list=byId('depositsList');if(!list)return;
      const all=typeof allDeposits==='undefined'?[]:allDeposits,tab=typeof depositTab==='undefined'?'all':depositTab;
      let rows=all;
      if(tab==='applied')rows=all.filter(d=>d.status==='applied');
      else if(tab==='active')rows=all.filter(d=>{const s=getDepositStatus(d);return s==='active'||s==='ending_soon';});
      else if(tab!=='all')rows=all.filter(d=>getDepositStatus(d)===tab);
      if(!rows.length){list.innerHTML=tab!=='all'&&all.length?emptyState('💰','لا توجد عرابين في هذا التصنيف','اختر «الكل» لعرض جميع العرابين.'):emptyState('💰','لا توجد عرابين بعد','العربون يُسجَّل عند استلام دفعة من العميل لحجز عقار، ويُربط بالصفقة.',canEditNow()?{label:'+ عربون جديد',action:"openModal('mDeposit')"}:null);return;}
      const today=new Date();today.setHours(0,0,0,0);
      const statusCell=(d,s)=>{
        if(s==='applied')return '<span class="ops-status ops-available">طُبّق في الصفقة</span>';
        if(s==='refunded')return '<span class="ops-status">مُسترد</span>';
        if(s==='forfeited')return '<span class="ops-status">مُصادَر</span>';
        if(!d.expiry_date)return '<span class="ops-status">نشط</span>';
        const left=Math.ceil((new Date(d.expiry_date)-today)/864e5);
        return left<0?'<span class="crm-grid-overdue">انتهى منذ '+(-left)+' يوم</span>':left<=7?'<span class="crm-grid-soon">باقي '+left+' أيام</span>':'<span class="ops-status ops-available">باقي '+left+' يوم</span>';
      };
      // fmtDate and fmtMoney return markup; keep their text only, escaped below.
      const date=v=>v&&typeof fmtDate==='function'?plain(fmtDate(v)):(v||'—');
      list.innerHTML='<div class="crm-grid-wrap"><table class="crm-grid" aria-label="قائمة العرابين"><thead><tr><th>المبلغ</th><th>العميل</th><th>العقار</th><th>تاريخ الدفع</th><th>انتهاء المهلة</th><th>الحالة</th><th>الدفع</th><th>إجراءات</th></tr></thead><tbody>'
        +rows.map(d=>{const s=getDepositStatus(d),id=esc(d.id);
          return '<tr><td class="crm-grid-name crm-grid-num">'+esc(typeof fmtMoney==='function'?plain(fmtMoney(d.amount)):d.amount)+'</td>'
            +'<td>'+esc(d.deal&&d.deal.client?d.deal.client.name:'—')+'</td><td class="crm-grid-wide">'+esc(d.deal&&d.deal.property?d.deal.property.title:'—')+'</td>'
            +'<td>'+esc(date(d.payment_date))+'</td><td>'+esc(d.expiry_date?date(d.expiry_date):'—')+'</td><td>'+statusCell(d,s)+'</td>'
            +'<td>'+esc([methods[d.payment_method],receivers[d.received_by]].filter(Boolean).join(' · ')||'—')+'</td>'
            +'<td class="crm-grid-actions"><button type="button" class="ops-action" onclick="editDeposit(\''+id+'\')">تعديل</button><button type="button" class="ops-action crm-grid-danger" onclick="deleteDeposit(\''+id+'\')">حذف</button></td></tr>';}).join('')
        +'</tbody></table></div>';
    };
  }

  // ---- Phase 3: quick guide for new staff ----------------------------------
  // Shown once per account on each browser; the "؟" button in the top bar reopens it.
  const GUIDE=[
    {nav:'dash',title:'ابدأ يومك من «لوحة العمل»',text:'في الأعلى المحادثات التي تحتاج تدخلك، وتحتها أعمال اليوم: المتابعات والزيارات والمهام وأرقام فرعك.'},
    {nav:'whatsapp',title:'ردّ على العملاء من «واتساب»',text:'كل رسائل العملاء في مكان واحد. افتح المحادثة وردّ مباشرة، ويمكنك إرسال الصور والفيديو والرسائل الصوتية.'},
    {nav:'daily',title:'أنجز «المهام» و«الزيارات»',text:'كل صف مهمة مطلوبة منك. اضغط المربع عند الإنجاز. وبعد كل زيارة افتح «الزيارات» واضغط «تسجيل النتيجة».'},
    {nav:'clients',title:'أضف عميلًا أو عقارًا',text:'من زر «عميل جديد» أو «عقار جديد» في لوحة العمل. ابحث برقم الهاتف أولًا في «العملاء» حتى لا يتكرر العميل.'}
  ];
  const guideKey=()=>'crmGuideSeen:'+(typeof currentUser!=='undefined'&&currentUser?currentUser.id:'');
  let guideDialog=null,guideStep=0,guideOffered=false;
  function focusNav(key){
    document.querySelectorAll('#sidebar .crm-guide-focus').forEach(n=>n.classList.remove('crm-guide-focus'));
    const link=[...document.querySelectorAll('#sidebar .nav-link')].find(l=>navKey(l)===key);if(link)link.classList.add('crm-guide-focus');
  }
  function drawGuide(){
    const s=GUIDE[guideStep],last=guideStep===GUIDE.length-1;
    guideDialog.innerHTML='<div class="crm-guide-step">'+(guideStep+1)+' من '+GUIDE.length+'</div><h3>'+esc(s.title)+'</h3><p>'+esc(s.text)+'</p>'
      +'<div class="crm-guide-dots">'+GUIDE.map((_,i)=>'<span'+(i===guideStep?' class="on"':'')+'></span>').join('')+'</div>'
      +'<div class="crm-guide-actions"><button type="button" class="btn-secondary" data-guide="close">إغلاق</button>'
      +(guideStep?'<button type="button" class="btn-secondary" data-guide="prev">السابق</button>':'')
      +'<button type="button" class="btn-primary" data-guide="'+(last?'done':'next')+'">'+(last?'ابدأ العمل':'التالي')+'</button></div>';
    focusNav(s.nav);
  }
  function closeGuide(){
    try{localStorage.setItem(guideKey(),'1');}catch(e){}
    document.querySelectorAll('#sidebar .crm-guide-focus').forEach(n=>n.classList.remove('crm-guide-focus'));
    if(guideDialog&&guideDialog.open)guideDialog.close();
  }
  function openGuide(){
    if(!guideDialog){
      guideDialog=document.createElement('dialog');guideDialog.className='crm-guide';guideDialog.setAttribute('dir','rtl');guideDialog.setAttribute('aria-label','دليل سريع');
      document.body.append(guideDialog);
      guideDialog.addEventListener('click',e=>{const b=e.target.closest('[data-guide]');if(!b)return;const a=b.dataset.guide;
        if(a==='next'){guideStep++;drawGuide();}else if(a==='prev'){guideStep--;drawGuide();}else closeGuide();});
      guideDialog.addEventListener('close',()=>{if(guideDialog.dataset.closing)return;guideDialog.dataset.closing='1';closeGuide();delete guideDialog.dataset.closing;});
    }
    guideStep=0;drawGuide();if(!guideDialog.open)guideDialog.showModal();
  }
  window.crmOpenGuide=openGuide;
  function guideButton(){
    const bell=document.querySelector('.topbar .bell-wrapper');
    if(!bell||document.querySelector('.crm-guide-btn'))return;
    bell.parentElement.insertAdjacentHTML('beforebegin','<button type="button" class="crm-guide-btn" onclick="crmOpenGuide()" title="دليل سريع" aria-label="دليل سريع">؟</button>');
  }
  function maybeGuide(){
    let seen=true;try{seen=localStorage.getItem(guideKey())==='1';}catch(e){}
    if(!seen&&!guideOffered&&typeof currentUser!=='undefined'&&currentUser&&!document.querySelector('dialog[open]')){guideOffered=true;openGuide();}
  }

  function refresh(){enhanceFilters();watchLists();groupNav();calNavState();guideButton();}
  const loadApp=window.loadDashboard;
  if(typeof loadApp==='function')window.loadDashboard=function(){const r=loadApp.apply(this,arguments);setTimeout(groupNav,0);setTimeout(maybeGuide,1500);return r;};
  const nav=window.navigate;
  if(typeof nav==='function')window.navigate=function(){const result=nav.apply(this,arguments);setTimeout(refresh,0);return result;};
  refresh();setTimeout(refresh,1500);
})();
