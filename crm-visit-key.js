/* «الزيارة والمفتاح» (Ahmed, 14 Nov 2026): how the office gets into a property.
 * The property form gets one more section that reads and saves three columns that already exist on `properties`:
 * visit_method (open / lockbox / owner_lives / office), visit_instructions (free text, with the 🎤 of crm-voice-input.js)
 * and lockbox_image_url (a photo of the key box, uploaded the way the property photos are).
 * The property page shows the location link, the linked Instagram posts with their views, the state of the marketing
 * contract, and «حدد طريقة الزيارة» when the property is available and no visit method is recorded.
 *
 * Nothing existing is changed by opening a screen: the three columns are written only when the person changed them
 * in the form, after the property's own save went through. The columns are read from `properties` (row security
 * decides who sees the row); the view crm_properties_access does not carry them and no SQL was needed.
 * The instructions and the key box photo are internal: they are drawn only inside the signed-in CRM, for the accounts
 * that may edit a property, and never go into a message built for a customer. */
(function(){
  'use strict';
  const METHODS=[['open','مفتوح'],['lockbox','مفتاح في صندوق'],['owner_lives','المالك ساكن'],['office','عن طريق المكتب']];
  const METHOD_AR=Object.fromEntries(METHODS);
  const BUCKET='property-images',PUBLIC_MARK='/storage/v1/object/public/'+BUCKET+'/';
  const IMAGE_EXT={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'},MAX_BYTES=5*1024*1024;
  const WARN='حدد طريقة الزيارة';
  const byId=id=>document.getElementById(id);
  const toast=(m,t)=>{if(typeof showToast==='function')showToast(m,t);};
  const esc=s=>typeof escapeHtml==='function'?escapeHtml(s):String(s==null?'':s).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
  const httpsUrl=v=>{try{const u=new URL(String(v||''));return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch(_e){return '';}};
  const mayEdit=()=>typeof canEdit==='function'&&canEdit();
  const num=v=>Number(v).toLocaleString('en-US');
  const day=d=>typeof fmtDate==='function'?fmtDate(d):String(d||'').slice(0,10);

  // ---- the form section ----------------------------------------------------------------------------
  let state=null;      // what the database holds for the property in the form; null = not read, so nothing is written
  let pending=null;    // a photo chosen and not uploaded yet: {file, previewUrl}
  let removeImage=false,seq=0,focusOnOpen=false;

  function section(){
    let s=byId('pVisitKey');if(s)return s;
    const modal=byId('mProperty');if(!modal)return null;
    const all=modal.querySelectorAll('.form-section'),last=all[all.length-1];if(!last)return null;
    s=document.createElement('div');s.className='form-section';s.id='pVisitKey';
    s.innerHTML='<div class="form-section-title">🔑 الزيارة والمفتاح</div>'
      +'<div class="vk-warn" id="pVisitWarn" hidden>⚠️ '+WARN+'</div>'
      +'<div class="vk-note" id="pVisitNote" hidden></div>'
      +'<div class="fgrid">'
      +'<div class="fg full"><label class="fl" for="pVisitMethod">طريقة الزيارة</label><select class="fi" id="pVisitMethod"><option value="">ما تحددت</option>'
      +METHODS.map(m=>'<option value="'+m[0]+'">'+m[1]+'</option>').join('')+'</select></div>'
      +'<div class="fg full"><label class="fl" for="pVisitInstructions">تعليمات الزيارة</label><textarea class="fta" id="pVisitInstructions" rows="3" placeholder="مثال: المفتاح عند الحارس، اتصل بالمالك قبل الزيارة بساعة"></textarea>'
      +'<div class="vk-hint">معلومة داخلية للمكتب، ما تطلع في رسالة تفاصيل العقار للعميل.</div></div>'
      +'<div class="fg full"><label class="fl">📦 صورة صندوق المفتاح</label><div id="pLockboxWrap" class="vk-thumb"></div>'
      +'<input type="file" id="pLockboxFile" accept="image/jpeg,image/png,image/webp" style="display:none">'
      +'<div class="vk-row"><button type="button" class="btn-secondary" id="pLockboxPick">📷 اختر صورة</button>'
      +'<button type="button" class="btn-secondary" id="pLockboxRemove" hidden>إزالة الصورة</button></div>'
      +'<div class="vk-hint">صورة وحدة (JPG أو PNG أو WebP، أقصى شي 5MB). تنرفع لما تحفظ العقار.</div></div>'
      +'</div>';
    last.before(s);
    byId('pVisitMethod').addEventListener('change',paint);
    const status=byId('pStatus');if(status)status.addEventListener('change',paint);
    byId('pLockboxPick').addEventListener('click',()=>byId('pLockboxFile').click());
    byId('pLockboxFile').addEventListener('change',pick);
    byId('pLockboxRemove').addEventListener('click',()=>{dropPending();removeImage=true;paint();});
    return s;
  }
  function dropPending(){if(pending&&pending.previewUrl)URL.revokeObjectURL(pending.previewUrl);pending=null;}
  function pick(e){
    const file=(e.target.files||[])[0];e.target.value='';if(!file)return;
    if(!IMAGE_EXT[file.type]){toast('صيغة الصورة غير مدعومة: JPG أو PNG أو WebP','error');return;}
    if(file.size>MAX_BYTES){toast('الصورة أكبر من 5MB','error');return;}
    dropPending();pending={file,previewUrl:URL.createObjectURL(file)};removeImage=false;paint();
    toast('الصورة جاهزة؛ تنرفع لما تحفظ العقار','success');
  }
  function lock(on){['pVisitMethod','pVisitInstructions','pLockboxPick','pLockboxRemove'].forEach(id=>{const x=byId(id);if(x)x.disabled=!!on;});}
  function note(text){const n=byId('pVisitNote');if(n){n.textContent=text||'';n.hidden=!text;}}
  function paint(){
    if(!byId('pVisitKey'))return;
    const status=byId('pStatus'),method=byId('pVisitMethod').value;
    byId('pVisitWarn').hidden=!(state&&status&&status.value==='available'&&!method);
    const shown=pending?pending.previewUrl:(!removeImage&&state?httpsUrl(state.lockbox_image_url):'');
    const wrap=byId('pLockboxWrap');wrap.textContent='';
    if(shown){
      const img=document.createElement('img');img.src=shown;img.alt='صورة صندوق المفتاح';
      img.addEventListener('click',()=>{if(typeof openLightbox==='function')openLightbox([shown],0);});
      wrap.append(img);
    }else{const none=document.createElement('span');none.className='vk-hint';none.textContent='ما في صورة';wrap.append(none);}
    byId('pLockboxRemove').hidden=!shown;
  }
  async function load(id){
    const s=section();if(!s)return;
    const mine=++seq;state=null;dropPending();removeImage=false;note('');
    byId('pVisitMethod').value='';byId('pVisitInstructions').value='';
    if(!id){state={id:null,visit_method:null,visit_instructions:null,lockbox_image_url:null,images:null};lock(false);paint();opened();return;}
    lock(true);paint();
    const r=await supa.from('properties').select('id,visit_method,visit_instructions,lockbox_image_url,images').eq('id',id).maybeSingle();
    if(mine!==seq)return;
    if(r.error||!r.data){note('تعذر تحميل بيانات الزيارة لهذا العقار؛ ما راح يتغير فيها شي. سكّر النافذة وافتحها مرة ثانية.');paint();return;}
    state=r.data;
    byId('pVisitMethod').value=METHOD_AR[state.visit_method]?state.visit_method:'';
    byId('pVisitInstructions').value=state.visit_instructions||'';
    lock(false);paint();opened();
  }
  function opened(){
    const ta=byId('pVisitInstructions');if(ta&&typeof window.crmVoiceAttach==='function')window.crmVoiceAttach(ta);
    if(!focusOnOpen)return;focusOnOpen=false;
    const s=byId('pVisitKey');if(s&&s.scrollIntoView)s.scrollIntoView({block:'start'});
    const m=byId('pVisitMethod');if(m)m.focus();
  }

  // ---- saving, only what the person changed, only after the property itself was saved --------------
  function capture(){
    if(!state||!byId('pVisitKey'))return null;
    const method=byId('pVisitMethod').value||null,text=byId('pVisitInstructions').value.trim()||null,changes={};
    if(method!==(METHOD_AR[state.visit_method]?state.visit_method:null))changes.visit_method=method;
    if(text!==((state.visit_instructions||'').trim()||null))changes.visit_instructions=text;
    const file=pending?pending.file:null,remove=!file&&removeImage&&!!state.lockbox_image_url;
    if(!Object.keys(changes).length&&!file&&!remove)return null;
    let id=window.editingProperty||null;
    // a new property: the save takes its id from the draft id, so the same id is fixed here before it starts
    if(!id){try{if(!propertyDraftId)propertyDraftId=crmNewId();id=propertyDraftId;}catch(_e){id=null;}}
    return id?{id,changes,file,remove,old:state.lockbox_image_url||null,images:state.images}:null;
  }
  function ownPath(url,snap){
    // only a file of this property in the photos bucket, and never one of the property's own photos
    const i=String(url||'').indexOf(PUBLIC_MARK);if(i<0)return null;
    let path;try{path=decodeURIComponent(String(url).slice(i+PUBLIC_MARK.length).split('?')[0]);}catch(_e){return null;}
    if(path.split('/')[1]!==snap.id)return null;
    let photos=snap.images;try{if(typeof photos==='string')photos=JSON.parse(photos);}catch(_e){photos=[];}
    const used=(Array.isArray(photos)?photos:[]).some(x=>typeof x==='string'?x.includes(path):(x&&(x.path===path||String(x.url||'').includes(path))));
    return used?null:path;
  }
  async function persist(snap){
    let uploaded=null;
    try{
      const patch=Object.assign({},snap.changes);
      if(snap.file){
        const cid=await ensureCompany();
        const path=cid+'/'+snap.id+'/'+crmNewId()+'.'+IMAGE_EXT[snap.file.type];
        const up=await supa.storage.from(BUCKET).upload(path,snap.file,{contentType:snap.file.type,cacheControl:'3600',upsert:false});
        if(up.error)throw new Error('ما انرفعت صورة الصندوق: '+up.error.message);
        uploaded=path;
        const pub=supa.storage.from(BUCKET).getPublicUrl(path);
        patch.lockbox_image_url=httpsUrl(pub.data&&pub.data.publicUrl)||null;
        if(!patch.lockbox_image_url)throw new Error('رابط الصورة غير صالح');
      }else if(snap.remove)patch.lockbox_image_url=null;
      const r=await supa.from('properties').update(patch).eq('id',snap.id).select('id');
      if(r.error)throw r.error;
      if(!(r.data||[]).length)throw new Error('العقار ما انحفظ أو حسابك ما يقدر يعدله');
      uploaded=null;
      if('lockbox_image_url' in patch&&snap.old&&snap.old!==patch.lockbox_image_url){
        const gone=ownPath(snap.old,snap);
        if(gone)try{await supa.storage.from(BUCKET).remove([gone]);}catch(_e){}
      }
      toast('انحفظت بيانات الزيارة والمفتاح','success');
      if(window.viewingProperty&&window.viewingProperty.id===snap.id)detail();
    }catch(e){
      if(uploaded)try{await supa.storage.from(BUCKET).remove([uploaded]);}catch(_e){}
      toast('انحفظ العقار، لكن تعذر حفظ الزيارة والمفتاح: '+(e&&e.message||e),'error');
    }
  }

  // ---- the property page ---------------------------------------------------------------------------
  function contractText(p){
    if(!p.has_listing_agreement)return {text:'بدون عقد تسويق',tone:''};
    if(!p.agreement_end_date)return {text:'فيه عقد تسويق، بدون تاريخ نهاية',tone:'warn'};
    const today=new Date(Date.now()+4*3600000).toISOString().slice(0,10);   // the date in Muscat
    const left=Math.round((Date.parse(p.agreement_end_date)-Date.parse(today))/86400000);
    if(left<0)return {text:'منتهي من '+num(-left)+' يوم ('+day(p.agreement_end_date)+')',tone:'bad'};
    const soon=left<=Number(p.agreement_reminder_days||7);
    return {text:(soon?'قرب ينتهي: ':'ساري: ')+'باقي '+num(left)+' يوم، لين '+day(p.agreement_end_date),tone:soon?'warn':'ok'};
  }
  function field(label,html){return '<div><div class="vk-label">'+label+'</div><div class="vk-value" dir="auto">'+html+'</div></div>';}
  function draw(p,posts){
    const edit=mayEdit(),map=httpsUrl(p.map_url),contract=contractText(p);
    let h='<div class="card"><div class="card-head"><div class="card-title"><span>🔑</span>الزيارة واللوكيشن والتسويق</div></div><div class="vk-grid">';
    h+=field('🚪 طريقة الزيارة',METHOD_AR[p.visit_method]?esc(METHOD_AR[p.visit_method]):'<span class="vk-muted">ما تحددت</span>');
    h+=field('📍 اللوكيشن',map?'<a href="'+esc(map)+'" target="_blank" rel="noopener">فتح اللوكيشن ↗</a> <button type="button" class="btn-secondary vk-copy" data-vk-copy>📋 نسخ</button>':'<span class="vk-muted">ما في رابط لوكيشن</span>');
    h+=field('🤝 عقد التسويق','<span class="vk-tone '+contract.tone+'">'+esc(contract.text)+'</span>');
    h+='</div>';
    if(edit){
      const img=httpsUrl(p.lockbox_image_url);
      h+='<div class="vk-block"><div class="vk-label">📝 تعليمات الزيارة <span class="vk-muted">(داخلية للمكتب)</span></div><div class="vk-text" dir="auto">'+(p.visit_instructions?esc(p.visit_instructions):'<span class="vk-muted">ما في تعليمات</span>')+'</div></div>';
      if(img)h+='<div class="vk-block"><div class="vk-label">📦 صورة صندوق المفتاح <span class="vk-muted">(داخلية للمكتب)</span></div><img class="vk-lockbox" data-vk-img src="'+esc(img)+'" alt="صورة صندوق المفتاح"></div>';
    }
    h+='<div class="vk-block"><div class="vk-label">📱 روابط انستقرام المربوطة ('+num(posts.length)+')</div>';
    if(posts.length){
      const total=posts.reduce((a,m)=>a+(m.views!=null?Number(m.views)||0:0),0);
      h+='<div class="vk-posts">'+posts.map(m=>{
        const url=httpsUrl(m.url);
        return '<div class="vk-post">'+(url?'<a href="'+esc(url)+'" target="_blank" rel="noopener" dir="ltr">'+esc(url.replace(/^https:\/\/(www\.)?/,'').split('?')[0])+' ↗</a>':'<span class="vk-muted">رابط غير صالح</span>')
          +'<span>'+(m.views!=null?'👁 '+num(m.views)+' مشاهدة':'<span class="vk-muted">المشاهدات ما تزامنت</span>')+'</span>'
          +'<span class="vk-muted">'+esc(day(m.published_at||m.created_at))+'</span></div>';
      }).join('')+'</div>';
      if(posts.some(m=>m.views!=null))h+='<div class="vk-muted" style="margin-top:6px">المجموع: '+num(total)+' مشاهدة</div>';
    }else h+='<div class="vk-muted">ما في رابط انستقرام مربوط بهذا العقار</div>';
    h+='</div></div>';
    return h;
  }
  async function detail(){
    const p=window.viewingProperty,host=byId('propertyDetailContent');if(!p||!host)return;
    const id=p.id;
    const rr=await Promise.all([
      supa.from('properties').select('id,status,archived,visit_method,visit_instructions,lockbox_image_url,map_url,has_listing_agreement,agreement_end_date,agreement_reminder_days').eq('id',id).maybeSingle(),
      supa.from('property_marketing_events').select('id,url,views,published_at,created_at').eq('property_id',id).eq('channel','instagram').not('url','is',null).order('published_at',{ascending:false,nullsFirst:false}).limit(30)
    ]);
    if(!window.viewingProperty||window.viewingProperty.id!==id||!host.isConnected)return;
    if(rr[0].error||!rr[0].data)return;
    const row=rr[0].data,posts=rr[1].error?[]:(rr[1].data||[]);
    let warn=byId('pdVisitWarn'),box=byId('pdVisitKey');
    if(!warn||!host.contains(warn)){warn=document.createElement('div');warn.id='pdVisitWarn';host.prepend(warn);}
    if(!box||!host.contains(box)){
      box=document.createElement('div');box.id='pdVisitKey';
      const main=[...host.children].find(c=>c.classList&&c.classList.contains('card')&&(c.querySelector('.card-title')||{textContent:''}).textContent.includes('معلومات العقار'));
      if(main)main.after(box);else warn.after(box);
    }
    const missing=row.status==='available'&&row.archived!==true&&!METHOD_AR[row.visit_method];
    warn.hidden=!missing;
    warn.innerHTML=missing?'<div class="vk-warn vk-warn-page"><strong>⚠️ '+WARN+'</strong><span>العقار متوفر وما مكتوب كيف ندخله وقت الزيارة.</span>'+(mayEdit()?'<button type="button" class="btn-secondary" data-vk-set>حدد الآن</button>':'')+'</div>':'';
    box.innerHTML=draw(row,posts);
    const set=warn.querySelector('[data-vk-set]');if(set)set.addEventListener('click',()=>{focusOnOpen=true;if(typeof editProperty==='function')editProperty(id);});
    const copy=box.querySelector('[data-vk-copy]');if(copy)copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(httpsUrl(row.map_url));toast('انتسخ رابط اللوكيشن','success');}catch(_e){toast('تعذر النسخ','error');}});
    const img=box.querySelector('[data-vk-img]');if(img)img.addEventListener('click',()=>{if(typeof openLightbox==='function')openLightbox([img.src],0);});
  }

  // ---- wiring: each function is wrapped once ---------------------------------------------------------
  const done={edit:false,open:false,save:false,page:false};
  function hook(){
    if(!done.edit&&typeof window.editProperty==='function'){
      const orig=window.editProperty;done.edit=true;
      window.editProperty=async function(id){const out=await orig.apply(this,arguments);if(window.editingProperty===id)load(id);return out;};
    }
    if(!done.open&&typeof window.openModal==='function'){
      const orig=window.openModal;done.open=true;
      window.openModal=function(name){const out=orig.apply(this,arguments);if(name==='mProperty')load(window.editingProperty||null);return out;};
    }
    if(!done.save&&typeof window.saveProperty==='function'){
      const orig=window.saveProperty;done.save=true;
      window.saveProperty=async function(){
        const snap=capture();
        const out=await orig.apply(this,arguments);
        const modal=byId('mProperty');
        // the property's own save closes the window only when it went through
        if(snap&&modal&&!modal.classList.contains('on'))await persist(snap);
        return out;
      };
    }
    if(!done.page&&typeof window.renderPropertyDetail==='function'){
      const orig=window.renderPropertyDetail;done.page=true;
      window.renderPropertyDetail=function(){
        const out=orig.apply(this,arguments);
        Promise.resolve(out).then(()=>detail().catch(e=>console.warn('[visit-key]',e)),()=>{});
        return out;
      };
    }
    return done.edit&&done.open&&done.save&&done.page;
  }
  const st=document.createElement('style');
  st.textContent='.vk-warn{background:#FEF3C7;border:1px solid #F59E0B;color:#78350F;border-radius:10px;padding:10px 12px;margin-bottom:10px;font-weight:700}'
    +'.vk-warn-page{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:14px;font-weight:400}.vk-warn-page button{width:auto;margin-inline-start:auto}'
    +'.vk-note{background:#FEE2E2;border:1px solid #FCA5A5;color:#7F1D1D;border-radius:10px;padding:10px 12px;margin-bottom:10px}'
    +'.vk-hint{font-size:10px;color:var(--umber,#6b5b4b);margin-top:4px}.vk-row{display:flex;gap:8px;flex-wrap:wrap}.vk-row button{width:auto;padding:8px 16px}'
    +'.vk-thumb{margin-bottom:8px}.vk-thumb img,.vk-lockbox{max-height:160px;max-width:100%;border-radius:10px;object-fit:cover;cursor:zoom-in;display:block}'
    +'.vk-grid{padding:18px 18px 6px;display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px}.vk-block{padding:8px 18px 14px}'
    +'.vk-label{font-size:12px;color:var(--umber,#6b5b4b);margin-bottom:4px}.vk-value{font-size:15px;font-weight:600;color:var(--espresso,#2b2118)}'
    +'.vk-text{white-space:pre-wrap;line-height:1.8;color:var(--espresso,#2b2118)}.vk-muted{color:var(--umber,#6b5b4b);font-weight:400;font-size:12px}'
    +'.vk-copy{width:auto;padding:3px 10px;font-size:12px;margin-inline-start:6px}'
    +'.vk-tone.ok{color:#166534}.vk-tone.warn{color:#92400E}.vk-tone.bad{color:#B91C1C}'
    +'.vk-posts{display:grid;gap:6px}.vk-post{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;border-bottom:1px solid var(--cream-deeper,#eee);padding:6px 0}.vk-post a{overflow-wrap:anywhere}';
  document.head.append(st);
  if(!hook()){const timer=setInterval(()=>{if(hook())clearInterval(timer);},500);}
})();
