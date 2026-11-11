/* WhatsApp buttons (11 Nov 2026, Ahmed: «في كل مكان يكون في زر للواتساب من التلفون وواتساب اللي في النظام»).
 * crmWaButtons({phone, conversationId, clientId}) returns two buttons used everywhere a chat can be opened:
 *  «فتح في واتساب الجوال»: WhatsApp Business on the phone (wa.me on a computer), like the daily follow-ups;
 *  «فتح في النظام»: the same chat in the CRM WhatsApp page.
 * With no phone or chat id at hand the button looks it up when pressed (chat → its customer number, client → its phone and
 * latest chat). Any sheet open over the home page closes first. */
(function(){
  'use strict';
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
  const digits=v=>String(v||'').replace(/\D/g,'');
  const waLink=d=>d?'https://wa.me/'+d:'';
  function phoneLink(phone){
    const d=digits(phone),ua=navigator.userAgent||'';if(!d)return '';
    if(/Android/i.test(ua))return 'intent://send?phone='+d+'#Intent;scheme=whatsapp;package=com.whatsapp.w4b;S.browser_fallback_url='+encodeURIComponent(waLink(d))+';end';
    if(/iPhone|iPad|iPod/i.test(ua))return 'whatsapp-smb://send?phone='+d;
    return waLink(d);
  }
  window.crmWaPhoneLink=phoneLink;
  window.crmWaButtons=function(o){
    o=o||{};const cls=o.cls||'btn-secondary',conv=o.conversationId||'',client=o.clientId||'',link=phoneLink(o.phone);
    const data=' data-conv="'+esc(conv)+'" data-client="'+esc(client)+'"';
    const phoneBtn=link?'<a class="'+cls+' crm-wa-phone" href="'+esc(link)+'"'+(/^https:/.test(link)?' target="_blank"':'')+' rel="noopener noreferrer">فتح في واتساب الجوال</a>'
      :(conv||client)?'<button type="button" class="'+cls+' crm-wa-phone" data-wa-phone="1"'+data+'>فتح في واتساب الجوال</button>':'';
    const crmBtn=(conv||client)?'<button type="button" class="'+cls+' crm-wa-crm" data-wa-crm="1"'+data+'>فتح في النظام</button>':'';
    return phoneBtn+crmBtn;
  };
  function closeSheets(){const x=document.querySelector('#cohSheet:not([hidden]) .coh-sheet-x');if(x)x.click();}
  async function latestChat(clientId){
    const r=await supa.from('whatsapp_conversations').select('id,customer_phone,customer_wa_id').eq('client_id',clientId).order('last_message_at',{ascending:false}).limit(1).maybeSingle();
    return r.data||null;
  }
  window.crmOpenCrmChat=async function(conv,client){
    if(!conv&&client){const c=await latestChat(client);conv=c&&c.id;}
    if(!conv){if(client&&typeof viewClient==='function')viewClient(client);else if(typeof showToast==='function')showToast('ما في محادثة واتساب لهذا العميل','error');return;}
    closeSheets();
    if(typeof openDashboardWhatsAppConversation==='function')openDashboardWhatsAppConversation(conv);
    else if(typeof navigate==='function'&&typeof openWhatsAppConversation==='function'){navigate('whatsapp',null);setTimeout(()=>openWhatsAppConversation(conv),300);}
  };
  async function phoneOf(conv,client){
    if(conv){const r=await supa.from('whatsapp_conversations').select('customer_phone,customer_wa_id').eq('id',conv).maybeSingle();if(r.data&&(r.data.customer_phone||r.data.customer_wa_id))return r.data.customer_phone||r.data.customer_wa_id;}
    if(client){const r=await supa.from('clients').select('phone,phone_normalized').eq('id',client).maybeSingle();if(r.data&&(r.data.phone_normalized||r.data.phone))return r.data.phone_normalized||r.data.phone;const c=await latestChat(client);if(c)return c.customer_phone||c.customer_wa_id;}
    return '';
  }
  document.addEventListener('click',e=>{
    const crm=e.target.closest('[data-wa-crm]');
    if(crm){e.preventDefault();window.crmOpenCrmChat(crm.dataset.conv||'',crm.dataset.client||'').catch(()=>{if(typeof showToast==='function')showToast('ما قدرت أفتح المحادثة','error');});return;}
    const ph=e.target.closest('[data-wa-phone]');
    if(ph){e.preventDefault();ph.disabled=true;phoneOf(ph.dataset.conv||'',ph.dataset.client||'').then(p=>{ph.disabled=false;const l=phoneLink(p);if(!l){if(typeof showToast==='function')showToast('ما في رقم لهذا العميل','error');return;}if(/^https:/.test(l))window.open(l,'_blank','noopener');else window.location.href=l;}).catch(()=>{ph.disabled=false;});}
  });
})();
