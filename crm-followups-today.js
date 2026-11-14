/* Daily follow-ups (5 November 2026). The owner opens the CRM on the branch phone, taps a client, and WhatsApp opens
 * that chat with the prepared text. He sends it, which is free, and the reply agent carries on when the client answers.
 * A message he sends takes the client off the list by itself. Whatever is left goes out automatically at 10am the next day.
 * Owner and staff see every follow-up (both branches, SQL85, Ahmed 11 Nov); the owner's private line stays hidden.
 * «أمر للذكاء الاصطناعي» (owner only, SQL72): his instruction goes to whatsapp-visit-followup-auto, which reads the whole chat
 * again and rewrites the text, or removes the client with the reason kept. Nothing is sent; the new text waits here.
 * The instruction is saved in crm_owner_notes as a lesson for the next reviews. */
(function(){
  'use strict';
  const byId=id=>document.getElementById(id);
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
  const toast=(m,t)=>{if(typeof showToast==='function')showToast(m,t);};
  const LABEL={barka:'بركاء',muscat:'مسقط',investor:'مستثمر · رقم مسقط'};
  let data={items:[],auto_on:false},branch='all',seq=0,open=false;const openInstr=new Set(),drafts=new Map();
  const isOwner=()=>typeof currentProfile!=='undefined'&&currentProfile&&currentProfile.role==='owner';
  const ERR={followup_not_pending:'هذي المتابعة ما عادت في القائمة: انرسلت أو تغيرت',followup_not_found:'المتابعة ما عادت موجودة',owner_only:'ما عندك صلاحية الأوامر',
    instruction_required:'اكتب الأمر أولاً',rewrite_failed:'ما قدرت أعيد الكتابة الحين. جرب مرة ثانية',route_blocked:'هذي المتابعة مو على رقم بركاء أو مسقط'};
  const errText=e=>{const raw=String(e&&(e.error||e.message)||e||'');for(const k of Object.keys(ERR))if(raw.includes(k))return ERR[k];return 'ما انحفظ: '+raw;};
  const key=i=>i.source+':'+i.id;
  // 11 Nov 2026 (Ahmed, R28): staff (manager, agent) get «أمر للذكاء الاصطناعي» too; their instruction becomes a lesson like his
  const canInstruct=()=>typeof currentProfile!=='undefined'&&currentProfile&&['owner','manager','agent'].includes(currentProfile.role);
  const instrBox=i=>{
    if(!canInstruct())return '';
    const k=key(i),open=openInstr.has(k);
    return (i.owner_instruction?'<p class="cfu-instr-done">انكتبت حسب أمرك: <span dir="auto">'+esc(i.owner_instruction)+'</span></p>':'')
      +'<div class="cfu-instr"'+(open?'':' hidden')+' data-k="'+esc(k)+'"><label for="cfuI-'+esc(i.id)+'">أمر للذكاء الاصطناعي</label>'
      +'<textarea id="cfuI-'+esc(i.id)+'" class="fta cfu-instr-text" rows="2" dir="auto" placeholder="مثلاً: هذا زار وما عجبه الموقع اسأله عن المنطقة اللي يبغاها" data-k="'+esc(k)+'">'+esc(drafts.get(k)||'')+'</textarea>'
      +'<small class="cfu-auto">يقرأ المحادثة كاملة ويكتب الرسالة من جديد، أو يشيل العميل إذا قلت ما لها داعي. الأمر ينحفظ درس للمراجعات الجاية. ما ينرسل شي.</small>'
      +'<div class="cfu-actions"><button type="button" class="btn-primary" data-cfu="instr-run" data-k="'+esc(k)+'">اكتبها من جديد</button><button type="button" class="btn-secondary" data-cfu="instr-close" data-k="'+esc(k)+'">إلغاء</button></div>'
      +'<div class="cfu-err" role="alert"></div></div>';
  };
  try{branch=localStorage.getItem('crmFollowupsBranch')||'all';}catch{}
  const waLink=(phone,text)=>{const d=String(phone||'').replace(/\D/g,'');return d?'https://wa.me/'+d+'?text='+encodeURIComponent(text||''):'';};
  // Work numbers are on WhatsApp Business only, so the button asks for that app; other phones get the normal link.
  const businessLink=(phone,text)=>{
    const d=String(phone||'').replace(/\D/g,''),t=encodeURIComponent(text||''),ua=navigator.userAgent||'';if(!d)return '';
    if(/Android/i.test(ua))return 'intent://send?phone='+d+'&text='+t+'#Intent;scheme=whatsapp;package=com.whatsapp.w4b;S.browser_fallback_url='+encodeURIComponent(waLink(d,text))+';end';
    if(/iPhone|iPad|iPod/i.test(ua))return 'whatsapp-smb://send?phone='+d+'&text='+t;
    return waLink(d,text);
  };
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
    if(box.closest('#cohSheetBody'))return box;
    const home=byId('crmOwnerHome'),header=page.querySelector('.page-header');
    if(home&&!home.hidden){if(box.parentNode!==home||home.firstChild!==box)home.prepend(box);}
    else if(header&&box.previousElementSibling!==header)header.after(box);
    return box;
  }
  // 12 Nov 2026: past the 24 hours the system can only send the Meta template, so show what really reaches the client
  function sendsLine(i){
    if(!('sends_text' in i))return '';
    if(i.sends_text==null)return '<small class="cfu-auto">ما تنرسل من النظام بعد 24 ساعة: رد عليه من المحادثة بنفسك</small>';
    const a=String(i.sends_text).replace(/\s+/g,' ').trim(),b=String(i.text||'').replace(/\s+/g,' ').trim();
    return a===b?'':'<small class="cfu-auto">اللي بيوصل للعميل من النظام (قالب واتساب بعد 24 ساعة): <span dir="auto">'+esc(i.sends_text)+'</span></small>';
  }
  // R36 (SQL93): the owner's wording comparison (crm-followup-variants.js) is drawn again at the bottom after every draw of the list
  function render(){draw();const box=byId('crmFollowups');if(box&&typeof window.crmFollowupVariantsMount==='function')window.crmFollowupVariantsMount(box);}
  function draw(){
    const box=host();if(!box)return;
    // 12 Nov 2026 (Ahmed, SQL91): investors and project askers are their own lane, apart from Muscat properties (both from the Muscat number)
    const laneOf=i=>i.lane||i.route_key,all=data.items||[],items=branch==='all'?all:all.filter(i=>laneOf(i)===branch);
    const waiting=Number(data.waiting_review||0);
    box.hidden=!all.length&&!waiting;
    if(!all.length){box.innerHTML=waiting?'<h2 class="cfu-title">متابعات اليوم</h2><p class="cfu-hint">جاري قراءة المحادثات، باقي <b dir="ltr">'+waiting+'</b>. تطلع هنا بعد المراجعة.</p>':'';return;}
    const tabs=[['all','الكل'],['barka','بركاء'],['muscat','مسقط'],['investor','المستثمرين']].map(([k,l])=>{const n=k==='all'?all.length:all.filter(i=>laneOf(i)===k).length;return '<button type="button" class="cfu-tab'+(branch===k?' on':'')+'" data-cfu="tab" data-v="'+k+'" aria-pressed="'+(branch===k)+'">'+l+' <b dir="ltr">'+n+'</b></button>';}).join('');
    if(!open){box.innerHTML='<h2 class="cfu-title"><button type="button" class="cfu-toggle" data-cfu="toggle" aria-expanded="false" style="all:unset;cursor:pointer;display:flex;gap:8px;align-items:center">متابعات اليوم <b dir="ltr">'+all.length+'</b> <small>▾</small></button></h2>';return;}
    box.innerHTML='<h2 class="cfu-title"><button type="button" class="cfu-toggle" data-cfu="toggle" aria-expanded="true" style="all:unset;cursor:pointer;display:flex;gap:8px;align-items:center">متابعات اليوم <b dir="ltr">'+all.length+'</b> <small>▴</small></button></h2><p class="cfu-hint">افتح الصفحة من جوال الفرع، واضغط «فتح في واتساب الجوال» وأرسل، أو «فتح في النظام» تشوف المحادثة وترد من هنا. العميل ينشال من القائمة لحاله.'+(isOwner()?'':' متابعة مسقط تنرسل من جوال مسقط، ومتابعة بركاء من جوال بركاء.')+(waiting?' باقي <b dir="ltr">'+waiting+'</b> قيد القراءة.':'')+'</p><div class="cfu-tabs">'+tabs+'</div>'
      +(items.length?'<ul class="cfu-list">'+items.map(i=>{const url=businessLink(i.phone,i.text),other=waLink(i.phone,i.text);return '<li class="cfu-row"><div class="cfu-head"><strong>'+esc(i.client||'عميل')+'</strong><small>'+esc(LABEL[laneOf(i)]||LABEL[i.route_key]||i.route_key)+' · '+esc(i.reason)+(i.property?' · '+esc(i.property):'')+'</small></div>'
        +'<p class="cfu-text" dir="auto">'+esc(i.text)+'</p>'+sendsLine(i)+'<small class="cfu-auto">'+esc(autoLine(i))+'</small>'
        +'<div class="cfu-actions">'+(url?'<a class="crm-wa-btn crm-wa-phone crm-wa-main cfu-open" href="'+esc(url)+'" rel="noopener noreferrer">فتح في واتساب الجوال</a><a class="cfu-other" href="'+esc(other)+'" target="_blank" rel="noopener noreferrer">رابط عادي</a>':'<span class="cfu-auto">ما له رقم</span>')+(i.conversation_id&&typeof openWhatsAppConversation==='function'?'<button type="button" class="crm-wa-btn crm-wa-crm cfu-crm" data-cfu="crm" data-id="'+esc(i.conversation_id)+'">فتح في النظام</button>':'')+'<button type="button" class="btn-secondary" data-cfu="done" data-id="'+esc(i.client_id)+'">أرسلتها</button>'+(canInstruct()?'<button type="button" class="btn-secondary" data-cfu="instr" data-k="'+esc(key(i))+'" aria-expanded="'+openInstr.has(key(i))+'">أمر للذكاء الاصطناعي</button>':'')+(typeof window.crmClaudeNoteBtn==='function'?window.crmClaudeNoteBtn({conv:i.conversation_id,client:i.client_id,phone:i.phone,name:i.client}):'')+'</div>'+instrBox(i)+'</li>';}).join('')+'</ul>':'<p class="cfu-hint">ما في متابعات لهذا الفرع</p>');
  }
  let startedAt=0;
  async function load(){
    if(typeof supa==='undefined'||typeof currentProfile==='undefined'||!currentProfile)return;
    startedAt=Date.now();
    const n=++seq,r=await supa.rpc('crm_followups_today');
    if(n!==seq||r.error||!r.data)return;
    data=r.data;render();
    document.dispatchEvent(new Event('crm-followups-updated'));
  }
  async function rewrite(b){
    const k=b.dataset.k,box=b.closest('.cfu-instr'),err=box.querySelector('.cfu-err'),ta=box.querySelector('.cfu-instr-text');
    const item=(data.items||[]).find(i=>key(i)===k);if(!item)return;
    const instruction=ta.value.trim();err.textContent='';
    if(instruction.length<3){err.textContent='اكتب الأمر أولاً';return;}
    b.disabled=true;b.textContent='يقرأ المحادثة ويكتب…';
    try{
      const r=await supa.functions.invoke('whatsapp-visit-followup-auto',{body:{kind:item.source,id:item.id,instruction}});
      let d=r.data||{};if(r.error||d.ok!==true){try{if(r.error&&r.error.context)d=await r.error.context.json();}catch(_){}throw d&&d.error?d:(r.error||d);}
      openInstr.delete(k);drafts.delete(k);
      if(d.result==='kept'){Object.assign(item,{text:d.text,reason:d.reason,owner_instruction:instruction});render();toast('انكتبت حسب أمرك. راجعها قبل ما ترسل','success');}
      else{toast((d.result==='waiting_match'?'انشال من القائمة وانحفظ طلبه: ':'انشال من القائمة: ')+(d.reason||''),'success');await load();}
    }catch(e){err.textContent=errText(e);b.disabled=false;b.textContent='اكتبها من جديد';}
  }
  document.addEventListener('click',e=>{
    const b=e.target.closest('[data-cfu]');if(!b)return;
    if(b.dataset.cfu==='toggle'){open=!open;render();return;}
    if(b.dataset.cfu==='instr'){const k=b.dataset.k;if(openInstr.has(k))openInstr.delete(k);else openInstr.add(k);const box=b.closest('.cfu-row').querySelector('.cfu-instr');if(box){box.hidden=!openInstr.has(k);b.setAttribute('aria-expanded',String(!box.hidden));if(!box.hidden)box.querySelector('textarea').focus();}return;}
    if(b.dataset.cfu==='instr-close'){openInstr.delete(b.dataset.k);const box=b.closest('.cfu-instr');box.hidden=true;const t=box.closest('.cfu-row').querySelector('[data-cfu="instr"]');if(t)t.setAttribute('aria-expanded','false');return;}
    if(b.dataset.cfu==='instr-run'){rewrite(b);return;}
    if(b.dataset.cfu==='tab'){branch=b.dataset.v;try{localStorage.setItem('crmFollowupsBranch',branch);}catch{}render();}
    // 11 Nov 2026 (Ahmed): «فتح في النظام» opens the same chat in the CRM WhatsApp page (the sheet over the home closes first)
    if(b.dataset.cfu==='crm'&&typeof navigate==='function'&&typeof openWhatsAppConversation==='function'){const id=b.dataset.id;const x=document.querySelector('#cohSheet:not([hidden]) .coh-sheet-x');if(x)x.click();navigate('whatsapp',null);setTimeout(()=>openWhatsAppConversation(id),300);return;}
    if(b.dataset.cfu==='done'){b.disabled=true;supa.rpc('crm_followup_mark_sent',{p_client:b.dataset.id}).then(r=>{if(r.error)throw r.error;return load();}).catch(()=>{b.disabled=false;toast('ما انحفظ. جرب مرة ثانية','error');});}
  });
  document.addEventListener('input',e=>{const t=e.target;if(t&&t.classList&&t.classList.contains('cfu-instr-text'))drafts.set(t.dataset.k,t.value);});
  // Back from WhatsApp: the sent message has reached the system, so the list shrinks.
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&byId('page-dash')?.classList.contains('active'))setTimeout(()=>load().catch(()=>{}),2500);});
  window.crmFollowupsCount=()=>(data.items||[]).length;
  window.crmFollowupsRefresh=()=>load().catch(()=>{});
  const loadDash=window.loadDashboard;
  // The owner home already starts this read with its own (10 Nov 2026); a second one within 3 s is skipped.
  if(typeof loadDash==='function')window.loadDashboard=function(){const r=loadDash.apply(this,arguments);setTimeout(()=>{if(Date.now()-startedAt>3000)window.crmFollowupsRefresh();},800);return r;};
})();
