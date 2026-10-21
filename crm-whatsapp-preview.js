(function(){
 'use strict';
 const $=id=>document.getElementById(id),esc=v=>escapeHtml(String(v??''));
 let epoch=0,inventory=[],messages=[],busy=false,planner=null,ctx=null;
 const valid=()=>ctx&&ctx.epoch===epoch&&crmSessionCurrent(ctx.generation,ctx.user)&&isOwner();
 function reset(){epoch++;inventory=[];messages=[];busy=false;ctx=null;$('crmReplyPreview')?.remove();}
 function render(){
  const node=$('crmReplyTranscript');if(!node||!valid())return;
  node.innerHTML=messages.map(m=>'<div style="padding:10px 12px;margin:6px 0;border:1px solid var(--border,#dce5df);border-radius:10px"><strong>'+({customer:'عميل تجريبي',staff:'رد موظف · تجريبي',assistant:'رد مقترح · لم يُرسل'}[m.role])+'</strong><div style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(m.text)+'</div></div>').join('')||'<p>اكتب رسالة عميل لتجربة الرد. لا تُحفظ هذه المحادثة في ملفات العملاء.</p>';
 }
 async function open(){
  if(!isOwner()||!currentUser?.id)return;
  reset();ctx={epoch,generation:crmSessionGeneration,user:currentUser.id};const token=ctx;
  const modal=document.createElement('div');modal.id='crmReplyPreview';modal.className='modal-ov on ws-modal';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-labelledby','crmReplyTitle');
  modal.innerHTML='<div class="modal-box lg" style="width:min(700px,94vw);max-height:88vh;overflow-y:auto;font-family:inherit"><div class="modal-head"><h2 id="crmReplyTitle">تجربة مساعد واتساب</h2><button type="button" class="btn-secondary" data-reply-action="close">إغلاق</button></div><div style="padding:20px"><p class="ops-note">محاكاة نصية فقط — لا إرسال على واتساب، ولا إنشاء عميل أو طلب أو زيارة. الصور تُعالج في مسار واتساب، وليس في هذه النافذة.</p><label for="crmReplyBranch">الفرع</label><select id="crmReplyBranch" class="form-input"><option value="muscat">مسقط</option><option value="barka">بركاء</option></select><div id="crmReplyState" role="status">جاري تحميل العقارات المصرح بها…</div><div id="crmReplyTranscript" aria-live="polite"></div><label for="crmReplyRole">نوع الرسالة التجريبية</label><select id="crmReplyRole" class="form-input"><option value="customer">رسالة العميل</option><option value="staff">رد الموظف — تفاصيل أو موقع العقار</option></select><label for="crmReplyText">الرسالة</label><textarea id="crmReplyText" class="form-input" rows="3" maxlength="6000" placeholder="مثال: هلا، أرسل لي التفاصيل"></textarea><div class="ws-actions" style="margin-top:12px"><button type="button" class="btn-primary" data-reply-action="submit" disabled>تجربة الرسالة</button><button type="button" class="btn-secondary" data-reply-action="reset">محادثة جديدة</button></div></div></div>';
  document.body.append(modal);
  try{
   const [module,rows,links]=await Promise.all([
    import('./supabase/functions/_shared/whatsapp-reply-preview.mjs?v=20261021-client-v17'),
    crmReadAll(()=>crmDataFrom('properties').select('id,title,type,area,price,bedrooms,bathrooms,land_size,built_size,status,archived,branch_key,public_details,map_url,property_code',{count:'exact'}).eq('archived',false).order('id')),
    crmReadAll(()=>supa.from('property_marketing_events').select('property_id,url',{count:'exact'}).order('id'))
   ]);
   if(ctx!==token||!valid())return;
   planner=module.previewReply;inventory=rows.map(p=>({...p,marketing_urls:links.filter(l=>l.property_id===p.id).map(l=>l.url)}));
   $('crmReplyState').textContent='جاهز للتجربة · الطلب لم يتحدد بعد';modal.querySelector('[data-reply-action="submit"]').disabled=false;render();$('crmReplyText').focus();
  }catch(error){if(ctx!==token||!valid())return;console.warn('reply_preview_load_failed',error);$('crmReplyState').textContent='تعذر تحميل بيانات التجربة. أغلق النافذة وأعد فتحها؛ لم تُرسل أي رسالة.';}
 }
 function submit(){
  if(!valid()||busy||!planner)return;
  const text=$('crmReplyText').value.trim();if(!text)return;
  busy=true;
  try{
   messages.push({role:$('crmReplyRole').value,text});
   const result=planner(messages,inventory,$('crmReplyBranch').value);
   if(result.reply)messages.push({role:'assistant',text:result.reply});
   $('crmReplyState').textContent=({unknown:'الطلب لم يتحدد بعد',search:'البحث: '+(result.state.area||'منطقة غير محددة')+' · '+(result.state.budget?Number(result.state.budget).toLocaleString('en-US')+' ر.ع':'الميزانية لم تُحدد'),specific_property:'عقار محدد في التجربة',seller:'طلب بيع — يحتاج بيانات المالك'}[result.state.request]||'تجربة')+(result.state.visit_interest?' · اهتمام بالمعاينة — لا يوجد موعد مؤكد':'');
   $('crmReplyText').value='';render();
  }catch(error){console.warn('reply_preview_failed',error);$('crmReplyState').textContent='تعذر إعداد الرد التجريبي؛ لم تُرسل أي رسالة.';messages.pop();}finally{busy=false;}
 }
 function install(){
  const page=$('page-whatsapp');if(!page)return;
  const actions=page.querySelector('.page-header');if(actions&&!$('crmReplyPreviewOpen')){const b=document.createElement('button');b.id='crmReplyPreviewOpen';b.className='btn-secondary';b.type='button';b.textContent='تجربة الردود';b.hidden=true;b.addEventListener('click',open);actions.append(b);}
  const sync=()=>{const b=$('crmReplyPreviewOpen');if(b)b.hidden=!(typeof isOwner==='function'&&isOwner());};
  const oldNavigate=window.navigate;window.navigate=function(){const r=oldNavigate.apply(this,arguments);sync();return r;};sync();
  const oldReset=window.crmResetOperations;window.crmResetOperations=function(){reset();const r=oldReset?.apply(this,arguments);const b=$('crmReplyPreviewOpen');if(b)b.hidden=true;return r;};
  document.addEventListener('click',e=>{const b=e.target.closest('[data-reply-action]');if(!b)return;const a=b.dataset.replyAction;if(a==='close')reset();if(a==='submit')submit();if(a==='reset'&&valid()){messages=[];$('crmReplyText').value='';$('crmReplyState').textContent='الطلب لم يتحدد بعد';render();}});
  document.addEventListener('change',e=>{if(e.target.id==='crmReplyBranch'&&valid()){messages=[];$('crmReplyState').textContent='الطلب لم يتحدد بعد';render();}});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('crmReplyPreview')){e.preventDefault();reset();}});
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})();
