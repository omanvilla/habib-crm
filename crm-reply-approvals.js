/* Owner approval of WhatsApp reply drafts (2 November 2026).
 * Page "ردود تنتظر موافقتك": each draft shows the customer, the number they wrote to, the
 * category, a short summary, their last messages and the proposed reply (editable). Approve
 * sends through the whatsapp-reply-send Edge Function; reject and pin use owner-only RPCs.
 * Tab "الردود المثبتة" lists pinned replies to edit, pause or delete, and the per-category
 * auto-send switches (off by default). Drafts that reuse a pinned reply are marked, and investor
 * drafts carry alternative wordings to pick from. Each pinned reply can have wordings B and C;
 * tab "النتائج" compares A/B/C on replies, viewing requests, visits, calls and deals.
 * Visit follow-ups (SQL54) wait at the top of the pending tab; approve sends the fixed text.
 * A browser notification fires when new drafts arrive while the CRM is open. Owner only. */
(function(){
  'use strict';
  const esc=v=>typeof escapeHtml==='function'?escapeHtml(String(v==null?'':v)):String(v==null?'':v).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
  const byId=id=>document.getElementById(id);
  const toast=(m,t)=>{if(typeof showToast==='function')showToast(m,t);};
  const isOwnerNow=()=>typeof currentProfile!=='undefined'&&currentProfile&&currentProfile.role==='owner';
  const ROUTES={barka:'بركاء',muscat:'مسقط'};
  const CATS={buyer:'مشتري',tenant:'مستأجر',investor:'مستثمر',seller:'مالك',broker:'وسيط',active_deal:'صفقة شغالة',general:'عام',unclear:'غير واضح'};
  const ACTIONS={handoff:'يحوّل لك بعد الإرسال',send_location:'يرسل اللوكيشن بعد الرد',send_lockbox:'يرسل اللوكيشن وصورة صندوق المفتاح',send_owner_number:'يرسل رقم المالك',book_viewing:'يسجل زيارة'};
  const ERRORS={outside_24h:'مرّت 24 ساعة على آخر رسالة من العميل. الرد العادي ما يوصل؛ يحتاج قالب معتمد.',draft_not_pending:'هذا الرد تغيّر: إما انرسل أو انلغى لأن العميل أو موظف كتب بعده.',
    owner_only:'الموافقة لصاحب الشركة فقط.',company_number:'هذا رقم من أرقام الشركة.',dry_run_draft:'هذا رد تجريبي للمراجعة فقط ولا ينرسل.',meta_send_failed:'واتساب رفض الإرسال. حاول مرة ثانية أو أرسل من المحادثة.',
    template_pending:'قالب هذي المتابعة لين الحين ما وافقت عليه واتساب. بتقدر ترسلها أول ما يتوافق عليه.',followup_not_found:'المتابعة ما عادت موجودة.',followup_not_pending:'هذي المتابعة ما عادت تنتظر.'};
  const errText=e=>{const raw=String(e&&(e.error||e.message)||e||'');for(const k of Object.keys(ERRORS))if(raw.includes(k))return ERRORS[k];return 'تعذر: '+raw;};
  const ago=d=>typeof timeAgo==='function'?timeAgo(d):String(d||'').slice(0,16);
  let state={tab:'pending',showTrials:false,drafts:[],followups:[],rules:[],autoSend:null,variants:null,results:[],days:90,lastCount:null,loading:false};

  // ---- page and menu ---------------------------------------------------------
  function ensurePage(){
    if(byId('page-replies'))return;
    const content=document.querySelector('.content');if(!content)return;
    const page=document.createElement('div');page.className='page';page.id='page-replies';
    page.innerHTML='<div class="page-header"><div><div class="page-title"><span>ردود تنتظر موافقتك</span></div><div class="page-sub" id="rpSub">جاري التحميل…</div></div></div>'
      +'<div class="rp-tabs"><button type="button" class="rp-tab on" data-rp-tab="pending">تنتظر موافقتك <b id="rpCount">0</b></button><button type="button" class="rp-tab" data-rp-tab="rules">الردود المثبتة</button><button type="button" class="rp-tab" data-rp-tab="results">النتائج</button>'
      +'<label class="rp-trials"><input type="checkbox" id="rpTrials"> عرض ردود التجربة</label></div><div id="rpList"></div>';
    content.append(page);
    const nav=document.querySelector('#sidebar .nav-area');
    if(nav&&!byId('navReplies')){
      const link=document.createElement('div');link.className='nav-link';link.id='navReplies';link.setAttribute('onclick',"navigate('replies',this)");
      link.innerHTML='<div class="nav-icon">✉</div><span class="nav-text">ردود تنتظر موافقتك</span><span class="nav-badge" id="navRepliesCount" style="display:none">0</span>';
      // Links live inside .nav-group blocks; place it right after the dashboard link.
      const first=nav.querySelector('.nav-link');
      if(first&&first.parentNode)first.parentNode.insertBefore(link,first.nextSibling);else nav.append(link);
      syncVisibility();
    }
  }
  function syncVisibility(){const l=byId('navReplies');if(l)l.style.display=isOwnerNow()?'':'none';}

  // ---- data -------------------------------------------------------------------
  async function loadDrafts(){
    const q=supa.from('whatsapp_reply_drafts').select('id,conversation_id,client_id,message_id,status,analysis,reply_messages,created_at').eq('status','pending').order('created_at',{ascending:false}).limit(40);
    const r=await q;if(r.error)throw r.error;
    let rows=(r.data||[]).filter(d=>state.showTrials||!(d.analysis&&d.analysis.dry_run===true));
    const convIds=[...new Set(rows.map(d=>d.conversation_id))],clientIds=[...new Set(rows.map(d=>d.client_id).filter(Boolean))];
    const [convs,clients,msgs]=await Promise.all([
      convIds.length?supa.from('whatsapp_conversations').select('id,route_key,customer_name').in('id',convIds):{data:[]},
      clientIds.length?supa.from('clients').select('id,name,phone').in('id',clientIds):{data:[]},
      convIds.length?supa.from('whatsapp_messages').select('conversation_id,direction,actor_type,message_type,body,transcript,message_timestamp').in('conversation_id',convIds).order('message_timestamp',{ascending:false}).limit(40*8):{data:[]}
    ]);
    const cMap=new Map((convs.data||[]).map(x=>[x.id,x])),clMap=new Map((clients.data||[]).map(x=>[x.id,x]));
    rows.forEach(d=>{
      d.conv=cMap.get(d.conversation_id)||{};d.client=clMap.get(d.client_id)||{};
      const own=(msgs.data||[]).filter(m=>m.conversation_id===d.conversation_id);
      d.lastMessages=own.slice(0,5).reverse();
      const lastIn=own.find(m=>m.direction==='inbound');d.lastInboundAt=lastIn&&lastIn.message_timestamp;
    });
    state.drafts=rows;
    await loadFollowups();
  }
  // visit follow-ups (SQL54) waiting for approval; missing table (before SQL54) just shows none
  async function loadFollowups(){
    const f=await supa.from('whatsapp_visit_followups').select('id,client_id,conversation_id,viewing_id,route_key,step,body,created_at').eq('status','awaiting_approval').order('created_at',{ascending:true}).limit(40);
    const rows=f.error?[]:(f.data||[]);
    const cIds=[...new Set(rows.map(x=>x.client_id))],vIds=[...new Set(rows.map(x=>x.viewing_id))];
    const [cl,vw]=await Promise.all([
      cIds.length?supa.from('clients').select('id,name,phone').in('id',cIds):{data:[]},
      vIds.length?supa.from('viewings').select('id,viewing_date,property_id,properties(area,type)').in('id',vIds):{data:[]}
    ]);
    const cm=new Map((cl.data||[]).map(x=>[x.id,x])),vm=new Map((vw.data||[]).map(x=>[x.id,x]));
    rows.forEach(x=>{x.client=cm.get(x.client_id)||{};x.viewing=vm.get(x.viewing_id)||{};});
    state.followups=rows;
  }
  async function loadRules(){
    const r=await supa.from('whatsapp_reply_rules').select('id,situation,approved_reply,category,intent,active,created_at,updated_at').order('created_at',{ascending:false});
    if(r.error)throw r.error;state.rules=r.data||[];
    const [s,v]=await Promise.all([supa.rpc('crm_reply_auto_send_get'),supa.from('whatsapp_reply_variants').select('rule_id,label,reply,active')]);
    state.autoSend=s.error?null:((s.data&&s.data.categories)||[]);
    state.variants=v.error?null:(v.data||[]);
  }
  async function loadResults(){
    const r=await supa.rpc('crm_reply_variant_stats',{p_days:state.days});
    if(r.error)throw r.error;state.results=(r.data&&r.data.rows)||[];
  }
  async function countPending(){
    const r=await supa.from('whatsapp_reply_drafts').select('id,analysis',{count:'exact'}).eq('status','pending').limit(200);
    if(r.error)return null;
    const f=await supa.from('whatsapp_visit_followups').select('id',{count:'exact',head:true}).eq('status','awaiting_approval');
    return (r.data||[]).filter(d=>!(d.analysis&&d.analysis.dry_run===true)).length+(f.error?0:(f.count||0));
  }

  // ---- render ------------------------------------------------------------------
  const within24=d=>d.lastInboundAt&&(Date.now()-new Date(d.lastInboundAt).getTime())<24*3600*1000;
  function msgLine(m){
    const who=m.direction==='inbound'?'العميل':(m.actor_type==='human'?'المكتب':'رد سابق');
    const text=m.transcript?'🎤 '+m.transcript:(m.body||'['+m.message_type+']');
    return '<li class="'+(m.direction==='inbound'?'in':'out')+'"><b>'+who+':</b> <span dir="auto">'+esc(String(text).slice(0,300))+'</span></li>';
  }
  function draftCard(d){
    const a=d.analysis||{},trial=a.dry_run===true,ok24=within24(d);
    const name=d.client.name||d.conv.customer_name||'عميل',phone=d.client.phone||'';
    return '<article class="rp-card" data-draft="'+esc(d.id)+'">'
      +'<header><div><strong><bdi>'+esc(name)+'</bdi></strong>'+(phone?' <small dir="ltr">'+esc(phone)+'</small>':'')+'</div>'
      +'<div class="rp-chips"><span class="rp-chip route">'+esc(ROUTES[d.conv.route_key]||d.conv.route_key||'')+'</span>'+(a.category?'<span class="rp-chip">'+esc(CATS[a.category]||a.category)+'</span>':'')
      +(a.matched_rule_id?'<span class="rp-chip pinned">مطابق لرد مثبت</span>':'')
      +(trial?'<span class="rp-chip trial">تجربة</span>':'')+'<span class="rp-time">'+esc(ago(d.created_at))+'</span></div></header>'
      +(a.crm_note?'<p class="rp-summary">'+esc(a.crm_note)+'</p>':'')
      +'<ul class="rp-msgs">'+d.lastMessages.map(msgLine).join('')+'</ul>'
      +'<div class="rp-reply"><label>الرد المقترح</label>'+altChoices(a)
      +'<div class="rp-lines">'+(d.reply_messages||[]).map(lineHtml).join('')+'</div>'
      +((d.reply_messages||[]).length?'':'<p class="rp-muted">المحرك يقترح عدم الرد.</p>')
      +'<button type="button" class="rp-add" data-rp="add-line">+ سطر</button>'
      +(ACTIONS[a.action]?'<p class="rp-action">'+esc(ACTIONS[a.action])+'</p>':'')+'</div>'
      +'<label class="rp-pin"><input type="checkbox" class="rp-pin-on"> ثبّت هذا الرد للمواقف المشابهة</label>'
      +'<input class="fi rp-pin-situation" hidden placeholder="وصف الموقف" value="'+esc([CATS[a.category]||'',a.intent||''].filter(Boolean).join(': '))+'">'
      +(!ok24&&!trial?'<p class="rp-warn">مرّت 24 ساعة على آخر رسالة من العميل؛ الرد العادي ما يوصل.</p>':'')
      +'<div class="rp-actions"><button type="button" class="btn-primary" data-rp="send"'+(trial||!ok24?' disabled':'')+'>موافقة وإرسال</button>'
      +'<button type="button" class="btn-secondary" data-rp="reject">رفض</button>'
      +'<button type="button" class="btn-secondary" data-rp="open">فتح المحادثة</button></div>'
      +'<div class="rp-error" role="alert"></div></article>';
  }
  const FU_WHEN={1:'بعد الزيارة بيوم',2:'بعد 3 أيام',3:'بعد أسبوع',4:'بعد شهر'};
  function followupCard(f){
    const name=f.client.name||'عميل',phone=f.client.phone||'',v=f.viewing||{},p=v.properties||{};
    return '<article class="rp-card rp-fu" data-fu="'+esc(f.id)+'">'
      +'<header><div><strong><bdi>'+esc(name)+'</bdi></strong>'+(phone?' <small dir="ltr">'+esc(phone)+'</small>':'')+'</div>'
      +'<div class="rp-chips"><span class="rp-chip route">'+esc(ROUTES[f.route_key]||f.route_key)+'</span><span class="rp-chip">متابعة '+esc(f.step)+' من 4 · '+esc(FU_WHEN[f.step]||'')+'</span></div></header>'
      +'<p class="rp-summary">زار '+esc(p.area||'العقار')+(v.viewing_date?' يوم '+esc(v.viewing_date):'')+'</p>'
      +'<div class="rp-reply"><label>الرسالة</label><p class="rp-fu-body" dir="auto">'+esc(f.body)+'</p>'
      +'<p class="rp-muted">نص ثابت معتمد من واتساب، ما ينعدّل. إذا العميل كتب قبل ما توافق تنلغي تلقائياً.</p></div>'
      +'<div class="rp-actions"><button type="button" class="btn-primary" data-rp="fu-send">موافقة وإرسال</button>'
      +'<button type="button" class="btn-secondary" data-rp="fu-skip">تخطي</button>'
      +'<button type="button" class="btn-secondary" data-rp="fu-open">فتح المحادثة</button></div>'
      +'<div class="rp-error" role="alert"></div></article>';
  }
  // investors get the proposed reply plus up to two other wordings to pick from
  function altChoices(a){
    const alts=Array.isArray(a.alternatives)?a.alternatives.filter(x=>Array.isArray(x)&&x.length):[];
    if(!alts.length)return '';
    return '<div class="rp-alts" role="group" aria-label="صيغ الرد"><button type="button" class="rp-alt on" data-rp="alt" data-alt="-1">المقترح</button>'
      +alts.map((_,i)=>'<button type="button" class="rp-alt" data-rp="alt" data-alt="'+i+'">بديل '+(i+1)+'</button>').join('')+'</div>';
  }
  function autoSendBox(){
    if(!state.autoSend)return '';
    const on=new Set(state.autoSend);
    return '<section class="rp-card rp-auto"><strong>الإرسال التلقائي</strong>'
      +'<p class="rp-muted">إذا شغّلت فئة، المحرك يرسل بدون موافقتك بس لما يكون رده مطابق لرد مثبت. غير كذا كل الردود تنتظرك.</p>'
      +'<div class="rp-auto-list">'+Object.keys(CATS).map(k=>'<label class="rp-pin"><input type="checkbox" class="rp-auto-cat" value="'+k+'"'+(on.has(k)?' checked':'')+'> '+esc(CATS[k])+'</label>').join('')+'</div>'
      +'<div class="rp-error" role="alert"></div></section>';
  }
  function ruleCard(r){
    return '<article class="rp-card rp-rule" data-rule="'+esc(r.id)+'">'
      +'<label>الموقف</label><input class="fi rp-rule-situation" value="'+esc(r.situation)+'">'
      +'<label>الرد المثبت</label><textarea class="fta rp-rule-reply" rows="3" dir="auto">'+esc(r.approved_reply)+'</textarea>'
      +variantFields(r)
      +'<div class="rp-actions"><label class="rp-pin"><input type="checkbox" class="rp-rule-active"'+(r.active?' checked':'')+'> شغّال</label>'
      +'<button type="button" class="btn-primary" data-rp="rule-save">حفظ</button><button type="button" class="btn-secondary" data-rp="rule-delete">حذف</button></div>'
      +'<div class="rp-error" role="alert"></div></article>';
  }
  // wordings B and C of a pinned reply; the agent rotates between A, B and C and the results tab compares them
  function variantFields(r){
    if(!state.variants)return '';
    return ['B','C'].map(l=>{
      const v=state.variants.find(x=>x.rule_id===r.id&&x.label===l)||{};
      return '<div class="rp-variant"><label>نسخة '+l+' <small class="rp-muted">(اختياري)</small></label>'
        +'<textarea class="fta rp-variant-reply" data-label="'+l+'" rows="2" dir="auto" placeholder="صياغة ثانية لنفس الرد">'+esc(v.reply||'')+'</textarea>'
        +(v.reply?'<label class="rp-pin"><input type="checkbox" class="rp-variant-active" data-label="'+l+'"'+(v.active!==false?' checked':'')+'> تشتغل</label>':'')+'</div>';
    }).join('');
  }
  const pct=(n,d)=>d?Math.round(n*100/d)+'%':'–';
  const MIN_SAMPLE=20;
  function resultsHtml(){
    const rows=state.results||[];
    const byRule=[];rows.forEach(x=>{let g=byRule.find(y=>y.id===x.rule_id);if(!g){g={id:x.rule_id,situation:x.situation,active:x.active,rows:[]};byRule.push(g);}g.rows.push(x);});
    const head='<div class="rp-days" role="group" aria-label="الفترة">'+[30,90,365].map(d=>'<button type="button" class="rp-alt'+(state.days===d?' on':'')+'" data-rp-days="'+d+'">'+(d===365?'سنة':d+' يوم')+'</button>').join('')+'</div>'
      +'<p class="rp-muted">كل رد انرسل يُتابع: رد العميل خلال 24 ساعة، طلب معاينة خلال 14 يوم (زيارة مسجلة أو طلب موقع/معاينة)، زيارة تمت خلال 30 يوم، مكالمة خلال 14 يوم (من ملاحظات الموظفين أو طلب العميل؛ ما عندنا سجل مكالمات)، وصفقة خلال 60 يوم. لا تحكم على نسخة قبل '+MIN_SAMPLE+' إرسال. ✎ = عدد المرات اللي عدّلت فيها الرد قبل الإرسال.</p>';
    if(!byRule.length)return head+'<div class="empty"><div class="empty-ico">📊</div><div class="empty-title">ما في نتائج لين الحين</div><div class="empty-desc">النتائج تبدأ لما ينرسل رد مطابق لرد مثبت.</div></div>';
    return head+byRule.map(g=>{
      const ready=g.rows.filter(x=>x.sent>=MIN_SAMPLE);
      const best=ready.length>1?ready.reduce((a,b)=>(b.replied/b.sent)>(a.replied/a.sent)?b:a):null;
      const worst=ready.length>1?ready.reduce((a,b)=>(b.replied/b.sent)<(a.replied/a.sent)?b:a):null;
      return '<section class="rp-card rp-result"><strong>'+esc(g.situation)+'</strong>'+(g.active?'':' <span class="rp-chip trial">موقوف</span>')
        +'<div class="rp-table-wrap"><table class="rp-table"><thead><tr><th>نسخة</th><th>انرسل</th><th>ردّ</th><th>معاينة</th><th>زيارة</th><th>اتصال</th><th>صفقة</th></tr></thead><tbody>'
        +g.rows.map(x=>'<tr class="'+(best&&x===best?'best':'')+(worst&&x===worst&&worst!==best?' worst':'')+'"><th scope="row" title="'+esc(x.reply||'')+'">'+esc(x.label)+(x.variant_active?'':' ⏸')+'</th>'
          +'<td>'+x.sent+(x.edited?'<small class="rp-edited" title="عدّلته قبل الإرسال">✎'+x.edited+'</small>':'')+'</td>'
          +'<td>'+pct(x.replied,x.sent)+'</td><td>'+x.viewing_requests+'</td><td>'+x.visits+'</td><td>'+x.calls+'</td><td>'+x.deals+'</td></tr>').join('')
        +'</tbody></table></div>'
        +(worst&&worst!==best?'<p class="rp-warn">النسخة '+esc(worst.label)+' أقل تفاعل؛ عدّلها أو أوقفها من «الردود المثبتة».</p>':'')
        +(ready.length<g.rows.length?'<p class="rp-muted">بعض النسخ ما وصلت '+MIN_SAMPLE+' إرسال، النتيجة مبدئية.</p>':'')
        +'</section>';
    }).join('');
  }
  function render(){
    const list=byId('rpList');if(!list)return;
    document.querySelectorAll('.rp-tab').forEach(b=>b.classList.toggle('on',b.dataset.rpTab===state.tab));
    const trials=byId('rpTrials');if(trials)trials.closest('label').hidden=state.tab!=='pending';
    if(state.tab==='rules'){
      byId('rpSub').textContent=state.rules.length+' رد مثبت';
      list.innerHTML=autoSendBox()+(state.rules.length?state.rules.map(ruleCard).join(''):'<div class="empty"><div class="empty-ico">📌</div><div class="empty-title">ما في ردود مثبتة لين الحين</div><div class="empty-desc">لما توافق على رد وتختار «ثبّت هذا الرد» يظهر هنا، والمحرك يستخدمه في المواقف المشابهة.</div></div>');
      return;
    }
    if(state.tab==='results'){
      byId('rpSub').textContent='أي صياغة تجيب نتيجة أكثر';
      list.innerHTML=resultsHtml();
      return;
    }
    const real=state.drafts.filter(d=>!(d.analysis&&d.analysis.dry_run)).length,fus=state.followups||[];
    byId('rpSub').textContent=real+' رد ينتظر موافقتك'+(fus.length?' · '+fus.length+' متابعة زيارة':'')+(state.showTrials?' · مع ردود التجربة':'');
    list.innerHTML=(fus.length?'<h3 class="rp-section">متابعات بعد الزيارة</h3>'+fus.map(followupCard).join(''):'')
      +(fus.length&&state.drafts.length?'<h3 class="rp-section">ردود على رسائل العملاء</h3>':'')
      +(state.drafts.length||fus.length?state.drafts.map(draftCard).join(''):'<div class="empty"><div class="empty-ico">✉</div><div class="empty-title">ما في ردود تنتظرك</div><div class="empty-desc">أول ما يكتب المحرك رد جديد يظهر هنا ويوصلك تنبيه.</div></div>';
  }
  async function refresh(){
    if(!isOwnerNow()||state.loading)return;state.loading=true;
    try{if(state.tab==='rules')await loadRules();else if(state.tab==='results')await loadResults();else await loadDrafts();render();}
    catch(e){const l=byId('rpList');if(l)l.innerHTML='<div class="empty"><div class="empty-title">تعذر التحميل</div><div class="empty-desc">'+esc(e.message||e)+'</div></div>';}
    finally{state.loading=false;}
  }

  // one editable reply line with its own delete button
  function lineHtml(t){return '<div class="rp-line"><textarea class="fta rp-text" rows="2" dir="auto">'+esc(t)+'</textarea><button type="button" class="rp-del" data-rp="del-line" title="حذف السطر" aria-label="حذف السطر">✕</button></div>';}

  // ---- actions -----------------------------------------------------------------
  async function followupAct(card,btn,doSend){
    const id=card.dataset.fu,err=card.querySelector('.rp-error');err.textContent='';btn.disabled=true;
    let e=null;
    if(doSend){const r=await supa.functions.invoke('whatsapp-reply-send',{body:{followup_id:id}});e=r.error||(r.data&&r.data.ok===false?r.data:null);
      if(e&&r.error&&r.error.context&&typeof r.error.context.json==='function'){try{e=await r.error.context.json();}catch(_){}}}
    else{const r=await supa.rpc('crm_visit_followup_reject',{p_id:id});e=r.error;}
    btn.disabled=false;
    if(e){err.textContent=errText(e);return;}
    toast(doSend?'انرسلت المتابعة':'تم التخطي','success');refresh();updateBadge();
  }
  async function send(card,btn){
    const id=card.dataset.draft,err=card.querySelector('.rp-error');err.textContent='';
    const messages=[...card.querySelectorAll('.rp-text')].map(t=>t.value.trim()).filter(Boolean);
    if(!messages.length){err.textContent='اكتب الرد أولاً';return;}
    const pin=card.querySelector('.rp-pin-on').checked,situation=card.querySelector('.rp-pin-situation').value.trim();
    if(pin&&situation.length<3){err.textContent='اكتب وصف الموقف للرد المثبت';return;}
    btn.disabled=true;btn.textContent='جاري الإرسال…';
    try{
      const r=await supa.functions.invoke('whatsapp-reply-send',{body:{draft_id:id,messages}});
      const data=r.data||{};if(r.error||data.ok!==true){let detail=data;try{if(r.error&&r.error.context)detail=await r.error.context.json();}catch(_){}throw detail&&detail.error?detail:(r.error||data);}
      if(pin){const d=state.drafts.find(x=>x.id===id)||{},a=d.analysis||{};
        const p=await supa.rpc('crm_reply_rule_save',{p_rule_id:null,p_situation:situation,p_reply:messages.join('\n'),p_category:a.category||null,p_intent:a.intent||null,p_property_id:a.property_id||null,p_source_draft_id:id,p_active:true});
        if(p.error)toast('انرسل الرد لكن ما انحفظ كرد مثبت: '+p.error.message,'error');}
      toast('انرسل الرد'+(pin?' وانثبت':''),'success');refresh();updateBadge();
    }catch(e){err.textContent=errText(e);btn.disabled=false;btn.textContent='موافقة وإرسال';}
  }
  async function reject(card,btn){
    btn.disabled=true;const err=card.querySelector('.rp-error');
    const r=await supa.rpc('crm_reply_draft_reject',{p_draft_id:card.dataset.draft,p_note:null});
    if(r.error){err.textContent=errText(r.error);btn.disabled=false;return;}
    toast('انرفض الرد','success');refresh();updateBadge();
  }
  async function saveRule(card,btn,del){
    const err=card.querySelector('.rp-error');err.textContent='';btn.disabled=true;
    const id=card.dataset.rule,rule=state.rules.find(x=>x.id===id)||{};
    const r=del?await supa.rpc('crm_reply_rule_delete',{p_rule_id:id})
      :await supa.rpc('crm_reply_rule_save',{p_rule_id:id,p_situation:card.querySelector('.rp-rule-situation').value,p_reply:card.querySelector('.rp-rule-reply').value,
        p_category:rule.category||null,p_intent:rule.intent||null,p_property_id:null,p_source_draft_id:null,p_active:card.querySelector('.rp-rule-active').checked});
    if(r.error){btn.disabled=false;err.textContent=errText(r.error);return;}
    if(!del){
      // only wordings that changed are written (an emptied box removes that wording)
      for(const t of card.querySelectorAll('.rp-variant-reply')){
        const l=t.dataset.label,old=(state.variants||[]).find(x=>x.rule_id===id&&x.label===l)||{};
        const act=card.querySelector('.rp-variant-active[data-label="'+l+'"]'),active=act?act.checked:true;
        if(t.value.trim()===(old.reply||'')&&active===(old.active!==false))continue;
        const v=await supa.rpc('crm_reply_variant_save',{p_rule_id:id,p_label:l,p_reply:t.value,p_active:active});
        if(v.error){btn.disabled=false;err.textContent=errText(v.error);return;}
      }
    }
    btn.disabled=false;
    toast(del?'انحذف الرد المثبت':'انحفظ','success');refresh();
  }
  async function saveAutoSend(input){
    const box=input.closest('.rp-auto'),err=box.querySelector('.rp-error');err.textContent='';
    if(input.checked&&!confirm('المحرك بيرسل لفئة «'+(CATS[input.value]||input.value)+'» بدون موافقتك إذا رده مطابق لرد مثبت. متأكد؟')){input.checked=false;return;}
    const cats=[...box.querySelectorAll('.rp-auto-cat:checked')].map(x=>x.value);
    box.querySelectorAll('.rp-auto-cat').forEach(x=>x.disabled=true);
    const r=await supa.rpc('crm_reply_auto_send_set',{p_categories:cats});
    box.querySelectorAll('.rp-auto-cat').forEach(x=>x.disabled=false);
    if(r.error){input.checked=!input.checked;err.textContent=errText(r.error);return;}
    state.autoSend=(r.data&&r.data.categories)||cats;toast('انحفظ','success');
  }
  document.addEventListener('click',e=>{
    const tab=e.target.closest('[data-rp-tab]');if(tab){state.tab=tab.dataset.rpTab;refresh();return;}
    const days=e.target.closest('[data-rp-days]');if(days){state.days=Number(days.dataset.rpDays);refresh();return;}
    const b=e.target.closest('[data-rp]');if(!b)return;const card=b.closest('.rp-card');if(!card)return;
    const a=b.dataset.rp;
    if(a==='send')send(card,b);
    else if(a==='reject'){if(confirm('ترفض هذا الرد؟'))reject(card,b);}
    else if(a==='fu-send')followupAct(card,b,true);
    else if(a==='fu-skip'){if(confirm('تتخطى هذي المتابعة؟ اللي بعدها تمشي على موعدها.'))followupAct(card,b,false);}
    else if(a==='fu-open'){const f=(state.followups||[]).find(x=>x.id===card.dataset.fu);if(f&&typeof openDashboardWhatsAppConversation==='function')openDashboardWhatsAppConversation(f.conversation_id);}
    else if(a==='open'){const d=state.drafts.find(x=>x.id===card.dataset.draft);if(d&&typeof openDashboardWhatsAppConversation==='function')openDashboardWhatsAppConversation(d.conversation_id);}
    else if(a==='add-line'){const box=card.querySelector('.rp-lines');box.insertAdjacentHTML('beforeend',lineHtml(''));box.lastElementChild.querySelector('textarea').focus();}
    else if(a==='alt'){
      const d=state.drafts.find(x=>x.id===card.dataset.draft);if(!d)return;
      const i=Number(b.dataset.alt),alts=(d.analysis&&d.analysis.alternatives)||[];
      const texts=i<0?(d.reply_messages||[]):(alts[i]||[]);
      card.querySelector('.rp-lines').innerHTML=texts.map(lineHtml).join('');
      card.querySelectorAll('.rp-alt').forEach(x=>x.classList.toggle('on',x===b));
    }
    else if(a==='del-line')b.closest('.rp-line').remove();
    else if(a==='rule-save')saveRule(card,b,false);
    else if(a==='rule-delete'){if(confirm('تحذف هذا الرد المثبت؟'))saveRule(card,b,true);}
  });
  document.addEventListener('change',e=>{
    if(e.target.id==='rpTrials'){state.showTrials=e.target.checked;refresh();}
    if(e.target.classList.contains('rp-auto-cat'))saveAutoSend(e.target);
    if(e.target.classList.contains('rp-pin-on')){const s=e.target.closest('.rp-card').querySelector('.rp-pin-situation');s.hidden=!e.target.checked;}
  });

  // ---- badge and browser notification ----------------------------------------------
  async function updateBadge(){
    if(!isOwnerNow())return;
    const n=await countPending();if(n==null)return;
    const b=byId('navRepliesCount'),c=byId('rpCount');
    if(b){b.textContent=n>99?'99+':String(n);b.style.display=n?'':'none';}
    if(c)c.textContent=String(n);
    if(state.lastCount!=null&&n>state.lastCount&&typeof sendBrowserNotif==='function')
      sendBrowserNotif('رد جديد ينتظر موافقتك',(n-state.lastCount)+' رد جديد من واتساب. افتح «ردود تنتظر موافقتك».');
    state.lastCount=n;
  }
  setInterval(()=>{if(!document.hidden)updateBadge();},60000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)updateBadge();});

  const nav=window.navigate;
  if(typeof nav==='function')window.navigate=function(id){
    if(id==='replies'&&!isOwnerNow()){if(typeof showPermissionDenied==='function')showPermissionDenied();return;}
    const r=nav.apply(this,arguments);
    if(id==='replies'){const t=byId('tbTitle');if(t)t.innerHTML='<em>ردود تنتظر موافقتك</em>';refresh();}
    return r;
  };
  const loadDash=window.loadDashboard;
  if(typeof loadDash==='function')window.loadDashboard=function(){const r=loadDash.apply(this,arguments);ensurePage();syncVisibility();updateBadge();return r;};
  ensurePage();
  window.crmReplyApprovalsRefresh=refresh;
})();
