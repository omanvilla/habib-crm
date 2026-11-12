'use strict';
// 12 Nov 2026 (Ahmed, part two): the voice button on every free-text box of the CRM, the same button and the same
// transcription everywhere, for the owner and for staff. Short boxes get none. The text is typed into the box and saved
// only by the form's own button; a failed transcription keeps the recording.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=p=>fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
const voice=read('crm-voice-input.js'),base=read('app-base-v15.html'),index=read('index.html'),fn=read('supabase/functions/crm-voice-transcribe/index.ts');
const modules=['crm-claude-note.js','crm-deal-workflow.js','crm-quick-visit.js','crm-rented-units.js','crm-investment-projects.js','crm-reply-approvals.js',
  'crm-followups-today.js','crm-followup-variants.js','crm-property-archive.js','crm-owner-home.js','crm-price-studies.js'].map(read).join('\n');
const all=base+'\n'+modules+'\n'+voice;
const boxes=vm.runInNewContext(voice.match(/const BOXES=\[[\s\S]*?\]\.join\(','\);/)[0]+';BOXES').split(',');

test('every free-text box of the CRM is on the list, and every id on the list is a real box',()=>{
  const ids=['cnText','cNotes','aText','ifNote','crmAskTextBox','pDesc','pPublicDetails','pRentedUnitsText','pdDecisionNote','pmNotes','piRejectNotes','piLastMessage','piFollowupNote',
    'vOwnerNote','vOutcomeNote','vNotes','cqvNote','dLostReasonNote','dNotes','dwLostWords','dwNotes','dpLegalNotes','dpNotes','tNotes','evNotes','oNotes','exNotes','waMsgArea','ipNotes'];
  for(const id of ids){assert(boxes.includes('#'+id),id+' has the button');assert(new RegExp('<textarea[^>]*\\bid="'+id+'"').test(all),id+' is a text box in the source');}
  assert.deepEqual(boxes.filter(b=>b.startsWith('#')).map(b=>b.slice(1)).sort(),ids.slice().sort(),'no id on the list that is not checked here');
  for(const cls of ['rp-instr-text','cfu-instr-text','rp-text','rp-rule-reply','rp-variant-reply','cfv-text'])
    {assert(boxes.some(b=>b.endsWith('.'+cls)),cls);assert(new RegExp('<textarea[^>]*class="[^"]*\\b'+cls+'\\b').test(all),cls+' is a text box in the source');}
  for(const attr of ['data-insp-note','data-cps-note','data-cps-msg','data-pf-text'])
    {assert(boxes.includes('textarea['+attr+']'),attr);assert(new RegExp('<textarea[^>]*\\b'+attr+'=').test(all),attr+' is a text box in the source');}
  assert(boxes.includes('.cpa-field textarea')&&modules.includes('<label class="cpa-field"><span data-cpa-note-label>ملاحظة (اختياري)</span><textarea'));
});
test('no text box of the logged-in CRM is left without the button, except the ones left out on purpose',()=>{
  // left out: the chat reply box (its own 🎤 sends a voice note to the customer), the public request form (no account),
  // the Instagram link box and the read-only link to copy
  const out=['waInboxMessage','lfNotes','cfLinksInput','cfWaUrl'];
  for(const id of out)assert(!boxes.includes('#'+id),id);
  const funnel=read('crm-funnel.js');
  const found=[...(base+'\n'+modules+'\n'+funnel).matchAll(/<textarea([^>]*)>/g)].map(m=>m[1]);
  assert(found.length>=45,'the source was read: '+found.length+' text boxes');
  for(const attrs of found){
    const id=(attrs.match(/\bid="([A-Za-z0-9]+)"/)||[])[1],cls=((attrs.match(/class="([^"]*)"/)||[])[1]||'').split(/\s+/);
    const covered=(id&&(boxes.includes('#'+id)||out.includes(id)))||cls.some(c=>boxes.some(b=>b.endsWith('.'+c)))
      ||['data-insp-note','data-cps-note','data-cps-msg','data-pf-text'].some(a=>attrs.includes(a+'='))||/name="note"/.test(attrs)||/id="cfvT-'/.test(attrs)||/id="cfuI-'/.test(attrs);
    assert(covered,'a text box with no voice button and no reason: <textarea'+attrs.slice(0,90));
  }
});
test('one button, one transcription, nothing saved by the recording',()=>{
  new vm.Script(voice);
  assert.equal((voice.match(/supa\.functions\.invoke\(/g)||[]).length,1);
  assert(voice.includes("supa.functions.invoke('crm-voice-transcribe',{body:{audio:await toB64(blob),mime:blob.type}})"));
  assert.equal((voice.match(/className='btn-secondary voice-btn'/g)||[]).length,1,'the same button everywhere');
  assert(!/supa\.(rpc|from)\(/.test(voice),'the text only lands in the box');
  assert(voice.includes("if(!ta||ta.dataset.voice||ta.readOnly||ta.disabled)return;"),'no button on a box that cannot be written');
  assert(voice.includes("box.value=next;box.dispatchEvent(new Event('input',{bubbles:true}));box.focus();"));
  assert(voice.includes("if(max&&next.length>max){next=next.slice(0,max);"),'a box with a length limit never gets more than it can save');
  assert(voice.includes("}catch(e){\n      keep(btn,ta,blob);"),'a failed transcription keeps the recording');
  assert(voice.includes('التسجيل محفوظ تحت الخانة: اضغط «أعد التحويل» أو اسمعه واكتب بيدك'));
});
test('staff can dictate too: every active owner, manager or agent account, and nobody without an account',()=>{
  assert(fn.includes('if (!prof?.data || !["owner", "manager", "agent"].includes(prof.data.role) || prof.data.is_active === false) return json({ ok: false, error: "account_not_allowed" }, 403);'));
  assert(fn.includes('const u = jwt ? await db.auth.getUser(jwt) : null;'));
  assert(!fn.includes('"owner_only"'));
  // the way a recording becomes text is the one in use since 5 Nov: same models, same vocabulary hint, audio not stored
  assert(fn.includes('const MODEL = Deno.env.get("OPENAI_TRANSCRIBE_MODEL_V2") || "gpt-4o-transcribe";'));
  assert(fn.includes('" ملاحظة من أحمد وسيط عقاري عن ردود الواتساب للعملاء: فلل الشخاخيط،'));
  assert(!/storage|\.insert\(|\.upsert\(/.test(fn));
});
test('the follow-up reason is asked in a window that can hold the button, with the browser prompt as a fallback',()=>{
  assert(base.includes("var reason=typeof crmAskText==='function'?await crmAskText({title:'⏸ إيقاف تنبيهات المتابعة',label:reasonText,"));
  assert(base.includes(":prompt(reasonText);if(!reason||!reason.trim()||viewingClient!==client)return;"),'the client on screen must still be the one asked about');
  assert(voice.includes('window.crmAskText=function(o){'));
  assert(voice.includes("document.body.append(m);attach(box);box.focus();"));
  for(const f of ['crm-voice-input.js','crm-reply-approvals.css'])assert(index.includes(f+'?v=20261112-voice2'),f);
  assert(index.includes('app-base-v15.html?v=20261112-unit1'),'the base page moved on with the WhatsApp buttons of 12 Nov');
});
