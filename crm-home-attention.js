/* Owner home (18 Nov 2026, Ahmed's check, items 4 and 5). Two tiles in «المطلوب منك الآن» (crm-owner-home.js), each opening
 * a sheet — Ahmed's fixed rule of the same day: «لوحة العمل ما أريدها تكون ربشة… يكون في عدد أضغط عليه أشوف», so nothing
 * here is an open list on the page:
 *   «مشترين واقفين»: buyers who asked a question in the last 7 days and nobody answered (crm_home_attention, SQL126/127).
 *      Name, the question, when, the two chat buttons (crm-wa-buttons.js) and «تم» (crm_waiting_buyer_done). A buyer leaves
 *      by himself once anyone answers him; «تم» hides him until he asks again.
 *   «العقود»: agreements ending within 45 days, non-exclusive properties to confirm (button «متوفر» →
 *      crm_property_confirm_available) and new brokerage contracts to sign (the owner accepted the study).
 * This file only reads the data and draws the sheet content (window.crmHomeAttention); the home draws the tiles and the sheet.
 * Owner only, read every 90 seconds while the page is visible. If the function is missing or fails, no tile shows. */
(function(){
  'use strict';
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
  // SQL130 (18 Nov 2026, Ahmed: «افتح المشترين والعقود للموظف»): staff (manager, agent) read them too, each row where they can go
  const isOwner=()=>typeof currentProfile!=='undefined'&&currentProfile&&['owner','manager','agent'].includes(currentProfile.role);
  const toast=(m,t)=>{if(typeof showToast==='function')showToast(m,t);};
  const BR={barka:'بركاء',muscat:'مسقط'};
  const ago=d=>typeof timeAgo==='function'?timeAgo(d):String(d||'').slice(0,16).replace('T',' ');
  const day=d=>d?new Date(d).toLocaleDateString('ar-OM-u-nu-latn',{timeZone:'Asia/Muscat',day:'numeric',month:'long'}):'';
  let data=null,busy=false;
  const changed=()=>document.dispatchEvent(new CustomEvent('crm-home-attention-updated'));
  const btns=(phone,conv,client)=>typeof window.crmWaButtons==='function'?window.crmWaButtons({phone,conversationId:conv,clientId:client,cls:'btn-primary'}):'';
  const empty=t=>'<p class="coh-empty">'+t+'</p>';
  function waitingHtml(){
    const list=(data&&data.waiting)||[];
    if(!list.length)return empty('ما في مشتري ينتظر رد ✓');
    return '<p class="coh-since">سألوا خلال آخر 7 أيام وما رد عليهم أحد. يختفي لحاله أول ما أحد يرد، أو اضغط «تم»</p><ul class="cat-list">'
      +list.map(w=>'<li class="cat-row"><div class="cat-info"><strong dir="auto">'+esc(w.name||'عميل')+(w.route?' · '+esc(BR[w.route]||''):'')+'</strong>'
        +'<small class="cat-q" dir="auto">«'+esc(w.question||'')+'»</small><small class="cat-time">'+esc(ago(w.asked_at))+'</small></div>'
        +'<div class="cat-actions">'+btns(w.phone,w.conversation_id,w.client_id)+'<button type="button" class="btn-secondary" data-cat="wait-done" data-id="'+esc(w.conversation_id)+'">تم</button></div></li>').join('')+'</ul>';
  }
  function contractsHtml(){
    const d=data||{},ex=d.expiring||[],un=d.unchecked||[],nc=d.new_contracts||[];
    if(!ex.length&&!un.length&&!nc.length)return empty('ما في عقود تحتاج شي الحين ✓');
    const part=(title,n,rows)=>n?'<h3 class="cat-sub">'+title+' <b dir="ltr">'+n+'</b></h3><ul class="cat-list">'+rows+'</ul>':'';
    return part('تنتهي خلال 45 يوم',ex.length,ex.map(p=>'<li class="cat-row"><div class="cat-info"><strong dir="auto">'+esc(p.name)+'</strong><small>ينتهي '+esc(day(p.end_date))+' · باقي '+esc(p.days_left)+' يوم'+(p.branch?' · '+esc(BR[p.branch]||''):'')+'</small></div>'
        +'<div class="cat-actions"><button type="button" class="btn-secondary" data-cat="prop" data-id="'+esc(p.id)+'">فتح العقار</button></div></li>').join(''))
      +part('غير حصرية تحتاج تأكيد توفر',un.length,un.map(p=>'<li class="cat-row"><div class="cat-info"><strong dir="auto">'+esc(p.name)+'</strong><small>'+(p.checked_at?'آخر تأكيد '+esc(day(p.checked_at)):'ما تأكد توفره أبداً')+(p.status==='reserved'?' · محجوز':'')+(p.branch?' · '+esc(BR[p.branch]||''):'')+'</small></div>'
        +'<div class="cat-actions"><button type="button" class="btn-primary" data-cat="avail" data-id="'+esc(p.id)+'">متوفر</button><button type="button" class="btn-secondary" data-cat="prop" data-id="'+esc(p.id)+'">فتح العقار</button></div></li>').join(''))
      +part('عقود وساطة جديدة مطلوبة',nc.length,nc.map(s=>'<li class="cat-row"><div class="cat-info"><strong dir="auto">'+esc(s.name)+'</strong><small dir="auto">'+esc(s.property||'')+' · المالك وافق على السعر '+esc(day(s.accepted_at))+'</small></div>'
        +'<div class="cat-actions">'+btns(s.phone,s.conversation_id,s.client_id)+'</div></li>').join(''));
  }
  const counts=()=>{const d=data||{};return {waiting:(d.waiting||[]).length,expiring:(d.expiring||[]).length,unchecked:(d.unchecked||[]).length,contracts:(d.new_contracts||[]).length};};
  window.crmHomeAttention={
    count:kind=>{if(!isOwner()||!data)return 0;const c=counts();return kind==='waiting'?c.waiting:c.expiring+c.unchecked+c.contracts;},
    sub:()=>{const c=counts();return [c.expiring?c.expiring+' تنتهي':'',c.unchecked?c.unchecked+' تأكيد توفر':'',c.contracts?c.contracts+' عقد جديد':''].filter(Boolean).join(' · ');},
    html:kind=>kind==='waiting'?waitingHtml():contractsHtml()
  };
  // 18 Nov 2026 (decision 64): the boot runs loadDashboard more than once; a read answered less than 3 seconds ago for the
  // same session is kept instead of reading again (the 90-second timer, coming back to the tab and the refresh still read)
  let doneAt=0,doneKey='';
  const sessionKey=()=>(typeof crmSessionGeneration==='undefined'?'':crmSessionGeneration)+':'+(typeof currentUser!=='undefined'&&currentUser?currentUser.id:'');
  async function load(force){
    if(busy||!isOwner()||typeof supa==='undefined')return;
    if(force!==true&&data&&doneKey===sessionKey()&&Date.now()-doneAt<3000)return;
    busy=true;
    try{
      const r=await supa.rpc('crm_home_attention');
      data=r.error?null:(r.data||null);
      if(data){doneAt=Date.now();doneKey=sessionKey();}
      changed();
    }catch(_){/* no tile */}finally{busy=false;}
  }
  document.addEventListener('click',e=>{
    const b=e.target.closest('[data-cat]');if(!b||!data)return;
    const id=b.dataset.id,act=b.dataset.cat;
    if(act==='prop'){
      const x=document.querySelector('#cohSheet [data-coh="sclose"]');if(x)x.click();
      if(typeof viewProperty==='function')viewProperty(id);else if(typeof navigate==='function')navigate('properties',null);return;
    }
    b.disabled=true;
    const call=act==='wait-done'?supa.rpc('crm_waiting_buyer_done',{p_conversation:id}):act==='avail'?supa.rpc('crm_property_confirm_available',{p_property:id}):null;
    if(!call){b.disabled=false;return;}
    Promise.resolve(call).then(r=>{
      if(r&&r.error)throw r.error;
      if(act==='wait-done')data.waiting=(data.waiting||[]).filter(w=>w.conversation_id!==id);
      else data.unchecked=(data.unchecked||[]).filter(p=>p.id!==id);
      changed();toast(act==='avail'?'انحفظ: العقار متوفر':'تم','success');
    }).catch(()=>{b.disabled=false;toast('ما انحفظ. جرب مرة ثانية','error');});
  });
  window.crmHomeAttentionRefresh=()=>load(true);
  setInterval(()=>{if(document.visibilityState==='visible')load(true);},90000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)load(true);});
  const loadDash=window.loadDashboard;
  if(typeof loadDash==='function')window.loadDashboard=function(){const r=loadDash.apply(this,arguments);setTimeout(load,900);return r;};
})();
