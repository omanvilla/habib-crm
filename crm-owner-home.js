/* Owner home page (redesigned 9 November 2026). One screen: a hello line, big tiles for what needs Ahmed now
 * (each opens a sheet over the page or its own page, so the home page stays short), small quick decisions,
 * hot-buyer alerts at the top, and one compact summary. The old work list is gone (19 Nov 2026: never read, never shown).
 * Reads crm_owner_home and crm_paused_chats (owner only). If the data does not load, the placeholder stays and the home keeps retrying (never the old page, 19 Nov 2026). */
(function(){
  'use strict';
  const byId=id=>document.getElementById(id);
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
  const num=v=>Number(v||0).toLocaleString('en-US');
  const isOwner=()=>typeof currentProfile!=='undefined'&&currentProfile&&currentProfile.role==='owner';
  /* Staff home (11 Nov 2026, Ahmed: "the whole system the same for the employee, except what the rules keep from
   * staff"). Any active staff account gets this same page from crm_staff_home (SQL81, its own row level security).
   * Owner-only parts stay out: approvals, owner offers (paused chats since R27, price studies since R59 are the staff's too), problems, twins, videos,
   * agent reply counts and the Reports link (reports hold money). */
  const isStaff=()=>typeof currentProfile!=='undefined'&&currentProfile&&['manager','agent','viewer'].includes(currentProfile.role);
  const hasHome=()=>isOwner()||isStaff();
  const toast=(m,t)=>{if(typeof showToast==='function')showToast(m,t);};
  /* 12 Nov 2026 (Ahmed, R40 / R41, SQL98): «سؤال ما عندي جوابه» has its own tab; the ignored chats (jobs, broker sign-ups,
   * foreign brokers, banks, service offers) are not in this list at all: a small link at its end opens them. */
  const OWNER_KIND={unknown_q:'سؤال ما يعرف جوابه',negotiation:'تفاوض أو مشتري جاد',handoff:'يحتاج قرارك',muted:'مكتوم عنهم',manual_reply:'رديت بنفسك'};
  const STAFF_KIND={unknown_q:'سؤال ما يعرف جوابه',negotiation:'تفاوض أو مشتري جاد',handoff:'يحتاج قرار',muted:'مكتوم عنهم',manual_reply:'انرد عليها من المكتب'};
  const KIND=new Proxy({},{get:(_,k)=>(isOwner()?OWNER_KIND:STAFF_KIND)[k],ownKeys:()=>Object.keys(OWNER_KIND),getOwnPropertyDescriptor:()=>({enumerable:true,configurable:true})});
  const TITLES={waiting:'مشترين واقفين، سألوا وما انرد عليهم',contracts:'العقود',followups:'متابعة اليوم',paused:'العقل موقوف عندهم',pricing:'دراسة سعر: ملاك ينتظرون تسعيرك',studies:'دراسات سعر تنتظر موافقتك',visits:'زيارات يتابعها الذكاء الاصطناعي',problems:'مشاكل تحتاج انتباه',twins:'قرار سريع: عقارات بنفس المواصفات',ig:'فيديوهات إنستقرام تحتاج ربط',audit:'🧠 فحص الردود'};
  let sequence=0,sheetKind=null,pausedFilter='all',pricingBranch='all',paused={items:[],total:0},last=null,ignoredOpen=false,ignoredList=null;
  /* «دراسة سعر:» handoffs (11 Nov 2026, Ahmed): owners waiting for a price have their own tile and list, so the
   * paused list keeps only chats that need another decision. Display only: the hold, the reason text and
   * «كمّل يا عقل» are unchanged (crm_paused_chats still returns them as kind=negotiation). */
  // 16 Nov 2026 (Ahmed: «هذا خلاص مسعرينه. ليش بعد طالع انه يحتاج تسعير؟»): a chat whose study is already made (waiting for
  // approval, approved, the template went and the owner has not answered) is priced and leaves this list too
  const isPricing=i=>/^\s*دراسة\s*سعر/.test(String(i&&i.reason||''))&&!/انرسلت الدراسة/.test(String(i&&i.reason||''))&&!(typeof window!=='undefined'&&typeof window.crmPriceStudyChats==='function'&&window.crmPriceStudyChats().has(i&&i.conversation_id));
  /* SQL94 (11 Nov 2026, Ahmed): once he approves a study and it reaches the owner, the hold stays (the chat is his) and its
   * reason says «دراسة سعر: انرسلت الدراسة للمالك …»; that chat leaves «ملاك ينتظرون تسعيرك» and shows with the other paused
   * chats. Staff still never resume a price study chat (whatsapp-inbox refuses it), so they get no «كمّل يا عقل» on it. */
  const isStudyChat=i=>/^\s*دراسة\s*سعر/.test(String(i&&i.reason||''));
  const studiesCount=()=>typeof window.crmPriceStudiesCount==='function'?Number(window.crmPriceStudiesCount()||0):0;
  // 11 Nov 2026 (Ahmed, SQL84): staff see and resume paused chats too. Price studies: staff see them as well (Ahmed, later
  // the same day: «حتى دراسة تسعير اريد تظهر للموظف»); nobody resumes the agent on one (R26)
  const canResume=()=>typeof currentProfile!=='undefined'&&currentProfile&&['owner','manager','agent'].includes(currentProfile.role);
  const pricingItems=()=>canResume()?paused.items.filter(isPricing):[];
  const otherPaused=()=>paused.items.filter(i=>!isPricing(i));

  /* Boot gate (10 Nov 2026). The owner saw the old dashboard for several seconds before this page replaced it.
   * As soon as the account is known to be the owner (applyRoleVisibility, before the app is shown), <html> gets
   * .coh-boot, which hides the old dashboard and shows a light placeholder (crm-owner-home.css). The heavy old
   * dashboard reads (crm-operations-v6.js) wait for window.crmHomeFirst, so this page's reads are not queued behind
   * them. The gate opens after the first load, whatever its result, and never later than 8 seconds. */
  let gate=null;
  function armGate(){
    if(gate)return;
    let done;const p=new Promise(r=>{done=r;});
    gate={done,timer:setTimeout(releaseGate,8000)};window.crmHomeFirst=p;
    document.documentElement.classList.add('coh-boot');
  }
  function releaseGate(){
    document.documentElement.classList.remove('coh-boot');
    if(!gate)return;
    clearTimeout(gate.timer);const g=gate;gate=null;window.crmHomeFirst=null;g.done();
  }
  /* 19 Nov 2026 (Ahmed: «ما اريد النسخة القديمة ابدا»): .coh-home on <html> for every account with this home. The old
   * dashboard stays hidden under the placeholder until the home is drawn, however long the home takes (crm-owner-home.css);
   * the 8 s gate above only stops holding back the old reads. An account with no home role gets the old page as before. */
  function markHome(){
    const on=hasHome(),root=document.documentElement;
    root.classList.toggle('coh-home',on);if(!on)root.classList.remove('coh-slow');
  }
  const roleVisibility=window.applyRoleVisibility;
  if(typeof roleVisibility==='function')window.applyRoleVisibility=function(){
    const r=roleVisibility.apply(this,arguments);
    markHome();
    if(hasHome()&&!last)armGate();else if(!hasHome())releaseGate();
    return r;
  };
  /* 19 Nov 2026 (open speed): at open about 15 reads used to start together with crm_owner_home on a small database whose
   * fresh connections are slow, so the home read took 4-6 s instead of ~0.3 s. What the first draw does not need waits until
   * the home is drawn (the same gate, never longer than 8 s): the bell list, the WhatsApp unread badge, and the tiles that
   * draw themselves later (hot alerts, «مشترين واقفين», the reply audit card, calls and visits). crmAfterHome(fn) runs fn
   * at once when nothing is waiting. */
  window.crmAfterHome=fn=>{const g=window.crmHomeFirst;if(g)g.then(()=>fn(),()=>fn());else fn();};
  const afterHome=name=>{const f=window[name];if(typeof f!=='function')return;
    window[name]=function(){const self=this,args=arguments,g=window.crmHomeFirst;
      return g?g.then(()=>f.apply(self,args)):f.apply(self,args);};};
  afterHome('loadNotifications');afterHome('refreshWhatsAppBadge');
  // updateUserUI / applyRoleVisibility call these just before the gate is armed, so they look one step later: the branch
  // people names and the owner's settings cards (lead routing, Google Sheet) are not on the home
  const afterHomeNext=name=>{const f=window[name];if(typeof f!=='function')return;
    window[name]=function(){const self=this,args=arguments;
      Promise.resolve().then(()=>{const g=window.crmHomeFirst;return g?g.then(()=>f.apply(self,args)):f.apply(self,args);}).catch(()=>{});};};
  afterHomeNext('crmLoadBranchPeople');afterHomeNext('refreshLeadFormCard');

  function mount(){
    const page=byId('page-dash');if(!page)return null;
    let box=byId('crmOwnerHome');
    if(box)return box;
    box=document.createElement('div');box.id='crmOwnerHome';box.className='coh';box.hidden=true;
    box.innerHTML='<section class="coh-hello" id="cohHello"></section>'
      +'<section class="coh-now" aria-labelledby="cohNowTitle"><h2 class="coh-h" id="cohNowTitle">المطلوب منك الآن</h2><div id="cohTiles" class="coh-tiles"></div></section>'
      +'<section class="card coh-sec coh-goals" id="cohGoals" hidden></section>'
      // 18 Nov 2026 (decision 36): the twins decision and the Instagram videos are tiles that open a sheet; #cohIg only
      // parks the Instagram card (crm-instagram-discovery.js) while its sheet is closed, it is never shown on the page
      +'<section class="coh-quick" id="cohQuick"><div id="cohAuto"></div><div id="cohIg" hidden></div><div id="cohUsage"></div></section>'
      // 19 Nov 2026 (Ahmed: «إيه، سرّعها»): no button to the old work list any more; it is never read or shown
      +'<section class="card coh-sec" id="cohSummary"></section>';
    const header=page.querySelector('.page-header');if(header)header.after(box);else page.prepend(box);
    return box;
  }
  function sheetEl(){
    let s=byId('cohSheet');if(s)return s;
    s=document.createElement('div');s.id='cohSheet';s.className='coh-sheet';s.hidden=true;
    s.innerHTML='<div class="coh-sheet-bg" data-coh="sclose"></div><div class="coh-sheet-box" role="dialog" aria-modal="true" aria-labelledby="cohSheetTitle"><header><h2 id="cohSheetTitle"></h2><button type="button" class="coh-sheet-x" data-coh="sclose" aria-label="إغلاق">✕</button></header><div id="cohSheetBody"></div></div>';
    document.body.append(s);return s;
  }
  const followupsCount=()=>typeof window.crmFollowupsCount==='function'?Number(window.crmFollowupsCount()||0):0;
  const INVENTORY_TARGET=25;
  const unaskedCount=()=>typeof window.crmVisitsUnaskedCount==='function'?Number(window.crmVisitsUnaskedCount()||0):0;

  function tile(label,count,attrs,sub,urgent){
    return '<button type="button" class="coh-tile'+(urgent?' urgent':'')+'" '+attrs+'><b dir="ltr">'+num(count)+'</b><span>'+esc(label)+'</span><small>'+esc(sub)+'</small></button>';
  }
  function drawHello(total){
    const h=Number(new Intl.DateTimeFormat('en-GB',{hour:'numeric',hour12:false,timeZone:'Asia/Muscat'}).format(new Date()));
    const date=new Date().toLocaleDateString('ar-OM-u-nu-latn',{timeZone:'Asia/Muscat',weekday:'long',day:'numeric',month:'long'});
    const name=(byId('welcomeName')&&byId('welcomeName').textContent||'').trim();
    // 17 Nov 2026 (Ahmed: «تلغي اي شي متشابه وتبسط الصفحه»): one short line; the count is already on the tiles below
    byId('cohHello').innerHTML='<strong>'+(h<12?'صباح الخير':'مساء الخير')+(name?' '+esc(name):'')+'</strong><span>'+esc(date)+'</span>';
  }
  function drawTiles(d,pending){
    const t=[];let todo=0;
    if(pending){todo+=pending;t.push(tile('ردود تنتظر موافقتك',pending,'data-coh="nav" data-nav="replies"','افتح واعتمد الرد',true));}
    const fu=followupsCount();
    if(fu){todo+=fu;t.push(tile('متابعة اليوم',fu,'data-coh="sheet" data-kind="followups"','أرسلها من واتساب',true));}
    const st0=studiesCount();
    if(st0){todo+=st0;t.push(tile('دراسات سعر جاهزة',st0,'data-coh="sheet" data-kind="studies"','راجع الأرقام ووافق',true));}
    const pr0=pricingItems().length,pa0=otherPaused().length;
    if(pa0){todo+=pa0;t.push(tile('العقل موقوف عندهم',pa0,'data-coh="sheet" data-kind="paused"','شوف السبب وكمّل',true));}
    if(pr0){todo+=pr0;t.push(tile('دراسة سعر',pr0,'data-coh="sheet" data-kind="pricing"','ملاك ينتظرون تسعيرك',true));}
    // 18 Nov 2026 (Ahmed: «لوحة العمل ما أريدها تكون ربشة… يكون في عدد أضغط عليه أشوف»): «مشترين واقفين» and «العقود» (SQL126,
    // crm-home-attention.js) are tiles that open a sheet like the rest, never open lists on the page. Owner only.
    const ha=canResume()&&window.crmHomeAttention; // SQL130: staff too (manager, agent)
    if(ha){const w=ha.count('waiting'),c=ha.count('contracts');
      if(w){todo+=w;t.push(tile('مشترين واقفين',w,'data-coh="sheet" data-kind="waiting"','سألوا وما انرد عليهم',true));}
      if(c)t.push(tile('العقود',c,'data-coh="sheet" data-kind="contracts"',ha.sub('contracts'),false));}
    if(d.owner_leads_new)t.push(tile('عروض ملاك جديدة',d.owner_leads_new,'data-coh="nav" data-nav="owner-leads"','يفتح صفحة العروض',false));
    // 17 Nov 2026: «معاينات أمس بدون متابعة من العقل» (crm-calls-meetings.js) was its own card above the greeting; it is the
    // same subject, so it now opens from this tile, at the top of the same sheet, and makes the tile urgent
    const un0=unaskedCount();
    if(Number(d.overdue_total)||un0){if(un0)todo+=un0;t.push(tile('زيارات يتابعها الذكاء الاصطناعي',Number(d.overdue_total||0)+un0,'data-coh="sheet" data-kind="visits"',un0?un0+' معاينة أمس بدون سؤال، شيكها':'للاطلاع، العقل يسأل العميل',!!un0));}
    const pr=(d.problems||[]).length;
    if(pr)t.push(tile('مشاكل',pr,'data-coh="sheet" data-kind="problems"','تحتاج انتباه',false));
    // 18 Nov 2026 (decision 36): the two quick decisions that were open cards are tiles too. Owner only, as before.
    if(isOwner()){
      const tw=twinsOpen().length;
      if(tw){todo+=tw;t.push(tile('عقارات بنفس المواصفات',tw,'data-coh="sheet" data-kind="twins"','قرار سريع: تربط الفيديوهات؟',false));}
      const ig=igCount();
      if(ig){todo+=ig;t.push(tile('فيديوهات إنستقرام',ig,'data-coh="sheet" data-kind="ig"','تحتاج ربط بعقار',false));}
      // SQL144 (19 Nov 2026): the last twice-a-day check of the reply agent, read only (crm-reply-audit.js). The count is the
      // mistakes still open; the tile shows after the first run, also with none
      const ra=window.crmReplyAudit,rc=ra?ra.count():null;
      if(rc!=null){const u=ra.urgent();if(u)todo+=rc;t.push(tile('🧠 فحص الردود',rc,'data-coh="sheet" data-kind="audit"',ra.sub(),u));}
    }
    byId('cohTiles').innerHTML=t.length?t.join(''):'<p class="coh-empty">'+(isOwner()?'ما في شي يحتاج قرارك الحين ✓':'ما في شي متأخر الحين ✓')+'</p>';
    drawHello(todo);
    parkIg();
  }
  // The Instagram card (crm-instagram-discovery.js) waits in the hidden #cohIg and moves into the sheet while it is open
  const igCount=()=>typeof window.crmIgAlertCount==='function'?Number(window.crmIgAlertCount()||0):0;
  function parkIg(){
    const ig=byId('igDiscoveryAlert'),slot=byId('cohIg');
    if(ig&&slot&&ig.parentNode!==slot&&!ig.closest('#cohSheetBody'))slot.append(ig);
  }
  function parkIgOut(){
    const ig=byId('igDiscoveryAlert'),slot=byId('cohIg');
    if(ig&&slot&&ig.closest('#cohSheetBody'))slot.append(ig);
  }
  function drawIgSheet(){
    const body=byId('cohSheetBody'),ig=byId('igDiscoveryAlert');if(!body)return;
    let none=body.querySelector('.coh-ig-empty');
    if(ig&&ig.parentNode!==body)body.prepend(ig);
    const count=igCount();
    if(ig)ig.hidden=!count;
    if(!count&&!none){none=document.createElement('p');none.className='coh-empty coh-ig-empty';none.textContent='ما في فيديو جديد يحتاج ربط ✓';body.append(none);}
    else if(count&&none)none.remove();
  }
  function twinsHtml(){
    const open=twinsOpen();
    if(!open.length)return '<p class="coh-empty">ما في عقارات تحتاج قرار ✓</p>';
    return '<ul class="coh-list">'+open.map(g=>'<li class="coh-twin"><strong>'+g.properties.map(p=>esc(p.title)).join(' · ')+'</strong><small>'+g.properties.map(p=>num(p.videos)+' فيديو').join(' · ')+'</small><p>تربط كل الفيديوهات على الكل ؟ أداء الفيديو واستفساراته تنحسب لكل عقار</p><div class="coh-twin-actions"><button type="button" class="btn-primary" data-coh="twin-yes" data-key="'+esc(g.key)+'">نعم اربطهم</button><button type="button" class="btn-secondary" data-coh="twin-no" data-key="'+esc(g.key)+'">لا مختلفين</button></div></li>').join('')+'</ul>';
  }
  function visitRow(v){
    return '<li class="coh-row"><div class="coh-info"><strong>'+esc(v.property||'عقار')+'</strong><small>'+esc(v.client||'—')+' · <span class="coh-late">فات موعدها '+esc(v.viewing_date)+'</span></small>'+(v.notes?'<small class="coh-note">'+esc(v.notes)+'</small>':'')+'</div>'
      +'<button type="button" class="btn-secondary coh-go" data-cqv="result" data-id="'+esc(v.id)+'">سجّل النتيجة</button></li>';
  }
  function visitsHtml(){
    const o=(last&&last.data.overdue)||[];
    const un=typeof window.crmVisitsUnaskedHtml==='function'?window.crmVisitsUnaskedHtml():'';
    return un+(o.length?'':'<p class="coh-empty">ما في زيارة فات موعدها بدون نتيجة</p>')+'<p class="coh-since">الذكاء الاصطناعي يسأل العميل ويسجل النتيجة لحاله أول ما يرد. تقدر تسجلها أنت إذا تعرفها</p>'
      +'<button type="button" class="coh-add" data-cqv="new">+ زيارة ما كانت مسجّلة</button><ul class="coh-list">'+o.map(visitRow).join('')+'</ul>';
  }
  function problemsHtml(){
    const list=(last&&last.data.problems)||[];
    return list.length?'<ul class="coh-list">'+list.map(p=>'<li class="coh-row coh-problem"><div class="coh-info"><strong>'+esc(p.title)+(p.count?' <b dir="ltr">'+num(p.count)+'</b>':'')+'</strong>'+(p.detail?'<small>'+esc(p.detail)+'</small>':'')+'</div>'
      +(p.nav?'<button type="button" class="btn-secondary coh-go" data-coh="nav" data-nav="'+esc(p.nav)+'">فتح</button>':'')+'</li>').join('')+'</ul>':'<p class="coh-empty">ما في مشاكل الحين</p>';
  }
  const ROUTE={barka:'بركاء',muscat:'مسقط'};
  function pausedRows(list,pricing){
    return list.map(i=>
      '<li class="coh-row coh-paused"><div class="coh-info"><strong>'+esc(i.name||'عميل')+' <small>'+esc(pricing?(ROUTE[i.route_key]||''):(KIND[i.kind]||''))+'</small></strong>'
      +'<small class="coh-note">'+(pricing?esc(String(i.reason||'').replace(/^\s*دراسة\s*سعر\s*:?\s*/,'')):'السبب: '+esc(i.reason))+'</small>'
      +(i.last_message?'<small class="coh-note">آخر رسالة منه: <span dir="auto">'+esc(i.last_message)+'</span></small>':'')
      +(i.summary?'<small class="coh-note">'+esc(i.summary)+'</small>':'')+'</div>'
      // 11 Nov 2026 (Ahmed): the phone's WhatsApp and the CRM chat, side by side (crm-wa-buttons.js)
      +'<div class="coh-paused-actions">'+(typeof window.crmWaButtons==='function'?window.crmWaButtons({phone:i.phone,conversationId:i.conversation_id,clientId:i.client_id,cls:'btn-secondary coh-go',note:false})
        :'<button type="button" class="btn-secondary coh-go" data-coh="popen" data-id="'+esc(i.conversation_id)+'">افتح المحادثة</button>')
      // 11 Nov (Ahmed): a price study always stays with him, so no «كمّل يا عقل» there; every row can carry a note for Claude
      // R58 (14 Nov, Ahmed): staff get the note button too, the same as his (this row's own button carries the pause reason)
      +'<button type="button" class="btn-secondary coh-go" data-coh="pnote" data-id="'+esc(i.conversation_id)+'" data-name="'+esc(i.name||'')+'">ملاحظة لـ Claude</button>'
      +(pricing||!canResume()||(!isOwner()&&isStudyChat(i))?'':'<button type="button" class="btn-primary coh-go" data-coh="presume" data-id="'+esc(i.conversation_id)+'">كمّل يا عقل</button>')
      // R40: «تجاهل نهائي» = no reply and no follow-up ever, and the chat leaves this list
      +(pricing||!canResume()||isStudyChat(i)?'':'<button type="button" class="btn-secondary coh-go coh-ignore" data-coh="pignore" data-id="'+esc(i.conversation_id)+'">تجاهل نهائي</button>')
      +(pricing&&canResume()?'<button type="button" class="btn-primary coh-go" data-coh="pprice" data-id="'+esc(i.conversation_id)+'">ارسل السعر للمالك</button>'
        +'<button type="button" class="btn-secondary coh-go" data-coh="pdrop" data-id="'+esc(i.conversation_id)+'">ما نسعّره (الغِ)</button>':'')+'</div>'
      +(pricing&&canResume()?priceForm(i):'')+'</li>').join('');
  }
  /* 12 Nov 2026 (Ahmed: «سوي زر يكون افضل»): the priced answer goes back to the owner from the chat's branch number, through
   * the same CRM send as the chat (crmSendWhatsApp → whatsapp-send: 24 h window, one send per text, recorded in the chat).
   * Ahmed types the price, a suggested message fills in and he can change it before sending. The chat stays his (R26). */
  const PRICE_TEXT=p=>'السلام عليكم\nدرسنا العقار، والسعر المناسب له في السوق حالياً حوالي '+p+' ريال\nاذا يناسبك نبدأ نسوقه بهالسعر ؟';
  function priceForm(i){
    const id=esc(i.conversation_id);
    return '<div class="coh-price-form" data-pf="'+id+'" hidden>'
      +'<label class="coh-note">السعر (ريال)<input class="fi" type="text" inputmode="numeric" dir="ltr" data-pf-price="'+id+'" autocomplete="off"></label>'
      +'<textarea class="fi" rows="4" dir="auto" data-pf-text="'+id+'" placeholder="اكتب السعر فوق والرسالة تنكتب هنا، وتقدر تعدلها"></textarea>'
      +'<button type="button" class="btn-primary coh-go" data-coh="psend" data-id="'+id+'">ارسل للمالك من رقم الفرع</button></div>';
  }
  document.addEventListener('input',e=>{
    const inp=e.target&&e.target.closest?e.target.closest('[data-pf-price]'):null;
    if(inp){const id=inp.getAttribute('data-pf-price'),ta=document.querySelector('[data-pf-text="'+CSS.escape(id)+'"]');
      const p=String(inp.value||'').replace(/[^\d.,]/g,'').trim();
      if(ta&&ta.dataset.edited!=='1')ta.value=p?PRICE_TEXT(p):'';return;}
    const ta=e.target&&e.target.closest?e.target.closest('[data-pf-text]'):null;if(ta)ta.dataset.edited='1';
  });
  function ignoredHtml(){
    const n=Number(paused.ignored||0);
    if(!n&&!(ignoredList&&ignoredList.length))return '';
    let h='<div class="coh-ignored"><button type="button" class="coh-ignored-link" data-coh="ptoggle-ignored" aria-expanded="'+ignoredOpen+'">'+(ignoredOpen?'إخفاء ':'')+'المتجاهلين <b dir="ltr">'+num(n)+'</b></button>';
    if(ignoredOpen){
      if(ignoredList==null)h+='<p class="coh-empty">جاري التحميل…</p>';
      else if(!ignoredList.length)h+='<p class="coh-empty">ما في أحد</p>';
      else h+='<p class="coh-since">ما ينرد عليهم ولا توصلهم متابعة. «رجّعه» يخلي العقل يرد عليه مرة ثانية</p><ul class="coh-list">'+ignoredList.map(i=>
        '<li class="coh-row coh-paused"><div class="coh-info"><strong>'+esc(i.name||'عميل')+' <small>'+esc(i.reason||'')+'</small></strong>'
        +(i.last_message?'<small class="coh-note">آخر رسالة منه: <span dir="auto">'+esc(i.last_message)+'</span></small>':'')+'</div>'
        +'<div class="coh-paused-actions">'+(typeof window.crmWaButtons==='function'?window.crmWaButtons({phone:i.phone,conversationId:i.conversation_id,clientId:i.client_id,cls:'btn-secondary coh-go'}):'')
        +'<button type="button" class="btn-secondary coh-go" data-coh="punignore" data-id="'+esc(i.conversation_id)+'">رجّعه</button></div></li>').join('')+'</ul>';
    }
    return h+'</div>';
  }
  function loadIgnored(){
    ignoredList=null;drawSheet();
    supa.rpc('crm_ignored_chats').then(r=>{if(r.error)throw r.error;ignoredList=(r.data&&r.data.items)||[];paused.ignored=ignoredList.length;drawSheet();})
      .catch(()=>{ignoredList=[];ignoredOpen=false;drawSheet();toast('ما قدرت أفتح المتجاهلين. جرب مرة ثانية','error');});
  }
  function pausedHtml(){
    const items=otherPaused();
    if(!items.length)return '<p class="coh-empty">ما في أحد موقوف عنده العقل</p>'+ignoredHtml();
    const counts={};items.forEach(i=>{counts[i.kind]=(counts[i.kind]||0)+1;});
    if(pausedFilter!=='all'&&!counts[pausedFilter])pausedFilter='all';
    const tabs=[['all','الكل',items.length]].concat(Object.keys(KIND).filter(k=>counts[k]).map(k=>[k,KIND[k],counts[k]]))
      .map(([k,l,n])=>'<button type="button" class="cfu-tab'+(pausedFilter===k?' on':'')+'" data-coh="pfilter" data-v="'+k+'" aria-pressed="'+(pausedFilter===k)+'">'+esc(l)+' <b dir="ltr">'+n+'</b></button>').join('');
    return '<div class="cfu-tabs coh-ptabs">'+tabs+'</div><ul class="coh-list">'+pausedRows(items.filter(i=>pausedFilter==='all'||i.kind===pausedFilter),false)+'</ul>'+ignoredHtml();
  }
  function pricingHtml(){
    const items=pricingItems();
    if(!items.length)return '<p class="coh-empty">ما في ملاك ينتظرون تسعير الحين</p>';
    // R59 (14 Nov 2026, Ahmed): each branch on its own, like the daily follow-ups; the price goes out from that branch's number
    const n=k=>items.filter(i=>i.route_key===k).length;
    if(pricingBranch!=='all'&&!n(pricingBranch))pricingBranch='all';
    const tabs=[['all','الكل',items.length],['barka','بركاء',n('barka')],['muscat','مسقط',n('muscat')]]
      .map(([k,l,c])=>'<button type="button" class="cfu-tab'+(pricingBranch===k?' on':'')+'" data-coh="prbranch" data-v="'+k+'" aria-pressed="'+(pricingBranch===k)+'">'+l+' <b dir="ltr">'+c+'</b></button>').join('');
    return '<p class="coh-since">ملاك أرسلوا عقاراتهم والعقل وقف لين تحدد السعر. افتح المحادثة وسعّر، وبعدها «كمّل يا عقل»</p><div class="cfu-tabs coh-ptabs">'+tabs+'</div><ul class="coh-list">'+pausedRows(items.filter(i=>pricingBranch==='all'||i.route_key===pricingBranch),true)+'</ul>';
  }
  function drawSheet(){
    if(!sheetKind||sheetKind==='followups')return;
    const body=byId('cohSheetBody');if(!body)return;
    // SQL96: the studies sheet draws itself, so a refresh of the home never wipes an inspection note being written or recorded
    if(sheetKind==='studies'){if(typeof window.crmPriceStudiesDraw==='function')window.crmPriceStudiesDraw(body);else body.innerHTML=typeof window.crmPriceStudiesHtml==='function'?window.crmPriceStudiesHtml():'';return;}
    if((sheetKind==='waiting'||sheetKind==='contracts')&&window.crmHomeAttention){body.innerHTML=window.crmHomeAttention.html(sheetKind);return;}
    if(sheetKind==='ig'){drawIgSheet();return;}
    if(sheetKind==='audit'){body.innerHTML=window.crmReplyAudit?window.crmReplyAudit.html():'';return;}
    body.innerHTML=sheetKind==='twins'?twinsHtml():sheetKind==='paused'?pausedHtml():sheetKind==='pricing'?pricingHtml():sheetKind==='visits'?visitsHtml():problemsHtml();
  }
  function openSheet(kind){
    const s=sheetEl();
    if(sheetKind==='ig')parkIgOut();
    sheetKind=kind;byId('cohSheetTitle').textContent=TITLES[kind]||'';
    const body=byId('cohSheetBody');body.innerHTML='';
    if(kind!=='studies'&&typeof window.crmPriceStudiesLeave==='function')window.crmPriceStudiesLeave();
    if(kind==='followups'){
      const fu=byId('crmFollowups');if(!fu)return;
      body.append(fu);fu.hidden=false;
      const tg=fu.querySelector('.cfu-toggle[aria-expanded="false"]');if(tg)tg.click();
    }else drawSheet();
    s.hidden=false;document.body.classList.add('coh-lock');body.scrollTop=0;
  }
  function closeSheet(){
    const s=byId('cohSheet');if(!s||s.hidden)return;
    const fu=byId('crmFollowups'),home=byId('crmOwnerHome');
    if(fu&&fu.closest('#cohSheetBody')&&home)home.append(fu);
    parkIgOut();
    s.hidden=true;sheetKind=null;document.body.classList.remove('coh-lock');
    if(typeof window.crmPriceStudiesLeave==='function')window.crmPriceStudiesLeave();
  }
  /* System updates (10 Nov 2026): deals the system closed because a property was sold, withdrawn or archived
   * (SQL77, type deal_auto_closed) and listing contracts that ended (SQL76, type property_archive). Nothing else in
   * the CRM shows these notifications. «تم» marks one read (the owner's own notifications, RLS). */
  // SQL102 (14 Nov 2026): the system's WhatsApp replies this month per branch number, against Meta's 1,000 free service messages.
  // An estimate (the CRM's own count); shown to the owner and to staff, read after the first draw so the home never waits for it.
  let usage=[];
  function drawUsage(){
    const slot=byId('cohUsage');if(!slot)return;
    const rows=(Array.isArray(usage)?usage:[]).filter(u=>u&&(u.route_key==='barka'||u.route_key==='muscat'));
    if(!rows.length){slot.innerHTML='';return;}
    const name={barka:'بركاء',muscat:'مسقط'};
    // 17 Nov 2026: while both numbers are far from the limit it is one quiet line; the full card only near or past it
    const calm=rows.every(u=>!u.blocked&&Number(u.used||0)<Number(u.free_limit||1000)*0.8);
    if(calm){slot.innerHTML='<p class="coh-usage-line">ردود النظام على واتساب هذا الشهر: '+rows.map(u=>'<span class="coh-usage-num">'+esc(name[u.route_key])+' <bdi dir="ltr">'+num(u.used)+' / '+num(u.free_limit||1000)+'</bdi></span>').join(' · ')+'</p>';return;}
    slot.innerHTML='<div class="card coh-sec"><div class="coh-subhead"><h3>ردود النظام على واتساب هذا الشهر</h3></div>'
      +rows.map(u=>{
        const used=Number(u.used||0),lim=Number(u.free_limit||1000),pct=Math.max(0,Math.min(100,Math.round(used/lim*100)));
        const state=u.blocked?'stop':used>=lim?'stop':pct>=80?'warn':'ok';
        const color=state==='stop'?'#B91C1C':state==='warn'?'#B45309':'#15803D';
        const note=u.blocked?'واقف: ردود النظام ما توصل. رد من تطبيق واتساب بزنس':used>=lim?'خلص المجاني':pct>=80?'قرّب يخلص المجاني':'';
        return '<div style="margin:8px 0"><div style="display:flex;justify-content:space-between;gap:8px;font-size:13px"><strong>رقم '+esc(name[u.route_key])+'</strong><span dir="ltr">'+num(used)+' / '+num(lim)+'</span></div>'
          +'<div style="height:8px;border-radius:6px;background:#E5E7EB;overflow:hidden;margin-top:4px" role="img" aria-label="'+esc(num(used)+' من '+num(lim))+'"><div style="height:100%;width:'+pct+'%;background:'+color+'"></div></div>'
          +(note?'<small style="color:'+color+';font-weight:600">'+esc(note)+'</small>':'')+'</div>';
      }).join('')
      +'<small style="color:#6B7280">عدد تقريبي من النظام. ميتا تعطي كل رقم 1000 رد مجاني في الشهر، والرد بيدك من التطبيق ما ينحسب.</small></div>';
  }
  let autoNotes=[];
  const AUTO_TYPES=['deal_auto_closed','property_archive'];
  function readAutoNotes(){
    if(typeof currentUser==='undefined'||!currentUser)return Promise.resolve(null);
    return supa.from('notifications').select('id,type,title,body,created_at').eq('user_id',currentUser.id).in('type',AUTO_TYPES)
      .eq('is_read',false).order('created_at',{ascending:false}).limit(10).then(r=>r.error?null:(r.data||[]),()=>null);
  }
  function drawAuto(){
    const slot=byId('cohAuto');if(!slot)return;
    if(!autoNotes.length){slot.innerHTML='';return;}
    const when=v=>{try{return new Date(v).toLocaleString('ar-OM-u-nu-latn',{timeZone:'Asia/Muscat',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});}catch(_){return '';}};
    // 17 Nov 2026: for reading only (the system already did it), so one closed line instead of a list on the page
    const wasOpen=!!(slot.querySelector('details')&&slot.querySelector('details').open);
    slot.innerHTML='<details class="card coh-sec coh-fold"'+(wasOpen?' open':'')+'><summary>تحديثات تلقائية من النظام <b dir="ltr">'+num(autoNotes.length)+'</b> <small>للاطلاع</small></summary><ul class="coh-list">'
      +autoNotes.map(n=>'<li class="coh-row"><div class="coh-info"><strong>'+(n.type==='deal_auto_closed'?'🔒 ':'📦 ')+esc(n.title||'')+'</strong>'
        +(n.body?'<details class="coh-novideo"><summary>'+esc(String(n.body).slice(0,90))+(String(n.body).length>90?'…':'')+'</summary><p>'+esc(n.body)+'</p></details>':'')
        +'<small>'+esc(when(n.created_at))+'</small></div><button type="button" class="btn-secondary coh-go" data-coh="auto-done" data-id="'+esc(n.id)+'">تم</button></li>').join('')+'</ul></details>';
  }
  // Twins still waiting for a decision (the same rule as the card it replaced); drawn by twinsHtml in the «twins» sheet
  function drawTwins(groups){
    return (Array.isArray(groups)?groups:[]).filter(g=>g&&!g.dismissed&&(g.properties||[]).some(p=>Number(p.videos)<Number(g.videos)));
  }
  const twinsOpen=()=>last&&isOwner()?drawTwins(last.twins):[];
  /* 18 Nov 2026 (decision 64): the home and the Instagram review (crm-instagram-discovery.js) each read crm_property_twins
   * on every load. They share one read now: one still on its way, or answered less than 3 seconds ago, for the same
   * session. A twin decision reads it again (force). A failed read is never kept. */
  let twinKey='',twinDone=0,twinRead=null,forceTwins=false;
  window.crmPropertyTwins=function(force){
    const key=(typeof crmSessionGeneration==='undefined'?'':crmSessionGeneration)+':'+(typeof currentUser!=='undefined'&&currentUser?currentUser.id:'');
    if(!force&&twinRead&&twinKey===key&&(!twinDone||Date.now()-twinDone<3000))return twinRead;
    const read=Promise.resolve(supa.rpc('crm_property_twins')).then(r=>{if(twinRead===read){if(!r||r.error)twinRead=null;else twinDone=Date.now();}return r;},e=>{if(twinRead===read)twinRead=null;throw e;});
    twinKey=key;twinDone=0;twinRead=read;return read;
  };
  function drawSummary(d){
    const p=d.properties||{},r=d.report||{},label={barka:'بركاء',muscat:'مسقط'};
    // 17 Nov 2026: the target is now 25 for the company by 12 Feb 2027 (Ahmed, 16 Nov; AGENTS.md). Display only: the saved
    // branch targets and their per-branch default are unchanged until he says how the 25 splits. SQL138 (18 Nov, [62]): no split, one company number; the goal comes from the snapshot (company_inventory.goal).
    const avail=(p.branches||[]).reduce((s,b)=>s+Number(b.available||0),0);
    const props=[['متاح للشركة من '+((goals&&goals.company_inventory&&goals.company_inventory.goal)||INVENTORY_TARGET),avail]].concat((p.branches||[]).map(b=>['متاح '+(label[b.branch]||b.branch),b.available])).concat([['أضيفت هذا الأسبوع',p.added_week],['توفرها ما تأكد من شهر',p.unchecked]]);
    // 17 Nov 2026: once the goals card is drawn it carries the visits and bookings, so they are not repeated here
    const rep=[['عملاء جدد',r.new_clients],['ردود الوكيل',r.agent_replies]].concat(goals?[]:[['زيارات تمت',r.visits_done],['حجوزات الشهر',r.bookings_month]]).concat([['مبيعات الشهر',r.sales_month]]).filter(([,v])=>v!=null);
    const cells=a=>a.map(([l,v])=>'<div class="coh-stat"><strong dir="ltr">'+num(v)+'</strong><small>'+esc(l)+'</small></div>').join('');
    const noVideo=p.no_video||[];
    byId('cohSummary').innerHTML='<h2 class="coh-h">ملخص</h2><h3 class="coh-h3">العقارات</h3><div class="coh-stats">'+cells(props)+'</div>'
      +'<h3 class="coh-h3">هذا الأسبوع <small>من '+esc(r.week_start||'')+'</small></h3><div class="coh-stats">'+cells(rep)+'</div>'
      +(noVideo.length?'<details class="coh-novideo"><summary>متاحة من أكثر من 7 أيام بدون فيديو <b dir="ltr">'+num(noVideo.length)+'</b></summary><p>'+noVideo.map(esc).join(' · ')+'</p></details>':'');
    // 17 Nov 2026: the «كل العقارات» and «التقارير الكاملة» links left the summary: the same two pages are in the side menu
  }
  /* 17 Nov 2026 (Ahmed, after the full check: «سوّ الإضافات كلها»): the branch goals on the home, from the same snapshot as
   * the targets in Reports (crm_branch_target_snapshot): completed visits this week of 5, documented human follow-ups
   * today of 10, new qualified properties this week of 2, deals (paid bookings) this month of 3 (the owner also sees the expected
   * office commission of 5,400, SQL138 [3]; staff never get money figures). Staff see their branch, the owner both. Display only. */
  let goals=null;
  function drawGoals(){
    const el=byId('cohGoals');if(!el)return;
    const list=goals&&Array.isArray(goals.branches)?goals.branches:[];
    if(!list.length){el.hidden=true;el.innerHTML='';return;}
    const owner=isOwner();
    const chip=(label,v,g,money)=>{const n=Number(v||0),t=Number(g||0),met=t>0&&n>=t;
      return '<span class="coh-goal'+(met?' met':'')+'"><b dir="ltr">'+(money?num(Math.round(n)):num(n))+'<small>/'+num(t)+'</small></b><small>'+esc(label)+'</small></span>';};
    el.innerHTML='<h2 class="coh-h">الأهداف <small>الأسبوع من '+esc(goals.week_start||'')+'</small></h2>'+list.map(b=>{const g=b.goals||{};
      return '<div class="coh-goal-row">'+(list.length>1||owner?'<h3 class="coh-h3">'+esc(b.name||b.branch||'')+'</h3>':'')+'<div class="coh-goal-chips">'
        +chip('زيارات تمت هالأسبوع',b.viewings,g.viewings)+chip('متابعات اليوم',b.followups,g.followups)
        +chip('عقارات جديدة هالأسبوع',b.new_properties,g.new_properties)+chip('صفقات الشهر',b.bookings,g.bookings)
        +(owner&&b.expected_commission!=null?chip('عمولة متوقعة الشهر',b.expected_commission,g.expected_commission,true):'')+'</div></div>';}).join('');
    el.hidden=false;
  }
  async function load(){
    const page=byId('page-dash'),box=mount();if(!page||!box){releaseGate();return;}
    markHome();
    if(!hasHome()||typeof supa==='undefined'){box.hidden=true;page.classList.remove('coh-on');releaseGate();return;}
    const seq=++sequence,owner=isOwner(),twinForce=forceTwins;let ok=false;forceTwins=false;
    try{
      // The follow-up count is read together with the rest (it is lighter), so its tile is there on the first draw.
      const fu=typeof window.crmFollowupsRefresh==='function'?Promise.race([window.crmFollowupsRefresh(),new Promise(r=>setTimeout(r,1500))]):null;
      // SQL94: the price studies waiting for approval are read with the rest, so their tile is there on the first draw (R59, SQL104: staff too)
      const ps=(owner||canResume())&&typeof window.crmPriceStudiesRefresh==='function'?Promise.race([window.crmPriceStudiesRefresh().catch(()=>0),new Promise(r=>setTimeout(r,2500))]):null;
      const [home,pending,twinGroups,pz]=await Promise.all(owner
        ?[supa.rpc('crm_owner_home'),typeof window.crmPendingReplies==='function'?window.crmPendingReplies().catch(()=>0):0,window.crmPropertyTwins(twinForce),supa.rpc('crm_paused_chats'),fu,ps]
        :[supa.rpc('crm_staff_home'),0,null,canResume()?supa.rpc('crm_paused_chats'):null,fu].concat(ps));
      if(seq!==sequence)return;
      // a staff session never keeps the owner's lists from an earlier session in the same tab
      if(!owner){paused={items:[],total:0};autoNotes=[];}
      usage=[];
      if(pz&&!pz.error&&pz.data)paused=pz.data;
      if(home.error||!home.data){if(!last){box.hidden=true;page.classList.remove('coh-on');}return;}
      ok=true;retries=0;clearTimeout(retryTimer);document.documentElement.classList.remove('coh-slow');
      last={data:home.data,pending:pending||0,twins:twinGroups&&!twinGroups.error?twinGroups.data:[]};
      render();
      box.hidden=false;page.classList.add('coh-on');
      // after the first draw, so the home never waits for it
      readAutoNotes().then(list=>{if(seq!==sequence||list==null)return;autoNotes=list;drawAuto();});
      supa.rpc('crm_whatsapp_usage').then(r=>{if(seq!==sequence||!r||r.error)return;usage=r.data||[];drawUsage();});
      window.crmBranchSnapshot().then(r=>{if(seq!==sequence||!r||r.error||!r.data)return;goals=r.data;drawGoals();if(last)drawSummary(last.data);}).catch(()=>{});
    }finally{if(seq===sequence&&(ok||!retryLater()))releaseGate();}
  }
  /* 17 Nov 2026 (full check, Ahmed: «صلّح تكرار طلبات الرئيسية»): since the goals card, the home and the old target card
   * (crm-operations-v6.js) each read crm_branch_target_snapshot on every load. They now share one read: a request still
   * on its way, or one answered less than 3 seconds ago, for the same signed-in session. A failed read is never kept. */
  // 18 Nov 2026 (decision 64): crm-operations-v6.js loads first and defines the same shared read (its own first reads run
  // before this file is there); this copy only stands in if that file is missing
  let snapKey='',snapDone=0,snapRead=null;
  if(typeof window.crmBranchSnapshot!=='function')window.crmBranchSnapshot=function(){
    const key=(typeof crmSessionGeneration==='undefined'?'':crmSessionGeneration)+':'+(typeof currentUser!=='undefined'&&currentUser?currentUser.id:'');
    if(snapRead&&snapKey===key&&(!snapDone||Date.now()-snapDone<3000))return snapRead;
    const read=Promise.resolve(supa.rpc('crm_branch_target_snapshot')).then(r=>{if(snapRead===read){if(!r||r.error)snapRead=null;else snapDone=Date.now();}return r;},e=>{if(snapRead===read)snapRead=null;throw e;});
    snapKey=key;snapDone=0;snapRead=read;return read;
  };
  /* 14 Nov 2026 (Ahmed, signed in as staff: «يفتحلي الصفحه كذا»): the database restarted at 16:04, the first read of the
   * home failed and the old dashboard stayed until the page was reloaded by hand. A failed first load is now read again
   * by itself (after 2, 4 and 8 seconds, then every 15 seconds, about two minutes in all). The gate keeps its placeholder
   * while a retry is waiting, never longer than its own 8 seconds; after that the old page shows and the home replaces
   * it as soon as a read succeeds. */
  let retries=0,retryTimer=null;
  function retryLater(){
    // 19 Nov 2026: no last try any more (the old dashboard is never the fallback); after three failed tries the placeholder
    // says the connection is slow, and the home keeps trying (every 30 seconds after ten tries)
    if(last||!hasHome())return false;
    clearTimeout(retryTimer);
    if(retries>=3)document.documentElement.classList.add('coh-slow');
    retryTimer=setTimeout(()=>{if(!last&&hasHome())load().catch(()=>{});},[2000,4000,8000][retries]||(retries<10?15000:30000));
    retries++;return true;
  }
  function render(){
    if(!last)return;
    const d=last.data;
    drawTiles(d,last.pending);drawSummary(d);drawSheet();
  }
  document.addEventListener('crm-followups-updated',()=>{if(last)drawTiles(last.data,last.pending);});
  document.addEventListener('crm-price-studies-updated',()=>{if(last)drawTiles(last.data,last.pending);});
  document.addEventListener('crm-home-attention-updated',()=>{if(last)drawTiles(last.data,last.pending);if(sheetKind==='waiting'||sheetKind==='contracts')drawSheet();});
  document.addEventListener('crm-ig-alert-updated',()=>{if(last)drawTiles(last.data,last.pending);if(sheetKind==='ig')drawSheet();});
  document.addEventListener('crm-reply-audit-updated',()=>{if(last)drawTiles(last.data,last.pending);if(sheetKind==='audit')drawSheet();});
  document.addEventListener('crm-visits-unasked-updated',()=>{if(last)drawTiles(last.data,last.pending);if(sheetKind==='visits')drawSheet();});
  window.crmOwnerHomeOpenSheet=kind=>{if(hasHome())openSheet(kind);};
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeSheet();});
  document.addEventListener('click',e=>{
    const b=e.target.closest('[data-coh]');if(!b)return;
    const act=b.dataset.coh;
    if(act==='pprice'){const f=document.querySelector('[data-pf="'+CSS.escape(b.dataset.id)+'"]');if(f){f.hidden=!f.hidden;if(!f.hidden){const p=f.querySelector('[data-pf-price]');if(p)p.focus();}}return;}
    if(act==='psend'){
      const id=b.dataset.id,it=paused.items.find(i=>i.conversation_id===id)||{},ta=document.querySelector('[data-pf-text="'+CSS.escape(id)+'"]');
      const body=String(ta&&ta.value||'').trim();
      if(!body){toast('اكتب السعر أو الرسالة أول','error');return;}
      if(!it.client_id||typeof crmSendWhatsApp!=='function'){toast('ما قدرت أحدد المالك. افتح المحادثة وارسل منها','error');return;}
      if(b.disabled)return;b.disabled=true;const old=b.textContent;b.textContent='جاري الإرسال…';
      crmSendWhatsApp({client_id:it.client_id,conversation_id:id,body}).then(res=>{
        b.textContent='انرسل ✓';if(ta)ta.disabled=true;
        toast(res&&res.warning?res.warning:'انرسل السعر للمالك من رقم الفرع',res&&res.warning?'error':'success');
      }).catch(err=>{b.disabled=false;b.textContent=old;toast(String(err&&err.message||err),'error');});
      return;
    }
    if(act==='sheet')openSheet(b.dataset.kind);
    else if(act==='sclose')closeSheet();
    else if(act==='pfilter'){pausedFilter=b.dataset.v||'all';drawSheet();}
    else if(act==='prbranch'){pricingBranch=b.dataset.v||'all';drawSheet();}
    else if(act==='pdrop'){
      // R88 / SQL108: an owner who should not be priced leaves the list (the task, his offers and the hold close; nothing is sent)
      const id=b.dataset.id,why=window.prompt('ليش ما نسعّره؟ (مثلاً: خارج مسقط وبركاء، مسكون، انسحب المالك)','');
      if(!why||!why.trim()||b.disabled)return;b.disabled=true;
      supa.rpc('crm_price_study_drop',{p_conversation_id:id,p_reason:why.trim()}).then(r=>{
        if(r.error){b.disabled=false;toast('ما انحفظ: '+(r.error.message||''),'error');return;}
        paused.items=paused.items.filter(i=>i.conversation_id!==id);toast('انشال من التسعير','success');drawSheet();if(last)drawTiles(last.data,last.pending);
      });
    }
    else if(act==='ptoggle-ignored'){ignoredOpen=!ignoredOpen;if(ignoredOpen)loadIgnored();else drawSheet();}
    else if(act==='pignore'||act==='punignore'){
      const id=b.dataset.id,on=act==='pignore';if(b.disabled)return;b.disabled=true;
      supa.rpc('crm_set_chat_ignored',{p_conversation:id,p_ignored:on}).then(r=>{
        if(r.error)throw r.error;
        if(on){paused.items=paused.items.filter(i=>i.conversation_id!==id);paused.total=paused.items.length;paused.ignored=Number(paused.ignored||0)+1;if(ignoredOpen)ignoredList=null;}
        else{ignoredList=(ignoredList||[]).filter(i=>i.conversation_id!==id);paused.ignored=Math.max(0,Number(paused.ignored||0)-1);}
        if(last)drawTiles(last.data,last.pending);drawSheet();if(on&&ignoredOpen)loadIgnored();
        toast(on?'انتقل للمتجاهلين، وما بيوصله رد ولا متابعة':'رجع للعقل، ويرد عليه أول ما يكتب','success');
      }).catch(()=>{b.disabled=false;toast('ما انحفظ. جرب مرة ثانية','error');});
    }
    else if(act==='popen'&&typeof navigate==='function'&&typeof openWhatsAppConversation==='function'){const id=b.dataset.id;closeSheet();navigate('whatsapp',null);setTimeout(()=>openWhatsAppConversation(id),300);}
    else if(act==='pnote'&&typeof window.crmClaudeNote==='function'){
      const it=paused.items.find(i=>i.conversation_id===b.dataset.id)||{};
      window.crmClaudeNote({conversation_id:b.dataset.id,label:'على محادثة '+(b.dataset.name||'العميل'),context:{source:'paused_chat',reason:it.reason||null,last_message:it.last_message||null,summary:it.summary||null}});
    }
    else if(act==='presume'&&typeof waInboxInvoke==='function'){
      // 11 Nov (Ahmed): the agent reads the whole chat and carries on now when the customer's last message is unanswered;
      // if it still cannot, the chat comes back here with its reason.
      b.disabled=true;const id=b.dataset.id;b.textContent='العقل يقرأ المحادثة…';
      waInboxInvoke({action:'clear_handoff',conversation_id:id,resume:true}).then(res=>{
        const a=(res&&res.agent)||{},reason=String(a.handoff_reason||'');
        paused.items=paused.items.filter(i=>i.conversation_id!==id);
        let msg='رجّعتها للعقل، ويرد أول ما يكتب العميل',kind='success';
        if(res&&res.resume==='agent_ran'){
          if(a.action==='handoff'){msg='العقل ما قدر يكمل: '+(reason||'يحتاجك');kind='error';
            paused.items.unshift({conversation_id:id,name:b.closest('.coh-row')?.querySelector('strong')?.childNodes[0]?.textContent?.trim()||'عميل',kind:'handoff',reason:reason||'العقل ما عرف يكمل',last_message:null,summary:null});}
          else if(a.sent>0)msg='العقل قرأ المحادثة ورد على العميل';
          else if(a.status==='awaiting_approval')msg='العقل كتب رد ينتظر موافقتك في «ردود تنتظر موافقتك»';
          else if(a.ignored==='outside_24h_to_followups')msg='آخر رسالة من العميل أقدم من 24 ساعة، فالرد راح لـ«متابعة اليوم»';
          else if(a.ignored)msg='رجعت للعقل ('+a.ignored+')';
        }else if(res&&res.resume==='agent_pending')msg='رجعت للعقل، والرد في الطريق';
        // 19 Nov 2026: the client's last message is older than 24 hours, so the agent is not run on it (whatsapp-inbox «too_old»)
        else if(res&&res.resume==='too_old')msg='رجعت للعقل. آخر رسالة من العميل '+(typeof timeAgo==='function'&&res.last_inbound_at?'قبل '+timeAgo(res.last_inbound_at):'أقدم من يوم')+'، فالعقل ما يرد عليها، ويرد أول ما يكتب العميل';
        paused.total=paused.items.length;if(last)drawTiles(last.data,last.pending);drawSheet();toast(msg,kind);
        if(kind==='error'&&typeof window.crmOwnerHomeRefresh==='function')setTimeout(window.crmOwnerHomeRefresh,1500);
      }).catch(()=>{b.disabled=false;b.textContent='كمّل يا عقل';toast('ما انحفظ. جرب مرة ثانية','error');});
    }
    else if(act==='auto-done'){
      b.disabled=true;const id=b.dataset.id;
      supa.from('notifications').update({is_read:true}).eq('id',id).then(r=>{if(r.error)throw r.error;autoNotes=autoNotes.filter(n=>n.id!==id);drawAuto();})
        .catch(()=>{b.disabled=false;toast('ما انحفظ. جرب مرة ثانية','error');});
    }
    else if(act==='twin-yes'||act==='twin-no'){
      b.disabled=true;
      const call=act==='twin-yes'?supa.rpc('crm_link_twin_group',{p_properties:b.dataset.key.split(',')}):supa.rpc('crm_dismiss_twin_group',{p_key:b.dataset.key});
      call.then(r=>{if(r.error)throw r.error;toast(act==='twin-yes'?'انربطت الفيديوهات على الكل':'تمام ما راح أسأل عنهم مرة ثانية','success');forceTwins=true;return window.crmOwnerHomeRefresh();}).catch(()=>{b.disabled=false;toast('ما انحفظ. جرب مرة ثانية','error');});
    }
    else if(act==='nav'&&typeof navigate==='function'){
      const nav=b.dataset.nav;closeSheet();navigate(nav,{replies:byId('navReplies'),'owner-leads':byId('navOwnerLeads')}[nav]||null);
      // The tile counts new offers of the last 7 days; the page opens on that same list (10 Nov 2026).
      if(nav==='owner-leads'&&b.classList.contains('coh-tile')&&typeof window.crmOwnerLeadsShowWeek==='function')window.crmOwnerLeadsShowWeek();
    }
  });
  window.crmOwnerHomeRefresh=()=>load().catch(()=>{});
  // 19 Nov 2026: the old dashboard's reads (crm-operations-v6.js work list and target card, crm-quick-visit.js card) ask
  // this before reading; with this file missing they read as before, so the old page still works as the fallback
  window.crmHomeActive=()=>hasHome();
  const loadDash=window.loadDashboard;
  if(typeof loadDash==='function')window.loadDashboard=function(){const r=loadDash.apply(this,arguments);window.crmOwnerHomeRefresh();return r;};
  /* 14 Nov 2026: the app starts (init() in the base page) while these files are still arriving. With an empty cache
   * (first visit after a publication) the account, applyRoleVisibility and the first loadDashboard could all finish
   * before this file was there to wrap them: no gate, no load, and the old dashboard stayed for the whole visit.
   * index.html now writes the page with .coh-boot already on <html> (the old dashboard is never painted first), this
   * file arms the gate itself when the app is already open, and the last script of index.html calls loadDashboard once
   * more in that case, so every module that wraps it gets its first run. An account with no home role gives the class
   * back at once. */
  const appOpen=()=>{const a=byId('appScreen');return !!(a&&a.classList.contains('visible'));};
  if(appOpen()){markHome();if(hasHome())armGate();else releaseGate();}
})();
