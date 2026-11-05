/* Voice input (5 November 2026): a 🎤 button next to the owner's note box ("ملاحظة لـ Claude") and the
 * "أمر للذكاء الاصطناعي" box. Tap to record, tap again to stop; the recording goes to crm-voice-transcribe and
 * the text is added to the box, ready to read and send. Works on the phone (Safari records audio/mp4). */
(function(){
  'use strict';
  const toast=(m,t)=>{if(typeof showToast==='function')showToast(m,t);};
  let active=null;
  async function toB64(blob){const buf=new Uint8Array(await blob.arrayBuffer());let s='';for(let i=0;i<buf.length;i+=0x8000)s+=String.fromCharCode.apply(null,buf.subarray(i,i+0x8000));return btoa(s);}
  async function start(btn,ta){
    if(!navigator.mediaDevices||!window.MediaRecorder){toast('المتصفح ما يدعم التسجيل','error');return;}
    let stream;try{stream=await navigator.mediaDevices.getUserMedia({audio:true});}catch(e){toast('اسمح للمتصفح يستخدم المايك','error');return;}
    const type=['audio/webm;codecs=opus','audio/mp4','audio/webm','audio/ogg'].find(t=>MediaRecorder.isTypeSupported&&MediaRecorder.isTypeSupported(t))||'';
    const rec=new MediaRecorder(stream,type?{mimeType:type}:undefined),chunks=[];
    rec.ondataavailable=e=>{if(e.data&&e.data.size)chunks.push(e.data);};
    rec.onstop=async()=>{
      stream.getTracks().forEach(t=>t.stop());active=null;
      const blob=new Blob(chunks,{type:rec.mimeType||type||'audio/webm'});
      if(blob.size<800){btn.textContent='🎤';btn.classList.remove('on');return;}
      btn.textContent='⏳';btn.disabled=true;
      try{
        const r=await supa.functions.invoke('crm-voice-transcribe',{body:{audio:await toB64(blob),mime:blob.type}});
        const d=r.data||{};if(r.error||!d.ok)throw new Error(d.error||(r.error&&r.error.message)||'تعذر التحويل');
        ta.value=(ta.value.trim()?ta.value.trim()+'\n':'')+d.text;ta.dispatchEvent(new Event('input',{bubbles:true}));ta.focus();
      }catch(e){toast('تعذر تحويل الصوت: '+(e.message||e),'error');}
      finally{btn.disabled=false;btn.textContent='🎤';btn.classList.remove('on');}
    };
    rec.start();active={rec,btn};btn.textContent='⏹ إيقاف';btn.classList.add('on');
  }
  function attach(ta){
    if(!ta||ta.dataset.voice)return;ta.dataset.voice='1';
    const btn=document.createElement('button');btn.type='button';btn.className='btn-secondary voice-btn';btn.textContent='🎤';btn.title='سجل صوتية وتتحول كتابة';
    btn.addEventListener('click',()=>{if(active&&active.btn===btn){active.rec.stop();return;}if(active){active.rec.stop();}start(btn,ta);});
    ta.insertAdjacentElement('afterend',btn);
  }
  const scan=()=>document.querySelectorAll('#cnText,.rp-instr-text').forEach(attach);
  new MutationObserver(scan).observe(document.body,{childList:true,subtree:true});scan();
  window.crmVoiceAttach=attach;
})();
