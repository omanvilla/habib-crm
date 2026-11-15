// 15 Nov 2026 (Ahmed: «ليش يصير كذا مع انها تتواصل على الفرع الصحيح»): the chat asks «اختر الطلب … حتى نرسل من
// رقم المكتب الصحيح» only when the choice can change the number the reply leaves from.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),vm=require('vm');

function load(){
 const sent=[],toasts=[];
 const c={console,showToast:(m,k)=>toasts.push([m,k]),sendWhatsAppInboxMessage:async()=>{sent.push(1)},
  waInboxRequests:[],waInboxSelectedRequestId:null,waInboxActiveConversation:null};
 c.window=c;vm.createContext(c);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../crm-v18-request-integrity-patch.js'),'utf8'),c);
 return {c,sent,toasts};
}
const req=(id,status,branch,route)=>({id,status,branch_key:branch,route_key:route||branch});
async function run(requests,chatRoute,selected){
 const h=load();h.c.waInboxRequests=requests;h.c.waInboxSelectedRequestId=selected||null;
 h.c.waInboxActiveConversation=chatRoute===null?null:{id:'TEST_CHAT',route_key:chatRoute};
 await h.c.sendWhatsAppInboxMessage();return h;
}

test('two open requests on the branch of the open chat send without asking for a request',async()=>{
 const h=await run([req('TEST_A','active','muscat'),req('TEST_B','active','muscat')],'muscat');
 assert.equal(h.sent.length,1);assert.equal(h.toasts.length,0);
});
test('open requests on two branches still ask for the request, and a chosen request sends',async()=>{
 const mixed=[req('TEST_A','active','muscat'),req('TEST_B','paused','barka')];
 const h=await run(mixed,'muscat');assert.equal(h.sent.length,0);assert.match(h.toasts[0][0],/اختر الطلب/);
 const chosen=await run(mixed,'muscat','TEST_B');assert.equal(chosen.sent.length,1);assert.equal(chosen.toasts.length,0);
});
test('closed requests never block the send',async()=>{
 const h=await run([req('TEST_A','closed','barka'),req('TEST_B','cancelled','muscat')],'muscat');
 assert.equal(h.sent.length,1);assert.equal(h.toasts.length,0);
 const one=await run([req('TEST_A','closed','barka'),req('TEST_B','active','muscat')],'muscat');
 assert.equal(one.sent.length,1);
});
test('an owner-private investment request beside a branch request still asks',async()=>{
 const h=await run([req('TEST_A','active','muscat','investment'),req('TEST_B','active','muscat')],'muscat');
 assert.equal(h.sent.length,0);assert.equal(h.toasts.length,1);
 const lane=await run([req('TEST_A','active','muscat','investment'),req('TEST_B','active','investment')],'investment');
 assert.equal(lane.sent.length,1);
});
test('a chat whose branch is unknown keeps the old question',async()=>{
 const h=await run([req('TEST_A','active','muscat'),req('TEST_B','active','muscat')],'');
 assert.equal(h.sent.length,0);assert.equal(h.toasts.length,1);
 const none=await run([req('TEST_A','active','muscat'),req('TEST_B','active','muscat')],null);
 assert.equal(none.sent.length,0);
});
