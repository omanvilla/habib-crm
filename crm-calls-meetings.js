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
  /* 17 Nov 2026 (Ahmed, SQL110): calls to owners and advertisers only (the after-visit kind left); the next step follows the result:
   * «رد ووافق» → send the details on WhatsApp or call back at a day and hour; «يتصل بعدين» → the day and hour; «ما رد» / «رد ورفض» →
   * no step. A call back becomes a task for the caller. Target 10 a working day (Sunday to Thursday), the week and the month are
   * the sum of their days; leave and official holidays take days out; a short day gets its reason in the call log. */
  const KINDS=[['owner','مالك'],['advertiser','معلن']];
  const RESULTS=[['agreed','رد ووافق'],['refused','رد ورفض'],['no_answer','ما رد'],['call_later','يتصل بعدين']];
  const NEXT_FOR={agreed:[['send_details','يرسل التفاصيل على الواتساب'],['call_later','يتصل بعدين']],call_later:[['call_later','يتصل بعدين']]};
  const DAY_KINDS={busy:'انشغل بشغل أهم',other:'سبب ثاني',leave:'إجازة',holiday:'إجازة رسمية'};
  let callsToday=null,callKey=null,callLog=null,logUser=null;
  const pair=s=>s?'<bdi dir="ltr">'+Number(s.calls||0)+'/'+Number(s.target||0)+'</bdi>':'';
  const muscatDay=plus=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Muscat'}).format(new Date(Date.now()+(plus||0)*86400000));
  const me=()=>(typeof currentUser!=='undefined'&&currentUser)?currentUser.id:'';
  const manages=()=>['owner','manager'].includes(role());
  /* 17 Nov 2026 (Ahmed, SQL114): the app records each account's last visit (crm_mark_seen, at most every 5 minutes), and the
   * owner / manager see «آخر دخول» next to each person's calls. */
  let seenSent=0,lastSeen={};
  async function loadCalls(){
    if(!staff())return;
    if(Date.now()-seenSent>300000){seenSent=Date.now();supa.rpc('crm_mark_seen').then(()=>{},()=>{});}
    try{const r=await supa.rpc('crm_calls_today');if(!r.error&&r.data){callsToday=r.data;paintCallBtn();paintHomeCall();}}catch(_){}
    if(manages()&&callsToday&&(callsToday.people||[]).length){
      try{const p=await supa.from('profiles').select('id,last_login_at').in('id',callsToday.people.map(x=>x.user_id));
        if(!p.error){lastSeen={};(p.data||[]).forEach(x=>{lastSeen[x.id]=x.last_login_at;});paintHomeCall();}}catch(_){}
    }
  }
  const seenText=id=>{if(!Object.prototype.hasOwnProperty.call(lastSeen,id))return '';const t=lastSeen[id];if(!t)return ' · آخر دخول: ما في سجل';
    const day=muscatDay(0),d=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Muscat'}).format(new Date(t));
    return ' · آخر دخول: '+(d===day?'اليوم ':d===muscatDay(-1)?'أمس ':esc(fmtDay(d))+' ')+esc(fmtTime(t));};

  /* «اتصل بعدهم» (17 Nov 2026, Ahmed, SQL114 crm_call_next): open owner offers nobody called in the last 30 days, newest first.
   * «اتصل» dials from the phone; «سجّل الاتصال» opens the call window with the number and name filled. */
  let nextList=null;
  function nextDlg(){
    let d=byId('crmCallNextDlg');
    if(!d){d=document.createElement('dialog');d.id='crmCallNextDlg';d.className='ccm-dlg ccm-log';d.setAttribute('dir','rtl');document.body.appendChild(d);
      d.addEventListener('click',e=>{if(e.target===d)d.close();});}
    return d;
  }
  const KIND_AR={villa:'فيلا',house:'بيت',land:'أرض',apartment:'شقة',building:'مبنى',farm:'مزرعة',shop:'محل',chalet:'شاليه',resthouse:'استراحة'};
  async function openNext(){
    const d=nextDlg();d.innerHTML='<div class="ccm-form"><p class="ccm-note">جاري التحميل…</p></div>';if(!d.open)d.showModal();
    try{const r=await supa.rpc('crm_call_next',{p_limit:30});if(r.error)throw r.error;nextList=r.data||[];}
    catch(e){d.innerHTML='<div class="ccm-form"><p class="ccm-err">ما قدرت أفتح القائمة: '+esc(e.message||e)+'</p><div class="ccm-actions"><button type="button" class="btn-secondary" data-ccm="next-close">إغلاق</button></div></div>';return;}
    const rows=nextList.map((x,i)=>{const tel=String(x.phone||'').replace(/[^\d+]/g,'');
      const what=[KIND_AR[x.kind]||x.kind,x.area||x.wilayat,x.price?Number(x.price).toLocaleString('en-US')+' ر.ع':''].filter(Boolean).join(' · ');
      return '<li class="ccm-next"><div><strong dir="auto">'+esc(x.name||'مالك')+'</strong> <bdi dir="ltr">'+esc(x.phone||'')+'</bdi><br><small>'+esc(what)
        +(x.last_called_at?' · آخر اتصال '+esc(fmtDay(String(x.last_called_at).slice(0,10))):' · ما انتصل فيه')+'</small></div>'
        +'<div class="ccm-next-act">'+(tel?'<a class="btn-secondary crm-wa-small" href="tel:'+esc(tel)+'">اتصل</a>':'')
        +'<button type="button" class="btn-primary crm-wa-small" data-ccm="next-log" data-i="'+i+'">سجّل الاتصال</button></div></li>';}).join('');
    d.innerHTML='<div class="ccm-form"><h3>اتصل بعدهم <small>عروض ملاك ما انتصل فيها آخر 30 يوم</small></h3>'
      +(rows?'<ul class="ccm-days">'+rows+'</ul>':'<p class="ccm-note">ما في أحد في القائمة الحين</p>')
      +'<div class="ccm-actions"><button type="button" class="btn-secondary" data-ccm="next-close">إغلاق</button></div></div>';
  }
  function logFromNext(i){
    const x=nextList&&nextList[i];if(!x)return;byId('crmCallNextDlg').close();openCall(true);
    const ph=byId('ccmPhone'),nm=byId('ccmName');if(ph)ph.value=String(x.phone||'').replace(/[^\d]/g,'').replace(/^968(?=\d{8}$)/,'');if(nm)nm.value=x.name||'';
    const k=document.querySelector('#crmCallDlg input[name="ccmKind"][value="owner"]');if(k)k.checked=true;
  }
  // today's count and target on the button: «3/10»; a day off shows «3/—»
  function todayLabel(){
    if(!callsToday)return '';
    const t=Number(callsToday.target||0),n=Number(callsToday.mine||0);
    return ' <small dir="ltr">'+n+'/'+(t||'—')+'</small>';
  }
  function paintCallBtn(){
    const page=byId('page-clientDetail');if(!page||!staff())return;
    const bar=page.querySelector('.page-header > div:last-child');if(!bar)return;
    let b=byId('crmCallBtn');
    if(!b){b=document.createElement('button');b.type='button';b.id='crmCallBtn';b.className='btn-primary';b.addEventListener('click',openCall);bar.prepend(b);}
    b.innerHTML='📞 سجّل اتصال'+todayLabel();
  }
  function chips(name,list,checked){
    return '<div class="ccm-chips" role="radiogroup">'+list.map(([v,l])=>'<label class="ccm-chip"><input type="radio" name="'+name+'" value="'+esc(v)+'"'+(checked===v?' checked':'')+'><span>'+esc(l)+'</span></label>').join('')+'</div>';
  }
  /* 16 Nov 2026 (R87, SQL107): the same button on the home page, by the number itself, also for a person who is not a client
     yet. A number called as an owner or an advertiser is left to the office by the reply agent when he writes on WhatsApp. */
  function paintHomeCall(){
    if(!staff())return;
    const host=document.querySelector('#crmOwnerHome .coh-now');if(!host||!host.parentNode)return;
    let w=byId('crmCallHome');
    if(!w){w=document.createElement('div');w.id='crmCallHome';w.className='ccm-home';
      // 17 Nov 2026: the explanation moved inside the call window (it showed on the home page all day)
      w.innerHTML='<div class="ccm-home-row"><button type="button" class="btn-primary" id="crmCallHomeBtn" data-ccm="open-number"></button>'
        +'<button type="button" class="btn-secondary" data-ccm="next-open">اتصل بعدهم</button>'
        +'<button type="button" class="btn-secondary" data-ccm="open-log">سجل الاتصالات</button></div><p class="ccm-people" id="crmCallMine"></p>';}
    if(w.nextElementSibling!==host)host.parentNode.insertBefore(w,host);
    byId('crmCallHomeBtn').innerHTML='📞 سجّل اتصال'+todayLabel();
    const mine=byId('crmCallMine');
    if(mine)mine.innerHTML=callsToday?(Number(callsToday.target||0)?'':'اليوم ما عليه هدف (عطلة أو إجازة) · ')+'<b>الأسبوع</b> '+pair(callsToday.week)+' · <b>الشهر</b> '+pair(callsToday.month):'';
    // 16 Nov 2026 (Ahmed: «وين اقدر اشوف انها اتصلت 20 اتصال في ذاك اليوم؟»): the owner and the manager see each person's calls
    if(callsToday&&manages()){
      let p=byId('crmCallPeople');
      if(!p){p=document.createElement('p');p.id='crmCallPeople';p.className='ccm-people';w.appendChild(p);}
      const people=callsToday.people||[];
      p.innerHTML='<b>اتصالات الموظفين:</b> '+(people.length?people.map(x=>esc(x.name||'موظف')+': اليوم '+pair({calls:x.calls,target:x.target})+' · الأسبوع '+pair(x.week)+' · الشهر '+pair(x.month)+seenText(x.user_id)).join('<br>'):'ما في موظف');
    }
  }
  function openCall(byNumber){
    byNumber=byNumber===true;
    if(!byNumber&&(typeof viewingClient==='undefined'||!viewingClient)){toast('افتح العميل أول','error');return;}
    let d=byId('crmCallDlg');
    if(!d){d=document.createElement('dialog');d.id='crmCallDlg';d.className='ccm-dlg';document.body.appendChild(d);
      d.addEventListener('click',e=>{if(e.target===d)d.close();});
      d.addEventListener('change',e=>{const n=e.target&&e.target.name;if(n==='ccmResult'||n==='ccmNext')drawNext(d);});}
    callKey=uuid();d.dataset.mode=byNumber?'number':'client';
    d.innerHTML='<form method="dialog" class="ccm-form"><h3>📞 سجّل اتصال <small>'+esc(byNumber?'':viewingClient.name||'')+'</small></h3>'
      +(byNumber?'<small class="ccm-note">سجّل كل اتصال على مالك أو معلن حتى لو مو مسجل عندنا. إذا أرسل واتساب، العقل ما يرد عليه والمحادثة تجي عندك</small>'
        +'<label class="ccm-q" for="ccmName">الاسم (اختياري)</label><input id="ccmName" class="fi" maxlength="80" dir="auto" autocomplete="off">'
        +'<label class="ccm-q" for="ccmPhone">رقم الجوال</label><input id="ccmPhone" class="fi" type="tel" inputmode="tel" dir="ltr" maxlength="20" autocomplete="off" placeholder="9XXXXXXX">':'')
      +'<div class="ccm-q">اتصلت على</div>'+chips('ccmKind',KINDS)
      +'<div class="ccm-q">النتيجة</div>'+chips('ccmResult',RESULTS)
      +'<div id="ccmNextBox"></div>'
      +'<label class="ccm-q" for="ccmNote">ملاحظة قصيرة (اختياري)</label><input id="ccmNote" class="fi" maxlength="200" dir="auto" autocomplete="off">'
      +'<div class="ccm-err" role="alert"></div>'
      +'<div class="ccm-actions"><button type="button" class="btn-primary" data-ccm="save">حفظ</button><button type="button" class="btn-secondary" data-ccm="close">إلغاء</button></div></form>';
    d.showModal();
  }
  // the next step shown for the result chosen; «يتصل بعدين» asks the day and the hour (tomorrow at 10 by default)
  function drawNext(d){
    const box=d.querySelector('#ccmNextBox');if(!box)return;
    const val=n=>{const x=d.querySelector('input[name="'+n+'"]:checked');return x?x.value:'';};
    const result=val('ccmResult');
    if(!result){box.innerHTML='';return;}
    if(!NEXT_FOR[result]){box.innerHTML='<div class="ccm-q">الخطوة الجاية</div><p class="ccm-note">ما في خطوة</p>';return;}
    const list=NEXT_FOR[result],keep=val('ccmNext'),next=list.some(([v])=>v===keep)?keep:(list.length===1?list[0][0]:'');
    const oldDay=box.querySelector('#ccmAtDay'),oldTime=box.querySelector('#ccmAtTime');
    const date=oldDay&&oldDay.value||muscatDay(1),time=oldTime&&oldTime.value||'10:00';
    box.innerHTML='<div class="ccm-q">الخطوة الجاية</div>'+chips('ccmNext',list,next)
      +(next==='call_later'?'<div class="ccm-row"><label>يتصل يوم<input id="ccmAtDay" class="fi" type="date" dir="ltr" min="'+muscatDay(0)+'" value="'+esc(date)+'"></label>'
        +'<label>الساعة<input id="ccmAtTime" class="fi" type="time" dir="ltr" value="'+esc(time)+'"></label></div><small class="ccm-note">تنضاف لك مهمة في ذاك اليوم</small>':'');
  }
  async function saveCall(btn){
    const d=byId('crmCallDlg'),err=d.querySelector('.ccm-err');
    const val=n=>{const x=d.querySelector('input[name="'+n+'"]:checked');return x?x.value:'';};
    const kind=val('ccmKind'),result=val('ccmResult'),next=NEXT_FOR[result]?val('ccmNext'):'none';
    if(!kind||!result){err.textContent='اختر مين اتصلت عليه والنتيجة';return;}
    if(!next){err.textContent='اختر الخطوة الجاية';return;}
    let at=null;
    if(next==='call_later'){
      const day=byId('ccmAtDay')&&byId('ccmAtDay').value,time=byId('ccmAtTime')&&byId('ccmAtTime').value;
      if(!day||!time){err.textContent='حدد متى يتصل: اليوم والساعة';return;}
      at=day+'T'+time+':00+04:00';
      if(Date.parse(at)<Date.now()-300000){err.textContent='وقت الاتصال لازم يكون جاي، مو فات';return;}
    }
    const byNumber=d.dataset.mode==='number',phone=byNumber?String(byId('ccmPhone').value||'').replace(/[٠-٩]/g,c=>'٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/\D/g,''):'';
    if(byNumber&&(phone.length<8||phone.length>15)){err.textContent='اكتب رقم الجوال صح';return;}
    btn.disabled=true;err.textContent='';
    try{
      const common={p_kind:kind,p_result:result,p_next_step:next,p_next_at:at,p_note:byId('ccmNote').value||'',p_key:callKey};
      const r=byNumber?await supa.rpc('crm_log_call_number',{p_phone:phone,p_name:byId('ccmName').value||'',...common})
        :await supa.rpc('crm_log_call',{p_client:viewingClient.id,...common});
      if(r.error)throw r.error;
      // 17 Nov 2026 (Ahmed): an owner who agreed → «سجّل العقار» opens the quick property sheet with his name and phone
      if(kind==='owner'&&result==='agreed'&&typeof window.crmQuickProperty==='function'){
        const nm=byNumber?(byId('ccmName').value||'').trim():(viewingClient&&viewingClient.name)||'';
        const ph=byNumber?phone:String(viewingClient&&(viewingClient.phone||viewingClient.phone_normalized)||'').replace(/\D/g,'');
        d.dataset.propName=nm;d.dataset.propPhone=ph.replace(/^968(?=\d{8}$)/,'');
        d.innerHTML='<div class="ccm-form"><h3>انسجل الاتصال</h3><p class="ccm-note">المالك وافق. سجّل عقاره الحين وهو في بالك.</p>'
          +'<div class="ccm-actions"><button type="button" class="btn-primary" data-ccm="to-property">سجّل العقار</button><button type="button" class="btn-secondary" data-ccm="close">بعدين</button></div></div>';
        toast('انسجل الاتصال','success');
      }else{d.close();toast(next==='call_later'?'انسجل الاتصال وانضافت مهمة يوم الاتصال':'انسجل الاتصال','success');}
      await loadCalls();
      const lg=byId('crmCallLogDlg');if(lg&&lg.open)loadLog();
      if(typeof loadClientActivities==='function')try{loadClientActivities();}catch(_){}
    }catch(e){err.textContent='ما انحفظ: '+(e.message||e);btn.disabled=false;}
  }

  /* ---------- 1b. the call log (17 Nov 2026, Ahmed: «أضغط أقدر أشوف كل يوم كم اتصال … وإذا ما وصل التارجت لازم يكون في سبب») ---------- */
  const fmtDay=s=>{try{return new Date(s+'T12:00:00+04:00').toLocaleDateString('ar-OM-u-nu-latn',{timeZone:'Asia/Muscat',weekday:'long',day:'numeric',month:'numeric'});}catch(_){return s;}};
  const fmtTime=s=>{try{return new Date(s).toLocaleTimeString('ar-OM-u-nu-latn',{timeZone:'Asia/Muscat',hour:'numeric',minute:'2-digit'});}catch(_){return '';}};
  function logDlg(){
    let d=byId('crmCallLogDlg');
    if(!d){d=document.createElement('dialog');d.id='crmCallLogDlg';d.className='ccm-dlg ccm-log';document.body.appendChild(d);
      d.addEventListener('click',e=>{if(e.target===d)d.close();});}
    return d;
  }
  async function loadLog(){
    const d=logDlg();if(!d.open){d.innerHTML='<div class="ccm-form"><p class="ccm-note">جاري التحميل…</p></div>';d.showModal();}
    try{const r=await supa.rpc('crm_calls_log',{p_days:31});if(r.error)throw r.error;callLog=r.data;drawLog();}
    catch(e){d.innerHTML='<div class="ccm-form"><p class="ccm-err">ما قدرت أفتح السجل: '+esc(e.message||e)+'</p><div class="ccm-actions"><button type="button" class="btn-secondary" data-ccm="log-close">إغلاق</button></div></div>';}
  }
  // one day: calls / target and what it means; a short day without a reason gets «اكتب السبب»
  function dayRow(p,x,today,canWrite){
    const t=Number(x.target||0),n=Number(x.calls||0),past=x.day<today,off=!t;
    if(off&&!n&&!x.note)return '';
    const state=off?(x.note&&DAY_KINDS[x.note.kind]&&['leave','holiday'].includes(x.note.kind)?DAY_KINDS[x.note.kind]:'عطلة'):n>t?'فوق الهدف ✓':n===t?'وصل ✓':past?'ناقص '+(t-n):'لين الحين';
    const cls=off?'off':n>=t?'ok':past?'short':'now';
    const note=x.note?'<small class="ccm-why">'+esc(DAY_KINDS[x.note.kind]||'')+(x.note.all?' (للكل)':'')+(x.note.note?': '+esc(x.note.note):'')+'</small>':'';
    const ask=canWrite&&!off&&n<t&&x.day<=today&&!x.note;
    const list=(x.list||[]).map(c=>'<li><small>'+esc(fmtTime(c.at))+' · '+esc(c.text||'')+'</small></li>').join('');
    return '<li class="ccm-day '+cls+'"><div class="ccm-day-head"><strong>'+esc(fmtDay(x.day))+'</strong><span><bdi dir="ltr">'+n+'/'+(t||'—')+'</bdi> · '+esc(state)+'</span></div>'+note
      +(ask?'<div class="ccm-why-box" data-why="'+esc(x.day)+'|'+esc(p.user_id)+'"><button type="button" class="btn-secondary crm-wa-small" data-ccm="why">'+(past?'اكتب السبب':'سبب')+'</button></div>':'')
      +(list?'<details><summary>الاتصالات <b dir="ltr">'+n+'</b></summary><ul class="ccm-calls">'+list+'</ul></details>':'')+'</li>';
  }
  function drawLog(){
    const d=logDlg();if(!callLog)return;
    const people=callLog.people||[],self=me();
    if(!people.some(p=>p.user_id===logUser))logUser=(people.find(p=>p.user_id!==self)||people[0]||{}).user_id||null;
    const p=people.find(x=>x.user_id===logUser);
    const tabs=people.length>1?'<div class="cfu-tabs">'+people.map(x=>'<button type="button" class="cfu-tab'+(x.user_id===logUser?' on':'')+'" data-ccm="log-user" data-user="'+esc(x.user_id)+'">'+esc(x.name)+'</button>').join('')+'</div>':'';
    let sums='';
    if(callsToday&&p){const s=p.user_id===self?callsToday:(callsToday.people||[]).find(x=>x.user_id===p.user_id)||{};
      if(s.week)sums='<p class="ccm-people"><b>الأسبوع</b> '+pair(s.week)+' · <b>الشهر</b> '+pair(s.month)+'<br><small class="ccm-note">الهدف 10 اتصالات في اليوم من الأحد للخميس، والأسبوع مجموع أيامه. الجمعة والسبت والإجازات ما تنحسب'
        // SQL113 (17 Nov 2026, Ahmed: «خلي التارجت 100 اتصال مبدئيا الشهر الأول … بعدين نزيد شوية شوية»): the month has its own number
        +(s.month&&s.month.fixed?'. هدف الشهر حدده أحمد':'')+'</small></p>';}
    // the owner sets this month's number here (empty = 10 × working days again)
    if(role()==='owner'&&callsToday&&callsToday.month)sums+='<div class="ccm-row ccm-month"><label>هدف الشهر للموظف<input class="fi" type="number" inputmode="numeric" dir="ltr" min="1" max="2000" id="ccmMonthTarget" value="'+(callsToday.month.fixed?Number(callsToday.month.target):'')+'" placeholder="'+Number(callsToday.month.target||0)+'"></label><button type="button" class="btn-secondary" data-ccm="month-save">حفظ</button></div>';
    d.innerHTML='<div class="ccm-form"><h3>سجل الاتصالات <small>آخر 31 يوم</small></h3>'+tabs+sums
      +'<button type="button" class="coh-add" data-ccm="leave-open">+ سجّل إجازة'+(manages()?' أو إجازة رسمية':'')+'</button><div id="ccmLeaveBox"></div>'
      +(p?'<ul class="ccm-days">'+(p.days||[]).map(x=>dayRow(p,x,callLog.today,manages()||p.user_id===self)).join('')+'</ul>':'<p class="ccm-note">ما في اتصالات</p>')
      +'<div class="ccm-actions"><button type="button" class="btn-secondary" data-ccm="log-close">إغلاق</button></div></div>';
  }
  function whyForm(box){
    const day=box.dataset.why.split('|')[0];
    box.innerHTML='<div class="ccm-chips" role="radiogroup">'+Object.entries(DAY_KINDS).filter(([k])=>k!=='holiday'||manages()).map(([k,l])=>'<label class="ccm-chip"><input type="radio" name="ccmWhy-'+esc(day)+'" value="'+k+'"><span>'+esc(l)+'</span></label>').join('')+'</div>'
      +'<input class="fi" data-why-text maxlength="300" dir="auto" placeholder="اكتب السبب (مثلاً: كان عندي تنازل في الإسكان)">'
      +'<div class="ccm-actions"><button type="button" class="btn-primary" data-ccm="why-save">حفظ السبب</button></div>';
  }
  async function saveWhy(b){
    const box=b.closest('.ccm-why-box'),[day,user]=box.dataset.why.split('|');
    const kind=(box.querySelector('input[type=radio]:checked')||{}).value,txt=String(box.querySelector('[data-why-text]').value||'').trim();
    if(!kind){toast('اختر السبب','error');return;}
    if(['busy','other'].includes(kind)&&!txt){toast('اكتب السبب بكلمتين','error');return;}
    b.disabled=true;
    const r=await supa.rpc('crm_call_day_note',{p_day:day,p_kind:kind,p_note:txt,p_user:user===me()?null:user,p_until:null,p_all:false});
    if(r.error){b.disabled=false;toast('ما انحفظ: '+(r.error.message||''),'error');return;}
    toast('انحفظ السبب','success');loadCalls();loadLog();
  }
  function leaveForm(){
    const box=byId('ccmLeaveBox');if(!box)return;
    if(box.innerHTML){box.innerHTML='';return;}
    const people=(callLog&&callLog.people)||[];
    box.innerHTML='<div class="ccm-meet">'+(manages()?'<label>لمين<select class="fi" id="ccmLeaveWho"><option value="all">الكل (إجازة رسمية)</option>'+people.map(p=>'<option value="'+esc(p.user_id)+'"'+(p.user_id===logUser?' selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select></label>':'')
      +'<div class="ccm-row"><label>من<input class="fi" type="date" dir="ltr" id="ccmLeaveFrom" value="'+muscatDay(0)+'"></label><label>إلى<input class="fi" type="date" dir="ltr" id="ccmLeaveTo" value="'+muscatDay(0)+'"></label></div>'
      +'<input class="fi" id="ccmLeaveNote" maxlength="300" dir="auto" placeholder="ملاحظة (مثلاً: سنوية، العيد الوطني)">'
      +'<div class="ccm-actions"><button type="button" class="btn-primary" data-ccm="leave-save">حفظ</button></div><small class="ccm-note">أيام الإجازة ما تنحسب في الهدف</small></div>';
  }
  async function saveMonth(b){
    const raw=String(byId('ccmMonthTarget').value||'').trim(),n=raw===''?null:Math.round(Number(raw));
    if(n!==null&&!(n>=1&&n<=2000)){toast('اكتب رقم من 1 إلى 2000، أو خله فاضي','error');return;}
    b.disabled=true;
    const r=await supa.rpc('crm_set_call_month_target',{p_month:muscatDay(0),p_target:n});
    if(r.error){b.disabled=false;toast('ما انحفظ: '+(r.error.message||''),'error');return;}
    toast(n===null?'رجع هدف الشهر 10 × أيام الدوام':'هدف الشهر صار '+n,'success');await loadCalls();loadLog();
  }
  async function saveLeave(b){
    const who=byId('ccmLeaveWho')?byId('ccmLeaveWho').value:'me',from=byId('ccmLeaveFrom').value,to=byId('ccmLeaveTo').value||from;
    if(!from||to<from){toast('حدد التاريخ صح','error');return;}
    const all=who==='all';
    b.disabled=true;
    const r=await supa.rpc('crm_call_day_note',{p_day:from,p_kind:all?'holiday':'leave',p_note:byId('ccmLeaveNote').value||'',p_user:all||who==='me'||who===me()?null:who,p_until:to===from?null:to,p_all:all});
    if(r.error){b.disabled=false;toast('ما انحفظ: '+(r.error.message||''),'error');return;}
    toast('انحفظت الإجازة','success');loadCalls();loadLog();
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
    // 17 Nov 2026 (Ahmed, after the full check): staff confirm too (owner, manager, agent); a task is only open to the person it belongs to.
    const body=byId('taskDetailsBody');if(!body||!task||task.done||!/^\s*اجتماع/.test(String(task.title||''))||!staff()||!task.client_id)return;
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
  function unaskedList(){
    const fmt=v=>{try{return new Date(v).toLocaleTimeString('ar-OM-u-nu-latn',{timeZone:'Asia/Muscat',hour:'numeric',minute:'2-digit'});}catch(_){return '';}};
    return '<ul class="ccm-list">'+unasked.map(i=>'<li class="ccm-item"><div><strong>'+esc(i.client_name||'عميل')+'</strong> <span dir="ltr">'+esc(i.phone||'')+'</span>'
        +'<small>'+esc(i.property_title||'')+' · '+esc(fmt(i.visit_at))+'</small><small class="ccm-why">'+esc(i.why||'')+'</small></div>'
        +(typeof window.crmWaButtons==='function'?window.crmWaButtons({phone:i.phone,conversationId:i.conversation_id,clientId:i.client_id,cls:'btn-secondary crm-wa-small'}):'')+'</li>').join('')+'</ul>';
  }
  // 17 Nov 2026 (Ahmed: «تلغي اي شي متشابه»): on the home page these visits open from the visits tile, at the top of its sheet
  // (crm-owner-home.js), instead of a separate card above the greeting. The old page (no home) keeps the card.
  window.crmVisitsUnaskedCount=()=>unasked.length;
  window.crmVisitsUnaskedHtml=()=>unasked.length?'<h3 class="coh-h3">👀 معاينات أمس بدون متابعة من العقل <b dir="ltr">'+unasked.length+'</b></h3>'+unaskedList():'';
  const homeOn=()=>{const h=byId('crmOwnerHome');return !!(h&&!h.hidden);};
  function drawUnasked(){
    document.dispatchEvent(new CustomEvent('crm-visits-unasked-updated'));
    const box=unaskedHost();if(!box)return;
    box.hidden=!unasked.length||homeOn();if(box.hidden){box.innerHTML='';return;}
    box.innerHTML='<button type="button" class="ccm-head" data-ccm="toggle-unasked" aria-expanded="'+unaskedOpen+'">👀 معاينات أمس بدون متابعة من العقل <b dir="ltr">'+unasked.length+'</b></button>'
      +(unaskedOpen?unaskedList():'');
  }
  // 18 Nov 2026 (decision 64): the start timer and each loadDashboard hook read this at about the same time; one read
  // still on its way, or answered less than 3 seconds ago for the same session, is shared
  let unaskedRead=null,unaskedAt=0,unaskedKey='';
  function loadUnasked(){
    if(!staff())return Promise.resolve();
    const key=(typeof crmSessionGeneration==='undefined'?'':crmSessionGeneration)+':'+(typeof currentUser!=='undefined'&&currentUser?currentUser.id:'');
    if(unaskedRead&&unaskedKey===key&&(!unaskedAt||Date.now()-unaskedAt<3000))return unaskedRead;
    const read=(async()=>{try{const r=await supa.rpc('crm_visits_unasked',{p_day:null});if(!r.error){unasked=r.data||[];drawUnasked();return true;}}catch(_){}return false;})()
      .then(ok=>{if(unaskedRead===read){if(ok)unaskedAt=Date.now();else unaskedRead=null;}});
    unaskedKey=key;unaskedAt=0;unaskedRead=read;return read;
  }

  document.addEventListener('click',e=>{
    const b=e.target.closest('[data-ccm]');if(!b)return;
    if(b.dataset.ccm==='save')saveCall(b);
    else if(b.dataset.ccm==='open-number')openCall(true);
    else if(b.dataset.ccm==='close')byId('crmCallDlg').close();
    else if(b.dataset.ccm==='open-log')loadLog();
    else if(b.dataset.ccm==='log-close')byId('crmCallLogDlg').close();
    else if(b.dataset.ccm==='log-user'){logUser=b.dataset.user;drawLog();}
    else if(b.dataset.ccm==='why')whyForm(b.closest('.ccm-why-box'));
    else if(b.dataset.ccm==='why-save')saveWhy(b);
    else if(b.dataset.ccm==='leave-open')leaveForm();
    else if(b.dataset.ccm==='leave-save')saveLeave(b);
    else if(b.dataset.ccm==='month-save')saveMonth(b);
    else if(b.dataset.ccm==='toggle-unasked'){unaskedOpen=!unaskedOpen;drawUnasked();}
    else if(b.dataset.ccm==='next-open')openNext();
    else if(b.dataset.ccm==='next-close')byId('crmCallNextDlg').close();
    else if(b.dataset.ccm==='next-log')logFromNext(Number(b.dataset.i));
    else if(b.dataset.ccm==='to-property'){const d=byId('crmCallDlg'),nm=d.dataset.propName||'',ph=d.dataset.propPhone||'';d.close();window.crmQuickProperty({name:nm,phone:ph,source:'owner'});}
  });
  const vc=window.viewClient;
  if(typeof vc==='function')window.viewClient=async function(){const r=await vc.apply(this,arguments);paintCallBtn();loadCalls();return r;};
  const ld=window.loadDashboard;
  if(typeof ld==='function')window.loadDashboard=function(){const r=ld.apply(this,arguments);setTimeout(()=>(window.crmAfterHome||(f=>f()))(()=>{loadUnasked();paintHomeCall();}),1500);return r;};
  // 19 Nov 2026: after the home's first draw (crm-owner-home.js), so these reads do not slow the home read at open
  setTimeout(()=>(window.crmAfterHome||(f=>f()))(()=>{loadUnasked();loadCalls();paintHomeCall();}),2500);
})();
