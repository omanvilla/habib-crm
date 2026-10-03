(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=value=>String(value==null?'':value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const sold=stage=>['closed','commission_collected'].includes(stage);
  const financialIds=['dwCommissionTotal','dwBrokerCommission','dwAgentShare','dwEmployeePercent','dwCommissionStatus','dwReceivedOn','dwBroker'];
  const stages=[['viewing_scheduled','زيارة محددة'],['viewing_no_show','زيارة — لم يحضر'],['viewing_cancelled','زيارة — ألغيت'],['viewing_postponed','زيارة — تأجلت'],['visit','تمت الزيارة'],['negotiation','تفاوض'],['deposit','عربون / حجز'],['awaiting_finance','بانتظار التمويل'],['finance_approved','تمت الموافقة على التمويل'],['awaiting_clearance','بانتظار المخالصة'],['ownership_transfer','نقل الملكية'],['closed','تم البيع'],['commission_collected','تم البيع والعمولة محصلة'],['lost','لم يناسبه العقار / خرج من الصفقة']];
  let state=null,sequence=0;
  const value=id=>$(id)?$(id).value.trim():'';
  const own=()=>typeof isOwner==='function'&&isOwner();
  const manage=()=>currentProfile&&['owner','manager'].includes(currentProfile.role);
  const option=(id,label)=>'<option value="'+esc(id)+'">'+esc(label)+'</option>';
  const field=(id,label,content,wide)=>'<div class="fg'+(wide?' full':'')+'"><label class="fl" for="'+id+'">'+label+'</label>'+content+'</div>';
  const input=(id,type='text',extra='')=>'<input class="fi" id="'+id+'" type="'+type+'" '+extra+'>';
  const select=(id,options,extra='')=>'<select class="fs" id="'+id+'" '+extra+'>'+options+'</select>';
  function day(value){
    if(!value)return '';
    const date=new Date(value);if(!Number.isFinite(date.getTime()))return '';
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Muscat',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
    return ['year','month','day'].map(type=>parts.find(p=>p.type===type).value).join('-');
  }
  function validDate(value){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return false;
    const d=new Date(value+'T12:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;
  }
  function amount(raw,label){
    if(raw==null||String(raw).trim()==='')return null;
    const text=String(raw).trim().replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/[۰-۹]/g,c=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c))).replace(/[٬,]/g,'').replace(/٫/g,'.');
    if(!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text))throw new Error('أدخل '+label+' كرقم صحيح');
    const n=Number(text);if(!Number.isFinite(n)||n<0)throw new Error(label+' يجب ألا يكون سالباً');return n;
  }
  function customerNotes(raw){return typeof crmDealCustomerNotes==='function'?crmDealCustomerNotes(raw):String(raw||'');}
  function mergeNotes(original,edited){
    const provenance=String(original||'').split(/\r?\n/).filter(line=>line.trim()&&!customerNotes(line));
    return provenance.concat(edited&&String(edited).trim()?[String(edited).trim()]:[]).join('\n')||null;
  }
  function commission(total,broker,percent,fixed){
    const base=Number(total||0)-Number(broker||0);
    if(base<0)throw new Error('عمولة الوسيط أعلى من العمولة الكاملة');
    if(percent!=null&&(percent<0||percent>100))throw new Error('نسبة الموظفة يجب أن تكون بين 0 و100');
    const employee=percent==null?Number(fixed||0):Math.round((base*percent/100+Number.EPSILON)*100)/100;
    if(employee>base)throw new Error('نصيب الموظفة أعلى من عمولة الشركة قبل توزيعها');
    return {base,employee,company:Math.round((base-employee+Number.EPSILON)*100)/100};
  }
  function active(s=state){return Boolean(s&&state===s&&s.sequence===sequence&&crmSessionCurrent(s.generation,s.user));}
  function error(message){const el=$('dwError');if(el){el.textContent=message;el.hidden=!message;}else if(message)showToast(message,'error');}
  function set(id,v){if($(id))$(id).value=v==null?'':String(v);}
  function toggle(id,shown){if($(id))$(id).hidden=!shown;}
  function financialSnapshot(){return financialIds.map(id=>value(id)).join('\u0000');}
  function render(s){
    const d=s.deal||{},editing=Boolean(d.id),owners=s.owners,manager=manage();
    const choose=(rows,empty,label,newLabel)=>option('',empty)+rows.map(x=>option(x.id,label(x))).join('')+(newLabel?option('__new__',newLabel):'');
    const typeOptions=typeof propertyTypeOptions==='function'?propertyTypeOptions():option('villa','فيلا')+option('apartment','شقة')+option('land','أرض')+option('other','أخرى');
    const modal=$('mDeal');
    modal.innerHTML='<div class="modal-box lg dw-modal" dir="rtl"><form id="dealWorkflowForm" novalidate><div class="modal-title" id="mDealTitle">'+(editing?'تعديل الصفقة':'تسجيل صفقة')+'</div><p class="dw-intro">العميل والعقار والمالك وتواريخ البيع والعمولة في نفس الصفحة.</p><div id="dwError" class="dw-error" role="alert" hidden></div><div class="fgrid">'+
      field('dwMode','نوع التسجيل',select('dwMode',(editing&&d.entry_mode==='legacy'?option('legacy','سجل موجود — احتفظ بالمعلومات المعروفة'):'')+option('current','صفقة جديدة')+option('historical','صفقة قديمة')))+
      field('dwStage','المرحلة',select('dwStage',stages.filter(x=>own()||x[0]!=='commission_collected'||d.stage==='commission_collected').map(x=>option(x[0],x[1])).join('')))+
      '<p class="dw-hint full" id="dwModeHint"></p>'+
      field('dwClientChoice','العميل *',select('dwClientChoice',choose(s.clients,'اختر العميل',x=>x.name+(x.phone?' · '+x.phone:''),'＋ إضافة عميل هنا'),editing?'disabled':''))+
      field('dwPropertyChoice','العقار *',select('dwPropertyChoice',choose(s.properties,'اختر العقار',x=>x.title+(x.area?' · '+x.area:'')+(x.archived?' · مؤرشف':''),'＋ إضافة عقار هنا'),editing?'disabled':''))+
      '<div id="dwNewClient" class="dw-subform full" hidden><h4>العميل الجديد</h4><div class="fgrid">'+field('dwClientName','اسم العميل *',input('dwClientName'))+field('dwClientPhone','الهاتف *',input('dwClientPhone','tel','dir="ltr" placeholder="+968..."'))+'</div></div>'+
      '<div id="dwNewProperty" class="dw-subform full" hidden><h4>العقار الجديد</h4><div class="fgrid">'+field('dwPropertyTitle','عنوان العقار *',input('dwPropertyTitle'))+field('dwPropertyArea','المنطقة *',input('dwPropertyArea'))+field('dwPropertyType','نوع العقار *',select('dwPropertyType',typeOptions))+field('dwPropertyPrice','سعر العقار (ر.ع) *',input('dwPropertyPrice','text','inputmode="decimal" dir="ltr" required'))+field('dwPropertyBranch','الفرع *',select('dwPropertyBranch',option('','اختر الفرع')+s.branches.map(x=>option(x,x==='muscat'?'مسقط':x==='barka'?'بركاء':x)).join('')) )+'</div></div>'+
      field('dwOwnerChoice','المالك',select('dwOwnerChoice',choose(owners,'بدون إضافة مالك',x=>x.name,'＋ إضافة مالك هنا')))+
      (manager?field('dwAgent','الموظفة المسؤولة',select('dwAgent',option('','حسب الموظفة المسجلة')+s.members.map(x=>option(x.id,x.full_name)).join(''))):'')+
      '<div id="dwNewOwner" class="dw-subform full" hidden><h4>المالك الجديد</h4><div class="fgrid">'+field('dwOwnerName','اسم المالك *',input('dwOwnerName'))+field('dwOwnerPhone','هاتف المالك *',input('dwOwnerPhone','tel','dir="ltr" placeholder="+968..." required'))+'</div></div>'+
      '<p class="dw-hint full" id="dwOwnerHint" hidden>المالك مرتبط بهذا العقار مسبقاً.</p>'+
      '<div id="dwSaleSection" class="full"><div class="fgrid">'+field('dwDealValue','قيمة البيع (ر.ع)',input('dwDealValue','text','inputmode="decimal" dir="ltr"'))+field('dwClosedOn','تاريخ البيع',input('dwClosedOn','date','dir="ltr"'))+'</div></div>'+
      '<div id="dwVisitSection" class="dw-subform full"><h4>الزيارة الفعلية</h4><p class="dw-hint" id="dwVisitHint"></p><div class="fgrid">'+field('dwViewingChoice','زيارة مسجلة للعميل والعقار',select('dwViewingChoice',option('','لا توجد زيارة مختارة')))+field('dwVisitDate','أو تاريخ الزيارة الفعلي',input('dwVisitDate','date','dir="ltr"'))+'</div></div>'+
      '<div id="dwLossSection" class="dw-subform dw-loss full" hidden><h4>سبب الخروج من العقار</h4>'+field('dwLostReason','السبب الرئيسي',select('dwLostReason',option('','اختر السبب الموثق')+s.reasons.map(x=>option(x.id,x.label_ar)).join('')))+field('dwLostWords','كلام العميل (اختياري)','<textarea class="fta" id="dwLostWords" rows="3"></textarea>')+'<p class="dw-hint" id="dwLossHint"></p></div>'+
      (own()?'<div id="dwFinanceSection" class="dw-subform full"><h4>العمولة</h4><div class="fgrid">'+field('dwCommissionTotal','العمولة الكاملة (ر.ع)',input('dwCommissionTotal','text','inputmode="decimal" dir="ltr"'))+field('dwBroker','الوسيط (اختياري)',select('dwBroker',option('','بدون وسيط')+owners.map(x=>option(x.id,x.name)).join('')))+field('dwBrokerCommission','عمولة الوسيط (ر.ع)',input('dwBrokerCommission','text','inputmode="decimal" dir="ltr"'))+field('dwEmployeePercent','نسبة الموظفة من عمولة الشركة (%)',input('dwEmployeePercent','text','inputmode="decimal" dir="ltr" placeholder="اختياري"'))+'<p class="dw-hint full">أساس النسبة = العمولة الكاملة − عمولة الوسيط، قبل خصم نصيب الموظفة. اترك النسبة فارغة للحفاظ على مبلغ ثابت.</p>'+field('dwAgentShare','نصيب الموظفة (ر.ع)',input('dwAgentShare','text','inputmode="decimal" dir="ltr"'))+field('dwCompanyShare','المتبقي للشركة (ر.ع)',input('dwCompanyShare','text','dir="ltr" readonly'))+field('dwCommissionStatus','حالة العمولة',select('dwCommissionStatus',option('pending','معلّقة')+option('received','مستلمة')))+field('dwReceivedOn','تاريخ استلام العمولة',input('dwReceivedOn','date','dir="ltr"'))+'</div><p class="dw-hint" id="dwFinanceHint">الأرقام القديمة تبقى محفوظة إلى أن تعدّل بيانات العمولة.</p></div>':'')+
      '<div id="dwNotesSection" class="full">'+field('dwNotes','ملاحظات العميل أو الصفقة','<textarea class="fta" id="dwNotes" rows="3"></textarea>')+'</div>'+
      (editing?'<details id="dwProvenance" class="dw-provenance full"><summary>مصدر السجل</summary><p>'+esc(d.viewing_id?'أنشئت أو ربطت هذه البطاقة بزيارة للعميل والعقار. مصدر التسجيل محفوظ في السجل.':'مصدر وتاريخ إنشاء السجل محفوظان، وهما مستقلان عن تاريخ البيع.')+'</p><p>تاريخ التسجيل: <bdi>'+esc(day(d.created_at)||'غير مسجل')+'</bdi></p></details>':'')+
      '</div><div class="modal-foot"><button class="btn-secondary" type="button" data-dw-cancel>إلغاء</button><button class="btn-primary" id="dwSave" type="submit">حفظ الصفقة</button></div></form></div>';
    set('dwMode',d.entry_mode||'current');set('dwStage',d.stage||'closed');set('dwClientChoice',d.client_id||s.initialClient||'');set('dwPropertyChoice',d.property_id||'');
    set('dwDealValue',d.deal_value);set('dwClosedOn',day(d.closed_at));set('dwNotes',customerNotes(d.notes));set('dwLostReason',d.lost_reason_id);set('dwLostWords',d.lost_reason_note);set('dwAgent',d.agent_id);
    if(s.branches.length===1)set('dwPropertyBranch',s.branches[0]);
    if(own()){set('dwCommissionTotal',d.commission_total);set('dwBrokerCommission',d.broker_commission);set('dwEmployeePercent',d.employee_commission_percent);set('dwAgentShare',d.agent_share);set('dwCompanyShare',d.company_share);set('dwBroker',d.broker_id);set('dwCommissionStatus',d.commission_status||'pending');set('dwReceivedOn',day(d.commission_received_at));}
    s.financeBaseline=financialSnapshot();syncProperty();sync();modal.classList.add('on');
    $('dealWorkflowForm').addEventListener('submit',event=>{event.preventDefault();saveDeal();});
    $('dealWorkflowForm').addEventListener('input',event=>changed(event));
    $('dealWorkflowForm').addEventListener('change',event=>changed(event));
    modal.querySelector('[data-dw-cancel]').addEventListener('click',()=>closeModal('mDeal'));
  }
  function syncProperty(){
    if(!state)return;const prop=state.properties.find(x=>x.id===value('dwPropertyChoice'));
    toggle('dwNewClient',value('dwClientChoice')==='__new__');toggle('dwNewProperty',value('dwPropertyChoice')==='__new__');
    const fixedOwner=prop&&prop.owner_id;
    if($('dwOwnerChoice')){$('dwOwnerChoice').disabled=Boolean(fixedOwner);if(fixedOwner)set('dwOwnerChoice',fixedOwner);else if(state.fixedOwner)set('dwOwnerChoice','');}
    state.fixedOwner=fixedOwner;toggle('dwOwnerHint',Boolean(fixedOwner));toggle('dwNewOwner',value('dwOwnerChoice')==='__new__');
  }
  function sync(){
    if(!state)return;const stage=value('dwStage'),mode=value('dwMode'),isLost=stage==='lost';
    toggle('dwLossSection',isLost);toggle('dwNotesSection',!isLost);toggle('dwSaleSection',!isLost);toggle('dwVisitSection',!isLost);toggle('dwFinanceSection',!isLost);
    $('dwModeHint').textContent=mode==='historical'?'يمكن تسجيل صفقة من 2020 أو 2022 بتواريخها الحقيقية؛ اترك الزيارة فارغة إذا لم تعرف تاريخها.':mode==='legacy'?'احتفظ بالمعلومات والتواريخ المعروفة. لا يلزم اختراع تاريخ زيارة لسجل قديم.':'عند تسجيل البيع نحتاج تاريخ البيع وزيارة فعلية، مسجلة أو بتاريخها هنا.';
    $('dwVisitHint').textContent=mode==='current'&&sold(stage)?'اختر زيارة تمت، أو أدخل تاريخ الزيارة الفعلي. لا نطلب تاريخ التفاوض أو العربون.':'اختياري إذا كانت الزيارة غير معروفة. إدخال تاريخ هنا يعني أن الزيارة تمت فعلاً.';
    $('dwLossHint').textContent=state.deal&&state.deal.stage==='lost'&&!state.deal.lost_reason_id?'لا يوجد سبب موثق في السجل القديم. أضف السبب فقط إذا كان معروفاً.':'';
    if($('dwReceivedOn')){$('dwReceivedOn').disabled=value('dwCommissionStatus')!=='received';$('dwReceivedOn').required=mode==='current'&&value('dwCommissionStatus')==='received';}
    if($('dwVisitDate'))$('dwVisitDate').disabled=Boolean(value('dwViewingChoice'));
    if($('dwAgentShare'))$('dwAgentShare').readOnly=Boolean(value('dwEmployeePercent'));
  }
  function recalc(){
    if(!own())return;
    try{const p=amount(value('dwEmployeePercent'),'نسبة الموظفة'),result=commission(amount(value('dwCommissionTotal'),'العمولة الكاملة'),amount(value('dwBrokerCommission'),'عمولة الوسيط'),p,amount(value('dwAgentShare'),'نصيب الموظفة'));
      if(p!=null)set('dwAgentShare',result.employee);set('dwCompanyShare',result.company);$('dwFinanceHint').textContent='عمولة الشركة قبل توزيعها: '+result.base.toLocaleString('en-US')+' ر.ع';
    }catch(e){$('dwFinanceHint').textContent=e.message;}
  }
  function changed(event){
    if(!active())return;const id=event.target.id;
    if(['dwClientChoice','dwPropertyChoice','dwOwnerChoice'].includes(id)){syncProperty();if(id!=='dwOwnerChoice')loadViewings(state);}
    if(id==='dwStage'&&own()){if(value('dwStage')==='commission_collected')set('dwCommissionStatus','received');else if(value('dwStage')==='closed')set('dwCommissionStatus','pending');}
    if(id==='dwCommissionStatus'&&sold(value('dwStage')))set('dwStage',value('dwCommissionStatus')==='received'?'commission_collected':'closed');
    if(['dwCommissionTotal','dwBrokerCommission','dwAgentShare','dwEmployeePercent'].includes(id))recalc();
    sync();
  }
  async function loadViewings(s){
    const token=++s.viewingSequence,client=value('dwClientChoice'),property=value('dwPropertyChoice');s.viewings=[];
    if($('dwViewingChoice'))$('dwViewingChoice').innerHTML=option('','لا توجد زيارة مختارة');
    if(!client||client==='__new__'||!property||property==='__new__'){sync();return;}
    try{const r=await supa.from('viewings').select('id,client_id,property_id,viewing_date,status,archived').eq('client_id',client).eq('property_id',property).eq('archived',false).order('viewing_date',{ascending:false});
      if(!active(s)||token!==s.viewingSequence)return;if(r.error)throw r.error;s.viewings=r.data||[];
      $('dwViewingChoice').innerHTML=option('','لا توجد زيارة مختارة')+s.viewings.map(v=>option(v.id,(v.viewing_date||'بدون تاريخ')+' · '+(v.status==='done'?'تمت':v.status==='scheduled'?'مجدولة':v.status))).join('');
      if(s.deal&&s.deal.viewing_id)set('dwViewingChoice',s.deal.viewing_id);sync();
    }catch(e){if(active(s)&&token===s.viewingSequence)error('تعذر تحميل الزيارات: '+e.message);}
  }
  async function open(dealId,initialClient,stage){
    if(typeof canEdit!=='function'||!canEdit()){showToast('ليس لديك صلاحية تعديل الصفقة','error');return;}
    if(typeof crmSavingForms!=='undefined'&&crmSavingForms.has('mDeal'))return;
    const s={sequence:++sequence,generation:crmSessionGeneration,user:currentUser&&currentUser.id,deal:null,initialClient,viewingSequence:0};state=s;
    window.editingDealId=dealId||null;
    $('mDeal').innerHTML='<div class="modal-box lg dw-modal"><p>جاري تحميل الصفقة...</p><div id="dwError" role="alert" hidden></div><button class="btn-secondary" type="button" onclick="closeModal(\'mDeal\')">إغلاق</button></div>';$('mDeal').classList.add('on');
    try{
      const queries=[supa.from('clients').select('id,name,phone').order('name'),crmDataFrom('properties').select('id,title,area,type,price,owner_id,branch_key,archived').order('title'),supa.from('rejection_reasons').select('id,label_ar,is_active').order('sort_order'),supa.from('company_lead_routes').select('route_key,assigned_to,is_active').eq('is_active',true)];
      if(dealId)queries.push(supa.rpc('crm_get_deal_workflow',{p_deal_id:dealId}));
      if(manage())queries.push(supa.from('profiles').select('id,full_name,role,is_active').eq('company_id',currentProfile.company_id).eq('is_active',true).order('full_name'));
      const results=await Promise.all(queries);if(!active(s))return;results.forEach(r=>{if(r.error)throw r.error;});
      s.clients=results[0].data||[];s.properties=results[1].data||[];s.reasons=results[2].data||[];
      const routes=(results[3].data||[]).filter(r=>manage()||r.assigned_to===s.user);
      s.branches=[...new Set(routes.map(r=>r.route_key).filter(x=>['muscat','barka'].includes(x)))];if(manage())s.branches=['muscat','barka'];
      if(dealId){s.deal=results[4].data&&results[4].data.deal;if(!s.deal)throw new Error('الصفقة غير متاحة');}
      s.members=manage()?(results[dealId?5:4].data||[]):[];
      const ownerIds=[...new Set(s.properties.map(p=>p.owner_id).filter(Boolean))];
      let ownerResult={data:[]};if(manage())ownerResult=await supa.from('owners').select('id,name,phone,owner_type').order('name');else if(ownerIds.length)ownerResult=await supa.from('owners').select('id,name,phone,owner_type').in('id',ownerIds).order('name');
      if(!active(s))return;if(ownerResult.error)throw ownerResult.error;s.owners=ownerResult.data||[];
      if(s.deal){
        if(!s.clients.some(x=>x.id===s.deal.client_id)||!s.properties.some(x=>x.id===s.deal.property_id))throw new Error('تعذر تحميل العميل أو العقار المرتبط بالصفقة');
        window.editingDealOriginalStage=s.deal.stage;
      }
      render(s);if(stage){set('dwStage',stage);if(own()&&stage==='commission_collected')set('dwCommissionStatus','received');sync();}
      await loadViewings(s);
    }catch(e){if(active(s))error('تعذر فتح الصفقة: '+e.message);}
  }
  function buildPayload(){
    if(!active())throw new Error('تغيرت الجلسة. افتح الصفقة من جديد');
    const d=state.deal||{},stage=value('dwStage'),mode=value('dwMode'),clientChoice=value('dwClientChoice'),propertyChoice=value('dwPropertyChoice');
    if(!clientChoice)throw new Error('اختر العميل أو أضفه هنا');if(!propertyChoice)throw new Error('اختر العقار أو أضفه هنا');
    const payload={deal:{entry_mode:mode,stage,closed_on:value('dwClosedOn')||null,viewing_id:value('dwViewingChoice')||null,visit_date:value('dwViewingChoice')?null:value('dwVisitDate')||null,notes:stage==='lost'?(d.notes||null):mergeNotes(d.notes,value('dwNotes')),lost_reason_id:stage==='lost'?value('dwLostReason')||null:null,lost_reason_note:stage==='lost'?value('dwLostWords')||null:null,deal_value:amount(value('dwDealValue'),'قيمة البيع')},client:clientChoice==='__new__'?{name:value('dwClientName'),phone:value('dwClientPhone')}:{id:clientChoice},property:propertyChoice==='__new__'?{title:value('dwPropertyTitle'),area:value('dwPropertyArea'),type:value('dwPropertyType'),price:amount(value('dwPropertyPrice'),'سعر العقار'),branch_key:value('dwPropertyBranch')}:{id:propertyChoice}};
    if(d.id){payload.deal.id=d.id;payload.deal.expected_updated_at=d.updated_at;}
    if(manage()&&value('dwAgent')&&value('dwAgent')!==d.agent_id)payload.deal.agent_id=value('dwAgent');
    if(clientChoice==='__new__'&&(!payload.client.name||!payload.client.phone))throw new Error('أدخل اسم العميل ورقم هاتفه');
    if(propertyChoice==='__new__'&&(!payload.property.title||!payload.property.area||!payload.property.type||!payload.property.branch_key))throw new Error('أكمل عنوان العقار والمنطقة والنوع والفرع');
    if(propertyChoice==='__new__'&&payload.property.price==null)throw new Error('أدخل سعر العقار الفعلي');
    const ownerChoice=value('dwOwnerChoice');if(ownerChoice&&!state.fixedOwner)payload.owner=ownerChoice==='__new__'?{name:value('dwOwnerName'),phone:value('dwOwnerPhone')||null}:{id:ownerChoice};
    if(payload.owner&&!payload.owner.id&&(!payload.owner.name||!payload.owner.phone))throw new Error('أدخل اسم المالك ورقم هاتفه');
    if(!own()&&stage!==(d.stage||'')&&(stage==='commission_collected'||d.stage==='commission_collected'))throw new Error('تغيير حالة تحصيل العمولة متاح لصاحب الشركة فقط');
    if(stage==='lost'&&!payload.deal.lost_reason_id&&!(d.id&&d.stage==='lost'&&!d.lost_reason_id))throw new Error('اختر السبب الرئيسي للخروج من العقار');
    if(sold(stage)&&!payload.deal.closed_on&&!(d.id&&d.entry_mode==='legacy'&&sold(d.stage)))throw new Error('أدخل تاريخ البيع الفعلي');
    for(const date of [payload.deal.closed_on,payload.deal.visit_date])if(date&&!validDate(date))throw new Error('أدخل تاريخاً صحيحاً');
    if(mode==='current'&&sold(stage)){
      const visit=state.viewings.find(x=>x.id===payload.deal.viewing_id);
      if(!(visit&&visit.status==='done')&&!payload.deal.visit_date)throw new Error('الصفقة الجديدة تحتاج زيارة تمت أو تاريخ الزيارة الفعلي');
    }
    if(payload.deal.visit_date&&payload.deal.closed_on&&payload.deal.visit_date>payload.deal.closed_on)throw new Error('تاريخ الزيارة يجب ألا يأتي بعد تاريخ البيع');
    if(own()&&stage!=='lost'&&(!d.id||financialSnapshot()!==state.financeBaseline)){
      const f={commission_total:amount(value('dwCommissionTotal'),'العمولة الكاملة'),broker_commission:amount(value('dwBrokerCommission'),'عمولة الوسيط'),agent_share:amount(value('dwAgentShare'),'نصيب الموظفة'),employee_commission_percent:amount(value('dwEmployeePercent'),'نسبة الموظفة'),commission_status:value('dwCommissionStatus')||'pending',commission_received_on:value('dwCommissionStatus')==='received'?value('dwReceivedOn')||null:null,broker_id:value('dwBroker')||null};
      commission(f.commission_total,f.broker_commission,f.employee_commission_percent,f.agent_share);
      if(f.commission_status==='received'&&((mode==='current'&&!f.commission_received_on)||(f.commission_received_on&&!validDate(f.commission_received_on))))throw new Error('أدخل تاريخ استلام العمولة الفعلي');
      if(f.commission_received_on&&payload.deal.closed_on&&f.commission_received_on<payload.deal.closed_on)throw new Error('تاريخ استلام العمولة يجب ألا يسبق تاريخ البيع');
      payload.deal.financials=f;
    }
    return payload;
  }
  const priorOpen=window.openModal,priorClose=window.closeModal,priorReset=window.clearSessionUI;
  window.openModal=function(id){if(id==='mDeal')return open(window.editingDealId||null);return priorOpen.apply(this,arguments);};
  window.editDeal=function(id){return open(id);};
  window.addDealForClient=function(id){return open(null,id);};
  window.closeModal=function(id,force){
    if(id!=='mDeal')return priorClose.apply(this,arguments);
    if(typeof crmSavingForms!=='undefined'&&crmSavingForms.has(id)&&!force){showToast('انتظر اكتمال الحفظ','warning');return;}
    sequence++;state=null;window.editingDealId=null;window.editingDealOriginalStage=null;
    if(typeof crmSaveAttempts!=='undefined')crmSaveAttempts.delete(id);if($(id)){$(id).classList.remove('on');$(id).innerHTML='';}
  };
  if(typeof priorReset==='function')window.clearSessionUI=function(){sequence++;state=null;if(typeof crmSavingForms!=='undefined')crmSavingForms.delete('mDeal');if(typeof crmSaveAttempts!=='undefined')crmSaveAttempts.delete('mDeal');if($('mDeal'))$('mDeal').innerHTML='';return priorReset.apply(this,arguments);};
  window.saveDeal=async function(){
    const s=state;if(!active(s)||!canEdit())return;let payload;
    try{payload=buildPayload();}catch(e){error(e.message);return;}
    if(!crmBeginSave('mDeal'))return;error('');
    try{const r=await supa.rpc('crm_save_deal_workflow',{p_payload:payload,p_idempotency_key:crmSaveKey('mDeal',payload)});if(!active(s))return;if(r.error)throw r.error;if(!r.data||!r.data.deal_id)throw new Error('لم يصل تأكيد حفظ الصفقة. حاول الحفظ مرة أخرى');
      crmFinishSave('mDeal');showToast(s.deal?'تم تحديث الصفقة':'تم تسجيل الصفقة وكل بياناتها','success');
      const refresh=[typeof loadDeals==='function'&&loadDeals(),typeof loadDashboard==='function'&&loadDashboard()];await Promise.allSettled(refresh.filter(Boolean));
    }catch(e){if(active(s))error('لم تُحفظ الصفقة: '+e.message);}finally{if(active(s))crmEndSave('mDeal');}
  };
  window.onDrop=async function(event){
    event.preventDefault();event.currentTarget.classList.remove('drag-over');
    const id=typeof draggedDealId!=='undefined'?draggedDealId:null,stage=event.currentTarget.dataset.stage;
    if(!id||!stage||!canEdit())return;await open(id,null,stage);
  };
  window.crmDealWorkflow={day,validDate,amount,mergeNotes,commission,buildPayload,open};
})();
