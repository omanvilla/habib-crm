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

  function missingLabel(k){
    return ({location:'المنطقة',property_type:'نوع العقار',budget:'الميزانية',payment_method:'طريقة الدفع',purchase_timing:'موعد الشراء',bedrooms:'عدد الغرف'})[k]||k;
  }
  async function showActiveChatMissingRequirements(){
    try{
      if(typeof waInboxActiveConversation==='undefined'||!waInboxActiveConversation||!waInboxActiveConversation.client_id)return;
      var conversationId=waInboxActiveConversation.id,clientId=waInboxActiveConversation.client_id;
      var q=await supa.from('client_requests').select('id,missing_required_fields,status,updated_at').eq('client_id',clientId).in('status',['active','paused']).order('updated_at',{ascending:false}).limit(20);
      if(q.error)throw q.error;
      if(typeof waInboxActiveConversation==='undefined'||!waInboxActiveConversation||waInboxActiveConversation.id!==conversationId)return;
      var rows=(q.data||[]).filter(function(r){return Array.isArray(r.missing_required_fields)&&r.missing_required_fields.length});
      var old=el('waMissingRequirements');if(old)old.remove();
      if(!rows.length)return;
      var fields=[];rows.forEach(function(r){r.missing_required_fields.forEach(function(f){if(fields.indexOf(f)<0)fields.push(f)})});
      var strip=el('waClientStrip');if(!strip)return;
      var box=document.createElement('div');box.id='waMissingRequirements';
      box.style.cssText='width:100%;background:#fff7ed;border:1px solid #fdba74;color:#9a3412;padding:8px 10px;border-radius:9px;margin-bottom:7px;font-size:11px;line-height:1.7';
      box.innerHTML='<strong>بيانات ناقصة في الطلب:</strong> '+fields.map(function(f){return escapeHtml(missingLabel(f))}).join('، ');
      strip.insertBefore(box,strip.firstChild);
    }catch(e){console.warn('[WhatsApp missing requirements]',e)}
  }
  var oldRenderWhatsApp=window.renderWhatsAppChat;
  if(typeof oldRenderWhatsApp==='function'){
    window.renderWhatsAppChat=function(){var r=oldRenderWhatsApp.apply(this,arguments);setTimeout(showActiveChatMissingRequirements,0);return r};
  }

  var oldFollowUp=window.runFollowUpEngine;
  if(typeof oldFollowUp==='function'){
    window.runFollowUpEngine=async function(){
      var result=await oldFollowUp.apply(this,arguments);
      try{
        var since=new Date(Date.now()-7*86400000).toISOString();
        var q=await supa.from('client_requests')
          .select('id,client_id,missing_required_fields,last_contact_at,client:clients(id,name,phone)')
          .in('status',['active','paused']).gte('last_contact_at',since)
          .order('last_contact_at',{ascending:false}).limit(200);
        if(q.error)throw q.error;
        var rows=(q.data||[]).filter(function(r){return Array.isArray(r.missing_required_fields)&&r.missing_required_fields.length>0});
        if(rows.length){
          var hasLocation=rows.some(function(r){return r.missing_required_fields.indexOf('location')>=0});
          if(typeof fueData!=='undefined'){
            fueData.alerts=(fueData.alerts||[]).filter(function(a){return a.rule!=='missingRequestRequirements'});
            fueData.alerts.push({
              rule:'missingRequestRequirements',
              priority:hasLocation?'urgent':'warning',
              title:'طلبات حديثة تحتاج استكمال بيانات',
              count:rows.length,
              items:rows.slice(0,5).map(function(r){
                var c=Array.isArray(r.client)?r.client[0]:r.client;
                return {id:r.client_id,name:(c&&c.name)||'عميل',phone:(c&&c.phone)||null,meta:r.missing_required_fields.map(missingLabel).join('، '),action:'viewClient'};
              })
            });
            fueData.totalCount=(fueData.alerts||[]).reduce(function(n,a){return n+Number(a.count||0)},0);
          }
        }
      }catch(e){console.warn('[Missing requirements alert]',e)}
      return result;
    };
  }

  function run(){hideLegacyLeadForm();stripLegacyShareLinks()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);else run();
  setTimeout(run,1200);
})();
