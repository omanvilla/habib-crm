/* Quick visit result (1 November 2026). After a visit, staff record the outcome in a few taps,
 * mainly on the phone: did it happen, what the client thought, when to follow up, and a note.
 * Saving goes through the same crm_save_viewing_atomic RPC as the full visit form, so the deal
 * stage, client request, property inquiry and follow-up task update exactly as before.
 * - Dashboard card "زيارات اليوم": today's and overdue scheduled visits with "سجّل النتيجة".
 * - "زيارة ما كانت مسجّلة": pick client and property, then record a visit that already happened. */
(function(){
  'use strict';
  const esc=v=>typeof escapeHtml==='function'?escapeHtml(String(v==null?'':v)):String(v==null?'':v).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
  const byId=id=>document.getElementById(id);
  const today=()=>typeof toLocalDateStr==='function'?toLocalDateStr(new Date()):new Date().toISOString().slice(0,10);
  const plusDays=n=>{const d=new Date();d.setDate(d.getDate()+n);return typeof toLocalDateStr==='function'?toLocalDateStr(d):d.toISOString().slice(0,10);};
  const toast=(m,t)=>{if(typeof showToast==='function')showToast(m,t);};
  const editable=()=>typeof canEdit==='function'&&canEdit();

  // Outcome choices map to the existing visit fields; the server rules are unchanged.
  const OPINIONS=[
    {id:'liked',label:'أعجبه',feedback:'liked',outcome:'followup',next:'متابعة بعد الزيارة'},
    {id:'negotiate',label:'يبغى يتفاوض',feedback:'wants_negotiate',outcome:'negotiation',next:'متابعة التفاوض'},
    {id:'hesitant',label:'متردد',feedback:'hesitant',outcome:'followup',next:'متابعة بعد الزيارة'},
    {id:'disliked',label:'ما ناسبه',feedback:'disliked',outcome:'lost',next:null}
  ];
  const REASONS=[['price','السعر'],['location','الموقع'],['area','المساحة'],['room_layout','تقسيم الغرف'],['design','التصميم'],['finishing','التشطيب'],['financing','التمويل'],['found_other','وجد عقارًا آخر'],['not_serious','غير جاد'],['other','سبب آخر']];
  const FOLLOWUPS=[['1','بكرة'],['2','بعد يومين'],['7','بعد أسبوع'],['','بدون']];
  const ERRORS={viewing_request_ambiguous:'للعميل أكثر من طلب نشط. افتح النموذج الكامل واختر الطلب.',stale_viewing_version:'تغيّرت الزيارة من جهاز آخر. أعد فتحها ثم احفظ.',
    not_authorized:'هذه الزيارة ليست ضمن صلاحياتك.',investment_owner_only:'زيارات الاستثمار خاصة بصاحب الشركة.'};
  const errorText=e=>{const raw=String(e&&(e.message||e.details)||e||'');for(const k of Object.keys(ERRORS))if(raw.includes(k))return ERRORS[k];return 'لم يتم الحفظ: '+raw;};

  let state=null,dialog=null;

  // ---- Dashboard card ------------------------------------------------------
  function cardHost(){
    const page=byId('page-dash');if(!page)return null;
    let box=byId('crmQuickVisits');
    if(!box){box=document.createElement('section');box.id='crmQuickVisits';box.className='cqv-card card';const header=page.querySelector('.page-header');if(header)header.after(box);else page.prepend(box);}
    return box;
  }
  async function loadCard(){
    const box=cardHost();if(!box||!editable()||typeof supa==='undefined')return;
    const r=await supa.from('viewings').select('id,viewing_date,viewing_time,client:clients(name),property:properties(title)')
      .eq('status','scheduled').neq('archived',true).lte('viewing_date',today()).order('viewing_date').order('viewing_time').limit(6);
    if(r.error){box.innerHTML='';return;}
    const rows=r.data||[],t=today();
    box.innerHTML='<div class="cqv-head"><h3>زيارات اليوم</h3><button type="button" class="cqv-new" data-cqv="new">+ زيارة ما كانت مسجّلة</button></div>'
      +(rows.length?'<ul class="cqv-list">'+rows.map(v=>'<li><div class="cqv-info"><strong>'+esc(v.property&&v.property.title||'عقار')+'</strong><small>'+esc(v.client&&v.client.name||'—')+' · '
        +(v.viewing_date<t?'<span class="cqv-late">متأخرة '+esc(v.viewing_date)+'</span>':esc(String(v.viewing_time||'').slice(0,5)||'اليوم'))+'</small></div>'
        +'<button type="button" class="btn-primary cqv-go" data-cqv="result" data-id="'+esc(v.id)+'">سجّل النتيجة</button></li>').join('')+'</ul>'
        :'<p class="cqv-empty">ما في زيارات مجدولة لليوم.</p>');
  }

  // ---- Result sheet ----------------------------------------------------------
  function chips(name,items,current){
    return '<div class="cqv-chips" data-group="'+name+'">'+items.map(([v,l])=>'<button type="button" class="cqv-chip'+(current===v?' on':'')+'" data-pick="'+name+'" data-value="'+esc(v)+'">'+esc(l)+'</button>').join('')+'</div>';
  }
  function draw(){
    const s=state,done=s.status==='done',op=OPINIONS.find(o=>o.id===s.opinion);
    let h='<div class="cqv-sheet-head"><div><h3>'+esc(s.title)+'</h3><small>'+esc(s.subtitle)+'</small></div><button type="button" class="cqv-x" data-cqv="close" aria-label="إغلاق">×</button></div>';
    if(s.pickNew)h+=pickerHtml();
    h+='<p class="cqv-label">هل تمت الزيارة؟</p>'+chips('status',s.pickNew?[['done','تمت']]:[['done','تمت'],['no_show','لم يحضر'],['postponed','تأجلت']],s.status);
    if(done){
      h+='<p class="cqv-label">رأي العميل</p><div class="cqv-grid">'+OPINIONS.map(o=>'<button type="button" class="cqv-big'+(s.opinion===o.id?' on':'')+(o.id==='disliked'?' bad':'')+'" data-pick="opinion" data-value="'+o.id+'">'+o.label+'</button>').join('')+'</div>';
      if(op&&op.outcome==='lost')h+='<p class="cqv-label">السبب الرئيسي</p>'+chips('reason',REASONS,s.reason);
    }
    if(!(op&&op.outcome==='lost'))h+='<p class="cqv-label">المتابعة</p>'+chips('followup',FOLLOWUPS,s.followup);
    h+='<p class="cqv-label">الملاحظات</p><textarea id="cqvNote" class="fta" rows="3" placeholder="اكتب أو اضغط مايك الكيبورد وتكلّم">'+esc(s.note)+'</textarea>'
      +'<div id="cqvError" class="cqv-error" role="alert"></div>'
      +'<div class="cqv-actions"><button type="button" class="btn-primary cqv-save" data-cqv="save">حفظ</button>'+(s.id?'<button type="button" class="btn-secondary" data-cqv="full">النموذج الكامل</button>':'')+'</div>';
    dialog.innerHTML=h;
  }
  function pickerHtml(){
    const s=state;
    return '<p class="cqv-label">العميل</p><input id="cqvClientQ" class="fi" placeholder="الاسم أو رقم الهاتف" value="'+esc(s.clientQ||'')+'" autocomplete="off">'
      +'<div class="cqv-results" id="cqvClients">'+(s.clients||[]).map(c=>'<button type="button" class="cqv-chip'+(s.client_id===c.id?' on':'')+'" data-pick="client" data-value="'+esc(c.id)+'">'+esc(c.name)+(c.phone?' · <bdi dir="ltr">'+esc(c.phone)+'</bdi>':'')+'</button>').join('')+'</div>'
      +'<p class="cqv-label">العقار</p><input id="cqvPropertyQ" class="fi" placeholder="اسم العقار أو المنطقة" value="'+esc(s.propertyQ||'')+'" autocomplete="off">'
      +'<div class="cqv-results" id="cqvProperties">'+(s.properties||[]).map(p=>'<button type="button" class="cqv-chip'+(s.property_id===p.id?' on':'')+'" data-pick="property" data-value="'+esc(p.id)+'">'+esc(p.title)+(p.area?' · '+esc(p.area):'')+'</button>').join('')+'</div>';
  }
  function openDialog(){
    if(!dialog){
      dialog=document.createElement('dialog');dialog.className='cqv-dialog';dialog.setAttribute('dir','rtl');dialog.setAttribute('aria-label','تسجيل نتيجة الزيارة');document.body.append(dialog);
      dialog.addEventListener('click',onClick);dialog.addEventListener('input',onInput);
    }
    draw();if(!dialog.open)dialog.showModal();
  }
  async function openResult(id){
    if(!editable())return;
    const r=await supa.from('viewings').select('id,status,viewing_date,viewing_time,row_version,appointment_id, client:clients(name), property:properties(title)').eq('id',id).single();
    if(r.error){toast(errorText(r.error),'error');return;}
    const v=r.data;
    state={id:v.id,version:v.row_version,timeUnknown:!v.viewing_time&&!v.appointment_id,title:v.property&&v.property.title||'زيارة',subtitle:(v.client&&v.client.name||'')+' · '+v.viewing_date,
      status:'done',opinion:null,reason:null,followup:'2',note:''};
    openDialog();
  }
  function openNew(){
    if(!editable())return;
    state={id:null,pickNew:true,title:'زيارة ما كانت مسجّلة',subtitle:'تُسجَّل اليوم كزيارة تمت',status:'done',opinion:null,reason:null,followup:'2',note:'',clients:[],properties:[]};
    openDialog();searchProperties('');
  }
  let searchTimer=null;
  function onInput(e){
    if(e.target.id==='cqvNote'){state.note=e.target.value;return;}
    if(e.target.id==='cqvClientQ'||e.target.id==='cqvPropertyQ'){
      const q=e.target.value.trim();clearTimeout(searchTimer);
      searchTimer=setTimeout(()=>e.target.id==='cqvClientQ'?searchClients(q):searchProperties(q),300);
    }
  }
  const like=q=>'%'+q.replace(/[\\%_,()]/g,' ')+'%';
  async function searchClients(q){
    state.clientQ=q;if(q.length<2){state.clients=[];refreshPicker();return;}
    const digits=q.replace(/\D/g,'');
    let query=supa.from('clients').select('id,name,phone').neq('archived',true).limit(8);
    query=digits.length>=4?query.ilike('phone',like(digits.slice(-8))):query.ilike('name',like(q));
    const r=await query;if(!r.error){state.clients=r.data||[];refreshPicker();}
  }
  async function searchProperties(q){
    state.propertyQ=q;let query=supa.from('properties').select('id,title,area').neq('archived',true).order('title').limit(8);
    if(q)query=query.or('title.ilike.'+like(q)+',area.ilike.'+like(q));
    const r=await query;if(!r.error){state.properties=r.data||[];refreshPicker();}
  }
  function refreshPicker(){
    const c=byId('cqvClients'),p=byId('cqvProperties');
    if(c)c.innerHTML=(state.clients||[]).map(x=>'<button type="button" class="cqv-chip'+(state.client_id===x.id?' on':'')+'" data-pick="client" data-value="'+esc(x.id)+'">'+esc(x.name)+(x.phone?' · <bdi dir="ltr">'+esc(x.phone)+'</bdi>':'')+'</button>').join('');
    if(p)p.innerHTML=(state.properties||[]).map(x=>'<button type="button" class="cqv-chip'+(state.property_id===x.id?' on':'')+'" data-pick="property" data-value="'+esc(x.id)+'">'+esc(x.title)+(x.area?' · '+esc(x.area):'')+'</button>').join('');
  }
  function onClick(e){
    if(e.target===dialog){dialog.close();return;}
    const pick=e.target.closest('[data-pick]');
    if(pick){
      const k=pick.dataset.pick,v=pick.dataset.value;
      if(k==='client'){state.client_id=v;refreshPicker();return;}
      if(k==='property'){state.property_id=v;refreshPicker();return;}
      state[k]=v;if(k==='opinion'&&v!=='disliked')state.reason=null;
      const note=byId('cqvNote');if(note)state.note=note.value;
      draw();return;
    }
    const act=e.target.closest('[data-cqv]');if(!act)return;
    if(act.dataset.cqv==='close')dialog.close();
    else if(act.dataset.cqv==='save')save(act);
    else if(act.dataset.cqv==='full'){const id=state.id;dialog.close();if(typeof editViewing==='function')editViewing(id);}
  }
  function payload(){
    const s=state,op=OPINIONS.find(o=>o.id===s.opinion),done=s.status==='done';
    if(s.pickNew&&(!s.client_id||!s.property_id))throw new Error('اختر العميل والعقار');
    if(done&&!op)throw new Error('اختر رأي العميل');
    if(op&&op.outcome==='lost'&&!s.reason)throw new Error('اختر السبب الرئيسي');
    const lost=op&&op.outcome==='lost',followup=!lost&&s.followup?plusDays(Number(s.followup)):null,note=(s.note||'').trim()||null;
    const data={status:s.status,client_feedback:done?op.feedback:null,pipeline_outcome:done?op.outcome:null,rejection_reason:lost?s.reason:null,
      outcome_note:done?note:null,followup_date:followup,next_step:followup?(op&&op.next||(s.status==='postponed'?'تحديد موعد زيارة جديد':'التواصل بعد عدم الحضور')):null};
    if(!done&&note)data.notes=note;
    if(s.id){data.id=s.id;data.expected_version=s.version;if(done&&s.timeUnknown)data.time_unknown=true;}
    else{const now=new Date();Object.assign(data,{client_id:s.client_id,property_id:s.property_id,request_type:'buyer',agent_id:currentUser.id,viewing_date:today(),
      viewing_time:String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0'),duration_minutes:60});}
    return data;
  }
  async function save(button){
    const err=byId('cqvError');err.textContent='';
    let data;try{data=payload();}catch(e){err.textContent=e.message;return;}
    button.disabled=true;
    try{
      const r=await supa.rpc('crm_save_viewing_atomic',{p_payload:data,p_idempotency_key:crmSaveKey('mQuickVisit',data)});
      if(r.error)throw r.error;if(!r.data||!r.data.ok)throw new Error('لم يؤكد الخادم حفظ الزيارة');
      if(typeof crmFinishSave==='function')crmFinishSave('mQuickVisit');
      dialog.close();toast('تم حفظ نتيجة الزيارة وتحديث الصفقة والمتابعة','success');
      loadCard();[window.loadViewings,window.loadDeals].forEach(f=>{if(typeof f==='function')f();});
    }catch(e){err.textContent=errorText(e);}
    finally{button.disabled=false;}
  }

  document.addEventListener('click',e=>{
    const b=e.target.closest('[data-cqv]');if(!b||b.closest('.cqv-dialog'))return;
    if(b.dataset.cqv==='result')openResult(b.dataset.id);else if(b.dataset.cqv==='new')openNew();
  });
  window.crmQuickVisit=openResult;window.crmQuickVisitNew=openNew;
  const loadDash=window.loadDashboard;
  if(typeof loadDash==='function')window.loadDashboard=function(){const r=loadDash.apply(this,arguments);loadCard().catch(()=>{});return r;};
})();
