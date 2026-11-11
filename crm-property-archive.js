/* Property archive and restore (10 November 2026, Ahmed's instruction 3; contract A).
 * «أرشفة» (window.deleteProperty, reached from archivePropertyById and every 📦 button) opens «أرشفة العقار — ليش؟»:
 * one reason from public.property_archive_reasons (manual_selectable), a note when the reason needs one, and the
 * warnings of crm_property_archive_precheck (open deals by stage, upcoming viewings). A branch account is blocked by an
 * active deal; the owner may tick «أعرف إن على العقار صفقة شغالة», which sends p_force. crm_archive_property sets the
 * status in the same update (sold stays sold) and writes the history; the deal trigger (contract B) then closes the
 * open early deals on the property.
 * «استعادة» (window.restoreProperty) opens «استعادة العقار كعقد جديد»: a new marketing contract or none, the price and
 * «تأكدت من المالك إن العقار متاح». crm_restore_property relists it; its new-listing notice waits for approval.
 * This file never writes public.properties itself: the server functions check permissions and keep the history.
 * Archived rows never read «متوفر»: the property grid, phone cards and the details page show «📦 <reason>», and
 * withdrawn reads «مسحوب» (also in the client's «عقارات العميل» tab). Only those status labels are rewritten; nothing
 * else in the list. Deal stages are read only. */
(function(){
  'use strict';
  const byId=id=>document.getElementById(id);
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
  const toast=(m,t)=>{if(typeof showToast==='function')showToast(m,t);};
  const owner=()=>typeof isOwner==='function'&&!!isOwner();
  const editor=()=>typeof canEdit==='function'&&!!canEdit();
  // PGRST202: the API has no such function, i.e. SQL76 is not applied on this database (or was rolled back first).
  // The release puts these UI files on main only after SQL76; this keeps the message Arabic if that order slips.
  const RPC_MISSING='تحديث قاعدة البيانات للأرشيف ما انطبق بعد';
  const errText=e=>e&&e.code==='PGRST202'?RPC_MISSING:String((e&&(e.message||e.details||e.hint))||e||'').slice(0,240);
  const snapshot=()=>({gen:typeof crmSessionGeneration==='undefined'?0:crmSessionGeneration,user:typeof currentUser!=='undefined'&&currentUser?currentUser.id:null});
  const live=s=>!!s.user&&(typeof crmSessionCurrent!=='function'||!!crmSessionCurrent(s.gen,s.user));
  const digits=v=>typeof crmDigits==='function'?crmDigits(v):String(v==null?'':v).replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
  const muscatToday=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Muscat'});
  const dateAr=d=>{const t=d?new Date(d):null;return t&&!isNaN(t)?t.toLocaleDateString('ar-OM-u-nu-latn',{timeZone:'Asia/Muscat',day:'numeric',month:'long',year:'numeric'}):'';};

  const STATUS_AR={available:'متوفر',reserved:'محجوز',deposit:'عربون',negotiating:'تفاوض',sold:'مباع',not_available:'غير متاح',withdrawn:'مسحوب'};
  // The map renderPropertyDetail (app-base) writes into #pdSub, used to find and replace only its status part.
  const BASE_DETAIL={available:'✅ متوفر',reserved:'⏳ محجوز',deposit:'💰 عربون',negotiating:'💬 تفاوض',sold:'🔴 مباع',not_available:'⚪ غير متاح'};
  const OFF_MARKET=['withdrawn','not_available'];
  const ACTIVE_STAGES=['negotiation','deposit','awaiting_finance','finance_approved','awaiting_clearance','ownership_transfer'];
  const ACTIVE_STATUSES=['reserved','deposit','negotiating'];
  const PRE_RESERVATION=['new','viewing_scheduled','viewing_no_show','viewing_cancelled','viewing_postponed','visit','negotiation'];
  const STAGE_AR={new:'زيارة',viewing_scheduled:'زيارة',viewing_no_show:'زيارة — لم يحضر',viewing_cancelled:'زيارة — ألغيت',viewing_postponed:'زيارة — تأجلت',visit:'زيارة تمت — القرار مطلوب',negotiation:'تفاوض',deposit:'عربون / حجز',awaiting_finance:'تمويل',finance_approved:'تمويل',awaiting_clearance:'إجراء قبل البيع',ownership_transfer:'إجراء قبل البيع'};
  const stageLabel=s=>{if(typeof dealStageAr==='function'){const t=String(dealStageAr(s)||'').replace(/^[^\p{L}\p{N}]+/u,'').trim();if(t)return t;}return STAGE_AR[s]||String(s||'غير محدد');};
  const STAFF_BLOCK='عليه صفقة شغالة (تفاوض أو حجز). ما تقدر تأرشفه من حساب الفرع، كلّم أحمد';
  // Exception codes raised by the SQL76 functions, in plain Arabic.
  const CODES={active_deal:'على العقار صفقة شغالة',not_authorized:'ما عندك صلاحية لهذا العقار',property_not_found:'العقار غير موجود أو مو ضمن فرعك',archive_reason_invalid:'السبب غير معروف',archive_reason_not_selectable:'هذا السبب ما ينختار من الشاشة',archive_note_required:'اكتب ملاحظة لهذا السبب',property_not_archived:'العقار مو في الأرشيف',property_has_completed_deal:'على العقار صفقة بيع مكتملة، فما يرجع «متوفر»',property_has_active_reservation:'على العقار حجز أو عربون شغال، فما يرجع «متوفر»',price_invalid:'السعر لازم يكون أكبر من صفر',agreement_duration_invalid:'مدة العقد من 1 إلى 60 شهر',agreement_already_ended:'العقد اللي كتبته خلص قبل اليوم، خل البداية من اليوم أو زد المدة',property_archive_use_rpc:'الأرشفة والاستعادة من أزرارها بس'};
  // While archiving, the deal guard refuses any status but «مباع» when a sale is completed on the property.
  const ARCHIVE_CODES={property_has_completed_deal:'على العقار صفقة بيع مكتملة، فما يتأرشف إلا «مباع». اختر «انباع عن طريقنا»'};
  const friendly=(t,kind)=>{const k=String(t||'').trim();return (kind==='archive'&&ARCHIVE_CODES[k])||CODES[k]||String(t||'');};
  const outText=(out,kind)=>friendly((out&&(out.blocked||out.error||out.reason||out.code||out.message))||'ما تأكد الحفظ من الخادم',kind);

  // Contract A rows. They show until public.property_archive_reasons is read; the database list then wins.
  const FALLBACK_REASONS=[
    {code:'contract_expired',label_ar:'انتهى عقد التسويق',status_after:'withdrawn',manual_selectable:true,note_required:false,sort_order:10},
    {code:'owner_withdrew',label_ar:'المالك سحب العقار',status_after:'withdrawn',manual_selectable:true,note_required:false,sort_order:20},
    {code:'sold_by_owner',label_ar:'المالك باعه بنفسه أو عن طريق غيرنا',status_after:'sold',manual_selectable:true,note_required:false,sort_order:30},
    {code:'sold_by_us',label_ar:'انباع عن طريقنا',status_after:'sold',manual_selectable:true,note_required:false,sort_order:40},
    {code:'rented',label_ar:'انأجر',status_after:'not_available',manual_selectable:true,note_required:false,sort_order:50},
    {code:'duplicate',label_ar:'سجل مكرر',status_after:'not_available',manual_selectable:true,note_required:true,sort_order:60},
    {code:'test_record',label_ar:'سجل تجريبي أو خطأ إدخال',status_after:'not_available',manual_selectable:true,note_required:false,sort_order:70},
    {code:'other',label_ar:'سبب آخر',status_after:'not_available',manual_selectable:true,note_required:true,sort_order:80},
    {code:'unrecorded',label_ar:'سبب الأرشفة غير مسجل',status_after:'not_available',manual_selectable:false,note_required:false,sort_order:90}
  ];
  let reasons=FALLBACK_REASONS.slice(),reasonsFromDb=false,reasonsPending=null,reasonsTriedAt=0;
  const reasonOf=code=>reasons.find(r=>r.code===code)||null;
  const manualReasons=()=>reasons.filter(r=>r.manual_selectable===true).sort((a,b)=>(Number(a.sort_order)||0)-(Number(b.sort_order)||0));
  function loadReasons(){
    if(reasonsPending)return reasonsPending;
    if(reasonsFromDb||typeof supa==='undefined'||!snapshot().user||Date.now()-reasonsTriedAt<60000)return Promise.resolve(reasons);
    reasonsTriedAt=Date.now();
    reasonsPending=Promise.resolve(supa.from('property_archive_reasons').select('code,label_ar,status_after,manual_selectable,note_required,sort_order').order('sort_order',{ascending:true}))
      .then(r=>{const rows=!r||r.error||!Array.isArray(r.data)?[]:r.data.filter(x=>x&&x.code&&x.label_ar);if(rows.length){reasons=rows;reasonsFromDb=true;refreshLabels();}return reasons;})
      .catch(()=>reasons)
      .then(list=>{reasonsPending=null;return list;});
    return reasonsPending;
  }

  // ---- Labels: an archived row is «📦 <reason>», never «متوفر» -----------------------------------
  function archivedText(p){
    const r=reasonOf(p.archive_reason),s=p.status;
    let text=r?r.label_ar:'مؤرشف';
    const extra=!!s&&s!=='available'&&(!r||(s!==r.status_after&&!(OFF_MARKET.includes(s)&&OFF_MARKET.includes(r.status_after))));
    if(extra)text+=' · '+(STATUS_AR[s]||s);
    return '📦 '+text;
  }
  // null keeps the label the page already wrote.
  function statusText(p,emoji){
    if(!p)return null;
    if(p.archived===true)return archivedText(p);
    if(p.status==='withdrawn')return (emoji?'⚪ ':'')+STATUS_AR.withdrawn;
    return null;
  }
  function setLabel(node,text,archived){
    if(!node||text==null)return;
    if(node.textContent!==text)node.textContent=text;
    if(node.classList&&node.classList.contains('cpa-archived-chip')!==!!archived)node.classList.toggle('cpa-archived-chip',!!archived);
  }
  function propertyIndex(){
    const list=typeof allProperties!=='undefined'&&Array.isArray(allProperties)?allProperties:[],index=new Map();
    list.forEach(p=>{if(p&&p.id)index.set(p.id,p);});return index;
  }
  // Property grid rows (crm-operations-v6), base phone cards and the base table: only the status chip changes.
  function patchList(){
    const list=byId('propertiesList');if(!list)return;
    const rows=list.querySelectorAll('tr[data-property-row],.mobile-property-card,table.tbl tr[data-id]');if(!rows.length)return;
    const index=propertyIndex();if(!index.size)return;
    if(!reasonsFromDb)loadReasons();
    rows.forEach(row=>{
      let id='',chip=null;const grid=row.hasAttribute('data-property-row');
      if(grid){id=row.getAttribute('data-property-row');chip=row.querySelector('.ops-status');}
      else if(row.classList.contains('mobile-property-card')){id=((row.getAttribute('onclick')||'').match(/viewProperty\('([^']+)'\)/)||[])[1]||'';chip=row.querySelector('.mobile-status-chip');}
      else{id=row.getAttribute('data-id');chip=row.children[4]||null;}
      const p=id?index.get(id):null;if(!p||!chip)return;
      setLabel(chip,statusText(p,!grid),p.archived===true);
    });
  }
  function archivedBy(p){
    if(p.archive_source==='agent')return 'العقل';
    if(p.archive_source==='system')return 'النظام';
    const id=p.archived_by;if(!id)return '';
    if(typeof currentUser!=='undefined'&&currentUser&&currentUser.id===id)return (typeof currentProfile!=='undefined'&&currentProfile&&currentProfile.full_name)||'أنت';
    const members=typeof allMembers!=='undefined'&&Array.isArray(allMembers)?allMembers:[];
    const m=members.find(x=>x&&x.id===id);return m&&m.full_name?String(m.full_name):'';
  }
  // 12 Nov: the owner sets the reason of an archive recorded as «سبب الأرشفة غير مسجل» with «حدد السبب» (SQL76 logs it as
  // reason_set; only the owner may, the server checks). Any other archived row stays read-only; staff never see the button.
  const needsReason=p=>p&&p.archived===true&&(!p.archive_reason||p.archive_reason==='unrecorded');
  function bannerHtml(p){
    if(p.archived===true){
      const r=reasonOf(p.archive_reason),by=archivedBy(p),since=dateAr(p.archived_at);
      const line=['<strong>📦 مؤرشف'+(since?' منذ '+esc(since):'')+'</strong>',esc(r?r.label_ar:'السبب غير مسجل')];
      if(by)line.push('بواسطة '+esc(by));
      if(p.archive_source==='backfill')line.push('السبب انسجل لاحقاً');
      return '<p>'+line.join(' · ')+'</p>'+(p.archive_note?'<p class="cpa-banner-note" dir="auto">'+esc(p.archive_note)+'</p>':'')
        +(editor()?'<div class="cpa-banner-actions">'+(owner()&&needsReason(p)?'<button type="button" class="btn-primary" data-cpa-reason="'+esc(p.id)+'">حدد السبب</button>':'')+'<button type="button" class="btn-secondary" data-cpa-restore="'+esc(p.id)+'">استعادة كعقد جديد</button></div>':'');
    }
    const relisted=dateAr(p.relisted_at);
    return relisted?'<p>♻️ رجع من الأرشيف كعقد جديد في '+esc(relisted)+'</p>':'';
  }
  function renderBanner(p,page){
    let box=byId('cpaArchiveBanner');const html=bannerHtml(p);
    if(!html){if(box)box.remove();return;}
    if(!box){box=document.createElement('section');box.id='cpaArchiveBanner';box.setAttribute('aria-live','polite');}
    const header=page.querySelector(':scope>.page-header');
    if(header){if(box.previousElementSibling!==header)header.after(box);}else if(!box.isConnected)page.prepend(box);
    box.className='cpa-banner'+(p.archived===true?'':' cpa-relisted');
    if(box.dataset.sig!==html){box.innerHTML=html;box.dataset.sig=html;}
  }
  function patchDetail(){
    const p=window.viewingProperty,page=byId('page-propertyDetail');if(!p||!page)return;
    const text=statusText(p,true);
    if(text){
      const sub=byId('pdSub'),tail=' · '+(BASE_DETAIL[p.status]||p.status||'');
      if(sub&&sub.textContent.endsWith(tail))sub.textContent=sub.textContent.slice(0,sub.textContent.length-tail.length)+' · '+text;
      const content=byId('propertyDetailContent');
      if(content)for(const label of content.querySelectorAll('div')){
        if(label.querySelector('div')||label.textContent.replace(/^[^\p{L}]+/u,'').trim()!=='الحالة')continue;
        const value=label.nextElementSibling;if(value&&value.textContent!==text)value.textContent=text;break;
      }
    }
    // The edit form has no off-market statuses; an archived property changes only through restore.
    const edit=byId('pdEditBtn');if(edit&&p.archived===true)edit.style.display='none';
    renderBanner(p,page);
  }
  function refreshLabels(){try{patchList();patchDetail();}catch(e){console.warn('property archive labels',e);}}

  // ---- Dialog shell: native <dialog>, Escape and «إلغاء» close it unless a save is running -------
  let dialog=null;
  const ERROR_BOX='<p class="cpa-error" role="alert" data-cpa-error hidden></p>';
  const NOTE_FIELD='<label class="cpa-field"><span data-cpa-note-label>ملاحظة (اختياري)</span><textarea class="fta" name="note" rows="2" maxlength="500" dir="auto"></textarea></label>';
  const actions=label=>'<div class="cpa-actions"><button type="submit" class="btn-primary" data-cpa-submit>'+esc(label)+'</button><button type="button" class="btn-secondary" data-cpa-close>إلغاء</button></div>';
  // Removed at once (the native «close» event comes later), so a closed dialog is never found or reused.
  function shut(d){
    if(!d)return;
    if(typeof d.close==='function'&&d.open){try{d.close();}catch(_){}}
    if(dialog===d)dialog=null;
    d.remove();
  }
  function closeDialog(){if(dialog)shut(dialog);}
  function openDialog(title,body){
    closeDialog();
    const d=document.createElement('dialog');
    // ui-modal: the design system's type, buttons and fields (crm-design-v14.css), like the other CRM forms.
    d.className='cpa-dialog ui-modal';d.setAttribute('dir','rtl');d.setAttribute('aria-labelledby','cpaDialogTitle');
    d.innerHTML='<form class="cpa-form" novalidate><div class="cpa-head"><h3 id="cpaDialogTitle">'+esc(title)+'</h3><button type="button" class="cpa-x" data-cpa-close aria-label="إغلاق" title="إغلاق">×</button></div>'+body+'</form>';
    d.addEventListener('cancel',e=>{e.preventDefault();if(d.dataset.busy!=='1')shut(d);});
    d.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();if(d.dataset.busy!=='1')shut(d);}});
    d.addEventListener('close',()=>{if(dialog===d)dialog=null;d.remove();});
    d.addEventListener('click',e=>{if(e.target.closest('[data-cpa-close]')&&d.dataset.busy!=='1')shut(d);});
    document.body.append(d);dialog=d;
    if(typeof d.showModal==='function'){try{d.showModal();}catch(_){d.setAttribute('open','');}}else d.setAttribute('open','');
    return d;
  }
  function showError(d,text,focus){
    const box=d.querySelector('[data-cpa-error]');if(box){box.textContent=text||'';box.hidden=!text;}
    if(focus&&typeof focus.focus==='function')focus.focus();
  }
  function fail(ctx,text){if(ctx.dialog&&ctx.dialog.isConnected)showError(ctx.dialog,text);else toast(text,'error');}
  function busy(d,on){
    d.dataset.busy=on?'1':'';
    d.querySelectorAll('button,input,textarea').forEach(x=>{
      if(on){x.dataset.cpaWas=x.disabled?'1':'0';x.disabled=true;}
      else if(x.dataset.cpaWas){x.disabled=x.dataset.cpaWas==='1';delete x.dataset.cpaWas;}
    });
    const submit=d.querySelector('[data-cpa-submit]');if(!submit)return;
    if(on){submit.dataset.cpaLabel=submit.textContent;submit.textContent='جاري الحفظ…';}
    else if(submit.dataset.cpaLabel){submit.textContent=submit.dataset.cpaLabel;delete submit.dataset.cpaLabel;}
  }
  function markChoices(d){d.querySelectorAll('.cpa-choice').forEach(c=>{const i=c.querySelector('input');c.classList.toggle('is-on',!!(i&&i.checked));});}
  const picked=(d,name)=>{const i=d.querySelector('input[name="'+name+'"]:checked');return i?i.value:'';};
  function refreshAfter(id){
    const run=fn=>{try{const r=fn();if(r&&typeof r.catch==='function')r.catch(()=>{});}catch(_){}};
    if(typeof loadProperties==='function')run(()=>loadProperties());
    if(typeof loadDashboard==='function')run(()=>loadDashboard());
    const vp=window.viewingProperty,page=byId('page-propertyDetail');
    if(vp&&vp.id===id&&page&&page.classList.contains('active')&&typeof viewProperty==='function')run(()=>viewProperty(id));
  }
  async function findProperty(id){
    const list=typeof allProperties!=='undefined'&&Array.isArray(allProperties)?allProperties:[];
    const cached=list.find(p=>p&&p.id===id)||(window.viewingProperty&&window.viewingProperty.id===id?window.viewingProperty:null);
    if(cached)return cached;
    if(typeof crmDataFrom!=='function')return null;
    const r=await crmDataFrom('properties').select('*').eq('id',id).maybeSingle();
    if(r.error)throw r.error;return r.data||null;
  }

  // ---- Archive: «أرشفة العقار — ليش؟» --------------------------------------------------------------
  const afterText=(r,status)=>status==='sold'?'يبقى «مباع»':'يصير «'+(STATUS_AR[r.status_after]||'غير متاح')+'»';
  // The precheck says whether this caller may force (the owner); before it answers, the profile role decides.
  const canForce=ctx=>ctx.pre&&typeof ctx.pre.can_force==='boolean'?ctx.pre.can_force:owner();
  function renderReasons(ctx){
    const d=ctx.dialog,box=d&&d.querySelector('[data-cpa-reasons]');if(!box)return;
    const list=manualReasons(),chosen=picked(d,'reason');
    const sig=JSON.stringify([ctx.status,list.map(r=>[r.code,r.label_ar,r.status_after,r.note_required])]);
    if(box.dataset.sig!==sig){
      const focused=box.contains(document.activeElement);
      box.innerHTML=list.map(r=>'<label class="cpa-choice"><input type="radio" name="reason" value="'+esc(r.code)+'"'+(r.code===chosen?' checked':'')+'><span><strong>'+esc(r.label_ar)+'</strong><small>'+esc(afterText(r,ctx.status)+(r.note_required?' · يحتاج ملاحظة':''))+'</small></span></label>').join('')
        ||'<p class="cpa-block">ما وصلت قائمة الأسباب. حدّث الصفحة وحاول مرة ثانية</p>';
      box.dataset.sig=sig;
      if(focused){const back=box.querySelector('input[name="reason"]:checked')||box.querySelector('input[name="reason"]');if(back)back.focus();}
    }
    syncArchive(ctx);
  }
  function checksHtml(ctx){
    if(ctx.archivedAlready)return '<p class="cpa-block">العقار مؤرشف من قبل. حدّث القائمة</p>';
    const pre=ctx.pre||{},deals=Array.isArray(pre.open_deals)?pre.open_deals.filter(Boolean):[],visits=Math.max(0,Math.floor(Number(pre.upcoming_viewings)||0)),out=[];
    if(deals.length){
      const counts=new Map();deals.forEach(x=>{const k=stageLabel(x.stage);counts.set(k,(counts.get(k)||0)+1);});
      out.push('<p class="cpa-warn"><strong>صفقات مفتوحة على العقار: '+deals.length+'</strong><br>'+[...counts].map(([k,n])=>esc(k)+' ('+n+')').join(' · ')+'</p>');
    }
    if(ctx.active)out.push('<p class="cpa-block">'+(canForce(ctx)?'عليه صفقة شغالة (تفاوض أو حجز). إذا متأكد علّم «أعرف إن على العقار صفقة شغالة» تحت':STAFF_BLOCK)+'</p>');
    if(visits)out.push('<p class="cpa-warn">عليه '+visits+' '+(visits===1?'زيارة قادمة':'زيارات قادمة')+'. تأكد منها قبل الأرشفة</p>');
    if(!out.length)out.push('<p class="cpa-ok">ما عليه صفقات مفتوحة ولا زيارات قادمة</p>');
    return out.join('');
  }
  function syncArchive(ctx){
    const d=ctx.dialog;if(!d||!d.isConnected)return;
    const form=d.querySelector('form'),code=picked(d,'reason'),r=reasonOf(code);
    markChoices(d);
    const noteLabel=d.querySelector('[data-cpa-note-label]'),note=form.elements.namedItem('note');
    if(noteLabel)noteLabel.textContent=r&&r.note_required?'ملاحظة (مطلوبة لهذا السبب)':'ملاحظة (اختياري)';
    if(note){note.required=!!(r&&r.note_required);note.placeholder=code==='duplicate'?'اكتب أي سجل هو الأصل (اسم العقار أو كوده)':code==='other'?'اكتب السبب':'';}
    const hint=d.querySelector('[data-cpa-hint]'),lines=[];
    if(r&&r.status_after==='sold'&&ctx.status!=='sold')lines.push('العقار بيتسجل «مباع»، والعملاء اللي سألوا عنه يوصلهم إشعار «انحجزت / تحب تشوف خيارات ثانية ؟» بعد الموافقة');
    const deals=ctx.pre&&Array.isArray(ctx.pre.open_deals)?ctx.pre.open_deals:[];
    if(r&&deals.some(x=>x&&PRE_RESERVATION.includes(x.stage)))lines.push(code==='duplicate'?'سجل مكرر: الصفقات المفتوحة تبقى مثل ما هي':'الصفقات المفتوحة اللي ما فيها حجز أو عربون تتسكر تلقائياً بسبب «العقار أصبح غير متاح»');
    // Contract B spares only a buyer whose sale is recorded (a closed or commission_collected card): an open buyer card closes too.
    if(code==='sold_by_us'&&ctx.status!=='sold'&&deals.some(x=>x&&PRE_RESERVATION.includes(x.stage)))lines.push('إذا المشتري عنده صفقة مفتوحة، سجّل البيع عليها من «الصفقات» أول، وإلا بتنقفل مع الباقي بسبب «العقار أصبح غير متاح»');
    if(hint){hint.textContent=lines.join('\n');hint.hidden=!lines.length;}
    const forceBox=d.querySelector('[data-cpa-force]');if(forceBox)forceBox.hidden=!(ctx.active&&canForce(ctx));
    const force=form.elements.namedItem('force'),submit=d.querySelector('[data-cpa-submit]');
    if(submit&&d.dataset.busy!=='1')submit.disabled=!!ctx.archivedAlready||(ctx.active&&!canForce(ctx))||(ctx.active&&!(force&&force.checked));
  }
  async function runPrecheck(ctx){
    const d=ctx.dialog,box=d.querySelector('[data-cpa-checks]');
    try{
      const res=await supa.rpc('crm_property_archive_precheck',{p_property:ctx.id});
      if(!live(ctx.s)||!d.isConnected)return;
      if(res.error)throw res.error;
      const pre=res.data||{};
      if(pre.ok===false)throw new Error(outText(pre));
      const deals=Array.isArray(pre.open_deals)?pre.open_deals:[];
      ctx.pre=pre;if(pre.status)ctx.status=pre.status;
      ctx.active=pre.active_deal===true||deals.some(x=>x&&ACTIVE_STAGES.includes(x.stage))||ACTIVE_STATUSES.includes(pre.status);
      ctx.archivedAlready=!ctx.reasonOnly&&pre.archived===true;
      if(box)box.innerHTML=checksHtml(ctx);
    }catch(e){
      if(!live(ctx.s)||!d.isConnected)return;
      if(box)box.innerHTML='<p class="cpa-warn">ما قدرت أفحص الصفقات والزيارات ('+esc(friendly(errText(e)))+'). النظام بيفحصها مرة ثانية وقت الحفظ</p>';
    }
    renderReasons(ctx);
  }
  async function submitArchive(ctx){
    const d=ctx.dialog;if(!d||d.dataset.busy==='1')return;
    const form=d.querySelector('form'),code=picked(d,'reason'),r=reasonOf(code);
    const noteEl=form.elements.namedItem('note'),note=noteEl?String(noteEl.value||'').trim():'',forceEl=form.elements.namedItem('force');
    if(!r||r.manual_selectable!==true){showError(d,'اختر سبب الأرشفة',d.querySelector('input[name="reason"]'));return;}
    if(r.note_required&&!note){showError(d,'اكتب ملاحظة لهذا السبب',noteEl);return;}
    if(ctx.archivedAlready){showError(d,'العقار مؤرشف من قبل');return;}
    if(ctx.active&&!canForce(ctx)){showError(d,STAFF_BLOCK);return;}
    const force=!!(ctx.active&&canForce(ctx)&&forceEl&&forceEl.checked);
    if(ctx.active&&!force){showError(d,'علّم «أعرف إن على العقار صفقة شغالة» عشان تكمل',forceEl);return;}
    showError(d,'');busy(d,true);
    let done=false;
    try{
      const res=await supa.rpc('crm_archive_property',{p_property:ctx.id,p_reason:code,p_note:note||null,p_force:force});
      if(!live(ctx.s))return;
      if(res.error)throw res.error;
      const out=res.data||{};
      if(out.ok!==true){
        if(out.blocked==='active_deal'){
          // The server found an active deal the precheck did not show: show its deals and stop here.
          const pre=ctx.pre||{};
          ctx.pre=Object.assign({},pre,{active_deal:true,open_deals:Array.isArray(out.open_deals)?out.open_deals:pre.open_deals||[],upcoming_viewings:out.upcoming_viewings!=null?out.upcoming_viewings:pre.upcoming_viewings});
          ctx.active=true;if(out.status)ctx.status=out.status;
          const box=d.querySelector('[data-cpa-checks]');if(box)box.innerHTML=checksHtml(ctx);
          fail(ctx,canForce(ctx)?'على العقار صفقة شغالة. علّم «أعرف إن على العقار صفقة شغالة» إذا تبي تكمل':STAFF_BLOCK);return;
        }
        throw new Error(outText(out,'archive'));
      }
      done=true;shut(d);
      const label=out.label_ar||(reasonOf(out.archive_reason)||r).label_ar;
      toast((out.action==='reason_set'?'📦 العقار كان مؤرشف، وتحدّث سببه: ':'📦 انأرشف العقار: ')+label+(out.status_after==='sold'&&ctx.status!=='sold'?' · صار «مباع»':''),'success');
      refreshAfter(ctx.id);
    }catch(e){if(live(ctx.s))fail(ctx,'ما انحفظت الأرشفة: '+friendly(errText(e),'archive'));}
    finally{if(!done&&d.isConnected){busy(d,false);syncArchive(ctx);}}
  }
  async function openArchive(id,title,mode){
    const reasonOnly=mode==='reason';
    if(!editor()||(reasonOnly&&!owner())){toast(reasonOnly?'تحديد سبب الأرشفة للمالك بس':'ليس لديك صلاحية الأرشفة','error');return;}
    const s=snapshot();let p=null;
    try{p=await findProperty(id);}catch(e){if(live(s))toast('تعذر فتح العقار: '+errText(e),'error');return;}
    if(!live(s))return;
    if(!p){toast('العقار غير موجود. حدّث القائمة ثم حاول مرة ثانية','error');return;}
    if(reasonOnly&&!needsReason(p)){toast(p.archived===true?'سبب الأرشفة مسجل من قبل':'العقار مو في الأرشيف','info');return;}
    if(!reasonOnly&&p.archived===true){toast('العقار مؤرشف من قبل','info');return;}
    const ctx={id,s,status:p.status||'',active:false,archivedAlready:false,pre:null,reasonOnly};
    const d=ctx.dialog=openDialog(reasonOnly?'حدد سبب الأرشفة':'أرشفة العقار — ليش؟',
      '<p class="cpa-prop"><bdi>'+esc(p.title||title||'عقار')+'</bdi>'+(p.area?' · '+esc(p.area):'')+'</p>'
      +(reasonOnly?'<p class="cpa-note">العقار مؤرشف'+(dateAr(p.archived_at)?' من '+esc(dateAr(p.archived_at)):'')+' وسببه ما انسجل. اختر السبب، والحالة تتعدل حسبه (المباع يظل مباع)</p>':'')
      +'<div class="cpa-checks" data-cpa-checks aria-live="polite"><p class="cpa-note">جاري فحص الصفقات والزيارات…</p></div>'
      +'<fieldset class="cpa-reasons"><legend>السبب</legend><div class="cpa-list" data-cpa-reasons></div></fieldset>'
      +'<p class="cpa-hint" data-cpa-hint hidden></p>'+NOTE_FIELD
      +'<label class="cpa-check" data-cpa-force hidden><input type="checkbox" name="force"><span>أعرف إن على العقار صفقة شغالة</span></label>'
      +ERROR_BOX+actions(reasonOnly?'حفظ السبب':'أرشفة العقار'));
    d.querySelector('form').addEventListener('submit',e=>{e.preventDefault();submitArchive(ctx);});
    d.addEventListener('change',e=>{if(e.target&&(e.target.name==='reason'||e.target.name==='force')){showError(d,'');syncArchive(ctx);}});
    d.addEventListener('input',e=>{if(e.target&&e.target.name==='note')showError(d,'');});
    renderReasons(ctx);
    const first=d.querySelector('input[name="reason"]');if(first)first.focus();
    loadReasons().then(()=>{if(d.isConnected&&live(s))renderReasons(ctx);});
    runPrecheck(ctx);
  }

  // ---- Restore: «استعادة العقار كعقد جديد» -----------------------------------------------------------
  function readPrice(raw){
    if(typeof parseNum==='function')return parseNum(raw);
    const t=digits(raw).replace(/[\s,٬]/g,'').replace(/٫/g,'.');
    return /^\d+(?:\.\d+)?$/.test(t)?Number(t):null;
  }
  // start + months as Postgres adds them (the day is clamped to the month's last day), YYYY-MM-DD. crm_restore_property
  // refuses a new contract whose end is before today in Muscat (agreement_already_ended).
  function contractEnd(start,months){
    const [y,m,d]=start.split('-').map(Number),t=m-1+months,year=y+Math.floor(t/12),month=t%12;
    const last=new Date(Date.UTC(year,month+1,0)).getUTCDate();
    return String(year).padStart(4,'0')+'-'+String(month+1).padStart(2,'0')+'-'+String(Math.min(d,last)).padStart(2,'0');
  }
  function syncRestore(ctx){
    const d=ctx.dialog;if(!d||!d.isConnected)return;
    markChoices(d);
    const row=d.querySelector('[data-cpa-contract]');if(row)row.hidden=picked(d,'contract')!=='yes';
  }
  async function submitRestore(ctx){
    const d=ctx.dialog;if(!d||d.dataset.busy==='1')return;
    const form=d.querySelector('form'),field=n=>form.elements.namedItem(n),val=n=>{const el=field(n);return el?String(el.value||'').trim():'';};
    const note=val('note'),confirmEl=field('confirm');
    const payload={p_property:ctx.id,p_has_agreement:false,p_agreement_start:null,p_duration_months:null,p_price:null,p_note:note||null};
    if(!confirmEl||!confirmEl.checked){showError(d,'علّم «تأكدت من المالك إن العقار متاح» قبل الاستعادة',confirmEl);return;}
    if(picked(d,'contract')==='yes'){
      const start=val('start'),months=Number(digits(val('months')));
      if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||isNaN(new Date(start+'T12:00:00Z'))){showError(d,'حدد بداية عقد التسويق',field('start'));return;}
      if(!Number.isInteger(months)||months<1||months>60){showError(d,'مدة العقد من 1 إلى 60 شهر',field('months'));return;}
      const today=muscatToday();
      if(/^\d{4}-\d{2}-\d{2}$/.test(today)&&contractEnd(start,months)<today){showError(d,CODES.agreement_already_ended,field('start'));return;}
      Object.assign(payload,{p_has_agreement:true,p_agreement_start:start,p_duration_months:months});
    }
    const rawPrice=val('price');
    if(rawPrice){
      const price=readPrice(rawPrice);
      if(price==null||!(price>0)){showError(d,'اكتب السعر أرقام بس، مثل 65000',field('price'));return;}
      if(price!==ctx.price)payload.p_price=price;
    }
    showError(d,'');busy(d,true);
    let done=false;
    try{
      const res=await supa.rpc('crm_restore_property',payload);
      if(!live(ctx.s))return;
      if(res.error)throw res.error;
      const out=res.data||{};
      if(out.ok!==true)throw new Error(outText(out));
      done=true;shut(d);
      toast(out.status==='available'?'♻️ رجع العقار «متوفر» كعقد جديد · إشعار العقار الجديد ينتظر الموافقة':'♻️ تمت الاستعادة','success');
      refreshAfter(ctx.id);
    }catch(e){if(live(ctx.s))fail(ctx,'ما تمت الاستعادة: '+friendly(errText(e)));}
    finally{if(!done&&d.isConnected){busy(d,false);syncRestore(ctx);}}
  }
  async function openRestore(id,title){
    if(!editor()){toast('ليس لديك صلاحية الاستعادة','error');return;}
    const s=snapshot();let p=null;
    try{p=await findProperty(id);}catch(e){if(live(s))toast('تعذر فتح العقار: '+errText(e),'error');return;}
    if(!live(s))return;
    if(!p){toast('العقار غير موجود. حدّث القائمة ثم حاول مرة ثانية','error');return;}
    if(p.archived!==true){toast('العقار مو في الأرشيف','info');return;}
    const r=reasonOf(p.archive_reason),since=dateAr(p.archived_at);
    // A duplicate or test record relisted would be a second «متوفر» copy: ask for one more look first.
    const recheck=p.archive_reason==='duplicate'?'مو نسخة ثانية من عقار موجود':p.archive_reason==='test_record'?'عقار حقيقي ومو تجربة':'';
    const ctx={id,s,price:Number(p.price)>0?Number(p.price):null};
    // crm_restore_property always relists as «متوفر» (a new contract); it refuses a completed sale or a live reservation.
    const d=ctx.dialog=openDialog('استعادة العقار كعقد جديد',
      '<p class="cpa-prop"><bdi>'+esc(p.title||title||'عقار')+'</bdi>'+(p.area?' · '+esc(p.area):'')+'</p>'
      +'<p class="cpa-note">'+esc('📦 '+(r?r.label_ar:'السبب غير مسجل')+(since?' · من '+since:''))+'</p>'
      +(p.status==='sold'?'<p class="cpa-warn">العقار مسجل «مباع». الاستعادة ترجعه «متوفر» كعقد جديد، وإذا عليه صفقة بيع مكتملة ما تنقبل</p>':'')
      +(recheck?'<p class="cpa-warn">'+esc('انأرشف لأنه «'+(r?r.label_ar:'سجل مكرر أو تجريبي')+'». تأكد إنه '+recheck+' قبل ما ترجعه «متوفر»')+'</p>':'')
      +'<fieldset class="cpa-reasons"><legend>عقد التسويق</legend><div class="cpa-list">'
      +'<label class="cpa-choice"><input type="radio" name="contract" value="yes" checked><span><strong>عقد تسويق جديد</strong><small>يبدأ من اليوم، والمدة تقدر تغيرها</small></span></label>'
      +'<label class="cpa-choice"><input type="radio" name="contract" value="no"><span><strong>بدون عقد</strong><small>يرجع «متوفر» بدون مدة عقد</small></span></label></div></fieldset>'
      +'<div class="cpa-row" data-cpa-contract><label class="cpa-field"><span>بداية العقد</span><input class="fi" type="date" name="start" value="'+esc(muscatToday())+'"></label>'
      +'<label class="cpa-field"><span>المدة (شهور)</span><input class="fi" type="number" name="months" min="1" max="60" step="1" value="3" inputmode="numeric"></label></div>'
      +'<label class="cpa-field"><span>السعر (ر.ع)</span><input class="fi" type="text" name="price" inputmode="decimal" dir="ltr" autocomplete="off" value="'+esc(ctx.price==null?'':String(ctx.price))+'"></label>'
      +NOTE_FIELD
      +'<label class="cpa-check"><input type="checkbox" name="confirm"><span>تأكدت من المالك إن العقار متاح</span></label>'
      +'<p class="cpa-note">بعد الاستعادة يرجع العقار «متوفر» مثل إعلان جديد، وإشعار «عقار جديد» للعملاء المهتمين ينتظر الموافقة قبل ما ينرسل</p>'
      +ERROR_BOX+actions('استعادة كعقد جديد'));
    d.querySelector('form').addEventListener('submit',e=>{e.preventDefault();submitRestore(ctx);});
    d.addEventListener('change',()=>{showError(d,'');syncRestore(ctx);});
    syncRestore(ctx);
    const first=d.querySelector('input[name="contract"]:checked');if(first)first.focus();
  }

  // ---- Wiring --------------------------------------------------------------------------------------
  window.deleteProperty=function(id,title){openArchive(id,title).catch(e=>toast('تعذر فتح نافذة الأرشفة: '+errText(e),'error'));};
  window.restoreProperty=function(id,title){openRestore(id,title).catch(e=>toast('تعذر فتح نافذة الاستعادة: '+errText(e),'error'));};
  window.setArchiveReason=function(id,title){openArchive(id,title,'reason').catch(e=>toast('تعذر فتح نافذة السبب: '+errText(e),'error'));};
  const baseStatusAr=window.propStatusAr;
  if(typeof baseStatusAr==='function')window.propStatusAr=function(s){return s==='withdrawn'?'⚪ مسحوب':baseStatusAr.apply(this,arguments);};
  const baseRender=window.renderPropertyDetail;
  if(typeof baseRender==='function')window.renderPropertyDetail=function(){
    const result=baseRender.apply(this,arguments);
    refreshLabels();Promise.resolve(result).then(refreshLabels,()=>{});
    return result;
  };
  // The client's «عقارات العميل» tab (base loadClientListings) prints the raw status: withdrawn gets its Arabic label.
  function patchListings(){
    const box=byId('cdTabListings');if(!box)return;
    box.querySelectorAll('.listing-detail').forEach(n=>{const t=n.textContent;if(t.endsWith(' · withdrawn'))n.textContent=t.slice(0,t.length-'withdrawn'.length)+'⚪ '+STATUS_AR.withdrawn;});
  }
  const baseListings=window.loadClientListings;
  if(typeof baseListings==='function')window.loadClientListings=function(){
    const result=baseListings.apply(this,arguments);
    Promise.resolve(result).then(patchListings,()=>{});
    return result;
  };
  const baseReset=window.crmResetOperations;
  if(typeof baseReset==='function')window.crmResetOperations=function(){
    closeDialog();const banner=byId('cpaArchiveBanner');if(banner)banner.remove();reasonsTriedAt=0;
    return baseReset.apply(this,arguments);
  };
  document.addEventListener('click',e=>{
    const rb=e.target&&e.target.closest?e.target.closest('[data-cpa-reason]'):null;
    if(rb){e.preventDefault();const id=rb.getAttribute('data-cpa-reason'),p=window.viewingProperty;window.setArchiveReason(id,p&&p.id===id?p.title:'');return;}
    const b=e.target&&e.target.closest?e.target.closest('[data-cpa-restore]'):null;if(!b)return;
    e.preventDefault();const id=b.getAttribute('data-cpa-restore'),p=window.viewingProperty;
    window.restoreProperty(id,p&&p.id===id?p.title:'');
  });
  const listObserver=typeof MutationObserver==='function'?new MutationObserver(()=>{try{patchList();}catch(e){console.warn('property archive labels',e);}}):null;
  function watchList(){
    const list=byId('propertiesList');if(!list||!listObserver||list.dataset.cpaWatched)return;
    list.dataset.cpaWatched='1';listObserver.observe(list,{childList:true,subtree:true});refreshLabels();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',watchList);else watchList();
  window.CRMPropertyArchive=Object.freeze({statusText,reasonLabel:code=>{const r=reasonOf(code);return r?r.label_ar:'';}});
})();
