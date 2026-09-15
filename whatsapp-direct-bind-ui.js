(function(){
  var VERSION='v6-official-es-new-config';
  var FALLBACK_CONFIG_ID='1790225632111798';
  var installed=false;
  function logMeta(status,details){
    try{
      if(typeof supa==='undefined'||!supa.functions)return;
      supa.functions.invoke('whatsapp-meta-login-log',{body:{route_key:'muscat',status:status||'failed',details:details||{}}}).catch(function(){});
    }catch(_e){}
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
      var configId=String(row.meta_login_configuration_id||FALLBACK_CONFIG_ID).trim();
      try{
        waEmbeddedRouteKey=routeKey;
        waEmbeddedCode=null;
        waEmbeddedSessionInfo=null;
        waEmbeddedFinalizing=false;
      }catch(_e){}
      showToast('ستفتح نافذة Meta الرسمية لربط '+routePhone,'info');
      FB.login(function(response){
        var auth=response&&response.authResponse;
        var code=auth&&auth.code;
        var details={
          phase:'fb_callback',
          fb_status:response&&response.status||null,
          has_auth_response:!!auth,
          has_code:!!code,
          granted_scopes:auth&&auth.grantedScopes||null,
          denied_scopes:auth&&auth.deniedScopes||null,
          error:response&&response.error||null,
          error_reason:response&&response.error_reason||null,
          error_code:response&&response.error_code||null,
          error_description:response&&response.error_description||null,
          config_id:configId
        };
        logMeta(code?'started':'failed',details);
        if(!code){
          showToast('Meta أنهى النافذة لكنه لم يرجع رمز الربط. تم تسجيل السبب داخل النظام للفحص.','error');
          return;
        }
        try{
          waEmbeddedCode=code;
          scheduleEmbeddedSignupFinalize(1800);
        }catch(e){
          logMeta('failed',{phase:'schedule_finalize',error:String(e&&e.message||e),config_id:configId});
          showToast('تعذر إكمال الربط بعد موافقة Meta','error');
        }
      },{
        config_id:configId,
        response_type:'code',
        override_default_response_type:true,
        extras:{setup:{},featureType:'whatsapp_business_app_onboarding',sessionInfoVersion:'3'}
      });
    }
    launch.__officialEmbeddedSignupV6Installed=true;
    window.launchWhatsAppEmbeddedSignup=launch;
    window.addEventListener('message',function(event){
      var origin=String(event.origin||'');
      if(origin.indexOf('facebook.com')<0&&origin.indexOf('facebook.net')<0)return;
      var data=event.data;
      if(typeof data==='string'){try{data=JSON.parse(data);}catch(_e){return;}}
      if(!data||data.type!=='WA_EMBEDDED_SIGNUP')return;
      var d=data.data||{};
      logMeta(String(data.event||'')==='ERROR'?'failed':'started',{
        phase:'wa_embedded_event',
        wa_event:String(data.event||''),
        wa_error_message:d.error_message||d.error||null,
        current_step:d.current_step||null,
        waba_id:d.waba_id||d.wabaID||null,
        phone_number_id:d.phone_number_id||d.phoneNumberId||null,
        config_id:((typeof leadRouteData!=='undefined'&&leadRouteData&&leadRouteData.muscat&&leadRouteData.muscat.meta_login_configuration_id)||FALLBACK_CONFIG_ID)
      });
    });
    installed=true;
    console.info('[WhatsApp Meta] official Embedded Signup '+VERSION+' installed');
  }
  function boot(){install();if(!installed)setTimeout(install,500);if(!installed)setTimeout(install,1400);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
  window.addEventListener('load',install);
})();
