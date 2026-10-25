/* Interface simplification, phase 1 (25 October 2026).
 * - Visits page renders as one row per visit, like the client/property grids.
 * - On phones, list pages show only the search box; the other filters open from one button.
 * - On phones, every .crm-grid table turns into compact cards labelled from its headers.
 * Data loading, permissions and actions are unchanged: rows call the existing
 * editViewing/deleteViewing/viewClient functions. */
(function(){
  'use strict';
  const esc=v=>typeof escapeHtml==='function'?escapeHtml(String(v==null?'':v)):String(v==null?'':v).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
  const byId=id=>document.getElementById(id);

  // ---- Visits as rows -------------------------------------------------------
  const statusLabels={scheduled:'مجدولة',done:'تمت',no_show:'لم يحضر',cancelled:'ألغيت',postponed:'تأجلت'};
  const groupTitles=['متأخرة وتحتاج نتيجة','اليوم','قادمة','سجلات سابقة'];
  function visitDate(v){
    if(!v.viewing_date)return '—';
    const d=new Date(String(v.viewing_date).slice(0,10)+'T12:00:00');
    if(isNaN(d))return String(v.viewing_date);
    return d.toLocaleDateString('ar-OM-u-nu-latn',{weekday:'short',day:'numeric',month:'short'});
  }
  function visitRow(v,today){
    const overdue=v.status==='scheduled'&&(v.viewing_date||'')<today,id=esc(v.id);
    const phone=v.client&&v.client.phone?String(v.client.phone).replace(/[^0-9+]/g,'').replace(/^\+/,''):'';
    const branch=typeof crmRecordBranchLabel==='function'?crmRecordBranchLabel(v):'';
    return '<tr'+(overdue?' class="crm-grid-late"':'')+'>'
      +'<td class="'+(overdue?'crm-grid-overdue':'')+'"><bdi>'+esc(visitDate(v))+'</bdi>'+(v.viewing_time?' <small dir="ltr">'+esc(String(v.viewing_time).slice(0,5))+'</small>':'')+(overdue?' <span class="crm-grid-chip crm-grid-chip-late">متأخرة</span>':'')+'</td>'
      +'<td class="crm-grid-name">'+esc(v.property&&v.property.title||'عقار غير محدد')+(v.property&&v.property.area?' <small>'+esc(v.property.area)+'</small>':'')+'</td>'
      +'<td>'+(v.client&&v.client_id?'<button type="button" class="crm-grid-link" onclick="viewClient(\''+esc(v.client_id)+'\')">'+esc(v.client.name)+'</button>':esc(v.client&&v.client.name||'—'))+'</td>'
      +'<td>'+esc(branch||'—')+'</td>'
      +'<td><span class="viewing-status '+esc(v.status)+'">'+esc(statusLabels[v.status]||v.status||'—')+'</span></td>'
      +'<td class="crm-grid-actions"><button type="button" class="ops-action" onclick="editViewing(\''+id+'\')">'+(overdue?'تسجيل النتيجة':'تعديل')+'</button>'
      +(phone?'<a class="ops-action" href="https://api.whatsapp.com/send?phone='+esc(phone)+'" target="_blank" rel="noopener">واتساب</a>':'')
      +'<button type="button" class="ops-action crm-grid-danger" onclick="deleteViewing(\''+id+'\')">حذف</button></td></tr>';
  }
  if(typeof window.renderViewings==='function'){
    window.renderViewings=function(){
      const list=byId('viewingsList');if(!list)return;
      const today=typeof toLocalDateStr==='function'?toLocalDateStr(new Date()):new Date().toISOString().slice(0,10);
      const tab=typeof viewingTab==='undefined'?'all':viewingTab,all=typeof allViewings==='undefined'?[]:allViewings;
      let rows=all;
      if(tab==='upcoming')rows=all.filter(v=>v.status==='scheduled'&&(v.viewing_date||'')>=today);
      else if(tab==='overdue')rows=all.filter(v=>v.status==='scheduled'&&(v.viewing_date||'')<today);
      else if(tab==='today')rows=all.filter(v=>(v.viewing_date||'').substring(0,10)===today);
      else if(tab==='done')rows=all.filter(v=>v.status==='done');
      else if(tab==='no_show')rows=all.filter(v=>v.status==='no_show');
      if(!rows.length){list.innerHTML='<div class="empty"><div class="empty-ico">👁</div><div class="empty-title">لا توجد زيارات</div><div class="empty-desc">اضغط «زيارة جديدة» لجدولة زيارة لعميل.</div></div>';return;}
      const group=v=>v.status==='scheduled'?(v.viewing_date<today?0:v.viewing_date===today?1:2):3;
      rows=[...rows].sort((a,b)=>group(a)-group(b)||(group(a)===3?String(b.viewing_date||'').localeCompare(String(a.viewing_date||'')):String(a.viewing_date||'').localeCompare(String(b.viewing_date||'')))||String(a.viewing_time||'').localeCompare(String(b.viewing_time||'')));
      let body='',last=-1;
      for(const v of rows){
        const g=group(v);
        if(tab==='all'&&g!==last){body+='<tr class="crm-grid-group"><td colspan="6">'+groupTitles[g]+'</td></tr>';last=g;}
        body+=visitRow(v,today);
      }
      list.innerHTML='<div class="crm-grid-wrap"><table class="crm-grid" aria-label="قائمة الزيارات"><thead><tr><th>الموعد</th><th>العقار</th><th>العميل</th><th>الفرع</th><th>الحالة</th><th>إجراءات</th></tr></thead><tbody>'+body+'</tbody></table></div>';
    };
  }

  // ---- Phone layout: search first, other filters behind one button ---------
  const FILTERS=['uiClientFilters','opsPropertyFilters'];
  function activeCount(box){
    return [...box.querySelectorAll('select')].filter(s=>s.selectedIndex>0).length;
  }
  function syncToggle(box,button){
    const n=activeCount(box),open=box.classList.contains('crm-filters-open');
    button.textContent=open?'إخفاء الفلاتر':'الفلاتر'+(n?' ('+n+')':'');
    button.setAttribute('aria-expanded',String(open));
  }
  function enhanceFilters(){
    for(const id of FILTERS){
      const box=byId(id);if(!box||box.dataset.crmToggle)continue;
      box.dataset.crmToggle='1';box.classList.add('crm-filter-target');
      const button=document.createElement('button');button.type='button';button.className='crm-filter-toggle btn-secondary';
      box.after(button);syncToggle(box,button);
      button.addEventListener('click',()=>{box.classList.toggle('crm-filters-open');const panel=box.closest('.ws-filter-panel');if(panel)panel.classList.toggle('crm-filters-open',box.classList.contains('crm-filters-open'));syncToggle(box,button);});
      box.addEventListener('change',()=>syncToggle(box,button));
    }
  }

  // ---- Phone layout: label each grid cell from its column header ------------
  // Rows appended later ("show more") are labelled too: only unlabelled rows are touched.
  function labelGrids(root){
    for(const table of root.querySelectorAll('table.crm-grid')){
      const heads=[...table.querySelectorAll('thead th')].map(th=>th.textContent.trim());
      for(const tr of table.querySelectorAll('tbody tr:not([data-labelled])')){
        [...tr.children].forEach((td,i)=>{if(heads[i]&&td.colSpan===1)td.dataset.label=heads[i];});
        tr.dataset.labelled='1';
      }
    }
  }
  const LISTS=['clientsList','propertiesList','tasksList','viewingsList'];
  let pending=0;
  const observer=new MutationObserver(()=>{if(pending)return;pending=requestAnimationFrame(()=>{pending=0;for(const id of LISTS){const el=byId(id);if(el)labelGrids(el);}});});
  function watchLists(){
    for(const id of LISTS){const el=byId(id);if(el&&!el.dataset.crmWatched){el.dataset.crmWatched='1';observer.observe(el,{childList:true,subtree:true});labelGrids(el);}}
  }

  function refresh(){enhanceFilters();watchLists();}
  const nav=window.navigate;
  if(typeof nav==='function')window.navigate=function(){const result=nav.apply(this,arguments);setTimeout(refresh,0);return result;};
  refresh();setTimeout(refresh,1500);
})();
