/* «🧠 فحص الردود» (19 Nov 2026, SQL144). The last twice-a-day check of the reply agent: how many replies, who got them,
 * system health, the mistakes (name and type) and how many are still open from earlier reports. Read only: Ahmed chooses
 * the fix in the Claude chat. One tile in «المطلوب منك الآن» (crm-owner-home.js) that opens a sheet, never an open list
 * (Ahmed's rule of 18 Nov). Owner only: crm_reply_audit_card() refuses everyone else, and the tile is not drawn for staff. */
(function(){
  'use strict';
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
  const isOwner=()=>typeof currentProfile!=='undefined'&&currentProfile&&currentProfile.role==='owner';
  const BR={barka:'بركاء',muscat:'مسقط'};
  const TYPES={invented_info:'سعر أو معلومة غلط أو مخترعة',sold_offered:'عرض عقار انباع أو انحجز',serious_not_handed:'مشتري جاد أو تفاوض ما تحوّل لك',
    call_not_handed:'طلب اتصال ما تحوّل لك',broker_as_buyer:'رد على وسيط كأنه مشتري',style:'تكرار أو رد طويل أو مو باللهجة',ignored_question:'تجاهل سؤال العميل',
    full_details:'أعطى كل تفاصيل العقار',rule_violation:'مخالفة قاعدة ثابتة',known_mistake:'غلط سبق صلّحناه ورجع',send_failed:'فشل إرسال',unanswered:'عميل ما انرد عليه'};
  const time=d=>d?new Date(d).toLocaleString('ar-OM-u-nu-latn',{timeZone:'Asia/Muscat',weekday:'short',hour:'numeric',minute:'2-digit'}):'';
  let data=null,busy=false,doneAt=0;
  const changed=()=>document.dispatchEvent(new CustomEvent('crm-reply-audit-updated'));
  const run=()=>data&&data.run;
  function count(){const r=run();if(!isOwner()){data=null;return null;}if(!r)return null;return (data.findings||[]).filter(f=>f.status==='open').length+Number(data.open_before||0);}
  function urgent(){const r=run();return !!r&&((data.findings||[]).some(f=>f.severity==='critical'&&f.status==='open')||(r.system_health&&r.system_health.status==='problem'));}
  function sub(){
    const r=run();if(!r)return '';
    const ok=!r.system_health||r.system_health.status!=='problem';
    return time(r.created_at)+' · '+Number(r.checked_count||0)+' رد · '+(ok?'النظام شغال':'⚠️ مشكلة في النظام');
  }
  function html(){
    const r=run();
    if(!r)return '<p class="coh-empty">ما صار فحص لين الحين. أول فحص الساعة 7:30 الصبح</p>';
    const h=r.system_health||{},clients=r.replied_clients||[],fs=data.findings||[];
    const sent=clients.reduce((a,c)=>a+Number(c.replies||0),0);
    return '<p class="coh-since">آخر فحص '+esc(time(r.created_at))+' · من '+esc(time(r.period_start))+' لين '+esc(time(r.period_end))+'</p>'
      +'<div class="cra-stats"><div><b dir="ltr">'+esc(r.checked_count||0)+'</b><small>رد انفحص</small></div><div><b dir="ltr">'+esc(sent)+'</b><small>انرسل لـ '+esc(clients.length)+' عميل</small></div>'
      +'<div><b dir="ltr">'+esc(r.findings_count||0)+'</b><small>غلط جديد</small></div><div><b dir="ltr">'+esc(data.open_before||0)+'</b><small>باقي من قبل</small></div></div>'
      +'<p class="cra-health '+(h.status==='problem'?'bad':'ok')+'">'+(h.status==='problem'?'⚠️ '+esc((h.reasons||[]).join(' · ')):'✅ النظام شغال: الكرونات والإرسال والرصيد')+'</p>'
      +(fs.length?'<h3 class="cat-sub">الأغلاط</h3><ul class="cat-list">'+fs.map(f=>'<li class="cat-row"><div class="cat-info"><strong dir="auto">'+(f.severity==='critical'?'🔴 ':'🟡 ')+esc(f.customer_name||'عميل')
          +(Number(f.conversations_count)>1?' <small>(+'+esc(Number(f.conversations_count)-1)+' محادثة)</small>':'')+'</strong><small>'+esc(TYPES[f.error_type]||f.error_type)+(f.paused?' · العقل موقوف عليه':'')+(f.status!=='open'?' · تم':'')+'</small>'
          +(f.explanation?'<small class="cat-q" dir="auto">'+esc(f.explanation)+'</small>':'')+'</div></li>').join('')+'</ul>'
        :'<p class="coh-empty">ما في أغلاط جديدة ✓</p>')
      +(clients.length?'<h3 class="cat-sub">انرد على</h3><p class="cra-names" dir="auto">'+clients.map(c=>esc(c.name||'عميل')+(c.route?' <small>'+esc(BR[c.route]||'')+'</small>':'')).join('، ')+'</p>':'')
      +'<p class="coh-since">الاختيار والتصليح في محادثة Claude</p>';
  }
  window.crmReplyAudit={count,urgent,sub,html};
  async function load(force){
    if(busy||!isOwner()||typeof supa==='undefined')return;
    if(force!==true&&data&&Date.now()-doneAt<3000)return;
    busy=true;
    try{const r=await supa.rpc('crm_reply_audit_card');data=r.error?null:(r.data||null);if(data)doneAt=Date.now();changed();}
    catch(_){/* no tile */}finally{busy=false;}
  }
  window.crmReplyAuditRefresh=load;
  // read with the home (and every 10 minutes while the page is visible: the report changes twice a day)
  setInterval(()=>{if(!document.hidden)load(true);},600000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-doneAt>600000)load(true);});
  const loadDash=window.loadDashboard;
  if(typeof loadDash==='function')window.loadDashboard=function(){const r=loadDash.apply(this,arguments);setTimeout(load,900);return r;};
  // a session change never keeps the owner's report for the next account in the same tab
  if(typeof currentProfile!=='undefined'&&!isOwner())data=null;
})();
