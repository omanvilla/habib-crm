/* Owner-only publication review. Existing marketing records remain authoritative. */
(function(){
 'use strict';
 const $=id=>document.getElementById(id),escape=v=>escapeHtml(String(v??''));
 const number=v=>Number(v).toLocaleString('en-US');
 const date=v=>v?new Date(v).toLocaleString('ar-OM-u-nu-latn',{timeZone:'Asia/Muscat',dateStyle:'medium',timeStyle:'short'}):'لم يتم بعد';
 const reason={unclear_content:'الوصف لا يوضح نوع الفيديو',property_not_found:'لا يوجد عقار مطابق في السجلات',insufficient_specifications:'المواصفات غير كافية',multiple_matches:'أكثر من عقار يطابق المواصفات',multiple_units:'الإعلان يذكر عدة وحدات',conflicting_specifications:'توجد مواصفات مختلفة عن السجل',mixed_advice_and_offer:'يحتمل نصيحة أو إعلانًا',advice:'نصيحة أو محتوى عام',not_video:'منشور غير فيديو',existing_link:'مرتبط سابقًا',existing_conflict:'تعارض في الربط السابق',unique_specification_match:'تطابق واضح للمواصفات',owner_review:'قرار المالك',new_media:'قيد الفحص'};
 const scope=()=>typeof currentUser!=='undefined'&&currentUser&&currentProfile&&isOwner()?currentUser.id+':'+currentProfile.company_id+':'+crmSessionGeneration:'';
 let sequence=0,rows=[],properties=[],offset=0,filter='needs_review',busy=new Set();
 function safeLink(value){try{const u=new URL(value);return u.protocol==='https:'&&/^(www\.)?instagram\.com$/.test(u.hostname)&&/^\/(p|reels?|tv)\/[\w-]+\/?$/.test(u.pathname)?u.href:'';}catch{return '';}}
 function mount(){
  const page=$('page-instagram');if(!page||$('igDiscovery'))return;
  const section=document.createElement('section');section.id='igDiscovery';section.className='card ig-discovery';section.hidden=true;
  section.innerHTML='<div class="card-head"><div><div class="card-title">ربط المنشورات بالعقارات</div><p class="ws-subtitle">فحص تلقائي كل 5 دقائق. الربط الواضح يتم مباشرة؛ المحتوى الملتبس ينتظر قرارك.</p></div><div class="ws-actions"><button class="btn-secondary" data-igd="scan">فحص الآن</button><button class="btn-secondary" data-igd="refresh">تحديث القائمة</button></div></div><div class="card-body"><div id="igDiscoveryStatus" role="status"></div><label class="ig-discovery-filter">عرض <select id="igDiscoveryFilter" class="fs"><option value="needs_review">بحاجة إلى مراجعة</option><option value="linked">مرتبط بالعقارات</option><option value="non_property">نصائح / محتوى آخر</option><option value="pending">قيد الفحص</option></select></label><div id="igDiscoveryRows" aria-live="polite"></div><div id="igDiscoveryPages" class="ws-actions"></div><p class="ws-subtitle">يحفظ النظام رابط المنشور ووصفه وتاريخ نشره، وليس نسخة فيديو مستقلة. القياسات غير المتاحة لا تُسجّل صفرًا. المراجعة تشمل السجلات القديمة والمباعة أيضًا.</p></div>';
  page.querySelector('.page-header').after(section);
  const banner=document.createElement('div');banner.id='igDiscoveryAlert';banner.className='ig-discovery-alert';banner.hidden=true;
  $('page-dash')?.querySelector('.page-header')?.after(banner);
 }
 async function overview(){
  const identity=scope();mount();if(!identity)return null;
  const company=currentProfile.company_id;
  const state=await supa.from('instagram_discovery_state').select('enabled,auto_link_enabled,backfill_complete,last_success_at,last_error_code').eq('company_id',company);
  if(state.error)throw state.error;
  const counts={};for(const status of ['needs_review','linked','non_property','pending']){
   const result=await supa.from('instagram_media_catalog').select('id',{count:'exact',head:true}).eq('company_id',company).eq('state',status);
   if(result.error)throw result.error;counts[status]=result.count;
  }
  if(identity!==scope())return null;
  const states=state.data||[],active=states.some(s=>s.enabled&&s.auto_link_enabled),failed=states.some(s=>s.last_error_code),complete=states.length&&states.every(s=>s.backfill_complete);
  const last=states.map(s=>s.last_success_at).filter(Boolean).sort().at(-1);
  $('igDiscoveryStatus').innerHTML='<strong>'+(failed?'توجد مشكلة اتصال؛ المحفوظات لم تتغير':active?'الربط التلقائي مفعّل':'الربط التلقائي غير مفعّل بعد')+'</strong><p class="ws-subtitle">آخر فحص ناجح: '+escape(date(last))+' · '+(complete?'اكتملت قراءة أرشيف الحساب':'قراءة الأرشيف لم تكتمل بعد')+'</p><div class="ig-discovery-counts">'+[['linked','مرتبط'],['needs_review','للمراجعة'],['non_property','محتوى آخر'],['pending','قيد الفحص']].map(([key,label])=>'<span>'+label+' <strong>'+escape(counts[key]==null?'—':number(counts[key]))+'</strong></span>').join('')+'</div>';
  const banner=$('igDiscoveryAlert');if(banner){banner.hidden=!failed&&!counts.needs_review;banner.innerHTML='<span>'+(failed?'مزامنة Instagram تحتاج المراجعة':number(counts.needs_review)+' منشور Instagram يحتاج تحديد العقار أو نوع المحتوى')+'</span><button class="btn-secondary" data-igd="open">مراجعة المنشورات</button>';}
  return counts;
 }
 async function load(){
  const identity=scope(),seq=++sequence;mount();if(!identity){if($('igDiscovery'))$('igDiscovery').hidden=true;return;}
  $('igDiscovery').hidden=false;$('igDiscoveryRows').textContent='جاري تحميل المنشورات…';$('igDiscoveryPages').textContent='';
  try{
   const counts=await overview();if(identity!==scope()||seq!==sequence)return;
   const response=await supa.from('instagram_media_catalog').select('id,permalink,caption,published_at,state,reason_code,property_id,updated_at',{count:'exact'}).eq('company_id',currentProfile.company_id).eq('state',filter).order('published_at',{ascending:false}).order('id').range(offset,offset+19);
   if(response.error)throw response.error;
   const choices=await crmReadAll(()=>supa.from('crm_properties_access').select('id,title,area,price,archived',{count:'exact'}).eq('company_id',currentProfile.company_id).order('title').order('id'));
   if(identity!==scope()||seq!==sequence)return;
   rows=response.data||[];properties=choices;
   $('igDiscoveryRows').innerHTML=rows.length?rows.map(row=>{
    const url=safeLink(row.permalink),property=properties.find(p=>p.id===row.property_id);
    const decisions=filter==='needs_review'?'<details><summary>تحديد العقار أو نوع المحتوى</summary><label>العقار الصحيح<select class="fs" data-ig-property="'+escape(row.id)+'"><option value="">اختر العقار…</option>'+properties.map(p=>'<option value="'+escape(p.id)+'">'+escape(p.title)+(p.archived?' · مؤرشف':'')+'</option>').join('')+'</select></label><div class="ws-actions"><button class="btn-primary" data-igd="link" data-id="'+escape(row.id)+'">ربط بالعقار المحدد</button><button class="btn-secondary" data-igd="general" data-id="'+escape(row.id)+'">نصيحة / ليس إعلان عقار</button></div></details>':'';
    return '<article class="ig-discovery-row"><div class="ws-actions"><strong>'+escape(reason[row.reason_code]||'بحاجة إلى مراجعة')+'</strong><span>'+escape(date(row.published_at))+'</span>'+(url?'<a class="ws-action" href="'+escape(url)+'" target="_blank" rel="noopener noreferrer">فتح المنشور ↗</a>':'')+'</div>'+(property?'<p>العقار: <strong>'+escape(property.title)+'</strong></p>':'')+'<p class="ig-discovery-caption">'+escape(row.caption||'لا يوجد وصف للمنشور؛ افتح الفيديو لتحديد محتواه.')+'</p>'+decisions+'</article>';
   }).join(''):'<p class="ws-empty">لا توجد منشورات في هذا التصنيف.</p>';
   const total=response.count??counts?.[filter]??rows.length;
   $('igDiscoveryPages').innerHTML=(offset?'<button class="btn-secondary" data-igd="previous">السابق</button>':'')+'<span>'+number(Math.min(offset+1,total))+'–'+number(offset+rows.length)+' من '+number(total)+'</span>'+(offset+20<total?'<button class="btn-secondary" data-igd="next">التالي</button>':'');
  }catch(error){if(identity===scope()&&seq===sequence){console.warn('instagram_discovery_read',error?.code||'failed');$('igDiscoveryRows').innerHTML='<div class="ws-error" role="alert">تعذر تحميل قائمة الربط؛ أعد المحاولة. لم تتغير الروابط المحفوظة.</div>';}}
 }
 async function decide(id,decision){
  const identity=scope(),row=rows.find(r=>r.id===id);if(!identity||!row||busy.has(id))return;
  const property=decision==='link'?document.querySelector('[data-ig-property="'+id+'"]')?.value:null;
  if(decision==='link'&&!property){showToast('اختر العقار الصحيح أولًا','error');return;}
  busy.add(id);document.querySelectorAll('[data-igd][data-id="'+id+'"]').forEach(b=>b.disabled=true);
  try{const result=await supa.rpc('crm_instagram_review',{p_id:id,p_expected:row.updated_at,p_decision:decision,p_property:property});
   if(identity!==scope())return;if(result.error)throw result.error;
   showToast(decision==='link'?'تم ربط المنشور بالعقار':'تم تسجيله كمحتوى آخر دون ربطه بعقار','success');await load();
  }catch(error){if(identity===scope())showToast(error?.code==='40001'?'تغير السجل أثناء المراجعة. حدّث القائمة قبل الحفظ.':'تعذر حفظ المراجعة. لم يتم تأكيد أي تغيير.','error');}
  finally{busy.delete(id);if(identity===scope())document.querySelectorAll('[data-igd][data-id="'+id+'"]').forEach(b=>b.disabled=false);}
 }
 function install(){
  mount();const nav=window.navigate;window.navigate=function(id,node){const result=nav.apply(this,arguments);if(id==='instagram')load();if(id==='dash'&&scope())overview().catch(()=>{});return result;};
  const reset=window.crmResetOperations;window.crmResetOperations=function(){sequence++;rows=[];properties=[];offset=0;busy.clear();['igDiscoveryRows','igDiscoveryStatus','igDiscoveryPages','igDiscoveryAlert'].forEach(id=>{if($(id))$(id).textContent='';});if($('igDiscovery'))$('igDiscovery').hidden=true;if($('igDiscoveryAlert'))$('igDiscoveryAlert').hidden=true;return reset.apply(this,arguments);};
  const notifications=window.loadNotifications;window.loadNotifications=async function(){const identity=scope();await notifications.apply(this,arguments);if(!identity||identity!==scope())return;
   try{const result=await supa.from('notifications').select('id,title,body,created_at').eq('user_id',currentUser.id).eq('type','instagram_discovery').order('created_at',{ascending:false}).limit(20);if(result.error)throw result.error;if(identity!==scope())return;
    const read=readNotificationReceipts();const additional=(result.data||[]).map(n=>({id:'ig-'+n.id,type:'task',icon:window.CRMDesign?.icon('property')||'↗',text:'<strong>'+escape(n.title)+'</strong><br>'+escape(n.body),time:n.created_at,onclick:"navigate('instagram',null)"})).filter(n=>!read.has(notificationReceiptId(n)));
    allNotifications=[...allNotifications.filter(n=>!n.id.startsWith('ig-')),...additional].sort((a,b)=>new Date(b.time)-new Date(a.time));renderNotifications();updateBellDot();
   }catch{if(identity===scope()&&$('notifBody'))$('notifBody').insertAdjacentHTML('beforeend','<div class="ws-error">تعذر تحميل تنبيهات Instagram؛ أعد فتح الإشعارات للمحاولة.</div>');}
  };
  document.addEventListener('change',event=>{if(event.target.id==='igDiscoveryFilter'){filter=event.target.value;offset=0;load();}});
  document.addEventListener('click',async event=>{const b=event.target.closest('[data-igd]');if(!b||!scope())return;event.preventDefault();const action=b.dataset.igd;
   if(action==='open')navigate('instagram',null);
   if(action==='refresh')load();if(action==='next'){offset+=20;load();}if(action==='previous'){offset=Math.max(0,offset-20);load();}
   if(action==='link'||action==='general')decide(b.dataset.id,action==='link'?'link':'non_property');
   if(action==='scan'&&!busy.has('scan')){busy.add('scan');b.disabled=true;const identity=scope();try{const r=await supa.rpc('crm_request_instagram_scan');if(identity!==scope())return;if(r.error)throw r.error;showToast(r.data?.queued?'أُرسل طلب الفحص. النتائج تظهر بعد اكتمال المعالجة.':'الفحص طُلب مؤخرًا أو غير مفعّل؛ راجع الحالة.','info');}catch{if(identity===scope())showToast('تعذر طلب الفحص؛ المحاولة الدورية مستقلة.','error');}finally{busy.delete('scan');b.disabled=false;}}
  });
  const app=$('appScreen');if(app)new MutationObserver(()=>{if(app.classList.contains('visible')&&scope())overview().catch(()=>{});}).observe(app,{attributes:true,attributeFilter:['class']});
  if(scope())overview().catch(()=>{});
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})();
