/* Property report for the owner of a property (Ahmed, 13 Nov 2026).
 * The button «تقرير المالك» on a property's performance card opens the report on the screen first: Ahmed (or the branch)
 * reads it, then saves it as a PDF, copies it as text for WhatsApp or downloads it for Excel, and sends it to the owner
 * himself. Nothing here sends anything to anyone.
 * It replaces the raw CSV of crm-operations-v6.js: Arabic words instead of «instagram / publish», the marketing period and
 * its days, totals of views, visits by what happened to them, why clients said no, and no internal note ever (the notes of
 * property_marketing_events are written for the office: «ربطه Claude بطلب أحمد …»).
 * Rules kept from the old report: a number Meta did not give is «غير متاح», never zero; clients with a recorded inbound
 * inquiry and clients known only from a visit are counted apart; it is built only for the session that asked for it.
 */
(function(){
  'use strict';
  const root=window;
  const CHANNEL={instagram:'إنستغرام',facebook:'فيسبوك',youtube:'يوتيوب',oman_reel:'عُمان ريل',signboard:'لوحة على العقار',referral:'إحالات',other:'قناة أخرى'};
  const EVENT={publish:'نشر',update:'تحديث',install:'تركيب',remove:'إزالة',other:'نشاط'};
  const REASON={price:'السعر',price_value_mismatch:'السعر مقابل العقار',location:'الموقع',area:'المساحة',built_size:'مساحة البناء',land_size:'مساحة الأرض',
    layout:'تقسيم الغرف',room_layout:'تقسيم الغرف',design:'التصميم',finishing:'التشطيب',parking:'المواقف / الحوش',financing:'التمويل',
    found_other:'وجد عقاراً آخر',not_interested:'لم يعجبه العقار'};
  // said about the client or the timing, not about the property: one line «أسباب أخرى»
  const OTHER_REASON='أسباب أخرى';
  // the client asked after the property had left the market: not an opinion on the property, left out of «لم يناسبهم»
  const NOT_AN_OPINION=['property_unavailable'];
  const NA='غير متاح';
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=v=>Number(v).toLocaleString('en-US');
  const known=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
  const shown=v=>known(v)?num(v):NA;
  const day=v=>{const d=v instanceof Date?v:new Date(v);return v&&!isNaN(d)?d.toLocaleDateString('ar-OM-u-nu-latn',{timeZone:'Asia/Muscat',day:'numeric',month:'long',year:'numeric'}):'—';};
  const safeUrl=v=>{try{const u=new URL(String(v||''));return /^https?:$/.test(u.protocol)&&!u.username&&!u.password?u.href:'';}catch(_){return '';}};
  // a date column («2026-09-28») is that day in Muscat, a timestamp is the moment itself
  const moment=v=>{if(!v)return null;const d=new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(v))?v+'T00:00:00+04:00':v);return isNaN(d)?null:d;};
  const sum=(rows,key)=>{const have=rows.filter(r=>known(r[key]));return {total:have.reduce((a,r)=>a+Number(r[key]),0),known:have.length};};

  // Everything the report says, from the rows the screen is allowed to read. Pure: no page, no network.
  function build(property,inquiries,viewings,marketing,now){
    const p=property||{},today=now instanceof Date?now:new Date(now||Date.now());
    const agreed=p.has_listing_agreement!==false?moment(p.agreement_start_date):null,registered=moment(p.created_at);
    // whole days by the Muscat calendar (13 Oct to 13 Nov is 31), never less than one
    const muscatDay=d=>Math.floor((d.getTime()+4*3600000)/86400000);
    const start=agreed||registered,days=start?Math.max(1,muscatDay(today)-muscatDay(start)):null;
    const iq=inquiries||[],vw=(viewings||[]).filter(v=>!v.archived);
    const visited=new Set(vw.filter(v=>v.status!=='cancelled').map(v=>v.client_id).filter(Boolean));
    const inbound=new Set(iq.filter(x=>x.has_inbound_inquiry).map(x=>x.client_id).filter(Boolean));
    const visitOnly=new Set(iq.filter(x=>!x.has_inbound_inquiry&&visited.has(x.client_id)).map(x=>x.client_id));
    const refused=iq.filter(x=>x.status==='not_suitable'&&!NOT_AN_OPINION.includes(x.rejection_reason));
    const why=new Map();
    refused.forEach(x=>{const label=REASON[x.rejection_reason]||OTHER_REASON;why.set(label,(why.get(label)||0)+1);});
    const reasons=[...why].map(([label,count])=>({label,count})).sort((a,b)=>(a.label===OTHER_REASON)-(b.label===OTHER_REASON)||b.count-a.count);
    const posts=(marketing||[]).map(m=>({channel:m.channel||'other',label:CHANNEL[m.channel]||CHANNEL.other,event:EVENT[m.event_type]||EVENT.other,
      published:m.published_at||null,views:known(m.views)?Number(m.views):known(m.plays)?Number(m.plays):null,reach:known(m.reach)?Number(m.reach):null,
      interactions:known(m.total_interactions)?Number(m.total_interactions):null,synced:m.last_synced_at||null,url:safeUrl(m.url)}))
      .sort((a,b)=>(a.published?Date.parse(a.published):Infinity)-(b.published?Date.parse(b.published):Infinity));
    const channels=[];
    posts.forEach(r=>{let c=channels.find(x=>x.channel===r.channel);if(!c){c={channel:r.channel,label:r.label,rows:[]};channels.push(c);}c.rows.push(r);});
    const synced=posts.map(r=>r.synced&&Date.parse(r.synced)).filter(Boolean);
    return {company:p.company_name||'',title:p.title||'العقار',place:[p.area,p.wilayat].map(x=>String(x||'').trim()).filter((x,i,a)=>x&&a.indexOf(x)===i).join(' ، '),
      price:known(p.price)&&Number(p.price)>0?Number(p.price):null,rent:p.listing_purpose==='rent',
      start:start?start.toISOString():null,startKind:agreed?'agreement':'registered',today:today.toISOString(),days,
      marketing:{count:posts.length,views:sum(posts,'views'),reach:sum(posts,'reach'),interactions:sum(posts,'interactions'),
        channels:channels.map(c=>({label:c.label,count:c.rows.length,views:sum(c.rows,'views')})),posts,lastSynced:synced.length?new Date(Math.max(...synced)).toISOString():null},
      clients:{inbound:inbound.size,visitOnly:visitOnly.size},
      visits:{done:vw.filter(v=>v.status==='done').length,scheduled:vw.filter(v=>v.status==='scheduled').length,
        noShow:vw.filter(v=>v.status==='no_show').length,cancelled:vw.filter(v=>v.status==='cancelled').length},
      feedback:{negotiation:iq.filter(x=>x.status==='negotiation').length,notSuitable:refused.length,reasons}};
  }

  const total=s=>s.known?num(s.total):NA;
  const partial=(s,count,word)=>s.known&&s.known<count?word+' متاحة لـ '+num(s.known)+' من '+num(count)+' منشورات':'';
  const period=m=>(m.start?'من '+day(m.start)+' إلى '+day(m.today)+(m.days?' ('+num(m.days)+' يوم)':''):'حتى '+day(m.today));
  const priceText=m=>m.price==null?'':num(m.price)+' ر.ع'+(m.rent?' (إيجار)':'');
  const fileName=m=>'تقرير-أداء-'+String(m.title||'العقار').replace(/[\\/:*?"<>|]+/g,' ').trim();

  function html(m){
    const mk=m.marketing,tile=(value,label,note)=>'<div class="cor-tile"><strong>'+esc(value)+'</strong><span>'+esc(label)+'</span>'+(note?'<small>'+esc(note)+'</small>':'')+'</div>';
    const fact=(label,value)=>value?'<div><dt>'+esc(label)+'</dt><dd>'+esc(value)+'</dd></div>':'';
    const line=(label,value)=>'<tr><th scope="row">'+esc(label)+'</th><td>'+esc(value)+'</td></tr>';
    let h='<article class="cor-page" dir="rtl"><header class="cor-head"><div><small>'+esc(m.company||'Habib Sons Real Estate')+'</small><h1>تقرير أداء العقار</h1></div><time>'+esc(day(m.today))+'</time></header>';
    h+='<dl class="cor-facts">'+fact('العقار',m.title)+fact('المنطقة',m.place)+fact('السعر المعروض',priceText(m))+fact(m.startKind==='agreement'?'مدة التسويق (من بداية الاتفاقية)':'مدة التسويق',period(m))+'</dl>';
    h+='<div class="cor-tiles">'+tile(total(mk.views),'مجموع المشاهدات',partial(mk.views,mk.count,'المشاهدات'))+tile(num(mk.count),'منشورات وإعلانات')+tile(num(m.clients.inbound),'عملاء استفسروا')+tile(num(m.visits.done),'زيارات تمت')+'</div>';
    h+='<section><h2>التسويق</h2>';
    if(!mk.count)h+='<p class="cor-empty">لا توجد منشورات مسجلة لهذا العقار حتى الآن.</p>';
    else{
      h+='<table class="cor-lines"><tbody>'+mk.channels.map(c=>line(c.label,num(c.count)+' منشور · '+(c.views.known?num(c.views.total)+' مشاهدة':'المشاهدات '+NA))).join('')
        +line('مجموع التفاعلات (إعجاب، تعليق، مشاركة، حفظ)',total(mk.interactions))+'</tbody></table>';
      h+='<div class="cor-wrap"><table class="cor-posts"><thead><tr><th>القناة</th><th>التاريخ</th><th>المشاهدات</th><th>الوصول</th><th>التفاعلات</th><th>الرابط</th></tr></thead><tbody>'
        +mk.posts.map(r=>'<tr><td>'+esc(r.label)+(r.event!==EVENT.publish?' · '+esc(r.event):'')+'</td><td>'+esc(day(r.published))+'</td><td>'+esc(shown(r.views))+'</td><td>'+esc(shown(r.reach))+'</td><td>'+esc(shown(r.interactions))+'</td><td>'
          +(r.url?'<a href="'+esc(r.url)+'" target="_blank" rel="noopener noreferrer">فتح المنشور</a>':'—')+'</td></tr>').join('')+'</tbody></table></div>';
      h+='<p class="cor-foot">الوصول هو عدد الحسابات التي شاهدت كل منشور، والشخص نفسه قد يشاهد أكثر من منشور.'+(mk.lastSynced?' آخر تحديث للأرقام: '+esc(day(mk.lastSynced))+'.':'')+'</p>';
    }
    h+='</section><section><h2>العملاء والزيارات</h2><table class="cor-lines"><tbody>'+line('عملاء استفسروا عن العقار',num(m.clients.inbound))
      +(m.clients.visitOnly?line('عملاء زاروا العقار بدون استفسار مسجل قبلها',num(m.clients.visitOnly)):'')
      +line('زيارات تمت',num(m.visits.done))+line('زيارات مجدولة',num(m.visits.scheduled))
      +(m.visits.noShow?line('حجز ولم يحضر',num(m.visits.noShow)):'')+(m.visits.cancelled?line('زيارات ألغيت',num(m.visits.cancelled)):'')
      +(m.feedback.negotiation?line('عملاء في التفاوض',num(m.feedback.negotiation)):'')+'</tbody></table></section>';
    if(m.feedback.notSuitable)h+='<section><h2>ملاحظات العملاء</h2><table class="cor-lines"><tbody>'+line('عملاء قالوا إن العقار لم يناسبهم',num(m.feedback.notSuitable))
      +m.feedback.reasons.map(r=>line('السبب: '+r.label,num(r.count))).join('')+'</tbody></table></section>';
    return h+'<footer class="cor-end">أُعد هذا التقرير من سجلات المكتب بتاريخ '+esc(day(m.today))+'.</footer></article>';
  }

  // the same report as plain text, to paste into WhatsApp
  function text(m){
    const mk=m.marketing,out=['تقرير أداء العقار','العقار: '+m.title];
    if(m.place)out.push('المنطقة: '+m.place);
    if(priceText(m))out.push('السعر المعروض: '+priceText(m));
    out.push('مدة التسويق: '+period(m),'','التسويق','• منشورات وإعلانات: '+num(mk.count));
    if(mk.count){
      mk.channels.forEach(c=>out.push('• '+c.label+': '+num(c.count)+' منشور، '+(c.views.known?num(c.views.total)+' مشاهدة':'المشاهدات '+NA)));
      out.push('• مجموع المشاهدات: '+total(mk.views)+(partial(mk.views,mk.count,'المشاهدات')?' ('+partial(mk.views,mk.count,'المشاهدات')+')':''),'• مجموع التفاعلات: '+total(mk.interactions));
    }
    out.push('','العملاء والزيارات','• عملاء استفسروا عن العقار: '+num(m.clients.inbound));
    if(m.clients.visitOnly)out.push('• عملاء زاروا بدون استفسار مسجل قبلها: '+num(m.clients.visitOnly));
    out.push('• زيارات تمت: '+num(m.visits.done),'• زيارات مجدولة: '+num(m.visits.scheduled));
    if(m.visits.noShow)out.push('• حجز ولم يحضر: '+num(m.visits.noShow));
    if(m.visits.cancelled)out.push('• زيارات ألغيت: '+num(m.visits.cancelled));
    if(m.feedback.negotiation)out.push('• عملاء في التفاوض: '+num(m.feedback.negotiation));
    if(m.feedback.notSuitable){out.push('','ملاحظات العملاء','• لم يناسبهم العقار: '+num(m.feedback.notSuitable));m.feedback.reasons.forEach(r=>out.push('   - '+r.label+': '+num(r.count)));}
    return out.join('\n');
  }

  // the same report as rows for Excel
  function csvRows(m){
    const mk=m.marketing,rows=[['تقرير أداء العقار'],['العقار',m.title],['المنطقة',m.place],['السعر المعروض',m.price==null?'':m.price],
      ['بداية التسويق',m.start?day(m.start):''],['تاريخ التقرير',day(m.today)],['عدد الأيام',m.days==null?'':m.days],[],
      ['منشورات وإعلانات',mk.count],['مجموع المشاهدات',mk.views.known?mk.views.total:NA],['مجموع التفاعلات',mk.interactions.known?mk.interactions.total:NA],[],
      ['عملاء استفسروا عن العقار',m.clients.inbound],['عملاء زاروا بدون استفسار مسجل قبلها',m.clients.visitOnly],
      ['زيارات تمت',m.visits.done],['زيارات مجدولة',m.visits.scheduled],['حجز ولم يحضر',m.visits.noShow],['زيارات ألغيت',m.visits.cancelled],
      ['عملاء في التفاوض',m.feedback.negotiation],['لم يناسبهم العقار',m.feedback.notSuitable]];
    m.feedback.reasons.forEach(r=>rows.push(['السبب: '+r.label,r.count]));
    rows.push([],['سجل التسويق'],['القناة','النشاط','التاريخ','المشاهدات','الوصول','التفاعلات','الرابط']);
    mk.posts.forEach(r=>rows.push([r.label,r.event,r.published?day(r.published):'',r.views==null?NA:r.views,r.reach==null?NA:r.reach,r.interactions==null?NA:r.interactions,r.url]));
    return rows;
  }

  let current=null; // the report on the screen: {model, node}
  const toast=(message,kind)=>{if(typeof root.showToast==='function')root.showToast(message,kind);};
  function close(){
    if(current&&current.node&&current.node.parentNode)current.node.parentNode.removeChild(current.node);
    if(typeof document!=='undefined'&&document.body&&document.body.classList)document.body.classList.remove('cor-open','cor-printing');
    current=null;
  }
  function print(){
    if(!current)return;
    const old=document.title,done=()=>{document.title=old;document.body.classList.remove('cor-printing');root.removeEventListener('afterprint',done);};
    document.title=fileName(current.model)+'-'+current.model.today.slice(0,10); // the name the browser offers for the PDF
    document.body.classList.add('cor-printing');root.addEventListener('afterprint',done);root.print();
  }
  async function copy(){
    if(!current)return;
    const value=text(current.model);
    try{await root.navigator.clipboard.writeText(value);toast('تم نسخ نص التقرير. الصقه في واتساب بعد المراجعة','success');}
    catch(_){
      const box=document.createElement('textarea');box.value=value;box.setAttribute('readonly','');box.className='cor-copybox';current.node.appendChild(box);box.select();
      let ok=false;try{ok=document.execCommand('copy');}catch(e){}
      box.remove();toast(ok?'تم نسخ نص التقرير. الصقه في واتساب بعد المراجعة':'تعذر النسخ من هذا المتصفح. استخدم «حفظ PDF»',ok?'success':'error');
    }
  }
  function excel(){if(current&&typeof root.downloadCSV==='function')root.downloadCSV(fileName(current.model),[],csvRows(current.model));}
  function show(model){
    close();
    const node=document.createElement('div');
    node.id='crmOwnerReport';node.className='cor-ov';node.setAttribute('role','dialog');node.setAttribute('aria-modal','true');node.setAttribute('aria-label','تقرير المالك');node.setAttribute('dir','rtl');
    node.innerHTML='<div class="cor-bar"><strong>تقرير المالك</strong><div class="cor-actions"><button type="button" class="btn-primary" data-cor="print">حفظ PDF / طباعة</button>'
      +'<button type="button" class="btn-secondary" data-cor="copy">نسخ نص لواتساب</button><button type="button" class="btn-secondary" data-cor="excel">تنزيل Excel</button>'
      +'<button type="button" class="btn-secondary" data-cor="close">إغلاق</button></div></div>'
      +'<p class="cor-hint">راجع التقرير أولاً. لا يُرسل أي شيء للمالك من النظام: احفظه أو انسخه ثم أرسله بنفسك.</p>'+html(model);
    node.addEventListener('click',event=>{
      const button=event.target&&event.target.closest?event.target.closest('[data-cor]'):null;if(!button)return;
      const action=button.getAttribute('data-cor');
      if(action==='close')close();else if(action==='print')print();else if(action==='copy')copy();else if(action==='excel')excel();
    });
    document.body.appendChild(node);document.body.classList.add('cor-open');
    current={model,node};
  }

  async function open(){
    // currentUser, crmSessionGeneration, supa and currentCompany are page variables of app-base-v15.html (declared with let),
    // not properties of window: they are read by name, as crm-operations-v6.js does.
    const p=root.viewingProperty,generation=typeof crmSessionGeneration==='undefined'?undefined:crmSessionGeneration;
    const user=typeof currentUser!=='undefined'&&currentUser?currentUser.id:null;
    if(!p||!user)return;
    const mine=()=>typeof crmSessionCurrent!=='function'||crmSessionCurrent(generation,user);
    try{
      const [ir,vr,mr]=await Promise.all([
        supa.from('property_inquiries').select('client_id,has_inbound_inquiry,status,rejection_reason').eq('property_id',p.id),
        supa.from('viewings').select('client_id,status,archived').eq('property_id',p.id),
        supa.from('property_marketing_events').select('channel,event_type,published_at,views,plays,reach,total_interactions,last_synced_at,url').eq('property_id',p.id).order('published_at',{ascending:true})]);
      if(!mine())return;
      [ir,vr,mr].forEach(r=>{if(r.error)throw r.error;});
      if(!root.viewingProperty||root.viewingProperty.id!==p.id)return; // he moved to another property meanwhile
      const office=typeof currentCompany!=='undefined'&&currentCompany?currentCompany.name:'';
      show(build(Object.assign({},p,{company_name:office}),ir.data,vr.data,mr.data,new Date()));
    }catch(error){if(mine())toast('تعذر إعداد التقرير: '+(error&&error.message||error),'error');}
  }

  root.crmOwnerReport={build,html,text,csvRows,open,close};
  root.exportPropertyOwnerReport=open;
  // the report holds private figures: it leaves the screen with the session, and Escape closes it
  const reset=root.crmResetOperations;
  if(typeof reset==='function')root.crmResetOperations=function(){close();return reset.apply(this,arguments);};
  if(typeof document!=='undefined'&&typeof document.addEventListener==='function')document.addEventListener('keydown',event=>{if(current&&event.key==='Escape')close();});
})();
