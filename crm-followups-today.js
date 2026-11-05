/* Daily follow-ups (5 November 2026). The owner opens the CRM on the branch phone, taps a client, and WhatsApp opens
 * that chat with the prepared text. He sends it, which is free, and the reply agent carries on when the client answers.
 * A message he sends takes the client off the list by itself. Whatever is left goes out automatically at 10am the next day.
 * Owner sees both branches; a branch account sees its own (crm_followups_today). */
(function(){
  'use strict';
  const byId=id=>document.getElementById(id);
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
  const toast=(m,t)=>{if(typeof showToast==='function')showToast(m,t);};
  const LABEL={barka:'بركاء',muscat:'مسقط'};
  let data={items:[],auto_on:false},branch='all',seq=0;
  try{branch=localStorage.getItem('crmFollowupsBranch')||'all';}catch{}
  const waLink=(phone,text)=>{const d=String(phone||'').replace(/\D/g,'');return d?'https://wa.me/'+d+'?text='+encodeURIComponent(text||''):'';};
  const autoLine=i=>{
    if(!data.auto_on)return 'الإرسال التلقائي موقف الحين';
    if(!i.can_auto)return i.has_chat?'ما ينرسل تلقائي، ينتظرك أنت':'ما له محادثة عندنا، ينتظرك أنت';
    const when=new Date(i.auto_after).toLocaleDateString('ar-OM-u-nu-latn',{timeZone:'Asia/Muscat',weekday:'long',day:'numeric',month:'numeric'});
    return 'إذا ما أرسلت، ينرسل تلقائي '+when+' الساعة 10 الصبح';
  };
  function host(){
    const page=byId('page-dash');if(!page)return null;
    let box=byId('crmFollowups');
    if(!box){box=document.createElement('section');box.id='crmFollowups';box.className='card cfu';box.hidden=true;}
    const home=byId('crmOwnerHome'),header=page.querySelector('.page-header');
    if(home&&!home.hidden){if(box.parentNode!==home||home.firstChild!==box)home.prepend(box);}
    else if(header&&box.previousElementSibling!==header)header.after(box);
    return box;
  }
  function render(){
    const box=host();if(!box)return;
    const all=data.items||[],items=branch==='all'?all:all.filter(i=>i.route_key===branch);
    box.hidden=!all.length;
    if(!all.length){box.innerHTML='';return;}
    const tabs=[['all','الكل'],['barka','بركاء'],['muscat','مسقط']].map(([k,l])=>{const n=k==='all'?all.length:all.filter(i=>i.route_key===k).length;return '<button type="button" class="cfu-tab'+(branch===k?' on':'')+'" data-cfu="tab" data-v="'+k+'" aria-pressed="'+(branch===k)+'">'+l+' <b dir="ltr">'+n+'</b></button>';}).join('');
    box.innerHTML='<h2 class="cfu-title">متابعات اليوم <b dir="ltr">'+all.length+'</b></h2><p class="cfu-hint">افتح الصفحة من جوال الفرع، واضغط «فتح المحادثة» وأرسل. العميل ينشال من القائمة لحاله.</p><div class="cfu-tabs">'+tabs+'</div>'
      +(items.length?'<ul class="cfu-list">'+items.map(i=>{const url=waLink(i.phone,i.text);return '<li class="cfu-row"><div class="cfu-head"><strong>'+esc(i.client||'عميل')+'</strong><small>'+esc(LABEL[i.route_key]||i.route_key)+' · '+esc(i.reason)+(i.property?' · '+esc(i.property):'')+'</small></div>'
        +'<p class="cfu-text" dir="auto">'+esc(i.text)+'</p><small class="cfu-auto">'+esc(autoLine(i))+'</small>'
        +'<div class="cfu-actions">'+(url?'<a class="btn-primary cfu-open" href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">فتح المحادثة</a>':'<span class="cfu-auto">ما له رقم</span>')+'<button type="button" class="btn-secondary" data-cfu="done" data-id="'+esc(i.client_id)+'">أرسلتها</button></div></li>';}).join('')+'</ul>':'<p class="cfu-hint">ما في متابعات لهذا الفرع</p>');
  }
  async function load(){
    if(typeof supa==='undefined'||typeof currentProfile==='undefined'||!currentProfile)return;
    const n=++seq,r=await supa.rpc('crm_followups_today');
    if(n!==seq||r.error||!r.data)return;
    data=r.data;render();
  }
  document.addEventListener('click',e=>{
    const b=e.target.closest('[data-cfu]');if(!b)return;
    if(b.dataset.cfu==='tab'){branch=b.dataset.v;try{localStorage.setItem('crmFollowupsBranch',branch);}catch{}render();}
    if(b.dataset.cfu==='done'){b.disabled=true;supa.rpc('crm_followup_mark_sent',{p_client:b.dataset.id}).then(r=>{if(r.error)throw r.error;return load();}).catch(()=>{b.disabled=false;toast('ما انحفظ. جرب مرة ثانية','error');});}
  });
  // Back from WhatsApp: the sent message has reached the system, so the list shrinks.
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&byId('page-dash')?.classList.contains('active'))setTimeout(()=>load().catch(()=>{}),2500);});
  window.crmFollowupsRefresh=()=>load().catch(()=>{});
  const loadDash=window.loadDashboard;
  if(typeof loadDash==='function')window.loadDashboard=function(){const r=loadDash.apply(this,arguments);setTimeout(window.crmFollowupsRefresh,800);return r;};
})();
