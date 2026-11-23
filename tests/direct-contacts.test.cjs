// SQL151 (Ahmed 21 Nov 2026): «تواصل مباشر», people the agent never answers, kept out of «العقل موقوف عندهم».
const test=require('node:test'),assert=require('node:assert'),fs=require('fs');
const read=p=>fs.readFileSync(p,'utf8');
const fwd=read('db/changes/151-direct-contacts.forward.sql'),rb=read('db/changes/151-direct-contacts.rollback.sql'),ui=read('crm-owner-home.js'),index=read('index.html');

test('the migration and the supabase copy are the same',()=>{
  assert.equal(fwd,read('supabase/migrations/20261121110000_direct_contacts_20261121.sql'));
  assert(fwd.startsWith('-- SQL151 ('));
});
test('a direct chat is muted (the agent skips it) and leaves the paused list, the waiting buyers and the follow-ups',()=>{
  assert(fwd.includes("agent_muted = true, agent_muted_reason = 'تواصل مباشر: '"));
  assert(fwd.includes('and c.direct_contact_at is null'),'not in «العقل موقوف عندهم»');
  assert(fwd.includes("'AND w.ignored_at IS NULL AND w.direct_contact_at IS NULL'"),'not in «مشترين واقفين»');
  assert(fwd.includes('dw.direct_contact_at IS NOT NULL'),'not in «متابعة اليوم»');
  assert(fwd.includes("'direct', dir"),'the home gets the list');
});
test('«اتصال المكتب» goes there by itself; unmuting takes it out',()=>{
  assert(fwd.includes("coalesce(new.handoff_reason, '') ilike 'اتصال المكتب%'"));
  assert(fwd.includes("new.direct_contact_at := null; new.direct_contact_kind := null;"));
  assert(fwd.includes("CHECK (direct_contact_kind IS NULL OR direct_contact_kind IN ('owner', 'developer', 'office_call'))"));
  assert(rb.includes('DROP TRIGGER IF EXISTS crm_direct_contact_sync'));
});
test('staff act only on chats they can open',()=>{
  assert(fwd.includes('(v_owner or crm_repair_private.can_access_whatsapp_conversation(v_company, c.id))'));
  assert(fwd.includes('GRANT EXECUTE ON FUNCTION public.crm_set_direct_contact(uuid, boolean, text) TO authenticated;'));
});
test('the home: its own tile, the two buttons on a paused row, «رجّعه للعقل»',()=>{
  assert(ui.includes("t.push(tile('تواصل مباشر',dr.length,"));
  assert(ui.includes('data-coh="pdirect-owner"')&&ui.includes('data-coh="pdirect-developer"')&&ui.includes('data-coh="pundirect"'));
  assert(ui.includes("supa.rpc('crm_set_direct_contact'"));
  assert(/crm-owner-home\.js\?v=2026112[13]-direct\d/.test(index));
});
test('one person on both numbers is one row; «رجّعه للعقل» returns every chat of that row (Ahmed 23 Nov, Amir Tolba)',()=>{
  const a=ui.indexOf('const directItems=()=>{'),b=ui.indexOf('\n  };',a);
  const f=new Function('paused',ui.slice(a,b+4).replace('const directItems=','return ')+';')(null);
  const make=(rows)=>new Function('paused',ui.slice(a,b+4)+'\nreturn directItems();')({direct:rows});
  const rows=make([{conversation_id:'c2',client_id:'k1',phone:'+96890125738',route_key:'muscat',waiting:true,last_message:'يا هلا'},
    {conversation_id:'c1',client_id:'k1',phone:'+96890125738',route_key:'barka',waiting:false,last_message:'تم'},
    {conversation_id:'c3',client_id:'k2',phone:'+96890000001',route_key:'barka'}]);
  assert.equal(rows.length,2);assert.deepEqual(rows[0].ids,['c2','c1']);assert.deepEqual(rows[0].routes,['muscat','barka']);
  assert.equal(rows[0].last_message,'يا هلا');assert.equal(typeof f,'function');
  assert(ui.includes('data-coh="pundirect" data-id="\'+esc(i.ids.join(\',\'))'));
});
