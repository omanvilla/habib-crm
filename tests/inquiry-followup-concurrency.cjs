'use strict';
// Real PostgreSQL concurrency, only against the dedicated synthetic CI catalog.
// Run after inquiry-followup-assert.sql and before its rollback tests. The source
// database is cloned so these committed races cannot change its fingerprints.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {randomBytes}=require('node:crypto');

const source=process.env.HABIB_FOLLOWUP_TEST_DATABASE;
assert(['crm_inquiry_followup_test','crm_followup_test'].includes(source),
  'Set HABIB_FOLLOWUP_TEST_DATABASE to a dedicated synthetic follow-up database');
const host=process.env.PGHOST,port=process.env.PGPORT||'5432',user=process.env.PGUSER||'postgres';
assert(user==='postgres','Concurrency test requires the synthetic PostgreSQL administrator');
assert((process.env.GITHUB_ACTIONS==='true'&&host==='127.0.0.1'&&port==='5432')||
  (host==='/tmp/habib-workflow-pg-socket'&&port==='55432'),
  'Concurrency test requires the Actions PostgreSQL service or the isolated local test socket');
const token=process.pid+'_'+randomBytes(5).toString('hex');
const clone='crm_followup_race_'+token;
assert.match(clone,/^crm_followup_race_[0-9]+_[0-9a-f]{10}$/);
const literal=x=>"'"+String(x).replaceAll("'","''")+"'";
const identifier=x=>'"'+String(x).replaceAll('"','""')+'"';
const testId=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const inquiryId=testId(29030),actorId=testId(11);
const processes=new Set();
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function psql(db,sql,applicationName='crm_followup_race_'+token){
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
async function payload(outcome,requestedInquiryId=inquiryId,days=1){
  assert(Number.isInteger(days)&&days>=1&&days<=30);
  return JSON.parse(await query(clone,`SELECT jsonb_build_object(
    'inquiry_id',id,'expected_updated_at',updated_at,'status',status,
    'outcome',${literal(outcome)},'next_action','Synthetic next call after race',
    'next_followup',(now() AT TIME ZONE 'Asia/Muscat')::date+${days})
    FROM public.property_inquiries WHERE id=${literal(requestedInquiryId)}::uuid;`));
}
function rpcSql(data,key){
  return `BEGIN;SET LOCAL statement_timeout='40s';SET LOCAL lock_timeout='30s';
    SELECT set_config('test.actor',${literal(actorId)},true);
    SET LOCAL ROLE authenticated;
    SELECT public.crm_save_inquiry_followup(${literal(JSON.stringify(data))}::jsonb,${literal(key)}::uuid);
    COMMIT;`;
}
async function race(dataA,keyA,dataB,keyB,label){
  const names=[`crm29_${token}_${label}_a`,`crm29_${token}_${label}_b`];
  const blocker=psql(clone,null,`crm29_${token}_blocker`);
  blocker.child.stdin.write(`BEGIN;SET LOCAL statement_timeout='40s';SET LOCAL lock_timeout='30s';
    SELECT id FROM public.property_inquiries WHERE id=${literal(inquiryId)}::uuid FOR UPDATE;
    SELECT 'ROW_LOCK_READY';\n`);
  let workers=[];
  try{
    await until(()=>{if(blocker.done)successful(blocker.result,'Row-lock coordinator');return blocker.stdout.includes('ROW_LOCK_READY');},'coordinator acquired exact inquiry row');
    workers=[psql(clone,rpcSql(dataA,keyA),names[0]),psql(clone,rpcSql(dataB,keyB),names[1])];
    // Both real connections must reach a database lock wait before release.
    // Same key: one waits on the inquiry row, the other on the operation lock.
    // Different keys: both wait for the row. This proves actual overlapping calls.
    await until(async()=>{
      for(const worker of workers)if(worker.done)throw Error('A worker ended before the controlled release: '+worker.result.stderr);
      const waiting=await query(clone,`SELECT count(DISTINCT pid) FROM pg_stat_activity
        WHERE datname=${literal(clone)} AND application_name IN (${names.map(literal).join(',')})
        AND state='active' AND wait_event_type='Lock';`);
      return waiting==='2';
    },'two independent RPC connections waiting concurrently');
    blocker.child.stdin.end('COMMIT;\n');
    successful(await blocker.completed,'Row-lock release');
    return await Promise.all(workers.map(worker=>worker.completed));
  }finally{
    if(!blocker.done){blocker.child.stdin.end('ROLLBACK;\n');await blocker.completed;}
    for(const worker of workers)if(!worker.done)worker.child.kill('SIGTERM');
  }
}
async function activityCount(){return Number(await query(clone,'SELECT count(*) FROM public.activities;'));}
async function assertWinner(key,data){
  const actual=JSON.parse(await query(clone,`SELECT jsonb_build_object(
    'activity_id',a.id,'inquiry_note',q.followup_note,'request_note',rq.followup_note,
    'request_next',rq.next_action,'request_due',rq.next_followup,'inquiry_due',q.next_followup,
    'outcome',a.outcome,'actor_type',a.actor_type,'type',a.type,
    'same_links',(a.client_id=q.client_id AND a.property_id=q.property_id AND a.request_id=q.request_id),
    'contact_times_agree',(q.last_contact_at=a.occurred_at AND rq.last_contact_at=a.occurred_at
      AND cl.last_contact_at=a.occurred_at AND cl.human_contact_at=a.occurred_at))
    FROM public.activities a JOIN public.property_inquiries q ON q.id=${literal(data.inquiry_id)}::uuid
    JOIN public.client_requests rq ON rq.id=q.request_id JOIN public.clients cl ON cl.id=q.client_id
    WHERE a.id=${literal(key)}::uuid;`));
  assert.deepEqual(actual,{
    activity_id:key,inquiry_note:data.outcome,request_note:data.outcome,
    request_next:data.next_action,request_due:data.next_followup,inquiry_due:data.next_followup,
    outcome:data.outcome,actor_type:'human',type:'followup',same_links:true,contact_times_agree:true
  },'The winning event, inquiry, request and client have one consistent result');
}


async function independentRequestOverlap(){
  const otherInquiryId=testId(29032),keyA=testId(29104),keyB=testId(29105);
  const dataA=await payload('Synthetic delayed request A contact',inquiryId,2);
  const dataB=await payload('Synthetic independently completed request B contact',otherInquiryId,3);
  dataA.next_action='Synthetic request A next action';dataB.next_action='Synthetic request B next action';
  const before=await activityCount();
  const blockerName=`crm29_${token}_overlap_blocker`,waitingName=`crm29_${token}_overlap_a`;
  const blocker=psql(clone,null,blockerName);
  blocker.child.stdin.write(`BEGIN;SET LOCAL statement_timeout='40s';SET LOCAL lock_timeout='30s';
    SELECT id FROM public.property_inquiries WHERE id=${literal(inquiryId)}::uuid FOR UPDATE;
    SELECT 'ROW_LOCK_READY';\n`);
  let a=null,b=null;
  try{
    await until(()=>{if(blocker.done)successful(blocker.result,'Overlap row-lock coordinator');return blocker.stdout.includes('ROW_LOCK_READY');},'overlap coordinator acquired request A inquiry row');
    a=psql(clone,rpcSql(dataA,keyA),waitingName);
    // Prove A is blocked by our exact coordinator before starting B. No assumed
    // FIFO scheduling or process launch order is used as evidence of overlap.
    await until(async()=>{
      if(a.done)throw Error('Delayed A finished before controlled release: '+a.result.stderr);
      return await query(clone,`SELECT count(*) FROM pg_stat_activity waiter
        WHERE waiter.datname=${literal(clone)} AND waiter.application_name=${literal(waitingName)}
        AND waiter.state='active' AND waiter.wait_event_type='Lock' AND EXISTS(
          SELECT 1 FROM pg_stat_activity holder WHERE holder.application_name=${literal(blockerName)}
          AND holder.pid=ANY(pg_blocking_pids(waiter.pid)));`)==='1';
    },'A is waiting on the controlled inquiry row lock');
    b=psql(clone,rpcSql(dataB,keyB),`crm29_${token}_overlap_b`);
    const savedB=jsonResult(await b.completed,'Independent request B worker');
    assert.equal(savedB.ok,true);assert.equal(savedB.replayed,false);assert.equal(savedB.activity_id,keyB);
    assert.equal(savedB.inquiry_id,otherInquiryId);
    await assertWinner(keyB,dataB);
    assert.equal(a.done,false,'A remains blocked until B has committed its independent request');
    blocker.child.stdin.end('COMMIT;\n');
    successful(await blocker.completed,'Overlap row-lock release');
    const savedA=jsonResult(await a.completed,'Delayed request A worker');
    assert.equal(savedA.ok,true);assert.equal(savedA.replayed,false);assert.equal(savedA.activity_id,keyA);
    assert.equal(savedA.inquiry_id,inquiryId);
    assert.equal(await activityCount(),before+2,'Two independent outcomes create exactly two activities');

    const actual=JSON.parse(await query(clone,`WITH contacts AS (
      SELECT max(occurred_at) latest FROM public.activities WHERE client_id=public.test_id(29000)
        AND actor_type='human' AND nullif(btrim(outcome),'') IS NOT NULL
        AND type IN ('call','followup','meeting','whatsapp','contact','email')
    ), flows AS (
      SELECT jsonb_agg(jsonb_build_object('activity_id',a.id,'inquiry_id',q.id,'request_id',rq.id,
        'inquiry_note',q.followup_note,'request_note',rq.followup_note,'outcome',a.outcome,
        'request_next',rq.next_action,'request_due',rq.next_followup,'inquiry_due',q.next_followup,
        'same_links',(a.client_id=q.client_id AND a.property_id=q.property_id AND a.request_id=q.request_id),
        'request_contact_agrees',(q.last_contact_at=a.occurred_at AND rq.last_contact_at=a.occurred_at))
        ORDER BY a.id) records
      FROM public.activities a JOIN public.property_inquiries q ON q.id=CASE
        WHEN a.id=${literal(keyA)}::uuid THEN ${literal(inquiryId)}::uuid ELSE ${literal(otherInquiryId)}::uuid END
      JOIN public.client_requests rq ON rq.id=q.request_id
      WHERE a.id IN (${literal(keyA)},${literal(keyB)})
    ) SELECT jsonb_build_object('client_latest',cl.last_contact_at=c.latest,
      'client_human_latest',cl.human_contact_at=c.latest,'flows',f.records)
      FROM public.clients cl CROSS JOIN contacts c CROSS JOIN flows f WHERE cl.id=public.test_id(29000);`));
    assert.equal(actual.client_latest,true,'Delayed A cannot overwrite the client latest contact with an older pre-lock timestamp');
    assert.equal(actual.client_human_latest,true,'Client human contact timestamp equals the latest actual human outcome');
    assert.deepEqual(actual.flows,[[keyA,dataA,testId(29020)],[keyB,dataB,testId(29021)]].map(([key,data,requestId])=>({
      activity_id:key,inquiry_id:data.inquiry_id,request_id:requestId,
      inquiry_note:data.outcome,request_note:data.outcome,outcome:data.outcome,
      request_next:data.next_action,request_due:data.next_followup,inquiry_due:data.next_followup,
      same_links:true,request_contact_agrees:true
    })),'Both independent requests retain their own outcome, next action, date and event links');
    console.log('PASS SQL29 delayed shared-client contacts: latest client time equals max outcome time; both independent requests retain their results');
  }finally{
    if(!blocker.done){blocker.child.stdin.end('ROLLBACK;\n');await blocker.completed;}
    for(const worker of [a,b])if(worker&&!worker.done)worker.child.kill('SIGTERM');
  }
}

async function main(){
  let created=false,before=null,problem=null;
  try{
    const catalog=JSON.parse(await query(source,`SELECT jsonb_build_object(
      'fixture_company',(SELECT name FROM public.companies WHERE id=public.test_id(1)),
      'fixture_client',(SELECT name FROM public.clients WHERE id=public.test_id(29000)),
      'rpc',to_regprocedure('public.crm_save_inquiry_followup(jsonb,uuid)') IS NOT NULL,
      'fixture',to_regclass('public.test_followup29') IS NOT NULL,
      'free_keys',NOT EXISTS(SELECT 1 FROM public.activities WHERE id IN (public.test_id(29101),public.test_id(29102),public.test_id(29103),public.test_id(29104),public.test_id(29105))));`));
    assert.deepEqual(catalog,{fixture_company:'SYNTHETIC COMPANY',fixture_client:'Synthetic follow-up Muscat',rpc:true,fixture:true,free_keys:true},
      'Concurrency source must contain the expected isolated SQL29 fixtures and unused operation IDs');
    before=await query(source,'SELECT public.test_coherence28_business()::text;');
    // Connect to template1 while cloning; the source has no connection held open.
    await query('template1',`CREATE DATABASE ${identifier(clone)} WITH TEMPLATE ${identifier(source)};`);
    created=true;

    const samePayload=await payload('Synthetic concurrent retry: customer requested a later call');
    const sameKey=testId(29101),beforeRetry=await activityCount();
    const retryResults=(await race(samePayload,sameKey,samePayload,sameKey,'retry')).map((result,index)=>jsonResult(result,'Idempotent worker '+index));
    assert(retryResults.every(result=>result.ok===true&&result.inquiry_id===inquiryId&&result.activity_id===sameKey&&result.contact_recorded===true));
    assert.deepEqual(retryResults.map(result=>result.replayed).sort(),[false,true],
      'One simultaneous same-key call commits and the other replays that operation');
    assert.equal(await activityCount(),beforeRetry+1,'Simultaneous retry creates exactly one activity');
    assert.equal(await query(clone,`SELECT count(*) FROM public.activities WHERE id=${literal(sameKey)}::uuid;`),'1');
    await assertWinner(sameKey,samePayload);
    console.log('PASS SQL29 simultaneous identical key: one commit, one replay, one activity, linked results agree');

    const dataA=await payload('Synthetic concurrent edit A');
    const dataB={...dataA,outcome:'Synthetic concurrent edit B'};
    const keys=[testId(29102),testId(29103)],beforeEdits=await activityCount();
    const editResults=await race(dataA,keys[0],dataB,keys[1],'version');
    const winners=editResults.map((result,index)=>({result,index})).filter(x=>x.result.code===0);
    const losers=editResults.filter(result=>result.code!==0);
    assert.equal(winners.length,1,'Exactly one competing versioned edit succeeds');
    assert.equal(losers.length,1,'Exactly one competing versioned edit is rejected');
    assert.match(losers[0].stderr,/40001[^\n]*inquiry_changed_reload_before_saving/,
      'The losing edit fails with the expected stale-version SQLSTATE, not an unrelated error');
    const {index,result}=winners[0],saved=jsonResult(result,'Winning versioned worker');
    assert.equal(saved.replayed,false);assert.equal(saved.activity_id,keys[index]);assert.equal(saved.inquiry_id,inquiryId);
    assert.equal(await activityCount(),beforeEdits+1,'Competing versions commit exactly one activity');
    assert.equal(await query(clone,`SELECT count(*) FROM public.activities WHERE id IN (${keys.map(literal).join(',')});`),'1',
      'Rejected stale edit cannot leave an activity');
    await assertWinner(keys[index],[dataA,dataB][index]);
    console.log('PASS SQL29 competing versioned edits: one commit, one stale rejection, one activity, no overwritten result');
    await independentRequestOverlap();
  }catch(error){problem=error;}
  finally{
    for(const state of processes)state.child.kill('SIGTERM');
    await Promise.all([...processes].map(state=>state.completed));
    try{
      if(created){
        await query('template1',`DROP DATABASE ${identifier(clone)} WITH (FORCE);`);
        assert.equal(await query('template1',`SELECT count(*) FROM pg_database WHERE datname=${literal(clone)};`),'0',
          'Exact temporary race database is removed');
      }
      if(before!==null)assert.equal(await query(source,'SELECT public.test_coherence28_business()::text;'),before,
        'Source fixture business fingerprints stay unchanged by committed race tests');
    }catch(cleanupError){problem=problem?new AggregateError([problem,cleanupError],'Concurrency test and cleanup failed'):cleanupError;}
  }
  if(problem)throw problem;
  console.log('PASS SQL29 concurrency cleanup: temporary database removed; source business fingerprints unchanged');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
