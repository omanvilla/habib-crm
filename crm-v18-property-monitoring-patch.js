(function(){
  function el(id){return document.getElementById(id)}
  function esc(v){return typeof escapeHtml==='function'?escapeHtml(String(v==null?'':v)):String(v==null?'':v).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]})}
  function alertTitle(x){
    if(!x)return 'الأداء طبيعي';
    if(x.alert_type==='new_needs_photography')return 'لم يُنشر Reel إنستغرام للعقار بعد';
    if(x.alert_type==='no_inquiry_5d')return String(x.days_without_inquiry||5)+' أيام دون استفسار جديد';
    if(x.alert_type==='repeated_obstacle')return 'ملاحظة متكررة من عملاء مختلفين: '+(x.top_rejection_label||'ملاحظة مسجلة');
    if(x.alert_type==='photography_refresh_required')return 'إعادة تصوير مطلوبة لسبب مسجل';
    return 'الأداء طبيعي';
  }
  window.propertyAlertTitle=alertTitle;

  window.loadPropertyActionQueue=async function(target){
    var mount=target==='dashboard'?el('dashPropertyActionQueue'):el('propertyActionQueuePanel');if(!mount)return;
    try{
      var r=await supa.rpc('crm_property_action_queue',{p_branch_key:null});if(r.error)throw r.error;
      window.propertyActionQueueCache=r.data||[];
      var rows=window.propertyActionQueueCache;
      if(!rows.length){
        mount.innerHTML=target==='properties'?'<div style="margin-bottom:14px;background:#ECFDF5;border:1px solid #A7F3D0;border-radius:12px;padding:11px 14px;font-size:12px;color:#166534">لا توجد عقارات تحتاج تدخلاً حالياً.</div>':'';
        return;
      }
      var limit=target==='dashboard'?5:12,shown=rows.slice(0,limit);
      var h='<div class="card" style="margin-bottom:16px;border:1px solid #F2C46D;background:linear-gradient(135deg,#FFFDF8,#FFF8E8)"><div class="card-head"><div><div class="card-title">عقارات تحتاج إجراء <span class="badge b-em">'+rows.length+'</span></div><div style="font-size:11px;color:var(--umber);margin-top:3px">لا يظهر العقار هنا إلا بعد تحقق سبب فعلي يحتاج متابعة.</div></div>'+(target==='dashboard'?'<button class="btn-secondary" onclick="navigate(\'properties\',document.querySelector(\'[onclick*=properties]\'))">كل العقارات ←</button>':'')+'</div><div style="padding:8px 14px 14px">';
      shown.forEach(function(x){
        var meta=[];
        if(Number(x.unique_inquirers)>0)meta.push(x.unique_inquirers+' مستفسر');
        if(x.alert_type==='no_inquiry_5d'&&Number(x.unique_inquirers||0)===0)meta.push(x.days_without_inquiry+' أيام دون استفسار');
        if(Number(x.unique_visitors)>0)meta.push(x.unique_visitors+' زائر');
        if(Number(x.top_rejection_clients)>=2)meta.push(x.top_rejection_clients+' عملاء كرروا نفس الملاحظة');
        if(!meta.length&&x.area)meta.push(x.area);
        h+='<div onclick="viewProperty(\''+x.property_id+'\')" style="cursor:pointer;background:white;border:1px solid var(--cream-deeper);border-radius:12px;padding:11px 13px;margin-top:8px;display:flex;gap:10px;justify-content:space-between;align-items:center;flex-wrap:wrap"><div style="min-width:220px;flex:1"><div style="font-weight:800;color:var(--espresso)">'+esc(x.internal_name||x.title||'عقار')+(x.property_code?' <span style="font-size:10px;color:var(--gold)">#'+esc(x.property_code)+'</span>':'')+'</div><div style="font-size:12px;color:var(--ruby);margin-top:4px">'+esc(alertTitle(x))+'</div><div style="font-size:10px;color:var(--umber);margin-top:4px">'+esc(meta.join(' · '))+'</div></div><div>'+(typeof priorityBadgeAr==='function'?priorityBadgeAr(x.alert_priority):'')+'</div></div>';
      });
      if(rows.length>limit)h+='<div style="text-align:center;font-size:11px;color:var(--umber);padding-top:10px">+'+(rows.length-limit)+' عقار آخر يحتاج مراجعة</div>';
      mount.innerHTML=h+'</div></div>';
    }catch(err){
      console.warn('[Property Action Queue patch]',err);
      mount.innerHTML='<div style="margin-bottom:12px;font-size:11px;color:var(--ruby)">تعذر تحميل تنبيهات أداء العقارات: '+esc(err.message||String(err))+'</div>';
    }
  };

  var oldSaveMarketing=window.savePropertyMarketingEvent;
  if(typeof oldSaveMarketing==='function')window.savePropertyMarketingEvent=async function(){
    var r=await oldSaveMarketing.apply(this,arguments);
    try{await window.loadPropertyActionQueue('properties');await window.loadPropertyActionQueue('dashboard')}catch(_e){}
    return r;
  };

  var oldSaveProperty=window.saveProperty;
  if(typeof oldSaveProperty==='function')window.saveProperty=async function(){
    var r=await oldSaveProperty.apply(this,arguments);
    try{await window.loadPropertyActionQueue('properties');await window.loadPropertyActionQueue('dashboard')}catch(_e){}
    return r;
  };
})();
