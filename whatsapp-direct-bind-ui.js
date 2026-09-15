(function(){
  var VERSION='v8-direct-waba-permanent-token';
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
  async function savePermanentSystemToken(){
    var input=document.getElementById('waPermanentSystemTokenInput');
    var btn=document.getElementById('waPermanentSystemTokenSave');
    if(!input)return;
    var token=String(input.value||'').trim();
    if(!token){showToast('ألصق System User token الدائم أولاً','error');return;}
    if(btn){btn.disabled=true;btn.textContent='جاري التحقق...';}
    showToast('جاري التحقق من المفتاح الدائم وحفظه بشكل مشفّر...','info');
    try{
      var r=await supa.functions.invoke('whatsapp-save-system-token',{body:{route_key:'muscat',system_access_token:token}});
      if(r.error)throw r.error;
      var d=r.data||{};
      if(!d.ok)throw new Error(d.message||d.error||'فشل حفظ المفتاح الدائم');
      input.value='';
      var status=document.getElementById('waPermanentSystemTokenStatus');
      if(status)status.textContent='مفتاح الخادم الدائم مثبت';
      showToast('تم تثبيت مفتاح واتساب الدائم لمسقط بنجاح','success');
    }catch(e){
      showToast('تعذر تثبيت المفتاح الدائم: '+String(e&&e.message||e),'error');
    }finally{
      if(btn){btn.disabled=false;btn.textContent='تحقق وحفظ';}
    }
  }
  function installPermanentTokenUI(){
    try{
      if(typeof isOwner==='function'&&!isOwner())return;
      if(document.getElementById('waPermanentSystemTokenBox'))return;
      var routeInput=document.getElementById('routePhone_muscat');
      if(!routeInput)return;
      var anchor=routeInput.closest('.field')||routeInput.parentElement||routeInput;
      var box=document.createElement('div');
      box.id='waPermanentSystemTokenBox';
      box.style.cssText='margin-top:10px;padding:12px;border:1px solid rgba(34,80,70,.16);border-radius:14px;background:rgba(255,255,255,.72);backdrop-filter:blur(10px);';
      box.innerHTML='<div style="font-weight:700;margin-bottom:5px">مفتاح واتساب الدائم للخادم</div><div id="waPermanentSystemTokenStatus" style="font-size:12px;opacity:.72;margin-bottom:8px">يُستخدم مرة واحدة فقط لتثبيت الإرسال الدائم بدون تجديد كل 60 يوم</div><div style="display:flex;gap:8px;flex-wrap:wrap"><input id="waPermanentSystemTokenInput" type="password" autocomplete="off" spellcheck="false" placeholder="ألصق System User token هنا" style="flex:1;min-width:240px;padding:10px 12px;border:1px solid rgba(0,0,0,.14);border-radius:10px"><button id="waPermanentSystemTokenSave" type="button" style="padding:10px 14px;border:0;border-radius:10px;cursor:pointer">تحقق وحفظ</button></div><div style="font-size:11px;opacity:.62;margin-top:6px">لا ترسل المفتاح في المحادثة. أدخله هنا فقط، وسيُحفظ مشفّرًا في الخادم.</div>';
      anchor.insertAdjacentElement('afterend',box);
      document.getElementById('waPermanentSystemTokenSave').addEventListener('click',savePermanentSystemToken);
    }catch(_e){}
  }
  function install(){
    if(!installed){
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
      launch.__directExistingWabaV8Installed=true;
      window.launchWhatsAppEmbeddedSignup=launch;
      installed=true;
      console.info('[WhatsApp Meta] '+VERSION+' installed');
    }
    installPermanentTokenUI();
  }
  function boot(){install();setTimeout(install,500);setTimeout(install,1400);setTimeout(install,3000);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
  window.addEventListener('load',install);
})();
