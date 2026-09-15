(function(){
  function installDirectBind(){
    var oldLaunch=window.launchWhatsAppEmbeddedSignup;
    if(!oldLaunch||oldLaunch.__directBindV3Installed)return;
    function directBind(routeKey){
      if(routeKey!=='muscat')return oldLaunch(routeKey);
      if(typeof isOwner==='function'&&!isOwner()){showToast('فقط صاحب الشركة يمكنه ربط رقم مسقط','error');return}
      if(typeof FB==='undefined'||!FB.login){showToast('Meta SDK لم يكتمل تحميله بعد. حدّث الصفحة وحاول مرة أخرى.','error');return}
      showToast('سيظهر تفويض Meta لإكمال ربط رقم مسقط','info');
      FB.login(async function(response){
        var token=response&&response.authResponse&&response.authResponse.accessToken;
        if(!token){showToast('لم يكتمل تفويض Meta','error');return}
        try{
          showToast('جاري ربط رقم مسقط بحساب واتساب الحقيقي...','info');
          var r=await supa.functions.invoke('whatsapp-direct-bind',{body:{route_key:'muscat',user_access_token:token}});
          var d=r&&r.data?r.data:{};
          if(r&&r.error&&!d.message)throw r.error;
          if(!d.ok)throw new Error(d.message||d.error||'فشل الربط');
          showToast('تم ربط رقم مسقط بالـCRM واشتراك التطبيق في Webhooks بنجاح','success');
          if(typeof loadLeadRouting==='function')await loadLeadRouting();
        }catch(e){
          console.error('[whatsapp direct bind v3]',e);
          showToast('تعذّر ربط رقم مسقط: '+(e&&e.message?e.message:String(e)),'error');
        }
      },{scope:'business_management,whatsapp_business_management,whatsapp_business_messaging',auth_type:'rerequest',return_scopes:true});
    }
    directBind.__directBindV3Installed=true;
    window.launchWhatsAppEmbeddedSignup=directBind;
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installDirectBind);else installDirectBind();
  window.addEventListener('load',installDirectBind);
  setTimeout(installDirectBind,800);
  setTimeout(installDirectBind,1800);
})();
