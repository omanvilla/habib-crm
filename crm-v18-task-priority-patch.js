(function(){
  'use strict';

  function byId(id){return document.getElementById(id)}
  function esc(v){
    if(typeof escapeHtml==='function')return escapeHtml(String(v==null?'':v));
    return String(v==null?'':v).replace(/[&<>\"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'})[c]})
  }
  function priorityRank(value){return value==='high'?0:value==='medium'?1:2}
  function sortTasks(rows){
    return (rows||[]).slice().sort(function(a,b){
      if(Boolean(a.done)!==Boolean(b.done))return a.done?1:-1;
      var pr=priorityRank(a.priority)-priorityRank(b.priority);if(pr!==0)return pr;
      var ad=a.due_date||'9999-12-31',bd=b.due_date||'9999-12-31';
      if(ad!==bd)return ad.localeCompare(bd);
      return String(a.created_at||'').localeCompare(String(b.created_at||''));
    })
  }
  function assigneeName(task){
    if(task.user&&task.user.full_name)return task.user.full_name;
    if(task.user_id&&typeof currentUser!=='undefined'&&currentUser&&task.user_id===currentUser.id&&typeof currentProfile!=='undefined'&&currentProfile)return currentProfile.full_name||'';
    var member=(typeof allMembers!=='undefined'&&allMembers||[]).find(function(x){return x.id===task.user_id});
    return member&&member.full_name||'';
  }
  function hydrateAssignees(rows){
    (rows||[]).forEach(function(t){var name=assigneeName(t);if(name)t.user={full_name:name}});
    return rows||[]
  }
  function priorityText(p){return p==='high'?'🔴 عاجلة':p==='low'?'⚪ منخفضة':'🟡 متوسطة'}
  function dueText(task){
    if(!task.due_date)return 'غير محدد';
    var d=typeof daysUntil==='function'?daysUntil(task.due_date):null;
    if(d===null)return typeof fmtDate==='function'?fmtDate(task.due_date):task.due_date;
    if(d<0)return 'متأخرة '+(-d)+' يوم';
    if(d===0)return 'اليوم';
    return 'بعد '+d+' يوم'
  }
  function taskNotes(task){return String(task.notes||'').trim()}

  window.taskPriorityRank=priorityRank;
  window.sortTasksByActionPriority=sortTasks;

  function ensureDetailsModal(){
    if(byId('mTaskDetails'))return;
    var wrap=document.createElement('div');
    wrap.className='modal-ov';wrap.id='mTaskDetails';
    wrap.innerHTML='<div class="modal-box"><div class="modal-head"><div class="modal-title">📌 تفاصيل المهمة</div><button class="modal-x" onclick="closeModal(\'mTaskDetails\')">×</button></div><div id="taskDetailsBody"></div><div class="modal-actions"><button class="btn-secondary" onclick="closeModal(\'mTaskDetails\')">إغلاق</button><button class="btn-secondary" id="taskDetailsClientBtn" style="display:none" onclick="openTaskDetailsClient()">👤 فتح العميل</button><button class="btn-primary" id="taskDetailsEditBtn" style="display:none" onclick="editTaskFromDetails()">✏️ تعديل المهمة</button></div></div>';
    document.body.appendChild(wrap)
  }

  window.viewingTaskDetails=null;
  window.openTaskDetails=async function(id){
    ensureDetailsModal();
    var task=(typeof allTasks!=='undefined'&&allTasks||[]).find(function(x){return x.id===id})||null;
    try{
      if(!task){
        var tr=await supa.from('tasks').select('*, client:clients(name,phone)').eq('id',id).single();
        if(tr.error)throw tr.error;task=tr.data
      }
      hydrateAssignees([task]);
      var request=null;
      if(task.request_id){
        var rr=await supa.from('client_requests').select('id,request_type,pipeline_stage,next_action,followup_note,preferred_area,land_size_min,land_size_max,needs_human_review').eq('id',task.request_id).maybeSingle();
        if(!rr.error)request=rr.data
      }
      window.viewingTaskDetails={task:task,request:request};
      var html='<div style="background:var(--cream);border:1px solid var(--cream-deeper);border-radius:12px;padding:15px;line-height:1.8"><div style="font-size:16px;font-weight:800;color:var(--espresso);margin-bottom:10px">'+esc(task.title)+'</div><div>📅 <strong>الاستحقاق:</strong> '+esc(dueText(task))+'</div><div>🎯 <strong>الأولوية:</strong> '+priorityText(task.priority)+'</div>';
      if(task.client&&task.client.name)html+='<div>👤 <strong>العميل:</strong> '+esc(task.client.name)+(task.client.phone?' · '+esc(task.client.phone):'')+'</div>';
      var responsible=assigneeName(task);if(responsible)html+='<div>👨‍💼 <strong>المسؤول:</strong> '+esc(responsible)+'</div>';
      html+='</div>';
      if(taskNotes(task))html+='<div style="margin-top:14px"><div class="fl" style="margin-bottom:6px">التفاصيل المطلوبة</div><div style="background:#FFF7ED;border:1px solid #FED7AA;border-radius:12px;padding:14px;line-height:1.9;color:#7C2D12">'+esc(taskNotes(task))+'</div></div>';
      if(request&&request.followup_note)html+='<div style="margin-top:14px"><div class="fl" style="margin-bottom:6px">تنبيه النظام</div><div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:12px;padding:14px;line-height:1.9;color:#991B1B">'+esc(request.followup_note)+'</div></div>';
      if(request)html+='<div style="font-size:11px;color:var(--umber);margin-top:12px">الإجراء التالي: '+esc(request.next_action||'—')+(request.needs_human_review?' · يتطلب تحققًا بشريًا':'')+'</div>';
      byId('taskDetailsBody').innerHTML=html;
      byId('taskDetailsClientBtn').style.display=task.client_id?'':'none';
      byId('taskDetailsEditBtn').style.display=typeof canEdit==='function'&&canEdit()?'':'none';
      byId('mTaskDetails').classList.add('on')
    }catch(err){if(typeof showToast==='function')showToast('تعذر فتح تفاصيل المهمة: '+(err.message||err),'error')}
  };
  window.openTaskDetailsClient=function(){
    var x=window.viewingTaskDetails;if(!x||!x.task.client_id)return;
    closeModal('mTaskDetails');viewClient(x.task.client_id)
  };
  window.editTaskFromDetails=function(){
    var x=window.viewingTaskDetails;if(!x)return;
    closeModal('mTaskDetails');editTask(x.task.id)
  };

  function renderCard(task,compact){
    var d=task.due_date&&typeof daysUntil==='function'?daysUntil(task.due_date):null;
    var overdue=d!==null&&d<0;
    var name=assigneeName(task);
    var html='<div class="task-item '+(task.done?'done':'')+'" style="cursor:pointer" onclick="openTaskDetails(\''+task.id+'\')"><div class="task-check '+(task.done?'done':'')+'" onclick="event.stopPropagation();toggleTask(\''+task.id+'\','+(!task.done)+')">'+(task.done?'✓':'')+'</div><div class="task-content"><div class="task-title">'+esc(task.title)+'</div>';
    if(taskNotes(task))html+='<div style="font-size:11px;color:var(--umber);margin-top:5px;line-height:1.6">'+esc(taskNotes(task))+'</div>';
    html+='<div class="task-meta">';
    if(task.due_date)html+='<span class="task-due '+(overdue?'overdue':'')+'">📅 '+esc(dueText(task))+'</span>';
    html+='<span class="task-priority tp-'+(task.priority==='high'?'high':task.priority==='low'?'low':'med')+'">'+priorityText(task.priority)+'</span>';
    if(task.client&&task.client.name)html+='<span>👤 العميل: '+esc(task.client.name)+'</span>';
    if(name)html+='<span>👨‍💼 المسؤول: '+esc(name)+'</span>';
    html+='</div></div>';
    if(compact)html+='<span style="color:var(--gold);font-size:18px">‹</span>';
    else html+='<div class="task-actions"><span onclick="event.stopPropagation();editTask(\''+task.id+'\')" title="تعديل">✏️</span><span onclick="event.stopPropagation();deleteTask(\''+task.id+'\')" title="حذف">🗑</span></div>';
    return html+'</div>'
  }

  window.renderDashTasks=function(tasks){
    var card=byId('dashTasksCard'),list=byId('dashTasksList');if(!list)return;
    var rows=sortTasks(tasks);
    if(!rows.length){if(card)card.style.display='none';list.innerHTML='';return}
    if(card)card.style.display='';list.innerHTML=rows.map(function(t){return renderCard(t,true)}).join('')
  };

  window.renderTasks=function(){
    var list=byId('tasksList');if(!list)return;
    var rows=(typeof allTasks!=='undefined'?allTasks:[]);
    if(taskFilter==='today')rows=rows.filter(function(t){return !t.done&&t.due_date&&daysUntil(t.due_date)===0});
    else if(taskFilter==='overdue')rows=rows.filter(function(t){return !t.done&&t.due_date&&daysUntil(t.due_date)<0});
    else if(taskFilter==='upcoming')rows=rows.filter(function(t){return !t.done&&t.due_date&&daysUntil(t.due_date)>0});
    else if(taskFilter==='done')rows=rows.filter(function(t){return t.done});
    else rows=rows.filter(function(t){return !t.done});
    rows=sortTasks(rows);
    if(byId('dailySub'))byId('dailySub').textContent=rows.length+' مهمة · العاجلة أولاً';
    if(!rows.length){list.innerHTML='<div class="empty"><div class="empty-ico">⏰</div><div class="empty-title">لا توجد مهام</div>'+(typeof canEdit==='function'&&canEdit()?'<button class="btn-primary" style="margin-top:14px;width:auto;padding:10px 22px" onclick="openModal(\'mTask\')">+ مهمة جديدة</button>':'')+'</div>';return}
    list.innerHTML=rows.map(function(t){return renderCard(t,false)}).join('')
  };

  window.loadTasks=async function(){
    var list=byId('tasksList');if(list)list.innerHTML='<div class="empty"><div class="loader-spinner"></div></div>';
    try{
      var r=await supa.from('tasks').select('*, client:clients(name,phone)');
      if(r.error){r=await supa.from('tasks').select('*');if(r.error)throw r.error}
      allTasks=sortTasks(hydrateAssignees(r.data||[]));
      window.renderTasks()
    }catch(err){
      if(list)list.innerHTML='<div class="empty"><div class="empty-ico">⚠️</div><div class="empty-title">خطأ في تحميل المهام</div><div class="empty-desc">'+esc(err.message||err)+'</div><button class="btn-primary" style="margin-top:14px;width:auto;padding:9px 18px" onclick="loadTasks()">🔄 إعادة المحاولة</button></div>'
    }
  };

  var previousDashboard=window.loadDashboard;
  if(typeof previousDashboard==='function')window.loadDashboard=async function(){
    var result=await previousDashboard.apply(this,arguments);
    try{
      var r=await supa.from('tasks').select('*, client:clients(name,phone)').eq('done',false).limit(100);
      if(r.error)throw r.error;
      var rows=sortTasks(hydrateAssignees(r.data||[]));
      window.renderDashTasks(rows.slice(0,6));
      var nav=byId('navTasksCount');if(nav){nav.textContent=rows.length;nav.style.display=rows.length?'':'none'}
    }catch(err){console.warn('[Task priority patch]',err)}
    return result
  };

  ensureDetailsModal();
})();
