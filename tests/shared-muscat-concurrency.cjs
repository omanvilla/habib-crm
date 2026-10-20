'use strict';
// Real PostgreSQL shared Muscat classification concurrency, only on a dedicated synthetic catalog.
// Run after shared-muscat-assert.sql and before its rollback tests. The source
// database is cloned so these committed races cannot change its fingerprints.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {randomBytes}=require('node:crypto');

const source=process.env.HABIB_SHARED_MUSCAT_TEST_DATABASE;
assert(['crm_shared_muscat_test'].includes(source),
  'Set HABIB_SHARED_MUSCAT_TEST_DATABASE to a dedicated synthetic shared-reception database');
const host=process.env.PGHOST,port=process.env.PGPORT||'5432',user=process.env.PGUSER||'postgres';
assert(user==='postgres','Concurrency test requires the synthetic PostgreSQL administrator');
assert((process.env.GITHUB_ACTIONS==='true'&&host==='127.0.0.1'&&port==='5432')||
  (host==='/tmp/habib-workflow-pg-socket'&&port==='55432'),
  'Concurrency test requires the Actions PostgreSQL service or the isolated local test socket');
const token=process.pid+'_'+randomBytes(5).toString('hex');
const clone='crm_shared_muscat_race_'+token;
assert.match(clone,/^crm_shared_muscat_race_[0-9]+_[0-9a-f]{10}$/);
const literal=x=>"'"+String(x).replaceAll("'","''")+"'";
const identifier=x=>'"'+String(x).replaceAll('"','""')+'"';
const testId=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const actorId=testId(10),companyId=testId(1);
const processes=new Set();
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function psql(db,sql,applicationName='crm_shared_muscat_race_'+token){
  const env={...process.env,PGAPPNAME:applicationName};
  // Explicit connection parameters and -X ignore session defaults/psql startup.
  delete env.PGSERVICE;delete env.PGSERVICEFILE;delete env.PGOPTIONS;
  const child=spawn('psql',['-X','-h',host,'-p',port,'-U',user,'-d',db,
    '-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-A','-t','-q'],
    {env,stdio:['pipe','pipe','pipe']});
  const state={child,stdout:'',stderr:'',done:false,result:null};
  processes.add(state);
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',data=>{state.stdout+=data;});
  child.stderr.on('data',data=>{state.stderr+=data;});
  child.stdin.on('error',()=>{});
  state.completed=new Promise(resolve=>{
    const finish=(code,signal,error)=>{
      if(state.done)return;state.done=true;processes.delete(state);
      clearTimeout(state.timeout);
      state.result={code,signal,stdout:state.stdout.trim(),stderr:state.stderr.trim(),error};
      resolve(state.result);
    };
    child.on('error',error=>finish(null,null,error));
    child.on('close',(code,signal)=>finish(code,signal,null));
  });
  state.timeout=setTimeout(()=>child.kill('SIGTERM'),45000);
  if(sql!==null)child.stdin.end(sql+'\n');
  return state;
}
function successful(result,label){
  assert.equal(result.code,0,label+': '+(result.error?.message||result.stderr||result.signal||'psql failed'));
  return result.stdout;
}
async function query(db,sql){return successful(await psql(db,sql).completed,'PostgreSQL query failed');}
function jsonResult(result,label){
  const lines=successful(result,label).split('\n').filter(x=>x.startsWith('{'));
  assert.equal(lines.length,1,label+' returns one acknowledged JSON result');
  return JSON.parse(lines[0]);
}
async function until(check,label,timeout=12000){
  const start=Date.now();
  while(Date.now()-start<timeout){if(await check())return;await delay(60);}
  throw Error('Timed out: '+label);
}

function scenario(base, existing = false) {
  const client=testId(base),conversation=testId(base+1),request=testId(base+2),message=testId(base+3);
  const phone='+968911'+String(base).padStart(5,'0');
  const clientSql=`INSERT INTO clients(id,company_id,assigned_to,name,phone,lead_route,client_type)
    VALUES(${literal(client)}::uuid,${literal(companyId)}::uuid,public.test_id(11),'Synthetic shared reception race',${literal(phone)},'muscat','buyer');`;
  const conversationSql=`INSERT INTO whatsapp_conversations(id,company_id,client_id,assigned_to,route_key,meta_phone_number_id,customer_wa_id,customer_phone,unread_count)
    VALUES(${literal(conversation)}::uuid,${literal(companyId)}::uuid,${literal(client)}::uuid,public.test_id(11),'muscat','synthetic-muscat',${literal(phone.slice(1))},${literal(phone)},0);`;
  const messageSql=`INSERT INTO whatsapp_messages(id,company_id,conversation_id,client_id,whatsapp_message_id,direction,body,message_timestamp)
    VALUES(${literal(message)}::uuid,${literal(companyId)}::uuid,${literal(conversation)}::uuid,${literal(client)}::uuid,${literal('wamid.synthetic.shared-race-'+base)},'inbound','PRIVATE SHARED RECEPTION RACE SENTINEL','2026-10-20 12:00+04');`;
  const privateSql=`INSERT INTO client_requests(id,company_id,client_id,request_type,route_key,branch_key,assigned_to,created_by)
    VALUES(${literal(request)}::uuid,${literal(companyId)}::uuid,${literal(client)}::uuid,'investor','investment','investment',${literal(actorId)}::uuid,${literal(actorId)}::uuid);`;
  return {client,conversation,request,message,phone,
    setup:clientSql+(existing?conversationSql:''),
    incoming:(existing?'':conversationSql)+messageSql,classification:privateSql};
}
const begin=actor=>`BEGIN;SET LOCAL statement_timeout='40s';SET LOCAL lock_timeout='30s';
  SELECT set_config('test.actor',${literal(actor||'')},true);`;
async function overlap(data,firstPrivate,label) {
  await query(clone,begin(actorId)+data.setup+'COMMIT;');
  const caseKey=data.client.slice(-5);
  const firstName=`crm32_${token}_${caseKey}_first`,secondName=`crm32_${token}_${caseKey}_second`;
  const first=psql(clone,null,firstName); let second=null;
  first.child.stdin.write(begin(firstPrivate?actorId:null)+(firstPrivate?data.classification:data.incoming)+"SELECT 'FIRST_WRITE_READY';\n");
  try{
    await until(()=>{if(first.done)successful(first.result,'First transaction');return first.stdout.includes('FIRST_WRITE_READY');},'first transaction holds its actual write locks');
    second=psql(clone,begin(firstPrivate?null:actorId)+(firstPrivate?data.incoming:data.classification)+'COMMIT;',secondName);
    await until(async()=>{
      if(second.done)throw Error('Second writer finished before controlled release: '+second.result.stderr);
      return await query(clone,`SELECT count(*) FROM pg_stat_activity a
        WHERE a.datname=${literal(clone)} AND a.application_name=${literal(secondName)}
        AND a.state='active' AND a.wait_event_type='Lock'
        AND EXISTS(SELECT 1 FROM pg_stat_activity b WHERE b.application_name=${literal(firstName)}
          AND b.pid=ANY(pg_blocking_pids(a.pid)));`)==='1';
    },'independent classification and incoming statements overlap on actual PostgreSQL locks');
    first.child.stdin.end('COMMIT;\n');
    successful(await first.completed,'First committed transaction');
    successful(await second.completed,'Second committed transaction');
    const actual=JSON.parse(await query(clone,`SELECT jsonb_build_object(
      'private',c.route_key='investment','owner_assigned',c.assigned_to=${literal(actorId)}::uuid,
      'same_physical',c.meta_phone_number_id='synthetic-muscat','same_client',c.client_id=${literal(data.client)}::uuid,
      'ordinary_parent',(SELECT lead_route='muscat' AND assigned_to=public.test_id(11) FROM clients WHERE id=${literal(data.client)}::uuid),
      'one_message',(SELECT count(*)=1 FROM whatsapp_messages WHERE id=${literal(data.message)}::uuid),
      'body_preserved',(SELECT body='PRIVATE SHARED RECEPTION RACE SENTINEL' FROM whatsapp_messages WHERE id=${literal(data.message)}::uuid))
      FROM whatsapp_conversations c WHERE c.id=${literal(data.conversation)}::uuid;`));
    assert.deepEqual(actual,{private:true,owner_assigned:true,same_physical:true,same_client:true,ordinary_parent:true,one_message:true,body_preserved:true});
    const visible=await query(clone,`BEGIN;SELECT set_config('test.actor',public.test_id(11)::text,true);SET LOCAL ROLE authenticated;
      SELECT jsonb_build_object('conversation',EXISTS(SELECT 1 FROM whatsapp_conversations WHERE id=${literal(data.conversation)}::uuid),
        'message',EXISTS(SELECT 1 FROM whatsapp_messages WHERE id=${literal(data.message)}::uuid));ROLLBACK;`);
    const visibility=JSON.parse(visible.split('\n').find(line=>line.startsWith('{')));
    assert.deepEqual(visibility,{conversation:false,message:false});
    console.log('PASS SQL32 '+label+': committed real overlap leaves one private thread/message, same physical number, retained public parent, staff denied');
  }finally{
    if(!first.done){first.child.stdin.end('ROLLBACK;\n');await first.completed;}
    if(second&&!second.done){second.child.kill('SIGTERM');await second.completed;}
  }
}
const fingerprint=`SELECT jsonb_build_object('business',public.test_coherence28_business(),
 'routes',(SELECT md5(jsonb_agg(to_jsonb(r) ORDER BY id)::text) FROM company_lead_routes r),
 'profiles',(SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY id)::text) FROM profiles p))::text;`;
async function main(){
  let created=false,before=null,problem=null;
  try{
    const catalog=JSON.parse(await query(source,`SELECT jsonb_build_object(
      'company',(SELECT name FROM companies WHERE id=public.test_id(1)),
      'client',(SELECT name FROM clients WHERE id=public.test_id(106)),
      'fixture',to_regclass('public.test_shared32') IS NOT NULL,
      'rpc',to_regprocedure('public.crm_resolve_whatsapp_business_route(uuid,text,text,uuid)') IS NOT NULL,
      'alias',(SELECT transport_route_key FROM company_lead_routes WHERE company_id=public.test_id(1) AND route_key='investment'));`));
    assert.deepEqual(catalog,{company:'SYNTHETIC COMPANY',client:'Synthetic ordinary mixed parent',fixture:true,rpc:true,alias:'muscat'},
      'Only the expected synthetic shared-reception catalog can be cloned');
    before=await query(source,fingerprint);
    await query('template1',`CREATE DATABASE ${identifier(clone)} WITH TEMPLATE ${identifier(source)};`);created=true;
    await overlap(scenario(39200),false,'new conversation commits before classification');
    await overlap(scenario(39210),true,'classification commits before new conversation');
    await overlap(scenario(39300,true),false,'existing conversation message commits before classification');
    await overlap(scenario(39310,true),true,'classification commits before existing conversation message');
  }catch(error){problem=error;}
  finally{
    for(const state of processes)state.child.kill('SIGTERM');
    await Promise.all([...processes].map(state=>state.completed));
    try{
      if(created){
        await query('template1',`DROP DATABASE ${identifier(clone)} WITH (FORCE);`);
        assert.equal(await query('template1',`SELECT count(*) FROM pg_database WHERE datname=${literal(clone)};`),'0');
      }
      if(before!==null)assert.equal(await query(source,fingerprint),before,'Source data and routing remain unchanged by committed race tests');
    }catch(error){problem=problem?new AggregateError([problem,error],'Shared reception concurrency and cleanup failed'):error;}
  }
  if(problem)throw problem;
  console.log('PASS SQL32 concurrency cleanup: exact temporary clone removed; original source fingerprint preserved');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
