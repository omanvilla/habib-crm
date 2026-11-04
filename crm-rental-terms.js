/* مدة الإيجار (4 Nov 2026): for a rental property the owner ticks which terms are allowed
 * (يومي، أسبوعي، شهري، 3 شهور، 6 شهور، سنة). Saved in properties.rental_terms; the WhatsApp
 * reply agent reads it and tells a customer who asks for a shorter term what is available.
 * The chips save on tap for an existing property; a new property is saved first, then the chips work. */
(function(){
  'use strict';
  const TERMS=[['daily','يومي'],['weekly','أسبوعي'],['monthly','شهري'],['3m','3 شهور'],['6m','6 شهور'],['yearly','سنة']];
  const byId=id=>document.getElementById(id);
  const toast=(m,t)=>{if(typeof showToast==='function')showToast(m,t);};
  let current=[];
  function box(){
    let b=byId('pRentalTerms');
    const purpose=byId('pPurpose');if(!purpose)return null;
    if(!b){
      b=document.createElement('div');b.id='pRentalTerms';b.className='fg';
      b.innerHTML='<label class="fl">⏱ مدة الإيجار المسموحة</label><div class="rt-chips"></div><small class="rt-hint"></small>';
      purpose.closest('.fg').after(b);
      purpose.addEventListener('change',render);
    }
    return b;
  }
  function render(){
    const b=box();if(!b)return;
    const isRent=byId('pPurpose').value==='rent';b.hidden=!isRent;if(!isRent)return;
    const id=window.editingProperty||null;
    const wrap=b.querySelector('.rt-chips');wrap.innerHTML='';
    for(const [k,label] of TERMS){
      const c=document.createElement('button');c.type='button';c.className='rt-chip'+(current.includes(k)?' on':'');c.textContent=label;c.disabled=!id;
      c.onclick=async()=>{
        const next=current.includes(k)?current.filter(x=>x!==k):[...current,k];
        const order=TERMS.map(t=>t[0]);next.sort((a,b2)=>order.indexOf(a)-order.indexOf(b2));
        c.disabled=true;
        const r=await supa.from('properties').update({rental_terms:next.length?next:null}).eq('id',id);
        c.disabled=false;
        if(r.error){toast('تعذر حفظ مدة الإيجار: '+r.error.message,'error');return;}
        current=next;render();toast('انحفظت مدة الإيجار','success');
      };
      wrap.append(c);
    }
    b.querySelector('.rt-hint').textContent=id?'اضغط على المدد اللي تقبلها. العقل يرد على الإيجار حسبها':'احفظ العقار أول وبعدها حدد مدة الإيجار';
  }
  async function load(id){
    current=[];
    if(id){const r=await supa.from('properties').select('rental_terms').eq('id',id).maybeSingle();current=(r.data&&r.data.rental_terms)||[];}
    render();
  }
  function hook(){
    if(typeof window.editProperty==='function'&&!window.editProperty._rt){
      const orig=window.editProperty;
      window.editProperty=async function(id){const out=await orig.apply(this,arguments);load(id);return out;};
      window.editProperty._rt=true;
    }
    if(typeof window.openModal==='function'&&!window.openModal._rt){
      const om=window.openModal;
      window.openModal=function(name){const out=om.apply(this,arguments);if(name==='mProperty')setTimeout(()=>load(window.editingProperty||null),60);return out;};
      window.openModal._rt=true;
    }
  }
  const st=document.createElement('style');
  st.textContent='.rt-chips{display:flex;flex-wrap:wrap;gap:6px}.rt-chip{border:1px solid var(--border,#ccc);background:transparent;border-radius:16px;padding:5px 12px;font:inherit;cursor:pointer}.rt-chip.on{background:var(--primary,#1d6b55);color:#fff;border-color:transparent}.rt-chip:disabled{opacity:.5;cursor:default}.rt-hint{display:block;margin-top:4px;opacity:.7}';
  document.head.append(st);
  hook();setInterval(hook,2000);
})();
