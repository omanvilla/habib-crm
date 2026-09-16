(function(){
  function el(id){return document.getElementById(id)}
  function money(v,short){
    if(v===null||v===undefined||v==='')return '';
    var n=Number(v);if(!Number.isFinite(n))return String(v);
    if(short){
      if(n>=1000000)return (Math.round(n/100000)/10)+'م';
      if(n>=1000)return (Math.round(n/100)/10)+'ألف';
      return n.toLocaleString('en-US');
    }
    return n.toLocaleString('en-US')+' ر.ع';
  }
  function budgetText(min,max,short){
    var hasMin=min!==null&&min!==undefined&&min!==''&&Number(min)>0;
    var hasMax=max!==null&&max!==undefined&&max!==''&&Number(max)>0;
    if(!hasMin&&!hasMax)return '—';
    if(hasMin&&hasMax){
      if(Number(min)===Number(max))return money(max,short);
      return money(min,short)+' — '+money(max,short);
    }
    if(hasMax)return 'حتى '+money(max,short);
    return 'من '+money(min,short);
  }
  window.crmBudgetText=budgetText;

  var oldWaSummary=window.waRequestSummary;
  if(typeof oldWaSummary==='function'){
    window.waRequestSummary=function(r){
      var type=({buyer:'شراء',seller:'بيع',tenant:'استئجار',landlord:'تأجير',consultation:'استشارة',investor:'استثمار'})[r.request_type]||r.request_type||'طلب';
      var areas=(r.preferred_areas&&r.preferred_areas.length?r.preferred_areas.join('، '):(r.preferred_area||''));
      var b=budgetText(r.budget_min,r.budget_max,true);if(b==='—')b='';
      return [type,areas,b].filter(Boolean).join(' · ');
    };
  }

  function fixClientListBudgets(){
    try{
      if(typeof allClients==='undefined'||!Array.isArray(allClients))return;
      var list=el('clientsList');if(!list)return;
      var byId={};allClients.forEach(function(c){byId[c.id]=c});
      list.querySelectorAll('[onclick*="viewClient("]').forEach(function(node){
        var s=node.getAttribute('onclick')||'',m=s.match(/viewClient\('([^']+)'\)/);if(!m||!byId[m[1]])return;
        var c=byId[m[1]],txt=budgetText(c.budget_min,c.budget_max,true);
        if(node.tagName==='TR'&&node.children&&node.children.length>=5){node.children[4].textContent=txt;}
        else if(node.classList&&node.classList.contains('mobile-record-card')){
          var meta=node.querySelector('.mobile-record-meta');if(meta){var old=meta.querySelector('[data-smart-budget]');if(old)old.remove();var sp=document.createElement('span');sp.dataset.smartBudget='1';sp.textContent='الميزانية: '+txt;meta.appendChild(sp);}
        }
      });
    }catch(e){console.warn('[budget display clients]',e)}
  }
  var oldRenderClients=window.renderClients;
  if(typeof oldRenderClients==='function')window.renderClients=function(){var r=oldRenderClients.apply(this,arguments);setTimeout(fixClientListBudgets,0);return r};

  function fixClientInfoBudget(){
    try{
      if(typeof viewingClient==='undefined'||!viewingClient)return;
      var root=el('cdTabInfo');if(!root)return;
      root.querySelectorAll('.info-row').forEach(function(row){var l=row.querySelector('.info-label'),v=row.querySelector('.info-value');if(l&&v&&(l.textContent||'').indexOf('الميزانية')>=0)v.textContent=budgetText(viewingClient.budget_min,viewingClient.budget_max,false);});
    }catch(e){console.warn('[budget display info]',e)}
  }
  var oldRenderInfo=window.renderClientInfo;
  if(typeof oldRenderInfo==='function')window.renderClientInfo=function(){var r=oldRenderInfo.apply(this,arguments);fixClientInfoBudget();return r};

  async function fixRequestCards(){
    try{
      if(typeof viewingClient==='undefined'||!viewingClient)return;
      var root=el('cdTabRequests');if(!root)return;
      var q=await supa.from('client_requests').select('id,budget_min,budget_max').eq('client_id',viewingClient.id).order('created_at',{ascending:false});
      if(q.error)return;
      var cards=Array.from(root.children).slice(1);
      (q.data||[]).forEach(function(r,i){var card=cards[i];if(!card)return;var txt=budgetText(r.budget_min,r.budget_max,false);card.innerHTML=card.innerHTML.replace(/💰\s*[^<]*<br>/,'💰 '+(typeof escapeHtml==='function'?escapeHtml(txt):txt)+'<br>');});
    }catch(e){console.warn('[budget display requests]',e)}
  }
  var oldRenderRequests=window.renderClientRequestsTab;
  if(typeof oldRenderRequests==='function')window.renderClientRequestsTab=async function(){var r=await oldRenderRequests.apply(this,arguments);await fixRequestCards();return r};

  function fixDashHot(clients){
    try{
      var root=el('dashHotList');if(!root||!Array.isArray(clients))return;var byId={};clients.forEach(function(c){byId[c.id]=c});
      root.querySelectorAll('[onclick*="viewClient("]').forEach(function(row){var m=(row.getAttribute('onclick')||'').match(/viewClient\('([^']+)'\)/);if(!m||!byId[m[1]])return;var vals=row.children;if(vals&&vals.length>1)vals[vals.length-1].textContent=budgetText(byId[m[1]].budget_min,byId[m[1]].budget_max,true);});
    }catch(e){console.warn('[budget display dashboard]',e)}
  }
  var oldDashHot=window.renderDashHot;
  if(typeof oldDashHot==='function')window.renderDashHot=function(clients){var r=oldDashHot.apply(this,arguments);fixDashHot(clients);return r};
})();
