'use strict';
// SQL118 (17 Nov 2026, Ahmed: «احجب العمولة عن الموظف»): the branch target snapshot gives the office commission to the owner only.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const f=fs.readFileSync('db/changes/118-snapshot-commission-owner-only.forward.sql','utf8').replace(/\r\n/g,'\n');
const rb=fs.readFileSync('db/changes/118-snapshot-commission-owner-only.rollback.sql','utf8').replace(/\r\n/g,'\n');
const NEW="'expected_commission',CASE WHEN r='owner' THEN expected_commission END,'collected_commission',CASE WHEN r='owner' THEN collected_commission END,";

test('the live body is md5-checked and only the commission line is replaced',()=>{
 assert.equal(f,fs.readFileSync('supabase/migrations/20261117180000_snapshot_commission_owner_only_20261117.sql','utf8').replace(/\r\n/g,'\n'));
 assert(f.includes("IF md5(def) <> 'e696ada8c3a429f8d250a1fe246696c4' THEN"));
 assert(f.includes('EXECUTE replace(def, old_part, new_part);'));
});
test('expected and collected commission are for the owner only',()=>{
 assert(f.includes('new_part text := $n$  '+NEW+'$n$;'));
 assert(!NEW.includes('agent'));
});
test('the old target card shows a hidden commission as hidden, and the rollback puts the old line back',()=>{
 assert(fs.readFileSync('crm-operations-v6.js','utf8').includes("x.expected_commission==null?'<span class=\"ops-metric\"><small>عمولات المكتب المتوقعة محجوبة لهذا الدور</small></span>'"));
 assert(rb.includes('EXECUTE replace(def, new_part, old_part);'));
});
