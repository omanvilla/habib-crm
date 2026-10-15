'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('supabase/functions/whatsapp-webhook/index.ts','utf8');
function alertApi(rows=[],error=null){
 const calls=[];
 const db={from(table){let value;const filters=[];const q={select(){return q},eq(k,v){filters.push([k,v]);return q},not(...args){filters.push(['not',...args]);return q},limit(){calls.push({table,filters});return Promise.resolve({data:rows,error})},update(v){value=v;return q},then(a,b){calls.push({table,filters,value});return Promise.resolve({error:null}).then(a,b)}};return q}};
 const begin=source.indexOf('async function alertUnresolvedListingReference'),end=source.indexOf('async function attributeSpecificListingText',begin);
 const js=source.slice(begin,end).replace('args:{messageId:string;clientId:string;conversationId:string;body:string;routeKey:string;messageAt:string}','args');
 return {run:new Function('supabase','CRM_COMPANY_ID',js+';return alertUnresolvedListingReference;')(db,'company'),calls};
}
const args={messageId:'message',clientId:'client',conversationId:'conversation',body:'Listing reference',routeKey:'muscat',messageAt:'2026-10-15'};
test('Unknown saved-link reference becomes staff handoff without a customer send or duplicate pending row',async()=>{
 const {run,calls}=alertApi([{id:'pending'}]);await run(args);
 assert.equal(calls.length,2);assert.equal(calls[0].table,'unmatched_property_links');
 assert.deepEqual(calls[0].filters,[['company_id','company'],['whatsapp_message_id','message'],['conversation_id','conversation'],['status','pending'],['not','link_key','like','image:%']]);
 assert.equal(calls[1].table,'whatsapp_conversations');assert.equal(calls[1].value.human_handoff_required,true);
 assert.deepEqual(calls[1].filters,[['company_id','company'],['id','conversation'],['human_handoff_required',false]]);
 assert.equal(calls.some(c=>c.table==='whatsapp_messages'),false);
});
test('Greeting, resolved reference and bare image produce no new handoff',async()=>{
 const {run,calls}=alertApi([]);await run(args);assert.equal(calls.length,1);
});
test('Reference lookup failure surfaces for webhook retry instead of silent success',async()=>{
 const {run,calls}=alertApi([],{message:'offline'});await assert.rejects(run(args),/property_reference_review:offline/);assert.equal(calls.length,1);
});
test('Webhook checks pending references after attribution even when AI creates no request',()=>{
 const batch=source.indexOf('const batchResult = await applyRequestBatch');
 const finalizer=source.indexOf('await finalizePropertyAttribution(messageRow.id);',batch);
 const alert=source.indexOf('await alertUnresolvedListingReference(',batch);
 const done=source.indexOf('const finalized = await supabase.from("whatsapp_messages").update',batch);
 assert(batch>=0&&finalizer>batch&&alert>finalizer&&done>alert);
});
test('Captionless media checks a pending referral URL before its early success return',()=>{
 const begin=source.indexOf('if (!body.trim() && propertyEvidence.data?.property_match_status)');
 const end=source.indexOf('let extracted: any = null;',begin);
 const block=source.slice(begin,end);
 assert.match(block,/await finalizePropertyAttribution\(messageRow.id\);\s*await alertUnresolvedListingReference\(/);
 assert(block.indexOf('await alertUnresolvedListingReference(')<block.indexOf('ai_processed_at:'));
});
