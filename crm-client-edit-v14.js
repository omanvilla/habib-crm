/* The list passes an ID; the historical detail editor accepts no arguments.
 * Resolve that ID under current RLS before invoking the existing edit form. */
(function(){
 'use strict';
 let seq=0;
 const original=window.editClient;
 async function loadAndEdit(id){
  if(!canEdit()){showPermissionDenied();return;}
  const generation=crmSessionGeneration,user=currentUser?.id,token={},operation=++seq;
  if(!user)return;
  // Share the existing selection guard so later navigation supersedes this edit.
  viewClient.crmReadToken=token;
  const current=()=>operation===seq&&crmSessionCurrent(generation,user)&&viewClient.crmReadToken===token&&canEdit();
  try{
   const r=await supa.from('clients').select('*, agent:profiles!clients_assigned_to_fkey(full_name)').eq('id',id).single();
   if(!current())return;
   if(r.error||!r.data||r.data.id!==id)throw r.error||new Error('Missing or mismatched client');
   viewingClient=r.data;
   return original();
  }catch(error){if(current()){console.warn('client_list_edit_failed',error);showToast('تعذر فتح بيانات هذا العميل للتعديل. لم تتغير أي بيانات؛ أعد المحاولة.','error');}}
 }
 window.editClient=function(id){if(!canEdit()){showPermissionDenied();return;}if(!id)return original.apply(this,arguments);return loadAndEdit(id);};
 const reset=window.crmResetOperations;
 window.crmResetOperations=function(){seq++;return reset.apply(this,arguments);};
})();
