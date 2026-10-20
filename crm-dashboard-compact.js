/* Owner dashboard presentation only. The existing scoped loader, record actions,
 * pagination and Reports performance RPC remain the single data sources. */
(function(){
  'use strict';
  const fields={followups:'followups',tasks:'tasks',visits:'visits',deals:'deals',hot:'hotRequests',contact:'contactQueue'};
  const labels={followups:'المتابعات المستحقة',tasks:'المهام العاجلة',visits:'الزيارات',deals:'الصفقات المفتوحة',hot:'الفرص الحارة',contact:'بانتظار التواصل'};
  const icons={followups:'refresh',tasks:'checklist',visits:'eye',deals:'deal',hot:'star',contact:'message'};
  const iconFallback={followups:'↻',tasks:'✓',visits:'⌂',deals:'◇',hot:'★',contact:'✉'};
  const byId=id=>document.getElementById(id);
  const isOwner=()=>typeof currentProfile!=='undefined'&&currentProfile?.role==='owner';
  let selected=null,scope='branches',session='',focusNext=null,observed=null;
  let detachedPerformance=null,performanceParent=null;
  const observer=new MutationObserver(()=>refresh());

  function identity(){
    return (typeof crmSessionGeneration==='undefined'?'':crmSessionGeneration)+':'+
      (typeof currentUser==='undefined'?'':currentUser?.id||'');
  }
  function managePerformance(owner){
    const panel=byId('opsPerformanceDetails');
    if(owner&&panel){
      // Remove the owner duplicate BEFORE loadDashboard can request performance.
      // Retain only empty markup so a later non-owner session is not changed.
      panel.open=false;
      const results=panel.querySelector('#opsDashboardPerformanceResults');
      if(results)results.replaceChildren();
      detachedPerformance=panel;performanceParent=panel.parentElement;panel.remove();
      if(performanceParent)performanceParent.hidden=true;
    }else if(!owner&&detachedPerformance&&performanceParent?.isConnected){
      performanceParent.append(detachedPerformance);performanceParent.hidden=false;
      detachedPerformance=null;performanceParent=null;
    }
    const tab=byId('repTeamTab');
    if(tab&&owner)tab.textContent='أداء الفريق';
  }
  function prepare(){
    const key=identity();
    if(key!==session){session=key;selected=null;scope='branches';focusNext=null;}
    const owner=isOwner(),page=byId('page-dash');
    if(page)page.classList.toggle('crm-compact-dashboard',owner);
    managePerformance(owner);
    return owner;
  }
  function refresh(){
    observer.disconnect();
    const host=byId('opsDailyWork');
    try{
      if(!prepare()||!host)return;
      const tabs=host.querySelector('.ops-category-tabs'),work=byId('opsScopeWork');
      if(!tabs||!work)return;
      const scopeTab=host.querySelector('.ops-scope-tabs [aria-pressed="true"]');
      const actualScope=scopeTab?.dataset.dashboardScope||'branches';
      if(actualScope!==scope){scope=actualScope;selected=null;}
      const data=window.dashboardWorkSnapshot;
      const ready=data?.scope===scope&&!work.querySelector(':scope > .ops-error,:scope > .ops-state');
      tabs.classList.add('ops-work-shortcuts');
      tabs.setAttribute('aria-label','أقسام قائمة العمل');
      for(const button of tabs.querySelectorAll('[data-dashboard-category]')){
        const category=button.dataset.dashboardCategory;
        if(!(category in fields)){button.hidden=true;continue;}
        const count=ready?data.totals?.[fields[category]]:null;
        const known=count!=null&&Number.isSafeInteger(Number(count))&&Number(count)>=0;
        button.type='button';button.classList.add('qa-btn','ops-work-shortcut');
        button.disabled=!ready;
        button.classList.toggle('active',selected===category);
        button.setAttribute('aria-pressed',String(selected===category));
        button.setAttribute('aria-expanded',String(selected===category));
        button.setAttribute('aria-controls','opsScopeWork');
        // Only constant labels and numeric counts are rendered here, never CRM text.
        button.innerHTML='<span class="ops-shortcut-icon" aria-hidden="true">'+(window.CRMDesign?window.CRMDesign.icon(icons[category]):iconFallback[category])+'</span><span class="ops-shortcut-label">'+labels[category]+'</span><b class="ops-shortcut-count" dir="ltr">'+(known?Number(count).toLocaleString('en-US'):'—')+'</b>';
      }
      const opened=Boolean(selected&&ready);
      work.toggleAttribute('data-compact-open',opened);
      // Preserve loading, retry/error and the private empty/add-investor state.
      // Only record lists are collapsed; no count/error is converted to zero.
      for(const section of work.querySelectorAll('.ops-work-section')){
        section.hidden=!opened||section.dataset.dashboardList!==selected;
      }
      const dayGrid=work.querySelector('.ops-day-grid');if(dayGrid)dayGrid.hidden=!opened;
      let close=host.querySelector('[data-compact-close]');
      if(!close){close=document.createElement('button');close.type='button';close.className='ops-text-action ops-compact-close';close.dataset.compactClose='';close.textContent='إغلاق التفاصيل';tabs.after(close);}
      close.hidden=!opened;
      let hint=host.querySelector('.ops-compact-hint');
      if(!hint){hint=document.createElement('p');hint.className='ops-compact-hint';hint.textContent='اختر قسمًا لعرض التفاصيل.';close.after(hint);}
      hint.hidden=opened||!ready||Boolean(work.querySelector('.ops-investment-empty'));
      const note=host.querySelector('.ops-work-head p');if(note)note.textContent='اختر ما تريد متابعته؛ التفاصيل تظهر عند الضغط فقط.';
      if(focusNext){const focus=host.querySelector('.ops-work-shortcuts [data-dashboard-category="'+focusNext+'"]');focusNext=null;if(focus&&!focus.disabled)focus.focus({preventScroll:true});}
    }finally{
      observed=host;
      if(host)observer.observe(host,{childList:true,subtree:true});
    }
  }
  // Capture intent, then let the established delegated click handler render its
  // scoped records. The observer applies presentation to that completed render.
  document.addEventListener('click',event=>{
    if(!isOwner())return;
    const host=byId('opsDailyWork');if(!host?.contains(event.target))return;
    if(event.target.closest('[data-compact-close]')){
      focusNext=selected;selected=null;refresh();return;
    }
    const button=event.target.closest('[data-dashboard-category],[data-dashboard-scope]');
    if(!button||button.disabled)return;
    const nextScope=button.dataset.dashboardScope||scope,category=button.dataset.dashboardCategory;
    if(category in fields){selected=nextScope===scope&&selected===category?null:category;focusNext=category;}
    else{selected=null;focusNext=null;}
    scope=nextScope;
  },true);
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&isOwner()&&selected&&byId('opsDailyWork')?.contains(event.target)){
      focusNext=selected;selected=null;refresh();event.preventDefault();
    }
  });
  const load=window.loadDashboard;
  if(typeof load==='function')window.loadDashboard=function(){prepare();const result=load.apply(this,arguments);refresh();return result;};
  const loadWork=window.crmLoadDashboardWork;
  if(typeof loadWork==='function')window.crmLoadDashboardWork=function(){prepare();const result=loadWork.apply(this,arguments);refresh();return result;};
  const reset=window.crmResetOperations;
  if(typeof reset==='function')window.crmResetOperations=function(){
    selected=null;focusNext=null;scope='branches';session='';
    // No previous owner's records remain on a hidden, newly logged-out dashboard.
    if(observed)observed.replaceChildren();
    window.dashboardWorkSnapshot=null;
    const results=detachedPerformance?.querySelector('#opsDashboardPerformanceResults');if(results)results.replaceChildren();
    return reset.apply(this,arguments);
  };
  refresh();
})();
