(function(){
  var VERSION='v7-direct-existing-waba';
  var installed=false;
  function logMeta(status,details){
    try{
      if(typeof supa==='undefined'||!supa.functions)return;
      supa.functions.invoke('whatsapp-meta-login-log',{body:{route_key:'muscat',status:status||'failed',details:details||{}}}).catch(function(){});
    }catch(_e){}
  }
  async function bindWithUserToken(token){
    showToast('جاري التحقق من حساب واتساب وربط التطبيق...','info');
    try{
      var r=await supa.functions.invoke('whatsapp-direct-bind',{body:{route_key:'muscat',user_access_token:token}});
      if(r.error)throw r.error;
      var d=r.data||{};
      if(!d.ok)throw new Error(d.message||d.error||'فشل الربط المباشر');
      showToast('تم ربط رقم مسقط بالتطبيق والـWebhook بنجاح','success');
      try{if(typeof loadLeadRouting==='function')await loadLeadRouting();}catch(_e){}
      logMeta('completed',{phase:'direct_bind_completed',waba_id:d.waba_id||null,phone_number_id:d.phone_number_id||null});
    }catch(e){
      var msg=String(e&&e.message||e);
      logMeta('failed',{phase:'direct_bind_failed',error:msg});
      showToast('تعذر الربط المباشر: '+msg,'error');
    }
  }
  function install(){
    if(installed)return;
    var oldLaunch=window.launchWhatsAppEmbeddedSignup;
    if(typeof oldLaunch!=='function')return;
    function launch(routeKey){
      if(routeKey!=='muscat')return oldLaunch(routeKey);
      if(typeof isOwner==='function'&&!isOwner()){showToast('فقط صاحب الشركة يمكنه ربط أرقام واتساب','error');return;}
      var row=(typeof leadRouteData!=='undefined'&&leadRouteData&&leadRouteData[routeKey])||{};
      var input=typeof $==='function'?$('routePhone_'+routeKey):null;
      var routePhone=String((input&&input.value)||row.whatsapp_number||'').trim();
      if(!routePhone){showToast('اكتب رقم واتساب للمسار واحفظه أولاً','error');return;}
      if(typeof FB==='undefined'||!FB.login){showToast('Meta SDK لم يكتمل تحميله بعد. حدّث الصفحة وحاول مرة أخرى.','error');return;}
      showToast('سيفتح تفويض Meta للوصول إلى حساب واتساب الحالي بدون نقل الرقم أو حذفه','info');
      FB.login(function(response){
        var auth=response&&response.authResponse;
        var token=auth&&auth.accessToken;
        logMeta(token?'started':'failed',{
          phase:'direct_user_login',
          fb_status:response&&response.status||null,
          has_auth_response:!!auth,
          has_code:false,
          granted_scopes:auth&&auth.grantedScopes||null,
          denied_scopes:auth&&auth.deniedScopes||null,
          error:response&&response.error||null,
          error_reason:response&&response.error_reason||null,
          error_code:response&&response.error_code||null,
          error_description:response&&response.error_description||null
        });
        if(!token){showToast('Meta لم يرجع صلاحية الوصول. تم تسجيل السبب للفحص.','error');return;}
        bindWithUserToken(token);
      },{
        scope:'business_management,whatsapp_business_management,whatsapp_business_messaging',
        return_scopes:true,
        auth_type:'rerequest'
      });
    }
    launch.__directExistingWabaV7Installed=true;
    window.launchWhatsAppEmbeddedSignup=launch;
    installed=true;
    console.info('[WhatsApp Meta] '+VERSION+' installed');
  }
  function boot(){install();if(!installed)setTimeout(install,500);if(!installed)setTimeout(install,1400);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
  window.addEventListener('load',install);
})();
