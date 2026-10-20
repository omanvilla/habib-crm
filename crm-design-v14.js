/* Presentation only: existing scoped data, filters and event handlers remain authoritative. */
(function () {
  'use strict';
  const paths = {
    home:'M3 10 12 3l9 7v11h-6v-7H9v7H3z',
    users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9',
    building:'M4 21V5l8-3 8 3v16M8 9h2m4 0h2M8 13h2m4 0h2M9 21v-4h6v4',
    message:'M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z',
    calendar:'M3 9h18M7 3v4m10-4v4M5 5h14a2 2 0 0 1 2 2v14H3V7a2 2 0 0 1 2-2',
    clock:'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
    check:'m5 12 4 4L19 6',
    checklist:'M9 6h12M9 12h12M9 18h12M3 6h.01M3 12h.01M3 18h.01',
    deal:'M8 12l3 3a2 2 0 0 0 3 0l5-5M2 7l4-4 5 5m11-1-4-4-5 5M6 17l3 3m9-3-3 3',
    chart:'M4 20V10m6 10V4m6 16v-7m6 7H2',
    wallet:'M3 7a2 2 0 0 1 2-2h14v14H5a2 2 0 0 1-2-2zm13 4h5v4h-5a2 2 0 0 1 0-4',
    owner:'M4 21v-8h16v8M7 13V8l5-4 5 4v5M9 21v-4h6v4',
    activity:'M3 12h4l2-7 4 14 2-7h6',
    settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2',
    shield:'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10m-3-10 2 2 4-4',
    search:'m21 21-4.3-4.3M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
    plus:'M12 5v14M5 12h14',
    edit:'m16 3 5 5L8 21H3v-5zM13 6l5 5',
    archive:'M3 3h18v5H3zM5 8v13h14V8M10 12h4',
    refresh:'M20 7V3l-4 4M4 17v4l4-4M20 7a8 8 0 0 0-14-2M4 17a8 8 0 0 0 14 2',
    download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
    logout:'M10 17l5-5-5-5m5 5H3M21 19V5a2 2 0 0 0-2-2h-5',
    bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
    more:'M5 12h.01M12 12h.01M19 12h.01',
    trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
    close:'m6 6 12 12M6 18 18 6',
    menu:'M4 6h16M4 12h16M4 18h16',
    marketing:'M3 10v4h4l12 5V5L7 10zm4 4 2 7h4l-3-6M22 9v6',
    eye:'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12m10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
    star:'m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z',
    info:'M12 11v6m0-10h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
    link:'m10 13 4-4m-5 7-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 0 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0',
    arrow:'M19 12H5m7-7-7 7 7 7'
  };
  const icon = name => '<svg class="ui-symbol" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="'+(paths[name]||paths.info)+'"/></svg>';
  window.CRMDesign = Object.freeze({icon});
  const el=id=>document.getElementById(id);
  const navIcons={dash:'home',daily:'checklist',clients:'users',properties:'building',whatsapp:'message',deals:'deal',calendar:'calendar',viewings:'eye',deposits:'wallet',reports:'chart',owners:'owner',expenses:'wallet',activityLog:'activity',team:'users',backup:'shield',settings:'settings',instagram:'chart'};
  const emojiIcon={'📊':'chart','📈':'chart','👥':'users','👤':'users','🏠':'building','🏢':'building','🏛':'owner','🏗':'building','💬':'message','📅':'calendar','📆':'calendar','⏰':'clock','⏳':'clock','🤝':'deal','👁':'eye','💰':'wallet','💸':'wallet','📜':'activity','🔍':'search','🔎':'search','➕':'plus','✏':'edit','📤':'download','📦':'archive','📋':'checklist','🔄':'refresh','🛡':'shield','⚙':'settings','🔔':'bell','🚪':'logout','✅':'check','❌':'close','✖':'close','💡':'info','⚠':'info','💼':'owner','🛒':'users','🔑':'owner','🟢':'check','🔴':'info','🔥':'star','📥':'download','📩':'message','🗑':'trash','⚪':'info','🟡':'info','📞':'message','📧':'message','📝':'edit','⭐':'star','♻':'refresh','🔐':'shield','✨':'plus','🎯':'chart'};
  const leading=/^\s*([\p{Extended_Pictographic}\u2714\u2716\u2715\u2713\u2795])\uFE0F?\s*/u;
  const adapters=[];let scheduled=false;
  function optionLabel(b){const copy=b.cloneNode(true),count=copy.querySelector('.count');const suffix=count?' · '+count.textContent.trim():'';count?.remove();copy.querySelectorAll('svg').forEach(n=>n.remove());return staticLabel(copy.textContent)+suffix;}
  function staticLabel(text){return String(text||'').replace(leading,'').replace(/\uFE0F/g,'').trim();}
  function iconizeControl(node){
    // Never traverse customer names, notes, messages, values or editable content.
    if(node.closest('#page-deals,#mDeal,#mDealWorkflow,.wa-bubble,.wa-chat-title,.wa-conv-preview,[contenteditable],.ops-title'))return;
    const text=[...node.childNodes].find(n=>n.nodeType===3&&n.nodeValue.trim());if(!text)return;
    const match=text.nodeValue.match(leading);if(!match||!emojiIcon[match[1]])return;
    const label=staticLabel(text.nodeValue);
    if(!label&&!node.textContent.replace(leading,'').trim()&&!node.getAttribute('aria-label')&&!node.title)return;
    text.nodeValue=text.nodeValue.replace(leading,'');
    if(!node.querySelector('.ui-symbol'))node.insertAdjacentHTML('afterbegin',icon(emojiIcon[match[1]]));
    if(!label)node.setAttribute('aria-label',node.getAttribute('aria-label')||node.title);
  }
  function attachSelect({id,label,mount,sources,buttons,key}){
    if(el(id)||!mount)return;
    const box=document.createElement('label');box.className='ui-select-field';box.innerHTML='<span>'+label+'</span>';
    const select=document.createElement('select');select.id=id;select.className='fs';box.append(select);mount.append(box);
    const state={select,box,sources,buttons,key,signature:''};adapters.push(state);
    select.addEventListener('change',()=>{
      const b=state.current?.find(x=>x.value===select.value)?.node;
      if(b&&!b.disabled&&b.isConnected&&b.style.display!=='none')b.click();
      syncSelect(state);
    });
  }
  function syncSelect(a){
    if(!a.select.isConnected)return;
    const sources=a.sources().filter(Boolean);sources.forEach(s=>s.classList.add('ui-filter-source'));
    const buttons=a.buttons().filter(b=>b.isConnected&&!b.hidden&&b.style.display!=='none');
    a.box.hidden=buttons.length===0;
    const options=buttons.map(b=>({node:b,value:a.key(b),label:optionLabel(b),active:b.classList.contains('active'),disabled:b.disabled})).filter(x=>x.value!==undefined);
    a.current=options;const sig=JSON.stringify(options.map(o=>[o.value,o.label,o.active,o.disabled]));
    if(sig===a.signature)return;a.signature=sig;
    a.select.replaceChildren(...options.map(o=>{const n=document.createElement('option');n.value=o.value;n.textContent=o.label;n.disabled=o.disabled;n.selected=o.active;return n;}));
    const active=options.find(o=>o.active);if(active)a.select.value=active.value;
  }
  const methodKey=b=>(b.getAttribute('onclick')||'').match(/\(\s*['"]([^'"]+)/)?.[1];
  function clientFilters(){
    const panel=el('wsClientFilters');if(!panel||el('uiClientFilters'))return;
    const toolbar=document.createElement('div');toolbar.id='uiClientFilters';toolbar.className='ui-filter-grid';panel.prepend(toolbar);
    const search=document.createElement('label');search.className='ui-select-field ui-search-field';search.innerHTML='<span>البحث عن عميل</span>';const input=el('csText');if(input){input.placeholder='الاسم أو رقم الهاتف';search.append(input);toolbar.append(search);}
    attachSelect({id:'uiClientType',label:'تصنيف العميل',mount:toolbar,sources:()=>[el('clientRoleTabs'),panel.querySelector('.ws-flow-filter')],buttons:()=>[...document.querySelectorAll('#page-clients [onclick^="filterClientRole("]')],key:methodKey});
    attachSelect({id:'uiClientBranch',label:'الفرع',mount:toolbar,sources:()=>[el('opsClientBranches')],buttons:()=>[...document.querySelectorAll('#opsClientBranches [data-client-branch]')],key:b=>b.dataset.clientBranch});
    attachSelect({id:'uiClientWork',label:'المتابعة',mount:toolbar,sources:()=>[el('opsClientsWork')],buttons:()=>[...document.querySelectorAll('#opsClientsWork [data-work-filter]')],key:b=>b.dataset.workFilter});
    const archive=document.querySelector('#page-clients>.archive-toggle');
    attachSelect({id:'uiClientArchive',label:'السجلات',mount:toolbar,sources:()=>[archive],buttons:()=>archive?[...archive.querySelectorAll('button')]:[],key:b=>(b.getAttribute('onclick')||'').includes('(true')?'archived':'active'});
    const advanced=document.createElement('details');advanced.className='ui-advanced';advanced.innerHTML='<summary>بحث متقدم حسب الطلب</summary><div class="ui-advanced-fields"></div>';
    const area=advanced.lastElementChild;
    [['csType','نوع العقار المطلوب'],['csArea','المنطقة أو الولاية'],['csBudget','الميزانية · ر.ع']].forEach(([id,label])=>{const field=el(id);if(!field)return;const wrap=document.createElement('label');wrap.className='ui-select-field';const title=document.createElement('span');title.textContent=label;wrap.append(title,field);area.append(wrap);});
    const clear=panel.querySelector('[onclick="clearClientSmartSearch()"]');if(clear){clear.textContent='مسح البحث';area.append(clear);}
    const count=el('csResultCount');if(count)area.append(count);panel.append(advanced);
    panel.querySelectorAll(':scope > .ws-filter-label,:scope > .ws-search-card,:scope > .ws-secondary-filters').forEach(n=>n.classList.add('ui-filter-source'));
  }
  function simpleFilters(){
    const configs=[['daily','.card-body','uiTaskStatus','حالة المهمة','filterTasks'],['viewings','.viewings-tabs','uiVisitStatus','حالة الزيارة','setViewingTab'],['deposits','.viewings-tabs','uiDepositStatus','حالة العربون','setDepositTab'],['owners','.archive-toggle','uiOwnerType','نوع المالك','setOwnerType']];
    configs.forEach(([page,selector,id,label,method])=>{
      const source=document.querySelector('#page-'+page+' '+selector);if(!source||el(id)||!source.querySelector('[onclick^="'+method+'("]'))return;
      const bar=document.createElement('div');bar.className='ui-simple-filter';source.parentElement.insertBefore(bar,source);
      attachSelect({id,label,mount:bar,sources:()=>[source],buttons:()=>[...source.querySelectorAll('button')],key:methodKey});
    });
    const prop=document.querySelector('#page-properties>.archive-toggle'),mount=el('opsPropertyFilters');
    if(prop&&mount)attachSelect({id:'uiPropertyArchive',label:'السجلات',mount,sources:()=>[prop],buttons:()=>[...prop.querySelectorAll('button')],key:methodKey});
  }
  function actionMenus(){
    document.querySelectorAll('#clientsList tr .ws-actions,#propertiesList tr .ws-actions,#cdActions').forEach(actions=>{
      if(actions.querySelector(':scope > .ui-more'))return;
      const secondary=[...actions.children].filter(b=>b.matches('button')&&!(actions.id==='cdActions'&&/openClientWhatsAppHistory|markViewingClientContacted|openNewRequestForClient/.test(b.getAttribute('onclick')||''))&&!['client','property'].includes(b.dataset.workAction)&&b.dataset.workspaceAction!=='property-marketing');
      if(!secondary.length)return;
      const details=document.createElement('details');details.className='ui-more';
      const summary=document.createElement('summary');summary.setAttribute('aria-label','إجراءات إضافية');summary.title='إجراءات إضافية';summary.innerHTML=icon('more')+'<span>المزيد</span>';
      const panel=document.createElement('div');panel.className='ui-more-panel';panel.append(...secondary);details.append(summary,panel);actions.append(details);
    });
  }
  function chrome(){
    const activePage=document.querySelector('.page.active')?.id.replace('page-','');
    const activeRoute=({propertyDetail:'properties',clientDetail:'clients'})[activePage]||activePage;
    document.querySelectorAll('.nav-link').forEach(node=>{
      const page=methodKey(node),name=navIcons[page]||'home',host=node.querySelector('.nav-icon');
      if(host&&!host.querySelector('.ui-symbol'))host.innerHTML=icon(name);
      node.setAttribute('role','button');node.tabIndex=0;node.setAttribute('aria-label',node.querySelector('.nav-text')?.textContent.trim()||page||'القائمة');
      node.classList.toggle('active',page===activeRoute);
      if(node.classList.contains('active'))node.setAttribute('aria-current','page');else node.removeAttribute('aria-current');
    });
    document.querySelectorAll('.mobile-nav-btn').forEach(node=>{const route=node.dataset.page,host=node.querySelector('.ico');if(host&&!host.querySelector('svg'))host.innerHTML=icon(route?navIcons[route]:'plus');if(route){node.classList.toggle('active',route===activeRoute);if(route===activeRoute)node.setAttribute('aria-current','page');else node.removeAttribute('aria-current');}});
    // Compact-work icons are emitted by their controller, avoiding competing observers.
    document.querySelectorAll('.dash-toolbar .qa-btn').forEach(node=>{if(node.querySelector('svg'))return;const text=node.textContent;node.insertAdjacentHTML('afterbegin',icon(text.includes('عقار')?'building':text.includes('واتساب')?'message':text.includes('مهمة')?'plus':'users'));});
    document.querySelectorAll('.ui-page button:not(.ops-title):not(.ops-work-shortcut),.ui-modal button,.topbar button,.ui-page .fl,.ui-modal .fl,.ui-page .info-label,.ui-page .task-due,.ui-page .task-priority,.ui-modal .modal-title').forEach(iconizeControl);
    document.querySelectorAll('.ui-page input[placeholder],.ui-modal input[placeholder]').forEach(n=>{const next=n.placeholder.replace(leading,'');if(next!==n.placeholder)n.placeholder=next;});
    document.querySelectorAll('.ui-page select option').forEach(n=>{if(/^\s*[🏷]\uFE0F?\s*كل الأنواع/u.test(n.textContent))n.textContent='كل الأنواع';});
    document.querySelectorAll('.page-title:not(#pdTitle),.notif-title,.exp-card-label,.form-section-title,.empty-ico').forEach(node=>{if(node.closest('#page-deals,#mDeal,#mDealWorkflow'))return;iconizeControl(node);});
    document.querySelectorAll('.ui-page .empty-ico').forEach(n=>{const key=n.textContent.replace(/\uFE0F/g,'').trim();if(emojiIcon[key])n.innerHTML=icon(emojiIcon[key]);});
    const followup=el('followupAlert')?.querySelector('button');
    if(followup&&!followup.dataset.uiFixed){followup.dataset.uiFixed='true';followup.onclick=()=>{[...document.querySelectorAll('#page-clients [onclick]')].find(b=>(b.getAttribute('onclick')||'').startsWith('filterClientRole(')&&methodKey(b)==='followup')?.click();};}
    document.querySelectorAll('.ui-page .btn-primary,.ui-page .btn-gold,.ui-modal .btn-primary').forEach(n=>{const text=[...n.childNodes].find(x=>x.nodeType===3&&/^\s*\+/.test(x.nodeValue));if(text&&!n.querySelector('svg')){text.nodeValue=text.nodeValue.replace(/^\s*\+\s*/,'');n.insertAdjacentHTML('afterbegin',icon('plus'));}});
    const alert=el('followupAlert')?.querySelector('.followup-text');if(alert)iconizeControl(alert);
    const avatar=el('userAv');if(avatar&&['👑','👤'].includes(avatar.textContent.trim()))avatar.innerHTML=icon('users');
    document.querySelectorAll('.ui-page .task-actions span[onclick]').forEach(n=>{if(n.dataset.uiControl)return;const deletion=(n.getAttribute('onclick')||'').startsWith('delete');n.classList.add('ui-icon-control');n.dataset.uiControl='true';n.setAttribute('role','button');n.tabIndex=0;n.setAttribute('aria-label',deletion?'حذف المهمة':'تعديل المهمة');n.innerHTML=icon(deletion?'trash':'edit');});
    document.querySelectorAll('.ui-page .task-check').forEach(n=>{n.setAttribute('role','checkbox');n.tabIndex=0;n.setAttribute('aria-label','إتمام المهمة');n.setAttribute('aria-checked',String(n.classList.contains('done')));});
    const bell=document.querySelector('.bell-wrapper');if(bell&&!bell.querySelector('.ui-symbol')){[...bell.childNodes].filter(n=>n.nodeType===3).forEach(n=>n.remove());bell.insertAdjacentHTML('afterbegin',icon('bell'));bell.setAttribute('role','button');bell.tabIndex=0;bell.setAttribute('aria-label','الإشعارات');}
    const ham=document.querySelector('.ham');if(ham&&!ham.querySelector('svg')){ham.innerHTML=icon('menu');ham.setAttribute('role','button');ham.tabIndex=0;ham.setAttribute('aria-label','فتح القائمة');}
    const logo=document.querySelector('.sb-logo');if(logo&&!logo.querySelector('svg'))logo.innerHTML=icon('building');
    const logout=document.querySelector('.sidebar-foot [onclick="forceLogout()"] .user-av');if(logout&&!logout.querySelector('svg'))logout.innerHTML=icon('logout');
    document.querySelectorAll('.report-tab,.cal-vbtn').forEach(n=>{n.setAttribute('aria-pressed',String(n.classList.contains('active')));});
  }
  const observer=new MutationObserver(()=>{if(scheduled)return;scheduled=true;requestAnimationFrame(refresh);});
  function refresh(){
    scheduled=false;observer.disconnect();
    try{clientFilters();simpleFilters();adapters.forEach(syncSelect);actionMenus();chrome();}
    finally{observer.observe(document.body,{childList:true,subtree:true});}
  }
  function install(){
    document.body.classList.add('crm-design');
    document.querySelectorAll('.page:not(#page-deals)').forEach(p=>p.classList.add('ui-page'));
    el('authScreen')?.classList.add('ui-page','ui-auth');
    const toast=el('toast');if(toast){toast.setAttribute('role','status');toast.setAttribute('aria-live','polite');}
    const authMark=document.querySelector('.auth-mark');if(authMark)authMark.innerHTML=icon('building');
    document.querySelectorAll('.ws-modal,#mActivity,#mEditMember,#mDayDetails,#mTagFilter,#mPropertyInquiry').forEach(p=>p.classList.add('ui-modal'));
    // The sidebar already includes sign-out. Do not duplicate it in the daily toolbar.
    document.querySelector('.topbar>button[onclick="logout()"]')?.classList.add('ui-filter-source');
    document.addEventListener('keydown',event=>{
      if(event.key==='Escape'){document.querySelectorAll('.ui-more[open]').forEach(d=>{d.open=false;d.querySelector('summary').focus();});return;}
      const node=event.target;if(['Enter',' '].includes(event.key)&&node.matches('.nav-link,.ham,.bell-wrapper,.ui-icon-control,.task-check')){event.preventDefault();node.click();}
    });
    document.addEventListener('click',event=>{
      document.querySelectorAll('.ui-more[open]').forEach(d=>{if(!d.contains(event.target))d.open=false;else if(event.target.closest('button'))d.open=false;});
    });
    const clientRenderer=window.crmRenderClientWorkList;
    if(typeof clientRenderer==='function')window.crmRenderClientWorkList=function(){const result=clientRenderer.apply(this,arguments);actionMenus();return result;};
    const reset=window.crmResetOperations;
    if(typeof reset==='function')window.crmResetOperations=function(){document.querySelectorAll('.ui-more[open]').forEach(d=>d.open=false);const result=reset.apply(this,arguments);adapters.forEach(a=>{a.signature='';a.select.replaceChildren();a.box.hidden=true;a.current=[];});return result;};
    refresh();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})();
