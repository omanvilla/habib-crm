(function(){
  function installDirectBind(){
    var oldLaunch=window.launchWhatsAppEmbeddedSignup;
    if(!oldLaunch||oldLaunch.__directBindInstalled)return;
    async function directBind(routeKey){
      if(routeKey!=='muscat')return oldLaunch(routeKey);
      try{
        if(typeof isOwner==='function'&&!isOwner()){showToast('فقط صاحب الشركة يمكنه ربط رقم مسقط','error');return}
        showToast('جاري ربط رقم مسقط مباشرة مع Meta...','info');
        var r=await supa.functions.invoke('whatsapp-direct-bind',{body:{route_key:'muscat'}});
        var d=r&&r.data?r.data:{};
        if(r&&r.error&&!d.message)throw r.error;
        if(!d.ok)throw new Error(d.message||d.error||'فشل الربط المباشر');
        showToast('تم ربط رقم مسقط بالـCRM واشتراك التطبيق في Webhooks بنجاح','success');
        if(typeof loadLeadRouting==='function')await loadLeadRouting();
      }catch(e){
        console.error('[whatsapp direct bind]',e);
        showToast('تعذّر ربط رقم مسقط: '+(e&&e.message?e.message:String(e)),'error');
      }
    }
    directBind.__directBindInstalled=true;
    window.launchWhatsAppEmbeddedSignup=directBind;
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installDirectBind);else installDirectBind();
  window.addEventListener('load',installDirectBind);
  setTimeout(installDirectBind,800);
  setTimeout(installDirectBind,1800);
})();
