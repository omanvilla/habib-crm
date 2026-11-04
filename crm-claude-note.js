/* "ملاحظة لـ Claude" (4 Nov 2026): the owner writes a correction next to the conversation or the proposed
 * reply he is looking at. It is saved in crm_owner_notes with the conversation, the draft / outreach row and
 * the last messages, so Claude can open exactly that case later and fix the reply or the rules. Owner only. */
(function(){
  'use strict';
  const byId=id=>document.getElementById(id);
  const isOwner=()=>typeof currentProfile!=='undefined'&&currentProfile&&currentProfile.role==='owner';
  const toast=(m,t)=>{if(typeof showToast==='function')showToast(m,t);};
  function dialog(ctx){
    let d=byId('cnDialog');
    if(!d){
      d=document.createElement('dialog');d.id='cnDialog';d.className='cn-dialog';
      d.innerHTML='<form method="dialog"><h3>ملاحظة لـ Claude</h3><p class="cn-ctx" id="cnCtx"></p>'
        +'<textarea id="cnText" rows="5" dir="auto" placeholder="مثلاً: الرد غلط لأن العميل يقصد الحيل مو الموالح، المفروض يسأله اي فيلا"></textarea>'
        +'<div class="cn-actions"><button type="button" class="btn-primary" id="cnSave">إرسال</button><button type="button" class="btn-secondary" id="cnCancel">إلغاء</button></div></form>';
      document.body.append(d);
      byId('cnCancel').onclick=()=>d.close();
      byId('cnSave').onclick=async()=>{
        const note=byId('cnText').value.trim();if(!note){byId('cnText').focus();return;}
        const c=d._ctx||{},btn=byId('cnSave');btn.disabled=true;
        const r=await supa.from('crm_owner_notes').insert({company_id:currentProfile.company_id,conversation_id:c.conversation_id||null,draft_id:c.draft_id||null,outreach_id:c.outreach_id||null,note,context:c.context||{}});
        btn.disabled=false;
        if(r.error){toast('تعذر الحفظ: '+r.error.message,'error');return;}
        d.close();toast('وصلت الملاحظة. قل لـ Claude: شوف الملاحظات','success');
      };
    }
    d._ctx=ctx;byId('cnText').value='';byId('cnCtx').textContent=ctx.label||'';
    d.showModal();setTimeout(()=>byId('cnText').focus(),50);
  }
  window.crmClaudeNote=dialog;
  // a button on every card in "ردود تنتظر موافقتك"
  function decorateCards(){
    if(!isOwner())return;
    document.querySelectorAll('#page-replies .rp-card').forEach(card=>{
      const actions=card.querySelector('.rp-actions');if(!actions||actions.querySelector('[data-cn]'))return;
      const b=document.createElement('button');b.type='button';b.className='btn-secondary';b.dataset.cn='1';b.textContent='ملاحظة لـ Claude';
      actions.append(b);
    });
  }
  // and one in the open WhatsApp conversation
  function decorateChat(){
    if(!isOwner())return;
    const head=document.querySelector('#page-whatsapp .wa-chat-head, #page-whatsapp .wa-chat-header, #waChatHeader');
    if(!head||head.querySelector('[data-cn-chat]'))return;
    const b=document.createElement('button');b.type='button';b.className='btn-secondary cn-chat-btn';b.dataset.cnChat='1';b.textContent='ملاحظة لـ Claude';
    head.append(b);
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
  new MutationObserver(()=>{decorateCards();decorateChat();}).observe(document.body,{childList:true,subtree:true});
})();
