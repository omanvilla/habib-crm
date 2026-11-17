'use strict';
// SQL119 (17 Nov 2026, Ahmed: «نعم، احجبها كلها»): the performance reports give office commission figures to the owner only.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const f=fs.readFileSync('db/changes/119-performance-commission-owner-only.forward.sql','utf8').replace(/\r\n/g,'\n');
const rb=fs.readFileSync('db/changes/119-performance-commission-owner-only.rollback.sql','utf8').replace(/\r\n/g,'\n');
const news=s=>[...s.matchAll(/\$n\$([^$]+)\$n\$/g)].map(m=>m[1]),olds=s=>[...s.matchAll(/\$o\$([^$]+)\$o\$/g)].map(m=>m[1]);

test('the migration copy is the forward file; each live body is md5-checked and the condition counted',()=>{
 assert.equal(f,fs.readFileSync('supabase/migrations/20261117190000_performance_commission_owner_only_20261117.sql','utf8').replace(/\r\n/g,'\n'));
 for(const md5 of ['1452ca804e3bdeef10912e5427db0221','64d5557aa27b547d612a701f8c4b13ad','e1f1fc931d4105a629fcbc8c3dc1a837'])assert(f.includes("'"+md5+"'"),md5);
 assert(f.includes('IF md5(def) <> r.live_md5 THEN')&&f.includes('IF hits <> r.times THEN'));
});
test('the new conditions name the owner only; the old ones named an agent or the row\'s own person',()=>{
 assert.deepEqual(news(f),["case when v_role='owner' then coalesce(","case when v_role='owner' then coalesce(","CASE WHEN r='owner' THEN "]);
 for(const o of olds(f))assert(/agent|id=u/.test(o),o);
 assert.equal(olds(f).length,3);
});
test('the rollback mirrors the forward file',()=>{
 assert.deepEqual(news(rb),news(f));assert.deepEqual(olds(rb),olds(f));
 assert(rb.includes('EXECUTE replace(def, r.new_part, r.old_part);'));
});
