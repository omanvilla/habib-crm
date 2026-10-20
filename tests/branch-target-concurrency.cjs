'use strict';
// Real PostgreSQL branch-target concurrency, only on a dedicated synthetic catalog.
// Run after branch-operations-assert.sql and before its rollback tests. The source
// database is cloned so these committed races cannot change its fingerprints.
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {randomBytes}=require('node:crypto');

const source=process.env.HABIB_BRANCH_TEST_DATABASE;
assert(['crm_branch_operations_test'].includes(source),
  'Set HABIB_BRANCH_TEST_DATABASE to a dedicated synthetic branch-target database');
const host=process.env.PGHOST,port=process.env.PGPORT||'5432',user=process.env.PGUSER||'postgres';
assert(user==='postgres','Concurrency test requires the synthetic PostgreSQL administrator');
assert((process.env.GITHUB_ACTIONS==='true'&&host==='127.0.0.1'&&port==='5432')||
  (host==='/tmp/habib-workflow-pg-socket'&&port==='55432'),
  'Concurrency test requires the Actions PostgreSQL service or the isolated local test socket');
const token=process.pid+'_'+randomBytes(5).toString('hex');
const clone='crm_branch_target_race_'+token;
assert.match(clone,/^crm_branch_target_race_[0-9]+_[0-9a-f]{10}$/);
const literal=x=>"'"+String(x).replaceAll("'","''")+"'";
const identifier=x=>'"'+String(x).replaceAll('"','""')+'"';
const testId=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const actorId=testId(10),companyId=testId(1),month='2022-12-01';
const processes=new Set();
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function psql(db,sql,applicationName='crm_branch_target_race_'+token){
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
const where=`company_id=${literal(companyId)}::uuid AND branch_key='muscat' AND month_start=${literal(month)}::date`;
async function payload(inventory){
  const saved=JSON.parse(await query(clone,`SELECT jsonb_build_object('stamp',updated_at,'targets',
    to_jsonb(t)-'company_id'-'branch_key'-'month_start'-'updated_at'-'updated_by')
    FROM crm_repair_private.branch_monthly_targets t WHERE ${where};`));
  saved.targets.inventory_target=inventory;return saved;
}
function rpcSql(data){return `BEGIN;SET LOCAL statement_timeout='40s';SET LOCAL lock_timeout='30s';
  SELECT set_config('test.actor',${literal(actorId)},true);SET LOCAL ROLE authenticated;
  SELECT public.crm_save_branch_monthly_targets('muscat',${literal(month)}::date,
    ${literal(JSON.stringify(data.targets))}::jsonb,${literal(data.stamp)}::timestamptz);COMMIT;`;}
async function race(a,b,label){
  const names=[`crm31_${token}_${label}_a`,`crm31_${token}_${label}_b`];
  const blocker=psql(clone,null,`crm31_${token}_blocker`);let workers=[];
  blocker.child.stdin.write(`BEGIN;SET LOCAL statement_timeout='40s';SET LOCAL lock_timeout='30s';
    SELECT branch_key FROM crm_repair_private.branch_monthly_targets WHERE ${where} FOR UPDATE;
    SELECT 'ROW_LOCK_READY';\n`);
  try{
    await until(()=>{if(blocker.done)successful(blocker.result,'Target row-lock coordinator');return blocker.stdout.includes('ROW_LOCK_READY');},'exact target row is locked');
    workers=[psql(clone,rpcSql(a),names[0]),psql(clone,rpcSql(b),names[1])];
    await until(async()=>{
      for(const worker of workers)if(worker.done)throw Error('Worker ended before concurrent release: '+worker.result.stderr);
      return await query(clone,`SELECT count(DISTINCT pid) FROM pg_stat_activity
        WHERE datname=${literal(clone)} AND application_name IN (${names.map(literal).join(',')})
        AND state='active' AND wait_event_type='Lock';`)==='2';
    },'both independent target RPC connections are blocked concurrently');
    blocker.child.stdin.end('COMMIT;\n');successful(await blocker.completed,'Target row-lock release');
    return await Promise.all(workers.map(worker=>worker.completed));
  }finally{
    if(!blocker.done){blocker.child.stdin.end('ROLLBACK;\n');await blocker.completed;}
    for(const worker of workers)if(!worker.done)worker.child.kill('SIGTERM');
  }
}
async function historyCount(){return Number(await query(clone,'SELECT count(*) FROM crm_repair_private.branch_target_history;'));}
const fingerprint=`SELECT jsonb_build_object('business',public.test_branch31_business(),
  'targets',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY company_id,branch_key,month_start),'[]'::jsonb)::text) FROM crm_repair_private.branch_monthly_targets t),
  'history',(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb)::text) FROM crm_repair_private.branch_target_history t))::text;`;
async function main(){
  let created=false,before=null,problem=null;
  try{
    const catalog=JSON.parse(await query(source,`SELECT jsonb_build_object(
      'company',(SELECT name FROM public.companies WHERE id=public.test_id(1)),
      'client',(SELECT name FROM public.clients WHERE id=public.test_id(32020)),
      'fixture',to_regclass('public.test_branch31') IS NOT NULL,
      'rpc',to_regprocedure('public.crm_save_branch_monthly_targets(text,date,jsonb,timestamptz)') IS NOT NULL,
      'target',EXISTS(SELECT 1 FROM crm_repair_private.branch_monthly_targets WHERE ${where}));`));
    assert.deepEqual(catalog,{company:'SYNTHETIC COMPANY',client:'Synthetic shared Muscat client',fixture:true,rpc:true,target:true},
      'Only the expected synthetic branch catalog can be cloned');
    before=await query(source,fingerprint);
    await query('template1',`CREATE DATABASE ${identifier(clone)} WITH TEMPLATE ${identifier(source)};`);created=true;
    const same=await payload(3),beforeSame=await historyCount();
    const retry=(await race(same,same,'retry')).map((result,i)=>jsonResult(result,'Identical target worker '+i));
    assert.deepEqual(retry.map(x=>x.replayed).sort(),[false,true]);
    assert(retry.every(x=>x.scope==='branch'&&x.branch_key==='muscat'&&x.month_start===month&&x.goals.inventory===3));
    assert.equal(retry[0].updated_at,retry[1].updated_at,'Both acknowledgments refer to one saved version');
    assert.equal(await historyCount(),beforeSame+1,'Concurrent repeated target values create one audit event');
    console.log('PASS SQL31 identical concurrent target saves: one change, one replay, one immutable history event');
    const a=await payload(4),b={...a,targets:{...a.targets,inventory_target:5}},beforeEdit=await historyCount();
    const edits=await race(a,b,'stale'),winners=edits.map((result,i)=>({result,i})).filter(x=>x.result.code===0),losers=edits.filter(x=>x.code!==0);
    assert.equal(winners.length,1);assert.equal(losers.length,1);
    assert.match(losers[0].stderr,/40001[^\n]*branch_targets_changed_reload/);
    const winner=jsonResult(winners[0].result,'Winning target edit');
    assert.equal(winner.goals.inventory,[4,5][winners[0].i]);assert.equal(winner.replayed,false);
    assert.equal(await query(clone,`SELECT inventory_target FROM crm_repair_private.branch_monthly_targets WHERE ${where};`),String(winner.goals.inventory));
    assert.equal(await historyCount(),beforeEdit+1,'A rejected stale target edit adds no audit event');
    console.log('PASS SQL31 competing concurrent target edits: one winner, one stale-version rejection, no overwritten goal');
  }catch(error){problem=error;}
  finally{
    for(const state of processes)state.child.kill('SIGTERM');
    await Promise.all([...processes].map(state=>state.completed));
    try{
      if(created){
        await query('template1',`DROP DATABASE ${identifier(clone)} WITH (FORCE);`);
        assert.equal(await query('template1',`SELECT count(*) FROM pg_database WHERE datname=${literal(clone)};`),'0');
      }
      if(before!==null)assert.equal(await query(source,fingerprint),before,'Source business/targets/history remain unchanged by committed race tests');
    }catch(error){problem=problem?new AggregateError([problem,error],'Target concurrency test and cleanup failed'):error;}
  }
  if(problem)throw problem;
  console.log('PASS SQL31 concurrency cleanup: exact temporary clone removed; source business, branch targets and history preserved');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
