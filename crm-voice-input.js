/* Voice input (5 November 2026): a 🎤 button next to the owner's note box ("ملاحظة لـ Claude") and the
 * "أمر للذكاء الاصطناعي" box. Tap to record, tap again to stop; the recording goes to crm-voice-transcribe and
 * the text is added to the box, ready to read and send. Works on the phone (Safari records audio/mp4).
 * 12 November 2026 (Ahmed): also on the office inspection note and the rejection note of a price study, and a
 * recording is never lost: when the transcription fails it stays under the box with a player, «أعد التحويل» and
 * a clear message, and nothing is typed into the box.
 * 12 November 2026, part two (Ahmed: «في كل الـ CRM»): the same button, the same transcription and the same
 * behaviour on every free-text box of the CRM (notes, descriptions, reasons, replies), for the owner and for staff
 * (crm-voice-transcribe now accepts every active account). Short boxes (name, number, price, area) get none. The
 * text is only typed into the box: nothing is saved until the person presses the form's own save button. Left out on
 * purpose: the chat reply box (its 🎤 already sends a voice note to the customer), the public request form (no
 * account), link boxes and passwords. The browser's own prompt for «سبب عدم الحاجة للمتابعة» is replaced by a small
 * window (crmAskText) so that reason can be dictated too. */
(function(){
  'use strict';
  const toast=(m,t)=>{if(typeof showToast==='function')showToast(m,t);};
  const WHY={owner_only:'حسابك ما له صلاحية التحويل الصوتي',account_not_allowed:'حسابك ما له صلاحية التحويل الصوتي',audio_missing_or_too_long:'التسجيل طويل جداً، سجّل مقاطع أقصر'};
  // every free-text box, by screen. A box that is read-only or disabled gets no button.
  const BOXES=[
    '#cnText','.rp-instr-text','.cfu-instr-text','textarea[data-insp-note]','textarea[data-cps-note]','textarea[data-cps-msg]', // notes for Claude, AI instructions, price studies
    '#cNotes','#aText','#ifNote','#crmAskTextBox',                                             // client: notes, activity, follow-up result, reason asked in a window
    '#pDesc','#pPublicDetails','#pRentedUnitsText','#pdDecisionNote','#pmNotes','.cpa-field textarea', // property: description, public details, rented units, decision, marketing, archive note
    '#piRejectNotes','#piLastMessage','#piFollowupNote',                                       // property inquiry
    '#vOwnerNote','#vOutcomeNote','#vNotes','#cqvNote',                                        // visits
    '#dLostReasonNote','#dNotes','#dwLostWords','#dwNotes','#dpLegalNotes','#dpNotes',         // deals and deposits: the button only, the forms are unchanged
    '#tNotes','#evNotes','#oNotes','#exNotes',                                                 // tasks, calendar, owners, expenses
    '#waMsgArea','textarea[data-pf-text]',                                                     // WhatsApp message to a client, the price message to an owner
    'textarea.rp-text','textarea.rp-rule-reply','textarea.rp-variant-reply','textarea.cfv-text','#ipNotes' // replies waiting for approval, pinned replies, follow-up wordings, investment projects
  ].join(',');
  let active=null;
  async function toB64(blob){const buf=new Uint8Array(await blob.arrayBuffer());let s='';for(let i=0;i<buf.length;i+=0x8000)s+=String.fromCharCode.apply(null,buf.subarray(i,i+0x8000));return btoa(s);}
  // the box may have been drawn again while the recording ran: write into the one on screen now
  function live(ta){
    if(ta.isConnected)return ta;
    if(ta.id){const again=document.getElementById(ta.id);if(again)return again;}
    for(const a of ['data-insp-note','data-cps-note','data-cps-msg','data-pf-text']){
      const v=ta.getAttribute(a);if(v){const again=document.querySelector('textarea['+a+'="'+CSS.escape(v)+'"]');if(again)return again;}
    }
    return ta;
  }
  function drop(btn){const k=btn._keep;if(!k)return;btn._keep=null;try{URL.revokeObjectURL(k.url);}catch(_){}k.box.remove();}
  function keep(btn,ta,blob){
    drop(btn);
    const box=document.createElement('span'),url=URL.createObjectURL(blob);box.className='voice-keep';
    box.innerHTML='<audio controls preload="metadata"></audio><button type="button" class="btn-secondary voice-retry">أعد التحويل</button><button type="button" class="btn-secondary voice-drop" aria-label="حذف التسجيل" title="حذف التسجيل">✕</button>';
    box.querySelector('audio').src=url;
    box.querySelector('.voice-retry').addEventListener('click',()=>transcribe(btn,ta,blob));
    box.querySelector('.voice-drop').addEventListener('click',()=>drop(btn));
    btn._keep={box,url};btn.insertAdjacentElement('afterend',box);
  }
  async function reason(r){
    let code=(r.data&&r.data.error)||'';
    if(!code&&r.error&&r.error.context&&typeof r.error.context.json==='function'){try{code=((await r.error.context.json())||{}).error||'';}catch(_){}}
    return WHY[code]||'';
  }
  // the text is added after what is already written; a box with a length limit never gets more than it can save
  function write(box,text){
    let next=(box.value.trim()?box.value.trim()+'\n':'')+text;
    const max=Number(box.maxLength)>0?Number(box.maxLength):0;
    if(max&&next.length>max){next=next.slice(0,max);toast('النص أطول من الخانة ('+max+' حرف)، فانكتب أوله بس. راجعه قبل الحفظ','error');}
    box.value=next;box.dispatchEvent(new Event('input',{bubbles:true}));box.focus();
  }
  async function transcribe(btn,ta,blob){
    if(btn.disabled)return;
    btn.textContent='⏳';btn.disabled=true;btn.classList.remove('on');
    const again=btn._keep&&btn._keep.box.querySelector('.voice-retry');if(again)again.disabled=true;
    try{
      const r=await supa.functions.invoke('crm-voice-transcribe',{body:{audio:await toB64(blob),mime:blob.type}});
      const d=r.data||{};
      if(r.error||!d.ok||!String(d.text||'').trim()){const e=new Error('transcribe');e.why=await reason(r);throw e;}
      write(live(ta),String(d.text).trim());
      drop(btn);
    }catch(e){
      keep(btn,ta,blob);
      toast('ما تحول الصوت لكتابة'+(e&&e.why?': '+e.why:'')+'. التسجيل محفوظ تحت الخانة: اضغط «أعد التحويل» أو اسمعه واكتب بيدك','error');
    }finally{btn.disabled=false;btn.textContent='🎤';}
  }
  async function start(btn,ta){
    if(!navigator.mediaDevices||!window.MediaRecorder){toast('المتصفح ما يدعم التسجيل','error');return;}
    let stream;try{stream=await navigator.mediaDevices.getUserMedia({audio:true});}catch(e){toast('اسمح للمتصفح يستخدم المايك','error');return;}
    const type=['audio/webm;codecs=opus','audio/mp4','audio/webm','audio/ogg'].find(t=>MediaRecorder.isTypeSupported&&MediaRecorder.isTypeSupported(t))||'';
    const rec=new MediaRecorder(stream,type?{mimeType:type}:undefined),chunks=[];
    rec.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data);};
    rec.onstop=()=>{
      stream.getTracks().forEach(t=>t.stop());active=null;
      const blob=new Blob(chunks,{type:rec.mimeType||type||'audio/webm'});
      if(blob.size<800){btn.textContent='🎤';btn.classList.remove('on');return;}
      transcribe(btn,ta,blob);
    };
    rec.start();active={rec,btn};btn.textContent='⏹ إيقاف';btn.classList.add('on');
  }
  function attach(ta){
    if(!ta||ta.dataset.voice||ta.readOnly||ta.disabled)return;ta.dataset.voice='1';
    const btn=document.createElement('button');btn.type='button';btn.className='btn-secondary voice-btn';btn.textContent='🎤';btn.title='سجل صوتية وتتحول كتابة';btn.setAttribute('aria-label','سجل صوتية وتتحول كتابة');
    btn.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();if(active&&active.btn===btn){active.rec.stop();return;}if(active){active.rec.stop();}start(btn,ta);});
    ta.insertAdjacentElement('afterend',btn);
  }
  // the CRM draws its lists all the time: the boxes are looked for once per burst of changes, not on every change
  let queued=false;
  const scan=()=>{queued=false;document.querySelectorAll(BOXES).forEach(attach);};
  const later=()=>{if(queued)return;queued=true;setTimeout(scan,120);};
  new MutationObserver(later).observe(document.body,{childList:true,subtree:true});scan();
  window.crmVoiceAttach=attach;

  /* A small window that asks for one free text (used for «سبب عدم الحاجة للمتابعة», which was a browser prompt and could
   * not hold a button). Resolves with the trimmed text, or null when closed. The 🎤 lands on its box like on any other. */
  window.crmAskText=function(o){
    o=o||{};
    return new Promise(done=>{
      const old=document.getElementById('crmAskText');if(old)old.remove();
      const m=document.createElement('div');m.className='modal-ov on';m.id='crmAskText';
      m.innerHTML='<div class="modal-box" role="dialog" aria-modal="true" aria-labelledby="crmAskTextTitle"><div class="modal-title" id="crmAskTextTitle"></div>'
        +'<div class="fg full"><label class="fl" for="crmAskTextBox"></label><textarea class="fta" id="crmAskTextBox" rows="3" dir="auto" maxlength="1000"></textarea></div>'
        +'<div class="modal-foot"><button type="button" class="btn-secondary" data-ask="no">إلغاء</button><button type="button" class="btn-primary" data-ask="yes" style="width:auto;padding:9px 22px"></button></div></div>';
      m.querySelector('.modal-title').textContent=o.title||'';m.querySelector('label').textContent=o.label||'';
      const box=m.querySelector('textarea');box.placeholder=o.placeholder||'';m.querySelector('[data-ask="yes"]').textContent=o.ok||'حفظ';
      const close=v=>{if(active&&m.contains(active.btn)){try{active.rec.onstop=null;active.rec.stop();active.rec.stream.getTracks().forEach(t=>t.stop());}catch(_){}active=null;}m.remove();done(v);};
      m.addEventListener('click',e=>{
        const b=e.target.closest('[data-ask]');if(!b)return;
        if(b.dataset.ask==='no'){close(null);return;}
        const v=box.value.trim();if(!v){toast(o.empty||'اكتب السبب أول','error');box.focus();return;}
        close(v);
      });
      document.body.append(m);attach(box);box.focus();
    });
  };
})();
