/* 14 Nov 2026 (Ahmed, SQL100). Three small tools in one module:
 * 1. «📞 سجّل اتصال» on the client screen: taps only (who was called, the result, the next step) and a short note. Saved by
 *    crm_log_call in activities (channel call, actor human, the person signed in). The button shows today's count of 20.
 * 2. «أكّد الموعد» in the details of a meeting task («اجتماع: … (ينتظر تأكيدك)», R45): Ahmed sets the day and the hour (filled
 *    from what the client asked), reads the message, changes it if he wants, and it goes to the client from the chat's branch
 *    number through the same send as the chat (crmSendWhatsApp → whatsapp-send, 24 hour window). Then the task is done.
 *    Nothing reaches the client before he presses the button.
 * 3. «معاينات أمس بدون متابعة من العقل» above «متابعة اليوم»: yesterday's visits with no question sent (crm_visits_unasked),
 *    with the client, number, property, visit time and why, so the staff checks them in one place. */
(function(){
  'use strict';
  const byId=id=>document.getElementById(id);
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
  const toast=(m,t)=>{if(typeof showToast==='function')showToast(m,t);};
  const role=()=>typeof currentProfile!=='undefined'&&currentProfile?currentProfile.role:'';
  const staff=()=>['owner','manager','agent'].includes(role());
  const uuid=()=>(crypto.randomUUID?crypto.randomUUID():'10000000-1000-4000-8000-100000000000'.replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16)));

  /* ---------- 1. call log ---------- */
  const KINDS=[['advertiser','معلن'],['owner','مالك'],['after_visit','عميل بعد معاينة']];
  const RESULTS=[['agreed','رد ووافق'],['refused','رد ورفض'],['no_answer','ما رد'],['call_later','يتصل بعدين']];
  const NEXT=['يتصل بكره','أرسل له التفاصيل','زيارة','دراسة سعر','ما في خطوة'];
  let callsToday=null,callKey=null;
  async function loadCalls(){
    if(!staff())return;
    try{const r=await supa.rpc('crm_calls_today');if(!r.error&&r.data){callsToday=r.data;paintCallBtn();}}catch(_){}
  }
  function paintCallBtn(){
    const page=byId('page-clientDetail');if(!page||!staff())return;
    const bar=page.querySelector('.page-header > div:last-child');if(!bar)return;
    let b=byId('crmCallBtn');
    if(!b){b=document.createElement('button');b.type='button';b.id='crmCallBtn';b.className='btn-primary';b.addEventListener('click',openCall);bar.prepend(b);}
    const n=callsToday?Number(callsToday.mine||0):null,t=callsToday?Number(callsToday.target||20):20;
    b.innerHTML='📞 سجّل اتصال'+(n==null?'':' <small dir="ltr">'+n+'/'+t+'</small>');
  }
  function chips(name,list){
    return '<div class="ccm-chips" role="radiogroup">'+list.map(([v,l])=>'<label class="ccm-chip"><input type="radio" name="'+name+'" value="'+esc(v)+'"><span>'+esc(l)+'</span></label>').join('')+'</div>';
  }
  function openCall(){
    if(typeof viewingClient==='undefined'||!viewingClient){toast('افتح العميل أول','error');return;}
    let d=byId('crmCallDlg');
    if(!d){d=document.createElement('dialog');d.id='crmCallDlg';d.className='ccm-dlg';document.body.appendChild(d);
      d.addEventListener('click',e=>{if(e.target===d)d.close();});}
    callKey=uuid();
    d.innerHTML='<form method="dialog" class="ccm-form"><h3>📞 سجّل اتصال <small>'+esc(viewingClient.name||'')+'</small></h3>'
      +'<div class="ccm-q">اتصلت على</div>'+chips('ccmKind',KINDS)
      +'<div class="ccm-q">النتيجة</div>'+chips('ccmResult',RESULTS)
      +'<div class="ccm-q">الخطوة الجاية</div>'+chips('ccmNext',NEXT.map(x=>[x,x]))
      +'<label class="ccm-q" for="ccmNote">ملاحظة قصيرة (اختياري)</label><input id="ccmNote" class="fi" maxlength="200" dir="auto" autocomplete="off">'
      +'<div class="ccm-err" role="alert"></div>'
      +'<div class="ccm-actions"><button type="button" class="btn-primary" data-ccm="save">حفظ</button><button type="button" class="btn-secondary" data-ccm="close">إلغاء</button></div></form>';
    d.showModal();
  }
  async function saveCall(btn){
    const d=byId('crmCallDlg'),err=d.querySelector('.ccm-err');
    const val=n=>{const x=d.querySelector('input[name="'+n+'"]:checked');return x?x.value:'';};
    const kind=val('ccmKind'),result=val('ccmResult'),next=val('ccmNext');
    if(!kind||!result){err.textContent='اختر مين اتصلت عليه والنتيجة';return;}
    btn.disabled=true;err.textContent='';
    try{
      const r=await supa.rpc('crm_log_call',{p_client:viewingClient.id,p_kind:kind,p_result:result,p_next:next==='ما في خطوة'?'':next,p_note:byId('ccmNote').value||'',p_key:callKey});
      if(r.error)throw r.error;
      d.close();toast('انسجل الاتصال','success');await loadCalls();
      if(typeof loadClientActivities==='function')try{loadClientActivities();}catch(_){}
    }catch(e){err.textContent='ما انحفظ: '+(e.message||e);btn.disabled=false;}
  }

  /* ---------- 2. meeting confirmation ---------- */
  const PLACES=['مكتب الأهلي صبور في العذيبة','مكتب دار جلوبال عند دار الأوبرا','مكتب الموالح','اونلاين'];
  const DAYS=['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
  function hour12(t){const m=String(t||'').match(/^(\d{1,2}):(\d{2})/);if(!m)return '';let h=+m[1];const ap=h>=12?'المسا':'الصبح';h=h%12||12;return h+(m[2]==='00'?'':':'+m[2])+' '+ap;}
  function meetingText(date,time,place){
    let day='';if(/^\d{4}-\d{2}-\d{2}$/.test(date)){const d=new Date(date+'T12:00:00+04:00');day=DAYS[d.getUTCDay()]+' '+d.getUTCDate()+'/'+(d.getUTCMonth()+1);}
    return 'السلام عليكم\nتم تأكيد موعد الاجتماع'+(day?' يوم '+day:'')+(time?' الساعة '+hour12(time):'')+(place?'\n'+place:'');
  }
  async function confirmBox(task){
    const body=byId('taskDetailsBody');if(!body||!task||task.done||!/^\s*اجتماع/.test(String(task.title||''))||!['owner','manager'].includes(role())||!task.client_id)return;
    const t=String(task.title),dm=t.match(/(\d{4}-\d{2}-\d{2})/),tm=t.match(/\b(\d{2}:\d{2})\b/),pl=PLACES.find(p=>t.includes(p))||(/اونلاين/.test(t)?'اونلاين':'');
    const date=dm?dm[1]:'',time=tm?tm[1]:'';
    const box=document.createElement('div');box.className='ccm-meet';
    box.innerHTML='<div class="fl">أكّد الموعد للعميل</div>'
      +'<div class="ccm-row"><label>اليوم<input type="date" class="fi" data-mt="date" value="'+esc(date)+'"></label><label>الساعة<input type="time" class="fi" data-mt="time" value="'+esc(time)+'"></label></div>'
      +'<label>المكان<input class="fi" data-mt="place" dir="auto" list="ccmPlaces" value="'+esc(pl)+'"></label><datalist id="ccmPlaces">'+PLACES.map(p=>'<option value="'+esc(p)+'">').join('')+'</datalist>'
      +'<label>الرسالة اللي بتوصل العميل (تقدر تعدلها)<textarea class="fi" rows="4" dir="auto" data-mt="text"></textarea></label>'
      +'<div class="ccm-err" role="alert"></div><button type="button" class="btn-primary" data-mt="send">أكّد الموعد وارسله للعميل</button>'
      +'<small class="ccm-note">ينرسل من رقم الفرع داخل 24 ساعة من آخر رسالة للعميل. بعدها رد عليه من المحادثة بنفسك</small>';
    body.appendChild(box);
    const q=s=>box.querySelector('[data-mt="'+s+'"]'),ta=q('text');
    const fill=()=>{if(ta.dataset.edited!=='1')ta.value=meetingText(q('date').value,q('time').value,q('place').value.trim());};
    fill();['date','time','place'].forEach(k=>q(k).addEventListener('input',fill));ta.addEventListener('input',()=>{ta.dataset.edited='1';});
    q('send').addEventListener('click',async()=>{
      const b=q('send'),err=box.querySelector('.ccm-err'),text=ta.value.trim();
      if(!q('date').value||!q('time').value){err.textContent='حدد اليوم والساعة';return;}
      if(!text){err.textContent='الرسالة فاضية';return;}
      if(typeof crmSendWhatsApp!=='function'){err.textContent='الإرسال مو متاح في هالصفحة';return;}
      b.disabled=true;err.textContent='';
      try{
        const c=await supa.from('whatsapp_conversations').select('id,route_key').eq('client_id',task.client_id).in('route_key',['barka','muscat']).order('last_message_at',{ascending:false}).limit(1).maybeSingle();
        if(c.error||!c.data)throw new Error('ما لقيت محادثة واتساب للعميل');
        await crmSendWhatsApp({client_id:task.client_id,conversation_id:c.data.id,body:text});
        const note=(task.notes?task.notes+'\n':'')+'تأكد الموعد: '+q('date').value+' '+q('time').value+(q('place').value.trim()?' · '+q('place').value.trim():'');
        await supa.from('tasks').update({done:true,completed_at:new Date().toISOString(),notes:note}).eq('id',task.id);
        toast('انرسل التأكيد للعميل','success');if(typeof closeModal==='function')closeModal('mTaskDetails');
        if(typeof loadDashboard==='function')try{loadDashboard();}catch(_){}
      }catch(e){err.textContent='ما انرسل: '+(e.message||e);b.disabled=false;}
    });
  }
  const openTD=window.openTaskDetails;
  if(typeof openTD==='function')window.openTaskDetails=async function(){
    const r=await openTD.apply(this,arguments);
    try{const x=window.viewingTaskDetails;if(x&&x.task)await confirmBox(x.task);}catch(_){}
    return r;
  };

  /* ---------- 3. yesterday's visits with no question ---------- */
  let unasked=[],unaskedOpen=false;
  function unaskedHost(){
    const fu=byId('crmFollowups');if(!fu||!fu.parentNode)return null;
    let box=byId('crmVisitsUnasked');
    if(!box){box=document.createElement('section');box.id='crmVisitsUnasked';box.className='card cfu ccm-unasked';}
    if(box.nextElementSibling!==fu)fu.parentNode.insertBefore(box,fu);
    return box;
  }
  function drawUnasked(){
    const box=unaskedHost();if(!box)return;
    box.hidden=!unasked.length;if(!unasked.length){box.innerHTML='';return;}
    const fmt=v=>{try{return new Date(v).toLocaleTimeString('ar-OM-u-nu-latn',{timeZone:'Asia/Muscat',hour:'numeric',minute:'2-digit'});}catch(_){return '';}};
    box.innerHTML='<button type="button" class="ccm-head" data-ccm="toggle-unasked" aria-expanded="'+unaskedOpen+'">👀 معاينات أمس بدون متابعة من العقل <b dir="ltr">'+unasked.length+'</b></button>'
      +(unaskedOpen?'<ul class="ccm-list">'+unasked.map(i=>'<li class="ccm-item"><div><strong>'+esc(i.client_name||'عميل')+'</strong> <span dir="ltr">'+esc(i.phone||'')+'</span>'
        +'<small>'+esc(i.property_title||'')+' · '+esc(fmt(i.visit_at))+'</small><small class="ccm-why">'+esc(i.why||'')+'</small></div>'
        +(typeof window.crmWaButtons==='function'?window.crmWaButtons({phone:i.phone,conversationId:i.conversation_id,clientId:i.client_id,cls:'btn-secondary crm-wa-small'}):'')+'</li>').join('')+'</ul>':'');
  }
  async function loadUnasked(){
    if(!staff())return;
    try{const r=await supa.rpc('crm_visits_unasked',{p_day:null});if(!r.error){unasked=r.data||[];drawUnasked();}}catch(_){}
  }

  document.addEventListener('click',e=>{
    const b=e.target.closest('[data-ccm]');if(!b)return;
    if(b.dataset.ccm==='save')saveCall(b);
    else if(b.dataset.ccm==='close')byId('crmCallDlg').close();
    else if(b.dataset.ccm==='toggle-unasked'){unaskedOpen=!unaskedOpen;drawUnasked();}
  });
  const vc=window.viewClient;
  if(typeof vc==='function')window.viewClient=async function(){const r=await vc.apply(this,arguments);paintCallBtn();loadCalls();return r;};
  const ld=window.loadDashboard;
  if(typeof ld==='function')window.loadDashboard=function(){const r=ld.apply(this,arguments);setTimeout(loadUnasked,1500);return r;};
  setTimeout(()=>{loadUnasked();loadCalls();},2500);
})();
