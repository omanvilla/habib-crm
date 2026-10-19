'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app-base-v15.html','utf8');
function fixture(){
 const begin=source.indexOf('function matchesClientSmartFilter('),end=source.indexOf('\n\nfunction renderClients()',begin);
 const c={window:{clientSmartFilter:{}},clientWorkRequests:[],crmDigits:value=>String(value==null?'':value).replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[۰-۹]/g,d=>String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))};
 vm.createContext(c);vm.runInContext(source.slice(begin,end),c);return c;
}
const client={id:'SYNTHETIC-CLIENT',name:'عميلة بطلبين مستقلين',phone:'+96892344273',phone_normalized:'+96892344273',lead_route:'barka',property_type:'villa',preferred_area:'الرميس',budget_min:55000,budget_max:65000};
test('same Omani identity is searchable in Arabic, Persian, local and international formats',()=>{
 const f=fixture();
 for(const text of ['92344273','٩٢٣٤٤٢٧٣','۹۲۳۴۴۲۷۳','+968 9234 4273','00968-92344273','٩٦٨ ٩٢٣٤ ٤٢٧٣','(9234) 4273','عميلة']){
  f.window.clientSmartFilter={text};assert.equal(f.matchesClientSmartFilter(client),true,text);
 }
 f.window.clientSmartFilter={text:'92344274'};assert.equal(f.matchesClientSmartFilter(client),false);
});
test('international contacts keep their country code and identity without an Oman default',()=>{
 const f=fixture(),contact={...client,phone:'+14165551234',phone_normalized:'+14165551234'};
 for(const text of ['+1 (416) 555-1234','0014165551234','٤١٦٥٥٥١٢٣٤']){f.window.clientSmartFilter={text};assert.equal(f.matchesClientSmartFilter(contact),true,text)}
 f.window.clientSmartFilter={text:'+9684165551234'};assert.equal(f.matchesClientSmartFilter(contact),false);
});
test('secondary request can match, but criteria from two independent requests cannot mix',()=>{
 const f=fixture();f.clientWorkRequests=[
  {client_id:client.id,route_key:'barka',property_type:'villa',preferred_area:'الرميس',budget_min:55000,budget_max:65000},
  {client_id:client.id,route_key:'barka',property_type:'apartment',preferred_area:'الصومحان',budget_min:200,budget_max:350}
 ];
 f.window.clientSmartFilter={type:'apartment',area:'الصومحان',budget:300};assert.equal(f.matchesClientSmartFilter(client),true);
 f.window.clientSmartFilter={type:'villa',area:'الصومحان',budget:300};assert.equal(f.matchesClientSmartFilter(client),false);
 f.window.clientSmartFilter={type:'apartment',area:'الرميس'};assert.equal(f.matchesClientSmartFilter(client),false);
 f.window.clientSmartFilter={type:'apartment',budget:1000};assert.equal(f.matchesClientSmartFilter(client),false);
});
test('private investment request facts cannot make an ordinary client match',()=>{
 const f=fixture();f.clientWorkRequests=[{client_id:client.id,route_key:'investment',property_type:'apartment',preferred_area:'PRIVATE-SYNTHETIC',budget_min:100000,budget_max:200000}];
 f.window.clientSmartFilter={area:'PRIVATE-SYNTHETIC'};assert.equal(f.matchesClientSmartFilter(client),false);
 assert.equal(f.matchesClientSmartFilter({...client,lead_route:'investment'}),true);
});
test('legacy client-only search remains available when no permitted request is loaded',()=>{
 const f=fixture();f.window.clientSmartFilter={type:'villa',area:'الرميس',budget:60000};assert.equal(f.matchesClientSmartFilter(client),true);
 f.clientWorkRequests=[{client_id:'OTHER-SYNTHETIC',property_type:'apartment',preferred_area:'الصومحان'}];assert.equal(f.matchesClientSmartFilter(client),true);
});
