// SQL115 sheet sync (17 Nov 2026, Ahmed): every 5 minutes (cron sheet_sync_every_5_min) copies the deals from the CRM to
// «تم البيع والدخل» tab 2026 and «النظام المالي - أحمد» tab «العمولات». The CRM is only read; the only database writes are
// the sheet_sync_* tables and, when a run fails, one notification for the owner. Called only with the reply-agent secret.
// actions: run (what the cron sends; follows sheet_sync_config.mode), dry_run (the intended writes, nothing written),
// adopt (first run: link the rows already in the sheets; confirm=true saves the links; never writes the sheets).
// The Google key is the edge secret GOOGLE_SERVICE_ACCOUNT_JSON (never in the repo).
import { createClient } from "npm:@supabase/supabase-js@2";
import { plan, adopt, muscatSerial } from "./plan.mjs";

const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const short = (t: string, n: number) => (t.length > n ? t.slice(0, n) + "…" : t);
// the two «2026» rows Ahmed named (17 Nov 2026). Their «العمولات» rows are found by content: that tab gets re-sorted
// (Hisham moved from row 14 to row 8 the same afternoon), so a fixed row number there would point at another deal.
const FORCED: Record<string, { sales_row: number }> = {
  "03d66096-c655-4f4f-82b3-e0751581c76f": { sales_row: 38 },
  "10ce4b8d-7abc-47d8-a5a4-4df24b2e8e93": { sales_row: 30 },
};

// ---- Google ----
let tokenCache: { t: string; exp: number } | null = null;
const b64url = (b: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof b === "string" ? new TextEncoder().encode(b) : new Uint8Array(b as ArrayBuffer);
  let s = ""; for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
async function googleToken(): Promise<string> {
  if (tokenCache && tokenCache.exp > Date.now() + 60e3) return tokenCache.t;
  const raw = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON") ?? "";
  if (!raw) throw new Error("google_key_missing");
  const sa = JSON.parse(raw);
  const pem = String(sa.private_key).replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const sig = b64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${claims}`)));
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claims}.${sig}` }) });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error(`google_token_failed: ${short(JSON.stringify(j), 200)}`);
  tokenCache = { t: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return j.access_token;
}
async function gapi(url: string, init: RequestInit = {}) {
  const r = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${url}`, { ...init,
    headers: { Authorization: `Bearer ${await googleToken()}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`sheets_${r.status}: ${short(JSON.stringify(j?.error ?? j), 300)}`);
  return j;
}
const q = (tab: string, range: string) => encodeURIComponent(`'${tab.replace(/'/g, "''")}'!${range}`);
async function readGrids(cfg: any, salesTab: string) {
  const [sv, sf, fv] = await Promise.all([
    gapi(`${cfg.sales_spreadsheet_id}/values/${q(salesTab, "A1:V60")}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`),
    gapi(`${cfg.sales_spreadsheet_id}/values/${q(salesTab, "A1:V60")}?valueRenderOption=FORMULA`),
    gapi(`${cfg.finance_spreadsheet_id}/values/${q(cfg.finance_tab, "A1:M210")}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`),
  ]);
  return { sales: sv.values ?? [], salesFormulas: sf.values ?? [], finance: fv.values ?? [] };
}
async function sheetIds(id: string) {
  const j = await gapi(`${id}?fields=sheets.properties(sheetId,title)`);
  return Object.fromEntries((j.sheets ?? []).map((s: any) => [s.properties.title, s.properties.sheetId]));
}
// one batchUpdate per spreadsheet: every cell with its exact type (dates are real dates dd/mm/yyyy, numbers are numbers)
function cellRequest(sheetId: number, w: any) {
  const range = { sheetId, startRowIndex: w.row - 1, endRowIndex: w.row, startColumnIndex: w.col.charCodeAt(0) - 65, endColumnIndex: w.col.charCodeAt(0) - 64 };
  let value: any = {}, fields = "userEnteredValue";
  if (w.kind === "string") value = { userEnteredValue: { stringValue: String(w.v ?? "") } };
  else if (w.kind === "number") value = w.v === null || w.v === undefined ? {} : { userEnteredValue: { numberValue: Number(w.v) } };
  else if (w.kind === "formula") value = { userEnteredValue: { formulaValue: w.v } };
  else if (w.kind === "date") {
    value = w.v === null ? {} : { userEnteredValue: { numberValue: w.v }, userEnteredFormat: { numberFormat: { type: "DATE", pattern: "dd/mm/yyyy" } } };
    fields = "userEnteredValue,userEnteredFormat.numberFormat";
  } // clear: empty value with fields=userEnteredValue
  return { updateCells: { range, rows: [{ values: [value] }], fields } };
}
async function applyWrites(cfg: any, salesTab: string, writes: any[]) {
  const groups: Record<string, { id: string; tab: string; ws: any[] }> = {
    sales: { id: cfg.sales_spreadsheet_id, tab: salesTab, ws: [] }, finance: { id: cfg.finance_spreadsheet_id, tab: cfg.finance_tab, ws: [] } };
  for (const w of writes) groups[w.tab].ws.push(w);
  for (const g of Object.values(groups)) {
    if (!g.ws.length) continue;
    const ids = await sheetIds(g.id);
    if (ids[g.tab] === undefined) throw new Error(`tab_missing: ${g.tab}`);
    await gapi(`${g.id}:batchUpdate`, { method: "POST", body: JSON.stringify({ requests: g.ws.map((w) => cellRequest(ids[g.tab], w)) }) });
  }
}

// ---- CRM side ----
async function load(fromIso: string) {
  const [cfgR, dealsR, linksR] = await Promise.all([
    db.from("sheet_sync_config").select("*").eq("id", true).single(),
    db.rpc("crm_sheet_sync_deals", { p_from: fromIso }),
    db.from("sheet_sync_rows").select("*"),
  ]);
  if (cfgR.error) throw new Error(`config: ${cfgR.error.message}`);
  if (dealsR.error) throw new Error(`deals: ${dealsR.error.message}`);
  if (linksR.error) throw new Error(`links: ${linksR.error.message}`);
  const links: Record<string, any> = {};
  for (const l of linksR.data ?? []) links[l.deal_id] = l;
  const deals = ((dealsR.data ?? []) as any[]).map((x) => x?.crm_sheet_sync_deals ?? x);
  return { cfg: cfgR.data, deals, links };
}
async function log(run: string, level: string, action: string, message: string, detail: unknown = null, deal: string | null = null) {
  await db.from("sheet_sync_log").insert({ run_id: run, deal_id: deal, level, action, message: short(message, 1000), detail });
}
async function notifyOwner(cfg: any, body: string) {                      // at most one unread alert every 6 hours
  if (!cfg.owner_user_id) return;
  const since = new Date(Date.now() - 6 * 3600e3).toISOString();
  const open = await db.from("notifications").select("id").eq("user_id", cfg.owner_user_id).eq("type", "sheet_sync_error")
    .eq("is_read", false).gte("created_at", since).limit(1);
  if (open.data?.length) return;
  await db.from("notifications").insert({ user_id: cfg.owner_user_id, type: "sheet_sync_error", is_read: false, link: "deals",
    title: "ربط الشيتات: المزامنة فشلت", body: short(body, 1500) });
}

async function run(mode: "run" | "dry_run", run: string) {
  const { cfg, deals, links } = await load("2026-01-01");
  const live = mode === "run" && cfg.mode === "live";
  if (mode === "run" && cfg.mode === "off") return { skipped: "mode_off" };
  if (!cfg.sales_spreadsheet_id || !cfg.finance_spreadsheet_id) throw new Error("spreadsheet_ids_missing");
  const salesTab = cfg.sales_tabs?.[0] ?? "2026";
  const grids = await readGrids(cfg, salesTab);
  const p = plan(deals, links, grids, { sales_tab: salesTab, cancel_totals_mode: cfg.cancel_totals_mode,
    create_from_serial: muscatSerial(`${cfg.create_from}T00:00:00+04:00`) });
  if (!live) {
    if (mode === "dry_run" || p.writes.length || p.problems.length) await log(run, "info", "dry_run", `${p.writes.length} كتابة مقصودة`, p);
    return { live: false, ...p };
  }
  if (p.writes.length) await applyWrites(cfg, salesTab, p.writes);
  const now = new Date().toISOString();
  for (const s of p.saves) {
    const r = await db.from("sheet_sync_rows").upsert({ ...s, last_synced_at: now,
      sales_spreadsheet_id: cfg.sales_spreadsheet_id, finance_spreadsheet_id: cfg.finance_spreadsheet_id });
    if (r.error) throw new Error(`save_link ${s.deal_id}: ${r.error.message}`);
  }
  await db.from("sheet_sync_config").update({ last_cursor: now, updated_at: now }).eq("id", true);
  if (p.writes.length || p.problems.length) await log(run, p.problems.length ? "error" : "info", "run", `${p.writes.length} كتابة`, p);
  if (p.problems.length) {
    for (const pr of p.problems) await log(run, "error", pr.code, pr.detail ?? pr.code, null, pr.deal);
    await notifyOwner(cfg, p.problems.map((x: any) => `• ${x.detail ?? x.code}`).join("\n"));
  }
  return { live: true, writes: p.writes.length, saves: p.saves.length, problems: p.problems, skipped: p.skipped };
}

async function doAdopt(confirm: boolean, run: string) {
  const { cfg, deals, links } = await load("2026-01-01");
  if (!cfg.sales_spreadsheet_id || !cfg.finance_spreadsheet_id) throw new Error("spreadsheet_ids_missing");
  const grids = await readGrids(cfg, cfg.sales_tabs?.[0] ?? "2026");
  const a = adopt(deals, links, grids, FORCED);
  if (confirm) {
    const now = new Date().toISOString();
    for (const f of a.found) {
      const r = await db.from("sheet_sync_rows").insert({ ...f, last_synced_at: now,
        sales_spreadsheet_id: cfg.sales_spreadsheet_id, finance_spreadsheet_id: cfg.finance_spreadsheet_id });
      if (r.error) throw new Error(`adopt ${f.deal_id}: ${r.error.message}`);
    }
  }
  await log(run, "info", confirm ? "adopt" : "adopt_preview", `${a.found.length} مربوطة، ${a.missing.length} ما لها صف`, a);
  return { confirm, ...a };
}

// plan_with: the same plan on grids sent in the request (values as the Sheets API shows them: «17/11/2026» becomes a date,
// «2,000.000» a number). Reads no sheet and writes nothing anywhere; a check of the logic without the Google key.
const toSerial = (v: unknown) => {
  if (typeof v !== "string") return v;
  const m = v.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return Math.round(Date.UTC(+m[3], +m[2] - 1, +m[1]) / 86400e3) + 25569;
  const n = v.replace(/,/g, "").trim();
  return n !== "" && /^-?\d+(\.\d+)?$/.test(n) ? Number(n) : v;
};
async function planWith(body: any) {
  const { cfg, deals, links } = await load("2026-01-01");
  const g = body?.grids ?? {};
  const grids = { sales: (g.sales ?? []).map((r: any[]) => r.map(toSerial)), salesFormulas: g.salesFormulas ?? null,
    finance: (g.finance ?? []).map((r: any[]) => r.map(toSerial)) };
  // links: "adopt" = as if the first run had linked the rows already there (minus body.drop); an object = those links
  let fakeLinks = body?.links ?? links;
  if (body?.links === "adopt") {
    fakeLinks = {};
    for (const f of adopt(deals, {}, grids, FORCED).found) if (!(body?.drop ?? []).includes(f.deal_id)) fakeLinks[f.deal_id] = f;
  }
  const createFrom = body?.create_from ?? cfg.create_from;
  return {
    adopt: adopt(deals, fakeLinks, grids, FORCED),
    plan: plan(deals.map((d) => ({ ...d, ...(body?.override?.[d.id] ?? {}) })), fakeLinks, grids, { sales_tab: "2026",
      cancel_totals_mode: body?.cancel_totals_mode ?? cfg.cancel_totals_mode,
      create_from_serial: muscatSerial(`${createFrom}T00:00:00+04:00`) }),
  };
}

// test_live: real writes on the TEST COPIES only, with deal changes made up in the request (body.override, body.drop);
// nothing is written to the CRM and no link is saved. Refused while the config points at Ahmed's original sheets.
const ORIGINALS = ["1S9pmFG5zNNoR4q5MXj-JpHnF3PKP7xpl819b63GTF7s", "1zR0ELZb5POPcSim2NDG4CkpqFPkPxTbJdOJ91ep3BtQ"];
async function testLive(body: any, run: string) {
  const { cfg, deals, links } = await load("2026-01-01");
  if (ORIGINALS.includes(cfg.sales_spreadsheet_id) || ORIGINALS.includes(cfg.finance_spreadsheet_id)) throw new Error("test_live_only_on_copies");
  const salesTab = cfg.sales_tabs?.[0] ?? "2026";
  const grids = await readGrids(cfg, salesTab);
  const L: Record<string, any> = { ...links };
  for (const id of body?.drop ?? []) delete L[id];
  const p = plan(deals.map((d) => ({ ...d, ...(body?.override?.[d.id] ?? {}) })), L, grids, { sales_tab: salesTab,
    cancel_totals_mode: cfg.cancel_totals_mode, create_from_serial: muscatSerial(`${body?.create_from ?? cfg.create_from}T00:00:00+04:00`) });
  if (p.writes.length) await applyWrites(cfg, salesTab, p.writes);
  await log(run, "info", "test_live", `${p.writes.length} كتابة على نسخ الفحص`, p);
  return p;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false }, 405);
  const secret = req.headers.get("x-crm-agent") || "";
  const ok = secret ? await db.rpc("crm_reply_agent_secret_ok", { p_secret: secret }) : null;
  if (!ok || ok.error || ok.data !== true) return json({ ok: false, error: "not_authorized" }, 403);
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || "");
  const runId = crypto.randomUUID();
  if (action === "plan_with") {
    try { return json({ ok: true, result: await planWith(body) }); }
    catch (e) { return json({ ok: false, error: short(String((e as any)?.message || e), 300) }, 500); }
  }
  if (!["run", "dry_run", "adopt", "test_live"].includes(action)) return json({ ok: false, error: "unknown_action" }, 400);
  const lease = await db.rpc("crm_sheet_sync_lease", { p_take: true });
  if (lease.error || lease.data !== true) return json({ ok: true, skipped: "another_run" });
  try {
    const result = action === "adopt" ? await doAdopt(body?.confirm === true, runId)
      : action === "test_live" ? await testLive(body, runId) : await run(action as "run" | "dry_run", runId);
    return json({ ok: true, run: runId, result });
  } catch (e) {
    const msg = String((e as any)?.message || e);
    console.error("[sheet-sync]", action, msg);
    await log(runId, "error", action, msg).catch(() => {});
    if (action === "run") {
      const c = await db.from("sheet_sync_config").select("owner_user_id, mode").eq("id", true).single();
      if (c.data && c.data.mode === "live") await notifyOwner(c.data, `السبب: ${short(msg, 300)}`).catch(() => {});
    }
    return json({ ok: false, run: runId, error: short(msg, 300) }, 500);
  } finally {
    await db.rpc("crm_sheet_sync_lease", { p_take: false });
  }
});
