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
test('send-media keeps caller RLS, owner-only investment, 24h window and idempotency',()=>{
  assert.match(send,/userClient\.from\("whatsapp_conversations"\)/);
  assert.match(send,/conversation\.route_key === "investment" && profile\.role !== "owner"/);
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
