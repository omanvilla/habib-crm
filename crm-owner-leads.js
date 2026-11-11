/* Owner offers (4 November 2026). Page "عروض الملاك": every owner who sent us his property's
 * details (seller requests from WhatsApp and the old intake form, plus what the reply agent records)
 * with the active buyers looking for the same type in the same area and budget. The list is filled and
 * matched by crm_match_owner_leads() every morning; the button "طابق الحين" runs it on demand.
 * Owner and staff (SQL82, RLS on owner_leads / owner_lead_matches). */
(function(){
  'use strict';
  const esc=v=>typeof escapeHtml==='function'?escapeHtml(String(v==null?'':v)):String(v==null?'':v).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
  const byId=id=>document.getElementById(id);
  const toast=(m,t)=>{if(typeof showToast==='function')showToast(m,t);};
  // 11 Nov 2026 (Ahmed, SQL82): staff see owner offers too; offers from the owner's private line stay hidden (RLS)
  const isOwnerNow=()=>typeof currentProfile!=='undefined'&&currentProfile&&['owner','manager','agent','viewer'].includes(currentProfile.role);
  const KINDS={land:'أرض',villa:'فيلا / بيت',house:'بيت',building:'مبنى',apartment:'شقة',farm:'مزرعة',shop:'محل',chalet:'شاليه',resthouse:'استراحة',other:'أخرى'};
  const STATUS={open:'جديد',studied:'انرسلت الدراسة',listed:'انعرض عندنا',closed:'مقفول'};
  const k=v=>v==null?'':(Number(v)>=1000?Math.round(Number(v)/1000).toLocaleString('en-US')+' الف':Number(v).toLocaleString('en-US'));
  let state={rows:[],loading:false,q:'',kind:'',onlyBuyers:true,status:'active',open:new Set()};

  function ensurePage(){
    if(byId('page-owner-leads'))return;
    const content=document.querySelector('.content');if(!content)return;
    const page=document.createElement('div');page.className='page';page.id='page-owner-leads';
    page.innerHTML='<div class="page-header"><div><div class="page-title"><span>عروض الملاك</span></div><div class="page-sub" id="olSub">جاري التحميل…</div></div>'
      +'<button type="button" class="btn-secondary" data-ol="match">طابق الحين</button></div>'
      +'<div class="ol-filters"><input id="olQ" type="search" placeholder="ابحث باسم المالك أو المنطقة" dir="auto">'
      +'<select id="olKind"><option value="">كل الأنواع</option>'+Object.keys(KINDS).map(x=>'<option value="'+x+'">'+KINDS[x]+'</option>').join('')+'</select>'
      +'<select id="olStatus"><option value="active">الجديدة واللي انرسلت لها دراسة</option><option value="week">جديد هذا الأسبوع (آخر 7 أيام)</option><option value="open">جديد</option><option value="studied">انرسلت الدراسة</option><option value="listed">انعرض عندنا</option><option value="closed">مقفول</option><option value="">الكل</option></select>'
      +'<label><input type="checkbox" id="olBuyers" checked> اللي لها مشترين بس</label></div><div id="olList"></div>';
    content.append(page);
    const nav=document.querySelector('#sidebar .nav-area');
    if(nav&&!byId('navOwnerLeads')){
      const link=document.createElement('div');link.className='nav-link';link.id='navOwnerLeads';link.setAttribute('onclick',"navigate('owner-leads',this)");
      link.innerHTML='<div class="nav-icon">🏠</div><span class="nav-text">عروض الملاك</span><span class="nav-badge" id="navOwnerLeadsCount" style="display:none">0</span>';
      const after=byId('navReplies')||nav.querySelector('.nav-link');
      if(after&&after.parentNode)after.parentNode.insertBefore(link,after.nextSibling);else nav.append(link);
    }
    syncVisibility();
  }
  function syncVisibility(){const l=byId('navOwnerLeads');if(l)l.style.display=isOwnerNow()?'':'none';}

  async function load(){
    if(state.loading)return;state.loading=true;
    try{
      const l=await supa.from('owner_leads').select('id,client_id,conversation_id,kind,area,wilayat,price,land_size,built_size,plot_no,notes,status,created_at').order('created_at',{ascending:false}).limit(1000);
      if(l.error)throw l.error;
      const leads=l.data||[];
      // Batches run side by side (10 Nov 2026): one after the other they took about 4 s and the page sat on «جاري التحميل».
      const batches=async(list,read)=>{const parts=[];for(let i=0;i<list.length;i+=150)parts.push(list.slice(i,i+150));const res=await Promise.all(parts.map(read));const out=[];for(const r of res){if(r.error)throw r.error;out.push(...(r.data||[]));}return out;};
      const ids=leads.map(x=>x.id);
      const matches=await batches(ids,part=>supa.from('owner_lead_matches').select('lead_id,request_id').in('lead_id',part));
      const reqIds=[...new Set(matches.map(x=>x.request_id))];
      const reqs=await batches(reqIds,part=>supa.from('client_requests').select('id,client_id,budget_max,preferred_area,property_type,updated_at').in('id',part));
      const cids=[...new Set([...reqs.map(x=>x.client_id),...leads.map(x=>x.client_id)].filter(Boolean))];
      const cls=await batches(cids,part=>supa.from('clients').select('id,name,phone').in('id',part));
      const cm=new Map(cls.map(x=>[x.id,x])),qm=new Map(reqs.map(x=>[x.id,x]));
      const byLead=new Map();for(const m of matches){if(!byLead.has(m.lead_id))byLead.set(m.lead_id,[]);const r=qm.get(m.request_id);if(r)byLead.get(m.lead_id).push(Object.assign({},r,{client:cm.get(r.client_id)||{}}));}
      leads.forEach(x=>{x.owner=cm.get(x.client_id)||{};const p=Number(x.price||0);
        x.buyers=(byLead.get(x.id)||[]).sort((a,b)=>p?Math.abs(a.budget_max-p)-Math.abs(b.budget_max-p):String(b.updated_at).localeCompare(String(a.updated_at)));});
      state.rows=leads;
    }catch(e){state.rows=[];toast('تعذر تحميل عروض الملاك: '+(e.message||e),'error');}
    finally{state.loading=false;}
    render();
  }
  function filtered(){
    const q=state.q.trim();
    // «week» is the home tile «عروض ملاك جديدة»: open and received in the last 7 days (same rule as crm_owner_home).
    const weekAgo=Date.now()-7*86400000;
    return state.rows.filter(x=>(state.status==='active'?['open','studied'].includes(x.status):state.status==='week'?x.status==='open'&&Date.parse(x.created_at)>weekAgo:!state.status||x.status===state.status)
      &&(!state.kind||x.kind===state.kind)&&(!state.onlyBuyers||x.buyers.length)
      &&(!q||[x.owner.name,x.owner.phone,x.area,x.wilayat,x.notes].some(v=>String(v||'').includes(q))));
  }
  function card(x){
    const title=(KINDS[x.kind]||x.kind||'عقار')+' · '+(x.area||x.wilayat||'منطقة غير محددة')+(x.area&&x.wilayat?' ('+x.wilayat+')':'');
    const facts=[x.price?'السعر '+k(x.price):'بدون سعر',x.land_size?'أرض '+Number(x.land_size).toLocaleString('en-US')+' م²':'',x.built_size?'بناء '+Number(x.built_size).toLocaleString('en-US')+' م²':'',x.plot_no?'قطعة '+x.plot_no:'',STATUS[x.status]||x.status,'وصل '+String(x.created_at||'').slice(0,10)].filter(Boolean);
    const open=state.open.has(x.id),shown=open?x.buyers:x.buyers.slice(0,5);
    return '<section class="rp-card ol-card" data-lead="'+esc(x.id)+'"><div class="ol-head"><strong>'+esc(title)+'</strong><span class="ol-count'+(x.buyers.length?' on':'')+'">'+x.buyers.length+' مشتري</span></div>'
      +'<p class="rp-muted">'+esc((x.owner.name||'مالك')+(x.owner.phone?' · '+x.owner.phone:''))+'</p><p class="ol-facts">'+facts.map(f=>'<span>'+esc(f)+'</span>').join('')+'</p>'
      +(x.buyers.length?'<ul class="ol-buyers">'+shown.map(b=>'<li><button type="button" class="ol-link" data-ol="client" data-client="'+esc(b.client_id)+'">'+esc(b.client.name||'عميل')+'</button> · ميزانية '+esc(k(b.budget_max))+(b.preferred_area?' · '+esc(b.preferred_area):'')+'</li>').join('')+'</ul>'
        +(x.buyers.length>5?'<button type="button" class="ol-link" data-ol="more">'+(open?'أقل':'عرض كل المشترين ('+x.buyers.length+')')+'</button>':''):'<p class="rp-muted">ما في مشتري مطابق لين الحين</p>')
      +'<div class="rp-actions">'+(x.conversation_id?'<button type="button" class="btn-secondary" data-ol="chat">محادثة المالك</button>':'')
      +(x.client_id?'<button type="button" class="btn-secondary" data-ol="client" data-client="'+esc(x.client_id)+'">ملف المالك</button>':'')
      +'<select data-ol="status">'+Object.keys(STATUS).map(s=>'<option value="'+s+'"'+(s===x.status?' selected':'')+'>'+STATUS[s]+'</option>').join('')+'</select></div></section>';
  }
  function render(){
    const list=byId('olList');if(!list)return;
    const rows=filtered(),active=state.rows.filter(x=>['open','studied'].includes(x.status)),withB=active.filter(x=>x.buyers.length).length;
    const waiting=state.loading&&!state.rows.length;
    const sub=byId('olSub');if(sub)sub.textContent=waiting?'جاري التحميل…':active.length+' عرض مالك مو معروض · '+withB+' منها لها مشترين جاهزين';
    const badge=byId('navOwnerLeadsCount');if(badge&&!waiting){badge.textContent=withB;badge.style.display=withB?'':'none';}
    list.innerHTML=state.loading&&!state.rows.length?'<p class="rp-muted">جاري التحميل…</p>':rows.length?rows.slice(0,200).map(card).join('')+(rows.length>200?'<p class="rp-muted">يظهر أول 200، استخدم البحث</p>':''):'<p class="rp-muted">ما في عروض بهالفلتر</p>';
  }
  document.addEventListener('input',e=>{if(e.target.id==='olQ'){state.q=e.target.value;render();}});
  document.addEventListener('change',async e=>{
    const t=e.target;
    if(t.id==='olKind'){state.kind=t.value;render();return;}
    if(t.id==='olStatus'){state.status=t.value;render();return;}
    if(t.id==='olBuyers'){state.onlyBuyers=t.checked;render();return;}
    if(t.dataset&&t.dataset.ol==='status'){const id=t.closest('[data-lead]').dataset.lead;const r=await supa.from('owner_leads').update({status:t.value,updated_at:new Date().toISOString()}).eq('id',id);
      if(r.error){toast('تعذر الحفظ: '+r.error.message,'error');return;}const x=state.rows.find(y=>y.id===id);if(x)x.status=t.value;toast('تم','success');render();}
  });
  document.addEventListener('click',async e=>{
    const b=e.target.closest('[data-ol]');if(!b||!b.closest('#page-owner-leads'))return;
    const a=b.dataset.ol,c=b.closest('[data-lead]'),x=c&&state.rows.find(y=>y.id===c.dataset.lead);
    if(a==='chat'&&x&&typeof openDashboardWhatsAppConversation==='function')openDashboardWhatsAppConversation(x.conversation_id);
    else if(a==='client'&&b.dataset.client&&typeof viewClient==='function')viewClient(b.dataset.client);
    else if(a==='more'&&x){state.open.has(x.id)?state.open.delete(x.id):state.open.add(x.id);render();}
    else if(a==='match'){b.disabled=true;const r=await supa.rpc('crm_match_owner_leads_now');b.disabled=false;
      if(r.error)toast('تعذر: '+r.error.message,'error');else{toast('انضاف '+(r.data||0)+' مشتري مطابق','success');load();}}
  });
  // The home tile opens the page on exactly what it counted (10 Nov 2026): new this week, with or without buyers.
  window.crmOwnerLeadsShowWeek=function(){
    state.status='week';state.onlyBuyers=false;
    const s=byId('olStatus'),b=byId('olBuyers');if(s)s.value='week';if(b)b.checked=false;render();
  };
  const nav=window.navigate;
  if(typeof nav==='function')window.navigate=function(id){
    if(id==='owner-leads'&&!isOwnerNow()){if(typeof showPermissionDenied==='function')showPermissionDenied();return;}
    ensurePage();
    const r=nav.apply(this,arguments);
    if(id==='owner-leads'){const t=byId('tbTitle');if(t)t.innerHTML='<em>عروض الملاك</em>';load();}
    return r;
  };
  const loadDash=window.loadDashboard;
  if(typeof loadDash==='function')window.loadDashboard=function(){const r=loadDash.apply(this,arguments);ensurePage();syncVisibility();return r;};
  ensurePage();
})();
