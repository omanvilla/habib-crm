(function(){
  function el(id){return document.getElementById(id)}
  function hideLegacyLeadForm(){
    var card=el('leadFormCard');if(card)card.style.display='none';
    document.querySelectorAll('[onclick="copyLeadFormLink()"],[onclick="shareLeadFormWA()"]').forEach(function(x){x.style.display='none'});
  }
  function stripLegacyShareLinks(){
    var box=el('leadRoutingRows');if(!box)return;
    box.querySelectorAll('.share-link-input').forEach(function(x){x.remove()});
    box.querySelectorAll('div').forEach(function(x){
      var t=(x.textContent||'').trim();
      if(t.indexOf('هذا الرابط يضع العميل تلقائياً في مسار')===0)x.remove();
    });
  }
  var oldRefresh=window.refreshLeadFormCard;
  if(typeof oldRefresh==='function'){
    window.refreshLeadFormCard=function(){var r=oldRefresh.apply(this,arguments);hideLegacyLeadForm();return r};
  }
  var oldLoadRouting=window.loadLeadRouting;
  if(typeof oldLoadRouting==='function'){
    window.loadLeadRouting=async function(){var r=await oldLoadRouting.apply(this,arguments);stripLegacyShareLinks();hideLegacyLeadForm();return r};
  }
  window.getLeadFormUrl=function(){return ''};
  window.copyLeadFormLink=function(){if(typeof showToast==='function')showToast('تم إلغاء نموذج العملاء؛ الاستقبال الآن عبر واتساب','success')};
  window.shareLeadFormWA=function(){if(typeof showToast==='function')showToast('تم إلغاء نموذج العملاء؛ الاستقبال الآن عبر واتساب','success')};
  function run(){hideLegacyLeadForm();stripLegacyShareLinks()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);else run();
  setTimeout(run,1200);
})();
