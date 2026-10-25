/* Client arrival chronology: timestamps are read through caller RLS, never guessed or persisted. */
(function (root) {
  'use strict';
  const validTime = value => typeof value === 'string' && value.trim() && Number.isFinite(Date.parse(value));
  function arrival(client) {
    if (validTime(client.first_contact_at)) return {at:client.first_contact_at, source:client.first_contact_source, label:'أول تواصل مسجل'};
    return {at:validTime(client.created_at)?client.created_at:null, source:'record_created', label:'أُضيف للنظام · أول تواصل غير مسجل'};
  }
  function compare(a,b) {
    const time = c => {const value=arrival(c).at;return value?Date.parse(value):-Infinity;};
    const at=time(a),bt=time(b);
    if(at!==bt)return bt>at?1:-1;
    return String(a.id||'').localeCompare(String(b.id||''));
  }
  function format(value) {
    if(!validTime(value))return 'غير مسجل';
    const d=new Date(value),options={timeZone:'Asia/Muscat',numberingSystem:'latn'};
    return new Intl.DateTimeFormat('en-GB',{...options,day:'2-digit',month:'2-digit',year:'numeric'}).format(d)+' · '+new Intl.DateTimeFormat('en-GB',{...options,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(d);
  }
  async function enrich(clients,isCurrent=()=>true) {
    const known=new Map(),chunks=[];
    for(let start=0;start<clients.length;start+=400)chunks.push(clients.slice(start,start+400).map(c=>c.id));
    if(!isCurrent())return [];
    // Chunks are independent reads; run them together instead of one after another.
    const results=await Promise.all(chunks.map(ids=>supa.rpc('crm_client_first_contacts',{p_client_ids:ids})));
    if(!isCurrent())return [];
    for(let index=0;index<chunks.length;index++){
      const ids=chunks[index],allowed=new Set(ids),result=results[index];
      if(result.error||!Array.isArray(result.data)||result.data.length!==allowed.size)throw new Error('client_first_contact_read_failed');
      for(const row of result.data){
        if(!allowed.has(row.client_id)||known.has(row.client_id)||row.first_contact_at!==null&&!validTime(row.first_contact_at)||row.first_contact_at!==null&&!['whatsapp','instagram'].includes(row.first_contact_source))throw new Error('client_first_contact_result_invalid');
        known.set(row.client_id,row);
      }
    }
    return clients.map(c=>({...c,first_contact_at:known.get(c.id)?.first_contact_at??null,first_contact_source:known.get(c.id)?.first_contact_source??null}));
  }
  root.CRMClientChronology={arrival,compare,format,enrich};
})(typeof window==='object'?window:globalThis);
