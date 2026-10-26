/* Performance-only Instagram surface. No inbox, message polling, read marking or send action. */
(function(){
  'use strict';
  const el=id=>document.getElementById(id),esc=v=>escapeHtml(String(v==null?'':v));
  const syncing=new Set();let statusSeq=0,connecting=false,pendingOAuth=null,oauthBusy=false;
  const identity=()=>typeof currentUser!=='undefined'&&currentUser&&currentProfile?currentUser.id+':'+currentProfile.company_id+':'+crmSessionGeneration:'';
  async function invoke(body){
    const result=await supa.functions.invoke('instagram-api',{body});
    if(result.error||!result.data||result.data.ok===false){console.warn('instagram_performance_request_failed',result.error||result.data);throw new Error('تعذر تحديث Instagram. راجع الاتصال والصلاحيات ثم أعد المحاولة.');}
    return result.data;
  }
  async function loadStatus(){
    const scope=identity(),seq=++statusSeq;if(!scope)return;
    const boxes=()=>['instagramConnectionStatus','igPerformanceStatus'].map(el).filter(Boolean);
    try{
      const data=await invoke({action:'status'});if(scope!==identity()||seq!==statusSeq)return;
      const account=data.account||{},text=data.connected?'الحساب مرتبط · قياسات المنشورات حسب الصلاحيات المتاحة':'حساب Instagram غير مرتبط';
      const html='<div class="ig-status"><div style="flex:1"><strong>'+esc(data.connected?'@'+(account.username||'omanvilla'):'أداء Instagram')+'</strong><p class="ws-subtitle">'+text+'</p><small>روابط العقارات محفوظة في CRM حتى عند تعذر المزامنة.</small></div>'+(isOwner()?'<button type="button" class="btn-secondary" onclick="connectInstagram()">'+(data.connected?'إدارة الاتصال':'ربط الحساب للأداء')+'</button>':'')+'</div>'+partnersHtml(data.partners);
      boxes().forEach(box=>box.innerHTML=html);
    }catch(error){if(scope!==identity()||seq!==statusSeq)return;boxes().forEach(box=>box.innerHTML='<div class="ws-error" role="alert">'+esc(error.message)+' <button type="button" class="btn-secondary" onclick="loadInstagramPerformance()">إعادة المحاولة</button></div>');}
  }
  function loadPerformance(){
    if(!identity())return;loadStatus();
    if(window.CRMFunnel)return CRMFunnel.loadOverview();
    if(el('igPerformanceContent'))el('igPerformanceContent').textContent='تعذر تحميل أداء العقارات؛ أعد تحميل الصفحة.';
  }
  // Partner accounts (e.g. @omanvilla1 collab posts): likes/comments arrive without
  // connecting; views need the partner account connected through its Facebook Page.
  function partnersHtml(partners){
    if(!isOwner()||!Array.isArray(partners)||!partners.length)return '';
    return '<div class="ig-partners"><strong>حسابات إنستغرام الشريكة</strong>'+partners.map(p=>{const u=String(p.username||'');if(!/^[a-z0-9._]{1,30}$/.test(u))return '';
      return '<div class="ig-partner"><span dir="ltr">@'+esc(u)+'</span><small>'+(p.connected?'مربوط: المشاهدات والوصول والتفاعل':'الإعجابات والتعليقات فقط حتى يُربط الحساب')+'</small>'+(p.connected?'':'<button type="button" class="btn-secondary" onclick="connectInstagram(\''+u+'\')">ربط @'+esc(u)+' لقياس المشاهدات</button>')+'</div>';}).join('')+'</div>';
  }
  function connectInstagram(partner){
    if(connecting||!isOwner())return;connecting=true;
    const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);const state=Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
    sessionStorage.setItem('instagram_oauth_state',state);sessionStorage.setItem('instagram_oauth_user',currentUser.id);
    sessionStorage.setItem('instagram_oauth_partner',typeof partner==='string'&&/^[a-z0-9._]{1,30}$/.test(partner)?partner:'');
    const scope='pages_show_list,pages_read_engagement,instagram_basic,instagram_manage_insights';
    location.assign('https://www.facebook.com/v25.0/dialog/oauth?client_id=1639659247753419&redirect_uri='+encodeURIComponent('https://omanvilla.github.io/habib-crm/')+'&response_type=token&auth_type=rerequest&return_scopes=true&scope='+encodeURIComponent(scope)+'&state='+encodeURIComponent(state));
  }
  function captureOAuth(){
    const params=new URLSearchParams(location.hash.replace(/^#/,'')),token=params.get('access_token');if(!token)return;
    const expected=sessionStorage.getItem('instagram_oauth_state'),user=sessionStorage.getItem('instagram_oauth_user'),partner=sessionStorage.getItem('instagram_oauth_partner')||'';
    history.replaceState(null,'',location.pathname+location.search);sessionStorage.removeItem('instagram_oauth_state');sessionStorage.removeItem('instagram_oauth_user');sessionStorage.removeItem('instagram_oauth_partner');
    if(!expected||expected!==params.get('state')){showToast('تعذر التحقق من جلسة ربط Meta. أعد المحاولة.','error');return;}
    pendingOAuth={token,user,partner};completeOAuth();
  }
  async function completeOAuth(){
    const scope=identity();if(!pendingOAuth||oauthBusy||!scope)return;
    const attempt=pendingOAuth;pendingOAuth=null;
    if(!isOwner()||(attempt.user&&attempt.user!==currentUser.id)){showToast('أكمل الربط من حساب المالك الذي بدأ العملية.','error');return;}
    oauthBusy=true;
    try{
      const body=attempt.partner?{action:'connect',access_token:attempt.token,instagram_username:attempt.partner}:{action:'connect',access_token:attempt.token,instagram_user_id:'17841444560608289'};
      const result=await supa.functions.invoke('instagram-api',{body});
      if(result.error||!result.data||result.data.ok===false){let detail='';try{const d=result.error&&result.error.context?await result.error.context.json():result.data;detail=String(d&&(d.message||d.error)||'');}catch(_){}
        throw new Error('تعذر الربط'+(detail?': '+detail:'. راجع الصلاحيات ثم أعد المحاولة.'));}
      if(scope!==identity())return;
      showToast(attempt.partner?'تم ربط @'+attempt.partner+'؛ ستظهر مشاهدات منشوراته خلال التحديث التلقائي القادم.':'تم حفظ اتصال Instagram؛ القياسات المتاحة تظهر في أداء العقارات.','success');navigate('instagram',null);
    }
    catch(error){if(scope===identity())showToast(error.message,'error');}finally{connecting=false;oauthBusy=false;}
  }
  async function syncProperty(id){
    const scope=identity();if(!scope||!id||syncing.has(id)||!canManage())return null;syncing.add(id);
    try{const data=await invoke({action:'sync_property',property_id:id});if(scope!==identity())return null;
      showToast('تم تحديث '+Number(data.synced_count||0)+' من '+Number(data.link_count||0)+' رابط'+(data.failed_count?'؛ بعض الروابط تحتاج مراجعة.':''),data.failed_count?'info':'success');
      if(window.CRMFunnel)await CRMFunnel.refreshProperty(id);return data;
    }catch(error){if(scope===identity())showToast(error.message,'error');return null;}finally{syncing.delete(id);}
  }
  function install(){
    const settings=el('page-settings'),nav=[...document.querySelectorAll('.nav-link')].find(x=>(x.getAttribute('onclick')||'').includes("'settings'"));
    if(!el('page-instagram')){
      const page=document.createElement('div');page.id='page-instagram';page.className='page ws-page';
      page.innerHTML='<div class="page-header"><div><div class="page-title"><span>أداء العقارات</span></div><p class="page-sub">أداء محتوى Instagram المرتبط بعقاراتك والاستفسارات الناتجة عن دليل مسجل.</p></div><button type="button" class="btn-secondary" onclick="loadInstagramPerformance()">تحديث الأداء</button></div><div id="igPerformanceStatus"></div><div id="igPerformancePanel"><div id="igPerformanceContent"></div></div>';
      settings.before(page);
      const entry=document.createElement('div');entry.className='nav-link';entry.id='navInstagramPerformance';entry.setAttribute('onclick',"navigate('instagram',this)");entry.innerHTML='<div class="nav-icon">▥</div><span class="nav-text">أداء العقارات</span>';if(nav)nav.before(entry);
      const card=document.createElement('div');card.id='instagramSettingsCard';card.className='card';card.hidden=true;card.innerHTML='<div class="card-head"><div class="card-title">اتصال Instagram لأداء العقارات</div></div><div class="card-body" id="instagramConnectionStatus"></div>';settings.append(card);
    }
    window.connectInstagram=connectInstagram;window.loadInstagramPerformance=loadPerformance;
    window.setInstagramTab=loadPerformance;window.syncInstagramProperty=syncProperty;window.syncInstagramForCurrentProperty=()=>syncProperty(window.viewingProperty?.id);
    const oldNavigate=window.navigate;window.navigate=function(id,node){const result=oldNavigate.call(this,id,node);if(id==='instagram')loadPerformance();if(id==='settings'){el('instagramSettingsCard').hidden=!isOwner();if(isOwner())loadStatus();}return result;};
    if(supa.auth)supa.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){statusSeq++;pendingOAuth=null;syncing.clear();['igPerformanceContent','igPerformanceStatus','instagramConnectionStatus'].forEach(id=>{if(el(id))el(id).textContent='';});}});
    const app=el('appScreen');if(app)new MutationObserver(()=>{if(app.classList.contains('visible'))completeOAuth();}).observe(app,{attributes:true,attributeFilter:['class']});
    captureOAuth();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})();
