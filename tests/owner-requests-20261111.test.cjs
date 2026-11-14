'use strict';
// Ahmed, 11 Nov 2026: «دراسة سعر» chats in their own tile; a voice note can be discarded before sending.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const home=fs.readFileSync('crm-owner-home.js','utf8'),chat=fs.readFileSync('crm-whatsapp-chat.js','utf8'),css=fs.readFileSync('crm-whatsapp-chat.css','utf8');

test('pricing handoffs are split from the paused list by their reason only',()=>{
 const src=home.match(/const isPricing=[^\n]+/)[0];
 const isPricing=vm.runInNewContext(src+';isPricing');
 assert.equal(isPricing({reason:'دراسة سعر: مالك فيلا في الرميس'}),true);
 assert.equal(isPricing({reason:' دراسة  سعر بيت المعبيلة'}),true);
 assert.equal(isPricing({reason:'تفاوض: يبي ينزل السعر'}),false);
 assert.equal(isPricing({reason:'طلب اتصال: ...'}),false);
 assert.equal(isPricing({}),false);
 assert(home.includes("data-kind=\"pricing\"")&&home.includes("'دراسة سعر'"));
 assert.match(home,/const pr0=pricingItems\(\)\.length,pa0=otherPaused\(\)\.length;/,'each tile counts only its own chats');
 assert.match(home,/sheetKind==='pricing'\?pricingHtml\(\)/);
 assert(home.includes('data-coh="presume"'),'«كمّل يا عقل» stays on every row');
});
test('voice note: bin while recording, delete after, ➤ while recording sends',()=>{
 assert.match(chat,/id='wa2RecCancel'/);
 assert.match(chat,/recCancel\.addEventListener\('click',\(\)=>stopRecording\('discard'\)\)/);
 assert.match(chat,/if\(mode==='discard'\)\{recChunks=\[\];/,'a discarded recording is never attached');
 assert.match(chat,/if\(recorder\)return stopRecording\('send'\);/);
 assert.match(chat,/rc\.hidden=!recorder/,'the bin shows only while recording');
 assert.match(chat,/class="wa2-discard" data-wa2-cancel-file/);
 assert.match(css,/\.wa2-rec-cancel\[hidden\]\{display:none\}/);
});

// Ahmed, 11 Nov 2026 (evening): «كمّل يا عقل» makes the agent read the chat and carry on now; price studies stay with him.
test('resume: owner home asks the agent to carry on, pricing rows have no resume, every row has a Claude note',()=>{
 assert.match(home,/waInboxInvoke\(\{action:'clear_handoff',conversation_id:id,resume:true\}\)/);
 // R27 (11 Nov): staff resume too; price studies are never theirs (notes for Claude were the owner's until R58)
 // SQL94: a chat whose study already went to the owner sits with the other paused chats; staff still get no resume on it
 assert(home.includes(`(pricing||!canResume()||(!isOwner()&&isStudyChat(i))?'':'<button type="button" class="btn-primary coh-go" data-coh="presume"`));
 // 11 Nov (later): staff see price studies too («حتى دراسة تسعير اريد تظهر للموظف»); still no resume on them
 assert(home.includes("const pricingItems=()=>canResume()?paused.items.filter(isPricing):[];"));
 // R58 (14 Nov): the note for Claude is the staff's too, so the button is no longer behind isOwner()
 assert(home.includes(`+'<button type="button" class="btn-secondary coh-go" data-coh="pnote"`)&&!home.includes(`isOwner()?'<button type="button" class="btn-secondary coh-go" data-coh="pnote"`));
 assert.match(home,/data-coh="pnote"/);assert.match(home,/window\.crmClaudeNote\(\{conversation_id:b\.dataset\.id/);
 assert(home.includes('العقل ما قدر يكمل: '),'a failed resume tells Ahmed why and the chat stays in his list');
});
test('resume: inbox calls the agent only when the last customer message is unanswered, owner and staff (R27)',()=>{
 const inbox=fs.readFileSync('supabase/functions/whatsapp-inbox/index.ts','utf8');
 assert(inbox.includes('if(payload?.resume===true&&["owner","manager","agent"].includes(profile.role)){'));
 const agentSrc=fs.readFileSync('supabase/functions/whatsapp-reply-agent/index.ts','utf8');
 assert(agentSrc.includes('if (!c.data || c.data.route_key === "owner") return json({ ok: false, error: "owner_only" }, 403);'),'never on the owner line');
 assert(agentSrc.includes('(prof.data.role !== "owner" && !staffResume)'),'staff get resume only');
 assert(inbox.includes('return json({ok:false,error:"price_study_owner_only"},403)'),'staff never hand back a price study (R26, R27)');
 assert.match(inbox,/if\(!inAt\|\|outAt>=inAt\)return json\(\{ok:true,resume:"nothing_to_answer"\}\)/);
 assert.match(inbox,/functions\/v1\/whatsapp-reply-agent`,\{method:"POST",headers:\{"Content-Type":"application\/json",Authorization:authHeader\}/);
});
test('resume: the agent reopens the same draft, never answers twice, and reads the whole chat first',()=>{
 const agent=fs.readFileSync('supabase/functions/whatsapp-reply-agent/index.ts','utf8');
 assert.match(agent,/if \(prev\.data\.status === "sent"\) return json\(\{ ok: true, ignored: "already_answered" \}\)/);
 assert.match(agent,/\.eq\("id", prev\.data\.id\)\.eq\("status", prev\.data\.status\)/,'reopen is conditional on the status it read');
 assert(agent.includes('اقرأ المحادثة كاملة من أولها وافهم وين وصلنا مع العميل'));
 assert(agent.includes('وسبب يبدأ بـ«ما عرفنا»'));
 assert.match(agent,/if \(!review && !resume\) await sleep\(DEBOUNCE_MS\)/);
 assert.match(agent,/body\?\.resume === true && body\?\.conversation_id && !dry/);
});

test('«ارسل السعر للمالك»: owner-only on price studies, sends through crmSendWhatsApp with the chat (12 Nov)',()=>{
  assert(home.includes(`(pricing&&isOwner()?'<button type="button" class="btn-primary coh-go" data-coh="pprice"`));
  assert(home.includes("crmSendWhatsApp({client_id:it.client_id,conversation_id:id,body})"));
  assert(home.includes("درسنا العقار، والسعر المناسب له في السوق حالياً حوالي '+p+' ريال"));
  assert(home.includes("if(ta&&ta.dataset.edited!=='1')ta.value=p?PRICE_TEXT(p):'';"),'a message Ahmed edited is not overwritten');
});
