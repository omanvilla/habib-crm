/* WhatsApp-style chat for the CRM inbox: date separators, delivery ticks,
 * replies (quoted), reactions/edits/deletions shown on their message, voice
 * notes, photos, stickers, videos, files, locations and contacts opened in
 * place; composer with emoji, attachments and voice recording. The base
 * inbox still loads conversations, keeps drafts, read positions and the
 * request link; access rules stay in whatsapp-inbox / whatsapp-send(-media). */
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=v=>escapeHtml(String(v==null?'':v));
  const TZ={timeZone:'Asia/Muscat'};
  const media=new Map();            // message id → {url,type,filename} (object URLs)
  let stripOpen=false,reply=null,pending=null,recorder=null,recAfterStop=null,recChunks=[],recStart=0,recTimer=null,pollTimer=null,polling=false,observer=null;
  const EMOJI='😀 😁 😂 🤣 😊 😍 😘 😎 🤔 😅 😉 🙏 👍 👌 👏 🤝 💪 🙌 ❤️ 💚 🌹 🎉 ✅ ❌ ⭐ 🔥 💯 🏠 🏡 🏢 🏗️ 🔑 📍 📞 📅 ⏰ 💰 💵 📄 📷 🎥 🚗 ☀️ 🌙 👋 🤲 😢 😔 🙂 😃 🥰 😇 🤗 🤩 😴 🤷 👀 💡 📌 ✍️ 🕌 🎁'.split(' ');

  const dayKey=ts=>ts?new Intl.DateTimeFormat('en-CA',TZ).format(new Date(ts)):'';
  function dayLabel(ts){
    const k=dayKey(ts),today=dayKey(Date.now()),y=dayKey(Date.now()-86400000);
    if(k===today)return 'اليوم';if(k===y)return 'أمس';
    return new Intl.DateTimeFormat('ar-OM-u-nu-latn',{...TZ,weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date(ts));
  }
  const timeLabel=ts=>ts?new Intl.DateTimeFormat('en-GB',{...TZ,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(ts)):'';
  function ticks(m){
    if(m.direction!=='outbound')return '';
    const s=String(m.delivery_status||'');
    if(s==='failed')return '<span class="wa2-tick fail" title="واتساب رفض هذه الرسالة ولم تصل للعميل">⚠ لم تصل للعميل</span>';
    if(s==='read')return '<span class="wa2-tick read" title="قُرئت">✓✓</span>';
    if(s==='delivered')return '<span class="wa2-tick" title="وصلت">✓✓</span>';
    return '<span class="wa2-tick" title="أُرسلت">✓</span>';
  }
  function linkify(text){
    return esc(text).replace(/(https?:\/\/[^\s<]+)/g,u=>'<a href="'+u.replace(/"/g,'&quot;')+'" target="_blank" rel="noopener noreferrer">'+u+'</a>');
  }
  const kindLabel={image:'📷 صورة',sticker:'ملصق',audio:'🎙️ رسالة صوتية',video:'🎬 فيديو',document:'📄 ملف',location:'📍 موقع',contacts:'👤 جهة اتصال'};
  function snippet(m){
    if(!m)return 'رسالة';
    if(m.message_type==='text'||!kindLabel[m.message_type])return String(m.body||m.transcript||'').slice(0,120)||'رسالة';
    return kindLabel[m.message_type]+(m.body?' · '+String(m.body).slice(0,80):'');
  }
  function contactsHtml(list){
    return (Array.isArray(list)?list:[]).slice(0,5).map(c=>{
      const name=c?.name?.formatted_name||[c?.name?.first_name,c?.name?.last_name].filter(Boolean).join(' ')||'جهة اتصال';
      const phone=(c?.phones||[])[0]?.phone||(c?.phones||[])[0]?.wa_id||'';
      return '<div class="wa2-contact">👤 <strong>'+esc(name)+'</strong>'+(phone?' <bdi dir="ltr">'+esc(phone)+'</bdi>':'')+'</div>';
    }).join('')||'<div class="wa2-contact">👤 جهة اتصال</div>';
  }
  function mediaBox(m){
    const k=m.message_type,id=esc(m.id);
    if(!m.media_id)return '<div class="wa2-media-missing">'+esc(kindLabel[k]||'مرفق')+'</div>';
    if(k==='image'||k==='sticker')return '<div class="wa2-media wa2-img'+(k==='sticker'?' sticker':'')+'" data-wa2-media="'+id+'" data-kind="'+k+'"><span>'+esc(kindLabel[k])+'</span></div>';
    if(k==='audio')return '<div class="wa2-audio" data-wa2-media="'+id+'" data-kind="audio"><button type="button" class="wa2-play" data-wa2-load="'+id+'" aria-label="تشغيل">▶</button><span class="wa2-wave"></span><span class="wa2-audio-label">'+(m.voice==='true'||m.voice===true?'🎙️':'🎵')+'</span></div>';
    if(k==='video')return '<div class="wa2-media wa2-video" data-wa2-media="'+id+'" data-kind="video"><button type="button" class="wa2-play big" data-wa2-load="'+id+'" aria-label="تشغيل الفيديو">▶</button><span>🎬 فيديو</span></div>';
    if(k==='document'){const name=m.doc_name||m.crm_media?.filename||m.body||'ملف';
      return '<div class="wa2-doc" data-wa2-media="'+id+'" data-kind="document"><span class="wa2-doc-ico">📄</span><span class="wa2-doc-name" dir="auto">'+esc(name)+'</span><button type="button" class="wa2-doc-open" data-wa2-load="'+id+'">فتح</button></div>';}
    return '';
  }
  function bubbleBody(m,state){
    if(state.revoked)return '<div class="wa2-deleted">🚫 تم حذف هذه الرسالة</div>';
    const k=m.message_type;let h='';
    if(['image','sticker','audio','video','document'].includes(k)){
      h+=mediaBox(m);
      if(k==='audio'&&m.transcript)h+='<div class="wa2-transcript" dir="auto">'+esc(m.transcript)+'</div>';
      else if(k==='audio'&&m.transcription_status==='failed')h+='<div class="wa2-transcript muted">تعذر تحويل الصوت إلى نص</div>';
      if(m.body&&k!=='document')h+='<div class="wa2-text" dir="auto">'+linkify(state.edited||m.body)+'</div>';
      return h;
    }
    if(k==='location'&&m.location){const lat=Number(m.location.latitude),lng=Number(m.location.longitude);
      if(Number.isFinite(lat)&&Number.isFinite(lng))return '<a class="wa2-location" href="https://maps.google.com/?q='+lat+','+lng+'" target="_blank" rel="noopener noreferrer">📍 '+esc(m.location.name||m.location.address||'فتح الموقع في الخريطة')+'</a>';}
    if(k==='contacts')return contactsHtml(m.contacts);
    if(k==='unsupported')return '<div class="wa2-deleted">رسالة لا يدعمها واتساب للأعمال (مثل الاستطلاع أو الرسالة لمرة واحدة)</div>';
    return '<div class="wa2-text" dir="auto">'+linkify(state.edited||waMessageText(m))+'</div>';
  }
  function renderBody(preserveScroll){
    const body=$('waChatBody');if(!body||!Array.isArray(waInboxMessages))return;
    if(!waInboxMessages.length){body.innerHTML='<div class="wa-empty-chat">لا توجد رسائل بعد.</div>';return;}
    const byWamid=new Map(waInboxMessages.filter(m=>m.whatsapp_message_id).map(m=>[m.whatsapp_message_id,m]));
    const state=new Map(),reactions=new Map();
    // Reactions, edits and deletions are shown on the message they refer to.
    const hidden=new Set();
    for(const m of waInboxMessages){
      if(m.message_type==='reaction'&&m.reaction?.message_id){const t=byWamid.get(m.reaction.message_id);if(t){hidden.add(m.id);const list=reactions.get(t.id)||[];if(m.reaction.emoji)list.push(m.reaction.emoji);reactions.set(t.id,list);}}
      if(m.message_type==='edit'&&m.edit_of){const t=byWamid.get(m.edit_of);if(t){hidden.add(m.id);state.set(t.id,{...(state.get(t.id)||{}),edited:m.edit_text||''});}}
      if(m.message_type==='revoke'&&m.revoke_of){const t=byWamid.get(m.revoke_of);if(t){hidden.add(m.id);state.set(t.id,{...(state.get(t.id)||{}),revoked:true});}}
    }
    let h=waMessagesNextBefore?'<button type="button" class="wa2-older" onclick="loadOlderWhatsAppMessages()">عرض الرسائل الأقدم</button>':'',lastDay='';
    for(const m of waInboxMessages){
      if(hidden.has(m.id))continue;
      const d=dayKey(m.message_timestamp);if(d&&d!==lastDay){h+='<div class="wa2-day"><span>'+esc(dayLabel(m.message_timestamp))+'</span></div>';lastDay=d;}
      if(m.message_type==='system'){h+='<div class="wa2-system">'+esc(m.body||'إشعار من واتساب')+'</div>';continue;}
      if(m.message_type==='reaction'){h+='<div class="wa2-system">تفاعل '+esc(m.reaction?.emoji||'')+' على رسالة</div>';continue;}
      if(m.message_type==='edit'){h+='<div class="wa2-system">✏️ عُدّلت رسالة: '+esc(m.edit_text||'')+'</div>';continue;}
      if(m.message_type==='revoke'){h+='<div class="wa2-system">🚫 حُذفت رسالة</div>';continue;}
      const out=m.direction==='outbound',st=state.get(m.id)||{},quoteId=m.reply_to_message_id||m.context_id,quote=quoteId?byWamid.get(quoteId):null;
      const who=out?(m.actor_type==='automated'?'رد آلي':m.channel_source==='crm'?'من النظام':''):'';
      h+='<div class="wa2-row '+(out?'out':'in')+'" data-wa2-row="'+esc(m.id)+'"><div class="wa2-bubble '+(out?'out':'in')+(['sticker'].includes(m.message_type)?' bare':'')+'">'+
        (m.forwarded==='true'?'<div class="wa2-forwarded">↪ تمت إعادة توجيهها</div>':'')+
        (quote?'<button type="button" class="wa2-quote '+(quote.direction==='outbound'?'out':'in')+'" data-wa2-goto="'+esc(quote.id)+'"><strong>'+(quote.direction==='outbound'?'أنت':'العميل')+'</strong><span dir="auto">'+esc(snippet(quote))+'</span></button>':quoteId?'<div class="wa2-quote missing">رد على رسالة أقدم</div>':'')+
        bubbleBody(m,st)+
        (typeof waAutomationBadge==='function'?waAutomationBadge(m):'')+
        '<div class="wa2-meta">'+(who?'<span class="wa2-who">'+esc(who)+'</span>':'')+(st.edited?'<span>معدّلة</span>':'')+'<span>'+esc(timeLabel(m.message_timestamp))+'</span>'+ticks(m)+'</div>'+
        ((reactions.get(m.id)||[]).length?'<div class="wa2-reactions">'+esc([...new Set(reactions.get(m.id))].join(' '))+'</div>':'')+
        '<div class="wa2-actions"><button type="button" data-wa2-reply="'+esc(m.id)+'" title="رد">↩</button>'+((m.body||m.transcript)?'<button type="button" data-wa2-copy="'+esc(m.id)+'" title="نسخ">⧉</button>':'')+'</div>'+
        '</div></div>';
    }
    body.innerHTML=h;
    for(const [id,item] of media)attachMedia(id,item);
    observeImages();
    if(!preserveScroll)setTimeout(()=>{body.scrollTop=body.scrollHeight;},30);
  }

  // iPhone Safari can't play WhatsApp voice notes (Ogg/Opus). They are decoded in the
  // browser and played as WAV, so voice notes open on the phone the same as on the computer.
  let oggDecoderMod=null;
  function canPlayOgg(){try{const a=document.createElement('audio');return !!(a.canPlayType('audio/ogg; codecs="opus"')||'').replace('no','');}catch(_){return false;}}
  function wavFromPcm(channels,rate){
    const ch=channels.length,len=channels[0]?channels[0].length:0,buf=new ArrayBuffer(44+len*ch*2),v=new DataView(buf);
    const w=(o,t)=>{for(let i=0;i<t.length;i++)v.setUint8(o+i,t.charCodeAt(i));};
    w(0,'RIFF');v.setUint32(4,36+len*ch*2,true);w(8,'WAVE');w(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,ch,true);
    v.setUint32(24,rate,true);v.setUint32(28,rate*ch*2,true);v.setUint16(32,ch*2,true);v.setUint16(34,16,true);w(36,'data');v.setUint32(40,len*ch*2,true);
    let o=44;for(let i=0;i<len;i++)for(let c=0;c<ch;c++){const x=Math.max(-1,Math.min(1,channels[c][i]));v.setInt16(o,x<0?x*32768:x*32767,true);o+=2;}
    return new Blob([buf],{type:'audio/wav'});
  }
  async function oggToWav(blob){
    if(!oggDecoderMod)oggDecoderMod=await import('https://cdn.jsdelivr.net/npm/ogg-opus-decoder@1.7.5/+esm');
    const dec=new oggDecoderMod.OggOpusDecoder();await dec.ready;
    try{const r=await dec.decodeFile(new Uint8Array(await blob.arrayBuffer()));if(!r||!r.samplesDecoded)throw new Error('empty');return wavFromPcm(r.channelData,r.sampleRate);}
    finally{try{dec.free();}catch(_){}}
  }
  async function playableAudio(item){
    if(item.wav||!/^audio\/(ogg|opus)/.test(item.type||''))return item;
    try{const wav=await oggToWav(await (await fetch(item.url)).blob());item.wav=true;item.url=URL.createObjectURL(wav);item.type='audio/wav';}catch(e){console.warn('[wa2] voice decode',e);}
    return item;
  }

  // Media are read through the inbox function (caller access is checked there).
  async function loadMedia(id){
    if(media.has(id))return media.get(id);
    const conversationId=waInboxActiveId,message=waInboxMessages.find(m=>m.id===id);
    // Voice notes, videos and files arrive as a byte stream (works above 16 MB).
    if(message&&['audio','video','document'].includes(message.message_type)){
      const r=await supa.functions.invoke('whatsapp-inbox',{body:{action:'media_stream',conversation_id:conversationId,message_id:id}});
      if(r.error){let detail='';try{const p=await r.error.context.json();detail=p.message||p.error||'';}catch(_){}
        throw new Error(detail==='media_size_limit'?'الملف كبير جدًا':detail||'تعذر فتح المرفق من واتساب');}
      if(!(r.data instanceof Blob))throw new Error('تعذر قراءة المرفق');
      const fallback={video:'video/mp4',audio:'audio/ogg',document:'application/octet-stream'}[message.message_type];
      const type=(r.response&&r.response.headers&&r.response.headers.get('x-media-type'))||(message.crm_media&&message.crm_media.mime_type)||fallback;
      const item={url:URL.createObjectURL(new Blob([r.data],{type})),type,filename:message.doc_name||(message.crm_media&&message.crm_media.filename)||null};
      if(message.message_type==='audio'&&!canPlayOgg())await playableAudio(item);
      if(conversationId===waInboxActiveId)media.set(id,item);
      return item;
    }
    const data=await waInboxInvoke({action:'media',conversation_id:conversationId,message_id:id});
    const url=String(data.data_url||''),type=String(data.media_type||'');
    if(!url.startsWith('data:'+type+';base64,'))throw new Error('صيغة غير مدعومة');
    const bin=atob(url.slice(url.indexOf(',')+1)),bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
    const item={url:URL.createObjectURL(new Blob([bytes],{type})),type,filename:data.filename||null};
    if(conversationId===waInboxActiveId)media.set(id,item);
    return item;
  }
  function attachMedia(id,item){
    const box=document.querySelector('[data-wa2-media="'+CSS.escape(id)+'"]');if(!box||box.dataset.loaded)return;
    const kind=box.dataset.kind;box.dataset.loaded='1';
    if(kind==='image'||kind==='sticker'){box.innerHTML='<img src="'+item.url+'" alt="'+(kind==='sticker'?'ملصق':'صورة')+'" data-wa2-zoom="'+esc(id)+'">';}
    else if(kind==='audio'){box.innerHTML='<audio controls preload="metadata" src="'+item.url+'"></audio>';
      const au=box.querySelector('audio');if(au)au.addEventListener('error',async()=>{if(item.wav)return;await playableAudio(item);if(item.wav){au.src=item.url;au.load();}},{once:true});}
    else if(kind==='video'){box.innerHTML='<video controls preload="metadata" src="'+item.url+'"></video>';}
    else if(kind==='document'){const a=box.querySelector('.wa2-doc-open');if(a){a.textContent='فتح';}}
  }
  async function openMedia(id,button){
    const box=document.querySelector('[data-wa2-media="'+CSS.escape(id)+'"]');if(!box)return;
    if(button){button.disabled=true;button.textContent='…';}
    try{
      const item=await loadMedia(id);
      if(box.dataset.kind==='document'){
        if(button){button.disabled=false;button.textContent='فتح';}
        if(/^application\/pdf$|^image\/|^text\/plain$|^video\/|^audio\//.test(item.type))window.open(item.url,'_blank','noopener');
        else{const a=document.createElement('a');a.href=item.url;a.download=item.filename||'ملف';document.body.append(a);a.click();a.remove();}
        return;
      }
      attachMedia(id,item);
      const player=box.querySelector('audio,video');if(player)player.play().catch(()=>{});
    }catch(e){if(button){button.disabled=false;button.textContent='↻';}showToast('تعذر فتح المرفق: '+(e.message||e),'error');}
  }
  // Photos and stickers load when they scroll into view, like WhatsApp.
  function observeImages(){
    if(observer)observer.disconnect();
    if(typeof IntersectionObserver!=='function')return;
    observer=new IntersectionObserver(entries=>{for(const e of entries){if(!e.isIntersecting)continue;observer.unobserve(e.target);const id=e.target.dataset.wa2Media;loadMedia(id).then(item=>attachMedia(id,item)).catch(()=>{e.target.innerHTML='<button type="button" class="wa2-retry" data-wa2-load="'+esc(id)+'">↻ إعادة تحميل الصورة</button>';});}},{root:$('waChatBody'),rootMargin:'200px'});
    document.querySelectorAll('#waChatBody .wa2-img:not([data-loaded])').forEach(n=>observer.observe(n));
  }

  // ---------- Composer ----------
  function installComposer(){
    const box=$('waChatCompose');if(!box||box.dataset.wa2)return;
    const textarea=$('waInboxMessage'),send=$('waInboxSendBtn');if(!textarea||!send)return;
    box.dataset.wa2='1';box.classList.add('wa2-compose');
    textarea.removeAttribute('onkeydown');textarea.rows=1;textarea.placeholder='اكتب رسالة';textarea.setAttribute('dir','auto');
    send.removeAttribute('onclick');send.className='wa2-send';send.innerHTML='➤';send.setAttribute('aria-label','إرسال');send.removeAttribute('style');
    const top=document.createElement('div');top.className='wa2-compose-top';top.innerHTML='<div class="wa2-reply-bar" id="wa2ReplyBar" hidden></div><div class="wa2-attach-preview" id="wa2AttachPreview" hidden></div><div class="wa2-emoji-panel" id="wa2EmojiPanel" hidden>'+EMOJI.map(e=>'<button type="button" data-wa2-emoji="'+e+'">'+e+'</button>').join('')+'</div>';
    const emoji=document.createElement('button');emoji.type='button';emoji.className='wa2-icon';emoji.id='wa2EmojiBtn';emoji.title='الوجوه التعبيرية';emoji.textContent='😊';
    const attach=document.createElement('button');attach.type='button';attach.className='wa2-icon';attach.id='wa2AttachBtn';attach.title='إرفاق صورة أو فيديو أو ملف';attach.textContent='📎';
    const file=document.createElement('input');file.type='file';file.id='wa2File';file.hidden=true;file.accept='image/*,video/mp4,video/3gpp,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt';
    const mic=document.createElement('button');mic.type='button';mic.className='wa2-send';mic.id='wa2MicBtn';mic.title='تسجيل رسالة صوتية';mic.textContent='🎤';
    // Discard a voice note while it is being recorded (WhatsApp's bin). Hidden otherwise.
    const recCancel=document.createElement('button');recCancel.type='button';recCancel.className='wa2-icon wa2-rec-cancel';recCancel.id='wa2RecCancel';recCancel.title='إلغاء التسجيل بدون إرسال';recCancel.setAttribute('aria-label','إلغاء التسجيل');recCancel.textContent='🗑';recCancel.hidden=true;
    box.prepend(top);box.insertBefore(emoji,textarea);box.insertBefore(attach,textarea);box.insertBefore(recCancel,textarea);box.append(mic,file);
    textarea.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();sendNow();}});
    textarea.addEventListener('input',()=>{autoGrow();syncButtons();});
    send.addEventListener('click',sendNow);
    emoji.addEventListener('click',()=>{const p=$('wa2EmojiPanel');p.hidden=!p.hidden;});
    attach.addEventListener('click',()=>file.click());
    file.addEventListener('change',()=>{if(file.files&&file.files[0])pick(file.files[0]);file.value='';});
    mic.addEventListener('click',toggleRecording);
    recCancel.addEventListener('click',()=>stopRecording('discard'));
    textarea.addEventListener('paste',e=>{const f=[...(e.clipboardData?.files||[])][0];if(f){e.preventDefault();pick(f);}});
    const panel=document.querySelector('.wa-chat-panel');
    if(panel){panel.addEventListener('dragover',e=>{if(e.dataTransfer?.types?.includes('Files')){e.preventDefault();}});panel.addEventListener('drop',e=>{const f=e.dataTransfer?.files?.[0];if(f){e.preventDefault();pick(f);}});}
    syncButtons();
  }
  function autoGrow(){const t=$('waInboxMessage');if(!t)return;t.style.height='auto';t.style.height=Math.min(140,t.scrollHeight)+'px';}
  function syncButtons(){
    const t=$('waInboxMessage'),send=$('waInboxSendBtn'),mic=$('wa2MicBtn');if(!t||!send||!mic)return;
    const hasContent=Boolean(t.value.trim()||pending);
    send.hidden=!hasContent&&!recorder;mic.hidden=hasContent&&!recorder;
    const rc=$('wa2RecCancel');if(rc)rc.hidden=!recorder;
  }
  function setReply(m){
    reply=m?{id:m.id,wamid:m.whatsapp_message_id,text:snippet(m),out:m.direction==='outbound'}:null;
    const bar=$('wa2ReplyBar');if(!bar)return;
    if(!reply||!reply.wamid){reply=null;bar.hidden=true;bar.innerHTML='';return;}
    bar.hidden=false;bar.innerHTML='<div><strong>'+(reply.out?'رد على رسالتك':'رد على العميل')+'</strong><span dir="auto">'+esc(reply.text)+'</span></div><button type="button" data-wa2-cancel-reply aria-label="إلغاء الرد">✕</button>';
    $('waInboxMessage')?.focus();
  }
  const ALLOWED_DOC=/^(application\/(pdf|msword|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)|vnd\.ms-excel|vnd\.ms-powerpoint)|text\/plain)$/;
  function readAsBase64(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]||'');r.onerror=()=>reject(r.error);r.readAsDataURL(blob);});}
  async function toJpeg(file){
    const url=URL.createObjectURL(file);
    try{
      const img=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(new Error('تعذر قراءة الصورة'));i.src=url;});
      const scale=Math.min(1,2560/Math.max(img.naturalWidth,img.naturalHeight));
      const c=document.createElement('canvas');c.width=Math.round(img.naturalWidth*scale);c.height=Math.round(img.naturalHeight*scale);
      c.getContext('2d').drawImage(img,0,0,c.width,c.height);
      return await new Promise(resolve=>c.toBlob(resolve,'image/jpeg',0.85));
    }finally{URL.revokeObjectURL(url);}
  }
  async function pick(file){
    let type=String(file.type||'').toLowerCase(),blob=file,kind='document',name=file.name||'ملف';
    if(type==='audio/x-m4a'||type==='audio/m4a')type='audio/mp4';if(type==='audio/mp3')type='audio/mpeg';
    try{
      if(type.startsWith('image/')){kind='image';if(!/^image\/(jpeg|png)$/.test(type)||file.size>5*1024*1024){blob=await toJpeg(file);type='image/jpeg';name=name.replace(/\.[^.]+$/,'')+'.jpg';}}
      else if(/^video\/(mp4|3gpp)$/.test(type))kind='video';
      else if(/^audio\/(ogg|mpeg|mp4|aac|amr)$/.test(type))kind='audio';
      else if(!ALLOWED_DOC.test(type))throw new Error('هذا النوع من الملفات لا يقبله واتساب. أرسل صورة أو فيديو MP4 أو PDF أو ملف Word/Excel.');
      const max=kind==='image'?5:16;
      if(blob.size>max*1024*1024)throw new Error('الحجم أكبر من '+max+' ميجابايت، وهو حد واتساب لهذا النوع.');
      clearPending();
      pending={kind,mime:type,filename:name,blob,size:blob.size,preview:URL.createObjectURL(blob),operation:crypto.randomUUID(),state:'new'};
      renderPending();syncButtons();$('waInboxMessage')?.focus();
    }catch(e){showToast(e.message||String(e),'error');}
  }
  function clearPending(){if(pending?.preview)URL.revokeObjectURL(pending.preview);pending=null;renderPending();syncButtons();}
  function renderPending(){
    const box=$('wa2AttachPreview');if(!box)return;
    if(!pending){box.hidden=true;box.innerHTML='';return;}
    const size=(pending.size/1024/1024).toFixed(pending.size>1048576?1:2)+' MB';
    const preview=pending.kind==='image'?'<img src="'+pending.preview+'" alt="">':pending.kind==='video'?'<video src="'+pending.preview+'" muted></video>':pending.kind==='audio'?'<audio controls src="'+pending.preview+'"></audio>':'<span class="wa2-doc-ico">📄</span>';
    box.hidden=false;box.innerHTML=preview+'<div class="wa2-attach-info"><strong dir="auto">'+esc(pending.filename)+'</strong><small>'+esc(size)+(pending.kind!=='audio'?' · اكتب تعليقًا إن أردت ثم اضغط إرسال':' · اسمعها ثم إرسال أو حذف')+'</small></div><button type="button" class="wa2-discard" data-wa2-cancel-file aria-label="'+(pending.kind==='audio'?'حذف الصوتية بدون إرسال':'إلغاء المرفق')+'">🗑 '+(pending.kind==='audio'?'حذف':'إلغاء')+'</button>';
  }
  // Voice notes: WhatsApp accepts OGG/Opus or MP4/AAC; Chrome and Safari record MP4.
  function recorderType(){
    if(typeof MediaRecorder!=='function')return '';
    return ['audio/ogg;codecs=opus','audio/mp4;codecs=mp4a.40.2','audio/mp4'].find(t=>MediaRecorder.isTypeSupported(t))||'';
  }
  // 14 Nov 2026: Chrome records MP4, and WhatsApp accepted then refused both voice notes sent that way
  // (error 131053 «Media upload error», 11 and 14 Nov). The recording is re-encoded here to Ogg/Opus mono,
  // WhatsApp's own voice-note format, before it is attached. Browsers that cannot play Ogg keep the old path.
  const OGG_CRC=(()=>{const t=new Uint32Array(256);for(let i=0;i<256;i++){let r=i<<24;for(let j=0;j<8;j++)r=(r&0x80000000)?((r<<1)^0x04c11db7):(r<<1);t[i]=r>>>0;}return t;})();
  function oggPage(serial,seq,granule,flags,packets){
    const lacing=[];let size=0;
    for(const p of packets){let n=p.length;size+=n;while(n>=255){lacing.push(255);n-=255;}lacing.push(n);}
    const page=new Uint8Array(27+lacing.length+size),v=new DataView(page.buffer);
    page.set([0x4f,0x67,0x67,0x53,0,flags]);
    v.setUint32(6,granule>>>0,true);v.setUint32(10,Math.floor(granule/4294967296),true);
    v.setUint32(14,serial,true);v.setUint32(18,seq,true);page[26]=lacing.length;page.set(lacing,27);
    let o=27+lacing.length;for(const p of packets){page.set(p,o);o+=p.length;}
    let c=0;for(let i=0;i<page.length;i++)c=((c<<8)^OGG_CRC[((c>>>24)^page[i])&255])>>>0;
    v.setUint32(22,c,true);
    return page;
  }
  async function toOggOpus(blob){
    if(typeof AudioEncoder!=='function'||typeof AudioData!=='function'||typeof OfflineAudioContext!=='function')throw new Error('no_encoder');
    const RATE=48000,cfg={codec:'opus',sampleRate:RATE,numberOfChannels:1,bitrate:32000};
    const ok=await AudioEncoder.isConfigSupported(cfg);if(!ok||!ok.supported)throw new Error('no_opus');
    const dec=await new OfflineAudioContext(1,1,RATE).decodeAudioData(await blob.arrayBuffer());   // decoded at 48 kHz
    const pcm=new Float32Array(dec.length),chs=dec.numberOfChannels;
    for(let c=0;c<chs;c++){const d=dec.getChannelData(c);for(let i=0;i<d.length;i++)pcm[i]+=d[i]/chs;}
    if(!pcm.length)throw new Error('empty');
    const packets=[];let head=null,failed=null;
    const enc=new AudioEncoder({output:(chunk,meta)=>{
      const b=new Uint8Array(chunk.byteLength);chunk.copyTo(b);packets.push({b,n:Math.round((chunk.duration||20000)*RATE/1e6)});
      const d=meta&&meta.decoderConfig&&meta.decoderConfig.description;
      if(d&&!head)head=d instanceof ArrayBuffer?new Uint8Array(d.slice(0)):new Uint8Array(d.buffer.slice(d.byteOffset,d.byteOffset+d.byteLength));
    },error:e=>{failed=e;}});
    enc.configure(cfg);
    for(let i=0;i<pcm.length;i+=RATE){
      const part=pcm.slice(i,Math.min(pcm.length,i+RATE));
      const frame=new AudioData({format:'f32-planar',sampleRate:RATE,numberOfFrames:part.length,numberOfChannels:1,timestamp:Math.round(i/RATE*1e6),data:part});
      enc.encode(frame);frame.close();
    }
    await enc.flush();enc.close();
    if(failed)throw failed;if(!packets.length)throw new Error('empty');
    const txt=s=>new TextEncoder().encode(s);
    let opusHead=head&&head.length>=19&&String.fromCharCode(...head.subarray(0,8))==='OpusHead'?head:null;
    if(!opusHead){opusHead=new Uint8Array(19);opusHead.set(txt('OpusHead'));opusHead[8]=1;opusHead[9]=1;const hv=new DataView(opusHead.buffer);hv.setUint16(10,312,true);hv.setUint32(12,RATE,true);}
    const preskip=opusHead[10]|(opusHead[11]<<8),vendor=txt('habib-crm');
    const tags=new Uint8Array(8+4+vendor.length+4);tags.set(txt('OpusTags'));new DataView(tags.buffer).setUint32(8,vendor.length,true);tags.set(vendor,12);
    const serial=(Math.random()*4294967296)>>>0,total=preskip+pcm.length,pages=[oggPage(serial,0,0,2,[opusHead]),oggPage(serial,1,0,0,[tags])];
    let seq=2,granule=0,group=[],segs=0;
    const flush=last=>{if(!group.length)return;pages.push(oggPage(serial,seq++,last?Math.min(granule,total):granule,last?4:0,group));group=[];segs=0;};
    for(const p of packets){
      const need=Math.floor(p.b.length/255)+1;
      if(segs+need>255||group.length>=50)flush(false);
      group.push(p.b);segs+=need;granule+=p.n;
    }
    flush(true);
    return new Blob(pages,{type:'audio/ogg'});
  }
  // mode: 'keep' = preview before sending (⏹), 'send' = send at once (➤), 'discard' = bin (🗑).
  function stopRecording(mode){
    if(!recorder)return;
    recAfterStop=mode||'keep';
    try{recorder.stop();}catch(_){recAfterStop=null;}
  }
  async function toggleRecording(){
    if(recorder){stopRecording('keep');return;}
    const type=recorderType();
    if(!type){showToast('هذا المتصفح لا يسجّل بصيغة يقبلها واتساب. استخدم Chrome حديثًا أو أرسل ملفًا صوتيًا.','error');return;}
    let stream;
    try{stream=await navigator.mediaDevices.getUserMedia({audio:true});}
    catch{showToast('اسمح للمتصفح باستخدام الميكروفون ثم أعد المحاولة.','error');return;}
    recChunks=[];recorder=new MediaRecorder(stream,{mimeType:type});recStart=Date.now();
    recorder.ondataavailable=e=>{if(e.data&&e.data.size)recChunks.push(e.data);};
    recorder.onstop=()=>{stream.getTracks().forEach(t=>t.stop());clearInterval(recTimer);const mime=type.split(';')[0];const blob=new Blob(recChunks,{type:mime});recorder=null;
      const mic=$('wa2MicBtn');if(mic){mic.textContent='🎤';mic.classList.remove('rec');}
      const mode=recAfterStop||'keep';recAfterStop=null;
      if(mode==='discard'){recChunks=[];syncButtons();showToast('انحذفت الصوتية ولم تُرسل','success');return;}
      if(Date.now()-recStart<800||!blob.size){syncButtons();return;}
      const stamp='voice-'+new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
      (async()=>{
        let out=blob,outMime=mime;
        if(mime!=='audio/ogg'&&canPlayOgg()){
          if(mic)mic.disabled=true;
          try{out=await toOggOpus(blob);outMime='audio/ogg';}
          catch(e){console.warn('[wa2] voice to ogg',e);showToast('تعذر تجهيز الصوتية بصيغة واتساب، وقد يرفضها واتساب. لو ما وصلت أرسلها من تطبيق واتساب.','error');}
          finally{if(mic)mic.disabled=false;}
        }
        await pick(new File([out],stamp+(outMime==='audio/ogg'?'.ogg':'.m4a'),{type:outMime}));
        if(mode==='send'&&pending&&pending.kind==='audio')sendMedia();
      })();};
    recorder.start();
    const mic=$('wa2MicBtn');if(mic){mic.classList.add('rec');const tick=()=>{const s=Math.floor((Date.now()-recStart)/1000);mic.textContent='⏹ '+Math.floor(s/60)+':'+String(s%60).padStart(2,'0');};tick();recTimer=setInterval(tick,500);}
    syncButtons();
  }
  async function sendMedia(){
    const conversationId=waInboxActiveId,t=$('waInboxMessage'),send=$('waInboxSendBtn');
    if(!conversationId||!pending)return;
    if(pending.state==='unknown'){showToast('حالة إرسال هذا المرفق غير مؤكدة. افحص المحادثة قبل أي محاولة جديدة.','error');return;}
    const item=pending,caption=t.value.trim(),replyTo=reply?.wamid||null;
    send.disabled=true;send.textContent='…';item.state='pending';
    try{
      const data=await readAsBase64(item.blob);
      const r=await supa.functions.invoke('whatsapp-send-media',{body:{conversation_id:conversationId,operation_id:item.operation,body:caption,reply_to:replyTo,request_id:waInboxSelectedRequestId||null,media:{kind:item.kind,mime:item.mime,filename:item.filename,data}}});
      let res=r.data;if(r.error){try{res=await r.error.context.json();}catch(_){}}
      if(res&&res.sent===true){
        item.state='sent';clearPending();setReply(null);if(waInboxActiveId===conversationId){t.value='';autoGrow();waInboxDrafts.delete(conversationId);await openWhatsAppConversation(conversationId);}
        showToast(res.warning?res.message:'تم الإرسال','success');
      }else{
        item.state=res&&res.sent===false&&res.retry_safe===true?'new':'unknown';
        if(item.state==='new')item.operation=crypto.randomUUID();
        showToast((res&&(res.message||res.error))||'لم يُرسل المرفق','error');
      }
    }catch(e){item.state='unknown';showToast('حالة الإرسال غير مؤكدة: '+(e.message||e),'error');}
    finally{send.disabled=false;send.innerHTML='➤';syncButtons();}
  }
  const replyOps=new Map();
  async function sendReply(){
    const conversationId=waInboxActiveId,t=$('waInboxMessage'),send=$('waInboxSendBtn'),text=t.value.trim();
    if(!conversationId||!text||!reply)return;
    const key=conversationId+'|'+reply.wamid+'|'+text;let op=replyOps.get(key);
    if(op&&op.state==='unknown'){showToast('حالة إرسال هذا الرد غير مؤكدة. افحص المحادثة أولًا.','error');return;}
    if(!op||op.state==='new')op={id:crypto.randomUUID(),state:'new'};replyOps.set(key,op);
    send.disabled=true;send.textContent='…';op.state='pending';
    try{
      const r=await supa.functions.invoke('whatsapp-send-media',{body:{conversation_id:conversationId,operation_id:op.id,body:text,reply_to:reply.wamid,request_id:waInboxSelectedRequestId||null}});
      let res=r.data;if(r.error){try{res=await r.error.context.json();}catch(_){}}
      if(res&&res.sent===true){op.state='sent';setReply(null);t.value='';autoGrow();waInboxDrafts.delete(conversationId);await openWhatsAppConversation(conversationId);showToast(res.warning?res.message:'تم إرسال الرد','success');}
      else{op.state=res&&res.sent===false&&res.retry_safe===true?'new':'unknown';showToast((res&&(res.message||res.error))||'لم يُرسل الرد','error');}
    }catch(e){op.state='unknown';showToast('حالة الإرسال غير مؤكدة: '+(e.message||e),'error');}
    finally{send.disabled=false;send.innerHTML='➤';syncButtons();}
  }
  function sendNow(){
    if(recorder)return stopRecording('send');
    if(pending)return sendMedia();
    if(reply&&$('waInboxMessage').value.trim())return sendReply();
    if($('waInboxMessage').value.trim())return sendWhatsAppInboxMessage().then(()=>{autoGrow();syncButtons();});
  }

  // ---------- Live updates of the open conversation ----------
  async function poll(){
    if(polling||document.visibilityState!=='visible'||!$('page-whatsapp')?.classList.contains('active')||!waInboxActiveId||!waInboxActiveConversation)return;
    polling=true;const id=waInboxActiveId,seq=waConversationLoadSeq;
    try{
      const data=await waInboxInvoke({action:'messages',conversation_id:id,limit:20});
      if(id!==waInboxActiveId||seq!==waConversationLoadSeq)return;
      const known=new Map(waInboxMessages.map(m=>[m.id,m]));let changed=false,incoming=false;
      for(const m of data.messages||[]){const old=known.get(m.id);
        if(!old){known.set(m.id,m);changed=true;if(m.direction==='inbound')incoming=true;}
        else if(old.delivery_status!==m.delivery_status||old.transcript!==m.transcript){
          // WhatsApp accepts a message first and may refuse it seconds later: say so, the «تم الإرسال» toast is already gone.
          if(m.direction==='outbound'&&m.delivery_status==='failed'&&old.delivery_status!=='failed')showToast('واتساب رفض رسالة في هذه المحادثة ولم تصل للعميل. شوف علامة ⚠ وأعد إرسالها.','error');
          Object.assign(old,m);changed=true;}}
      if(!changed)return;
      const body=$('waChatBody'),atBottom=body&&body.scrollHeight-body.scrollTop-body.clientHeight<120;
      waInboxMessages=[...known.values()].sort((a,b)=>String(a.message_timestamp).localeCompare(String(b.message_timestamp))||Number(a.ingestion_seq||0)-Number(b.ingestion_seq||0));
      if(data.read_through_message_id)waReadThroughMessageId=data.read_through_message_id;
      renderWhatsAppChat(!atBottom);
      if(incoming&&typeof markWhatsAppConversationRead==='function')markWhatsAppConversationRead();
    }catch(_){/* next tick retries */}
    finally{polling=false;}
  }

  // ---------- Wiring ----------
  const baseRender=window.renderWhatsAppChat;
  if(typeof baseRender==='function')window.renderWhatsAppChat=function(preserveScroll){
    const result=baseRender.apply(this,arguments);
    try{installComposer();renderBody(preserveScroll);
      // The old request/alert strip is gone: the reply agent links requests and properties itself.
      const strip=$('waClientStrip');if(strip)strip.style.display='none';
      const head=$('waChatHeader'),c=waInboxActiveConversation;
      if(head&&c&&!head.querySelector('.wa2-avatar')){const name=(c.client&&c.client.name)||c.customer_name||c.customer_phone||'؟';head.insertAdjacentHTML('afterbegin','<span class="wa2-avatar" aria-hidden="true">'+esc(String(name).trim().charAt(0)||'؟')+'</span>');}
      // 11 Nov 2026 (Ahmed): inside the CRM chat, one tap opens the same chat in the phone's WhatsApp (crm-wa-buttons.js)
      if(head&&c&&typeof window.crmWaPhoneLink==='function'){const old=head.querySelector('.crm-wa-phone'),l=window.crmWaPhoneLink(c.customer_phone||c.customer_wa_id||(c.client&&(c.client.phone_normalized||c.client.phone)));
        if(old&&old.dataset.for!==c.id)old.remove();
        if(l&&!head.querySelector('.crm-wa-phone'))head.insertAdjacentHTML('beforeend','<a class="crm-wa-btn crm-wa-phone" data-for="'+esc(c.id)+'" href="'+esc(l)+'"'+(/^https:/.test(l)?' target="_blank"':'')+' rel="noopener noreferrer">فتح في واتساب الجوال</a>');}
      // R1/R3 (Ahmed 8 Nov, docs/agent-rules.md): a handed-over chat, or one the agent stays out of because Ahmed typed in it,
      // shows under the header with the button that hands it back to the agent (the old strip with «تمت المعالجة» is hidden).
      let hold=$('wa2Hold');
      const held=c&&(c.human_handoff_required||c._hold==='manual_reply'||c._hold==='muted'||c._hold==='negotiation');
      if(!held||!head){if(hold)hold.remove();}
      else{
        if(!hold){hold=document.createElement('div');hold.id='wa2Hold';head.insertAdjacentElement('afterend',hold);}
        const handoff=c.human_handoff_required||c._hold==='negotiation';
        const why=handoff?'⚠️ <strong>محولة لك:</strong> '+esc(c.handoff_reason||'تحتاج تدخلك')+' · العقل ساكن لين تخلص'
          :(c._hold==='muted'?'🤫 <strong>العقل مكتوم هنا:</strong> '+esc(c.agent_muted_reason||'')
          :'🤫 العقل ساكن هنا');
        hold.setAttribute('style','display:flex;gap:8px;justify-content:space-between;align-items:center;padding:3px 10px;margin:0 0 4px;border-radius:8px;font-size:11px;line-height:1.3;'+(handoff?'background:#FFF1F2;border:1px solid #FECDD3;color:#9F1239':'background:#FFFBEB;border:1px solid #FDE68A;color:#92400E'));
        hold.innerHTML='<span>'+why+'</span><button type="button" class="btn-secondary" style="padding:2px 8px;font-size:11px;white-space:nowrap;min-height:0" title="رديت بنفسك، فالرد الآلي والمتابعات ما يرسلون لين ترجّعها" data-wa2-handback>'+(handoff?'✓ تمت المعالجة':'↩️ رجّعها للعقل')+'</button>';
      }
    }catch(e){console.warn('[wa2]',e);}
    return result;
  };
  const baseOpen=window.openWhatsAppConversation;
  if(typeof baseOpen==='function')window.openWhatsAppConversation=async function(id){
    const fresh=id!==waInboxActiveId;
    if(fresh){for(const item of media.values())URL.revokeObjectURL(item.url);media.clear();setReply(null);clearPending();}
    const result=await baseOpen.apply(this,arguments);
    // Phones (10 Nov 2026): the chat sits under the conversation list, so a chat just opened was below the screen.
    // Only a newly chosen chat scrolls; a refresh after sending does not.
    try{if(fresh&&window.matchMedia&&matchMedia('(max-width:900px)').matches){const p=document.querySelector('#page-whatsapp .wa-chat-panel');if(p&&p.getBoundingClientRect().top>innerHeight*0.4)p.scrollIntoView({block:'start',behavior:'smooth'});}}catch(_){}
    return result;
  };
  document.addEventListener('click',e=>{
    const t=e.target;
    const load=t.closest('[data-wa2-load]');if(load){e.preventDefault();openMedia(load.dataset.wa2Load,load);return;}
    const r=t.closest('[data-wa2-reply]');if(r){setReply(waInboxMessages.find(m=>m.id===r.dataset.wa2Reply));return;}
    const c=t.closest('[data-wa2-copy]');if(c){const m=waInboxMessages.find(x=>x.id===c.dataset.wa2Copy);navigator.clipboard?.writeText(String(m?.body||m?.transcript||'')).then(()=>showToast('تم النسخ','success'));return;}
    const g=t.closest('[data-wa2-goto]');if(g){const row=document.querySelector('[data-wa2-row="'+CSS.escape(g.dataset.wa2Goto)+'"]');if(row){row.scrollIntoView({block:'center',behavior:'smooth'});row.classList.add('wa2-flash');setTimeout(()=>row.classList.remove('wa2-flash'),1600);}return;}
    const sb=t.closest('[data-wa2-strip]');if(sb){stripOpen=!stripOpen;const strip=$('waClientStrip');strip?.classList.toggle('collapsed',!stripOpen);sb.textContent=stripOpen?'إخفاء التفاصيل ▴':'تفاصيل الطلب والتنبيهات ▾';return;}
    if(t.closest('[data-wa2-handback]')){if(typeof clearWhatsAppHandoff==='function')clearWhatsAppHandoff();return;}
    if(t.closest('[data-wa2-cancel-reply]')){setReply(null);return;}
    if(t.closest('[data-wa2-cancel-file]')){clearPending();return;}
    const em=t.closest('[data-wa2-emoji]');if(em){const ta=$('waInboxMessage');if(ta){const s=ta.selectionStart??ta.value.length,en=ta.selectionEnd??s;ta.value=ta.value.slice(0,s)+em.dataset.wa2Emoji+ta.value.slice(en);ta.focus();ta.selectionStart=ta.selectionEnd=s+em.dataset.wa2Emoji.length;autoGrow();syncButtons();}return;}
    const z=t.closest('[data-wa2-zoom]');if(z){const item=media.get(z.dataset.wa2Zoom);if(item){const ov=document.createElement('div');ov.className='wa2-lightbox';ov.innerHTML='<img src="'+item.url+'" alt=""><button type="button" aria-label="إغلاق">✕</button>';ov.addEventListener('click',()=>ov.remove());document.body.append(ov);}return;}
    if(!t.closest('#wa2EmojiPanel,#wa2EmojiBtn')){const p=$('wa2EmojiPanel');if(p&&!p.hidden)p.hidden=true;}
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){document.querySelector('.wa2-lightbox')?.remove();}});
  pollTimer=setInterval(poll,12000);
  const reset=window.crmResetOperations;
  if(typeof reset==='function')window.crmResetOperations=function(){for(const item of media.values())URL.revokeObjectURL(item.url);media.clear();reply=null;clearPending();if(recorder){recAfterStop='discard';try{recorder.stop();}catch(_){}}return reset.apply(this,arguments);};
  window.crmWhatsAppChat={renderBody,setReply,loadMedia};
})();
