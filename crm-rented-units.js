/* المؤجر حالياً (6 Nov 2026): an optional note on a property about what is rented and for how much,
 * for example "شقتين كل شقة 100 ريال". Saved in properties.rented_units. The follow-ups and the WhatsApp
 * reply agent read it as a reference. It saves when the field loses focus; a new property is saved first. */
(function(){
  'use strict';
  const byId=id=>document.getElementById(id);
  const toast=(m,t)=>{if(typeof showToast==='function')showToast(m,t);};
  let saved='';
  function box(){
    let b=byId('pRentedUnits');
    const purpose=byId('pPurpose');if(!purpose)return null;
    if(!b){
      b=document.createElement('div');b.id='pRentedUnits';b.className='fg';
      b.innerHTML='<label class="fl" for="pRentedUnitsText">المؤجر حالياً ودخله (اختياري)</label><textarea id="pRentedUnitsText" class="fi" rows="2" maxlength="300" placeholder="مثال: شقتين كل شقة 100 ريال في الشهر"></textarea><small class="ru-hint" style="display:block;margin-top:4px;opacity:.7"></small>';
      purpose.closest('.fg').after(b);
      b.querySelector('textarea').addEventListener('blur',save);
    }
    return b;
  }
  async function save(){
    const id=window.editingProperty||null;if(!id)return;
    const t=byId('pRentedUnitsText');if(!t)return;
    const next=t.value.trim();if(next===saved)return;
    const r=await supa.from('properties').update({rented_units:next||null}).eq('id',id);
    if(r.error){toast('تعذر حفظ المؤجر: '+r.error.message,'error');return;}
    saved=next;toast('انحفظ المؤجر حالياً','success');
  }
  async function load(id){
    const b=box();if(!b)return;
    const t=b.querySelector('textarea'),hint=b.querySelector('.ru-hint');
    saved='';t.value='';t.disabled=!id;
    hint.textContent=id?'مرجع للعقل وقت يرد ويتابع':'احفظ العقار أول وبعدها اكتب المؤجر';
    if(!id)return;
    const r=await supa.from('properties').select('rented_units').eq('id',id).maybeSingle();
    if(r.error){hint.textContent='تعذر تحميل المؤجر';t.disabled=true;return;}
    saved=(r.data&&r.data.rented_units)||'';t.value=saved;
  }
  function hook(){
    if(typeof window.editProperty==='function'&&!window.editProperty._ru){
      const orig=window.editProperty;
      window.editProperty=async function(id){const out=await orig.apply(this,arguments);load(id);return out;};
      window.editProperty._ru=true;
    }
    if(typeof window.openModal==='function'&&!window.openModal._ru){
      const om=window.openModal;
      window.openModal=function(name){const out=om.apply(this,arguments);if(name==='mProperty')setTimeout(()=>load(window.editingProperty||null),60);return out;};
      window.openModal._ru=true;
    }
  }
  hook();setInterval(hook,2000);
})();
