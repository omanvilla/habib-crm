/* Investment projects (5 November 2026). Page "المشاريع الاستثمارية": each project with its developer,
 * its videos, and the clients who wrote to us from one of those videos. Videos link here from the
 * Instagram cards, from this page by link, or by the scan when the caption names one project.
 * Owner and staff (Ahmed 11 Nov 2026, SQL82): staff read, manager/agent edit projects; linking or removing a video
 * stays owner-only (Instagram manual review). */
(function(){
  'use strict';
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
  const byId=id=>document.getElementById(id);
  const toast=(m,t)=>{if(typeof showToast==='function')showToast(m,t);};
  const isOwnerNow=()=>typeof currentProfile!=='undefined'&&currentProfile&&currentProfile.role==='owner';
  const canSee=()=>typeof currentProfile!=='undefined'&&currentProfile&&['owner','manager','agent','viewer'].includes(currentProfile.role);
  const canEdit=()=>typeof currentProfile!=='undefined'&&currentProfile&&['owner','manager','agent'].includes(currentProfile.role);
  const safeLink=v=>{try{const u=new URL(v);return u.protocol==='https:'&&/^(www\.)?instagram\.com$/.test(u.hostname)?u.href:'';}catch{return '';}};
  const safeThumb=v=>{try{const u=new URL(v);return u.protocol==='https:'&&/(\.cdninstagram\.com|\.fbcdn\.net)$/.test(u.hostname)?u.href:'';}catch{return '';}};
  const day=v=>String(v||'').slice(0,10);
  const ERRORS={video_not_found:'الفيديو ما لقيته في حسابنا. يظهر هنا بعد الفحص الجاي إذا كان منزل من حساب مربوط.',invalid_link:'الرابط مو رابط فيديو إنستغرام.',stale_media:'تغيّر الفيديو من مكان ثاني. حدّث الصفحة وجرب مرة ثانية.',duplicate:'في مشروع بنفس الاسم.'};
  const errorText=e=>{const raw=String(e&&(e.message||e.details)||e||'');for(const k of Object.keys(ERRORS))if(raw.includes(k))return ERRORS[k];if(e&&e.code==='23505')return ERRORS.duplicate;return 'ما انحفظ: '+raw;};
  let projects=[],editing=null,loading=false;

  function ensurePage(){
    if(byId('page-projects'))return;
    const content=document.querySelector('.content');if(!content)return;
    const page=document.createElement('div');page.className='page';page.id='page-projects';
    page.innerHTML='<div class="page-header"><div><div class="page-title"><span>المشاريع الاستثمارية</span></div><div class="page-sub" id="ipSub">جاري التحميل…</div></div><button type="button" class="btn-primary" data-ip="new">مشروع جديد</button></div><div id="ipWait"></div><div id="ipForm"></div><div id="ipList" class="ip-list"></div>';
    content.append(page);
    const nav=document.querySelector('#sidebar .nav-area');
    if(nav&&!byId('navProjects')){
      const link=document.createElement('div');link.className='nav-link';link.id='navProjects';link.setAttribute('onclick',"navigate('projects',this)");
      link.innerHTML='<div class="nav-icon">🏗</div><span class="nav-text">المشاريع الاستثمارية</span>';
      const after=byId('navOwnerLeads')||byId('navReplies')||nav.querySelector('.nav-link');
      if(after&&after.parentNode)after.parentNode.insertBefore(link,after.nextSibling);else nav.append(link);
    }
    syncVisibility();
  }
  function syncVisibility(){const l=byId('navProjects');if(l)l.style.display=canSee()?'':'none';}
  async function load(){
    if(loading||!canSee())return;loading=true;
    try{const r=await supa.rpc('crm_investment_projects');if(r.error)throw r.error;projects=r.data||[];render();}
    catch(e){const list=byId('ipList');if(list)list.innerHTML='<div class="ws-error" role="alert">تعذر تحميل المشاريع. حدّث الصفحة.</div>';}
    finally{loading=false;}
    loadWait();
  }
  /* «المستحقين» waiting list (11 Nov 2026, Ahmed, SQL87/R31): their sales are stopped; whoever asked waits here so they can be
   * told as soon as new units open. «فتح في النظام» opens the chat, «تم التواصل» takes the client off the list. */
  let waitRows=[];
  async function loadWait(){
    const box=byId('ipWait');if(!box)return;
    const r=await supa.from('mustahiq_waitlist').select('id,client_id,conversation_id,route_key,note,last_asked_at,clients(name)').is('contacted_at',null).order('last_asked_at',{ascending:false}).limit(300);
    if(r.error){box.innerHTML='';return;}
    waitRows=r.data||[];drawWait();
  }
  function drawWait(){
    const box=byId('ipWait');if(!box)return;
    const label={muscat:'مسقط',barka:'بركاء'};
    box.innerHTML='<section class="card ip-card"><div class="ip-head"><div><h2>قائمة انتظار المستحقين <b dir="ltr">'+waitRows.length+'</b></h2><small>طرح المستحقين موقف حالياً. أول ما يفتح تواصل معهم وحطهم «تم التواصل»</small></div></div>'
      +(waitRows.length?'<ul class="ip-clients">'+waitRows.map(w=>'<li><button type="button" class="ip-client" data-ip="client" data-id="'+esc(w.client_id)+'">'+esc((w.clients&&w.clients.name)||'عميل')+'</button><small>'+esc(label[w.route_key]||'')+' · آخر سؤال '+esc(day(w.last_asked_at))+'</small>'
        +(w.note?'<small dir="auto">'+esc(String(w.note).slice(0,140))+'</small>':'')
        +(typeof window.crmWaButtons==='function'?window.crmWaButtons({conversationId:w.conversation_id,clientId:w.client_id})
          :(w.conversation_id&&typeof openWhatsAppConversation==='function'?'<button type="button" class="btn-secondary" data-ip="wchat" data-id="'+esc(w.conversation_id)+'">فتح في النظام</button>':''))
        +(canEdit()?'<button type="button" class="btn-secondary" data-ip="wdone" data-id="'+esc(w.id)+'">تم التواصل</button>':'')+'</li>').join('')+'</ul>':'<p class="ip-empty">ما في أحد في قائمة الانتظار</p>')
      +'</section>';
  }
  function drawForm(){
    const box=byId('ipForm');if(!box)return;
    if(!editing){box.innerHTML='';return;}
    const p=editing;
    box.innerHTML='<section class="card ip-form"><h3>'+(p.id?'تعديل المشروع':'مشروع جديد')+'</h3>'
      +'<label>اسم المشروع<input class="fi" id="ipName" value="'+esc(p.name)+'" dir="auto"></label>'
      +'<label>المطور<input class="fi" id="ipDeveloper" value="'+esc(p.developer)+'" dir="auto"></label>'
      +'<label>المنطقة<input class="fi" id="ipArea" value="'+esc(p.area)+'" dir="auto"></label>'
      +'<label>أسماء ثانية يذكر فيها المشروع في وصف الفيديو، بينها فاصلة<input class="fi" id="ipAliases" value="'+esc((p.aliases||[]).join('، '))+'" dir="auto"></label>'
      +'<label>ملاحظات<textarea class="fta" id="ipNotes" rows="2" dir="auto">'+esc(p.notes)+'</textarea></label>'
      +'<div class="ws-actions"><button type="button" class="btn-primary" data-ip="save">حفظ</button><button type="button" class="btn-secondary" data-ip="cancel">إلغاء</button></div></section>';
  }
  function videoRow(p,v){
    const url=safeLink(v.permalink),thumb=safeThumb(v.thumbnail_url);
    return '<li class="ip-video">'+(thumb?'<img src="'+esc(thumb)+'" alt="" loading="lazy" referrerpolicy="no-referrer">':'<div class="ip-thumb">فيديو</div>')
      +'<div class="ip-video-body"><small>'+esc(day(v.published_at))+(url?' · <a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">فتح الفيديو ↗</a>':'')+'</small><p>'+esc(v.caption||'بدون وصف')+'</p></div>'
      +(isOwnerNow()?'<button type="button" class="btn-secondary ip-remove" data-ip="unlink" data-id="'+esc(v.id)+'" data-project="'+esc(p.id)+'">شيله</button>':'')+'</li>';
  }
  function render(){
    const list=byId('ipList'),sub=byId('ipSub');if(!list)return;
    const videos=projects.reduce((n,p)=>n+p.videos.length,0);
    if(sub)sub.textContent=projects.length+' مشاريع · '+videos+' فيديو';
    drawForm();
    list.innerHTML=projects.length?projects.map(p=>'<section class="card ip-card">'
      +'<div class="ip-head"><div><h2>'+esc(p.name)+'</h2><small>'+(p.developer?'المطور: '+esc(p.developer):'المطور غير محدد')+(p.area?' · '+esc(p.area):'')+'</small></div>'+(canEdit()?'<button type="button" class="btn-secondary" data-ip="edit" data-id="'+esc(p.id)+'">تعديل</button>':'')+'</div>'
      +(p.notes?'<p class="ip-notes">'+esc(p.notes)+'</p>':'')
      +(isOwnerNow()?'<div class="ip-add"><input class="fi" data-ip-link="'+esc(p.id)+'" placeholder="الصق رابط فيديو إنستغرام" dir="ltr"><button type="button" class="btn-primary" data-ip="add" data-id="'+esc(p.id)+'">أضف الفيديو</button></div>':'')
      +'<h3>الفيديوهات <b dir="ltr">'+p.videos.length+'</b></h3>'
      +(p.videos.length?'<ul class="ip-videos">'+p.videos.map(v=>videoRow(p,v)).join('')+'</ul>':'<p class="ip-empty">ما في فيديو مربوط للحين</p>')
      +'<h3>عملاء تواصلوا من الفيديوهات <b dir="ltr">'+p.clients.length+'</b></h3>'
      +(p.clients.length?'<ul class="ip-clients">'+p.clients.map(c=>'<li><button type="button" class="ip-client" data-ip="client" data-id="'+esc(c.id)+'">'+esc(c.name||'عميل')+'</button><small>'+esc(day(c.at))+'</small></li>').join('')+'</ul>':'<p class="ip-empty">ما في عميل للحين</p>')
      +'</section>').join(''):'<p class="ip-empty">ما في مشاريع للحين</p>';
  }
  async function save(){
    const name=byId('ipName').value.trim();if(!name){toast('اكتب اسم المشروع','error');return;}
    const aliases=[...new Set([name,...byId('ipAliases').value.split(/[،,]/).map(s=>s.trim()).filter(Boolean)])];
    const row={name,developer:byId('ipDeveloper').value.trim()||null,area:byId('ipArea').value.trim()||null,aliases,notes:byId('ipNotes').value.trim()||null,updated_at:new Date().toISOString()};
    const r=editing.id?await supa.from('investment_projects').update(row).eq('id',editing.id):await supa.from('investment_projects').insert({...row,company_id:currentProfile.company_id});
    if(r.error){toast(errorText(r.error),'error');return;}
    editing=null;toast('انحفظ المشروع','success');await load();
  }
  async function addVideo(id){
    const input=document.querySelector('[data-ip-link="'+id+'"]'),link=input&&input.value.trim();
    if(!link){toast('الصق رابط الفيديو أول','error');return;}
    const r=await supa.rpc('crm_project_add_video',{p_project:id,p_link:link});
    if(r.error){toast(errorText(r.error),'error');return;}
    toast('انضاف الفيديو للمشروع','success');await load();
  }
  async function unlink(project,id){
    const p=projects.find(x=>x.id===project),v=p&&p.videos.find(x=>x.id===id);if(!v)return;
    const r=await supa.rpc('crm_instagram_link_project',{p_id:id,p_expected:v.updated_at,p_project:null});
    if(r.error){toast(errorText(r.error),'error');return;}
    toast('انشال الفيديو من المشروع','success');await load();
  }
  document.addEventListener('click',e=>{
    const b=e.target.closest('[data-ip]');if(!b)return;
    const act=b.dataset.ip,id=b.dataset.id;
    if(act==='new'){editing={name:'',developer:'',area:'',aliases:[],notes:''};drawForm();}
    else if(act==='edit'){editing=projects.find(p=>p.id===id)||null;drawForm();byId('ipForm').scrollIntoView({block:'nearest'});}
    else if(act==='cancel'){editing=null;drawForm();}
    else if(act==='save')save();
    else if(act==='add')addVideo(id);
    else if(act==='unlink')unlink(b.dataset.project,id);
    else if(act==='client'&&typeof viewClient==='function')viewClient(id);
    else if(act==='wchat'&&typeof navigate==='function'&&typeof openWhatsAppConversation==='function'){navigate('whatsapp',null);setTimeout(()=>openWhatsAppConversation(id),300);}
    else if(act==='wdone'){b.disabled=true;supa.from('mustahiq_waitlist').update({contacted_at:new Date().toISOString(),contacted_by:currentUser&&currentUser.id||null}).eq('id',id).then(r=>{if(r.error)throw r.error;waitRows=waitRows.filter(w=>w.id!==id);drawWait();toast('انشال من قائمة الانتظار','success');}).catch(()=>{b.disabled=false;toast('ما انحفظ. جرب مرة ثانية','error');});}
  });
  const nav=window.navigate;
  if(typeof nav==='function')window.navigate=function(id){
    if(id==='projects'&&!canSee()){if(typeof showPermissionDenied==='function')showPermissionDenied();return;}
    ensurePage();
    const r=nav.apply(this,arguments);
    if(id==='projects'){const t=byId('tbTitle');if(t)t.innerHTML='<em>المشاريع الاستثمارية</em>';load();}
    return r;
  };
  const loadDash=window.loadDashboard;
  if(typeof loadDash==='function')window.loadDashboard=function(){const r=loadDash.apply(this,arguments);ensurePage();syncVisibility();return r;};
  ensurePage();
})();
