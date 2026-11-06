/* Hot client alert (6 November 2026, owner's decision). Under «لوحة الإدارة · احمد · Habib Sons Real Estate» the owner sees
 * every serious buyer («🔥 مشتري جاد») and call request («📞 طلب اتصال») that the AI raised and he has not handled yet.
 * «فتح المحادثة» opens the client's chat in WhatsApp Business on the phone (like «متابعات اليوم»), not the CRM inbox.
 * Two sources: the owner's notifications (visit results write them), and chats the reply agent handed over as
 * «مشتري جاد» / «تفاوض» / «طلب اتصال» on either branch (Barka chats are assigned to the branch account, so their notification
 * does not reach him). «تم» on a chat is kept on this browser and comes back if the chat is handed over again. «فتح المحادثة» opens the
 * client's chat, «تم» marks it handled. A new one also shows a phone/desktop notification while the CRM is open.
 * Owner only; reads his own notifications (RLS). Checks every 45 seconds while the page is visible. */
(function(){
  'use strict';
  const byId=id=>document.getElementById(id);
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
  const isOwner=()=>typeof currentProfile!=='undefined'&&currentProfile&&currentProfile.role==='owner';
  const toast=(m,t)=>{if(typeof showToast==='function')showToast(m,t);};
  let seen=null,items=[],busy=false,hidden={};
  try{hidden=JSON.parse(localStorage.getItem('crmHotHidden')||'{}')||{};}catch{}
  const saveHidden=()=>{try{localStorage.setItem('crmHotHidden',JSON.stringify(hidden));}catch{}};
  const LABEL={barka:'بركاء',muscat:'مسقط'};
  const waLink=phone=>{const d=String(phone||'').replace(/\D/g,'');return d?'https://wa.me/'+d:'';};
  const businessLink=phone=>{
    const d=String(phone||'').replace(/\D/g,''),ua=navigator.userAgent||'';if(!d)return '';
    if(/Android/i.test(ua))return 'intent://send?phone='+d+'#Intent;scheme=whatsapp;package=com.whatsapp.w4b;S.browser_fallback_url='+encodeURIComponent(waLink(d))+';end';
    if(/iPhone|iPad|iPod/i.test(ua))return 'whatsapp-smb://send?phone='+d;
    return waLink(d);
  };
  const ago=d=>typeof timeAgo==='function'?timeAgo(d):String(d||'').slice(0,16);
  function host(){
    const head=document.querySelector('#page-dash .page-header');if(!head)return null;
    let box=byId('crmHotAlerts');
    if(!box){box=document.createElement('section');box.id='crmHotAlerts';box.className='cha';box.hidden=true;box.setAttribute('aria-live','polite');}
    const anchor=head.querySelector('.ops-account-line')||head.firstElementChild;
    if(anchor&&box.previousElementSibling!==anchor)anchor.after(box);
    return box;
  }
  function render(){
    const box=host();if(!box)return;
    box.hidden=!items.length;
    if(!items.length){box.innerHTML='';return;}
    box.innerHTML='<p class="cha-title">🔥 عملاء يحتاجونك الحين <b dir="ltr">'+items.length+'</b></p><ul class="cha-list">'+items.map(n=>
      '<li class="cha-row"><div class="cha-info"><strong dir="auto">'+esc(n.title)+'</strong>'+(n.body?'<small dir="auto">'+esc(n.body)+'</small>':'')+'<small class="cha-time">'+esc(ago(n.created_at))+'</small></div>'
      +'<div class="cha-actions">'+(n.phone?'<a class="btn-primary cha-open" href="'+esc(businessLink(n.phone))+'" rel="noopener noreferrer">فتح المحادثة</a>':'<button type="button" class="btn-primary" data-cha="open" data-id="'+esc(n.id)+'">فتح المحادثة</button>')+'<button type="button" class="btn-secondary" data-cha="done" data-id="'+esc(n.id)+'">تم</button></div></li>').join('')+'</ul>';
  }
  function ping(fresh){
    if(!fresh.length||typeof Notification==='undefined')return;
    const send=()=>{try{fresh.slice(0,3).forEach(n=>new Notification(n.title,{body:n.body||'',tag:'hot-'+n.id}));}catch(_){}};
    if(Notification.permission==='granted')send();
    else if(Notification.permission==='default')Notification.requestPermission().then(p=>{if(p==='granted')send();}).catch(()=>{});
  }
  async function load(){
    if(busy||!isOwner()||typeof supa==='undefined'||typeof currentUser==='undefined'||!currentUser)return;
    busy=true;
    try{
      const since=new Date(Date.now()-7*86400000).toISOString();
      const r=await supa.from('notifications').select('id,title,body,client_id,created_at').eq('user_id',currentUser.id).eq('type','whatsapp_handoff')
        .eq('is_read',false).gte('created_at',since).order('created_at',{ascending:false}).limit(60);
      if(r.error)return;
      const list=(r.data||[]).filter(n=>/^(🔥|📞)/.test(String(n.title||''))).map(n=>({...n,kind:'n'}));
      const c=await supa.from('whatsapp_conversations').select('id,client_id,customer_name,customer_wa_id,route_key,handoff_reason,updated_at,clients(name,phone,phone_normalized)')
        .eq('human_handoff_required',true).in('route_key',['barka','muscat']).gte('updated_at',since).order('updated_at',{ascending:false}).limit(80);
      for(const w of (c.error?[]:c.data||[])){
        const why=String(w.handoff_reason||'');if(!/^(مشتري جاد|تفاوض|طلب اتصال)/.test(why))continue;
        const id='c-'+w.id+'-'+w.updated_at;if(hidden[id])continue;
        if(list.some(n=>n.client_id&&n.client_id===w.client_id))continue;
        list.push({id,kind:'c',conversation_id:w.id,client_id:w.client_id,created_at:w.updated_at,phone:(w.clients&&(w.clients.phone_normalized||w.clients.phone))||w.customer_wa_id,
          title:(/^طلب اتصال/.test(why)?'📞 طلب اتصال':'🔥 مشتري جاد')+': '+((w.clients&&w.clients.name)||w.customer_name||'عميل')+' · '+(LABEL[w.route_key]||''),body:why});
      }
      const need=[...new Set(list.filter(n=>!n.phone&&n.client_id).map(n=>n.client_id))];
      if(need.length){const p=await supa.from('clients').select('id,phone,phone_normalized').in('id',need);const m=new Map((p.data||[]).map(x=>[x.id,x.phone_normalized||x.phone]));list.forEach(n=>{if(!n.phone&&n.client_id)n.phone=m.get(n.client_id)||'';});}
      list.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
      if(seen)ping(list.filter(n=>!seen.has(n.id)));
      seen=new Set(list.map(n=>n.id));items=list.slice(0,20);render();
    }finally{busy=false;}
  }
  async function openChat(n){
    if(n.conversation_id&&typeof openDashboardWhatsAppConversation==='function'){openDashboardWhatsAppConversation(n.conversation_id);return;}
    if(!n.client_id){if(typeof navigate==='function')navigate('whatsapp',null);return;}
    const c=await supa.from('whatsapp_conversations').select('id').eq('client_id',n.client_id).order('last_message_at',{ascending:false}).limit(1).maybeSingle();
    if(c.data&&typeof openDashboardWhatsAppConversation==='function')openDashboardWhatsAppConversation(c.data.id);
    else if(typeof viewClient==='function')viewClient(n.client_id);
  }
  document.addEventListener('click',e=>{
    const b=e.target.closest('[data-cha]');if(!b)return;
    const n=items.find(x=>x.id===b.dataset.id);if(!n)return;
    if(b.dataset.cha==='open')openChat(n).catch(()=>toast('ما قدرت أفتح المحادثة','error'));
    if(b.dataset.cha==='done'&&n.kind==='c'){hidden[n.id]=Date.now();saveHidden();items=items.filter(x=>x.id!==n.id);render();return;}
    if(b.dataset.cha==='done'){b.disabled=true;supa.from('notifications').update({is_read:true}).eq('id',n.id).then(r=>{if(r.error)throw r.error;items=items.filter(x=>x.id!==n.id);seen.delete(n.id);render();}).catch(()=>{b.disabled=false;toast('ما انحفظ. جرب مرة ثانية','error');});}
  });
  window.crmHotAlertsRefresh=()=>load().catch(()=>{});
  setInterval(()=>{if(document.visibilityState==='visible')window.crmHotAlertsRefresh();},45000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)window.crmHotAlertsRefresh();});
  const loadDash=window.loadDashboard;
  if(typeof loadDash==='function')window.loadDashboard=function(){const r=loadDash.apply(this,arguments);setTimeout(window.crmHotAlertsRefresh,600);return r;};
})();
