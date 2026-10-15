'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('crm-operations-v6.js','utf8');
function calendar(now,company={created_at:'2026-05-06T15:00:00Z'}){
  class FixedDate extends Date { constructor(...args){super(...(args.length?args:[now]));} }
  const start=source.indexOf('  const omanDate'),end=source.indexOf('  async function renderPerformance');
  return new Function('Date','currentCompany',source.slice(start,end)+';return {period,performanceRangeLabel,targetScore};')(FixedDate,company);
}

test('Requested October ranges include both labelled dates while the RPC end stays exclusive',()=>{
  const {period,performanceRangeLabel}=calendar('2026-10-15T16:04:02Z');
  const ranges={
    month:['2026-10-01','2026-11-01','من 1/10/2026 إلى 31/10/2026'],
    quarter:['2026-07-15','2026-10-16','من 15/7/2026 إلى 15/10/2026'],
    halfyear:['2026-04-15','2026-10-16','من 15/4/2026 إلى 15/10/2026'],
    nine_months:['2026-01-15','2026-10-16','من 15/1/2026 إلى 15/10/2026'],
    year:['2025-10-15','2026-10-16','من 15/10/2025 إلى 15/10/2026'],
    all:[null,'2026-10-16','من بداية الشركة إلى 15/10/2026']
  };
  for(const [kind,[from,to,label]] of Object.entries(ranges)){
    const span=period(kind);
    assert.deepEqual(span,{from,to},kind);
    assert.equal(performanceRangeLabel(span),label,kind);
    assert(!/[\u0660-\u0669\u06f0-\u06f9]/.test(label));
  }
});

test('Rolling ranges change at Oman midnight, not device or UTC midnight',()=>{
  const before=calendar('2026-10-14T19:59:59Z').period('quarter');
  const after=calendar('2026-10-14T20:00:00Z').period('quarter');
  assert.deepEqual(before,{from:'2026-07-14',to:'2026-10-15'});
  assert.deepEqual(after,{from:'2026-07-15',to:'2026-10-16'});
  assert.deepEqual(calendar('2026-09-30T20:00:00Z').period('month'),{from:'2026-10-01',to:'2026-11-01'});
});

test('Calendar month subtraction clamps short months and leap days without rolling forward',()=>{
  assert.deepEqual(calendar('2026-05-31T12:00:00Z').period('quarter'),{from:'2026-02-28',to:'2026-06-01'});
  assert.deepEqual(calendar('2024-05-31T12:00:00Z').period('quarter'),{from:'2024-02-29',to:'2024-06-01'});
  assert.deepEqual(calendar('2024-02-29T12:00:00Z').period('year'),{from:'2023-02-28',to:'2024-03-01'});
  assert.deepEqual(calendar('2026-12-31T12:00:00Z').period('month'),{from:'2026-12-01',to:'2027-01-01'});
  assert.deepEqual(calendar('2026-03-31T12:00:00Z').period('halfyear'),{from:'2025-09-30',to:'2026-04-01'});
});

test('Lifetime uses a backend historical start even before technical company creation',()=>{
  const {period,performanceRangeLabel}=calendar('2026-10-15T16:04:02Z');
  assert.equal(period('all').from,null,'Do not override the backend with the later technical company creation date');
  assert.equal(performanceRangeLabel(period('all'),'2020-02-03'),'من 3/2/2020 إلى 15/10/2026');
  const unknown=calendar('2026-10-15T16:04:02Z',null);
  assert.deepEqual(unknown.period('all'),{from:null,to:'2026-10-16'});
  assert.equal(unknown.performanceRangeLabel(unknown.period('all')),'من بداية الشركة إلى 15/10/2026');
});

test('Removed performance choices and unknown state fall back to this month',()=>{
  const {period}=calendar('2026-10-15T16:04:02Z');
  for(const old of ['day','week','unknown',undefined]){
    assert.deepEqual(period(old),{from:'2026-10-01',to:'2026-11-01'});
  }
  const team=source.slice(source.indexOf('  function addPerformance'),source.indexOf('  const oldTeam'));
  assert.deepEqual([...team.matchAll(/data-period="([^"]+)"/g)].map(m=>m[1]),['month','quarter','halfyear','nine_months','year','all']);
});
