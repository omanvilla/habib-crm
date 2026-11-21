/* SQL153 (Ahmed 21 Nov 2026: «ملف العقار للمشتري… تقوي ثقة المشتري وتقصر التفاوض»): on the property page, a card that
   makes the buyer's one-page file. The owner or a staff member ticks the papers that are ready, picks the finish and the
   build year, and gets one link (property-file.html?t=…) to copy or send on WhatsApp. The page shows the build cost from
   the monthly materials study; it never shows the owner, his net or commission, the plot number or the map pin. */
(function(){
  'use strict';
  const DOCS=[['ملكية','الملكية'],['كروكي','الكروكي'],['اتمام_بناء','شهادة اتمام البناء'],['خرائط','الخرائط'],['ضمان','ضمان المقاول']];
  const TIERS=['اقتصادي','متوسط','فاخر'];
  const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const base=()=>location.origin+location.pathname.replace(/[^/]*$/,'')+'property-file.html?t=';
  // currentProfile is a top-level let in app-base (not on window)
  const canMake=()=>{const p=typeof currentProfile!=='undefined'?currentProfile:window.currentProfile;return !!(p&&['owner','manager','agent'].includes(p.role)&&p.is_active!==false);};
  function cardHtml(p){
    const d=p.file_docs&&typeof p.file_docs==='object'?p.file_docs:{};
    return '<div class="card cpf-card" id="cpfCard"><div class="card-head"><div class="card-title"><span>📄</span>ملف العقار للمشتري</div></div>'
      +'<p class="cpf-help">صفحة وحدة للمشتري فيها العقار والصور والأوراق الجاهزة وكم يكلف بناء مثله اليوم (من دراسة أسعار مواد البناء). ما فيها اسم المالك ولا رقم القطعة ولا اللوكيشن.</p>'
      +'<div class="cpf-docs">'+DOCS.map(([k,l])=>'<label><input type="checkbox" data-cpf-doc="'+k+'"'+(d[k]===true?' checked':'')+'> '+l+'</label>').join('')+'</div>'
      +'<div class="cpf-row"><label>التشطيب <select id="cpfFinish">'+TIERS.map(t=>'<option'+((p.file_finish||'متوسط')===t?' selected':'')+'>'+t+'</option>').join('')+'</select></label>'
      +'<label>سنة البناء <input id="cpfYear" type="number" inputmode="numeric" min="1950" max="2100" placeholder="مثل 2018" value="'+esc(p.file_build_year||'')+'"></label></div>'
      +'<div class="cpf-row"><button type="button" class="btn-primary" data-cpf="make">جهّز الرابط</button></div>'
      +'<div id="cpfOut"></div></div>';
  }
  function draw(){
    const p=window.viewingProperty,host=document.getElementById('propertyDetailContent');
    if(!p||!host||!canMake()||document.getElementById('cpfCard'))return;
    host.insertAdjacentHTML('beforeend',cardHtml(p));
  }
  const orig=window.renderPropertyDetail;
  if(typeof orig==='function'){
    window.renderPropertyDetail=async function(){const r=await orig.apply(this,arguments);try{draw();}catch(e){console.error('[property-file]',e);}return r;};
  }
  document.addEventListener('click',async e=>{
    const b=e.target.closest('[data-cpf]');if(!b)return;
    const p=window.viewingProperty,out=document.getElementById('cpfOut');if(!p||!out)return;
    if(b.dataset.cpf==='make'){
      const docs={};document.querySelectorAll('[data-cpf-doc]').forEach(x=>docs[x.dataset.cpfDoc]=x.checked);
      const y=parseInt(document.getElementById('cpfYear').value,10);
      b.disabled=true;out.textContent='جاري التجهيز…';
      try{
        const r=await supa.rpc('crm_property_file_link',{p_property:p.id,p_docs:docs,p_finish:document.getElementById('cpfFinish').value,p_build_year:(y>=1950&&y<=2100)?y:null});
        if(r.error)throw r.error;
        const link=base()+r.data.token;
        Object.assign(p,{file_docs:docs,file_finish:document.getElementById('cpfFinish').value,file_build_year:(y>=1950&&y<=2100)?y:p.file_build_year});
        out.innerHTML='<div class="cpf-link"><input readonly value="'+esc(link)+'" dir="ltr"><button type="button" class="btn-secondary" data-cpf="copy">نسخ</button>'
          +'<a class="btn-secondary" target="_blank" rel="noopener" href="https://wa.me/?text='+encodeURIComponent('ملف العقار: '+link)+'">إرسال بالواتساب</a>'
          +'<a class="btn-secondary" target="_blank" rel="noopener" href="'+esc(link)+'">فتح</a></div>';
      }catch(err){out.textContent='تعذر تجهيز الرابط: '+(err.message||err);}
      finally{b.disabled=false;}
    }else if(b.dataset.cpf==='copy'){
      const i=out.querySelector('input');try{await navigator.clipboard.writeText(i.value);b.textContent='انسخ ✓';}catch(_){i.select();document.execCommand('copy');b.textContent='انسخ ✓';}
    }
  });
  const st=document.createElement('style');
  st.textContent='.cpf-help{font-size:13px;color:var(--umber,#7a6a5a);margin:0 0 8px}.cpf-docs{display:flex;flex-wrap:wrap;gap:6px 14px;margin-bottom:8px}.cpf-docs label{display:flex;gap:6px;align-items:center;font-size:14px}.cpf-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:6px 0}.cpf-row label{display:flex;gap:6px;align-items:center;font-size:14px}.cpf-row input,.cpf-row select{padding:6px 8px;border:1px solid #ddd;border-radius:8px;max-width:130px}.cpf-link{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.cpf-link input{flex:1;min-width:200px;padding:7px;border:1px solid #ddd;border-radius:8px;font-size:12px}';
  document.head.appendChild(st);
})();
