'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const base=fs.readFileSync('app-base-v15.html','utf8');
const code=base.slice(base.indexOf('function crmDealBusinessDate('),base.indexOf('async function loadDeals('));
const ctx={};vm.createContext(ctx);vm.runInContext(code,ctx);

test('deals sort newest first by their business date, not by when the record was saved',()=>{
  const deals=[
    {id:'old-sale-entered-today',stage:'commission_collected',closed_at:'2022-06-10T08:00:00+00:00',created_at:'2026-10-30T09:00:00+00:00',updated_at:'2026-10-30T09:00:00+00:00'},
    {id:'sale-2024',stage:'commission_collected',closed_at:'2024-03-01T08:00:00+00:00',created_at:'2024-03-01T08:00:00+00:00'},
    {id:'sale-2023',stage:'commission_collected',closed_at:'2023-05-01T08:00:00+00:00',created_at:'2026-09-01T08:00:00+00:00'},
    {id:'sale-2026',stage:'commission_collected',closed_at:'2026-09-08T08:00:00+00:00',created_at:'2026-09-08T08:00:00+00:00'}
  ];
  assert.deepEqual(deals.sort(ctx.crmCompareDealsByDate).map(d=>d.id),['sale-2026','sale-2024','sale-2023','old-sale-entered-today']);
});

test('each stage uses its own date: deposit paid date, loss date, visit date, then creation',()=>{
  assert.equal(ctx.crmDealBusinessDate({stage:'deposit',reservation_confirmed_at:'2026-09-22T08:00:00+00:00',created_at:'2026-10-19T00:00:00+00:00'}).slice(0,10),'2026-09-22');
  assert.equal(ctx.crmDealBusinessDate({stage:'lost',lost_at:'2026-05-25T08:00:00+00:00',closed_at:'2026-10-01T00:00:00+00:00'}).slice(0,10),'2026-05-25');
  assert.equal(ctx.crmDealBusinessDate({stage:'viewing_scheduled',viewing:{viewing_date:'2026-06-14'},created_at:'2026-09-28T00:00:00+00:00'}).slice(0,10),'2026-06-14');
  assert.equal(ctx.crmDealBusinessDate({stage:'negotiation',created_at:'2026-10-11T00:00:00+00:00'}).slice(0,10),'2026-10-11');
});

test('both the stage board and the table use the business-date order',()=>{
  assert(base.includes('const ds=groupDeals(g).sort(crmCompareDealsByDate);'));
  assert(base.includes('allDeals=rs[0].sort(crmCompareDealsByDate);'));
});
