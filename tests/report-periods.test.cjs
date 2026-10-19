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
test('Overview displays its Oman bounds and explains the actual sales, client and conversion bases',async()=>{
  const start=source.indexOf('async function loadReports('),end=source.indexOf('\nfunction renderRevenueLineChart(',start);
  const clients=[{created_at:'2024-02-29T19:59:59Z'},{created_at:'2024-02-29T20:00:00Z'}],deals=[
    {stage:'closed',created_at:'2024-01-15T08:00:00Z',closed_at:'2024-02-29T19:59:59Z',deal_value:100},
    {stage:'commission_collected',created_at:'2024-02-10T08:00:00Z',closed_at:'2024-02-29T20:00:00Z',deal_value:200},
    {stage:'negotiation',created_at:'2024-02-15T08:00:00Z',deal_value:300},
    {stage:'closed',created_at:'2024-01-01T08:00:00Z',closed_at:null,deal_value:999}
  ];
  for(const [options,expected] of [
    [{now:'2024-02-29T20:01:00Z'},'2024-03-01 — 2024-03-31'],
    [{month:'2024-02'},'2024-02-01 — 2024-02-29'],
    [{now:'2026-05-31T12:00:00Z',kind:'quarter'},'2026-02-28 — 2026-05-31']
  ]){
    const nodes={},notices=[],data=[clients,deals,[]],errors=[],noRender=()=>{};
    const env={...reports(options),reportTab:'overview',reportLoadSeq:0,currentUser:{id:'SYNTHETIC-OWNER'},crmSessionGeneration:1,isOwner:()=>true,crmSessionCurrent:()=>true,
      $:id=>nodes[id]||(nodes[id]={textContent:''}),crmReadAll:async()=>data.shift(),closedDeal:d=>['closed','commission_collected'].includes(d.stage),
      dealInClosingPeriod:(d,r)=>['closed','commission_collected'].includes(d.stage)&&!!d.closed_at&&new Date(d.closed_at)>=r.start&&new Date(d.closed_at)<r.end,
      fmtMoneyShort:String,showReportNotice:(message,error)=>notices.push({message,error}),showToast:message=>errors.push(message),console:{error:(...args)=>errors.push(args)},
      renderRevenueLineChart:noRender,renderClientStatusChart:noRender,renderPropTypesChart:noRender,renderClientSourcesChart:noRender};
    await new Function(...Object.keys(env),source.slice(start,end)+';return loadReports();')(...Object.values(env));
    assert.deepEqual(errors,[]);const notice=notices.at(-1);assert.equal(notice.error,false);assert(notice.message.startsWith(expected),notice.message);
    for(const explanation of ['بتوقيت مسقط','بحسب تاريخ الإغلاق','العملاء الجدد بحسب تاريخ إضافتهم','الصفقات المكتملة حاليًا من الفرص التي أُنشئت خلال الفترة'])assert(notice.message.includes(explanation),explanation);
    assert.doesNotMatch(notice.message,/العمولات بحسب حالة التحصيل|تدفقات نقدية/);
    if(options.month==='2024-02'){assert.equal(nodes.kpiRevenue.textContent,'100');assert.equal(nodes.kpiClosed.textContent,1);assert.equal(nodes.kpiNewClients.textContent,1);assert.equal(nodes.kpiConversion.textContent,'50%');}
  }
});
