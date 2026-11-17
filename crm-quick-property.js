/* Quick property (17 Nov 2026, Ahmed: «سوّ الإضافات كلها», after the full check). The full property form has 29 fields, so
 * new stock is entered late or not at all, and the company target is 25 good available properties by 12 Feb 2027. This sheet
 * asks only: branch, type, sale/rent, wilayat, area, price, the owner's name and phone, who he is (owner or broker) and a
 * note or link. It finds the owner by the last 8 digits of the phone (or adds him), then saves the property through the same
 * table and guards as the full form (branch guard, source guard: staff are recorded as the person who sourced it).
 * «＋ عقار» in the bottom bar and «+ إضافة عقار» on the properties page open it; «النموذج الكامل» opens the old form.
 * After a call to an owner who agreed, the call window offers «سجّل العقار» filled with his name and phone. */
(function(){
  'use strict';
  const byId=id=>document.getElementById(id);
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
  const toast=(m,t)=>{if(typeof showToast==='function')showToast(m,t);};
  const digits=v=>String(v||'').replace(/[٠-٩]/g,c=>'٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/\D/g,'');
  const last8=v=>digits(v).slice(-8);
  const canAdd=()=>typeof canEdit==='function'?canEdit():false;
  const BRANCHES=[['muscat','مسقط'],['barka','بركاء']];
  const PURPOSES=[['sale','للبيع'],['rent','للإيجار']];
  const SOURCES=[['owner','مالك مباشر'],['broker','وسيط']];
  const WILAYAT={muscat:['مسقط','السيب','بوشر','العامرات','مطرح','قريات'],barka:['بركاء','المصنعة','نخل','وادي المعاول']};
  let saving=false;
  function typeOptions(){
    const sel=byId('pType'),list=sel?[...sel.options].filter(o=>o.value).map(o=>[o.value,o.textContent.replace(/^[^\p{L}]+/u,'').trim()]):[];
    return list.length?list:[['villa','فيلا'],['house','منزل'],['apartment','شقة'],['land','أرض']];
  }
  function lastBranch(){try{return localStorage.getItem('crmQuickPropertyBranch')||'';}catch(_){return '';}}
  function chips(name,list,checked){
    return '<div class="ccm-chips" role="radiogroup">'+list.map(([v,l])=>'<label class="ccm-chip"><input type="radio" name="'+name+'" value="'+esc(v)+'"'+(checked===v?' checked':'')+'><span>'+esc(l)+'</span></label>').join('')+'</div>';
  }
  function dlg(){
    let d=byId('crmQuickPropDlg');
    if(!d){d=document.createElement('dialog');d.id='crmQuickPropDlg';d.className='ccm-dlg cqp-dlg';d.setAttribute('dir','rtl');document.body.appendChild(d);
      d.addEventListener('click',e=>{const b=e.target.closest('[data-cqp]');if(!b)return;const a=b.dataset.cqp;
        if(a==='close')d.close();else if(a==='save')save(b);else if(a==='full'){d.close();if(typeof openCreateModal==='function')openCreateModal('mProperty');}});
      d.addEventListener('change',e=>{if(e.target&&e.target.name==='cqpBranch')fillWilayat(e.target.value);});}
    return d;
  }
  function fillWilayat(branch){
    const dl=byId('cqpWilayatList');if(!dl)return;dl.innerHTML=(WILAYAT[branch]||[]).map(w=>'<option value="'+esc(w)+'">').join('');
    const w=byId('cqpWilayat');if(w&&!w.value&&WILAYAT[branch])w.value=WILAYAT[branch][0];
  }
  function open(prefill){
    if(!canAdd()){toast('ما عندك صلاحية تضيف عقار','error');return;}
    const p=prefill||{},d=dlg(),branch=p.branch||lastBranch()||'barka';
    d.innerHTML='<form method="dialog" class="ccm-form" autocomplete="off"><h3>عقار جديد <small>إضافة سريعة</small></h3>'
      +'<div class="ccm-q">الفرع</div>'+chips('cqpBranch',BRANCHES,branch)
      +'<label class="ccm-q" for="cqpType">النوع</label><select id="cqpType" class="fi">'+typeOptions().map(([v,l])=>'<option value="'+esc(v)+'">'+esc(l)+'</option>').join('')+'</select>'
      +'<div class="ccm-q">الغرض</div>'+chips('cqpPurpose',PURPOSES,'sale')
      +'<div class="ccm-row"><label>الولاية<input id="cqpWilayat" class="fi" list="cqpWilayatList" dir="auto" maxlength="40"></label>'
      +'<label>المنطقة<input id="cqpArea" class="fi" dir="auto" maxlength="80" placeholder="مثلاً: الصومحان"></label></div><datalist id="cqpWilayatList"></datalist>'
      +'<label class="ccm-q" for="cqpPrice">السعر (ر.ع)</label><input id="cqpPrice" class="fi" type="text" inputmode="decimal" dir="ltr" maxlength="12">'
      +'<div class="ccm-row"><label>اسم المالك<input id="cqpOwner" class="fi" dir="auto" maxlength="80" value="'+esc(p.name||'')+'"></label>'
      +'<label>جواله<input id="cqpPhone" class="fi" type="tel" inputmode="tel" dir="ltr" maxlength="20" placeholder="9XXXXXXX" value="'+esc(p.phone||'')+'"></label></div>'
      +'<div class="ccm-q">هو</div>'+chips('cqpSource',SOURCES,p.source||'owner')
      +'<label class="ccm-q" for="cqpNote">ملاحظة أو رابط (اختياري)</label><input id="cqpNote" class="fi" dir="auto" maxlength="500">'
      +'<div class="ccm-err" role="alert"></div>'
      +'<div class="ccm-actions"><button type="button" class="btn-primary" data-cqp="save">حفظ العقار</button><button type="button" class="btn-secondary" data-cqp="close">إلغاء</button></div>'
      +'<button type="button" class="coh-add cqp-full" data-cqp="full">النموذج الكامل (كل التفاصيل)</button></form>';
    fillWilayat(branch);
    if(!d.open)d.showModal();
    const first=byId(p.phone?'cqpArea':'cqpType');if(first)first.focus();
  }
  async function findOrAddOwner(cid,name,phone,type){
    const want=last8(phone);
    const pool=(typeof allOwners!=='undefined'&&Array.isArray(allOwners)&&allOwners.length)?allOwners:null;
    let found=pool?pool.find(o=>last8(o.phone)===want):null;
    if(!found){
      const r=await supa.from('owners').select('id,name,phone,owner_type').eq('company_id',cid).eq('archived',false).like('phone','%'+want.slice(-4));
      if(r.error)throw r.error;found=(r.data||[]).find(o=>last8(o.phone)===want)||null;
    }
    if(found)return found.id;
    const full=digits(phone).length===8?'+968'+digits(phone):'+'+digits(phone);
    const r=await supa.from('owners').insert({company_id:cid,name:name||('مالك '+want),phone:full,owner_type:type,added_by:currentUser.id,archived:false}).select('id').single();
    if(r.error)throw r.error;
    if(typeof allOwners!=='undefined'&&Array.isArray(allOwners))allOwners.unshift({id:r.data.id,name,phone:full,owner_type:type});
    if(typeof logSystemActivity==='function')try{await logSystemActivity('create','owner',r.data.id,'إضافة مالك من الإضافة السريعة: '+(name||want));}catch(_){}
    return r.data.id;
  }
  async function save(btn){
    if(saving)return;
    const d=byId('crmQuickPropDlg'),err=d.querySelector('.ccm-err');
    const val=n=>{const x=d.querySelector('input[name="'+n+'"]:checked');return x?x.value:'';};
    const branch=val('cqpBranch'),purpose=val('cqpPurpose')||'sale',source=val('cqpSource')||'owner';
    const type=byId('cqpType').value,wilayat=byId('cqpWilayat').value.trim(),area=byId('cqpArea').value.trim();
    const price=typeof parseNum==='function'?parseNum(byId('cqpPrice').value):Number(digits(byId('cqpPrice').value));
    const name=byId('cqpOwner').value.trim(),phone=digits(byId('cqpPhone').value),note=byId('cqpNote').value.trim();
    if(!branch){err.textContent='اختر الفرع';return;}
    if(!area){err.textContent='اكتب المنطقة';return;}
    if(!price||price<=0){err.textContent='اكتب السعر';return;}
    if(phone.length<8||phone.length>15){err.textContent='اكتب جوال المالك صح';return;}
    saving=true;btn.disabled=true;err.textContent='';
    try{
      const cid=typeof ensureCompany==='function'?await ensureCompany():currentProfile.company_id;
      const ownerId=await findOrAddOwner(cid,name,phone,source);
      const label=(typeOptions().find(([v])=>v===type)||[type,type])[1];
      const data={company_id:cid,title:label+' في '+area,type,area,price,status:'available',listing_purpose:purpose,owner_id:ownerId,
        wilayat:wilayat||null,branch_key:branch,source_type:source,description:note||null,added_by:currentUser.id,archived:false};
      const from=typeof crmDataFrom==='function'?crmDataFrom('properties'):supa.from('properties');
      const r=await from.insert(data).select('id').single();
      if(r.error)throw r.error;
      try{localStorage.setItem('crmQuickPropertyBranch',branch);}catch(_){}
      if(typeof logSystemActivity==='function')try{await logSystemActivity('create','property',r.data.id,'إضافة عقار سريعة: '+data.title);}catch(_){}
      d.close();toast('انحفظ العقار. تقدر تكمل التفاصيل من صفحته','success');
      if(typeof loadProperties==='function')try{loadProperties();}catch(_){}
      if(typeof loadDashboard==='function'&&typeof activePage!=='undefined'&&activePage==='dash')try{loadDashboard();}catch(_){}
    }catch(e){
      const m=String(e&&e.message||e);
      err.textContent=/property_branch_not_allowed/.test(m)?'ما تقدر تضيف عقار لهالفرع':'ما انحفظ: '+m;
    }finally{saving=false;btn.disabled=false;}
  }
  window.crmQuickProperty=open;
  // The two «add property» buttons open the quick sheet; the full form stays one tap away inside it.
  function wire(){
    document.querySelectorAll('.mobile-nav-btn.add[onclick*="mProperty"], #page-properties [onclick="openCreateModal(\'mProperty\')"]').forEach(b=>{
      b.setAttribute('onclick','crmQuickProperty()');
    });
  }
  wire();setTimeout(wire,1500);
  const nav=window.navigate;
  if(typeof nav==='function')window.navigate=function(){const r=nav.apply(this,arguments);setTimeout(wire,0);return r;};
})();
