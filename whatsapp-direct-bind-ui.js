(function(){
  var V='v4.1';
  var DESIRED='تفويض وربط رقم مسقط';
  function muscatButton(){
    var buttons=[].slice.call(document.querySelectorAll('button[onclick*="launchWhatsAppEmbeddedSignup"]'));
    return buttons.find(function(b){return (b.getAttribute('onclick')||'').indexOf("'muscat'")>=0;})||null;
  }
  function markButton(){
    var b=muscatButton();
    if(!b)return;
    if(b.textContent!==DESIRED)b.textContent=DESIRED;
    if(b.getAttribute('data-meta-bind-version')!==V)b.setAttribute('data-meta-bind-version',V);
    var title='ربط مباشر مع Meta — '+V;
    if(b.title!==title)b.title=title;
  }
  async function bindWithToken(token){
    showToast('جاري تثبيت ربط رقم مسقط مع Meta...','info');
    var r=await supa.functions.invoke('whatsapp-direct-bind',{body:{route_key:'muscat',user_access_token:token}});
    var d=r&&r.data?r.data:{};
    if(r&&r.error&&!d.message)throw r.error;
    if(!d.ok)throw new Error(d.message||d.error||'فشل الربط');
    showToast('تم ربط رقم مسقط واشتراك التطبيق في Webhooks بنجاح','success');
    if(typeof loadLeadRouting==='function')await loadLeadRouting();
    markButton();
  }
  function installDirectBind(){
    var oldLaunch=window.launchWhatsAppEmbeddedSignup;
    if(!oldLaunch||oldLaunch.__directBindV41Installed){markButton();return;}
    function directBind(routeKey){
      if(routeKey!=='muscat')return oldLaunch(routeKey);
      if(typeof isOwner==='function'&&!isOwner()){showToast('فقط صاحب الشركة يمكنه ربط رقم مسقط','error');return;}
      try{supa.functions.invoke('whatsapp-direct-bind',{body:{route_key:'muscat',probe_only:true}}).catch(function(){});}catch(_e){}
      if(typeof FB==='undefined'||!FB.login){showToast('Meta SDK لم يكتمل تحميله. حدّث الصفحة مرة واحدة ثم اضغط الزر الجديد.','error');return;}
      showToast('جاري فتح تفويض Meta...','info');
      FB.login(function(response){
        var token=response&&response.authResponse&&response.authResponse.accessToken;
        if(!token){showToast('لم يكتمل تفويض Meta أو تم إغلاق النافذة','error');return;}
        bindWithToken(token).catch(function(e){
          console.error('[whatsapp direct bind v4.1]',e);
          showToast('تعذّر ربط رقم مسقط: '+(e&&e.message?e.message:String(e)),'error');
        });
      },{scope:'business_management,whatsapp_business_management,whatsapp_business_messaging',auth_type:'rerequest',return_scopes:true});
    }
    directBind.__directBindV41Installed=true;
    window.launchWhatsAppEmbeddedSignup=directBind;
    markButton();
  }
  var queued=false;
  function scheduleInstall(){
    if(queued)return;
    queued=true;
    requestAnimationFrame(function(){queued=false;installDirectBind();markButton();});
  }
  function boot(){
    installDirectBind();markButton();
    new MutationObserver(scheduleInstall).observe(document.body,{childList:true,subtree:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
  window.addEventListener('load',scheduleInstall);
  setTimeout(scheduleInstall,700);
  setTimeout(scheduleInstall,1600);
})();
