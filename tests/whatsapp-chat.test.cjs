'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const ui=fs.readFileSync('crm-whatsapp-chat.js','utf8');
const send=fs.readFileSync('supabase/functions/whatsapp-send-media/index.ts','utf8');
const inbox=fs.readFileSync('supabase/functions/whatsapp-inbox/index.ts','utf8');
const index=fs.readFileSync('index.html','utf8');
test('loader includes the WhatsApp chat module and styles',()=>{assert.match(index,/crm-whatsapp-chat\.js\?v=/);assert.match(index,/crm-whatsapp-chat\.css\?v=/);});
test('chat escapes customer text and only links http(s) URLs',()=>{
  assert.match(ui,/const esc=v=>escapeHtml/);
  assert.match(ui,/function linkify\(text\)\{\s*return esc\(text\)\.replace\(\/\(https\?:/);
  assert(!/innerHTML\s*=\s*m\.body/.test(ui));
});
test('media is read through the inbox function, never from Meta URLs in the browser',()=>{
  assert.match(ui,/waInboxInvoke\(\{action:'media',conversation_id:conversationId,message_id:id\}\)/);
  assert(!ui.includes('lookaside.fbsbx.com'));
});
test('send-media keeps caller RLS, owner-only private line, 24h window and idempotency',()=>{
  assert.match(send,/userClient\.from\("whatsapp_conversations"\)/);
  assert.match(send,/r\.route_key !== "investment" && r\.owner_only_inbox === true/,'SQL79: investors open to staff, other owner-only routes not');
  assert.match(send,/outside_customer_service_window/);
  assert.match(send,/whatsapp_send_operations/);
  assert.match(send,/reply_target_not_in_conversation/);
  assert.match(send,/use_whatsapp_send_for_plain_text/);
});
test('inbox media action covers voice, video, files and stickers in both directions with type and size limits',()=>{
  for(const kind of ['image','sticker','audio','video','document'])assert.match(inbox,new RegExp(kind+': '));
  assert.match(inbox,/\["inbound","outbound"\]\.includes\(String\(message\.data\.direction\)\)/);
  assert.match(inbox,/MEDIA_LIMIT\[kind\]/);
});
test('voice recording uses only formats WhatsApp accepts',()=>{
  assert.match(ui,/\['audio\/ogg;codecs=opus','audio\/mp4;codecs=mp4a\.40\.2','audio\/mp4'\]/);
  assert(!/audio\/webm/.test(ui));
});
test('a recorded voice note is re-encoded to Ogg/Opus before it is attached (WhatsApp refused Chrome MP4, 131053)',()=>{
  assert.match(ui,/async function toOggOpus\(blob\)/);
  assert.match(ui,/codec:'opus',sampleRate:RATE,numberOfChannels:1/);
  assert.match(ui,/if\(mime!=='audio\/ogg'&&canPlayOgg\(\)\)/);
  assert.match(ui,/out=await toOggOpus\(blob\);outMime='audio\/ogg';/);
  assert.match(ui,/new Blob\(pages,\{type:'audio\/ogg'\}\)/);
  assert.match(index,/crm-whatsapp-chat\.js\?v=20261114-ogg1/);
});
test('Ogg pages carry a valid header and checksum',()=>{
  const src=ui.slice(ui.indexOf('const OGG_CRC='),ui.indexOf('async function toOggOpus'));
  const oggPage=new Function(src+';return oggPage;')();
  const big=new Uint8Array(600).fill(7),page=oggPage(0x01020304,5,96000,4,[new Uint8Array([1,2,3]),big]);
  assert.equal(Buffer.from(page.subarray(0,4)).toString('latin1'),'OggS');
  assert.equal(page[5],4);assert.equal(page[26],4,'3 bytes = 1 segment, 600 bytes = 255+255+90');
  assert.deepEqual([...page.subarray(27,31)],[3,255,255,90]);
  assert.equal(page.length,27+4+603);
  const v=new DataView(page.buffer);assert.equal(v.getUint32(6,true),96000);assert.equal(v.getUint32(18,true),5);
  // checksum recomputed bit by bit (polynomial 0x04c11db7, no reflection) with the CRC field zeroed
  const stored=v.getUint32(22,true),copy=Uint8Array.from(page);copy.fill(0,22,26);
  let c=0;for(const x of copy){c=(c^(x<<24))>>>0;for(let j=0;j<8;j++)c=((c&0x80000000)?((c<<1)^0x04c11db7):(c<<1))>>>0;}
  assert.equal(stored,c);
});
test('a message WhatsApp refused after accepting it is shown in words and announced',()=>{
  assert.match(ui,/wa2-tick fail" title="[^"]+">⚠ لم تصل للعميل</);
  assert.match(ui,/m\.direction==='outbound'&&m\.delivery_status==='failed'&&old\.delivery_status!=='failed'\)showToast\(/);
});
test('voice notes, videos and files stream as bytes so files above 16 MB open',()=>{
  assert.match(ui,/action:'media_stream'/);
  assert.match(inbox,/if \(action === "media_stream"\)/);
  assert.match(inbox,/STREAM_LIMIT = 100 \* 1024 \* 1024/);
  assert.match(inbox,/"Access-Control-Expose-Headers": "x-media-type"/);
});
