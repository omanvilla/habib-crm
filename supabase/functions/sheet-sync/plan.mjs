// SQL115 sheet sync (17 Nov 2026, Ahmed): the pure part. Given the CRM deals, the deal↔row links and what the two sheets
// hold now, it returns the cell writes, the links to save and the problems. No network, no database: the edge function
// (index.ts) reads and writes, and tests/sheet-sync.test.cjs runs this file as is.

export const SALES_FIRST = 6, SALES_LAST = 45;        // «2026»: data rows 6..45 (row 46 is «المجموع»)
export const FIN_FIRST = 7, FIN_LAST = 207;           // «العمولات»: rows 7..207 (the array formulas stop at 207)
const COL = (L) => L.charCodeAt(0) - 65;               // 'A' → 0

// ---- values ----
export function muscatSerial(ts) {                       // a real Sheets date: days since 30 Dec 1899, Muscat day (UTC+4)
  if (!ts) return null;
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return null;
  return Math.floor((ms + 4 * 3600e3) / 86400e3) + 25569;
}
export function serialText(s) {                         // 46343 → 17/11/2026 (for notes)
  const d = new Date((s - 25569) * 86400e3);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}
export function phoneNumber(p) {                        // +96897101070 → 97101070 (a number); other countries keep their code
  const d = String(p || '').replace(/\D/g, '');
  if (!d || /^0+$/.test(d.replace(/^968/, ''))) return null;
  const local = d.length === 11 && d.startsWith('968') ? d.slice(3) : d;
  return Number(local);
}
export function thousands(v) {                          // 59000 → 59, 20800 → 20.8
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n / 100) / 10 : null;
}
const num = (v) => { const n = Number(v); return v === null || v === undefined || v === '' || !Number.isFinite(n) ? null : n; };
const TYPES = { villa: 'فيلا', house: 'بيت', land: 'ارض', land_residential: 'ارض', land_commercial: 'ارض تجارية',
  land_agricultural: 'ارض زراعية', apartment: 'شقة', farm: 'مزرعة', building: 'بناية', shop: 'محل', office: 'مكتب',
  warehouse: 'مخزن', chalet: 'شاليه' };
export const typeAr = (t) => TYPES[String(t || '').toLowerCase()] || String(t || '');
export function areaText(area, wilayat) {
  let a = String(area || '').trim();
  for (const w of [wilayat, 'بركاء', 'مسقط'].filter(Boolean)) if (a.startsWith(w + ' ')) a = a.slice(w.length + 1).trim();
  return a;
}
export function coordinator(pct) {
  const p = num(pct) || 0;
  return p >= 20 ? 'الاثنين (20%)' : p > 0 ? 'عقار أو مشتري (10%)' : 'بدون';
}

// ---- the state of one deal, as the sheets should show it ----
export function dealState(d) {
  const sale = muscatSerial(d.reservation_confirmed_at || d.commission_received_at);
  const received = !!d.commission_received_at || d.commission_status === 'received';
  const cancelledAt = d.reservation_cancelled_at || (d.stage === 'lost' && d.reservation_confirmed_at ? d.lost_at || d.updated_at : null);
  const ct = num(d.commission_total);
  const amt = received ? (num(d.company_commission_received_amount) ?? ct) : null;
  return {
    sale, year: sale ? new Date((sale - 25569) * 86400e3).getUTCFullYear() : null,
    month: sale ? new Date((sale - 25569) * 86400e3).getUTCMonth() + 1 : null,
    recv: received ? muscatSerial(d.commission_received_at) : null, amt, ct,
    value: thousands(d.deal_value), price: thousands(d.price),
    cancelled: cancelledAt ? muscatSerial(cancelledAt) : null,
    reason: String(d.reservation_cancellation_reason || d.lost_reason_note || '').trim(),
    pct: num(d.employee_commission_percent) || 0, agent: String(d.agent_name || '').trim(),
    owner: String(d.owner_name || '').trim(), ownerPhone: phoneNumber(d.owner_phone),
    buyer: String(d.buyer_name || '').trim(), buyerPhone: phoneNumber(d.buyer_phone),
    type: typeAr(d.property_type), area: areaText(d.area, d.wilayat), listed: muscatSerial(d.property_created_at),
    deposit: num(d.deposit_amount), financing: String(d.bank_financing || '').trim(), stage: d.stage,
  };
}
export function stateHash(s) {                          // stable text of the fields the sheets show
  return JSON.stringify(['sale', 'recv', 'amt', 'ct', 'value', 'cancelled', 'reason', 'pct', 'agent'].map((k) => s[k] ?? null));
}

export function noteReserved(s) {
  const who = s.pct > 0 ? ` • ${s.pct}% ل${s.agent || 'المنسقة'}` : '';
  return `⏳ العمولة ما وصلت (منتظرة التخليص)${who}`;
}
export function noteReceived(s) {
  const fee = s.ct !== null && s.amt !== null && s.amt < s.ct ? Math.round((s.ct - s.amt) * 1000) / 1000 : 0;
  return fee > 0 ? `✓ العمولة وصلت (${s.ct} ناقص ${fee} رسوم = ${s.amt})` : `✓ العمولة وصلت (${s.amt})`;
}
export function noteCancelled(s) {
  return `✖ حجز ملغي • ${s.reason || 'بدون سبب مسجل'} • ${serialText(s.cancelled)}`;
}
export const finStatus = (s) => (s.cancelled ? 'ملغاة' : s.recv !== null ? 'مستلمة' : 'منتظرة');
export function finNote(s) {
  const parts = [];
  if (s.buyer) parts.push(`المشتري ${s.buyer}`);
  if (s.deposit) parts.push(`العربون ${s.deposit}`);
  if (s.financing) parts.push(`التمويل: ${s.financing}`);
  else if (s.stage === 'awaiting_finance') parts.push('بانتظار التمويل البنكي');
  return parts.join('، ');
}
export const finTitle = (s) => `${s.owner} — ${s.type}`;

// ---- grid helpers (grids are arrays of rows from the Sheets API, row 1 = index 0, unformatted values) ----
const cell = (g, r, L) => { const row = g[r - 1] || []; const v = row[COL(L)]; return v === undefined ? '' : v; };
const empty = (v) => v === '' || v === null || v === undefined;
const digits = (v) => String(v ?? '').replace(/\D/g, '');

// a row already holding this deal: owner phone + sale or received date; the buyer's phone decides between two such rows
function salesRowFor(g, s, taken = new Set()) {
  const hits = [];
  for (let r = SALES_FIRST; r <= SALES_LAST; r++) {
    if (taken.has(r) || !s.ownerPhone || digits(cell(g, r, 'T')) !== String(s.ownerPhone)) continue;
    const m = num(cell(g, r, 'M')), l = num(cell(g, r, 'L'));
    if ((s.sale && m === s.sale) || (s.recv && l === s.recv)) hits.push(r);
  }
  return hits.find((r) => s.buyerPhone && digits(cell(g, r, 'G')) === String(s.buyerPhone)) ?? hits[0] ?? null;
}
function freeSalesRow(g, month, taken) {
  for (let r = SALES_FIRST; r <= SALES_LAST; r++) {
    if (num(cell(g, r, 'V')) !== month || taken.has(r)) continue;
    if (empty(cell(g, r, 'D')) && empty(cell(g, r, 'E')) && empty(cell(g, r, 'H'))) return r;
  }
  return null;
}
function finRowFor(g, s) {
  for (let r = FIN_FIRST; r <= FIN_LAST; r++) if (String(cell(g, r, 'C')).trim() === finTitle(s) && num(cell(g, r, 'A')) === s.sale) return r;
  return null;
}
function freeFinRow(g, taken) {                         // the first row under the last used one
  let last = FIN_FIRST - 1;
  for (let r = FIN_FIRST; r <= FIN_LAST; r++) if (['A', 'B', 'C', 'E', 'J', 'L'].some((L) => !empty(cell(g, r, L)))) last = r;
  for (let r = last + 1; r <= FIN_LAST; r++) if (!taken.has(r)) return r;
  return null;
}
const squash = (v) => String(v ?? '').replace(/\s+/g, '').toUpperCase();
const sameFormula = (v, wants) => wants.some((w) => squash(v) === squash(w));

// ---- the plan ----
// deals: rows from crm_sheet_sync_deals; links: sheet_sync_rows by deal id; grids: { sales, salesFormulas, finance }
// cfg: { create_from_serial, cancel_totals_mode, sales_tab }
export function plan(deals, links, grids, cfg) {
  const writes = [], saves = [], problems = [], skipped = [];
  const takenS = new Set(Object.values(links).map((l) => l.sales_row).filter(Boolean));
  const takenF = new Set(Object.values(links).map((l) => l.finance_row).filter(Boolean));
  const put = (tab, row, col, kind, v, deal) => writes.push({ tab, row, col, kind, v, deal });

  for (const d of deals) {
    const s = dealState(d), link = links[d.id] || null, hash = stateHash(s), prev = link?.last_snapshot || null;
    if (!s.sale) continue;
    if (link && link.last_hash === hash && link.status !== 'error') continue;      // nothing changed: no write at all
    if (String(s.year) !== String(cfg.sales_tab)) { problems.push({ deal: d.id, code: 'no_sales_tab', detail: `سنة ${s.year}` }); continue; }
    const isNew = !link;
    if (isNew && s.sale < cfg.create_from_serial) { skipped.push({ deal: d.id, why: 'before_create_from' }); continue; }
    if (isNew && s.cancelled) { skipped.push({ deal: d.id, why: 'cancelled_before_first_sync' }); continue; }

    const out = { deal_id: d.id, sales_row: link?.sales_row ?? null, finance_row: link?.finance_row ?? null,
      sales_key: link?.sales_key ?? null, finance_key: link?.finance_key ?? null };
    let failed = false;

    // «2026»
    let sr = out.sales_row;
    if (sr && s.ownerPhone && digits(cell(grids.sales, sr, 'T')) !== String(s.ownerPhone)) {
      const moved = salesRowFor(grids.sales, s);
      if (moved) sr = moved; else { problems.push({ deal: d.id, code: 'sales_row_changed', detail: `الصف ${sr} ما عاد فيه رقم المالك` }); failed = true; }
    }
    const createS = isNew && !sr && !failed;                              // an adopted deal with no row here stays without one
    if (createS) {
      sr = salesRowFor(grids.sales, s, takenS);                               // written before but the link was not saved
      if (!sr) {
        sr = freeSalesRow(grids.sales, s.month, takenS);
        if (!sr) { problems.push({ deal: d.id, code: 'month_full', detail: `شهر ${s.month} ما فيه صف فاضي` }); failed = true; }
        else {
          takenS.add(sr);
          const T = 'sales';
          put(T, sr, 'A', 'string', s.recv !== null ? noteReceived(s) : noteReserved(s), d.id);
          if (s.recv !== null) { put(T, sr, 'B', 'date', s.recv, d.id); put(T, sr, 'C', 'number', s.amt, d.id); put(T, sr, 'L', 'date', s.recv, d.id); }
          put(T, sr, 'D', 'number', s.value, d.id); put(T, sr, 'E', 'string', s.area, d.id); put(T, sr, 'F', 'string', s.type, d.id);
          put(T, sr, 'G', 'number', s.buyerPhone, d.id); put(T, sr, 'H', 'string', s.buyer, d.id); put(T, sr, 'K', 'number', 1, d.id);
          put(T, sr, 'M', 'date', s.sale, d.id); put(T, sr, 'O', 'date', s.listed, d.id); put(T, sr, 'P', 'number', s.ct, d.id);
          put(T, sr, 'Q', 'number', s.price, d.id); put(T, sr, 'R', 'string', s.area, d.id); put(T, sr, 'S', 'string', s.type, d.id);
          put(T, sr, 'T', 'number', s.ownerPhone, d.id); put(T, sr, 'U', 'string', s.owner, d.id);
        }
      }
    }
    if (sr && !failed) {
      out.sales_row = sr; out.sales_key = String(s.ownerPhone || ''); takenS.add(sr);
      if (!createS && prev) {                                                // only what changed since the last sync
        const T = 'sales';
        if (s.cancelled && !prev.cancelled) {
          put(T, sr, 'A', 'string', noteCancelled(s), d.id);
          if (cfg.cancel_totals_mode === 'clear_k_p') { put(T, sr, 'K', 'clear', null, d.id); put(T, sr, 'P', 'clear', null, d.id); put(T, sr, 'C', 'clear', null, d.id); }
        } else if (!s.cancelled) {
          if (s.recv !== null && (prev.recv !== s.recv || prev.amt !== s.amt)) {
            put(T, sr, 'A', 'string', noteReceived(s), d.id); put(T, sr, 'B', 'date', s.recv, d.id);
            put(T, sr, 'C', 'number', s.amt, d.id); put(T, sr, 'L', 'date', s.recv, d.id);
          }
          if (s.value !== prev.value && s.value !== null) put(T, sr, 'D', 'number', s.value, d.id);
          if (s.ct !== prev.ct && s.ct !== null) put(T, sr, 'P', 'number', s.ct, d.id);
          if (s.recv === null && (s.pct !== prev.pct || s.agent !== prev.agent)) put(T, sr, 'A', 'string', noteReserved(s), d.id);
        }
      }
      const touched = writes.some((w) => w.tab === 'sales' && w.row === sr);
      if (touched) {                                                         // I and J stay formulas
        // anything but the original formula of the row (empty, a value, or the old «=L42-M42») is put back
        const wantI = `=IF(L${sr}="","",L${sr}-M${sr})`, wantJ = `=(M${sr}-O${sr})`;
        const fi = grids.salesFormulas ? sameFormula(cell(grids.salesFormulas, sr, 'I'), [wantI]) : true;
        const fj = grids.salesFormulas ? sameFormula(cell(grids.salesFormulas, sr, 'J'), [wantJ, `=M${sr}-O${sr}`]) : true;
        if (!fi) put('sales', sr, 'I', 'formula', wantI, d.id);
        if (!fj) put('sales', sr, 'J', 'formula', wantJ, d.id);
      }
    }

    // «العمولات»
    let fr = out.finance_row;
    if (fr && out.finance_key && String(cell(grids.finance, fr, 'C')).trim() !== out.finance_key) {
      let moved = null;
      for (let r = FIN_FIRST; r <= FIN_LAST; r++) if (String(cell(grids.finance, r, 'C')).trim() === out.finance_key) { moved = r; break; }
      if (moved) fr = moved; else { problems.push({ deal: d.id, code: 'finance_row_changed', detail: `الصف ${fr} ما عاد «${out.finance_key}»` }); failed = true; }
    }
    if (!failed) {
      const createF = isNew && !fr;
      if (createF) {
        fr = finRowFor(grids.finance, s);
        if (!fr) {
          fr = freeFinRow(grids.finance, takenF);
          if (!fr) { problems.push({ deal: d.id, code: 'finance_full', detail: 'ما في صف فاضي في العمولات' }); failed = true; }
          else {
            takenF.add(fr);
            const T = 'finance';
            put(T, fr, 'A', 'date', s.sale, d.id);
            if (s.recv !== null) put(T, fr, 'B', 'date', s.recv, d.id);
            put(T, fr, 'C', 'string', finTitle(s), d.id); put(T, fr, 'D', 'string', 'وساطة عقارية', d.id);
            put(T, fr, 'E', 'number', s.ct, d.id); put(T, fr, 'F', 'string', coordinator(s.pct), d.id);
            put(T, fr, 'J', 'string', finStatus(s), d.id); put(T, fr, 'K', 'string', s.pct > 0 ? (s.agent || 'بدون') : 'بدون', d.id);
            put(T, fr, 'L', 'string', finNote(s), d.id);
          }
        }
        if (fr && !failed) out.finance_key = String(cell(grids.finance, fr, 'C')).trim() || finTitle(s);
      } else if (prev && fr) {
        const T = 'finance';
        if (finStatus(s) !== finStatus(prev)) put(T, fr, 'J', 'string', finStatus(s), d.id);
        if (!s.cancelled && s.recv !== null && prev.recv !== s.recv) put(T, fr, 'B', 'date', s.recv, d.id);
        if (s.ct !== prev.ct && s.ct !== null) put(T, fr, 'E', 'number', s.ct, d.id);
        if (s.pct !== prev.pct) put(T, fr, 'F', 'string', coordinator(s.pct), d.id);
      }
      if (fr && !failed) out.finance_row = fr;
    }

    if (failed && isNew) continue;                                           // nothing saved: the next run tries again (rows found by phone + date)
    saves.push({ ...out, last_hash: failed ? link?.last_hash ?? null : hash, last_snapshot: failed ? prev : s,
      status: failed ? 'error' : 'synced' });
  }
  return { writes, saves, problems, skipped };
}

// adopt (first run): link the rows already in the sheets to their deals, write nothing.
// forced: { dealId: { sales_row, finance_row } } for the rows Ahmed named.
export function adopt(deals, links, grids, forced = {}) {
  const found = [], missing = [], diffs = [];
  const takenS = new Set(Object.values(links).map((l) => l.sales_row).filter(Boolean));
  const takenF = new Set(Object.values(links).map((l) => l.finance_row).filter(Boolean));
  for (const f of Object.values(forced)) { if (f.sales_row) takenS.add(f.sales_row); if (f.finance_row) takenF.add(f.finance_row); }
  // the named rows first, then the others; a row is never given to two deals
  const order = [...deals].sort((a, b) => (forced[b.id] ? 1 : 0) - (forced[a.id] ? 1 : 0));
  for (const d of order) {
    if (links[d.id]) continue;
    const s = dealState(d);
    if (!s.sale) continue;
    const f = forced[d.id] || {};
    const forcedOk = f.sales_row && s.ownerPhone && digits(cell(grids.sales, f.sales_row, 'T')) === String(s.ownerPhone);
    const sr = forcedOk ? f.sales_row : salesRowFor(grids.sales, s, takenS);   // a named row is used only if it still holds this owner
    let fr = f.finance_row || null;
    if (!fr) { const r = finRowFor(grids.finance, s); if (r && !takenF.has(r)) fr = r; }
    if (!fr) {                     // no date in A: owner's first name + the amount + (the received date, or still «منتظرة»)
      const first = s.owner.split(/\s+/)[0];
      for (let r = FIN_FIRST; r <= FIN_LAST; r++) {
        if (takenF.has(r)) continue;
        const g = grids.finance, c = String(cell(g, r, 'C'));
        const sameStage = s.recv !== null ? num(cell(g, r, 'B')) === s.recv : String(cell(g, r, 'J')) === 'منتظرة';
        if (first && c.includes(first) && num(cell(g, r, 'E')) === s.ct && sameStage) { fr = r; break; }
      }
    }
    if (sr) takenS.add(sr);
    if (fr) takenF.add(fr);
    if (!sr && !fr) { missing.push({ deal: d.id, owner: s.owner, sale: serialText(s.sale), cancelled: !!s.cancelled }); continue; }
    if (sr) {
      const g = grids.sales, chk = [['D', s.value], ['P', s.ct], ['M', s.sale], ['O', s.listed], ['Q', s.price]];
      if (s.recv !== null) chk.push(['L', s.recv], ['C', s.amt]);
      for (const [L, want] of chk) { const have = num(cell(g, sr, L)); if (want !== null && have !== want) diffs.push({ deal: d.id, tab: 'sales', row: sr, col: L, sheet: cell(g, sr, L), crm: want }); }
    }
    if (fr) {
      const g = grids.finance;
      if (num(cell(g, fr, 'E')) !== s.ct) diffs.push({ deal: d.id, tab: 'finance', row: fr, col: 'E', sheet: cell(g, fr, 'E'), crm: s.ct });
      if (String(cell(g, fr, 'J')) !== finStatus(s)) diffs.push({ deal: d.id, tab: 'finance', row: fr, col: 'J', sheet: cell(g, fr, 'J'), crm: finStatus(s) });
      if (num(cell(g, fr, 'A')) !== s.sale) diffs.push({ deal: d.id, tab: 'finance', row: fr, col: 'A', sheet: cell(g, fr, 'A'), crm: s.sale });
    }
    found.push({ deal_id: d.id, sales_row: sr || null, finance_row: fr || null, sales_key: sr ? String(s.ownerPhone || '') : null,
      finance_key: fr ? String(cell(grids.finance, fr, 'C')).trim() : null, last_hash: stateHash(s), last_snapshot: s, status: 'adopted' });
  }
  return { found, missing, diffs };
}
