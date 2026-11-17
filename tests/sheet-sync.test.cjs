'use strict';
// SQL115 (17 Nov 2026, Ahmed): CRM → Google Sheets. The plan (supabase/functions/sheet-sync/plan.mjs) on a small copy of the
// two tabs: a new reservation, the commission received, a cancellation, an amount change, and two runs in a row.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const load = () => import('../supabase/functions/sheet-sync/plan.mjs');
const f = fs.readFileSync('db/changes/115-sheet-sync.forward.sql', 'utf8').replace(/\r\n/g, '\n');

const S = (d, m, y = 2026) => Math.round(Date.UTC(y, m - 1, d) / 86400e3) + 25569;
function salesGrid() {                       // rows 6..45 with the month in V; rows 30..45 are months 9..12, 4 rows each
  const g = Array.from({ length: 46 }, () => Array(22).fill(''));
  for (let r = 6; r <= 45; r++) g[r - 1][21] = r >= 30 ? 9 + Math.floor((r - 30) / 4) : 1 + Math.floor((r - 6) / 3);
  // an existing deal in row 38 (month 11): owner 97101070, sold 17/11
  const r38 = g[37]; r38[0] = '⏳ العمولة ما وصلت (منتظرة التخليص) • 10% لمرام'; r38[3] = 59; r38[4] = 'الرميس'; r38[7] = 'محمد';
  r38[12] = S(17, 11); r38[14] = S(13, 10); r38[15] = 1000; r38[16] = 59; r38[19] = 97101070; r38[20] = 'هشام الفعوان'; r38[10] = 1;
  return g;
}
function financeGrid() {
  const g = Array.from({ length: 14 }, () => Array(12).fill(''));
  g[5] = ['تاريخ الحجز', 'تاريخ الاستلام', 'المالك / الصفقة'];
  g[13] = ['', '', 'هشام — فيلا الرميس', 'وساطة عقارية', 1000, 'عقار أو مشتري (10%)', 100, '', 900, 'منتظرة', 'مرام', 'المالك هشام'];
  return g;
}
const hisham = { id: 'h', stage: 'awaiting_finance', deal_value: 59000, deposit_amount: 800, commission_total: 1000,
  employee_commission_percent: 10, reservation_confirmed_at: '2026-11-17T08:00:00Z', property_type: 'villa', area: 'بركاء الرميس',
  wilayat: 'بركاء', price: 59000, property_created_at: '2026-10-13T06:00:00Z', owner_name: 'هشام الفعوان', owner_phone: '+96897101070',
  buyer_name: 'محمد', buyer_phone: '+96898852274', agent_name: 'مرام' };
const fresh = { ...hisham, id: 'n', reservation_confirmed_at: '2026-12-02T09:00:00Z', owner_name: 'سالم', owner_phone: '+96891234567',
  buyer_name: 'خالد', buyer_phone: '+96899887766', property_created_at: '2026-11-01T06:00:00Z', deal_value: 61000, price: 63000 };
const cfg = { sales_tab: '2026', cancel_totals_mode: 'note_only', create_from_serial: S(18, 11) };
const grids = () => ({ sales: salesGrid(), salesFormulas: null, finance: financeGrid() });
const apply = (g, writes) => { for (const w of writes) { const t = w.tab === 'sales' ? g.sales : g.finance; while (t.length < w.row) t.push([]);
  t[w.row - 1][w.col.charCodeAt(0) - 65] = w.kind === 'clear' ? '' : w.v; } };
const linksOf = (saves, prev = {}) => { const l = { ...prev }; for (const s of saves) l[s.deal_id] = s; return l; };

test('the SQL only adds, starts off, and nobody in the app reads the sync tables', () => {
  assert.equal(f, fs.readFileSync('supabase/migrations/20261117140000_sheet_sync_20261117.sql', 'utf8').replace(/\r\n/g, '\n'));
  assert(f.includes("mode text NOT NULL DEFAULT 'off'"));
  assert(!/UPDATE public\.(deals|properties|owners|clients)\b/i.test(f) && !/DELETE FROM/i.test(f));
  for (const t of ['sheet_sync_rows', 'sheet_sync_log', 'sheet_sync_config']) assert(f.includes(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`));
  assert(f.includes('REVOKE ALL ON public.sheet_sync_rows, public.sheet_sync_log, public.sheet_sync_config FROM PUBLIC, anon, authenticated;'));
  assert(f.includes("where exists (select 1 from public.sheet_sync_config where id and mode <> 'off')"));
});

test('adopt links the rows already there and writes nothing; the next run writes nothing either', async () => {
  const { adopt, plan } = await load();
  const g = grids(), a = adopt([hisham], {}, g, {});
  assert.deepEqual([a.found[0].sales_row, a.found[0].finance_row], [38, 14]);
  const p = plan([hisham], linksOf(a.found), g, cfg);
  assert.equal(p.writes.length, 0);
});

test('a new reservation: one row in its month, one row under the table, real dates and numbers; twice = once', async () => {
  const { plan } = await load();
  const g = grids(), p = plan([fresh], {}, g, cfg);
  const at = (tab, col) => p.writes.find((w) => w.tab === tab && w.col === col);
  assert.equal(at('sales', 'D').row, 42);                                   // first free row of month 12
  assert.deepEqual([at('sales', 'M').kind, at('sales', 'M').v], ['date', S(2, 12)]);
  assert.deepEqual([at('sales', 'D').v, at('sales', 'Q').v, at('sales', 'P').v, at('sales', 'K').v], [61, 63, 1000, 1]);
  assert.deepEqual([at('sales', 'T').kind, at('sales', 'T').v, at('sales', 'G').v], ['number', 91234567, 99887766]);
  assert.equal(at('sales', 'A').v, '⏳ العمولة ما وصلت (منتظرة التخليص) • 10% لمرام');
  assert(!at('sales', 'B') && !at('sales', 'C') && !at('sales', 'L'));
  assert.equal(at('finance', 'C').row, 15);
  assert.deepEqual([at('finance', 'C').v, at('finance', 'J').v, at('finance', 'F').v], ['سالم — فيلا', 'منتظرة', 'عقار أو مشتري (10%)']);
  assert(!p.writes.some((w) => w.tab === 'finance' && ['G', 'H', 'I'].includes(w.col)));
  apply(g, p.writes);
  const again = plan([fresh], linksOf(p.saves), g, cfg);
  assert.equal(again.writes.length, 0);
  const lost = plan([fresh], {}, g, cfg);                                   // the link was never saved: the rows are found, not doubled
  assert.equal(lost.writes.length, 0);
  assert.deepEqual([lost.saves[0].sales_row, lost.saves[0].finance_row], [42, 15]);
});

test('commission received, amount changed, cancelled: only those cells change', async () => {
  const { adopt, plan } = await load();
  const g = grids(), links = linksOf(adopt([hisham], {}, g, {}).found);
  const recv = { ...hisham, commission_received_at: '2026-11-20T07:00:00Z', company_commission_received_amount: 975, stage: 'commission_collected' };
  const p = plan([recv], links, g, cfg);
  const cols = p.writes.map((w) => `${w.tab}:${w.col}`).sort();
  assert.deepEqual(cols, ['finance:B', 'finance:J', 'sales:A', 'sales:B', 'sales:C', 'sales:L']);
  assert.equal(p.writes.find((w) => w.col === 'A').v, '✓ العمولة وصلت (1000 ناقص 25 رسوم = 975)');
  assert.equal(p.writes.find((w) => w.tab === 'finance' && w.col === 'J').v, 'مستلمة');
  const amt = plan([{ ...hisham, commission_total: 1200, deal_value: 60000 }], links, g, cfg);
  assert.deepEqual(amt.writes.map((w) => `${w.tab}:${w.col}=${w.v}`).sort(), ['finance:E=1200', 'sales:D=60', 'sales:P=1200']);
  const canc = plan([{ ...hisham, stage: 'lost', reservation_cancelled_at: '2026-11-25T07:00:00Z', reservation_cancellation_reason: 'التمويل رُفض' }], links, g, cfg);
  assert.deepEqual(canc.writes.map((w) => `${w.tab}:${w.col}`).sort(), ['finance:J', 'sales:A']);
  assert.equal(canc.writes.find((w) => w.col === 'A').v, '✖ حجز ملغي • التمويل رُفض • 25/11/2026');
  assert.equal(canc.writes.find((w) => w.tab === 'finance').v, 'ملغاة');
  const clear = plan([{ ...hisham, reservation_cancelled_at: '2026-11-25T07:00:00Z' }], links, g, { ...cfg, cancel_totals_mode: 'clear_k_p' });
  assert.deepEqual(clear.writes.filter((w) => w.kind === 'clear').map((w) => w.col).sort(), ['C', 'K', 'P']);
});

test('I and J are put back as formulas only when they are not formulas; a moved row is a problem, not a write', async () => {
  const { adopt, plan } = await load();
  const g = grids(), links = linksOf(adopt([hisham], {}, g, {}).found);
  g.salesFormulas = salesGrid(); g.salesFormulas[37][8] = ''; g.salesFormulas[37][9] = '=(M38-O38)';
  const p = plan([{ ...hisham, commission_total: 1100 }], links, g, cfg);
  assert.deepEqual(p.writes.filter((w) => w.kind === 'formula').map((w) => `${w.col}${w.row}=${w.v}`), ['I38==IF(L38="","",L38-M38)']);
  g.sales[37][19] = 99999999;                                                // someone typed another owner over row 38
  const m = plan([{ ...hisham, commission_total: 1300 }], links, g, cfg);
  assert.equal(m.writes.length, 0);
  assert.equal(m.problems[0].code, 'sales_row_changed');
});

test('old deals are only adopted, a month with no free row is reported, cancelled-before-sync is not written', async () => {
  const { plan } = await load();
  const g = grids();
  assert.equal(plan([{ ...fresh, reservation_confirmed_at: '2026-10-02T09:00:00Z' }], {}, g, cfg).writes.length, 0);
  assert.equal(plan([{ ...fresh, reservation_cancelled_at: '2026-12-05T09:00:00Z' }], {}, g, cfg).writes.length, 0);
  for (let r = 42; r <= 45; r++) g.sales[r - 1][3] = 50;
  const full = plan([fresh], {}, g, cfg);
  assert.equal(full.problems[0].code, 'month_full');
  assert.equal(full.saves.length, 0);
});
