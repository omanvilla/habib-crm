'use strict';
// Executes the real administrative SQL, including its BEGIN/COMMIT, against a
// dedicated synthetic database. The exported suite also accepts the local full-
// catalog PostgreSQL engine; no Auth HTTP calls or secret tokens are fabricated.
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {execFile}=require('node:child_process');
const root=join(__dirname,'..');
const source=readFileSync(join(root,'db/operations/retire-muscat-personal-login.sql'),'utf8');
const fixture=name=>readFileSync(join(root,'tests/fixtures',name),'utf8');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const literal=value=>"'"+String(value??'').replaceAll("'","''")+"'";
const standard={company_id:id(1),target_user_id:id(11),owner_id:id(10),retained_user_id:id(12),operation_key:'synthetic-muscat-retirement-20261020'};
function settings(overrides={}){
 const values={...standard,...overrides};
 return `RESET ROLE;DO $settings$ BEGIN PERFORM set_config('test.actor',${literal(id(10))},false);\n`+
  Object.entries(values).map(([key,value])=>`PERFORM set_config('crm.retirement.${key}',${literal(value)},false);`).join('\n')+
  '\nEND $settings$;\n';
}
async function runRetirementSuite(execute,log=console.log){
 await execute(fixture('account-retirement-before.sql'));
 const state=async()=>JSON.parse((await execute('RESET ROLE;SELECT test_retirement32_state()::text;')).trim());
 async function rejected(label,overrides,pattern){
  const before=await state();let failed=false;
  try{await execute(settings(overrides)+source);}catch(error){
   failed=true;assert.match(error.message,pattern,label+' returns the intended guard');
   await execute('ROLLBACK;RESET ROLE;');
  }
  assert(failed,label+' must reject the actual administrative script');
  assert.deepEqual(await state(),before,label+' leaves the complete isolated business/Auth/audit state unchanged');
  log('PASS retirement guard: '+label);
 }
 const invalid=/Retirement parameters are incomplete or invalid/;
 const changed=/Retirement precondition changed/;
 await rejected('missing company',{company_id:''},invalid);
 await rejected('blank operation key',{operation_key:'  '},invalid);
 await rejected('owner cannot retire self',{target_user_id:id(10)},invalid);
 await rejected('retained account cannot be retired',{target_user_id:id(12)},invalid);
 await rejected('retained identity must differ from owner',{retained_user_id:id(10)},invalid);
 await rejected('foreign company',{company_id:id(2)},changed);
 await rejected('manager cannot stand in for owner',{owner_id:id(13)},changed);
 await rejected('inactive owner',{owner_id:id(15)},changed);
 await rejected('foreign owner',{owner_id:id(16)},changed);
 await rejected('wrong target account',{target_user_id:id(16)},changed);
 await rejected('wrong retained account',{retained_user_id:id(13)},changed);
 await execute(settings()+source);
 const completed=await state();
 await execute(settings()+source);
 assert.deepEqual(await state(),completed,'exact replay changes no profile, Auth timestamp, route, business row or audit');
 log('PASS actual retirement SQL executed twice: one audited change and exact replay');
 await execute(fixture('account-retirement-assert.sql'));
 const identity=/Retirement replay refused: operation key belongs to different identities/;
 await rejected('replay company binding',{company_id:id(2)},identity);
 await rejected('replay target binding',{target_user_id:id(16)},identity);
 await rejected('replay owner binding',{owner_id:id(13)},identity);
 await rejected('replay retained-account binding',{retained_user_id:id(13)},identity);
 await rejected('new key cannot disguise already retired account',{operation_key:'synthetic-distinct-retirement-key'},changed);
 const independent=/Retirement replay refused: account, route or session state was changed independently/;
 const session=completed.sessions.find(x=>x.id===id(37001));
 await execute(`UPDATE auth.sessions SET not_after=NULL WHERE id=${literal(session.id)}::uuid;`);
 await rejected('independently reopened session',{},independent);
 await execute(`UPDATE auth.sessions SET not_after=${literal(session.not_after)}::timestamptz WHERE id=${literal(session.id)}::uuid;`);
 await execute('UPDATE auth.refresh_tokens SET revoked=false WHERE id=37012;');
 await rejected('independently unrevoked refresh',{},independent);
 await execute('UPDATE auth.refresh_tokens SET revoked=true WHERE id=37012;');
 const target=completed.users.find(x=>x.id===id(11));
 await execute(`UPDATE auth.users SET banned_until=NULL WHERE id=${literal(target.id)}::uuid;`);
 await rejected('independently removed Auth ban',{},independent);
 await execute(`UPDATE auth.users SET banned_until=${literal(target.banned_until)}::timestamptz WHERE id=${literal(target.id)}::uuid;`);
 assert.deepEqual(await state(),completed,'negative drift fixtures restore only their own synthetic changes exactly');
 await execute(fixture('account-retirement-viewing-assert.sql'));
 assert.deepEqual(await state(),completed,'viewing authorization tests roll back every synthetic edit and audit');
 log('PASS account retirement: Auth adapter, isolation, preserved branch history and historical viewing workflow');
}
async function main(){
 const database=process.env.HABIB_RETIREMENT_TEST_DATABASE;
 assert.equal(database,'crm_account_retirement_test','Only the named synthetic retirement clone may be used');
 const host=process.env.PGHOST,port=process.env.PGPORT||'5432',user=process.env.PGUSER||'postgres';
 assert.equal(user,'postgres','Retirement test requires the isolated PostgreSQL administrator');
 assert((process.env.GITHUB_ACTIONS==='true'&&host==='127.0.0.1'&&port==='5432')||
  (host==='/tmp/habib-workflow-pg-socket'&&port==='55432'),
  'Retirement test requires Actions PostgreSQL or the isolated local test socket');
 const env={...process.env};delete env.PGSERVICE;delete env.PGSERVICEFILE;delete env.PGOPTIONS;
 const execute=sql=>new Promise((resolve,reject)=>{
  const child=execFile('psql',['-X','-h',host,'-p',port,'-U',user,'-d',database,'-v','ON_ERROR_STOP=1','-A','-t','-q'],
   {env,timeout:45000,maxBuffer:4*1024*1024},(error,stdout,stderr)=>error?reject(new Error(stderr||error.message)):resolve(stdout.trim()));
  child.stdin.on('error',()=>{});child.stdin.end(sql+'\n');
 });
 await runRetirementSuite(execute);
}
module.exports={runRetirementSuite};
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
