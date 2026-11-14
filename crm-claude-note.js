/* "ملاحظة لـ Claude" (4 Nov 2026): a correction written next to the conversation or the proposed reply one is
 * looking at. It is saved in crm_owner_notes with the conversation, the draft / outreach row and the last messages,
 * so Claude can open exactly that case later and fix the reply or the rules.
 * R58 (14 Nov 2026, Ahmed: «الموظفين أريدهم نفس الشيء… ضيفه في كل مكان عندهم، نفس اللي عندي بالضبط»): the button is
 * for the owner and the staff (manager, agent), and it sits beside the two WhatsApp buttons everywhere (crm-wa-buttons.js
 * asks crmClaudeNoteBtn for it), in the daily follow-ups and in the client file. A staff note becomes a lesson at once
 * like the owner's (Ahmed: «على طول مثل R28»); SQL103 lets staff save and marks the note with who wrote it
 * (context.by_staff, by_role, by_name), whatever the browser sends. */
(function(){
  'use strict';
  const byId=id=>document.getElementById(id);
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
  const digits=v=>String(v||'').replace(/\D/g,'');
  const canNote=()=>typeof currentProfile!=='undefined'&&currentProfile&&['owner','manager','agent'].includes(currentProfile.role)&&currentProfile.is_active!==false;
  const toast=(m,t)=>{if(typeof showToast==='function')showToast(m,t);};
  const FULL='ملاحظة لـ Claude';
  function dialog(ctx){
    let d=byId('cnDialog');
    if(!d){
      d=document.createElement('dialog');d.id='cnDialog';d.className='cn-dialog';
      d.innerHTML='<form method="dialog"><h3>ملاحظة لـ Claude</h3><p class="cn-ctx" id="cnCtx"></p>'
        +'<textarea id="cnText" rows="5" dir="auto" placeholder="مثلاً: الرد غلط لأن العميل يقصد الحيل مو الموالح، المفروض يسأله اي فيلا"></textarea>'
        +'<label class="cn-apply"><input type="checkbox" id="cnApply" checked> العقل يطبقها على الردود الجاية على طول</label>'
        +'<div class="cn-actions"><button type="button" class="btn-primary" id="cnSave">إرسال</button><button type="button" class="btn-secondary" id="cnCancel">إلغاء</button></div></form>';
      document.body.append(d);
      byId('cnCancel').onclick=()=>d.close();
      byId('cnSave').onclick=async()=>{
        const note=byId('cnText').value.trim();if(!note){byId('cnText').focus();return;}
        const c=d._ctx||{},btn=byId('cnSave');btn.disabled=true;
        const context=Object.assign({},c.context||{},{by_staff:currentProfile.role!=='owner'});
        const r=await supa.from('crm_owner_notes').insert({company_id:currentProfile.company_id,conversation_id:c.conversation_id||null,draft_id:c.draft_id||null,outreach_id:c.outreach_id||null,note,apply_now:byId('cnApply').checked,context});
        btn.disabled=false;
        if(r.error){toast('تعذر الحفظ: '+r.error.message,'error');return;}
        d.close();toast(byId('cnApply').checked?'وصلت الملاحظة، والعقل بيطبقها من الرد الجاي':'وصلت الملاحظة','success');
      };
    }
    d._ctx=ctx;byId('cnText').value='';byId('cnApply').checked=true;byId('cnCtx').textContent=ctx.label||'';
    d.showModal();setTimeout(()=>byId('cnText').focus(),50);
  }
  window.crmClaudeNote=dialog;
  // The button beside the two WhatsApp buttons: it carries what the place knows (chat, client or number) and the chat is
  // looked up when pressed, among the chats this account may see. small = narrow cards and table rows («ملاحظة»).
  window.crmClaudeNoteBtn=function(o){
    o=o||{};if(!canNote())return '';
    const conv=o.conv||'',client=o.client||'',phone=digits(o.phone);
    if(!conv&&!client&&!phone)return '';
    const cls='crm-wa-btn crm-wa-note'+(o.small?' crm-wa-sm':'')+String(o.cls||'').split(/\s+/).filter(Boolean).map(c=>' '+esc(c)).join('');
    return '<button type="button" class="'+cls+'" data-cn-any="1" data-conv="'+esc(conv)+'" data-client="'+esc(client)+'" data-phone="'+esc(phone)+'" data-name="'+esc(o.name||'')+'"'
      +(o.small?' title="'+FULL+'" aria-label="'+FULL+'">ملاحظة':'>'+FULL)+'</button>';
  };
  async function openFor(b){
    const conv=b.dataset.conv||'',client=b.dataset.client||'',phone=b.dataset.phone||'';let chat=null;
    if(typeof supa!=='undefined'){
      let q=supa.from('whatsapp_conversations').select('id,customer_name,customer_phone,client_id');
      if(conv)q=q.eq('id',conv);
      else q=(client?q.eq('client_id',client):q.eq('customer_wa_id',phone)).order('last_message_at',{ascending:false,nullsFirst:false}).limit(1);
      const r=await q.maybeSingle();chat=r.data||null;
    }
    const row=b.closest('li,tr,.rp-card,.deal-card,article'),place=b.closest('[id]');
    const name=b.dataset.name||(chat&&(chat.customer_name||chat.customer_phone))||'';
    dialog({conversation_id:chat?chat.id:null,label:(chat?'على محادثة ':'على ')+(name||'العميل'),
      context:{source:'button',place:place?place.id:null,client_id:client||(chat&&chat.client_id)||null,phone:phone||(chat&&chat.customer_phone)||null,
        near_text:row?String(row.innerText||'').replace(/\s+/g,' ').trim().slice(0,600):null}});
  }
  // a button on every card in "ردود تنتظر موافقتك": it knows the draft, so the plain one from the WhatsApp pair goes
  function decorateCards(){
    if(!canNote())return;
    document.querySelectorAll('#page-replies .rp-card:not(.ol-card)').forEach(card=>{
      const actions=card.querySelector('.rp-actions');if(!actions)return;
      card.querySelectorAll('[data-cn-any]').forEach(x=>x.remove());
      if(actions.querySelector('[data-cn]'))return;
      const b=document.createElement('button');b.type='button';b.className='btn-secondary';b.dataset.cn='1';b.textContent=FULL;
      actions.append(b);
    });
  }
  // and one in the open WhatsApp conversation
  function decorateChat(){
    if(!canNote())return;
    const head=document.querySelector('#page-whatsapp .wa-chat-head, #page-whatsapp .wa-chat-header, #waChatHeader');
    if(!head||head.querySelector('[data-cn-chat]'))return;
    const b=document.createElement('button');b.type='button';b.className='btn-secondary cn-chat-btn';b.dataset.cnChat='1';b.textContent=FULL;
    head.append(b);
  }
  // the client file: beside «فتح في النظام»
  function decorateClientFile(){
    if(!canNote()||typeof viewingClient==='undefined'||!viewingClient)return;
    const box=byId('cdActions'),crm=box&&box.querySelector('.crm-wa-crm');if(!crm)return;
    const old=box.querySelector('[data-cn-any]');
    if(old){if(old.dataset.client===String(viewingClient.id))return;old.remove();}
    crm.insertAdjacentHTML('afterend',window.crmClaudeNoteBtn({client:viewingClient.id,name:viewingClient.name}));
  }
  document.addEventListener('click',e=>{
    const cb=e.target.closest('[data-cn]');
    if(cb){const card=cb.closest('.rp-card');const name=(card.querySelector('header strong')||{}).textContent||'';
      dialog({draft_id:card.dataset.draft||null,outreach_id:card.dataset.out||null,conversation_id:card.dataset.conv||null,
        label:'على '+(card.dataset.draft?'الرد المقترح':'الرسالة')+' لـ '+name,context:{card_text:card.innerText.slice(0,1500)}});return;}
    const ch=e.target.closest('[data-cn-chat]');
    if(ch&&typeof waInboxActiveId!=='undefined'&&waInboxActiveId){
      const c=(typeof waInboxActiveConversation!=='undefined'&&waInboxActiveConversation)||{};
      dialog({conversation_id:waInboxActiveId,label:'على محادثة '+(c.customer_name||c.customer_phone||''),context:{customer:c.customer_name||null,phone:c.customer_phone||null}});}
  });
  // in the capture phase: a card or a table row that opens on a click (deal cards stop the click before it reaches the
  // document) must neither swallow this button nor open under it
  document.addEventListener('click',e=>{
    const b=e.target&&e.target.closest&&e.target.closest('[data-cn-any]');if(!b)return;
    e.preventDefault();e.stopPropagation();
    b.disabled=true;openFor(b).catch(()=>toast('ما قدرت أفتح الملاحظة','error')).then(()=>{b.disabled=false;});
  },true);
  new MutationObserver(()=>{decorateCards();decorateChat();decorateClientFile();}).observe(document.body,{childList:true,subtree:true});
})();
