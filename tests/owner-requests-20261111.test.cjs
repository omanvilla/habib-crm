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
