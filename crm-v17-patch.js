(function(){
  window.APP_VERSION='20260914-modern-ui-v17-live';
  function el(id){return document.getElementById(id)}
  function injectPropertyFields(){
    var modal=el('mProperty');if(!modal||el('pHasAgreement'))return;
    var pd=el('pPublicDetails');if(pd&&pd.closest('.fg'))pd.closest('.fg').style.display='none';
    var desc=el('pDesc');if(desc){desc.rows=7;var lab=desc.closest('.fg')&&desc.closest('.fg').querySelector('.fl');if(lab)lab.textContent='📝 وصف العقار / الكابشن';desc.placeholder='اكتب الوصف الكامل كما تريد أن يظهر في إنستغرام وكما يُرسل للعميل: الغرف، المجلس، الصالة، المميزات والسعر إذا رغبت...';}
    var map=el('pMapUrl');if(map){var mfg=map.closest('.fg');var hint=mfg&&mfg.querySelector('div[style*="font-size:10px"]');if(hint)hint.textContent='إذا طلب العميل الموقع فقط يُرسل هذا الرابط وحده، وإذا طلب التفاصيل يضاف الرابط تلقائياً بعد الوصف.';}
    var foot=modal.querySelector('.modal-foot');if(!foot)return;
    var wrap=document.createElement('div');wrap.id='propertyV17Extra';wrap.innerHTML=`
      <div class="form-section"><div class="form-section-title">🤝 عقد التسويق مع المالك</div><div class="fgrid">
        <div class="fg"><label class="fl">هل يوجد عقد؟</label><select class="fs" id="pHasAgreement" onchange="updatePropertyAgreementFields()"><option value="0">بدون عقد</option><option value="1">بعقد</option></select></div>
        <div class="fg" id="pAgreementStartFG" style="display:none"><label class="fl">بداية العقد</label><input class="fi" type="date" id="pAgreementStart" onchange="updatePropertyAgreementHint()"></div>
        <div class="fg" id="pAgreementDurationFG" style="display:none"><label class="fl">مدة العقد (بالأشهر)</label><input class="fi" type="number" min="1" max="60" id="pAgreementDuration" value="3" inputmode="numeric" oninput="updatePropertyAgreementHint()"></div>
        <div class="fg full" id="pAgreementHintFG" style="display:none"><div id="pAgreementHint" style="background:#FFF8E8;border:1px solid #F2C46D;border-radius:10px;padding:11px 13px;font-size:12px;line-height:1.7;color:#7A5C00"></div></div>
      </div></div>
      <div class="form-section"><div class="form-section-title">📣 روابط التسويق عند تسجيل العقار <span style="font-size:10px;color:var(--umber);font-weight:500">(اختياري)</span></div><div class="fgrid">
        <div class="fg full"><label class="fl">رابط Instagram Reel / Post</label><input class="fi" id="pMarketingInstagramUrl" dir="ltr" style="text-align:left" placeholder="https://www.instagram.com/reel/..."></div>
        <div class="fg full"><label class="fl">رابط Oman Reel</label><input class="fi" id="pMarketingOmanReelUrl" dir="ltr" style="text-align:left"></div>
        <div class="fg full"><label class="fl">رابط YouTube</label><input class="fi" id="pMarketingYoutubeUrl" dir="ltr" style="text-align:left" placeholder="https://youtube.com/..."></div>
      </div></div>
      <div class="form-section"><div class="form-section-title">👁 معاينة رسالة العميل</div><div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn-secondary" onclick="previewPropertyClientMessage('details')">معاينة التفاصيل</button><button type="button" class="btn-secondary" onclick="previewPropertyClientMessage('location')">الموقع فقط</button></div><div id="pMessagePreview" style="display:none;margin-top:10px;background:#F8FAFC;border:1px solid #CBD5E1;border-radius:10px;padding:12px;white-space:pre-wrap;line-height:1.8;font-size:12px"></div></div>`;
    foot.parentNode.insertBefore(wrap,foot);
  }
  window.updatePropertyAgreementFields=function(){var on=el('pHasAgreement')&&el('pHasAgreement').value==='1';['pAgreementStartFG','pAgreementDurationFG','pAgreementHintFG'].forEach(function(id){if(el(id))el(id).style.display=on?'':'none'});if(on){if(el('pAgreementStart')&&!el('pAgreementStart').value)el('pAgreementStart').value=toLocalDateStr(new Date());updatePropertyAgreementHint();}};
  function addMonths(dateStr,m){var d=new Date(dateStr+'T12:00:00');var day=d.getDate();d.setDate(1);d.setMonth(d.getMonth()+m);var last=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();d.setDate(Math.min(day,last));return toLocalDateStr(d)}
  function reminderDays(start,end){var days=Math.max(1,Math.round((new Date(end+'T12:00:00')-new Date(start+'T12:00:00'))/86400000));return Math.max(7,Math.min(30,Math.round(days*.2)))}
  window.updatePropertyAgreementHint=function(){if(!el('pAgreementHint'))return;var s=el('pAgreementStart').value,m=Math.max(1,parseInt(el('pAgreementDuration').value)||3);if(!s){el('pAgreementHint').textContent='حدد بداية العقد ومدته.';return}var end=addMonths(s,m),rem=reminderDays(s,end);el('pAgreementHint').textContent='ينتهي العقد: '+end+' — سيظهر التنبيه قبل '+rem+' يوم تقريباً من الانتهاء.';};
  window.previewPropertyClientMessage=function(mode){var box=el('pMessagePreview');if(!box)return;var p={description:(el('pDesc')&&el('pDesc').value||'').trim(),map_url:(el('pMapUrl')&&el('pMapUrl').value||'').trim()};box.textContent=mode==='location'?(p.map_url||'لم يتم إدخال موقع بعد'):buildPropertyPublicMessage(p,'');box.style.display='block';};
  window.buildPropertyPublicMessage=function(p,clientName){var lines=[];if(clientName)lines.push('مرحباً '+clientName+' 🌟','');var d=String(p.description||p.public_details||'').trim();if(d)lines.push(d);if(p.map_url)lines.push('','📍 موقع العقار:',p.map_url);return lines.join('\n')};
  window.copyCurrentPropertyLocation=async function(){var p=window.viewingProperty;if(!p||!p.map_url){showToast('⚠️ لا يوجد رابط موقع لهذا العقار','error');return}try{await navigator.clipboard.writeText(p.map_url);showToast('✅ تم نسخ موقع العقار','success')}catch(e){showToast('تعذر النسخ','error')}};

  function marketingDraft(){return [['instagram','pMarketingInstagramUrl'],['oman_reel','pMarketingOmanReelUrl'],['youtube','pMarketingYoutubeUrl']].map(([channel,id])=>({channel,url:(el(id)&&el(id).value||'').trim()})).filter(x=>x.url);}
  async function saveMarketingLinks(propertyId,items){
    const cid=await ensureCompany();for(const item of items){const existing=await supa.from('property_marketing_events').select('id').eq('property_id',propertyId).eq('url',item.url).limit(1);if(existing.error)throw existing.error;if((existing.data||[]).length)continue;
      const r=await supa.from('property_marketing_events').insert({company_id:cid,property_id:propertyId,channel:item.channel,event_type:'publish',published_at:new Date().toISOString(),url:item.url,created_by:currentUser.id,auto_sync:false,sync_status:'manual'});if(r.error)throw r.error;
    }
  }
  window.saveProperty=async function(){
    if(!canEdit()||!crmBeginSave('mProperty'))return;let persisted=false;
    try{
      const title=el('pTitle').value.trim(),area=el('pArea').value.trim(),type=el('pType').value,price=crmReadNumber('pPrice','سعر العقار',{required:true,min:0.001}),ownerId=el('pOwnerId').value||null;
      if(!title||!area||!type)throw new Error('العنوان والمنطقة ونوع العقار مطلوبة');if(!window.editingProperty&&!ownerId)throw new Error('اختر المالك أو أضف مالكاً');
      const cid=await ensureCompany(),has=el('pHasAgreement').value==='1',start=has?el('pAgreementStart').value:null,duration=has?crmReadNumber('pAgreementDuration','مدة العقد',{required:true,integer:true,min:1,max:60}):null;
      if(has&&!start)throw new Error('حدد بداية عقد التسويق');const end=has?addMonths(start,duration):null,links=marketingDraft();
      for(const item of links){let url;try{url=new URL(item.url);}catch(_e){throw new Error('رابط التسويق غير صحيح');}if(url.protocol!=='https:')throw new Error('رابط التسويق يجب أن يبدأ بـhttps');}
      const map=(el('pMapUrl').value||'').trim();if(map){let mapUrl;try{mapUrl=new URL(map);}catch(_e){throw new Error('رابط الموقع غير صحيح');}if(mapUrl.protocol!=='https:')throw new Error('رابط الموقع يجب أن يبدأ بـhttps');}
      const data={title,type,area,price,status:el('pStatus').value,bedrooms:crmReadNumber('pBeds','غرف النوم',{integer:true}),bathrooms:crmReadNumber('pBaths','دورات المياه',{integer:true}),land_size:crmReadNumber('pLandSize','مساحة الأرض'),built_size:crmReadNumber('pBuiltSize','مساحة البناء'),description:el('pDesc').value.trim()||null,public_details:null,map_url:map||null,owner_id:ownerId,wilayat:el('pWilayat').value.trim()||null,source_type:el('pSourceType').value||null,marketing_status:el('pMarketingStatus').value||null,has_listing_agreement:has,agreement_start_date:start||null,agreement_duration_months:duration,agreement_end_date:end,agreement_reminder_days:has?reminderDays(start,end):null};
      if(canViewFinancials()){data.owner_net=crmReadNumber('pOwnerNet','صافي المالك');data.expected_commission=crmReadNumber('pExpectedCommission','العمولة المتوقعة');}
      const date=el('pCreatedDate').value;if(date)data.created_at=new Date(date+'T12:00:00').toISOString();
      const editingId=window.editingProperty,propertyId=editingId||(propertyDraftId||(propertyDraftId=crmNewId()));data.images=await uploadPropertyImageDraft(propertyId);if(!data.images.length)data.images=null;
      let r;if(editingId)r=await crmDataFrom('properties').update(data).eq('id',propertyId).select('id').single();else{Object.assign(data,{id:propertyId,company_id:cid,added_by:currentUser.id,archived:false});r=await crmDataFrom('properties').insert(data).select('id').single();if(r.error&&r.error.code==='23505'){const existing=await crmDataFrom('properties').select('id').eq('id',propertyId).single();if(!existing.error&&existing.data)r=await crmDataFrom('properties').update(data).eq('id',propertyId).select('id').single();}}
      if(r.error)throw r.error;persisted=true;window.editingProperty=propertyId;
      const imageWarning=await commitPropertyImageDraft();
      try{await saveMarketingLinks(propertyId,links);}catch(e){showToast('تم حفظ العقار؛ تعذر حفظ رابط التسويق. بقيت النافذة مفتوحة لإعادة محاولة الرابط: '+e.message,'warning');loadProperties();loadDashboard();return;}
      await logSystemActivity(editingId?'edit':'create','property',propertyId,'حفظ العقار: '+title);crmFinishSave('mProperty');showToast(imageWarning||'تم حفظ العقار والصور وروابط التسويق',imageWarning?'warning':'success');loadProperties();loadDashboard();if(window.viewingProperty&&window.viewingProperty.id===propertyId)await viewProperty(propertyId);
    }catch(e){showToast((persisted?'حُفظ العقار لكن تعذر إكمال العملية: ':'لم يتم حفظ العقار: ')+e.message,'error');}finally{crmEndSave('mProperty');}
  };
  var oldOpen=window.openModal;window.openModal=function(id){injectPropertyFields();oldOpen(id);if(id==='mProperty'&&!window.editingProperty){if(el('pHasAgreement'))el('pHasAgreement').value='0';['pAgreementStart','pMarketingInstagramUrl','pMarketingOmanReelUrl','pMarketingYoutubeUrl'].forEach(function(x){if(el(x))el(x).value=''});if(el('pAgreementDuration'))el('pAgreementDuration').value='3';updatePropertyAgreementFields();}};

  var oldEdit=window.editProperty;window.editProperty=async function(id){injectPropertyFields();const p=await oldEdit(id);if(!p)return;['pMarketingInstagramUrl','pMarketingOmanReelUrl','pMarketingYoutubeUrl'].forEach(x=>{if(el(x))el(x).value='';});if(el('pMessagePreview')){el('pMessagePreview').textContent='';el('pMessagePreview').style.display='none';}el('pHasAgreement').value=p.has_listing_agreement?'1':'0';el('pAgreementStart').value=p.agreement_start_date||'';el('pAgreementDuration').value=p.agreement_duration_months||3;updatePropertyAgreementFields();return p;};
  var oldRun=window.runFollowUpEngine;window.runFollowUpEngine=async function(){var r=await oldRun();try{var q=await crmDataFrom('properties').select('id,title,agreement_end_date,agreement_reminder_days').eq('has_listing_agreement',true).neq('archived',true).neq('status','sold');if(!q.error){var rows=q.data||[],exp=rows.filter(p=>daysUntil2(p.agreement_end_date)<0),soon=rows.filter(p=>{var d=daysUntil2(p.agreement_end_date);return d>=0&&d<=Number(p.agreement_reminder_days||7)});if(exp.length)fueData.alerts.push({rule:'listingAgreementExpired',priority:'urgent',title:'🤝 عقود تسويق منتهية',count:exp.length,items:exp.slice(0,5).map(p=>({id:p.id,name:p.title,phone:null,meta:'انتهى منذ '+Math.abs(daysUntil2(p.agreement_end_date))+' يوم',action:'navigateProperties'}))});if(soon.length)fueData.alerts.push({rule:'listingAgreementEnding',priority:'warning',title:'🤝 عقود تسويق قاربت على الانتهاء',count:soon.length,items:soon.slice(0,5).map(p=>({id:p.id,name:p.title,phone:null,meta:'متبقي '+daysUntil2(p.agreement_end_date)+' يوم',action:'navigateProperties'}))});fueData.totalCount=fueData.alerts.reduce((s,a)=>s+a.count,0)}}catch(e){console.warn(e)}return r};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',injectPropertyFields);else injectPropertyFields();
})();
