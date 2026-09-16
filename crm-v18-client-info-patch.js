(function(){
  function el(id){return document.getElementById(id)}
  function esc(v){return typeof escapeHtml==='function'?escapeHtml(String(v==null?'':v)):String(v==null?'':v).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]})}
  function row(label,value){return '<div class="info-row"><span class="info-label">'+esc(label)+'</span><span class="info-value">'+esc(value==null||value===''?'—':value)+'</span></div>'}
  function money(v){var n=Number(v);return Number.isFinite(n)&&n>0?n.toLocaleString('en-US')+' ر.ع':'—'}
  function budget(min,max){
    var a=Number(min),b=Number(max),ha=Number.isFinite(a)&&a>0,hb=Number.isFinite(b)&&b>0;
    if(!ha&&!hb)return '—';if(ha&&hb&&a===b)return money(a);if(ha&&hb)return money(a)+' — '+money(b);if(hb)return 'حتى '+money(b);return 'من '+money(a);
  }
  function sizes(min,max){
    var a=Number(min),b=Number(max),ha=Number.isFinite(a)&&a>0,hb=Number.isFinite(b)&&b>0;
    if(!ha&&!hb)return '—';if(ha&&hb&&a===b)return a.toLocaleString('en-US')+' م²';if(ha&&hb)return a.toLocaleString('en-US')+' — '+b.toLocaleString('en-US')+' م²';if(hb)return 'حتى '+b.toLocaleString('en-US')+' م²';return 'من '+a.toLocaleString('en-US')+' م²';
  }
  function reqType(v){return({buyer:'شراء',seller:'بيع عقار',tenant:'استئجار',landlord:'تأجير',consultation:'استشارة',investor:'استثمار'}[v]||v||'—')}
  function prop(v){return({villa:'فيلا',apartment:'شقة',house:'منزل',land:'أرض',land_residential:'أرض سكنية',twin_villa:'توين فيلا',resthouse:'استراحة',farm:'مزرعة',shop:'محل'}[v]||(typeof propTypeAr==='function'?propTypeAr(v):v)||'—')}
  function payment(v){return({cash:'نقد',bank_ready:'تمويل بنكي جاهز',needs_finance:'يحتاج تمويل',installment:'تقسيط',not_sure:'غير محدد',unclear:'غير واضح'}[v]||v||'—')}
  function timing(v){return({immediate:'فوري',this_week:'هذا الأسبوع',this_month:'هذا الشهر',within_30_days:'خلال 30 يومًا','31_90_days':'31–90 يومًا','3_months':'خلال 3 أشهر','3_6_months':'3–6 أشهر',over_6_months:'أكثر من 6 أشهر',just_looking:'يبحث فقط حاليًا'}[v]||v||'—')}
  function purpose(v){return({residence:'سكن',investment:'استثمار',rental:'تأجير',residency:'إقامة'}[v]||v||'—')}
  function searchStatus(v){return({active:'يبحث بنشاط',active_no_match:'يبحث ولا يوجد مطابق',waiting_new_property:'ينتظر عقارًا جديدًا',financing_in_progress:'التمويل قيد التجهيز',not_ready:'غير جاهز حاليًا',deferred:'مؤجل',stopped:'توقف عن البحث',bought_with_us:'اشترى عن طريقنا',bought_elsewhere:'اشترى من جهة أخرى',no_response:'لا يرد',unknown:'غير معروف'}[v]||v||'—')}
  function status(v){return({active:'نشط',paused:'متوقف مؤقتًا',won:'تم بنجاح',lost:'خاسر',cancelled:'ملغي',archived:'مؤرشف'}[v]||v||'—')}
  function areaText(r){return r.preferred_areas&&r.preferred_areas.length?r.preferred_areas.join('، '):(r.preferred_area||'—')}
  function propText(r){return r.property_types&&r.property_types.length?r.property_types.map(prop).join('، '):prop(r.property_type)}
  function requestBlock(r,index){
    var summary=r.ai_extracted&&r.ai_extracted.request_summary?r.ai_extracted.request_summary:'';
    var title=index===0?'الطلب الحالي':'طلب حالي آخر';
    var h='<div class="crm-current-request" style="border:1px solid var(--cream-deeper);border-radius:14px;padding:14px;margin-top:12px;background:white">';
    h+='<div style="font-weight:800;color:var(--espresso);margin-bottom:8px">'+title+'</div>';
    h+=row('نوع الطلب',reqType(r.request_type));
    h+=row('العقار المطلوب',propText(r));
    h+=row('المنطقة المطلوبة',areaText(r));
    if(r.wilayat)h+=row('الولاية / المحافظة',r.wilayat);
    h+=row('الميزانية',budget(r.budget_min,r.budget_max));
    if(r.bedrooms_min!=null)h+=row('غرف النوم','من '+r.bedrooms_min+' غرف');
    if(r.bathrooms_min!=null)h+=row('دورات المياه','من '+r.bathrooms_min);
    if(r.land_size_min!=null||r.land_size_max!=null)h+=row('مساحة الأرض',sizes(r.land_size_min,r.land_size_max));
    if(r.built_size_min!=null||r.built_size_max!=null)h+=row('مساحة البناء',sizes(r.built_size_min,r.built_size_max));
    h+=row('طريقة الدفع / التمويل',payment(r.payment_method));
    h+=row('موعد الشراء',timing(r.purchase_timing));
    h+=row('الغرض',purpose(r.purpose));
    if(r.search_status)h+=row('حالة البحث',searchStatus(r.search_status));
    h+=row('حالة الطلب',status(r.status));
    if(summary)h+=row('ملخص الطلب',summary);
    if(r.next_action)h+=row('الإجراء التالي',r.next_action);
    h+='</div>';return h;
  }
  function fallbackRequest(c){
    return {request_type:c.client_type,property_type:c.property_type,property_types:c.property_type?[c.property_type]:[],preferred_area:c.preferred_area,preferred_areas:c.preferred_area?[c.preferred_area]:[],wilayat:c.wilayat,budget_min:c.budget_min,budget_max:c.budget_max,payment_method:c.payment_method,purchase_timing:c.purchase_timing,purpose:c.purpose,status:c.status||'active'};
  }

  window.renderClientInfo=async function(){
    var c=typeof viewingClient!=='undefined'?viewingClient:null,root=el('cdTabInfo');if(!c||!root)return;
    var h='';
    h+=row('الهاتف',c.phone?((typeof formatPhoneDisplay==='function')?formatPhoneDisplay(c.phone):c.phone):'—');
    h+=row('البريد',c.email||'—');
    h+=row('المصدر',typeof sourceAr==='function'?sourceAr(c.source):c.source||'—');
    if(c.lead_route)h+=row('مسار الاستقبال',({muscat:'مسقط',barka:'بركاء',investment:'المشاريع الاستثمارية',general:'عام'}[c.lead_route]||c.lead_route));
    h+=row('الموظف المسؤول',c.agent&&c.agent.full_name?c.agent.full_name:'—');
    h+=row('تاريخ التسجيل',typeof fmtDate==='function'?fmtDate(c.created_at):(c.created_at||'—'));
    h+='<div id="crmCurrentRequests" style="margin-top:14px"><div style="font-size:12px;color:var(--umber)">جاري تحميل طلب العميل…</div></div>';
    root.innerHTML=h;
    try{
      var q=await supa.from('client_requests').select('*').eq('client_id',c.id).in('status',['active','paused']).order('updated_at',{ascending:false}).limit(5);
      if(q.error)throw q.error;
      if(typeof viewingClient==='undefined'||!viewingClient||viewingClient.id!==c.id)return;
      var reqs=q.data||[],box=el('crmCurrentRequests');if(!box)return;
      if(!reqs.length){
        var fb=fallbackRequest(c),has=fb.property_type||fb.preferred_area||Number(fb.budget_min)>0||Number(fb.budget_max)>0||fb.payment_method||fb.purchase_timing||fb.purpose;
        box.innerHTML=has?requestBlock(fb,0):'<div style="border:1px solid var(--cream-deeper);border-radius:12px;padding:14px;background:white;color:var(--umber)">لا يوجد طلب عقاري حالي مسجل لهذا العميل.</div>';
      }else box.innerHTML=reqs.map(requestBlock).join('');
    }catch(e){
      var box=el('crmCurrentRequests');if(box)box.innerHTML='<div style="color:var(--ruby);font-size:12px">تعذر تحميل تفاصيل الطلب الحالية.</div>';console.warn('[client unified info]',e);
    }
  };
})();
