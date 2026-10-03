const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../app-base-v15.html'),'utf8');
function fn(name){const m=new RegExp('(?:async )?function '+name+'\\(').exec(source);assert(m);for(let end=source.indexOf('}',m.index);end>=0;end=source.indexOf('}',end+1)){const s=source.slice(m.index,end+1);try{new vm.Script(s);return s;}catch{}}throw Error(name);}
function harness(){
 const nodes=new Map(),calls=[],errors=[];
 const el=id=>{if(!nodes.has(id))nodes.set(id,{value:'',disabled:false,innerHTML:'',textContent:''});return nodes.get(id);};
 const c={document:{},$:el,canEdit:()=>true,crmBeginSave:()=>true,crmEndSave(){},crmSaveKey:()=> 'TEST-OP',crmFinishSave(){},currentUser:{id:'TEST-ACTOR'},editingViewing:null,viewingFormOriginal:null,showToast:(s,k)=>errors.push({s,k}),crmReadNumber:()=>60,loadViewings:async()=>{},loadDeals:async()=>{},loadDashboard:async()=>{},supa:{rpc:async(n,args)=>{calls.push({n,args});return{data:{ok:true},error:null};}}};
 vm.createContext(c);vm.runInContext(fn('saveViewing'),c);
 for(const [k,v]of Object.entries({vClient:'TEST-CLIENT',vProperty:'TEST-PROPERTY',vDate:'2026-10-02',vTime:'10:30',vStatus:'scheduled',vRequestType:'buyer'}))el(k).value=v;
 return{c,el,calls,errors};
}
test('new visit auto-resolves request without separate request writes or meeting location',async()=>{const h=harness();await h.c.saveViewing();assert.equal(h.calls.length,1);const p=h.calls[0].args.p_payload;assert(!('request_id'in p));assert(!('location'in p));assert.equal(p.request_type,'buyer');assert.equal(h.calls[0].n,'crm_save_viewing_atomic');});
test('visit form keeps configurable request purpose and original followup facts',async()=>{const h=harness();for(const[k,v]of Object.entries({vRequestType:'tenant',vAttendance:'with_family',vNextStep:'TEST NEXT',vFollowupDate:'2026-10-03',vNotes:'TEST NOTES'}))h.el(k).value=v;await h.c.saveViewing();const p=h.calls[0].args.p_payload;assert.equal(p.request_type,'tenant');assert.equal(p.attendance,'with_family');assert.equal(p.next_step,'TEST NEXT');assert.equal(p.followup_date,'2026-10-03');assert.equal(p.notes,'TEST NOTES');});
test('lost visit requires main reason but customer words remain optional and general notes are not relabeled',async()=>{const h=harness();for(const[k,v]of Object.entries({vStatus:'done',vPipelineOutcome:'lost',vNotes:'TEST INTERNAL NOTE'}))h.el(k).value=v;await h.c.saveViewing();assert.equal(h.calls.length,0);h.el('vRejectionReason').value='price';await h.c.saveViewing();assert.equal(h.calls.length,1);assert.equal(h.calls[0].args.p_payload.outcome_note,null);assert.equal(h.calls[0].args.p_payload.notes,'TEST INTERNAL NOTE');});
test('editing visit preserves existing request link and expected version while omitting legacy location',async()=>{const h=harness();h.c.editingViewing='TEST-VISIT';h.c.viewingFormOriginal={row_version:7,location:'OLD ADDRESS'};h.el('vRequest').value='TEST-REQUEST';await h.c.saveViewing();const p=h.calls[0].args.p_payload;assert.equal(p.id,'TEST-VISIT');assert.equal(p.request_id,'TEST-REQUEST');assert.equal(p.expected_version,7);assert(!('location'in p));});
test('new scheduled visits still require actual time',async()=>{const h=harness();h.el('vTime').value='';await h.c.saveViewing();assert.equal(h.calls.length,0);assert(h.errors.some(x=>x.s.includes('وقت الزيارة')));});
test('visit modal has no required manual request or meeting address and keeps same form purpose',()=>{const modal=source.slice(source.indexOf('<div class="modal-ov" id="mViewing">'),source.indexOf('<div class="modal-ov" id="mDeposit">'));assert(!modal.includes('id="vLocation"'));assert(!modal.includes('طلب العميل *'));assert.match(modal,/id="vRequest" hidden/);assert.match(modal,/id="vRequestType"/);});

test('editing a real date-only completed visit preserves unknown time and neutral outcome',async()=>{const h=harness();h.c.editingViewing='TEST-DATEONLY';h.c.viewingFormOriginal={row_version:2,status:'done',viewing_time:null,appointment_id:null,pipeline_outcome:null};h.el('vStatus').value='done';h.el('vTime').value='';h.el('vNotes').value='ACTUAL NOTE';await h.c.saveViewing();assert.equal(h.calls.length,1);const p=h.calls[0].args.p_payload;assert.equal(p.time_unknown,true);assert.equal(p.viewing_time,null);assert.equal(p.pipeline_outcome,null);assert.equal(p.notes,'ACTUAL NOTE');});

test('simultaneous operation keys create one automatic property request',{skip:!process.env.HABIB_VISIT_TEST_DATABASE},async()=>{
 const {execFile}=require('node:child_process');
 const db=process.env.HABIB_VISIT_TEST_DATABASE,host=process.env.PGHOST||'',port=process.env.PGPORT||'55432';
 assert.match(db,/^crm_visit_test(?:_[a-z0-9]+)?$/,'concurrency test requires dedicated synthetic database');
 assert(host==='/tmp/habib-workflow-pg-socket'||(process.env.GITHUB_ACTIONS==='true'&&host==='127.0.0.1'&&port==='5432'),'concurrency test requires the isolated local socket or Actions PostgreSQL service');
 const run=sql=>new Promise((resolve,reject)=>execFile('psql',['-h',host,'-p',port,'-U','postgres','-d',db,'-v','ON_ERROR_STOP=1','-Atq','-c',sql],(e,stdout,stderr)=>e?reject(Error(stderr)):resolve(stdout.trim())));
 await run("DELETE FROM crm_repair_private.viewing_save_operations WHERE viewing_id IN(SELECT id FROM viewings WHERE client_id=test_id(217)); DELETE FROM viewings WHERE client_id=test_id(217); DELETE FROM appointment_properties WHERE appointment_id IN(SELECT id FROM appointments WHERE client_id=test_id(217)); DELETE FROM appointments WHERE client_id=test_id(217); DELETE FROM property_inquiries WHERE client_id=test_id(217); DELETE FROM client_requests WHERE client_id=test_id(217); INSERT INTO clients(id,company_id,name,phone,assigned_to,lead_route)VALUES(test_id(217),test_id(1),'TEST CONCURRENT','+96890000217',test_id(2),'muscat')ON CONFLICT(id) DO NOTHING;");
 const call="SET ROLE authenticated; SELECT set_config('test.actor','00000000-0000-4000-8000-000000000002',false);SELECT test_visit(217,101);";
 const ownerCall=call.replace('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000004');
 await Promise.all([run('BEGIN;'+ownerCall+'SELECT pg_sleep(0.4);COMMIT;'),run('BEGIN;'+call+'COMMIT;')]);
 assert.equal(await run('SELECT count(*) FROM client_requests WHERE client_id=test_id(217) AND subject_property_id=test_id(101);'),'1');
 assert.equal(await run('SELECT count(*) FROM viewings WHERE client_id=test_id(217);'),'2');
});
