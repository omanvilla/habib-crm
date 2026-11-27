/* «المكتب» (27 Nov 2026, Ahmed: the AI-agents-office idea applied to the CRM, plus a real employee's performance).
 * One read: crm_office_snapshot() (SQL161).
 *  - Owner / manager: the boss line, every automatic «employee» with a colour and its last job, and a card per staff member.
 *  - Agent: the page is called «أدائي» and shows only her own card. No money of any kind reaches this page.
 * Colours follow the pace of the goal: a monthly goal is compared with how much of the month has gone, a weekly one with
 * the working days (Sunday to Thursday) gone. */
(function(){
  'use strict';
  const byId=id=>document.getElementById(id);
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const role=()=>typeof currentProfile!=='undefined'&&currentProfile?currentProfile.role:'';
  const allowed=()=>['owner','manager','agent'].includes(role());
  const isBoss=()=>['owner','manager'].includes(role());
  const BR={barka:'بركاء',muscat:'مسقط'};
  let loading=false;

  function ago(v){
    if(!v)return '—';const d=new Date(v);if(isNaN(d))return '—';
    const m=Math.round((Date.now()-d.getTime())/60000);
    if(m<1)return 'الحين';if(m<60)return 'قبل '+m+' دقيقة';
    const h=Math.round(m/60);if(h<24)return 'قبل '+h+' ساعة';
    return d.toLocaleDateString('ar-OM-u-nu-latn',{timeZone:'Asia/Muscat',weekday:'long',day:'numeric',month:'long'});
  }
  // share of the period gone, by the Muscat calendar
  function muscatNow(){return new Date(Date.now()+4*3600000);}
  function monthPace(){const n=muscatNow(),days=new Date(Date.UTC(n.getUTCFullYear(),n.getUTCMonth()+1,0)).getUTCDate();return Math.min(1,n.getUTCDate()/days);}
  function weekPace(){const dow=muscatNow().getUTCDay();/* Sun=0 */return Math.min(1,Math.max(1,Math.min(dow+1,5))/5);}
  function paceColor(done,goal,pace){
    if(!(goal>0))return '';const expected=goal*pace;
    if(done>=goal||done>=expected)return 'g';if(done>=expected*0.6)return 'y';return 'r';
  }
  const DOT={g:'🟢',y:'🟡',r:'🔴',off:'⚪'};

  function ensurePage(){
    if(byId('page-office')||!allowed())return;
    const content=document.querySelector('.content');if(!content)return;
    const page=document.createElement('div');page.className='page';page.id='page-office';
    page.innerHTML='<div class="page-header"><div><div class="page-title"><span id="ofTitle">المكتب</span></div><div class="page-sub" id="ofSub">جاري التحميل…</div></div>'
      +'<button type="button" class="btn-secondary" data-of="refresh">تحديث</button></div><div id="ofBody"></div>';
    content.append(page);
    const nav=document.querySelector('#sidebar .nav-area');
    if(nav&&!byId('navOffice')){
      const link=document.createElement('div');link.className='nav-link';link.id='navOffice';link.setAttribute('onclick',"navigate('office',this)");
      link.innerHTML='<div class="nav-icon">🏢</div><span class="nav-text">المكتب</span>';
      const before=nav.querySelector('[onclick*="navigate(\'reports\'"]');
      if(before&&before.parentNode)before.parentNode.insertBefore(link,before);else nav.append(link);
    }
    syncLabel();
  }
  function syncLabel(){
    const l=byId('navOffice');if(!l)return;l.style.display=allowed()?'':'none';
    const t=l.querySelector('.nav-text');if(t)t.textContent=isBoss()?'المكتب':'أدائي';
    const i=l.querySelector('.nav-icon');if(i)i.textContent=isBoss()?'🏢':'📈';
  }

  function workerCard(w){
    const st=w.status==='green'?['g','شغال']:w.status==='yellow'?['y','متأخر شوي']:w.status==='red'?['r','فيه مشكلة']:['off','موقوف'];
    const last=w.last_output||w.last_run;
    return '<div class="of-w"><div class="of-e">'+esc(w.icon)+'</div><b>'+esc(w.name)+'</b>'
      +'<div class="of-s of-'+st[0]+'">'+DOT[st[0]]+' '+st[1]+'</div>'
      +'<div class="of-t">'+(w.did?esc(w.did)+' · ':'')+'آخر شغل: '+esc(ago(last))+'</div></div>';
  }
  function row(icon,label,value,color,bar){
    return '<div class="of-row"><span class="of-i">'+icon+'</span><div class="of-l">'+esc(label)
      +(bar!=null?'<div class="of-bar"><i class="of-b'+(color||'n')+'" style="width:'+Math.round(Math.min(1,bar)*100)+'%"></i></div>':'')
      +'</div><span class="of-n '+(color?'of-'+color:'')+'">'+esc(value)+'</span></div>';
  }
  function personCard(p){
    const mp=monthPace(),wp=weekPace(),reds=[];
    const calls=p.calls||{},cDone=Number(calls.calls||0),cGoal=Number(calls.target||0);
    const cc=paceColor(cDone,cGoal,mp);
    const vc=paceColor(p.visits_week,p.visits_goal,wp);
    const bc=paceColor(p.bookings_month,p.bookings_goal,mp);
    const nc=paceColor(p.new_properties_week,p.new_properties_goal,wp);
    const rm=p.reply_minutes,rc=rm==null?'':rm<=30?'g':rm<=120?'y':'r';
    const oc=p.tasks_overdue>3?'r':p.tasks_overdue>0?'y':'g';
    [cc,vc,bc,nc,rc,oc].forEach(c=>{if(c==='r')reds.push(c);});
    const badge=reds.length===0?['g','🟢 ماشية زين']:reds.length<3?['y','🟡 تحتاج متابعة']:['r','🔴 بعيدة عن الهدف'];
    const branches=(p.branches||[]).map(b=>BR[b]||b).join(' و ');
    const rmText=rm==null?'—':rm<60?rm+' دقيقة':(Math.round(rm/6)/10)+' ساعة';
    let h='<div class="of-p"><div class="of-ph"><b>'+esc(p.name)+'</b><span class="of-badge of-badge-'+badge[0]+'">'+badge[1]+'</span></div>'
      +'<div class="of-t">'+(branches?'ماسكة: '+esc(branches)+' · ':'')+'آخر دخول للنظام: '+esc(ago(p.last_login_at))+'</div>';
    h+=row('📞','اتصالات الشهر',cDone+' من '+cGoal,cc,cGoal?cDone/cGoal:null);
    h+=row('💬','ردود واتساب (آخر 30 يوم)',Number(p.wa_replies_30d||0).toLocaleString('en-US')+' رد لـ '+Number(p.wa_clients_30d||0).toLocaleString('en-US')+' عميل','',null);
    h+=row('⏱️','سرعة الرد على العميل (وقت الدوام)',rmText,rc,null);
    h+=row('✅','مهام خلصتها (آخر 30 يوم)',String(p.tasks_done_30d||0),'',null);
    h+=row('⏰','مهام متأخرة',String(p.tasks_overdue||0),oc,null);
    h+=row('🏠','زيارات هالأسبوع',p.visits_week+' من '+p.visits_goal,vc,p.visits_goal?p.visits_week/p.visits_goal:null);
    h+=row('🏢','عقارات جديدة هالأسبوع',p.new_properties_week+' من '+p.new_properties_goal,nc,p.new_properties_goal?p.new_properties_week/p.new_properties_goal:null);
    h+=row('🤝','حجوزات الشهر',p.bookings_month+' من '+p.bookings_goal,bc,p.bookings_goal?p.bookings_month/p.bookings_goal:null);
    return h+'</div>';
  }

  function render(d){
    const body=byId('ofBody'),sub=byId('ofSub'),title=byId('ofTitle');if(!body)return;
    const boss=isBoss();
    if(title)title.textContent=boss?'المكتب':'أدائي';
    if(sub)sub.textContent='آخر تحديث: '+new Date(d.now||Date.now()).toLocaleTimeString('ar-OM-u-nu-latn',{timeZone:'Asia/Muscat',hour:'numeric',minute:'2-digit'});
    let h='';
    if(boss){
      const ws=d.workers||[],bad=ws.filter(w=>w.status==='red'),slow=ws.filter(w=>w.status==='yellow');
      const state=bad.length?'🔴 '+bad.map(w=>w.name).join('، ')+' فيه مشكلة':slow.length?'🟡 '+slow.map(w=>w.name).join('، ')+' متأخر':'كل الموظفين الآليين شغالين ✅';
      h+='<div class="of-boss"><span class="of-big">👨‍💼</span><div><b>المدير: '+esc((typeof currentProfile!=='undefined'&&currentProfile&&currentProfile.full_name)||'أحمد')+'</b>'
        +'<small>'+esc(state)+' · '+Number(d.waiting_conversations||0)+' محادثة تنتظر رد (آخر 3 أيام)</small></div></div>';
      h+='<h3 class="of-h">🤖 الموظفين الآليين</h3><div class="of-grid">'+ws.map(workerCard).join('')+'</div>';
      if((d.failed_jobs||[]).length)h+='<div class="of-note of-r">مهام فيها خطأ: '+esc(d.failed_jobs.join('، '))+'</div>';
      h+='<h3 class="of-h">👩‍💼 الموظفين</h3>';
    }
    const staff=d.staff||[];
    h+=staff.length?staff.map(personCard).join(''):'<div class="of-note">ما في موظفين نشطين.</div>';
    h+='<div class="of-note">🟢 ماشي حسب الهدف · 🟡 قريب · 🔴 بعيد عن الهدف (حسب الأيام اللي راحت من الأسبوع أو الشهر).<br>'
      +'ردود الواتساب محسوبة على الأرقام اللي ماسكها الموظف، لأن تطبيق واتساب بزنس ما يقول مين كتب الرد.'
      +(boss?'':'<br>الأرقام من شغلك في النظام.')+'</div>';
    body.innerHTML=h;
  }

  async function load(){
    if(loading)return;loading=true;
    const body=byId('ofBody');if(body&&!body.innerHTML)body.innerHTML='<div class="of-note">جاري التحميل…</div>';
    try{
      const r=await supa.rpc('crm_office_snapshot');if(r.error)throw r.error;render(r.data||{});
    }catch(e){
      if(body)body.innerHTML='<div class="of-note of-r">تعذر تحميل المكتب: '+esc(e.message||e)+'</div>';
      const sub=byId('ofSub');if(sub)sub.textContent='';
    }finally{loading=false;}
  }

  document.addEventListener('click',e=>{const b=e.target.closest('[data-of="refresh"]');if(b&&b.closest('#page-office'))load();});
  const nav=window.navigate;
  if(typeof nav==='function')window.navigate=function(id){
    if(id==='office'&&!allowed()){if(typeof showPermissionDenied==='function')showPermissionDenied();return;}
    ensurePage();
    const r=nav.apply(this,arguments);
    if(id==='office'){const t=byId('tbTitle');if(t)t.innerHTML='<em>'+(isBoss()?'المكتب':'أدائي')+'</em>';load();}
    return r;
  };
  const loadDash=window.loadDashboard;
  if(typeof loadDash==='function')window.loadDashboard=function(){const r=loadDash.apply(this,arguments);ensurePage();syncLabel();return r;};
  ensurePage();
  window.crmOffice={load,render,paceColor};
})();
