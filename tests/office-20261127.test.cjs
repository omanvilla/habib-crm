'use strict';
// SQL161 (27 Nov 2026, Ahmed: «المكتب»): automatic workers + real staff performance, staff see only themselves, no money.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const f=fs.readFileSync('db/changes/161-office-snapshot.forward.sql','utf8').replace(/\r\n/g,'\n');
const ui=fs.readFileSync('crm-office.js','utf8'),index=fs.readFileSync('index.html','utf8'),nav=fs.readFileSync('crm-simple-ui.js','utf8');

test('mirrored, owner/manager/agent only, staff limited to themselves, workers for the boss only',()=>{
 assert.equal(f,fs.readFileSync('supabase/migrations/20261127090000_office_snapshot.sql','utf8').replace(/\r\n/g,'\n'));
 assert(f.includes("r NOT IN ('owner', 'manager', 'agent')"));
 assert(f.includes("AND (r IN ('owner', 'manager') OR p.id = u)"));
 assert(f.includes("IF r IN ('owner', 'manager') THEN\n    WITH def("));
 assert(f.includes('REVOKE ALL ON FUNCTION public.crm_office_snapshot() FROM PUBLIC, anon;'));
 const out=f.slice(f.indexOf('jsonb_agg(jsonb_build_object('));
 assert(!/'(expected_commission|collected_commission|commission|owner_net|deal_value)'/.test(out),'no money key leaves the function');
});
test('the page is wired, grouped under reports, and colours follow the pace',()=>{
 assert(index.includes('crm-office.js?v=20261127-office1')&&index.includes('crm-office.css?v=20261127-office1'));
 assert(nav.includes("['التقارير',['office','reports','expenses','activityLog']]"));
 assert(ui.includes("supa.rpc('crm_office_snapshot')")&&!/commission|owner_net/.test(ui));
 const win={addEventListener(){},};const ctx={window:win,document:{getElementById:()=>null,querySelector:()=>null,addEventListener(){}},Date,Math,Number,String,Promise};
 vm.runInNewContext(ui,ctx);
 const pc=win.crmOffice.paceColor;
 assert.equal(pc(33,100,0.9),'r');assert.equal(pc(70,100,0.9),'y');assert.equal(pc(95,100,0.9),'g');assert.equal(pc(2,2,0.1),'g');assert.equal(pc(1,0,0.5),'');
});
