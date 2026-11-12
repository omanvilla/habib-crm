/* Price studies waiting for Ahmed's approval (SQL94, 11 Nov 2026). Claude (pricing projects) hands each study in through
 * crm_price_study_submit; this screen is the only place it is decided. Owner only: the list comes from
 * crm_price_studies_pending (owner-only RPC), the two reports open through short signed links from the private bucket
 * «price-studies» (owner-only storage policy), and owner net, commission and the internal report never go to the owner of the
 * property or to staff. «موافق» sends the message and the owner report from the chat's branch number (price-study edge
 * function); «رفض مع ملاحظة» returns the task to Claude with the note. A WhatsApp alert links here with ?study=<id>.
 * The home page shows the tile and the sheet (crm-owner-home.js asks this file for the count and the list). */
(function(){
  'use strict';
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
  const num=v=>v==null||v===''?'—':Number(v).toLocaleString('en-US');
  const isOwner=()=>typeof currentProfile!=='undefined'&&currentProfile&&currentProfile.role==='owner';
  const toast=(m,t)=>{if(typeof showToast==='function')showToast(m,t);};
  const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ROUTE={barka:'بركاء',muscat:'مسقط'};
  const when=v=>{try{return new Date(v).toLocaleString('ar-OM-u-nu-latn',{timeZone:'Asia/Muscat',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});}catch(_){return '';}};
  let data={items:[],send_mode:'test'},sequence=0,focusId=null;
  const waiting=()=>data.items.filter(i=>i.status==='awaiting_approval');
  const HOLD={test_mode_hold:'وافقت عليها. الإرسال للملاك في وضع التجربة، فما انرسلت. تنرسل لما يتفعّل الإرسال وتضغط «ارسل الحين»',
    sending_off:'وافقت عليها، والإرسال للملاك موقف',
    template_not_approved:'موافقتك انحفظت، بس ما انرسلت للحين: آخر رسالة من المالك أقدم من 24 ساعة، وقالب «دراسة سعر عقارك جاهزة» ما اعتمدته Meta. تنرسل لحالها أول ما يكتب المالك أو يعتمد القالب، وما تحتاج تضغط مرة ثانية',
    owner_said_no_to_the_template:'المالك رد «لا» على رسالة «دراسة سعر عقارك جاهزة»، فما انرسلت له'};
  const REACTION={accepted:'المالك وافق على السعر',price_rejected:'السعر ما ناسب المالك',counter_offer:'المالك طلب سعر ثاني'};

  async function refresh(){
    if(!isOwner()||typeof supa==='undefined'){data={items:[],send_mode:'test'};return 0;}
    const seq=++sequence;
    const r=await supa.rpc('crm_price_studies_pending');
    if(seq!==sequence)return waiting().length;
    if(!r.error&&r.data&&Array.isArray(r.data.items))data=r.data;
    document.dispatchEvent(new CustomEvent('crm-price-studies-updated'));
    loadInsp(data.items.map(i=>i.task_id)).catch(()=>{});
    return waiting().length;
  }

  /* «معاينة المكتب» (SQL96, 12 Nov 2026, Ahmed). On every study card whose task is still open and inside the «دراسة سعر»
   * task window: the date of the visit, his note (typed or dictated: crm-voice-input.js puts the 🎤 next to it) and up to
   * 20 photos from the phone. Owner only: the table and the photos under inspections/ in the private bucket have no staff
   * policy, and nothing here is ever sent to the owner of the property. Photos are made smaller on the phone and saved on
   * the inspection as soon as they are uploaded; the note and the date are saved by «حفظ المعاينة». Claude reads the
   * inspection through crm_price_study_inspection. «أعد الدراسة بعد المعاينة» is the existing rejection with the note
   * «معاينة المكتب», so the task returns to Claude's queue as rejected; it shows only while the study waits for approval. */
  const BUCKET='price-studies',MAX_PHOTOS=20,RESTUDY_NOTE='معاينة المكتب';
  const insp={},drafts={},thumbs={},busy={};
  const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Muscat'}).format(new Date());
  const saved=t=>insp[t]||{note:'',inspected_at:'',photos:[],exists:false};
  const newId=()=>crypto.randomUUID?crypto.randomUUID():'10000000-1000-4000-8000-100000000000'.replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16));
  const thumb=p=>thumbs[p]&&thumbs[p].exp>Date.now()?thumbs[p].url:'';
  const isDirty=t=>{const d=drafts[t],s=saved(t);return !!d&&((d.note!=null&&d.note.trim()!==(s.note||''))||(d.date!=null&&s.exists&&d.date!==s.inspected_at));};
  const inspBusy=el=>!!el.querySelector('textarea:focus,input:focus,.voice-btn.on,.voice-btn:disabled,.voice-keep');
  function inspHead(t){
    const s=saved(t);
    return '<strong>معاينة المكتب</strong>'+(s.exists?'<span class="cps-chip ok">انحفظت · معاينة <span dir="ltr">'+esc(s.inspected_at)+'</span></span>':'<span class="cps-chip">ما انسجلت معاينة</span>');
  }
  function inspPhotos(t){
    const s=saved(t),b=busy[t],room=MAX_PHOTOS-s.photos.length;
    return (s.photos.length?'<div class="cps-photos">'+s.photos.map(p=>'<span class="cps-ph"><button type="button" class="cps-ph-open" data-insp="open" data-path="'+esc(p)+'" aria-label="افتح الصورة">'
        +(thumb(p)?'<img src="'+esc(thumb(p))+'" alt="" loading="lazy">':'🖼')+'</button>'
        +'<button type="button" class="cps-ph-x" data-insp="del" data-task="'+esc(t)+'" data-path="'+esc(p)+'" aria-label="احذف الصورة">✕</button></span>').join('')+'</div>':'')
      +'<small class="cps-facts">الصور <b dir="ltr">'+s.photos.length+'</b> من 20'+(b?' · جاري رفع <b dir="ltr">'+Math.min(b.done+1,b.total)+'</b> من <b dir="ltr">'+b.total+'</b>…':'')+'</small>'
      +(b||room<=0?'':'<label class="btn-secondary cps-add"><input type="file" accept="image/*" multiple hidden data-insp-file="'+esc(t)+'">+ أضف صور</label>');
  }
  function inspHtml(t){
    const s=saved(t),d=drafts[t]||{},note=d.note!=null?d.note:(s.note||''),date=d.date!=null?d.date:(s.inspected_at||today());
    return '<div class="cps-insp-head" data-insp-head>'+inspHead(t)+'</div>'
      +'<p class="cps-private">لك فقط، ما يشوفها الموظف ولا المالك</p>'
      +'<label class="cps-label">تاريخ المعاينة<input class="fi" type="date" dir="ltr" data-insp-date="'+esc(t)+'" value="'+esc(date)+'" max="'+today()+'"></label>'
      +'<div class="cps-label"><span>ملاحظتك: اكتبها أو سجّلها بصوتك وتتحول كتابة</span>'
      +'<textarea class="fi" rows="4" dir="auto" maxlength="6000" aria-label="ملاحظة المعاينة" data-insp-note="'+esc(t)+'" placeholder="وش شفت في المعاينة: حالة البناء، الموقع، الشارع، وأي شي يأثر على السعر">'+esc(note)+'</textarea></div>'
      +'<div class="cps-insp-photos" data-insp-photos>'+inspPhotos(t)+'</div>'
      +'<small class="cps-unsaved" data-insp-dirty'+(isDirty(t)?'':' hidden')+'>في تعديل على الملاحظة أو التاريخ ما انحفظ</small>'
      +'<div class="cps-actions"><button type="button" class="btn-primary" data-insp="save" data-task="'+esc(t)+'">حفظ المعاينة</button></div>';
  }
  const inspBox=t=>'<div class="cps-insp" data-insp-box="'+esc(t)+'">'+inspHtml(t)+'</div>';
  // the note and the date are drawn again only when nobody is typing or recording there; the photos and the state always
  function drawInsp(t,whole){
    document.querySelectorAll('[data-insp-box="'+CSS.escape(t)+'"]').forEach(el=>{
      if(whole&&!inspBusy(el)){el.innerHTML=inspHtml(t);return;}
      const h=el.querySelector('[data-insp-head]'),p=el.querySelector('[data-insp-photos]'),d=el.querySelector('[data-insp-dirty]');
      if(h)h.innerHTML=inspHead(t);if(p)p.innerHTML=inspPhotos(t);if(d)d.hidden=!isDirty(t);
    });
  }
  async function signThumbs(paths){
    const need=paths.filter(p=>!thumb(p));if(!need.length)return;
    const s=await supa.storage.from(BUCKET).createSignedUrls(need,3600);
    (s.data||[]).forEach(x=>{if(x&&x.path&&x.signedUrl)thumbs[x.path]={url:x.signedUrl,exp:Date.now()+3300000};});
  }
  async function loadInsp(ids){
    ids=[...new Set((ids||[]).filter(x=>x&&ID.test(x)))];
    if(!ids.length||!isOwner()||typeof supa==='undefined')return;
    const r=await supa.from('owner_price_study_inspections').select('task_id,note,inspected_at,photos').in('task_id',ids);
    if(r.error)return;
    const got={};(r.data||[]).forEach(x=>{got[x.task_id]={note:x.note||'',inspected_at:x.inspected_at||'',photos:Array.isArray(x.photos)?x.photos:[],exists:true};});
    ids.forEach(t=>{if(!busy[t])insp[t]=got[t]||{note:'',inspected_at:'',photos:[],exists:false};});
    await signThumbs(ids.flatMap(t=>saved(t).photos)).catch(()=>{});
    ids.forEach(t=>drawInsp(t,true));
  }
  async function persist(t,ch){
    const s=saved(t);
    const r=await supa.rpc('crm_price_study_inspection_save',{p_task_id:t,p_note:ch.note!=null?ch.note:s.note,
      p_inspected_at:(ch.date!=null?ch.date:s.inspected_at)||today(),p_photos:ch.photos||s.photos});
    if(r.error||!r.data||!r.data.ok){toast('ما انحفظت المعاينة'+(r.error&&r.error.message?': '+r.error.message:'. جرب مرة ثانية'),'error');return false;}
    insp[t]=r.data.inspected?{note:r.data.note||'',inspected_at:r.data.inspected_at||'',photos:r.data.photos||[],exists:true}:{note:'',inspected_at:'',photos:[],exists:false};
    return true;
  }
  // phones send 3 to 12 MB photos; 1920 px JPEG is enough to judge a property and uploads in seconds
  async function shrink(file){
    try{
      let src,w,h,url=null;
      try{src=await createImageBitmap(file);w=src.width;h=src.height;}
      catch(_){url=URL.createObjectURL(file);src=new Image();src.src=url;await src.decode();w=src.naturalWidth;h=src.naturalHeight;}
      const k=Math.min(1,1920/Math.max(w,h)),c=document.createElement('canvas');c.width=Math.max(1,Math.round(w*k));c.height=Math.max(1,Math.round(h*k));
      c.getContext('2d').drawImage(src,0,0,c.width,c.height);if(src.close)src.close();if(url)URL.revokeObjectURL(url);
      const blob=await new Promise(res=>c.toBlob(res,'image/jpeg',0.82));
      if(blob&&blob.size)return {blob,ext:'jpg',type:'image/jpeg'};
    }catch(_){}
    const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[file.type];
    return ext&&file.size<=20*1024*1024?{blob:file,ext,type:file.type}:null;
  }
  async function addPhotos(t,files){
    const list=[...(files||[])];if(!list.length)return;
    if(busy[t]){toast('انتظر يكمل رفع الصور','error');return;}
    const room=MAX_PHOTOS-saved(t).photos.length,take=list.slice(0,Math.max(room,0));
    if(list.length>take.length)toast(take.length?'الحد 20 صورة. بضيف أول '+take.length+' بس':'وصلت الحد: 20 صورة','error');
    if(!take.length)return;
    busy[t]={total:take.length,done:0};drawInsp(t);
    const added=[];let failed=0;
    for(const f of take){
      try{
        const x=await shrink(f);if(!x)throw new Error('not_an_image');
        const path='inspections/'+t+'/'+newId()+'.'+x.ext;
        const up=await supa.storage.from(BUCKET).upload(path,x.blob,{contentType:x.type,upsert:false});
        if(up.error)throw up.error;
        added.push(path);thumbs[path]={url:URL.createObjectURL(x.blob),exp:Infinity};
      }catch(_){failed++;}
      busy[t].done++;drawInsp(t);
    }
    delete busy[t];
    // saved on the inspection at once (with the note as last saved), so photos are never left unlinked
    const box=document.querySelector('[data-insp-box="'+CSS.escape(t)+'"] [data-insp-date]');
    const ok=added.length?await persist(t,{photos:saved(t).photos.concat(added),date:box&&box.value||undefined}):false;
    if(added.length&&!ok)supa.storage.from(BUCKET).remove(added).catch(()=>{});
    drawInsp(t);
    if(ok)toast('انحفظت '+added.length+' صور في المعاينة'+(failed?'، و'+failed+' ما انرفعت. جرب ترفعها مرة ثانية':''),failed?'error':'success');
    else if(failed&&!added.length)toast('الصور ما انرفعت. تأكد من النت وجرب مرة ثانية','error');
  }
  async function delPhoto(b){
    const t=b.dataset.task,path=b.dataset.path;if(!t||!path||busy[t]||b.disabled)return;
    if(!confirm('تحذف هالصورة من المعاينة ؟'))return;
    b.disabled=true;
    if(await persist(t,{photos:saved(t).photos.filter(p=>p!==path)}))supa.storage.from(BUCKET).remove([path]).catch(()=>{});
    drawInsp(t);
  }
  async function saveInsp(b){
    const t=b.dataset.task,box=b.closest('[data-insp-box]');if(!t||!box||b.disabled)return;
    const note=String(box.querySelector('[data-insp-note]').value||'').trim(),date=box.querySelector('[data-insp-date]').value||today();
    if(!note&&!saved(t).photos.length&&!saved(t).exists){toast('اكتب ملاحظة المعاينة أو أضف صورة أول','error');box.querySelector('[data-insp-note]').focus();return;}
    b.disabled=true;const old=b.textContent;b.textContent='لحظة…';
    const ok=await persist(t,{note,date});
    b.disabled=false;b.textContent=old;
    if(!ok)return;
    delete drafts[t];drawInsp(t);
    toast(saved(t).exists?'انحفظت المعاينة':'انمسحت المعاينة','success');
  }
  async function restudy(b){
    const id=b.dataset.id,item=data.items.find(i=>i.id===id);if(!item||!item.task_id||b.disabled)return;
    const t=item.task_id,card=b.closest('[data-cps-card]'),noteEl=card&&card.querySelector('[data-insp-note]'),dateEl=card&&card.querySelector('[data-insp-date]');
    if(busy[t]){toast('انتظر يكمل رفع الصور','error');return;}
    const note=String(noteEl&&noteEl.value||'').trim(),date=dateEl&&dateEl.value||today(),s=saved(t);
    if(!note&&!s.photos.length){toast('اكتب ملاحظة المعاينة أو أضف صورها أول','error');if(noteEl)noteEl.focus();return;}
    b.disabled=true;const old=b.textContent;b.textContent='لحظة…';
    const back=()=>{b.disabled=false;b.textContent=old;};
    if(!s.exists||note!==(s.note||'')||date!==s.inspected_at){if(!(await persist(t,{note,date})))return back();delete drafts[t];}
    const r=await supa.rpc('crm_price_study_decide',{p_study_id:id,p_approve:false,p_note:RESTUDY_NOTE,p_owner_message:null});
    if(r.error){back();toast('ما رجعت: '+(r.error.message||''),'error');return;}
    toast('رجعت لـ Claude يدرسها من جديد على معاينتك','success');
    item.status='rejected';item.reject_note=RESTUDY_NOTE;
    redraw(true);document.dispatchEvent(new CustomEvent('crm-price-studies-updated'));
  }
  document.addEventListener('input',e=>{
    const el=e.target&&e.target.closest?e.target.closest('[data-insp-note],[data-insp-date]'):null;if(!el)return;
    const t=el.getAttribute('data-insp-note')||el.getAttribute('data-insp-date'),d=drafts[t]||(drafts[t]={});
    if(el.hasAttribute('data-insp-note'))d.note=el.value;else d.date=el.value;
    const hint=el.closest('[data-insp-box]')&&el.closest('[data-insp-box]').querySelector('[data-insp-dirty]');if(hint)hint.hidden=!isDirty(t);
  });
  document.addEventListener('change',e=>{
    const f=e.target&&e.target.matches&&e.target.matches('input[data-insp-file]')?e.target:null;if(!f)return;
    const t=f.getAttribute('data-insp-file'),files=[...f.files];f.value='';
    addPhotos(t,files).catch(()=>{delete busy[t];drawInsp(t);toast('الصور ما انرفعت. جرب مرة ثانية','error');});
  });
  // the same box inside the «دراسة سعر» task itself (its details window and its edit window), owner only
  function taskSlot(kind){
    let el=document.getElementById(kind==='edit'?'tInspection':'tdInspection');if(el)return el;
    const at=kind==='edit'?(document.getElementById('tNotes')&&document.getElementById('tNotes').closest('.fg')):document.getElementById('taskDetailsBody');
    if(!at)return null;
    el=document.createElement('div');el.id=kind==='edit'?'tInspection':'tdInspection';el.className=(kind==='edit'?'fg full ':'')+'cps-task';el.hidden=true;at.after(el);
    return el;
  }
  function syncTask(kind){
    const modal=document.getElementById(kind==='edit'?'mTask':'mTaskDetails'),el=taskSlot(kind);if(!modal||!el)return;
    const seen=window.viewingTaskDetails&&window.viewingTaskDetails.task||{};
    const id=String(kind==='edit'?(window.editingTask||''):(seen.id||'')),title=String(kind==='edit'?((document.getElementById('tTitle')||{}).value||''):(seen.title||''));
    if(!(modal.classList.contains('on')&&isOwner()&&ID.test(id)&&/^دراسة سعر/.test(title))){el.hidden=true;el.innerHTML='';delete el.dataset.task;return;}
    if(el.dataset.task===id&&!el.hidden)return;
    el.dataset.task=id;el.hidden=false;el.innerHTML=inspBox(id);
    loadInsp([id]).catch(()=>{});
  }
  function watchTasks(){
    ['edit','details'].forEach(kind=>{
      const modal=document.getElementById(kind==='edit'?'mTask':'mTaskDetails');if(!modal||modal.dataset.cpsWatch)return;
      modal.dataset.cpsWatch='1';new MutationObserver(()=>syncTask(kind)).observe(modal,{attributes:true,attributeFilter:['class']});
    });
  }
  watchTasks();document.addEventListener('DOMContentLoaded',watchTasks);
  function statusLine(i){
    if(i.status==='awaiting_approval')return '<span class="cps-chip wait">تنتظر موافقتك</span>';
    if(i.status==='approved')return '<span class="cps-chip hold">موافق عليها، ما انرسلت</span>';
    if(i.status==='sending')return '<span class="cps-chip">جاري الإرسال للمالك…</span>';
    if(i.status==='waiting_owner')return '<span class="cps-chip">انرسلت له «دراسة سعر عقارك جاهزة»، وتنرسل الدراسة أول ما يرد</span>';
    if(i.status==='send_failed')return '<span class="cps-chip bad">ما انرسلت</span>';
    if(i.status==='sent')return '<span class="cps-chip ok">انرسلت للمالك '+esc(when(i.sent_at))+'</span>';
    if(i.status==='rejected')return '<span class="cps-chip">رجعت لـ Claude بملاحظتك</span>';
    return '';
  }
  function card(i){
    const id=esc(i.id),open=i.status==='awaiting_approval',retry=i.status==='approved'||i.status==='send_failed';
    const place=[i.area,i.wilayat].filter(Boolean).join(' ، ');
    const facts=[i.property_kind,place,i.land_size?'أرض '+num(i.land_size)+' م²':'',i.built_size?'بناء '+num(i.built_size)+' م²':'',i.plot_no?'قطعة '+esc(i.plot_no):''].filter(Boolean).join(' · ');
    const cell=(l,v,priv)=>'<div class="cps-num'+(priv?' priv':'')+'"><strong dir="ltr">'+num(v)+'</strong><small>'+esc(l)+'</small></div>';
    const note=i.status==='send_failed'?(HOLD[i.send_error]||('السبب: '+(i.send_error||'غير معروف')))
      :i.status==='approved'?(HOLD[i.send_error]||'وافقت عليها والإرسال في الطريق')
      :i.status==='rejected'?('ملاحظتك: '+(i.reject_note||''))
      :i.status==='sent'&&i.owner_reaction?(REACTION[i.owner_reaction]+(i.owner_reaction_note?': «'+i.owner_reaction_note+'»':'')):'';
    return '<li class="cps-card'+(focusId===i.id?' focus':'')+'" data-cps-card="'+id+'">'
      +'<div class="cps-head"><strong>'+esc(i.owner_name||'مالك')+' <small>'+esc(ROUTE[i.route_key]||'')+(i.version>1?' · نسخة '+esc(i.version):'')+'</small></strong>'+statusLine(i)+'</div>'
      +(facts?'<small class="cps-facts">'+esc(facts)+'</small>':'')
      +'<small class="cps-facts">السعر اللي في بال المالك: <b dir="ltr">'+num(i.owner_price)+'</b></small>'
      +(note?'<p class="cps-note">'+esc(note)+'</p>':'')
      +'<div class="cps-nums">'+cell('القيمة السوقية',i.market_value)+cell('سعر العرض',i.asking_price)+cell('هامش التفاوض',i.negotiation_margin)+'</div>'
      +'<p class="cps-private">لك فقط، ما يوصل للمالك ولا يشوفه الموظف</p>'
      +'<div class="cps-nums">'+cell('صافي المالك',i.owner_net,true)+cell('العمولة',i.commission,true)+'</div>'
      +'<div class="cps-files"><button type="button" class="btn-secondary" data-cps="file" data-path="'+esc(i.owner_report_path||'')+'">تقرير المالك PDF</button>'
      +'<button type="button" class="btn-secondary" data-cps="file" data-path="'+esc(i.internal_report_path||'')+'">التقرير الداخلي PDF</button>'
      +(typeof window.crmWaButtons==='function'?window.crmWaButtons({phone:i.phone,conversationId:i.conversation_id,clientId:i.client_id,cls:'btn-secondary'}):'')+'</div>'
      // SQL96: the office inspection, while the task is still open (nothing left to study once the owner has the study)
      +(i.task_id&&!['sent','sending','waiting_owner'].includes(i.status)?inspBox(i.task_id)
        +(open?'<div class="cps-restudy"><button type="button" class="btn-secondary" data-cps="restudy" data-id="'+id+'">أعد الدراسة بعد المعاينة</button>'
          +'<small class="cps-facts">يحفظ المعاينة ويرجّع الدراسة لـ Claude بملاحظة «معاينة المكتب» عشان يدرسها من جديد</small></div>':''):'')
      +'<label class="cps-label">الرسالة اللي توصل المالك'+(open?' (تقدر تعدلها)':'')
      +'<textarea class="fi" rows="6" dir="auto" data-cps-msg="'+id+'"'+(open?'':' readonly')+'>'+esc(i.owner_message||'')+'</textarea></label>'
      +(open?'<div class="cps-actions"><button type="button" class="btn-primary" data-cps="approve" data-id="'+id+'">موافق</button>'
        +'<button type="button" class="btn-secondary" data-cps="reject" data-id="'+id+'">رفض مع ملاحظة</button></div>'
        +'<div class="cps-reject" data-cps-reject="'+id+'" hidden><textarea class="fi" rows="3" dir="auto" data-cps-note="'+id+'" placeholder="اكتب ملاحظتك لـ Claude: وش يعدل في الدراسة"></textarea>'
        +'<button type="button" class="btn-primary" data-cps="reject-send" data-id="'+id+'">رجّعها لـ Claude</button></div>':'')
      +(retry?'<div class="cps-actions"><button type="button" class="btn-primary" data-cps="approve" data-id="'+id+'">ارسل الحين</button>'
        +'<button type="button" class="btn-secondary" data-cps="reject" data-id="'+id+'">رفض مع ملاحظة</button></div>'
        +'<div class="cps-reject" data-cps-reject="'+id+'" hidden><textarea class="fi" rows="3" dir="auto" data-cps-note="'+id+'" placeholder="اكتب ملاحظتك لـ Claude: وش يعدل في الدراسة"></textarea>'
        +'<button type="button" class="btn-primary" data-cps="reject-send" data-id="'+id+'">رجّعها لـ Claude</button></div>':'')
      +'</li>';
  }
  function html(){
    if(!data.items.length)return '<p class="coh-empty">ما في دراسات تنتظر موافقتك الحين</p>';
    const mode=data.send_mode==='live'?'':'<p class="cps-mode">'+(data.send_mode==='off'?'الإرسال للملاك موقف. الموافقة تنحفظ وما ينرسل شي'
      :'وضع التجربة: الموافقة تنحفظ، والإرسال يوصل رقمك التجريبي بس. الملاك ما يوصلهم شي لين يتفعّل الإرسال')+'</p>';
    return mode+'<p class="coh-since">راجع الأرقام والتقريرين. «موافق» يرسل الرسالة وتقرير المالك من رقم الفرع ويقفل المهمة. ما ينرسل شي قبل موافقتك</p>'
      +'<ul class="coh-list cps-list">'+data.items.map(card).join('')+'</ul>';
  }
  // 12 Nov 2026: the list is not drawn again under his hands (typing, recording, a kept recording, photos uploading), and a
  // rejection note or an edited message he has not sent yet survives a new draw
  const sheetBusy=body=>inspBusy(body)||Object.keys(busy).length>0;
  function paint(body){
    const notes={},msgs={};
    body.querySelectorAll('textarea[data-cps-note]').forEach(x=>{if(x.value.trim())notes[x.dataset.cpsNote]=x.value;});
    body.querySelectorAll('textarea[data-cps-msg]:not([readonly])').forEach(x=>{msgs[x.dataset.cpsMsg]=x.value;});
    body.innerHTML=html();
    Object.keys(notes).forEach(id=>{const x=body.querySelector('textarea[data-cps-note="'+CSS.escape(id)+'"]');if(x){x.value=notes[id];const f=x.closest('[data-cps-reject]');if(f)f.hidden=false;}});
    Object.keys(msgs).forEach(id=>{const x=body.querySelector('textarea[data-cps-msg="'+CSS.escape(id)+'"]:not([readonly])');if(x)x.value=msgs[id];});
  }
  function redraw(force){
    const body=document.getElementById('cohSheetBody');
    if(body&&body.dataset.cps==='1'&&(force||!sheetBusy(body)))paint(body);
  }
  // a signed link that lasts ten minutes; the tab is opened at once so phones do not block it as a pop-up
  async function openFile(path){
    if(!path){toast('الملف ما انحفظ','error');return;}
    const w=window.open('about:blank','_blank');
    const r=await supa.storage.from('price-studies').createSignedUrl(path,600);
    const url=r&&r.data&&r.data.signedUrl;
    if(!url){if(w)w.close();toast('ما قدرت أفتح الملف. جرب مرة ثانية','error');return;}
    if(w)w.location.href=url;else location.href=url;
  }
  async function decide(b,approve){
    const id=b.dataset.id,item=data.items.find(i=>i.id===id);if(!item||b.disabled)return;
    const msg=document.querySelector('[data-cps-msg="'+CSS.escape(id)+'"]'),note=document.querySelector('[data-cps-note="'+CSS.escape(id)+'"]');
    const args={p_study_id:id,p_approve:approve,p_note:null,p_owner_message:null};
    if(approve){
      const text=String(msg&&msg.value||'').trim();
      if(item.status==='awaiting_approval'&&text&&text!==String(item.owner_message||'').trim())args.p_owner_message=text;
    }else{
      args.p_note=String(note&&note.value||'').trim();
      if(args.p_note.length<3){toast('اكتب ملاحظتك لـ Claude أول','error');if(note)note.focus();return;}
    }
    b.disabled=true;const old=b.textContent;b.textContent='لحظة…';
    const r=await supa.rpc('crm_price_study_decide',args);
    if(r.error){b.disabled=false;b.textContent=old;toast('ما انحفظ: '+(r.error.message||''),'error');return;}
    toast(approve?'موافقتك انحفظت. لحظة أتأكد من الإرسال…':'رجعت لـ Claude مع ملاحظتك','success');
    item.status=approve?'approved':'rejected';if(!approve)item.reject_note=args.p_note;if(approve)item.send_error=null;
    if(!approve&&note)note.value='';
    redraw(true);document.dispatchEvent(new CustomEvent('crm-price-studies-updated'));
    // the send runs in the background: read where it ended
    // SQL95 (Ahmed's test, 11 Nov): he pressed «موافق» three times because nothing said the send was held. Say why, once.
    if(approve){
      const tell=()=>{const now=data.items.find(i=>i.id===id);
        if(now&&now.status==='approved'&&now.send_error)toast(HOLD[now.send_error]||('ما انرسلت: '+now.send_error),'error');
        else if(now&&now.status==='send_failed')toast('ما انرسلت: '+(HOLD[now.send_error]||now.send_error||''),'error');
        else if(now&&now.status==='sent')toast('انرسلت الدراسة للمالك ✓','success');
        else if(now&&now.status==='waiting_owner')toast('انرسل له «دراسة سعر عقارك جاهزة»، والدراسة تنرسل أول ما يرد','success');};
      setTimeout(()=>refresh().then(()=>{redraw();tell();}),6000);setTimeout(()=>refresh().then(redraw),20000);
    }
  }
  document.addEventListener('click',e=>{
    const b=e.target.closest&&e.target.closest('[data-cps]');if(!b)return;
    const act=b.dataset.cps;
    if(act==='file')openFile(b.dataset.path).catch(()=>toast('ما قدرت أفتح الملف','error'));
    else if(act==='approve')decide(b,true).catch(()=>{b.disabled=false;toast('ما انحفظ. جرب مرة ثانية','error');});
    else if(act==='reject'){const f=document.querySelector('[data-cps-reject="'+CSS.escape(b.dataset.id)+'"]');if(f){f.hidden=!f.hidden;if(!f.hidden){const t=f.querySelector('textarea');if(t)t.focus();}}}
    else if(act==='reject-send')decide(b,false).catch(()=>{b.disabled=false;toast('ما انحفظ. جرب مرة ثانية','error');});
    else if(act==='restudy')restudy(b).catch(()=>{b.disabled=false;b.textContent='أعد الدراسة بعد المعاينة';toast('ما رجعت. جرب مرة ثانية','error');});
  });
  document.addEventListener('click',e=>{
    const b=e.target.closest&&e.target.closest('[data-insp]');if(!b)return;
    const act=b.dataset.insp;
    if(act==='save')saveInsp(b).catch(()=>{b.disabled=false;b.textContent='حفظ المعاينة';toast('ما انحفظت المعاينة. جرب مرة ثانية','error');});
    else if(act==='del')delPhoto(b).catch(()=>{b.disabled=false;toast('ما انحذفت الصورة. جرب مرة ثانية','error');});
    else if(act==='open'){const u=thumb(b.dataset.path);if(u)window.open(u,'_blank');else signThumbs([b.dataset.path]).then(()=>{const again=thumb(b.dataset.path);if(again)location.href=again;else toast('ما قدرت أفتح الصورة','error');}).catch(()=>toast('ما قدرت أفتح الصورة','error'));}
  });
  document.addEventListener('crm-price-studies-updated',()=>redraw());

  window.crmPriceStudiesCount=()=>isOwner()?waiting().length:0;
  window.crmPriceStudiesRefresh=refresh;
  window.crmPriceStudiesHtml=()=>{const body=document.getElementById('cohSheetBody');if(body)body.dataset.cps='1';return html();};
  // the home page draws the sheet through this, so a new draw never lands on a note being written or recorded
  window.crmPriceStudiesDraw=body=>{if(!body)return;body.dataset.cps='1';if(!body.firstChild)body.innerHTML=html();else if(!sheetBusy(body))paint(body);};
  window.crmPriceStudiesLeave=()=>{const body=document.getElementById('cohSheetBody');if(body)delete body.dataset.cps;};

  // Deep link from the WhatsApp alert: ?study=<id> opens the list on that study once the owner is signed in.
  (function(){
    const KEY='crm_open_study';let id=null;
    try{const q=new URLSearchParams(location.search);id=q.get('study');
      if(id&&ID.test(id)){sessionStorage.setItem(KEY,id);q.delete('study');history.replaceState(null,'',location.pathname+(q.toString()?'?'+q.toString():'')+location.hash);}
      else id=sessionStorage.getItem(KEY);}catch(_){}
    if(!id||!ID.test(id))return;
    let tries=0;const timer=setInterval(()=>{
      tries++;
      const ready=typeof currentProfile!=='undefined'&&currentProfile&&currentProfile.company_id;
      if(ready&&typeof window.crmOwnerHomeOpenSheet==='function'){
        clearInterval(timer);try{sessionStorage.removeItem(KEY);}catch(_){}
        if(!isOwner())return;
        focusId=id;
        refresh().then(()=>{window.crmOwnerHomeOpenSheet('studies');const c=document.querySelector('[data-cps-card="'+CSS.escape(id)+'"]');if(c&&c.scrollIntoView)c.scrollIntoView({block:'start'});});
      }else if(tries>1200)clearInterval(timer);
    },500);
  })();
})();
