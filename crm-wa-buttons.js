/* WhatsApp buttons (11 Nov 2026, Ahmed: «في كل مكان يكون في زر للواتساب من التلفون وواتساب اللي في النظام»).
 * crmWaButtons({phone, conversationId, clientId}) returns two buttons used everywhere a chat can be opened:
 *  «فتح في واتساب الجوال»: WhatsApp Business on the phone (wa.me on a computer), like the daily follow-ups;
 *  «فتح في النظام»: the same chat in the CRM WhatsApp page.
 * With no phone or chat id at hand the button looks it up when pressed (chat → its customer number, client → its phone and
 * latest chat). Any sheet open over the home page closes first. The look is in crm-wa-buttons.css. */
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
  // 12 Nov 2026 (Ahmed: «ما جاي مرتب»): the buttons carry their own look (crm-wa-buttons.css), the same in every place.
  // A page's .btn-primary / .btn-secondary passed in cls is dropped. «crm-wa-small» in cls (or size:'sm') gives the small
  // pair for narrow cards, with the short words «الجوال» / «النظام» and the full words as the tooltip.
  const FULL={phone:'فتح في واتساب الجوال',crm:'فتح في النظام'},SHORT={phone:'الجوال',crm:'النظام'};
  window.crmWaButtons=function(o){
    o=o||{};const conv=o.conversationId||'',client=o.clientId||'',link=phoneLink(o.phone);
    const extra=String(o.cls||'').split(/\s+/).filter(c=>c&&!/^btn-(primary|secondary)$/.test(c));
    const small=o.size==='sm'||extra.indexOf('crm-wa-small')>=0;
    const cls='crm-wa-btn'+(small?' crm-wa-sm':'')+extra.filter(c=>c!=='crm-wa-small').map(c=>' '+esc(c)).join('');
    const tip=k=>small?' title="'+FULL[k]+'" aria-label="'+FULL[k]+'"':'',text=k=>small?SHORT[k]:FULL[k];
    // 12 Nov 2026 (Ahmed: the visits and owners tables too): with a number only (an owner has no client file) the CRM button
    // looks the chat up by that number when pressed.
    const byPhone=!conv&&!client?digits(o.phone):'';
    const data=' data-conv="'+esc(conv)+'" data-client="'+esc(client)+'"'+(byPhone?' data-phone="'+byPhone+'"':'');
    const phoneBtn=link?'<a class="'+cls+' crm-wa-phone" href="'+esc(link)+'"'+(/^https:/.test(link)?' target="_blank"':'')+' rel="noopener noreferrer"'+tip('phone')+'>'+text('phone')+'</a>'
      :(conv||client)?'<button type="button" class="'+cls+' crm-wa-phone" data-wa-phone="1"'+data+tip('phone')+'>'+text('phone')+'</button>':'';
    const crmBtn=(conv||client||byPhone)?'<button type="button" class="'+cls+' crm-wa-crm" data-wa-crm="1"'+data+tip('crm')+'>'+text('crm')+'</button>':'';
    // R58 (14 Nov 2026, Ahmed: «يكون بالمرة موجود في كل مكان»): «ملاحظة لـ Claude» beside the pair, for the owner and staff
    // (crm-claude-note.js). note:false where the place has its own note button with more context.
    const noteBtn=o.note!==false&&typeof window.crmClaudeNoteBtn==='function'?window.crmClaudeNoteBtn({conv:conv,client:client,phone:o.phone,name:o.name,small:small,cls:extra.filter(c=>c!=='crm-wa-small').join(' ')}):'';
    return phoneBtn+crmBtn+noteBtn;
  };
  function closeSheets(){const x=document.querySelector('#cohSheet:not([hidden]) .coh-sheet-x');if(x)x.click();}
  async function latestChat(clientId){
    const r=await supa.from('whatsapp_conversations').select('id,customer_phone,customer_wa_id').eq('client_id',clientId).order('last_message_at',{ascending:false}).limit(1).maybeSingle();
    return r.data||null;
  }
  // the latest chat of a number, among the chats this account may see (customer_wa_id is the number in digits)
  async function chatOfPhone(phone){
    const d=digits(phone);if(!d)return null;
    const r=await supa.from('whatsapp_conversations').select('id').eq('customer_wa_id',d).order('last_message_at',{ascending:false,nullsFirst:false}).limit(1).maybeSingle();
    return r.data||null;
  }
  window.crmOpenCrmChat=async function(conv,client,phone){
    if(!conv&&client){const c=await latestChat(client);conv=c&&c.id;}
    if(!conv&&!client&&phone){const c=await chatOfPhone(phone);conv=c&&c.id;if(!conv){if(typeof showToast==='function')showToast('ما في محادثة واتساب لهذا الرقم داخل النظام','error');return;}}
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
    if(crm){e.preventDefault();window.crmOpenCrmChat(crm.dataset.conv||'',crm.dataset.client||'',crm.dataset.phone||'').catch(()=>{if(typeof showToast==='function')showToast('ما قدرت أفتح المحادثة','error');});return;}
    const ph=e.target.closest('[data-wa-phone]');
    if(ph){e.preventDefault();ph.disabled=true;phoneOf(ph.dataset.conv||'',ph.dataset.client||'').then(p=>{ph.disabled=false;const l=phoneLink(p);if(!l){if(typeof showToast==='function')showToast('ما في رقم لهذا العميل','error');return;}if(/^https:/.test(l))window.open(l,'_blank','noopener');else window.location.href=l;}).catch(()=>{ph.disabled=false;});}
  });
})();
