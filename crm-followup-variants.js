/* Follow-up wording comparison (R36, SQL93, 11 November 2026). Owner only, at the bottom of «متابعات اليوم» when the list is open.
 * Two follow-ups are compared: the after-visit question (step 1) and the request follow-up «لين الحين تبحث ؟».
 * A is today's wording and stays the default. Ahmed writes another wording here («احفظ الصياغة»): it reaches nobody until he
 * presses «جرّبها», and even then only after Meta approves its template as UTILITY on both numbers; until then A goes.
 * Results per wording: sent, replied within 48 hours, visit, deal, split Barka / Muscat / investors.
 * Same rule as the pinned replies (4 Nov): about 20 people per wording, then the winner goes 8 times in 10 and the rest keep testing.
 * Everything is decided on the server (crm_followup_variant_save / _decide / _results, owner only); staff never see this box. */
(function(){
  'use strict';
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
  const toast=(m,t)=>{if(typeof showToast==='function')showToast(m,t);};
  const isOwner=()=>typeof currentProfile!=='undefined'&&currentProfile&&currentProfile.role==='owner';
  const KIND={
    visit_step1:{title:'سؤال بعد الزيارة',hint:'اكتب {العقار} مكان اسم العقار. ولازم تكون فيها «كيف شفت» عشان العقل يعرف إنها سؤال بعد الزيارة.',ph:'السلام عليكم كيف شفت {العقار} …'},
    request_followup:{title:'متابعة الطلب (لين الحين تبحث)',hint:'اكتب {الموضوع} مكان طلب العميل، ومو في أول الرسالة ولا آخرها. تقدر تكتبها على سطرين.',ph:'بخصوص طلبك {الموضوع} …'}
  };
  const STATUS={proposed:'مكتوبة وما اشتغلت',testing:'تتجرب',winner:'الفايزة: 8 من كل 10',retired:'موقفة'};
  const LANES=[['total','الكل'],['barka','بركاء'],['muscat','مسقط'],['investor','المستثمرين']];
  const ERR={owner_only:'هذا القسم لصاحب المكتب بس',variant_length:'الصياغة لازم تكون بين 8 و200 حرف',variant_english:'بدون كلمات إنجليزية',variant_number:'بدون أرقام ولا أسعار في الصياغة',
    variant_greeting:'بدون «هلا» ولا «اهلين»',variant_promise:'ما نوعد برد ولا باتصال',variant_banned_word:'فيها كلمة ممنوعة: «كيف لقيت» أو «مبروك» أو «صور»',
    variant_one_question:'لازم سؤال واحد بس وتنتهي بـ « ؟»',variant_placeholder:'الأقواس { } بس للكلمة المسموحة، ومرة وحدة',variant_placeholder_edge:'{الموضوع} ما ينفع يكون في أول الرسالة ولا آخرها (شرط ميتا)',
    variant_lines:'سطرين بالكثير',variant_agent_unknown:'لازم تكون فيها «كيف شفت»: العقل يعرف سؤال بعد الزيارة من هالكلمتين',variant_duplicate:'نفس صياغة موجودة',
    variant_limit:'صياغتين بالكثير مع A. وقف وحدة أول',variant_sample_small:'ما وصلت العينة المطلوبة عشان تتثبت فايزة',variant_default:'A هي الافتراضية وما تتوقف',
    variant_not_found:'الصياغة ما عادت موجودة',variant_not_proposed:'هذي الصياغة سبق وانضغط لها «جرّبها»',variant_not_running:'هذي الصياغة مو شغالة الحين'};
  const errText=e=>{const raw=String(e&&(e.message||e.error)||e||'');for(const k of Object.keys(ERR))if(raw.includes(k))return ERR[k];return 'ما انحفظ: '+raw;};
  let open=false,data=null,loading=false,busy=false,armed='',armTimer=0,seq=0;const drafts={visit_step1:'',request_followup:''},errs={visit_step1:'',request_followup:''};
  const num=v=>Number(v||0);
  const pct=(a,b)=>num(b)?' <small dir="ltr">'+Math.round(100*num(a)/num(b))+'%</small>':'';
  function tplLine(v){
    if(v.label==='A'||v.status==='retired')return '';
    if(v.status==='proposed')return 'ما توصل لأي عميل لين تضغط «جرّبها»';
    if(v.live)return 'قالب ميتا معتمد على الرقمين والصياغة شغالة';
    const t=v.templates||{},st=r=>{const x=t[r];if(!x)return 'ما وصل ميتا';if(x.status==='APPROVED')return x.category==='UTILITY'?'معتمد':'ميتا صنفه تسويقي';if(x.status==='REJECTED')return 'مرفوض';if(x.status==='ERROR')return 'ما وصل ميتا';return 'ينتظر ميتا';};
    return 'قالب ميتا: بركاء '+st('barka')+' · مسقط '+st('muscat')+'. لين يعتمد على الرقمين تنرسل A';
  }
  function results(v){
    const lanes=v.lanes||{};
    return '<table class="cfv-table"><thead><tr><th></th><th>انرسل</th><th>رد خلال 48 ساعة</th><th>زيارة</th><th>صفقة</th></tr></thead><tbody>'
      +LANES.map(([k,l])=>{const r=k==='total'?(v.total||{}):(lanes[k]||{});return '<tr'+(k==='total'?' class="cfv-total"':'')+'><th scope="row">'+l+'</th><td dir="ltr">'+num(r.sent)+'</td><td><span dir="ltr">'+num(r.replied)+'</span>'+pct(r.replied,r.sent)+'</td><td><span dir="ltr">'+num(r.visits)+'</span>'+pct(r.visits,r.sent)+'</td><td><span dir="ltr">'+num(r.deals)+'</span>'+pct(r.deals,r.sent)+'</td></tr>';}).join('')
      +'</tbody></table>';
  }
  const btn=(action,id,label,primary)=>{const k=action+':'+id,sure=armed===k;return '<button type="button" class="'+(primary?'btn-primary':'btn-secondary')+'" data-cfv="act" data-a="'+action+'" data-id="'+esc(id)+'"'+(busy?' disabled':'')+'>'+(sure?'متأكد ؟ اضغط مرة ثانية':label)+'</button>';};
  function card(v,testsLive){
    const sent=num(v.total&&v.total.sent),ready=sent>=num(v.min_sample),t=v.templates||{};
    let acts='';
    if(v.status==='proposed')acts=btn('test',v.id,'جرّبها',true)+btn('retire',v.id,'احذفها');
    else if(v.status==='testing'){
      if(v.label!=='A'&&!v.live&&(!t.barka||!t.muscat||t.barka.status==='ERROR'||t.muscat.status==='ERROR'))acts+=btn('submit',v.id,'ارسل القالب لميتا مرة ثانية');
      if(ready&&(v.label!=='A'||testsLive))acts+=btn('winner',v.id,'ثبّتها فايزة',true);
      if(v.label!=='A')acts+=btn('retire',v.id,'وقفها');
    }else if(v.status==='winner')acts=btn('unwinner',v.id,'رجّعها للتجربة')+(v.label!=='A'?btn('retire',v.id,'وقفها'):'');
    const state=v.label==='A'&&v.status==='testing'?(testsLive?'الافتراضية، تتقارن الحين':'الافتراضية، تنرسل للكل'):STATUS[v.status]||v.status;
    const note=tplLine(v),sample=v.status==='retired'||v.status==='proposed'?'':'<small class="cfv-note">انرسلت <b dir="ltr">'+sent+'</b> من <b dir="ltr">'+num(v.min_sample)+'</b> للعينة'+(num(v.waiting)?' · تنتظر الإرسال <b dir="ltr">'+num(v.waiting)+'</b>':'')+'</small>';
    return '<li class="cfv-card'+(v.status==='retired'?' off':'')+'"><div class="cfv-head"><b class="cfv-label" dir="ltr">'+esc(v.label)+'</b><span>'+esc(state)+'</span></div>'
      +'<p class="cfu-text" dir="auto">'+esc(v.text)+'</p>'+(note?'<small class="cfv-note">'+esc(note)+'</small>':'')+sample
      +(v.status==='proposed'?'':results(v))+(acts?'<div class="cfu-actions">'+acts+'</div>':'')+'</li>';
  }
  function kindBox(kind){
    const k=KIND[kind],list=((data&&data.variants)||[]).filter(v=>v.kind===kind),running=list.filter(v=>v.status!=='retired'),old=list.filter(v=>v.status==='retired');
    const testsLive=running.some(v=>v.label!=='A'&&v.live),live=running.filter(v=>v.live),noWinner=!running.some(v=>v.status==='winner');
    const decide=testsLive&&noWinner&&live.every(v=>num(v.total&&v.total.sent)>=num(v.min_sample));
    const room=running.filter(v=>v.label!=='A').length<2;
    return '<section class="cfv-kind"><h3>'+k.title+'</h3>'
      +(decide?'<p class="cfv-decide">كل صياغة وصلت العينة. شوف الأرقام وثبّت الفايزة.</p>':'')
      +'<ul class="cfv-list">'+running.map(v=>card(v,testsLive)).join('')+'</ul>'
      +(old.length?'<details class="cfv-old"><summary>صياغات موقفة <b dir="ltr">'+old.length+'</b></summary><ul class="cfv-list">'+old.map(v=>card(v,false)).join('')+'</ul></details>':'')
      +(room?'<div class="cfv-add"><label for="cfvT-'+kind+'">أضف صياغة</label><textarea id="cfvT-'+kind+'" class="fta cfv-text" rows="2" dir="auto" data-kind="'+kind+'" placeholder="'+esc(k.ph)+'">'+esc(drafts[kind])+'</textarea>'
        +'<small class="cfv-note">'+esc(k.hint)+' بدون «هلا» وبدون فواصل ونقاط، وسؤال واحد ينتهي بـ « ؟».</small>'
        +'<div class="cfu-actions"><button type="button" class="btn-secondary" data-cfv="save" data-kind="'+kind+'"'+(busy?' disabled':'')+'>احفظ الصياغة</button></div><div class="cfu-err" role="alert">'+esc(errs[kind])+'</div></div>'
        :'<small class="cfv-note">صياغتين بالكثير مع A. وقف وحدة عشان تضيف غيرها.</small>')
      +'</section>';
  }
  function html(){
    const head='<h3 class="cfv-title"><button type="button" data-cfv="toggle" aria-expanded="'+open+'" style="all:unset;cursor:pointer;display:flex;gap:8px;align-items:center">مقارنة صياغات المتابعة (A/B) <small>'+(open?'▴':'▾')+'</small></button></h3>';
    if(!open)return head;
    if(!data)return head+'<p class="cfu-hint">'+(loading?'جاري التحميل…':'ما قدرت أحمل النتائج. جرب مرة ثانية')+'</p>';
    return head+'<p class="cfu-hint">A هي الصياغة الحالية وتظل الافتراضية. أي صياغة ثانية ما تشتغل إلا إذا كتبتها ووافقت عليها هنا، وبعد ما يعتمد ميتا قالبها على الرقمين. كل صياغة تتجرب على حوالي 20 عميل، والفايزة تنرسل 8 من كل 10.</p>'
      +kindBox('visit_step1')+kindBox('request_followup');
  }
  function draw(){const el=document.getElementById('cfvBox');if(el)el.innerHTML=html();}
  // called by crm-followups-today.js after every draw of the list
  function mount(box){
    let el=box.querySelector('#cfvBox');
    const show=isOwner()&&!box.hidden&&(!!box.querySelector('.cfu-toggle[aria-expanded="true"]')||(!!box.closest('#cohSheetBody')&&!box.querySelector('.cfu-toggle')));
    if(!show){if(el)el.remove();return;}
    if(!el){el=document.createElement('div');el.id='cfvBox';el.className='cfv';box.append(el);}
    el.innerHTML=html();
  }
  async function load(){
    if(typeof supa==='undefined'||!isOwner())return;
    loading=true;draw();
    const n=++seq,r=await supa.rpc('crm_followup_variant_results');
    if(n!==seq)return;
    loading=false;data=r.error?null:r.data;draw();
  }
  async function save(kind){
    const text=String(drafts[kind]||'').trim();errs[kind]='';
    if(text.length<8){errs[kind]='اكتب الصياغة أولاً';draw();return;}
    busy=true;draw();
    try{
      const r=await supa.rpc('crm_followup_variant_save',{p_kind:kind,p_text:text});if(r.error)throw r.error;
      drafts[kind]='';toast('انحفظت الصياغة '+((r.data&&r.data.label)||'')+'. ما توصل لأحد لين تضغط «جرّبها»','success');
    }catch(e){errs[kind]=errText(e);}
    busy=false;await load();
  }
  const DONE={test:'انرسل قالبها لميتا. تشتغل أول ما يعتمد على الرقمين، ولين وقتها تنرسل A',submit:'انرسل القالب لميتا مرة ثانية',winner:'تثبتت فايزة: 8 من كل 10',unwinner:'رجعت للتجربة',retire:'توقفت، واللي ينتظرون عليها رجعوا لـ A'};
  async function act(action,id){
    const k=action+':'+id;
    // «جرّبها»، «ثبّتها فايزة» and «وقفها» change what customers get, so they take a second tap
    if(action!=='submit'&&armed!==k){armed=k;clearTimeout(armTimer);armTimer=setTimeout(()=>{armed='';draw();},6000);draw();return;}
    armed='';clearTimeout(armTimer);busy=true;draw();
    try{const r=await supa.rpc('crm_followup_variant_decide',{p_id:id,p_action:action});if(r.error)throw r.error;toast(DONE[action]||'تم','success');}
    catch(e){toast(errText(e),'error');}
    busy=false;await load();
  }
  document.addEventListener('click',e=>{
    const b=e.target.closest('[data-cfv]');if(!b)return;
    if(b.dataset.cfv==='toggle'){open=!open;draw();if(open)load().catch(()=>{});return;}
    if(busy)return;
    if(b.dataset.cfv==='save'){save(b.dataset.kind);return;}
    if(b.dataset.cfv==='act')act(b.dataset.a,b.dataset.id);
  });
  document.addEventListener('input',e=>{const t=e.target;if(t&&t.classList&&t.classList.contains('cfv-text'))drafts[t.dataset.kind]=t.value;});
  window.crmFollowupVariantsMount=mount;
})();
