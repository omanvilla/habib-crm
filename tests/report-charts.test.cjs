'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

// Execute the real chart renderers with a browser clock outside Oman.
process.env.TZ='America/Los_Angeles';
const source=fs.readFileSync('app-base-v15.html','utf8');
function extract(name,next){
  const start=source.indexOf('function '+name+'('),end=source.indexOf('\nfunction '+next+'(',start);
  assert.ok(start>=0&&end>start,name+' exists');
  return source.slice(start,end);
}
function render(deals,now='2026-12-31T20:01:00Z'){
  class FixedDate extends Date { constructor(...args){super(...(args.length?args:[now]));} }
  const nodes={revenueLineChart:{innerHTML:''},activityHeatmap:{innerHTML:''}};
  const script=extract('closedDeal','dealInClosingPeriod')+'\n'+extract('renderRevenueLineChart','renderRevenueDetails')+'\n'+extract('renderHeatmap','crmSafeImageUrl');
  new Function('Date','$','fmtMoney','fmtMoneyShort','deals',script+';renderRevenueLineChart(deals);renderHeatmap(deals);')(FixedDate,id=>nodes[id],String,String,deals);
  return {
    line:[...nodes.revenueLineChart.innerHTML.matchAll(/<title>([^<]+): ([^<]+)<\/title>/g)].map(x=>({month:x[1],value:Number(x[2])})),
    heat:[...nodes.activityHeatmap.innerHTML.matchAll(/title="([^"<>]+) (\d+): (\d+) صفقة"/g)].map(x=>({month:x[1],day:Number(x[2]),count:Number(x[3])}))
  };
}
const month=value=>new Date(value).toLocaleDateString('ar-OM-u-nu-latn',{month:'short',timeZone:'Asia/Muscat'});
const sale=(closed_at,deal_value,stage='closed')=>({stage,closed_at,deal_value});
const heat=(result,label,day)=>result.heat.find(x=>x.month===label&&x.day===day)?.count;

test('Both 12-month charts cross the year at Oman midnight and retain received-stage closings',()=>{
  const result=render([
    sale('2026-12-31T19:59:59.999Z',100),
    sale('2026-12-31T20:00:00Z',200,'commission_collected'),
    sale('2026-01-15T12:00:00Z',90000)
  ]);
  const january=month('2027-01-01T00:00:00Z'),december=month('2026-12-01T00:00:00Z');
  assert.equal(result.line.length,12);
  assert.equal(result.line[0].month,month('2026-02-01T00:00:00Z'));
  assert.equal(result.line[11].month,january);
  assert.equal(result.line.find(x=>x.month===december).value,100);
  assert.equal(result.line.find(x=>x.month===january).value,200);
  assert.equal(heat(result,december,31),1);
  assert.equal(heat(result,january,1),1);
  assert.equal(result.heat.reduce((sum,x)=>sum+x.count,0),2);
});

test('Charts require a real valid closing date and do not fabricate one from creation',()=>{
  const created_at='2027-01-01T01:00:00Z';
  const result=render([
    {...sale(null,90000),created_at},
    {...sale(undefined,80000,'commission_collected'),created_at},
    {...sale('invalid-date',70000),created_at},
    sale(created_at,60000,'deposit'),
    sale(created_at,20),
    sale(created_at,30,'commission_collected')
  ]);
  assert.equal(result.line.reduce((sum,x)=>sum+x.value,0),50);
  assert.equal(result.heat.reduce((sum,x)=>sum+x.count,0),2);
  assert.equal(heat(result,month(created_at),1),2);
});

test('Leap February keeps its last Oman day and March starts at the exclusive boundary',()=>{
  const result=render([
    sale('2024-02-29T19:59:59.999Z',10),
    sale('2024-02-29T20:00:00Z',20,'commission_collected')
  ],'2024-02-29T20:01:00Z');
  const february=month('2024-02-01T00:00:00Z'),march=month('2024-03-01T00:00:00Z');
  assert.equal(result.line[11].month,march);
  assert.equal(result.line.find(x=>x.month===february).value,10);
  assert.equal(result.line.find(x=>x.month===march).value,20);
  assert.equal(heat(result,february,29),1);
  assert.equal(heat(result,february,30),undefined);
  assert.equal(heat(result,march,1),1);
});
