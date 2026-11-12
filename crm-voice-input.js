/* Voice input (5 November 2026): a 🎤 button next to the owner's note box ("ملاحظة لـ Claude") and the
 * "أمر للذكاء الاصطناعي" box. Tap to record, tap again to stop; the recording goes to crm-voice-transcribe and
 * the text is added to the box, ready to read and send. Works on the phone (Safari records audio/mp4).
 * 12 November 2026 (Ahmed): also on the office inspection note and the rejection note of a price study, and a
 * recording is never lost: when the transcription fails it stays under the box with a player, «أعد التحويل» and
 * a clear message, and nothing is typed into the box. */
(function(){
  'use strict';
  const toast=(m,t)=>{if(typeof showToast==='function')showToast(m,t);};
  const WHY={owner_only:'التحويل الصوتي لحساب المالك بس',audio_missing_or_too_long:'التسجيل طويل جداً، سجّل مقاطع أقصر'};
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
  async function transcribe(btn,ta,blob){
    if(btn.disabled)return;
    btn.textContent='⏳';btn.disabled=true;btn.classList.remove('on');
    const again=btn._keep&&btn._keep.box.querySelector('.voice-retry');if(again)again.disabled=true;
    try{
      const r=await supa.functions.invoke('crm-voice-transcribe',{body:{audio:await toB64(blob),mime:blob.type}});
      const d=r.data||{};
      if(r.error||!d.ok||!String(d.text||'').trim()){const e=new Error('transcribe');e.why=await reason(r);throw e;}
      const box=live(ta);
      box.value=(box.value.trim()?box.value.trim()+'\n':'')+String(d.text).trim();box.dispatchEvent(new Event('input',{bubbles:true}));box.focus();
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
    if(!ta||ta.dataset.voice)return;ta.dataset.voice='1';
    const btn=document.createElement('button');btn.type='button';btn.className='btn-secondary voice-btn';btn.textContent='🎤';btn.title='سجل صوتية وتتحول كتابة';btn.setAttribute('aria-label','سجل صوتية وتتحول كتابة');
    btn.addEventListener('click',()=>{if(active&&active.btn===btn){active.rec.stop();return;}if(active){active.rec.stop();}start(btn,ta);});
    ta.insertAdjacentElement('afterend',btn);
  }
  const scan=()=>document.querySelectorAll('#cnText,.rp-instr-text,.cfu-instr-text,textarea[data-insp-note],textarea[data-cps-note]').forEach(attach);
  new MutationObserver(scan).observe(document.body,{childList:true,subtree:true});scan();
  window.crmVoiceAttach=attach;
})();
