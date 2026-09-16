(function(){
  var installed=false;
  function label(k){return k==='barka'?'بركاء':'مسقط'}
  function install(){
    if(installed)return;
    var oldLaunch=window.launchWhatsAppEmbeddedSignup;
    if(typeof oldLaunch!=='function')return;
    window.launchWhatsAppEmbeddedSignup=function(routeKey){
      if(routeKey!=='muscat'&&routeKey!=='barka')return oldLaunch(routeKey);
      if(typeof isOwner==='function'&&!isOwner()){showToast('فقط صاحب الشركة يمكنه ربط أرقام واتساب','error');return;}
      if(typeof FB==='undefined'||!FB.login){showToast('Meta لم يكتمل تحميله بعد. حدّث الصفحة وحاول مرة أخرى.','error');return;}
      var name=label(routeKey);
      showToast('سيفتح تفويض Meta للوصول إلى رقم '+name+' الحالي بدون نقل الرقم أو إلغاء WhatsApp Business','info');
      FB.login(async function(response){
        try{
          var auth=response&&response.authResponse;
          if(!auth||!auth.accessToken)throw new Error('لم يرجع Meta صلاحية الوصول');
          var r=await supa.functions.invoke('whatsapp-direct-bind',{body:{route_key:routeKey,user_access_token:auth.accessToken}});
          if(r.error)throw r.error;
          var d=r.data||{};
          if(!d.ok)throw new Error(d.message||d.error||'فشل الربط');
          showToast('تم ربط رقم '+name+' مع Meta والـCRM بنجاح','success');
          if(typeof loadLeadRouting==='function')await loadLeadRouting();
        }catch(e){
          var m=String(e&&e.message||e);
          if(m.indexOf('ROUTE_PHONE_NOT_FOUND_IN_BUSINESS_ASSETS')>=0)showToast('رقم '+name+' غير ظاهر بعد ضمن أصول واتساب في Meta. لا تعيد المحاولة الآن.','error');
          else showToast('تعذر ربط '+name+': '+m,'error');
        }
      },{scope:'business_management,whatsapp_business_management,whatsapp_business_messaging',return_scopes:true,auth_type:'rerequest'});
    };
    installed=true;
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
  window.addEventListener('load',install);
  setTimeout(install,700);setTimeout(install,1800);
})();