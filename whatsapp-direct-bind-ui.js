(function(){
  var wrapped=false;
  var clickBound=false;
  function label(k){return k==='barka'?'بركاء':k==='investment'?'المشاريع الاستثمارية':'مسقط'}
  function toast(msg,type){try{if(typeof showToast==='function')showToast(msg,type||'info')}catch(_e){}}

  async function directBind(routeKey){
    if(routeKey!=='muscat'&&routeKey!=='barka')return false;
    if(typeof isOwner==='function'&&!isOwner()){toast('فقط صاحب الشركة يمكنه ربط أرقام واتساب','error');return true;}
    if(typeof FB==='undefined'||!FB.login){toast('Meta لم يكتمل تحميله بعد. حدّث الصفحة وحاول مرة أخرى.','error');return true;}
    var name=label(routeKey);
    toast('جاري فتح تفويض Meta لرقم '+name+'...','info');
    try{
      FB.login(async function(response){
        try{
          var auth=response&&response.authResponse;
          if(!auth||!auth.accessToken)throw new Error('لم يرجع Meta صلاحية الوصول');
          toast('تم التفويض. جاري التحقق من رقم '+name+' وربطه...','info');
          var r=await supa.functions.invoke('whatsapp-direct-bind',{body:{route_key:routeKey,user_access_token:auth.accessToken}});
          if(r.error)throw r.error;
          var d=r.data||{};
          if(!d.ok)throw new Error(d.message||d.error||'فشل الربط');
          toast('تم ربط رقم '+name+' مع Meta والـCRM بنجاح','success');
          if(typeof loadLeadRouting==='function')await loadLeadRouting();
        }catch(e){
          var m=String(e&&e.message||e);
          if(m.indexOf('ROUTE_PHONE_NOT_FOUND_IN_BUSINESS_ASSETS')>=0)toast('رقم '+name+' غير ظاهر بعد ضمن أصول واتساب في Meta. لا تعيد المحاولة الآن.','error');
          else toast('تعذر ربط '+name+': '+m,'error');
        }
      },{scope:'business_management,whatsapp_business_management,whatsapp_business_messaging',return_scopes:true,auth_type:'rerequest'});
    }catch(e){toast('تعذر فتح Meta: '+String(e&&e.message||e),'error');}
    return true;
  }

  function nearestRouteForButton(btn){
    var keys=['muscat','barka','investment'];
    var best=null,bestScore=1e9;
    keys.forEach(function(k){
      var input=document.getElementById('routePhone_'+k);if(!input)return;
      var bAnc=[],n=btn;while(n&&bAnc.length<14){bAnc.push(n);n=n.parentElement;}
      n=input;var d=0;while(n&&d<14){var bi=bAnc.indexOf(n);if(bi>=0){var score=bi+d;if(score<bestScore){bestScore=score;best=k;}break;}n=n.parentElement;d++;}
    });
    return best;
  }

  function bindCaptureClick(){
    if(clickBound)return;
    document.addEventListener('click',function(ev){
      var btn=ev.target&&ev.target.closest?ev.target.closest('button'):null;
      if(!btn)return;
      var txt=String(btn.textContent||'').replace(/\s+/g,' ').trim();
      if(txt.indexOf('Meta')<0)return;
      var routeKey=nearestRouteForButton(btn);
      if(routeKey!=='barka')return;
      ev.preventDefault();ev.stopPropagation();if(ev.stopImmediatePropagation)ev.stopImmediatePropagation();
      directBind('barka');
    },true);
    clickBound=true;
  }

  function wrapLegacy(){
    if(wrapped)return;
    var oldLaunch=window.launchWhatsAppEmbeddedSignup;
    if(typeof oldLaunch!=='function')return;
    window.launchWhatsAppEmbeddedSignup=function(routeKey){
      if(routeKey==='muscat'||routeKey==='barka')return directBind(routeKey);
      return oldLaunch.apply(this,arguments);
    };
    wrapped=true;
  }

  function install(){bindCaptureClick();wrapLegacy();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
  window.addEventListener('load',install);
  setTimeout(install,300);setTimeout(install,900);setTimeout(install,1800);setTimeout(install,3500);setTimeout(install,6500);
  window.HabibDirectMetaBind=directBind;
})();