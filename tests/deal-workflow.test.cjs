'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
test('deal workflow prepared SQL executes against isolated PostgreSQL with authenticated roles', {skip:!process.env.CRM_DEAL_TEST_DATABASE_URL},()=>{
 const files=['tests/fixtures/rejection-consistency.sql','db/changes/13-visit-auto-request.forward.sql','db/changes/14-deal-workflow.forward.sql','db/changes/15-primary-rejection-consistency.forward.sql','tests/fixtures/deal-workflow-assert.sql'];
 const args=['-X','-v','ON_ERROR_STOP=1',process.env.CRM_DEAL_TEST_DATABASE_URL,...files.flatMap(f=>['-f',path.join(root,f)])];
 const r=spawnSync(process.env.PSQL||'psql',args,{encoding:'utf8',timeout:60000});
 assert.equal(r.status,0,(r.stderr||'')+'\n'+(r.stdout||''));
 assert.match(r.stdout,/deal workflow assertions passed/);
});
