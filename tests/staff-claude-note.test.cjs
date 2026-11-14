'use strict';
// R58 (14 Nov 2026, Ahmed: «الموظفين أريدهم نفس الشيء، يكون عندهم نفس الزر مالي… يكون بالمرة موجود في كل مكان»):
// «ملاحظة لـ Claude» for the owner and the staff, beside the two WhatsApp buttons everywhere; SQL103 lets staff save
// and marks every note with who wrote it.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=f=>fs.readFileSync(f,'utf8').replace(/\r\n/g,'\n');
const note=read('crm-claude-note.js'),wa=read('crm-wa-buttons.js'),css=read('crm-wa-buttons.css'),index=read('index.html');
const sql=read('db/changes/103-staff-claude-note.forward.sql'),rb=read('db/changes/103-staff-claude-note.rollback.sql');

function page(role,active){
  const listeners=[];
  const ctx={window:{},navigator:{userAgent:'Windows'},currentProfile:role?{role,company_id:'co',is_active:active}:null,
    document:{addEventListener(type,fn,capture){listeners.push({type,capture:!!capture});},querySelector(){return null;},querySelectorAll(){return [];},getElementById(){return null;},body:{}},
    MutationObserver:class{observe(){}}};
  vm.createContext(ctx);vm.runInContext(wa,ctx);vm.runInContext(note,ctx);
  return {w:ctx.window,listeners};
}

test('the note button is drawn for the owner, a manager and an agent, and for nobody else',()=>{
  for(const role of ['owner','manager','agent']){
    const h=page(role).w.crmClaudeNoteBtn({conv:'c1',name:'سالم'});
    assert(h.includes('data-cn-any="1"')&&h.includes('data-conv="c1"')&&h.includes('data-name="سالم"')&&h.includes('>ملاحظة لـ Claude</button>'),role);
  }
  assert.equal(page('viewer').w.crmClaudeNoteBtn({conv:'c1'}),'','a viewer gets none');
  assert.equal(page(null).w.crmClaudeNoteBtn({conv:'c1'}),'','nobody signed in');
  assert.equal(page('agent',false).w.crmClaudeNoteBtn({conv:'c1'}),'','a stopped account gets none');
  assert.equal(page('agent').w.crmClaudeNoteBtn({}),'','no chat, client or number: no button');
  assert(!/isOwner/.test(note),'nothing in the note module is behind the owner role any more');
});

test('everywhere the two WhatsApp buttons are, the note button is beside them',()=>{
  const w=page('agent').w;
  const h=w.crmWaButtons({phone:'96890000000',conversationId:'c1',clientId:'k1',cls:'btn-secondary coh-go'});
  assert(h.includes('فتح في واتساب الجوال')&&h.includes('فتح في النظام'));
  assert(h.endsWith('<button type="button" class="crm-wa-btn crm-wa-note coh-go" data-cn-any="1" data-conv="c1" data-client="k1" data-phone="96890000000" data-name="">ملاحظة لـ Claude</button>'));
  const s=w.crmWaButtons({clientId:'k1',cls:'btn-secondary crm-wa-small'});
  assert(s.includes('class="crm-wa-btn crm-wa-note crm-wa-sm"')&&s.includes('title="ملاحظة لـ Claude"')&&s.includes('>ملاحظة</button>'),'narrow cards and table rows: the short word');
  assert(w.crmWaButtons({phone:'+968 9000 0000',size:'sm'}).includes('data-cn-any="1" data-conv="" data-client="" data-phone="96890000000"'),'an owner row: by the number');
  assert(!w.crmWaButtons({conversationId:'c1',note:false}).includes('data-cn-any'),'a place with its own note button asks for none');
  assert.equal(w.crmWaButtons({}),'');
  assert(!page('viewer').w.crmWaButtons({conversationId:'c1'}).includes('data-cn-any'));
  // the callers: every list that opens a chat goes through crmWaButtons
  for(const f of ['crm-hot-alerts.js','crm-owner-home.js','crm-owner-leads.js','crm-reply-approvals.js','crm-investment-projects.js','crm-calls-meetings.js','crm-price-studies.js','crm-simple-ui.js','app-base-v15.html'])
    assert(read(f).includes('crmWaButtons('),f);
});

test('the places with their own buttons: paused chats, daily follow-ups, the open chat, approvals, the client file',()=>{
  const home=read('crm-owner-home.js'),fu=read('crm-followups-today.js');
  assert(home.includes("clientId:i.client_id,cls:'btn-secondary coh-go',note:false})"),'paused chats keep their own button (it carries the pause reason)');
  assert(home.includes(`+'<button type="button" class="btn-secondary coh-go" data-coh="pnote"`),'and staff see it');
  assert.equal((home.match(/note:false/g)||[]).length,1,'the ignored list takes the button from the pair');
  assert(fu.includes("window.crmClaudeNoteBtn({conv:i.conversation_id,client:i.client_id,phone:i.phone,name:i.client})"),'daily follow-ups');
  assert(note.includes('function decorateChat(){\n    if(!canNote())return;')&&note.includes('function decorateCards(){\n    if(!canNote())return;'));
  assert(note.includes("document.querySelectorAll('#page-replies .rp-card:not(.ol-card)')")&&note.includes("card.querySelectorAll('[data-cn-any]').forEach(x=>x.remove());"),'an approval card has one note button, the one that knows the draft');
  assert(note.includes("crm.insertAdjacentHTML('afterend',window.crmClaudeNoteBtn({client:viewingClient.id,name:viewingClient.name}));"),'client file');
});

test('pressing it finds the chat among the chats the account may see, and no card opens under it',()=>{
  const p=page('agent');
  assert(p.listeners.some(l=>l.type==='click'&&l.capture),'listens in the capture phase (deal cards stop the click)');
  assert(note.includes('e.preventDefault();e.stopPropagation();'));
  assert(note.includes("supa.from('whatsapp_conversations').select('id,customer_name,customer_phone,client_id')"));
  assert(note.includes("conversation_id:chat?chat.id:null"),'no visible chat: the note is saved on the client, never on a chat id the account cannot read');
  assert(note.includes("by_staff:currentProfile.role!=='owner'"));
});

test('the look and the versions',()=>{
  assert(css.includes('.crm-wa-note{')&&/\.crm-wa-note\{[^}]*--crm-wa-svg:url\(/.test(css),'its own line icon, never an empty square');
  for(const f of ['crm-claude-note.js','crm-followups-today.js'])assert(index.includes(f+'?v=20261114-note1'),f);
  for(const f of ['crm-wa-buttons.js','crm-wa-buttons.css'])assert(index.includes(f+'?v=20261114-note2'),f);
  // seen in the signed-in browser on 14 Nov: a sixth action made the visits table's fixed actions column cover the status
  // column on a medium screen, so there the table keeps its five actions
  assert(/@media \(min-width:641px\) and \(max-width:1400px\)\{[^@]*#page-viewings \.crm-grid \.crm-grid-actions \.crm-wa-note\{display:none!important\}/.test(css));
  // and «النظام» on a deal card did nothing (the card stops the click): the pair listens in the capture phase too
  assert(wa.includes("if(crm){e.preventDefault();e.stopPropagation();window.crmOpenCrmChat(")&&wa.includes("if(ph){e.preventDefault();e.stopPropagation();ph.disabled=true;")&&/\n  \},true\);\n\}\)\(\);\s*$/.test(wa));
  assert(/crm-owner-home\.js\?v=20261114-/.test(index));
  assert(index.indexOf('crm-wa-buttons.js?v=')<index.indexOf('crm-claude-note.js?v='));
});

test('SQL103: staff may save a note under their own name; reading stays the owner\'s; the lessons are not touched',()=>{
  assert.equal(sql,read('supabase/migrations/20261114160000_staff_claude_note_20261114.sql'));
  assert(sql.startsWith('-- SQL103 ('));
  assert(sql.includes('CREATE POLICY "staff write notes" ON public.crm_owner_notes FOR INSERT TO authenticated'));
  assert(sql.includes("p.role IN ('owner', 'manager', 'agent') AND p.is_active IS NOT FALSE"));
  assert(sql.includes('created_by = auth.uid()'),'a note is never saved under someone else');
  assert(sql.includes('WHERE w.id = crm_owner_notes.conversation_id AND w.company_id = crm_owner_notes.company_id'),'only on a chat the account may see');
  assert(sql.includes('IF me IS NOT NULL THEN NEW.created_by := me; END IF;'));
  assert(sql.includes("jsonb_build_object('by_staff', COALESCE(v_role, '') <> 'owner')")&&sql.includes("jsonb_build_object('by_role', v_role, 'by_name', v_name)"));
  assert(sql.includes("IF me IS NOT NULL OR NOT (NEW.context ? 'by_staff') THEN"),'a function\'s note (R28) keeps the by_staff it carries');
  assert(sql.includes('CREATE TRIGGER trg_owner_note_stamp BEFORE INSERT ON public.crm_owner_notes'));
  const code=s=>s.split('\n').filter(l=>!l.startsWith('--')).join('\n');
  for(const s of [code(sql),code(rb)]){
    assert(!/FOR SELECT|FOR UPDATE|FOR DELETE|FOR ALL/.test(s),'no new way to read, change or delete notes');
    assert(!/rebuild_agent_lessons|compose_agent_brain|whatsapp_agent_prompts|ALTER TABLE|DROP TABLE|DELETE FROM|UPDATE public/.test(s),'the brain and the rows are not touched');
  }
  assert(rb.includes('CREATE POLICY "owner writes notes"')&&rb.includes('DROP TRIGGER IF EXISTS trg_owner_note_stamp')&&rb.includes('DROP FUNCTION IF EXISTS crm_repair_private.owner_note_stamp();'));
});

test('R58 is written down and R27 no longer keeps the note for Ahmed alone',()=>{
  const rules=read('docs/agent-rules.md');
  assert(/\| R58 \| \*\*«ملاحظة لـ Claude» للموظف وفي كل مكان/.test(rules));
  assert(rules.includes('«ملاحظة لـ Claude» لأحمد بس (انلغت بـ R58'));
});
