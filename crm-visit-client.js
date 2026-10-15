/* Add a contact without leaving or resetting the current visit. Uses the signed-in client's RLS. */
(function(){
  'use strict';
  const attemptKey='mViewingNewClient';
  let pending=null;
  const el=id=>document.getElementById(id);
  function current(op){return pending===op&&crmSessionCurrent(op.session,op.user)&&viewingFormGeneration===op.form&&el('mViewing').classList.contains('on');}
  function status(text,error){const node=el('vNewClientStatus');if(node){node.textContent=text;node.style.color=error?'var(--ruby)':'var(--umber)';node.setAttribute('role',error?'alert':'status');}}
  function closePanel(){const box=el('vNewClientBox');if(box)box.hidden=true;const button=el('vNewClientToggle');if(button)button.setAttribute('aria-expanded','false');}
  window.resetViewingNewClient=function(){
    if(pending){pending=null;crmEndSave('mViewing');}
    crmSaveAttempts.delete(attemptKey);closePanel();
    const box=el('vNewClientBox');if(box)box.innerHTML='';status('');
  };
  window.toggleViewingNewClient=function(){
    if(!canEdit()||editingViewing||crmSavingForms.has('mViewing'))return;
    const box=el('vNewClientBox');if(!box)return;
    if(!box.hidden){closePanel();return;}
    if(!el('vNewClientName')){
      box.innerHTML='<div style="margin-top:10px;padding:12px;border:1px solid var(--cream-deeper);border-radius:10px;display:grid;gap:8px;min-width:0">'+
        '<label class="fl" for="vNewClientName">اسم العميل *</label><input class="fi" id="vNewClientName" maxlength="200" autocomplete="name">'+
        '<label class="fl" for="vNewClientPhoneLocal">رقم الهاتف *</label><div dir="ltr" style="display:flex;gap:6px;min-width:0">'+
        '<select class="fs" id="vNewClientPhoneCountry" aria-label="رمز الدولة" style="width:125px;flex:0 1 125px" onchange="updatePhonePlaceholder(\'vNewClientPhoneCountry\',\'vNewClientPhoneLocal\')"></select>'+
        '<input class="fi" id="vNewClientPhoneLocal" type="tel" inputmode="tel" autocomplete="tel-national" dir="ltr" style="min-width:0;flex:1;text-align:left"></div>'+
        '<button type="button" class="btn-secondary" onclick="saveViewingNewClient()">إضافة العميل واختياره</button>'+
        '<div style="font-size:11px">يُحفظ العميل الآن، وتبقى الزيارة للتكملة والحفظ.</div></div>';
      setupPhoneField('vNewClientPhoneCountry','vNewClientPhoneLocal','');
    }
    box.hidden=false;el('vNewClientToggle').setAttribute('aria-expanded','true');status('');el('vNewClientName').focus();
  };
  async function findVisible(op,column,value){
    const result=await supa.from('clients').select('id,name,phone,archived').eq('company_id',op.company).eq(column,value).limit(2);
    if(!current(op))return null;
    if(result.error)throw result.error;
    if((result.data||[]).length>1)throw new Error('ambiguous_contact');
    return (result.data||[])[0]||null;
  }
  function choose(op,row,existing){
    if(!current(op))return;
    if(row.archived){status('هذا العميل مؤرشف. استعد ملفه من صفحة العملاء قبل تسجيل الزيارة.',true);return;}
    const state=viewingChoiceState.client;clearTimeout(state.timer);state.token++;
    state.rows=[row,...state.rows.filter(x=>x.id!==row.id)];
    const select=el('vClient');let option=Array.from(select.options).find(x=>x.value===row.id);
    if(!option){option=document.createElement('option');option.value=row.id;select.appendChild(option);}
    option.textContent=(row.name||'عميل')+(row.phone?' — '+row.phone:'');select.value=row.id;
    // Only clear the old request association. Property/date/attendance/follow-up/notes remain untouched.
    loadViewingClientProperty();
    el('vClientCount').textContent='تم اختيار العميل للزيارة';
    closePanel();crmSaveAttempts.delete(attemptKey);
    el('vNewClientBox').innerHTML='';
    status(existing?'الرقم مسجل لديك؛ تم اختيار العميل الموجود دون تكراره.':'تم حفظ العميل واختياره. أكمل بيانات الزيارة ثم اضغط حفظ.');
  }
  window.saveViewingNewClient=async function(){
    if(!canEdit()||editingViewing||pending||!currentUser||!el('mViewing').classList.contains('on')||el('vNewClientBox').hidden)return;
    let data;
    try{
      const name=el('vNewClientName').value.trim(),phone=crmValidatedPhone('vNewClientPhoneCountry','vNewClientPhoneLocal',true);
      if(!name||name.length>200)throw new Error('أدخل اسم العميل (حتى 200 حرف).');
      if(!currentProfile||!currentProfile.company_id)throw new Error('الحساب غير مربوط بالشركة. راجع المدير.');
      const type=['buyer','tenant','investor'].includes(el('vRequestType').value)?el('vRequestType').value:'buyer';
      data={company_id:currentProfile.company_id,assigned_to:currentUser.id,name,phone,client_type:type,is_buyer:type==='buyer',is_seller:false,is_investor:type==='investor',source:'other',pipeline_stage:'new'};
      if(type==='investor'&&typeof isOwner==='function'&&isOwner())data.lead_route='investment';
      data.id=crmSaveKey(attemptKey,data);
    }catch(error){status(error.message,true);return;}
    if(!crmBeginSave('mViewing'))return;
    const op={session:crmSessionGeneration,user:currentUser.id,form:viewingFormGeneration,company:data.company_id};pending=op;status('جاري حفظ العميل…');
    try{
      const existing=await findVisible(op,'phone_normalized',data.phone);if(!current(op))return;
      if(existing){choose(op,existing,true);return;}
      const result=await supa.from('clients').insert(data).select('id,name,phone,archived').single();
      if(!current(op))return;
      if(result.error)throw result.error;
      if(!result.data||!result.data.id)throw new Error('missing_confirmation');
      choose(op,result.data,false);
    }catch(error){
      if(!current(op))return;
      // A lost response or concurrent submission may have committed. Read only rows visible to this account.
      try{
        const saved=await findVisible(op,'id',data.id);if(!current(op))return;
        if(saved){choose(op,saved,false);return;}
        if(error.code==='23505'){
          const existing=await findVisible(op,'phone_normalized',data.phone);if(!current(op))return;
          if(existing){choose(op,existing,true);return;}
        }
      }catch(_){if(!current(op))return;}
      status(error.code==='23505'?'تعذر إضافة العميل بهذا الرقم. راجع الرقم أو تواصل مع المدير.':'تعذر حفظ العميل. تحقق من الاتصال ثم أعد المحاولة؛ بيانات الزيارة محفوظة.',true);
    }finally{
      if(pending===op){pending=null;crmEndSave('mViewing');}
    }
  };
})();
