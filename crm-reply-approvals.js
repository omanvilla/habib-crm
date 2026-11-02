/* Owner approval of WhatsApp reply drafts (2 November 2026).
 * Page "ردود تنتظر موافقتك": each draft shows the customer, the number they wrote to, the
 * category, a short summary, their last messages and the proposed reply (editable). Approve
 * sends through the whatsapp-reply-send Edge Function; reject and pin use owner-only RPCs.
 * Tab "الردود المثبتة" lists pinned replies to edit, pause or delete.
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
    owner_only:'الموافقة لصاحب الشركة فقط.',company_number:'هذا رقم من أرقام الشركة.',dry_run_draft:'هذا رد تجريبي للمراجعة فقط ولا ينرسل.',meta_send_failed:'واتساب رفض الإرسال. حاول مرة ثانية أو أرسل من المحادثة.'};
  const errText=e=>{const raw=String(e&&(e.error||e.message)||e||'');for(const k of Object.keys(ERRORS))if(raw.includes(k))return ERRORS[k];return 'تعذر: '+raw;};
  const ago=d=>typeof timeAgo==='function'?timeAgo(d):String(d||'').slice(0,16);
  let state={tab:'pending',showTrials:false,drafts:[],rules:[],lastCount:null,loading:false};

  // ---- page and menu ---------------------------------------------------------
  function ensurePage(){
    if(byId('page-replies'))return;
    const content=document.querySelector('.content');if(!content)return;
    const page=document.createElement('div');page.className='page';page.id='page-replies';
    page.innerHTML='<div class="page-header"><div><div class="page-title"><span>ردود تنتظر موافقتك</span></div><div class="page-sub" id="rpSub">جاري التحميل…</div></div></div>'
      +'<div class="rp-tabs"><button type="button" class="rp-tab on" data-rp-tab="pending">تنتظر موافقتك <b id="rpCount">0</b></button><button type="button" class="rp-tab" data-rp-tab="rules">الردود المثبتة</button>'
      +'<label class="rp-trials"><input type="checkbox" id="rpTrials"> عرض ردود التجربة</label></div><div id="rpList"></div>';
    content.append(page);
    const nav=document.querySelector('#sidebar .nav-area');
    if(nav&&!byId('navReplies')){
      const link=document.createElement('div');link.className='nav-link';link.id='navReplies';link.setAttribute('onclick',"navigate('replies',this)");
      link.innerHTML='<div class="nav-icon">✉</div><span class="nav-text">ردود تنتظر موافقتك</span><span class="nav-badge" id="navRepliesCount" style="display:none">0</span>';
      const first=nav.querySelector('.nav-link');nav.insertBefore(link,first?first.nextSibling:null);
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
  }
  async function loadRules(){
    const r=await supa.from('whatsapp_reply_rules').select('id,situation,approved_reply,category,intent,active,created_at,updated_at').order('created_at',{ascending:false});
    if(r.error)throw r.error;state.rules=r.data||[];
  }
  async function countPending(){
    const r=await supa.from('whatsapp_reply_drafts').select('id,analysis',{count:'exact'}).eq('status','pending').limit(200);
    if(r.error)return null;return (r.data||[]).filter(d=>!(d.analysis&&d.analysis.dry_run===true)).length;
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
      +(trial?'<span class="rp-chip trial">تجربة</span>':'')+'<span class="rp-time">'+esc(ago(d.created_at))+'</span></div></header>'
      +(a.crm_note?'<p class="rp-summary">'+esc(a.crm_note)+'</p>':'')
      +'<ul class="rp-msgs">'+d.lastMessages.map(msgLine).join('')+'</ul>'
      +'<div class="rp-reply"><label>الرد المقترح</label>'+(d.reply_messages||[]).map((t,i)=>'<textarea class="fta rp-text" rows="2" data-i="'+i+'" dir="auto">'+esc(t)+'</textarea>').join('')
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
  function ruleCard(r){
    return '<article class="rp-card rp-rule" data-rule="'+esc(r.id)+'">'
      +'<label>الموقف</label><input class="fi rp-rule-situation" value="'+esc(r.situation)+'">'
      +'<label>الرد المثبت</label><textarea class="fta rp-rule-reply" rows="3" dir="auto">'+esc(r.approved_reply)+'</textarea>'
      +'<div class="rp-actions"><label class="rp-pin"><input type="checkbox" class="rp-rule-active"'+(r.active?' checked':'')+'> شغّال</label>'
      +'<button type="button" class="btn-primary" data-rp="rule-save">حفظ</button><button type="button" class="btn-secondary" data-rp="rule-delete">حذف</button></div>'
      +'<div class="rp-error" role="alert"></div></article>';
  }
  function render(){
    const list=byId('rpList');if(!list)return;
    document.querySelectorAll('.rp-tab').forEach(b=>b.classList.toggle('on',b.dataset.rpTab===state.tab));
    const trials=byId('rpTrials');if(trials)trials.closest('label').hidden=state.tab!=='pending';
    if(state.tab==='rules'){
      byId('rpSub').textContent=state.rules.length+' رد مثبت';
      list.innerHTML=state.rules.length?state.rules.map(ruleCard).join(''):'<div class="empty"><div class="empty-ico">📌</div><div class="empty-title">ما في ردود مثبتة لين الحين</div><div class="empty-desc">لما توافق على رد وتختار «ثبّت هذا الرد» يظهر هنا، والمحرك يستخدمه في المواقف المشابهة.</div></div>';
      return;
    }
    const real=state.drafts.filter(d=>!(d.analysis&&d.analysis.dry_run)).length;
    byId('rpSub').textContent=real+' رد ينتظر موافقتك'+(state.showTrials?' · مع ردود التجربة':'');
    list.innerHTML=state.drafts.length?state.drafts.map(draftCard).join(''):'<div class="empty"><div class="empty-ico">✉</div><div class="empty-title">ما في ردود تنتظرك</div><div class="empty-desc">أول ما يكتب المحرك رد جديد يظهر هنا ويوصلك تنبيه.</div></div>';
  }
  async function refresh(){
    if(!isOwnerNow()||state.loading)return;state.loading=true;
    try{if(state.tab==='rules')await loadRules();else await loadDrafts();render();}
    catch(e){const l=byId('rpList');if(l)l.innerHTML='<div class="empty"><div class="empty-title">تعذر التحميل</div><div class="empty-desc">'+esc(e.message||e)+'</div></div>';}
    finally{state.loading=false;}
  }

  // ---- actions -----------------------------------------------------------------
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
    btn.disabled=false;
    if(r.error){err.textContent=errText(r.error);return;}
    toast(del?'انحذف الرد المثبت':'انحفظ','success');refresh();
  }
  document.addEventListener('click',e=>{
    const tab=e.target.closest('[data-rp-tab]');if(tab){state.tab=tab.dataset.rpTab;refresh();return;}
    const b=e.target.closest('[data-rp]');if(!b)return;const card=b.closest('.rp-card');if(!card)return;
    const a=b.dataset.rp;
    if(a==='send')send(card,b);
    else if(a==='reject'){if(confirm('ترفض هذا الرد؟'))reject(card,b);}
    else if(a==='open'){const d=state.drafts.find(x=>x.id===card.dataset.draft);if(d&&typeof openDashboardWhatsAppConversation==='function')openDashboardWhatsAppConversation(d.conversation_id);}
    else if(a==='add-line'){const t=document.createElement('textarea');t.className='fta rp-text';t.rows=2;t.dir='auto';b.before(t);t.focus();}
    else if(a==='rule-save')saveRule(card,b,false);
    else if(a==='rule-delete'){if(confirm('تحذف هذا الرد المثبت؟'))saveRule(card,b,true);}
  });
  document.addEventListener('change',e=>{
    if(e.target.id==='rpTrials'){state.showTrials=e.target.checked;refresh();}
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
