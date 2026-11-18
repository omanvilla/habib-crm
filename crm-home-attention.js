/* Owner home, top (18 Nov 2026, Ahmed's check, items 4 and 5). Two boxes right under «🔥 عملاء يحتاجونك الحين»:
 *   «🙋 مشترين واقفين»: buyers who asked a question in the last 7 days and nobody answered (crm_home_attention, SQL126).
 *      Name, the question, when, the two chat buttons (crm-wa-buttons.js) and «تم» (crm_waiting_buyer_done). A buyer leaves
 *      by himself once anyone answers him; «تم» hides him until he asks again.
 *   «📄 العقود»: agreements ending within 45 days, non-exclusive properties to confirm (button «متوفر» →
 *      crm_property_confirm_available) and new brokerage contracts to sign (the owner accepted the study).
 * Owner only, read every 90 seconds while the page is visible. If the function is missing or fails, nothing shows. */
(function(){
  'use strict';
  const byId=id=>document.getElementById(id);
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
  const isOwner=()=>typeof currentProfile!=='undefined'&&currentProfile&&currentProfile.role==='owner';
  const toast=(m,t)=>{if(typeof showToast==='function')showToast(m,t);};
  const BR={barka:'بركاء',muscat:'مسقط'};
  const ago=d=>typeof timeAgo==='function'?timeAgo(d):String(d||'').slice(0,16).replace('T',' ');
  const day=d=>d?new Date(d).toLocaleDateString('ar-OM-u-nu-latn',{timeZone:'Asia/Muscat',day:'numeric',month:'long'}):'';
  let data=null,busy=false,showAll=false;
  const FIRST=5; // the home stays short: the newest five, the rest behind «عرض الكل»
  function host(){
    const head=document.querySelector('#page-dash .page-header');if(!head)return null;
    let box=byId('crmHomeAttention');
    if(!box){box=document.createElement('div');box.id='crmHomeAttention';box.className='cat';box.hidden=true;}
    const after=byId('crmHotAlerts')||head.querySelector('.ops-account-line')||head.firstElementChild;
    if(after&&box.previousElementSibling!==after)after.after(box);
    return box;
  }
  const btns=(phone,conv,client)=>typeof window.crmWaButtons==='function'?window.crmWaButtons({phone,conversationId:conv,clientId:client,cls:'btn-primary'}):'';
  function waitingHtml(list){
    if(!list.length)return '';
    return '<section class="cat-box cat-wait" aria-label="مشترين واقفين"><p class="cat-title">🙋 مشترين واقفين، سألوا وما انرد عليهم <b dir="ltr">'+list.length+'</b></p><ul class="cat-list">'
      +(showAll?list:list.slice(0,FIRST)).map(w=>'<li class="cat-row"><div class="cat-info"><strong dir="auto">'+esc(w.name||'عميل')+(w.route?' · '+esc(BR[w.route]||''):'')+'</strong>'
        +'<small class="cat-q" dir="auto">«'+esc(w.question||'')+'»</small><small class="cat-time">'+esc(ago(w.asked_at))+'</small></div>'
        +'<div class="cat-actions">'+btns(w.phone,w.conversation_id,w.client_id)+'<button type="button" class="btn-secondary" data-cat="wait-done" data-id="'+esc(w.conversation_id)+'">تم</button></div></li>').join('')+'</ul>'
      +(list.length>FIRST?'<button type="button" class="btn-secondary cat-more" data-cat="more">'+(showAll?'عرض أقل':'عرض الكل ('+list.length+')')+'</button>':'')+'</section>';
  }
  function contractsHtml(d){
    const ex=d.expiring||[],un=d.unchecked||[],nc=d.new_contracts||[];
    if(!ex.length&&!un.length&&!nc.length)return '';
    const part=(title,rows)=>rows?'<div class="cat-part"><p class="cat-sub">'+title+'</p><ul class="cat-list">'+rows+'</ul></div>':'';
    return '<section class="cat-box cat-contracts" aria-label="العقود"><p class="cat-title">📄 العقود</p>'
      +part('تنتهي خلال 45 يوم <b dir="ltr">'+ex.length+'</b>',ex.map(p=>'<li class="cat-row"><div class="cat-info"><strong dir="auto">'+esc(p.name)+'</strong><small>ينتهي '+esc(day(p.end_date))+' · باقي '+esc(p.days_left)+' يوم'+(p.branch?' · '+esc(BR[p.branch]||''):'')+'</small></div>'
        +'<div class="cat-actions"><button type="button" class="btn-secondary" data-cat="prop" data-id="'+esc(p.id)+'">فتح العقار</button></div></li>').join(''))
      +part('غير حصرية تحتاج تأكيد توفر <b dir="ltr">'+un.length+'</b>',un.map(p=>'<li class="cat-row"><div class="cat-info"><strong dir="auto">'+esc(p.name)+'</strong><small>'+(p.checked_at?'آخر تأكيد '+esc(day(p.checked_at)):'ما تأكد توفره أبداً')+(p.status==='reserved'?' · محجوز':'')+(p.branch?' · '+esc(BR[p.branch]||''):'')+'</small></div>'
        +'<div class="cat-actions"><button type="button" class="btn-primary" data-cat="avail" data-id="'+esc(p.id)+'">متوفر</button><button type="button" class="btn-secondary" data-cat="prop" data-id="'+esc(p.id)+'">فتح العقار</button></div></li>').join(''))
      +part('عقود وساطة جديدة مطلوبة <b dir="ltr">'+nc.length+'</b>',nc.map(s=>'<li class="cat-row"><div class="cat-info"><strong dir="auto">'+esc(s.name)+'</strong><small dir="auto">'+esc(s.property||'')+' · المالك وافق على السعر '+esc(day(s.accepted_at))+'</small></div>'
        +'<div class="cat-actions">'+btns(s.phone,s.conversation_id,s.client_id)+'</div></li>').join(''))
      +'</section>';
  }
  function render(){
    const box=host();if(!box)return;
    if(!isOwner()||!data){box.hidden=true;box.innerHTML='';return;}
    const html=waitingHtml(data.waiting||[])+contractsHtml(data);
    box.hidden=!html;box.innerHTML=html;
  }
  async function load(){
    if(busy||!isOwner()||typeof supa==='undefined')return;
    busy=true;
    try{
      const r=await supa.rpc('crm_home_attention');
      if(r.error){data=null;}else data=r.data||null;
      render();
    }catch(_){/* nothing shows */}finally{busy=false;}
  }
  document.addEventListener('click',e=>{
    const b=e.target.closest('[data-cat]');if(!b||!data)return;
    const id=b.dataset.id,act=b.dataset.cat;
    if(act==='more'){showAll=!showAll;render();return;}
    if(act==='prop'){if(typeof viewProperty==='function')viewProperty(id);else if(typeof navigate==='function')navigate('properties',null);return;}
    b.disabled=true;
    const call=act==='wait-done'?supa.rpc('crm_waiting_buyer_done',{p_conversation:id}):act==='avail'?supa.rpc('crm_property_confirm_available',{p_property:id}):null;
    if(!call){b.disabled=false;return;}
    Promise.resolve(call).then(r=>{
      if(r&&r.error)throw r.error;
      if(act==='wait-done')data.waiting=(data.waiting||[]).filter(w=>w.conversation_id!==id);
      else data.unchecked=(data.unchecked||[]).filter(p=>p.id!==id);
      render();toast(act==='avail'?'انحفظ: العقار متوفر':'تم','success');
    }).catch(()=>{b.disabled=false;toast('ما انحفظ. جرب مرة ثانية','error');});
  });
  window.crmHomeAttentionRefresh=()=>load();
  setInterval(()=>{if(document.visibilityState==='visible')load();},90000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)load();});
  const loadDash=window.loadDashboard;
  if(typeof loadDash==='function')window.loadDashboard=function(){const r=loadDash.apply(this,arguments);setTimeout(load,900);return r;};
})();
