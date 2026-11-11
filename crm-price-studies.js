/* Price studies waiting for Ahmed's approval (SQL94, 11 Nov 2026). Claude (pricing projects) hands each study in through
 * crm_price_study_submit; this screen is the only place it is decided. Owner only: the list comes from
 * crm_price_studies_pending (owner-only RPC), the two reports open through short signed links from the private bucket
 * «price-studies» (owner-only storage policy), and owner net, commission and the internal report never go to the owner of the
 * property or to staff. «موافق» sends the message and the owner report from the chat's branch number (price-study edge
 * function); «رفض مع ملاحظة» returns the task to Claude with the note. A WhatsApp alert links here with ?study=<id>.
 * The home page shows the tile and the sheet (crm-owner-home.js asks this file for the count and the list). */
(function(){
  'use strict';
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
  const num=v=>v==null||v===''?'—':Number(v).toLocaleString('en-US');
  const isOwner=()=>typeof currentProfile!=='undefined'&&currentProfile&&currentProfile.role==='owner';
  const toast=(m,t)=>{if(typeof showToast==='function')showToast(m,t);};
  const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ROUTE={barka:'بركاء',muscat:'مسقط'};
  const when=v=>{try{return new Date(v).toLocaleString('ar-OM-u-nu-latn',{timeZone:'Asia/Muscat',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});}catch(_){return '';}};
  let data={items:[],send_mode:'test'},sequence=0,focusId=null;
  const waiting=()=>data.items.filter(i=>i.status==='awaiting_approval');
  const HOLD={test_mode_hold:'وافقت عليها. الإرسال للملاك في وضع التجربة، فما انرسلت. تنرسل لما يتفعّل الإرسال وتضغط «ارسل الحين»',
    sending_off:'وافقت عليها، والإرسال للملاك موقف',
    template_not_approved:'موافقتك انحفظت، بس ما انرسلت للحين: آخر رسالة من المالك أقدم من 24 ساعة، وقالب «دراسة سعر عقارك جاهزة» ما اعتمدته Meta. تنرسل لحالها أول ما يكتب المالك أو يعتمد القالب، وما تحتاج تضغط مرة ثانية',
    owner_said_no_to_the_template:'المالك رد «لا» على رسالة «دراسة سعر عقارك جاهزة»، فما انرسلت له'};
  const REACTION={accepted:'المالك وافق على السعر',price_rejected:'السعر ما ناسب المالك',counter_offer:'المالك طلب سعر ثاني'};

  async function refresh(){
    if(!isOwner()||typeof supa==='undefined'){data={items:[],send_mode:'test'};return 0;}
    const seq=++sequence;
    const r=await supa.rpc('crm_price_studies_pending');
    if(seq!==sequence)return waiting().length;
    if(!r.error&&r.data&&Array.isArray(r.data.items))data=r.data;
    document.dispatchEvent(new CustomEvent('crm-price-studies-updated'));
    return waiting().length;
  }
  function statusLine(i){
    if(i.status==='awaiting_approval')return '<span class="cps-chip wait">تنتظر موافقتك</span>';
    if(i.status==='approved')return '<span class="cps-chip hold">موافق عليها، ما انرسلت</span>';
    if(i.status==='sending')return '<span class="cps-chip">جاري الإرسال للمالك…</span>';
    if(i.status==='waiting_owner')return '<span class="cps-chip">انرسلت له «دراسة سعر عقارك جاهزة»، وتنرسل الدراسة أول ما يرد</span>';
    if(i.status==='send_failed')return '<span class="cps-chip bad">ما انرسلت</span>';
    if(i.status==='sent')return '<span class="cps-chip ok">انرسلت للمالك '+esc(when(i.sent_at))+'</span>';
    if(i.status==='rejected')return '<span class="cps-chip">رجعت لـ Claude بملاحظتك</span>';
    return '';
  }
  function card(i){
    const id=esc(i.id),open=i.status==='awaiting_approval',retry=i.status==='approved'||i.status==='send_failed';
    const place=[i.area,i.wilayat].filter(Boolean).join(' ، ');
    const facts=[i.property_kind,place,i.land_size?'أرض '+num(i.land_size)+' م²':'',i.built_size?'بناء '+num(i.built_size)+' م²':'',i.plot_no?'قطعة '+esc(i.plot_no):''].filter(Boolean).join(' · ');
    const cell=(l,v,priv)=>'<div class="cps-num'+(priv?' priv':'')+'"><strong dir="ltr">'+num(v)+'</strong><small>'+esc(l)+'</small></div>';
    const note=i.status==='send_failed'?(HOLD[i.send_error]||('السبب: '+(i.send_error||'غير معروف')))
      :i.status==='approved'?(HOLD[i.send_error]||'وافقت عليها والإرسال في الطريق')
      :i.status==='rejected'?('ملاحظتك: '+(i.reject_note||''))
      :i.status==='sent'&&i.owner_reaction?(REACTION[i.owner_reaction]+(i.owner_reaction_note?': «'+i.owner_reaction_note+'»':'')):'';
    return '<li class="cps-card'+(focusId===i.id?' focus':'')+'" data-cps-card="'+id+'">'
      +'<div class="cps-head"><strong>'+esc(i.owner_name||'مالك')+' <small>'+esc(ROUTE[i.route_key]||'')+(i.version>1?' · نسخة '+esc(i.version):'')+'</small></strong>'+statusLine(i)+'</div>'
      +(facts?'<small class="cps-facts">'+esc(facts)+'</small>':'')
      +'<small class="cps-facts">السعر اللي في بال المالك: <b dir="ltr">'+num(i.owner_price)+'</b></small>'
      +(note?'<p class="cps-note">'+esc(note)+'</p>':'')
      +'<div class="cps-nums">'+cell('القيمة السوقية',i.market_value)+cell('سعر العرض',i.asking_price)+cell('هامش التفاوض',i.negotiation_margin)+'</div>'
      +'<p class="cps-private">لك فقط، ما يوصل للمالك ولا يشوفه الموظف</p>'
      +'<div class="cps-nums">'+cell('صافي المالك',i.owner_net,true)+cell('العمولة',i.commission,true)+'</div>'
      +'<div class="cps-files"><button type="button" class="btn-secondary" data-cps="file" data-path="'+esc(i.owner_report_path||'')+'">تقرير المالك PDF</button>'
      +'<button type="button" class="btn-secondary" data-cps="file" data-path="'+esc(i.internal_report_path||'')+'">التقرير الداخلي PDF</button>'
      +(typeof window.crmWaButtons==='function'?window.crmWaButtons({phone:i.phone,conversationId:i.conversation_id,clientId:i.client_id,cls:'btn-secondary'}):'')+'</div>'
      +'<label class="cps-label">الرسالة اللي توصل المالك'+(open?' (تقدر تعدلها)':'')
      +'<textarea class="fi" rows="6" dir="auto" data-cps-msg="'+id+'"'+(open?'':' readonly')+'>'+esc(i.owner_message||'')+'</textarea></label>'
      +(open?'<div class="cps-actions"><button type="button" class="btn-primary" data-cps="approve" data-id="'+id+'">موافق</button>'
        +'<button type="button" class="btn-secondary" data-cps="reject" data-id="'+id+'">رفض مع ملاحظة</button></div>'
        +'<div class="cps-reject" data-cps-reject="'+id+'" hidden><textarea class="fi" rows="3" dir="auto" data-cps-note="'+id+'" placeholder="اكتب ملاحظتك لـ Claude: وش يعدل في الدراسة"></textarea>'
        +'<button type="button" class="btn-primary" data-cps="reject-send" data-id="'+id+'">رجّعها لـ Claude</button></div>':'')
      +(retry?'<div class="cps-actions"><button type="button" class="btn-primary" data-cps="approve" data-id="'+id+'">ارسل الحين</button>'
        +'<button type="button" class="btn-secondary" data-cps="reject" data-id="'+id+'">رفض مع ملاحظة</button></div>'
        +'<div class="cps-reject" data-cps-reject="'+id+'" hidden><textarea class="fi" rows="3" dir="auto" data-cps-note="'+id+'" placeholder="اكتب ملاحظتك لـ Claude: وش يعدل في الدراسة"></textarea>'
        +'<button type="button" class="btn-primary" data-cps="reject-send" data-id="'+id+'">رجّعها لـ Claude</button></div>':'')
      +'</li>';
  }
  function html(){
    if(!data.items.length)return '<p class="coh-empty">ما في دراسات تنتظر موافقتك الحين</p>';
    const mode=data.send_mode==='live'?'':'<p class="cps-mode">'+(data.send_mode==='off'?'الإرسال للملاك موقف. الموافقة تنحفظ وما ينرسل شي'
      :'وضع التجربة: الموافقة تنحفظ، والإرسال يوصل رقمك التجريبي بس. الملاك ما يوصلهم شي لين يتفعّل الإرسال')+'</p>';
    return mode+'<p class="coh-since">راجع الأرقام والتقريرين. «موافق» يرسل الرسالة وتقرير المالك من رقم الفرع ويقفل المهمة. ما ينرسل شي قبل موافقتك</p>'
      +'<ul class="coh-list cps-list">'+data.items.map(card).join('')+'</ul>';
  }
  function redraw(){
    const body=document.getElementById('cohSheetBody');
    if(body&&body.dataset.cps==='1')body.innerHTML=html();
  }
  // a signed link that lasts ten minutes; the tab is opened at once so phones do not block it as a pop-up
  async function openFile(path){
    if(!path){toast('الملف ما انحفظ','error');return;}
    const w=window.open('about:blank','_blank');
    const r=await supa.storage.from('price-studies').createSignedUrl(path,600);
    const url=r&&r.data&&r.data.signedUrl;
    if(!url){if(w)w.close();toast('ما قدرت أفتح الملف. جرب مرة ثانية','error');return;}
    if(w)w.location.href=url;else location.href=url;
  }
  async function decide(b,approve){
    const id=b.dataset.id,item=data.items.find(i=>i.id===id);if(!item||b.disabled)return;
    const msg=document.querySelector('[data-cps-msg="'+CSS.escape(id)+'"]'),note=document.querySelector('[data-cps-note="'+CSS.escape(id)+'"]');
    const args={p_study_id:id,p_approve:approve,p_note:null,p_owner_message:null};
    if(approve){
      const text=String(msg&&msg.value||'').trim();
      if(item.status==='awaiting_approval'&&text&&text!==String(item.owner_message||'').trim())args.p_owner_message=text;
    }else{
      args.p_note=String(note&&note.value||'').trim();
      if(args.p_note.length<3){toast('اكتب ملاحظتك لـ Claude أول','error');if(note)note.focus();return;}
    }
    b.disabled=true;const old=b.textContent;b.textContent='لحظة…';
    const r=await supa.rpc('crm_price_study_decide',args);
    if(r.error){b.disabled=false;b.textContent=old;toast('ما انحفظ: '+(r.error.message||''),'error');return;}
    toast(approve?'موافقتك انحفظت. لحظة أتأكد من الإرسال…':'رجعت لـ Claude مع ملاحظتك','success');
    item.status=approve?'approved':'rejected';if(!approve)item.reject_note=args.p_note;if(approve)item.send_error=null;
    redraw();document.dispatchEvent(new CustomEvent('crm-price-studies-updated'));
    // the send runs in the background: read where it ended
    // SQL95 (Ahmed's test, 11 Nov): he pressed «موافق» three times because nothing said the send was held. Say why, once.
    if(approve){
      const tell=()=>{const now=data.items.find(i=>i.id===id);
        if(now&&now.status==='approved'&&now.send_error)toast(HOLD[now.send_error]||('ما انرسلت: '+now.send_error),'error');
        else if(now&&now.status==='send_failed')toast('ما انرسلت: '+(HOLD[now.send_error]||now.send_error||''),'error');
        else if(now&&now.status==='sent')toast('انرسلت الدراسة للمالك ✓','success');
        else if(now&&now.status==='waiting_owner')toast('انرسل له «دراسة سعر عقارك جاهزة»، والدراسة تنرسل أول ما يرد','success');};
      setTimeout(()=>refresh().then(()=>{redraw();tell();}),6000);setTimeout(()=>refresh().then(redraw),20000);
    }
  }
  document.addEventListener('click',e=>{
    const b=e.target.closest&&e.target.closest('[data-cps]');if(!b)return;
    const act=b.dataset.cps;
    if(act==='file')openFile(b.dataset.path).catch(()=>toast('ما قدرت أفتح الملف','error'));
    else if(act==='approve')decide(b,true).catch(()=>{b.disabled=false;toast('ما انحفظ. جرب مرة ثانية','error');});
    else if(act==='reject'){const f=document.querySelector('[data-cps-reject="'+CSS.escape(b.dataset.id)+'"]');if(f){f.hidden=!f.hidden;if(!f.hidden){const t=f.querySelector('textarea');if(t)t.focus();}}}
    else if(act==='reject-send')decide(b,false).catch(()=>{b.disabled=false;toast('ما انحفظ. جرب مرة ثانية','error');});
  });
  document.addEventListener('crm-price-studies-updated',()=>{const body=document.getElementById('cohSheetBody');if(body&&body.dataset.cps==='1'&&!body.querySelector('textarea:focus'))body.innerHTML=html();});

  window.crmPriceStudiesCount=()=>isOwner()?waiting().length:0;
  window.crmPriceStudiesRefresh=refresh;
  window.crmPriceStudiesHtml=()=>{const body=document.getElementById('cohSheetBody');if(body)body.dataset.cps='1';return html();};
  window.crmPriceStudiesLeave=()=>{const body=document.getElementById('cohSheetBody');if(body)delete body.dataset.cps;};

  // Deep link from the WhatsApp alert: ?study=<id> opens the list on that study once the owner is signed in.
  (function(){
    const KEY='crm_open_study';let id=null;
    try{const q=new URLSearchParams(location.search);id=q.get('study');
      if(id&&ID.test(id)){sessionStorage.setItem(KEY,id);q.delete('study');history.replaceState(null,'',location.pathname+(q.toString()?'?'+q.toString():'')+location.hash);}
      else id=sessionStorage.getItem(KEY);}catch(_){}
    if(!id||!ID.test(id))return;
    let tries=0;const timer=setInterval(()=>{
      tries++;
      const ready=typeof currentProfile!=='undefined'&&currentProfile&&currentProfile.company_id;
      if(ready&&typeof window.crmOwnerHomeOpenSheet==='function'){
        clearInterval(timer);try{sessionStorage.removeItem(KEY);}catch(_){}
        if(!isOwner())return;
        focusId=id;
        refresh().then(()=>{window.crmOwnerHomeOpenSheet('studies');const c=document.querySelector('[data-cps-card="'+CSS.escape(id)+'"]');if(c&&c.scrollIntoView)c.scrollIntoView({block:'start'});});
      }else if(tries>1200)clearInterval(timer);
    },500);
  })();
})();
