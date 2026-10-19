'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync('app-base-v15.html','utf8');
function reports({now='2026-10-15T16:04:02Z',kind='month',month=null,company={created_at:'2026-05-06T15:00:00Z'}}={}){
  class FixedDate extends Date { constructor(...args){super(...(args.length?args:[now]));} }
  const window={specificMonth:month};
  const start=source.indexOf('function getPeriodRange('),end=source.indexOf('\nfunction recalculateOldCommissions',start);
  assert.ok(start>=0&&end>start,'Report date helpers are present before the legacy action guard');
  return new Function('Date','currentCompany','reportPeriod','window',source.slice(start,end)+';return {getPeriodRange,getPreviousPeriodRange};')(FixedDate,company,kind,window);
}
function bounds(range){return [range.start.toISOString(),range.end.toISOString()];}
test('Report presets match performance dates using Oman midnight and an exclusive end',()=>{
  const expected={
    month:['2026-09-30T20:00:00.000Z','2026-10-31T20:00:00.000Z'],
    quarter:['2026-07-14T20:00:00.000Z','2026-10-15T20:00:00.000Z'],
    halfyear:['2026-04-14T20:00:00.000Z','2026-10-15T20:00:00.000Z'],
    nine_months:['2026-01-14T20:00:00.000Z','2026-10-15T20:00:00.000Z'],
    year:['2025-10-14T20:00:00.000Z','2026-10-15T20:00:00.000Z']
  };
  for(const [kind,range] of Object.entries(expected))assert.deepEqual(bounds(reports({kind}).getPeriodRange()),range,kind);
  const range=reports().getPeriodRange();
  const included=value=>{const date=new Date(value);return date>=range.start&&date<range.end;};
  assert.equal(included('2026-10-01T00:00:00+04:00'),true);
  assert.equal(included('2026-10-31T23:59:59.999+04:00'),true);
  assert.equal(included('2026-11-01T00:00:00+04:00'),false);
});
test('Report calendar calculations clamp month ends and honor Oman day changes',()=>{
  assert.deepEqual(bounds(reports({now:'2024-05-31T12:00:00Z',kind:'quarter'}).getPeriodRange()),['2024-02-28T20:00:00.000Z','2024-05-31T20:00:00.000Z']);
  assert.deepEqual(bounds(reports({now:'2026-05-31T12:00:00Z',kind:'quarter'}).getPeriodRange()),['2026-02-27T20:00:00.000Z','2026-05-31T20:00:00.000Z']);
  assert.deepEqual(bounds(reports({now:'2026-09-30T20:00:00Z',kind:'month'}).getPeriodRange()),['2026-09-30T20:00:00.000Z','2026-10-31T20:00:00.000Z']);
});
test('Specific month and prior month keep full Oman bounds including leap February',()=>{
  const chosen=reports({kind:'year',month:'2024-02'});
  assert.deepEqual(bounds(chosen.getPeriodRange()),['2024-01-31T20:00:00.000Z','2024-02-29T20:00:00.000Z']);
  assert.deepEqual(bounds(chosen.getPreviousPeriodRange()),['2023-12-31T20:00:00.000Z','2024-01-31T20:00:00.000Z']);
  assert.deepEqual(bounds(reports({month:'2026-13'}).getPeriodRange()),bounds(reports().getPeriodRange()));
});
test('Report lifetime retains a historical deal before the technical company creation',()=>{
  const report=reports({kind:'all'}),history={deals:[{stage:'closed',created_at:'2026-10-01T10:00:00Z',closed_at:'2019-08-01T12:00:00Z'}],clients:[{created_at:'2022-02-01T12:00:00Z'}],properties:[]};
  assert.deepEqual(bounds(report.getPeriodRange(history)),['2019-07-31T20:00:00.000Z','2026-10-15T20:00:00.000Z']);
  assert.equal(report.getPreviousPeriodRange(history).end.toISOString(),'2019-07-31T20:00:00.000Z');
  assert.equal(report.getPeriodRange().start.toISOString(),'2026-05-05T20:00:00.000Z');
});
test('Preset click clears a specific month and report controls contain all six approved choices',()=>{
  const nodes={reportMonthPicker:{value:'2024-02'},reportMonthLabel:{textContent:'فبراير2024'}};
  const buttons=Array.from({length:6},()=>({classList:{remove(){this.active=false;},add(){this.active=true;}}}));
  const window={specificMonth:'2024-02'},document={querySelectorAll:()=>buttons};let loads=0;
  const start=source.indexOf('function setReportPeriod('),end=source.indexOf('\nfunction switchReportTab(',start);
  const api=new Function('window','document','$','loadReports','let reportPeriod="month";'+source.slice(start,end)+';return {setReportPeriod,kind:()=>reportPeriod};')(window,document,id=>nodes[id],()=>loads++);
  api.setReportPeriod('halfyear',buttons[2]);
  assert.equal(api.kind(),'halfyear');assert.equal(window.specificMonth,null);assert.equal(nodes.reportMonthPicker.value,'');assert.equal(nodes.reportMonthLabel.textContent,'');assert.equal(loads,1);assert.equal(buttons[2].classList.active,true);
  const controls=source.slice(source.indexOf('<div class="page" id="page-reports">'),source.indexOf('<div class="report-tabs">'));
  assert.deepEqual([...controls.matchAll(/data-report-period="([^"]+)"/g)].map(x=>x[1]),['month','quarter','halfyear','nine_months','year','all']);
});
