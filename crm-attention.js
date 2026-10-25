/* "Needs intervention" queue (SQL42). Shows, at the top of the dashboard, every
 * WhatsApp conversation the system could not attribute or handed to a person,
 * and lets staff classify it in one step. Every row opens the exact
 * conversation; access rules live in crm_attention_queue / crm_classify_inquiry. */
(function(){
  'use strict';
  const PAGE=8;
  const kinds=[
    {id:'property',label:'عقار محدد (أو أكثر) من العقارات المسجلة'},
    {id:'general',label:'طلب عام بدون عقار محدد'},
    {id:'unavailable',label:'عن عقار غير متاح (مباع أو محجوز)'},
    {id:'non_real_estate',label:'خارج العقارات (باحث عن عمل، مورد، ...)'},
    {id:'other',label:'أخرى (اكتب ملاحظة)'}
  ];
  const routes={barka:'بركاء',muscat:'مسقط',investment:'الاستثمار',general:'عام'};
  const errors={not_assigned:'هذه المحادثة ليست ضمن فرعك',invalid_property:'العقار غير متاح لفرعك',property_required:'اختر عقارًا واحدًا على الأقل',
    note_required:'اكتب ملاحظة توضح التصنيف',too_many_properties:'الحد الأقصى 10 عقارات',invalid_kind:'اختر نوع الاستفسار',
    conversation_has_no_client:'المحادثة غير مرتبطة بعميل بعد',no_inbound_message:'لا توجد رسالة واردة لربطها',properties_not_expected:'هذا التصنيف لا يحتاج اختيار عقار'};
  let state={page:0,data:null,session:'',loading:null},dialog=null,properties=null,propertiesSession='';
  const esc=s=>typeof escapeHtml==='function'?escapeHtml(s):String(s==null?'':s).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
  const sessionKey=()=>(typeof crmSessionGeneration==='undefined'?'':crmSessionGeneration)+':'+(typeof currentUser==='undefined'||!currentUser?'':currentUser.id);
  const ago=d=>typeof timeAgo==='function'?timeAgo(d):String(d||'');
  const toast=(m,t)=>{if(typeof showToast==='function')showToast(m,t);};
  function message(error){
    const raw=String(error&&(error.message||error.details)||error||'');
    for(const key of Object.keys(errors))if(raw.includes(key))return errors[key];
    return raw||'تعذر تنفيذ الطلب';
  }
  function host(){
    let box=document.getElementById('crmAttention');
    const page=document.getElementById('page-dash');
    if(!page)return null;
    if(!box){
      box=document.createElement('section');box.id='crmAttention';box.className='crm-attention card';box.setAttribute('aria-live','polite');
      const header=page.querySelector('.page-header');
      if(header)header.after(box);else page.prepend(box);
    }
    return box;
  }
  async function load(){
    const box=host();if(!box||typeof supa==='undefined'||typeof currentProfile==='undefined'||!currentProfile)return;
    const key=sessionKey();
    if(key!==state.session){state={page:0,data:null,session:key,loading:null};}
    if(!state.data)box.innerHTML='<div class="crm-attention-head"><h3>يحتاج تدخل بشري</h3></div><div class="crm-attention-muted">جارٍ التحميل…</div>';
    const request=supa.rpc('crm_attention_queue',{p_limit:PAGE,p_offset:state.page*PAGE});state.loading=request;
    const result=await request;
    if(state.loading!==request||key!==sessionKey())return;
    if(result.error){box.innerHTML='<div class="crm-attention-head"><h3>يحتاج تدخل بشري</h3></div><div class="crm-attention-muted">تعذر التحميل: '+esc(message(result.error))+' <button type="button" class="btn-secondary" data-attention="retry">إعادة المحاولة</button></div>';return;}
    state.data=result.data||{};render();
  }
  function chips(row){
    const out=[];
    if(row.handoff)out.push('<span class="crm-attention-chip urgent">'+esc(row.handoff_reason||'طلب تدخل')+'</span>');
    if(row.images)out.push('<span class="crm-attention-chip">'+row.images+' صورة</span>');
    if(row.links)out.push('<span class="crm-attention-chip">'+row.links+' رابط</span>');
    if(row.texts)out.push('<span class="crm-attention-chip">'+row.texts+' نص</span>');
    if(row.ai_suggestion&&Array.isArray(row.ai_suggestion.property_ids)&&row.ai_suggestion.property_ids.length)out.push('<span class="crm-attention-chip ai">اقتراح الذكاء الاصطناعي</span>');
    return out.join('');
  }
  const PREVIEW=3,EXPANDED_KEY='crmAttentionExpanded';
  function expanded(){try{return localStorage.getItem(EXPANDED_KEY)==='1';}catch(e){return false;}}
  function setExpanded(value){try{localStorage.setItem(EXPANDED_KEY,value?'1':'0');}catch(e){}}
  function render(){
    const box=host(),d=state.data;if(!box||!d)return;
    const total=Number(d.total_conversations||0),items=Array.isArray(d.items)?d.items:[];
    if(!total){box.innerHTML='<div class="crm-attention-head"><h3>يحتاج تدخل بشري</h3></div><div class="crm-attention-ok">✓ لا توجد محادثات تحتاج تدخلًا الآن.</div>';return;}
    // Collapsed by default to the newest few rows so the day's work stays visible below.
    const open=expanded(),shown=open?items:items.slice(0,PREVIEW);
    let h='<div class="crm-attention-head"><h3>يحتاج تدخل بشري <b dir="ltr">'+total.toLocaleString('en-US')+'</b>'
      +'<span class="crm-attention-help" title="محادثات لم يحدد النظام موضوعها أو طلبت موظفًا. افتح المحادثة ثم حدّد: عقار محدد، طلب عام، أو خارج العقارات." aria-label="شرح">؟</span>'
      +'<button type="button" class="crm-attention-toggle" data-attention="toggle" aria-expanded="'+open+'">'+(open?'إخفاء':'عرض الكل')+'</button></h3>'
      +(open?'<div class="crm-attention-summary"><span>'+Number(d.images||0)+' صورة</span><span>'+Number(d.links||0)+' رابط</span><span>'+Number(d.texts||0)+' نص</span><span>'+Number(d.handoff_conversations||0)+' طلب تدخل</span>'
      +(currentProfile.role==='owner'?'<button type="button" class="btn-secondary crm-attention-batch" data-attention="ai-batch">تحليل 5 محادثات بالذكاء الاصطناعي</button>':'')+'</div>':'')+'</div><ul class="crm-attention-list">';
    for(const row of shown){
      h+='<li class="crm-attention-row"><button type="button" class="crm-attention-main" data-attention="open" data-conversation="'+esc(row.conversation_id)+'">'
        +'<strong>'+esc(row.name)+'</strong><span class="crm-attention-route">'+esc(routes[row.route_key]||row.route_key||'')+'</span>'
        +'<span class="crm-attention-chips">'+chips(row)+'</span><span class="crm-attention-sample" dir="auto">'+esc(row.sample||'')+'</span>'
        +'<span class="crm-attention-time">'+esc(ago(row.latest_at))+'</span></button>'
        +'<div class="crm-attention-actions"><button type="button" class="crm-attention-link" data-attention="open" data-conversation="'+esc(row.conversation_id)+'">فتح المحادثة</button>'
        +'<button type="button" class="crm-attention-link primary" data-attention="classify" data-conversation="'+esc(row.conversation_id)+'">تحديد الاستفسار</button></div></li>';
    }
    h+='</ul>';
    if(open)h+='<div class="crm-attention-pager"><button type="button" class="btn-secondary" data-attention="prev"'+(state.page?'':' disabled')+'>السابق</button><span>'+(state.page*PAGE+1)+'–'+Math.min(total,(state.page+1)*PAGE)+' من '+total+'</span><button type="button" class="btn-secondary" data-attention="next"'+((state.page+1)*PAGE>=total?' disabled':'')+'>التالي</button></div>';
    else if(total>shown.length)h+='<button type="button" class="crm-attention-more" data-attention="toggle">عرض '+(total-shown.length).toLocaleString('en-US')+' محادثة أخرى</button>';
    box.innerHTML=h;
  }
  function openConversation(id){
    if(typeof openDashboardWhatsAppConversation==='function')openDashboardWhatsAppConversation(id);
    else{if(typeof navigate==='function')navigate('whatsapp',null);setTimeout(()=>{if(typeof openWhatsAppConversation==='function')openWhatsAppConversation(id);},220);}
  }
  async function loadProperties(){
    const key=sessionKey();
    if(properties&&propertiesSession===key)return properties;
    const r=await supa.from('crm_properties_access').select('id,title,area,price,bedrooms,status,branch_key,property_code').eq('company_id',currentProfile.company_id).neq('archived',true).order('area').limit(500);
    if(r.error)throw r.error;
    properties=r.data||[];propertiesSession=key;return properties;
  }
  function propertyLabel(p){
    const price=p.price!=null&&Number.isFinite(Number(p.price))?Number(p.price).toLocaleString('en-US')+' ر.ع':'';
    return [p.title||'عقار',p.area,price,p.bedrooms?p.bedrooms+' غرف':'',p.property_code].filter(Boolean).join(' · ');
  }
  const statusLabel={available:'متاح',reserved:'محجوز',sold:'مباع'};
  const aiKinds={property:'عقار محدد',general:'طلب عام',non_real_estate:'خارج العقارات',unavailable:'عقار غير متاح',unclear:'غير واضح'};
  function aiHtml(s){
    if(!s||!s.kind)return '<button type="button" class="btn-secondary" data-attention="ai">اقتراح بالذكاء الاصطناعي</button><small> يقرأ المحادثة والصور وردود الموظف ويقترح التصنيف؛ لا يربط شيئًا قبل حفظك.</small>';
    const pct=Math.round(Number(s.confidence||0)*100);
    return '<p class="crm-attention-ai"><strong>اقتراح الذكاء الاصطناعي: '+esc(aiKinds[s.kind]||s.kind)+'</strong> <span dir="ltr">'+pct+'%</span><br>'+esc(s.reason||'')+'</p>'
      +'<button type="button" class="btn-secondary" data-attention="ai">إعادة التحليل</button>';
  }
  // Applies a suggestion to the form only; staff still review and press save.
  function applySuggestion(s){
    if(!dialog||!s)return;
    const kind=s.kind==='unclear'?null:s.kind;
    if(kind){const radio=dialog.querySelector('input[name=crmAttentionKind][value="'+kind+'"]');if(radio){radio.checked=true;radio.dispatchEvent(new Event('change'));}}
    const ids=new Set(Array.isArray(s.property_ids)?s.property_ids:[]);
    dialog.querySelectorAll('#crmAttentionPropList input[type=checkbox]').forEach(x=>{if(ids.has(x.value))x.checked=true;});
  }
  async function suggest(conversationId,button){
    const box=dialog&&dialog.querySelector('#crmAttentionAi');if(!box)return;
    button.disabled=true;box.insertAdjacentHTML('beforeend','<small class="crm-attention-muted"> جارٍ التحليل… قد يستغرق 15 ثانية</small>');
    try{
      const r=await supa.functions.invoke('inquiry-ai-suggest',{body:{conversation_id:conversationId}});
      if(r.error)throw r.error;
      if(!r.data||r.data.ok!==true)throw new Error(r.data&&r.data.error||'تعذر التحليل');
      if(!dialog.open)return;
      box.innerHTML=aiHtml(r.data.suggestion);applySuggestion(r.data.suggestion);
      const row=(state.data&&state.data.items||[]).find(x=>x.conversation_id===conversationId);if(row)row.ai_suggestion=r.data.suggestion;
    }catch(error){box.innerHTML=aiHtml(null)+'<div class="crm-attention-error">'+esc(message(error))+'</div>';}
  }
  async function suggestBatch(button){
    button.disabled=true;const label=button.textContent;button.textContent='جارٍ تحليل 5 محادثات…';
    try{
      const r=await supa.functions.invoke('inquiry-ai-suggest',{body:{action:'batch',limit:5}});
      if(r.error)throw r.error;
      toast('تم تحليل '+Number(r.data&&r.data.processed||0)+' محادثات؛ افتح كل واحدة لتأكيد الاقتراح','success');
      state.data=null;await load();
    }catch(error){toast(message(error),'error');}
    finally{if(button.isConnected){button.disabled=false;button.textContent=label;}}
  }
  async function classify(conversationId){
    const row=(state.data&&state.data.items||[]).find(x=>x.conversation_id===conversationId)||{conversation_id:conversationId};
    if(!dialog){dialog=document.createElement('dialog');dialog.className='crm-attention-dialog';dialog.setAttribute('dir','rtl');document.body.append(dialog);
      dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});}
    const suggested=new Set(row.ai_suggestion&&Array.isArray(row.ai_suggestion.property_ids)?row.ai_suggestion.property_ids:[]);
    dialog.innerHTML='<div class="crm-attention-dialog-head"><h3>تحديد الاستفسار'+(row.name?' · '+esc(row.name):'')+'</h3><button type="button" class="btn-secondary" data-attention="close">إغلاق</button></div>'
      +'<div id="crmAttentionAi" class="crm-attention-ai-box">'+aiHtml(row.ai_suggestion)+'</div>'
      +'<fieldset class="crm-attention-kinds"><legend>عن ماذا يستفسر العميل؟</legend>'+kinds.map((k,i)=>'<label><input type="radio" name="crmAttentionKind" value="'+k.id+'"'+(i===0?' checked':'')+'> '+esc(k.label)+'</label>').join('')+'</fieldset>'
      +'<div class="crm-attention-props"><label class="fl" for="crmAttentionSearch">اختر العقار أو العقارات (يمكن اختيار أكثر من عقار)</label><input id="crmAttentionSearch" class="fi" type="search" placeholder="ابحث بالمنطقة أو السعر أو الاسم"><div id="crmAttentionPropList" class="crm-attention-proplist">جارٍ تحميل العقارات…</div></div>'
      +'<label class="fl" for="crmAttentionNote">ملاحظة (اختياري، وإلزامية في "أخرى")</label><textarea id="crmAttentionNote" class="fta" rows="2" maxlength="1000"></textarea>'
      +'<div id="crmAttentionError" class="crm-attention-error" role="alert"></div>'
      +'<div class="crm-attention-dialog-actions"><button type="button" class="btn-secondary" data-attention="open" data-conversation="'+esc(conversationId)+'">فتح المحادثة</button><button type="button" class="btn-primary" data-attention="save" data-conversation="'+esc(conversationId)+'">حفظ التصنيف</button></div>';
    if(!dialog.open)dialog.showModal();
    const list=dialog.querySelector('#crmAttentionPropList'),search=dialog.querySelector('#crmAttentionSearch');
    const sync=()=>{const kind=(dialog.querySelector('input[name=crmAttentionKind]:checked')||{}).value;dialog.querySelector('.crm-attention-props').hidden=!(kind==='property'||kind==='unavailable');};
    dialog.querySelectorAll('input[name=crmAttentionKind]').forEach(x=>x.addEventListener('change',sync));sync();
    try{
      const all=await loadProperties();
      const draw=()=>{
        const q=search.value.trim().toLowerCase();
        const picked=new Set([...list.querySelectorAll('input:checked')].map(x=>x.value));
        const rows=all.filter(p=>!q||propertyLabel(p).toLowerCase().includes(q)).sort((a,b)=>(suggested.has(b.id)-suggested.has(a.id))||((a.status==='available'?0:1)-(b.status==='available'?0:1)));
        list.innerHTML=rows.length?rows.map(p=>'<label class="crm-attention-prop"><input type="checkbox" value="'+esc(p.id)+'"'+(picked.has(p.id)||suggested.has(p.id)&&!q&&!picked.size?' checked':'')+'> <span>'+esc(propertyLabel(p))+'</span><small>'+esc(routes[p.branch_key]||p.branch_key||'')+(p.status&&p.status!=='available'?' · '+esc(statusLabel[p.status]||p.status):'')+(suggested.has(p.id)?' · مقترح':'')+'</small></label>').join(''):'<div class="crm-attention-muted">لا توجد نتائج.</div>';
      };
      search.addEventListener('input',draw);draw();
    }catch(error){list.textContent='تعذر تحميل العقارات: '+message(error);}
  }
  async function save(conversationId,button){
    const kind=(dialog.querySelector('input[name=crmAttentionKind]:checked')||{}).value;
    const ids=kind==='property'||kind==='unavailable'?[...dialog.querySelectorAll('#crmAttentionPropList input:checked')].map(x=>x.value):[];
    const note=dialog.querySelector('#crmAttentionNote').value.trim(),err=dialog.querySelector('#crmAttentionError');
    err.textContent='';
    if(kind==='property'&&!ids.length){err.textContent=errors.property_required;return;}
    if(kind==='other'&&!note){err.textContent=errors.note_required;return;}
    button.disabled=true;
    try{
      const r=await supa.rpc('crm_classify_inquiry',{p_conversation_id:conversationId,p_kind:kind,p_property_ids:ids.length?ids:null,p_note:note||null});
      if(r.error)throw r.error;
      if(!r.data||r.data.ok!==true)throw new Error('لم يتأكد الحفظ؛ حدّث الصفحة');
      dialog.close();
      toast(kind==='property'?'تم ربط المحادثة بـ '+ids.length+' عقار وتحديث الطلبات':'تم حفظ التصنيف','success');
      if(typeof waInboxActiveConversation!=='undefined'&&waInboxActiveConversation&&waInboxActiveConversation.id===conversationId&&r.data.handoff_cleared){waInboxActiveConversation.human_handoff_required=false;waInboxActiveConversation.handoff_reason=null;if(typeof renderWhatsAppChat==='function')renderWhatsAppChat(true);}
      state.data=null;load();
    }catch(error){err.textContent=message(error);}
    finally{button.disabled=false;}
  }
  document.addEventListener('click',event=>{
    const el=event.target.closest('[data-attention]');if(!el)return;
    const action=el.dataset.attention,id=el.dataset.conversation;
    if(action==='open'){if(dialog&&dialog.open)dialog.close();openConversation(id);}
    else if(action==='classify')classify(id);
    else if(action==='save')save(id,el);
    else if(action==='ai'){const s=dialog&&dialog.querySelector('[data-attention=save]');if(s)suggest(s.dataset.conversation,el);}
    else if(action==='ai-batch')suggestBatch(el);
    else if(action==='close'&&dialog)dialog.close();
    else if(action==='retry'){state.data=null;load();}
    else if(action==='toggle'){const open=!expanded();setExpanded(open);if(!open&&state.page){state.page=0;load();}else render();}
    else if(action==='prev'&&state.page>0){state.page--;load();}
    else if(action==='next'){state.page++;load();}
  });
  // The same classification is available from inside the open conversation.
  const render0=window.renderWhatsAppChat;
  if(typeof render0==='function')window.renderWhatsAppChat=function(){
    const result=render0.apply(this,arguments);
    const c=typeof waInboxActiveConversation==='undefined'?null:waInboxActiveConversation,head=document.getElementById('waChatHeader');
    if(c&&head&&!head.querySelector('[data-attention=classify]'))head.insertAdjacentHTML('beforeend','<button type="button" class="btn-secondary crm-attention-chat-btn" data-attention="classify" data-conversation="'+esc(c.id)+'">تحديد الاستفسار</button>');
    return result;
  };
  window.crmOpenInquiryClassifier=classify;
  window.crmReloadAttention=()=>{state.data=null;return load();};
  const loadDash=window.loadDashboard;
  if(typeof loadDash==='function')window.loadDashboard=function(){const result=loadDash.apply(this,arguments);load().catch(e=>console.warn('[attention]',e));return result;};
  const reset=window.crmResetOperations;
  if(typeof reset==='function')window.crmResetOperations=function(){state={page:0,data:null,session:'',loading:null};properties=null;const box=document.getElementById('crmAttention');if(box)box.replaceChildren();return reset.apply(this,arguments);};
})();
