/* Scoped workspace presentation. Existing readers, filters, exports and permissions remain authoritative. */
(function () {
  'use strict';
  const el = id => document.getElementById(id);
  const esc = v => escapeHtml(String(v == null ? '' : v));
  const num = v => Number(v).toLocaleString('en-US');
  const date = v => v && Number.isFinite(Date.parse(v)) ? new Date(v).toLocaleDateString('ar-OM-u-nu-latn', {timeZone:'Asia/Muscat'}) : 'غير مسجل';
  const safeURL = v => { try { const u=new URL(v); return /^https?:$/.test(u.protocol)&&!u.username&&!u.password?u.href:''; } catch (_) {return '';} };
  const button = (action, label, id='') => '<button type="button" class="ws-action" data-workspace-action="'+action+'" data-id="'+esc(id)+'">'+label+'</button>';
  const table = (heads, rows, name) => '<div class="ws-table-wrap"><table class="ws-table" aria-label="'+name+'"><thead><tr>'+heads.map(h=>'<th scope="col">'+h+'</th>').join('')+'</tr></thead><tbody>'+rows+'</tbody></table></div>';
  const cell = (label, value, cls='') => '<td data-label="'+label+'" class="'+cls+'">'+value+'</td>';
  const labels={instagram:'Instagram',youtube:'YouTube',oman_reel:'Oman Reel',signboard:'لوحة العقار',referral:'إحالات',other:'أخرى'};
  class InputError extends Error {}
  let marketingSeq=0, marketingContext=null;

  // Render the exact already-filtered/exported rows. No second customer query or alternative filter.
  function clientsAsRows() {
    const mount=el('clientsList'); if(!mount)return;
    const cards=[...mount.querySelectorAll('.ops-client')]; if(!cards.length)return;
    const records=new Map(allClients.map(c=>[c.id,c]));
    const rows=cards.map(card=>{
      const title=card.querySelector('.ops-title'),id=title?.dataset.clientId,c=records.get(id)||{};
      const requests=[...card.querySelectorAll('.ops-request')],first=requests[0];
      const roleNames={buyer:'مشتري',seller:'بائع',investor:'مستثمر',tenant:'مستأجر',landlord:'مؤجر',consultation:'استشارة'};
      const roles=typeof getRoles==='function'?getRoles(c):[c.client_type];
      const identity=(title?.outerHTML||esc(c.name))+'<div class="ws-tags">'+[...new Set(roles)].filter(x=>roleNames[x]).map(r=>'<span>'+roleNames[r]+'</span>').join('')+'</div>';
      const request=first?'<strong>'+esc(first.querySelector('strong')?.textContent||'')+'</strong>'+ (requests.length>1?'<small>و'+num(requests.length-1)+' طلب آخر في الملف</small>':''):'<span class="ws-muted">لا يوجد طلب نشط</span>';
      const next=first?'<span>'+esc(first.querySelector('small')?.textContent||'')+'</span><small>'+esc(first.querySelector('.ops-next-action')?.textContent||'')+'</small>':'<span class="ws-muted">—</span>';
      const contact=card.querySelector('.ops-client-contact')?.outerHTML||'—';
      const controls=card.querySelector('.ops-client-foot')?.innerHTML||'';
      return '<tr data-client-row="'+esc(id)+'">'+cell('العميل',identity,'ws-identity')+cell('التواصل والمسار',contact)+cell('الطلب',request)+cell('المتابعة',next)+cell('الإجراءات','<div class="ws-actions">'+controls+(canEdit()&&!c.archived?button('archive-client','أرشفة',id):'')+'</div>')+'</tr>';
    }).join('');
    mount.innerHTML=table(['العميل','التواصل والمسار','الطلب الحالي','المتابعة والخطوة التالية','الإجراءات'],rows,'قائمة العملاء');
    const sub=el('clientsSub'); if(sub)sub.textContent=num(cards.length)+' عميل في العرض الحالي';
  }

  function propertiesAsRows() {
    const mount=el('propertiesList'); if(!mount)return;
    const cards=[...mount.querySelectorAll('.ops-property')]; if(!cards.length)return;
    const records=new Map(allProperties.map(p=>[p.id,p]));
    const rows=cards.map(card=>{
      const title=card.querySelector('.ops-title'),id=title?.dataset.workId,p=records.get(id)||{};
      const route=p.branch_key==='muscat'?'مسقط':p.branch_key==='barka'?'بركاء':p.branch_key==='investment'?'المستثمرون · خاص بالمالك':'غير محدد';
      const code=card.querySelector('.ops-code')?.outerHTML||'';
      const facts=[typeof propTypeAr==='function'?propTypeAr(p.type):p.type,p.bedrooms?num(p.bedrooms)+' غرف':null,p.land_size?num(p.land_size)+' م² أرض':null,p.built_size?num(p.built_size)+' م² بناء':null].filter(Boolean);
      const identity=(title?.outerHTML||esc(p.title))+'<small>'+code+' · أضيف '+esc(date(p.created_at))+'</small>';
      const actions=card.querySelector('.ops-property-actions')?.innerHTML||'';
      return '<tr data-property-row="'+esc(id)+'">'+cell('العقار',identity,'ws-identity')+cell('الموقع','<strong>'+esc(p.area||'غير محددة')+'</strong><small>'+route+'</small>')+cell('المواصفات',esc(facts.join(' · ')))+cell('السعر',card.querySelector('.ops-property-price')?.innerHTML||'—','ws-price')+cell('الحالة',card.querySelector('.ops-status')?.outerHTML||'—')+cell('الإجراءات','<div class="ws-actions">'+actions+button('property-marketing','التسويق',id)+'</div>')+'</tr>';
    }).join('');
    mount.innerHTML=table(['العقار','الفرع والمنطقة','المواصفات','السعر','الحالة','الإجراءات'],rows,'قائمة العقارات');
  }

  function installFilters() {
    const clients=el('page-clients'),tabs=el('clientRoleTabs');
    if(clients&&tabs&&!el('wsClientFilters')) {
      const panel=document.createElement('section');panel.id='wsClientFilters';panel.className='ws-filter-panel';panel.setAttribute('aria-label','بحث وتصنيف العملاء');
      clients.querySelector('.page-header').after(panel);
      const search=el('csText')?.closest('.card');
      if(search){search.classList.add('ws-search-card');panel.append(search);}
      const label=document.createElement('div');label.className='ws-filter-label';label.textContent='نوع العميل';panel.append(label,tabs);
      const secondary=document.createElement('div');secondary.className='ws-secondary-filters';
      const flow=document.createElement('div');flow.className='ws-flow-filter';flow.setAttribute('aria-label','حالة التواصل');
      [...tabs.children].filter(b=>/filterClientRole\('(hot|followup|unassigned)'/.test(b.getAttribute('onclick')||'')).forEach(b=>flow.append(b));
      secondary.append(flow);const work=el('opsClientsWork');if(work)secondary.append(work);panel.append(secondary);
      const oldFilter=window.filterClientRole;
      window.filterClientRole=function(kind,node){clients.querySelectorAll('[onclick^="filterClientRole"]').forEach(b=>b.classList.remove('active'));return oldFilter.apply(this,arguments);};
    }
  }

  function installReports() {
    const page=el('page-reports'); if(!page||el('wsReportPeriods'))return;
    const header=page.querySelector('.page-header'),periods=page.querySelector('.period-selector');
    const month=el('reportMonthPicker')?.parentElement;
    const controls=document.createElement('section');controls.id='wsReportPeriods';controls.className='ws-filter-panel';controls.setAttribute('aria-label','فترة التقرير');
    controls.innerHTML='<div class="ws-filter-label">الفترة الزمنية</div>';if(periods)controls.append(periods);if(month)controls.append(month);header.after(controls);
    const descriptions={overview:'المبيعات والعملاء ومصادر الوصول',revenue:'المتوقع والمحصّل والمتبقي',team:'نتائج مسقط وبركاء خلال الفترة',funnel:'من الاستفسار إلى الزيارة والحجز',thirtyday:'قياس خطة العمل والتجربة',heatmap:'توزيع المبيعات على المناطق'};
    page.querySelectorAll('.report-tab').forEach(b=>{const key=(b.getAttribute('onclick')||'').match(/switchReportTab\('([^']+)'/)?.[1];if(key){b.dataset.description=descriptions[key];b.setAttribute('aria-label',b.childNodes[0]?.textContent.trim()||key);}});
  }

  function mountMarketing() {
    const p=window.viewingProperty,content=el('propertyDetailContent');if(!p||!content||!content.children.length)return;
    let section=el('wsMarketing');if(section&&section.dataset.propertyId===p.id)return;
    if(section)section.remove();section=document.createElement('section');section.id='wsMarketing';section.className='card ws-marketing';section.dataset.propertyId=p.id;section.tabIndex=-1;
    section.innerHTML='<div class="card-head"><div><div class="card-title">التسويق وروابط الفيديوهات</div><p class="ws-subtitle">كل منشور مرتبط بهذا العقار، مع تاريخه وقياساته المتاحة.</p></div><div class="ws-actions">'+(canEdit()?button('add-marketing','+ إضافة رابط / نشاط'):'')+button('refresh-marketing','تحديث السجل')+'</div></div><div id="wsMarketingBody" class="card-body" aria-live="polite"></div>';
    content.prepend(section);loadMarketing(p.id);
  }
  async function loadMarketing(id) {
    const mount=el('wsMarketingBody'),section=el('wsMarketing'),user=currentUser?.id,generation=crmSessionGeneration,seq=++marketingSeq;
    if(!mount||section?.dataset.propertyId!==id||!user)return;
    const valid=()=>seq===marketingSeq&&crmSessionCurrent(generation,user)&&section.isConnected&&window.viewingProperty?.id===id;
    mount.innerHTML='<p class="ws-muted" role="status">جاري تحميل روابط العقار…</p>';
    try {
      const rows=await crmReadAll(()=>supa.from('property_marketing_events').select('*',{count:'exact'}).eq('company_id',currentProfile.company_id).eq('property_id',id).order('created_at',{ascending:false}).order('id'));
      if(!valid())return;
      if(!rows.length){mount.innerHTML='<div class="ws-empty"><strong>ابدأ سجل تسويق هذا العقار</strong><p>أضف رابط Instagram أو YouTube أو Oman Reel بعد نشر المحتوى. تُحفظ الروابط القديمة مع كل إضافة جديدة.</p></div>';return;}
      const links=new Set(rows.filter(r=>r.url&&r.event_type==='publish').map(r=>canonicalLink(r.url,r.channel)).filter(Boolean)),knownDates=rows.filter(r=>r.event_type==='publish'&&r.published_at).map(r=>r.published_at).sort();
      const entries=rows.map(r=>{
        const url=safeURL(r.url),metric=v=>v==null?'غير متاح':num(v);
        const state=r.sync_status==='synced'?'مزامنة Instagram':r.sync_status==='error'?'تعذرت المزامنة':r.views==null?'قياسات غير متاحة':'إدخال يدوي';
        return '<tr>'+cell('القناة','<strong>'+esc(labels[r.channel]||r.channel)+'</strong><small>'+esc(({publish:'نشر محتوى',update:'تحديث أداء',install:'تركيب',remove:'إزالة',other:'نشاط آخر'})[r.event_type]||r.event_type)+'</small>')+cell('تاريخ النشر',esc(date(r.published_at)))+cell('المشاهدات',metric(r.views??r.plays))+cell('الوصول',metric(r.reach))+cell('التفاعلات',metric(r.total_interactions))+cell('القياس',esc(state)+(r.last_synced_at?'<small>'+esc(date(r.last_synced_at))+'</small>':''))+cell('الرابط',url?'<a class="ws-action" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">فتح المحتوى ↗</a>':'—')+cell('الملاحظات',esc(r.notes||'—'))+'</tr>';
      }).join('');
      mount.innerHTML='<div class="ws-marketing-summary"><span><strong>'+num(links.size)+'</strong> روابط منشورة مختلفة</span><span><strong>'+num(rows.length)+'</strong> أنشطة مسجلة</span><span>آخر نشر: <strong>'+esc(date(knownDates.at(-1)))+'</strong></span></div>'+table(['القناة','تاريخ النشر','المشاهدات','الوصول','التفاعلات','حالة القياس','الرابط','الملاحظات'],entries,'سجل تسويق العقار')+'<p class="ws-subtitle">حفظ الرابط لا يعني قياس المشاهدات تلقائيًا. قياسات Instagram تُحدّث من أداء العقار حسب الاتصال والصلاحيات؛ قياسات YouTube وOman Reel تُسجّل يدويًا.</p>';
    } catch(error) {if(valid()){console.warn('property_marketing_read_failed',error);mount.innerHTML='<div class="ws-error" role="alert">تعذر تحميل سجل التسويق. لم تُحذف الروابط المحفوظة. '+button('refresh-marketing','إعادة المحاولة')+'</div>';}}
  }
  function canonicalLink(value,channel) {
    const url=safeURL(value);if(!url)return '';
    if(channel==='instagram')return window.CRMFunnel?.instagramUrl?.(url)||url;
    const u=new URL(url);
    if(channel==='youtube'&&/^(www\.|m\.)?youtube\.com$|^youtu\.be$/.test(u.hostname)) {let id=u.hostname==='youtu.be'?u.pathname.slice(1):u.searchParams.get('v');if(!id)id=u.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]+)/)?.[1];if(id)return 'https://www.youtube.com/watch?v='+encodeURIComponent(id);}
    return url;
  }
  function openMarketing() {
    if(!canEdit()||!window.viewingProperty||crmSavingForms.has('mPropertyMarketing'))return;
    const p=window.viewingProperty;marketingContext={id:p.id,user:currentUser.id,generation:crmSessionGeneration};
    el('pmChannel').value='instagram';el('pmEventType').value='publish';el('pmPublishedAt').value=new Date(Date.now()+14400000).toISOString().slice(0,16);
    ['pmViews','pmUrl','pmNotes'].forEach(id=>el(id).value='');
    updatePropertyMarketingHint();el('mPropertyMarketing').classList.add('on');el('pmUrl').focus();
  }
  async function saveMarketing() {
    const ctx=marketingContext,modal='mPropertyMarketing';
    if(!ctx||!canEdit()||!crmSessionCurrent(ctx.generation,ctx.user)||ctx.id!==window.viewingProperty?.id||!crmBeginSave(modal))return;
    const valid=()=>marketingContext===ctx&&crmSessionCurrent(ctx.generation,ctx.user);
    try {
      const channel=el('pmChannel').value,kind=el('pmEventType').value,raw=el('pmUrl').value.trim(),url=raw?canonicalLink(raw,channel):null,viewRaw=el('pmViews').value.trim(),rawDate=el('pmPublishedAt').value;
      if(!(channel in labels)||!['publish','update','install','remove','other'].includes(kind))throw new InputError('اختر قناة ونوع نشاط صحيحين');
      if(raw&&!url)throw new InputError('أدخل رابطًا صحيحًا يبدأ بـ https:// أو http://');
      if(['instagram','youtube','oman_reel'].includes(channel)&&kind==='publish'&&!url)throw new InputError('أضف رابط الفيديو أو المنشور قبل الحفظ');
      if(url&&channel==='instagram'&&!window.CRMFunnel?.instagramUrl(url))throw new InputError('أدخل رابط منشور أو Reel من Instagram');
      if(url&&channel==='youtube'&&!/^(www\.|m\.)?youtube\.com$|^youtu\.be$/.test(new URL(url).hostname))throw new InputError('اختر رابطًا من YouTube لهذه القناة');
      const views=viewRaw===''?null:Number(viewRaw);if(views!==null&&(!Number.isSafeInteger(views)||views<0))throw new InputError('المشاهدات عدد صحيح غير سالب، أو اتركه فارغًا إن كان غير معروف');
      const published=rawDate?new Date(rawDate+':00+04:00'):null;
      if(published&&(!Number.isFinite(published.getTime())||new Date(published.getTime()+14400000).toISOString().slice(0,16)!==rawDate))throw new InputError('راجع تاريخ النشر ووقته بتوقيت مسقط');
      const payload={company_id:currentProfile.company_id,property_id:ctx.id,channel,event_type:kind,published_at:published?published.toISOString():null,views,url,notes:el('pmNotes').value.trim()||null,created_by:ctx.user,auto_sync:false,sync_status:'manual'};
      // A second publication of the same content is not a new video. Update metrics via an explicit update event.
      if(url&&kind==='publish'){
        const existing=await crmReadAll(()=>supa.from('property_marketing_events').select('id,url',{count:'exact'}).eq('company_id',payload.company_id).eq('property_id',ctx.id).eq('channel',channel).eq('event_type','publish').order('id'));
        if(!valid())return;
        if(existing.some(r=>canonicalLink(r.url,channel)===url)){crmFinishSave(modal);showToast('الرابط مسجل لهذا العقار بالفعل؛ لم تتم إضافته مرتين. لتسجيل قياس جديد اختر تحديث أداء.','info');await loadMarketing(ctx.id);return;}
      }
      const id=crmSaveKey(modal,payload);let result=await supa.from('property_marketing_events').insert({...payload,id}).select('id').single();
      if(!valid())return;
      if(result.error||result.data?.id!==id){
        const stored=await supa.from('property_marketing_events').select('*').eq('id',id).eq('property_id',ctx.id).maybeSingle();
        if(!valid())return;
        const same=stored.data&&Object.entries(payload).every(([key,value])=>key==='published_at'?(value===null?stored.data[key]==null:Date.parse(stored.data[key])===Date.parse(value)):stored.data[key]===value);
        if(stored.error||!same)throw new InputError('لم يؤكد الخادم حفظ النشاط. بياناتك باقية؛ أعد المحاولة دون إغلاق النافذة.');
      }
      crmFinishSave(modal);showToast('تم حفظ النشاط وربطه بالعقار','success');
      if(window.viewingProperty?.id===ctx.id){await loadMarketing(ctx.id);if(valid())loadPropertyPerformance(ctx.id);}
      if(valid()&&window.CRMFunnel)window.CRMFunnel.refreshProperty(ctx.id).catch(error=>console.warn('marketing_funnel_refresh',error));
      if(valid()&&window.viewingProperty?.id===ctx.id&&typeof loadPropertyDecisionPanel==='function')loadPropertyDecisionPanel(ctx.id);
    }catch(error){if(valid()){console.warn('property_marketing_save_failed',error);showToast(error instanceof InputError?error.message:'تعذر حفظ النشاط. المدخلات محفوظة في النافذة؛ أعد المحاولة.','error');}}
    finally{if(valid())crmEndSave(modal);}
  }

  function install() {
    ['dash','daily','clients','properties','propertyDetail','calendar','viewings','deposits','reports','owners','expenses','activityLog','team','instagram'].forEach(id=>el('page-'+id)?.classList.add('ws-page'));
    ['mPropertyMarketing','mClient','mProperty','mOwner','mViewing','mDeposit','mExpense','mTask','mEvent'].forEach(id=>el(id)?.classList.add('ws-modal'));
    document.querySelectorAll('.nav-link').forEach(link=>{if(/navigate\('ai'/.test(link.getAttribute('onclick')||''))link.remove();});el('page-ai')?.remove();
    const oldNav=window.navigate;
    window.navigate=function(id,node){if(id==='ai')id='daily';const result=oldNav.call(this,id,node);return result;};
    installFilters();installReports();
    const oldClientRows=window.crmRenderClientWorkList;
    window.crmRenderClientWorkList=function(){const result=oldClientRows.apply(this,arguments);clientsAsRows();return result;};clientsAsRows();
    const properties=el('propertiesList');if(properties)new MutationObserver(propertiesAsRows).observe(properties,{childList:true});propertiesAsRows();
    const oldViewProperty=window.viewProperty;
    window.viewProperty=async function(id){const user=currentUser?.id,generation=crmSessionGeneration;const result=await oldViewProperty.apply(this,arguments);if(crmSessionCurrent(generation,user)&&window.viewingProperty?.id===id)mountMarketing();return result;};
    const oldPerformance=window.loadPropertyPerformance;
    window.loadPropertyPerformance=async function(id){const result=await oldPerformance.apply(this,arguments);if(window.viewingProperty?.id===id&&el('wsMarketing'))el('pdPerformance')?.querySelectorAll('.card').forEach(card=>{if(card.querySelector('.card-title')?.textContent.trim().replace(/^🕓\s*/,'')==='سجل التسويق')card.remove();});return result;};
    window.openPropertyMarketingModal=openMarketing;window.savePropertyMarketingEvent=saveMarketing;
    const title=el('pmPublishedAt')?.previousElementSibling;if(title)title.textContent='تاريخ النشر ووقته · مسقط';
    const originalReset=window.crmResetOperations;
    window.crmResetOperations=function(){marketingSeq++;marketingContext=null;el('wsMarketing')?.remove();return originalReset.apply(this,arguments);};
    const team=el('employeeTargetsPanel')?.parentElement;if(team&&!el('wsBranchHelp')){const help=document.createElement('p');help.id='wsBranchHelp';help.className='ws-subtitle';help.textContent='الأهداف تخص الفرع، لا اسم الموظف. إدارة حسابات الدخول والصلاحيات في القسم المستقل أدناه.';team.prepend(help);}
    document.addEventListener('click',async event=>{
      const b=event.target.closest('[data-workspace-action]');if(!b)return;event.preventDefault();const action=b.dataset.workspaceAction;
      if(action==='archive-client'&&canEdit())archiveClientById(b.dataset.id);
      if(action==='add-marketing')openMarketing();
      if(action==='refresh-marketing'&&window.viewingProperty)loadMarketing(window.viewingProperty.id);
      if(action==='property-marketing'){await viewProperty(b.dataset.id);if(window.viewingProperty?.id===b.dataset.id){el('wsMarketing')?.scrollIntoView({block:'start',behavior:'smooth'});el('wsMarketing')?.focus({preventScroll:true});}}
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})();
