// Automatic price studies (SQL94, Ahmed 11 Nov 2026). Called only with the reply-agent secret (x-crm-agent) by the SQL94
// functions and triggers; nothing here is reachable from the browser.
//   save_docs      copy every image / document / video the owner sent in a «دراسة سعر» chat into the private bucket
//                  (Meta drops media after about two weeks), newest first
//   sign           6-hour links to those copies, for Claude (crm_price_study_documents)
//   sign_inspection 6-hour links to the photos of the office inspection of a task, for Claude (crm_price_study_inspection)
//   pull_files     copy the two PDF reports of a study Claude handed in from Google Drive into the bucket, then tell Ahmed
//   send           after Ahmed's approval: the message and the owner report go to the owner from the chat's branch number;
//                  outside the 24-hour window an approved template asks first and the study follows the owner's answer
//   owner_inbound  the owner answered: deliver a waiting study, or read whether the price did not suit him
//   template       submit the template to Meta for both numbers / refresh its status
// Owner net, commission and the internal report never leave the owner-only table and bucket: no message carries them.
// Nothing goes to an owner before Ahmed's approval, and while price_study_send_mode is «test» only the runtime test numbers
// receive anything.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const GRAPH = Deno.env.get("META_GRAPH_VERSION") || "v25.0";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const OPENAI_MODEL = Deno.env.get("REPLY_AGENT_MODEL") || Deno.env.get("OPENAI_MODEL") || "gpt-5.6-luna";
const BUCKET = "price-studies";
const CRM_URL = "https://omanvilla.github.io/habib-crm/";
const MAX_BYTES = 20 * 1024 * 1024;
const WINDOW_MS = 24 * 3600 * 1000 - 5 * 60 * 1000; // five minutes of margin before Meta closes the window
// The template Ahmed approved on 11 Nov 2026 (UTILITY, one quick-reply button). Outside the 24-hour window it is the only
// thing sent; the study itself follows the owner's answer.
const TEMPLATE = "owner_price_study_ready_ar_v1";
const TEMPLATE_TEXT = "السلام عليكم دراسة سعر عقارك جاهزة نرسلها لك هنا ؟";
const TEMPLATE_BUTTON = "نعم ارسلها";
// v2 (Ahmed 11 Nov 2026, night): Meta approved v1 as UTILITY on the Barka number and as MARKETING on the Muscat number, and
// only a UTILITY template goes out on its own. He approved this wording for Muscat: it says the study answers the owner's
// own request. Each number uses its first template that Meta approved as UTILITY.
const TEMPLATES: { name: string; text: string; routes: string[] }[] = [
  { name: TEMPLATE, text: TEMPLATE_TEXT, routes: ["barka", "muscat"] },
  { name: "owner_price_study_ready_ar_v2", text: "السلام عليكم بخصوص طلبك دراسة سعر عقارك الدراسة جاهزة نرسلها لك هنا ؟", routes: ["muscat"] },
];
const REPORT_NAME = "دراسة سعر العقار.pdf";
const PRICE_STUDY = /^\s*دراسة\s*سعر/;
// the owner answered the template with a plain «لا»: nothing is sent, Ahmed is told
const SAID_NO = /^\s*(لا|لأ|لاء|no|مو الحين|مب الحين|بعدين)\s*[.!،]*\s*(شكرا|شكراً|مشكور)?\s*$/i;

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const enc = new TextEncoder();
const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const short = (v: unknown, n = 400) => { const s = String(v ?? "").trim(); return s.length > n ? s.slice(0, n) + "…" : s; };
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json; charset=utf-8" } });
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const money = (v: unknown) => Number(v || 0).toLocaleString("en-US");
const branchAr = (rk: string) => rk === "barka" ? "بركاء" : "مسقط";
const dayAr = (d = new Date()) => d.toLocaleDateString("ar-OM-u-nu-latn", { timeZone: "Asia/Muscat", day: "numeric", month: "long", year: "numeric" });
function b64(s: string) { const b = atob(s); const o = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) o[i] = b.charCodeAt(i); return o; }
const background = (p: Promise<unknown>) => { try { (globalThis as any).EdgeRuntime?.waitUntil?.(p); } catch (_) { /* runs anyway */ } };

async function routeTokens(companyId: string, routeKey: string) {
  const out: string[] = [];
  try {
    const c = await db.from("whatsapp_route_credentials").select("token_ciphertext,token_iv,expires_at").eq("company_id", companyId).eq("route_key", routeKey).maybeSingle();
    if (c.data && (!c.data.expires_at || new Date(c.data.expires_at).getTime() > Date.now() + 60000)) {
      const seed = enc.encode(`${META_APP_SECRET}|${companyId}|${routeKey}|habib-crm-whatsapp-v1`);
      const key = await crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", seed), { name: "AES-GCM" }, false, ["decrypt"]);
      out.push(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(c.data.token_iv) }, key, b64(c.data.token_ciphertext))));
    }
  } catch (e) { console.error("[price-study] credential", String((e as any)?.message || e)); }
  if (WHATSAPP_ACCESS_TOKEN && !out.includes(WHATSAPP_ACCESS_TOKEN)) out.push(WHATSAPP_ACCESS_TOKEN);
  return out;
}
async function metaSend(tokens: string[], phoneId: string, to: string, payload: Record<string, unknown>) {
  let last = "";
  for (const t of tokens) {
    const r = await fetch(`https://graph.facebook.com/${GRAPH}/${phoneId}/messages`, {
      method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, ...payload }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d?.messages?.[0]?.id) return { id: String(d.messages[0].id), error: null as string | null };
    last = short(d?.error?.message || `meta_${r.status}`, 300) + (d?.error?.code ? ` (${d.error.code})` : "");
    if (![190, 10, 200].includes(Number(d?.error?.code))) break; // only a credential problem is worth the next token
  }
  return { id: null as string | null, error: last || "no_token" };
}
async function metaUpload(tokens: string[], phoneId: string, bytes: Uint8Array, mime: string, filename: string) {
  let last = "";
  for (const t of tokens) {
    const form = new FormData();
    form.append("messaging_product", "whatsapp"); form.append("type", mime);
    form.append("file", new Blob([bytes], { type: mime }), filename);
    const u = await fetch(`https://graph.facebook.com/${GRAPH}/${phoneId}/media`, { method: "POST", headers: { Authorization: `Bearer ${t}` }, body: form });
    const d = await u.json().catch(() => ({}));
    if (u.ok && d?.id) return { id: String(d.id), error: null as string | null };
    last = short(d?.error?.message || `upload_${u.status}`, 200);
  }
  return { id: null as string | null, error: last || "no_token" };
}
// Ahmed's private number, from the branch number of the chat (the existing notify_owner of whatsapp-owner-hot-alert). If
// his 24-hour window with that number is closed the other branch number is tried. No confidential figure is ever passed.
async function tellAhmed(secret: string, companyId: string, routeKey: string, text: string, eventKey: string) {
  for (const rk of [routeKey, routeKey === "barka" ? "muscat" : "barka"]) {
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-owner-hot-alert`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-crm-agent": secret },
        body: JSON.stringify({ action: "notify_owner", company_id: companyId, route_key: rk, text, event_key: eventKey }),
      });
      const d = await r.json().catch(() => ({}));
      if (d?.sent) return { sent: true, route: rk };
    } catch (e) { console.error("[price-study] notify", String((e as any)?.message || e)); }
  }
  return { sent: false };
}

// ---------- the owner's documents ----------
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf", "video/mp4": "mp4", "video/3gpp": "3gp",
  "application/msword": "doc", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx" };
async function saveOne(conv: any, m: any, tokens: string[]) {
  const base = { company_id: conv.company_id, conversation_id: conv.id, message_id: m.id, message_type: m.message_type, caption: m.body ? short(m.body, 500) : null,
    message_timestamp: m.message_timestamp, updated_at: new Date().toISOString() };
  const put = (row: Record<string, unknown>) => db.from("owner_price_study_docs").upsert({ ...base, ...row }, { onConflict: "message_id" });
  let meta: any = null, token = "", authProblem = false;
  for (const t of tokens) {
    const r = await fetch(`https://graph.facebook.com/${GRAPH}/${m.media_id}`, { headers: { Authorization: `Bearer ${t}` } });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d?.url) { meta = d; token = t; break; }
    if ([190, 10, 200].includes(Number(d?.error?.code))) authProblem = true;
  }
  if (!meta) {
    // a credential problem is retried on the next run; anything else means Meta no longer has the file
    await put(authProblem ? { status: "failed", error: "meta_credential" } : { status: "expired", error: "meta_no_longer_has_it" });
    return authProblem ? "failed" : "expired";
  }
  const mime = String(meta.mime_type || "application/octet-stream").split(";")[0].trim();
  if (Number(meta.file_size || 0) > MAX_BYTES) { await put({ status: "too_big", mime, size_bytes: Number(meta.file_size) }); return "too_big"; }
  const f = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
  if (!f.ok) { await put({ status: "failed", mime, error: `download_${f.status}` }); return "failed"; }
  const bytes = new Uint8Array(await f.arrayBuffer());
  if (bytes.length > MAX_BYTES) { await put({ status: "too_big", mime, size_bytes: bytes.length }); return "too_big"; }
  const raw = m.raw_payload || {};
  const given = String(raw?.document?.filename || raw?.message?.document?.filename || "").trim();
  const ext = EXT[mime] || (given.includes(".") ? given.split(".").pop()!.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6) : "") || "bin";
  const filename = given || `${m.message_type}-${String(m.message_timestamp || "").slice(0, 10)}-${String(m.id).slice(0, 8)}.${ext}`;
  const path = `docs/${conv.id}/${m.id}.${ext}`;
  const up = await db.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: true });
  if (up.error) { await put({ status: "failed", mime, filename, error: short(up.error.message, 200) }); return "failed"; }
  await put({ status: "saved", mime, filename, size_bytes: bytes.length, storage_path: path, error: null });
  return "saved";
}
async function saveDocs(convId: string, budgetMs = 100000) {
  const started = Date.now();
  const c = await db.from("whatsapp_conversations").select("id,company_id,route_key").eq("id", convId).maybeSingle();
  const conv: any = c.data;
  if (!conv) return { conversation_id: convId, error: "conversation_not_found" };
  if (!["barka", "muscat"].includes(conv.route_key)) return { conversation_id: convId, skipped: "route" };
  const msgs = await db.from("whatsapp_messages").select("id,message_type,body,media_id,raw_payload,message_timestamp").eq("conversation_id", conv.id).eq("direction", "inbound")
    .in("message_type", ["image", "document", "video"]).not("media_id", "is", null).gte("message_timestamp", new Date(Date.now() - 90 * 86400000).toISOString())
    .order("message_timestamp", { ascending: false }).limit(200);
  const have = await db.from("owner_price_study_docs").select("message_id,status").eq("conversation_id", conv.id);
  const done = new Set((have.data || []).filter((d: any) => d.status !== "failed").map((d: any) => d.message_id));
  const todo = (msgs.data || []).filter((m: any) => !done.has(m.id));
  const count: Record<string, number> = { saved: 0, expired: 0, too_big: 0, failed: 0, left: 0 };
  if (!todo.length) return { conversation_id: convId, ...count };
  const tokens = await routeTokens(conv.company_id, conv.route_key);
  for (const m of todo) {
    if (Date.now() - started > budgetMs) { count.left++; continue; }
    try { count[await saveOne(conv, m, tokens)]++; } catch (e) { count.failed++; console.error("[price-study] save", String((e as any)?.message || e)); }
  }
  return { conversation_id: convId, ...count };
}
async function signDocs(convId: string) {
  const d = await db.from("owner_price_study_docs").select("message_id,message_type,mime,filename,caption,size_bytes,storage_path,status,message_timestamp").eq("conversation_id", convId).order("message_timestamp", { ascending: true });
  const rows = d.data || [];
  const saved = rows.filter((r: any) => r.status === "saved" && r.storage_path);
  const urls: Record<string, string> = {};
  if (saved.length) {
    const s = await db.storage.from(BUCKET).createSignedUrls(saved.map((r: any) => r.storage_path), 6 * 3600);
    for (const x of s.data || []) if (x?.path && x.signedUrl) urls[x.path] = x.signedUrl;
  }
  const docs = rows.map((r: any) => ({ sent_at: r.message_timestamp, kind: r.message_type, filename: r.filename, mime: r.mime, size: r.size_bytes, caption: r.caption, status: r.status, url: urls[r.storage_path] || null }));
  // media that has no copy yet shows as «not_saved_yet» and is fetched in the background for the next call
  const known = new Set(rows.map((r: any) => r.message_id));
  const m = await db.from("whatsapp_messages").select("id,message_type,body,message_timestamp").eq("conversation_id", convId).eq("direction", "inbound").in("message_type", ["image", "document", "video"]).not("media_id", "is", null)
    .gte("message_timestamp", new Date(Date.now() - 90 * 86400000).toISOString()).order("message_timestamp", { ascending: true }).limit(200);
  const missing = (m.data || []).filter((x: any) => !known.has(x.id));
  for (const x of missing) docs.push({ sent_at: x.message_timestamp, kind: x.message_type, filename: null, mime: null, size: null, caption: x.body ? short(x.body, 500) : null, status: "not_saved_yet", url: null });
  if (missing.length || rows.some((r: any) => r.status === "failed")) background(saveDocs(convId));
  return docs;
}
// SQL96 (Ahmed 12 Nov 2026): the photos of the office inspection of a task, as 6-hour links for Claude
// (crm_price_study_inspection). Only paths saved on the task's inspection, under its own folder, are signed.
async function signInspection(taskId: string) {
  const q = await db.from("owner_price_study_inspections").select("photos").eq("task_id", taskId).maybeSingle();
  const paths = (((q.data as any)?.photos || []) as unknown[]).filter((p) => typeof p === "string" && p.startsWith(`inspections/${taskId}/`)) as string[];
  if (!paths.length) return [];
  const s = await db.storage.from(BUCKET).createSignedUrls(paths, 6 * 3600);
  const urls: Record<string, string> = {};
  for (const x of s.data || []) if (x?.path && x.signedUrl) urls[x.path] = x.signedUrl;
  return paths.map((p) => urls[p]).filter(Boolean);
}

// ---------- the two reports ----------
async function drivePdf(id: string) {
  let last = "drive_unreachable";
  for (const u of [`https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`, `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`]) {
    try {
      const r = await fetch(u, { redirect: "follow", signal: AbortSignal.timeout(45000) });
      if (!r.ok) { last = `drive_http_${r.status}`; continue; }
      const bytes = new Uint8Array(await r.arrayBuffer());
      const isPdf = bytes.length > 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF
      if (isPdf) return bytes.length > MAX_BYTES ? { bytes: null, error: "pdf_larger_than_20mb" } : { bytes, error: null };
      last = "not_a_pdf_or_not_shared_by_link";
    } catch (_) { last = "drive_fetch_failed"; }
  }
  return { bytes: null, error: last };
}
async function studyContext(s: any) {
  const c = s.conversation_id ? await db.from("whatsapp_conversations").select("id,company_id,client_id,route_key,customer_name,customer_phone,customer_wa_id,meta_phone_number_id,last_inbound_at,human_handoff_required,handoff_reason").eq("id", s.conversation_id).maybeSingle() : { data: null };
  const conv: any = c.data;
  const cl = s.client_id ? await db.from("clients").select("name,phone,phone_normalized").eq("id", s.client_id).maybeSingle() : { data: null };
  const l = s.owner_lead_id ? await db.from("owner_leads").select("id,kind,area,wilayat,price,land_size,built_size,plot_no,notes,status").eq("id", s.owner_lead_id).maybeSingle() : { data: null };
  const lead: any = l.data;
  const name = (cl.data as any)?.name || conv?.customer_name || "مالك";
  const phone = digits(conv?.customer_wa_id) || digits((cl.data as any)?.phone_normalized || (cl.data as any)?.phone || conv?.customer_phone);
  const property = lead ? [lead.kind, [lead.area, lead.wilayat].filter(Boolean).join(" ، "), lead.land_size ? `أرض ${lead.land_size} م²` : "", lead.built_size ? `بناء ${lead.built_size} م²` : ""].filter(Boolean).join(" · ") : "";
  return { conv, lead, name, phone, property };
}
async function pullFiles(studyId: string, secret: string) {
  const claim = await db.from("owner_price_studies").select("*").eq("id", studyId).eq("status", "submitted").maybeSingle();
  const s: any = claim.data;
  if (!s) return { study_id: studyId, skipped: "not_submitted" };
  const fail = async (why: string) => { await db.from("owner_price_studies").update({ status: "files_failed", files_error: short(why, 400), updated_at: new Date().toISOString() }).eq("id", s.id).eq("status", "submitted"); return { study_id: studyId, files_failed: why }; };
  const paths: Record<string, string> = {};
  for (const [kind, id] of [["owner", s.owner_report_drive_id], ["internal", s.internal_report_drive_id]] as const) {
    const f = await drivePdf(String(id));
    if (!f.bytes) return await fail(`${kind}_report: ${f.error}`);
    const path = `reports/${s.id}/${kind}.pdf`;
    const up = await db.storage.from(BUCKET).upload(path, f.bytes, { contentType: "application/pdf", upsert: true });
    if (up.error) return await fail(`${kind}_report: storage ${short(up.error.message, 150)}`);
    paths[kind] = path;
  }
  const done = await db.from("owner_price_studies").update({ status: "awaiting_approval", owner_report_path: paths.owner, internal_report_path: paths.internal, files_error: null, updated_at: new Date().toISOString() })
    .eq("id", s.id).eq("status", "submitted").select("id");
  if (!(done.data || []).length) return { study_id: studyId, skipped: "changed_meanwhile" };
  const { name, property } = await studyContext(s);
  const told = await tellAhmed(secret, s.company_id, s.route_key === "barka" ? "barka" : "muscat", [
    `📊 دراسة سعر جاهزة لموافقتك · ${branchAr(s.route_key)}`,
    `الاسم: ${name}`,
    property ? `العقار: ${property}` : "",
    "راجع الأرقام والتقريرين ووافق من هنا:",
    `${CRM_URL}?study=${s.id}`,
    "ما ينرسل شي للمالك قبل موافقتك",
  ].filter(Boolean).join("\n"), `price_study_ready:${s.id}`);
  return { study_id: studyId, status: "awaiting_approval", told_ahmed: told.sent };
}

// ---------- sending to the owner, only after Ahmed's approval ----------
async function recordOut(s: any, conv: any, phoneId: string, to: string, wamid: string, type: string, body: string, extra: Record<string, unknown> = {}) {
  const r = await db.from("whatsapp_messages").insert({
    company_id: s.company_id, conversation_id: conv.id, client_id: s.client_id || conv.client_id || null, actor_type: "automated", channel_source: "crm_price_study",
    whatsapp_message_id: wamid, direction: "outbound", message_type: type, sender_wa_id: phoneId, recipient_wa_id: to, body, message_timestamp: new Date().toISOString(),
    delivery_status: "sent", raw_payload: { source: "crm_price_study", study_id: s.id, approved_by: s.decided_by, ...extra },
  });
  if (r.error && r.error.code !== "23505") console.error("[price-study] record", r.error.message);
}
async function templateApproved(companyId: string, routeKey: string) {
  // Ahmed's standing rule (5 Nov 2026): only a UTILITY template goes out on its own. If Meta rates this one MARKETING the
  // study stays held (it still goes as plain text the moment the owner writes) and Ahmed is told once (heldTick).
  const usable = (status: unknown, category: unknown) => String(status || "").toUpperCase() === "APPROVED" && String(category || "").toUpperCase() === "UTILITY";
  const mine = TEMPLATES.filter((t) => t.routes.includes(routeKey));
  const pick = (rows: { name: string; status: unknown; category: unknown }[]) => mine.find((t) => rows.some((r) => r.name === t.name && usable(r.status, r.category))) || null;
  const r = await db.from("whatsapp_template_registry").select("template_name,status,category").eq("company_id", companyId).eq("route_key", routeKey).in("template_name", mine.map((t) => t.name)).eq("language", "ar");
  const known = pick((r.data || []).map((x: any) => ({ name: x.template_name, status: x.status, category: x.category })));
  if (known) return known;
  const fresh = await templates("status", companyId); // Meta may have approved it since the last check
  return pick(fresh.filter((x: any) => x.route === routeKey));
}
async function sendStudy(studyId: string, from: "approved" | "waiting_owner") {
  const claim = await db.from("owner_price_studies").update({ status: "sending", updated_at: new Date().toISOString() }).eq("id", studyId).eq("status", from).select("*");
  const s: any = (claim.data || [])[0];
  if (!s) return { study_id: studyId, skipped: `not_${from}` };
  const set = async (status: string, send_error: string | null, more: Record<string, unknown> = {}) => {
    await db.from("owner_price_studies").update({ status, send_error, updated_at: new Date().toISOString(), ...more }).eq("id", s.id);
    return { study_id: studyId, status, send_error };
  };
  try {
    const { conv, phone: to } = await studyContext(s);
    if (!conv || !["barka", "muscat"].includes(conv.route_key)) return await set("send_failed", "conversation_missing");
    const phoneId = digits(conv.meta_phone_number_id);
    if (!to || !phoneId) return await set("send_failed", "owner_number_or_branch_number_missing");
    if (!s.owner_report_path) return await set("send_failed", "owner_report_missing");
    const rt = await db.from("whatsapp_automation_runtime").select("price_study_send_mode,allowed_customer_phones").eq("company_id", s.company_id).maybeSingle();
    const mode = String(rt.data?.price_study_send_mode || "test");
    const isTest = (rt.data?.allowed_customer_phones || []).some((p: string) => digits(p).length >= 8 && digits(p).slice(-8) === to.slice(-8));
    // held, not failed: Ahmed's approval stays and «ارسل الحين» works once the mode is live
    if (mode === "off") return await set("approved", "sending_off");
    if (mode !== "live" && !isTest) return await set("approved", "test_mode_hold");
    const tokens = await routeTokens(conv.company_id, conv.route_key);
    const inWindow = !!conv.last_inbound_at && Date.now() - Date.parse(conv.last_inbound_at) < WINDOW_MS;
    if (!inWindow) {
      // the owner's last message is older than 24 hours: the approved template asks, his answer brings the study (owner_inbound)
      if (s.template_sent_at && Date.now() - Date.parse(s.template_sent_at) < 24 * 3600 * 1000) return await set("waiting_owner", null);
      const tpl = await templateApproved(conv.company_id, conv.route_key);
      if (!tpl) return await set("approved", "template_not_approved");
      const t = await metaSend(tokens, phoneId, to, { type: "template", template: { name: tpl.name, language: { code: "ar" } } });
      if (!t.id) return await set("send_failed", `template: ${t.error}`);
      await recordOut(s, conv, phoneId, to, t.id, "template", tpl.text, { template: tpl.name });
      return await set("waiting_owner", null, { template_sent_at: new Date().toISOString() });
    }
    let textId = s.owner_message_wamid as string | null;
    if (!textId) {
      const m = await metaSend(tokens, phoneId, to, { type: "text", text: { preview_url: false, body: s.owner_message } });
      if (!m.id) return await set("send_failed", `message: ${m.error}`);
      textId = m.id;
      await db.from("owner_price_studies").update({ owner_message_wamid: textId }).eq("id", s.id); // a retry never repeats the message
      await recordOut(s, conv, phoneId, to, textId, "text", s.owner_message);
      await pause(2500); // WhatsApp keeps the order only when the parts are not sent back to back
    }
    const file = await db.storage.from(BUCKET).download(s.owner_report_path);
    if (file.error || !file.data) return await set("send_failed", `report_read: ${short(file.error?.message, 150)}`);
    const up = await metaUpload(tokens, phoneId, new Uint8Array(await file.data.arrayBuffer()), "application/pdf", REPORT_NAME);
    if (!up.id) return await set("send_failed", `report_upload: ${up.error}`);
    const d = await metaSend(tokens, phoneId, to, { type: "document", document: { id: up.id, filename: REPORT_NAME } });
    if (!d.id) return await set("send_failed", `report: ${d.error}`);
    await recordOut(s, conv, phoneId, to, d.id, "document", REPORT_NAME, { document: { filename: REPORT_NAME }, media: { kind: "document", mime_type: "application/pdf", filename: REPORT_NAME, id: up.id } });
    const now = new Date().toISOString();
    await db.from("owner_price_studies").update({ status: "sent", sent_at: now, owner_report_wamid: d.id, send_error: null, updated_at: now }).eq("id", s.id);
    // the task closes, the owner offer becomes «studied», the chat stays with Ahmed (the hold is kept, its reason says the study went)
    const after: string[] = [];
    if (s.task_id) { const t = await db.from("tasks").update({ done: true, completed_at: now }).eq("id", s.task_id); if (t.error) after.push("task"); }
    const leads = await db.from("owner_leads").select("id,notes,status,conversation_id").eq("company_id", s.company_id).eq("status", "open").or(`id.eq.${s.owner_lead_id || "00000000-0000-0000-0000-000000000000"},conversation_id.eq.${conv.id}`);
    const line = `تمت دراسة السعر ${dayAr()}: القيمة السوقية ${money(s.market_value)} وسعر العرض ${money(s.asking_price)}، وانرسلت للمالك`;
    for (const l of leads.data || []) {
      const u = await db.from("owner_leads").update({ status: "studied", notes: [l.notes, line].filter(Boolean).join("\n").slice(0, 4000), updated_at: now }).eq("id", l.id);
      if (u.error) after.push("owner_lead");
    }
    if (conv.human_handoff_required && PRICE_STUDY.test(String(conv.handoff_reason || "")) && !String(conv.handoff_reason).includes("انرسلت الدراسة")) {
      const rest = String(conv.handoff_reason).replace(/^\s*دراسة\s*سعر\s*:?\s*/, "");
      const h = await db.from("whatsapp_conversations").update({ handoff_reason: short(`دراسة سعر: انرسلت الدراسة للمالك ${dayAr()} · ${rest}`, 600) }).eq("id", conv.id).eq("human_handoff_required", true);
      if (h.error) after.push("chat_reason");
    }
    if (after.length) await db.from("owner_price_studies").update({ send_error: `sent, not recorded: ${after.join(", ")}` }).eq("id", s.id);
    return { study_id: studyId, status: "sent", not_recorded: after };
  } catch (e) {
    return await set("send_failed", short(String((e as any)?.message || e), 300));
  }
}

// ---------- the owner's answer ----------
const reactionSchema = { type: "object", additionalProperties: false, required: ["reaction", "quote"], properties: {
  reaction: { type: "string", enum: ["accepted", "price_rejected", "counter_offer", "question", "other"] },
  quote: { type: "string" } } };
const REACTION_RULES = [
  "مكتب عقاري أرسل لمالك عقار دراسة سعر فيها القيمة السوقية وسعر العرض المقترح. تحت رسائل المالك بعد ما استلم الدراسة.",
  "حدد رد المالك على السعر:",
  "- price_rejected: قال إن السعر ما يناسبه أو قليل أو ما يبيع بهالسعر أو زعل من التقييم.",
  "- counter_offer: طلب سعر ثاني محدد أو قال يبي أكثر وذكر رقم.",
  "- accepted: وافق على السعر أو قال نمشي عليه أو ابدأوا التسويق.",
  "- question: يسأل أو يستفسر وما وضح رأيه في السعر.",
  "- other: شكر أو كلام ما له علاقة بالسعر، أو ما تقدر تحدد.",
  "quote: جملة المالك اللي بنيت عليها بنصها (بالكثير 200 حرف)، أو نص فاضي.",
  "لا تخمّن: إذا ما وضح رأيه في السعر اختر question أو other.",
].join("\n");
async function readReaction(s: any, secret: string) {
  if (!OPENAI_API_KEY) return { study_id: s.id, skipped: "no_model_key" };
  const msgs = await db.from("whatsapp_messages").select("message_type,body,transcript,message_timestamp").eq("conversation_id", s.conversation_id).eq("direction", "inbound")
    .gt("message_timestamp", s.sent_at).order("message_timestamp", { ascending: true }).limit(15);
  const lines = (msgs.data || []).map((m: any) => String(m.transcript || (m.message_type === "text" || m.message_type === "button" || m.message_type === "interactive" ? m.body : "") || "").trim()).filter(Boolean);
  if (!lines.length) return { study_id: s.id, skipped: "no_words_yet" }; // a voice note is read again once its transcript is saved
  const input = [`القيمة السوقية: ${money(s.market_value)} ريال`, `سعر العرض المقترح: ${money(s.asking_price)} ريال`, "", "الرسالة اللي انرسلت للمالك:", short(s.owner_message, 1500), "", "رسائل المالك بعدها (الأقدم أولاً):", ...lines.map((l) => `- ${short(l, 500)}`)].join("\n");
  const ai = await fetch("https://api.openai.com/v1/responses", {
    method: "POST", headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: OPENAI_MODEL, store: false, reasoning: { effort: "low" }, instructions: REACTION_RULES, input, text: { format: { type: "json_schema", name: "owner_price_reaction", strict: true, schema: reactionSchema } } }),
  });
  const p = await ai.json().catch(() => ({}));
  if (!ai.ok) return { study_id: s.id, error: short(p?.error?.message || `openai_${ai.status}`, 200) };
  const out = JSON.parse(p.output_text || p.output?.flatMap((x: any) => x?.content || []).find((x: any) => x?.type === "output_text")?.text || "{}");
  if (!["accepted", "price_rejected", "counter_offer"].includes(out.reaction)) return { study_id: s.id, reaction: out.reaction || "other" };
  const quote = short(out.quote || lines[lines.length - 1], 220);
  const now = new Date().toISOString();
  const first = await db.from("owner_price_studies").update({ owner_reaction: out.reaction, owner_reaction_note: quote, owner_reaction_at: now, updated_at: now }).eq("id", s.id).is("owner_reaction", null).select("id");
  if (!(first.data || []).length) return { study_id: s.id, skipped: "already_read" };
  if (out.reaction === "accepted") return { study_id: s.id, reaction: "accepted" };
  // the price did not suit the owner: it is written on his offer and Ahmed is told
  const { conv, name, phone, lead } = await studyContext(s);
  const what = out.reaction === "counter_offer" ? "طلب سعر ثاني" : "السعر ما ناسبه";
  const line = `رد المالك على دراسة السعر ${dayAr()}: ${what} «${quote}»`;
  let noted = false;
  if (lead?.id) { const u = await db.from("owner_leads").update({ notes: [lead.notes, line].filter(Boolean).join("\n").slice(0, 4000), updated_at: now }).eq("id", lead.id); noted = !u.error; }
  else if (s.conversation_id) {
    const l2 = await db.from("owner_leads").select("id,notes").eq("company_id", s.company_id).eq("conversation_id", s.conversation_id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (l2.data) { const u = await db.from("owner_leads").update({ notes: [l2.data.notes, line].filter(Boolean).join("\n").slice(0, 4000), updated_at: now }).eq("id", l2.data.id); noted = !u.error; }
  }
  const told = await tellAhmed(secret, s.company_id, conv?.route_key === "barka" ? "barka" : "muscat", [
    `⚠️ المالك ${what} · ${branchAr(conv?.route_key)}`,
    `الاسم: ${name}`,
    `كلامه: ${quote}`,
    `سعر العرض اللي انرسل له: ${money(s.asking_price)}`,
    `افتح المحادثة: https://wa.me/${phone}`,
  ].join("\n"), `price_study_reaction:${s.id}`);
  return { study_id: s.id, reaction: out.reaction, noted, told_ahmed: told.sent };
}
async function ownerInbound(convId: string, messageId: string, secret: string) {
  const q = await db.from("owner_price_studies").select("*").eq("conversation_id", convId).in("status", ["waiting_owner", "sent", "approved"]).order("updated_at", { ascending: false }).limit(5);
  const rows = q.data || [];
  const m = messageId ? await db.from("whatsapp_messages").select("id,message_type,body,media_id").eq("id", messageId).maybeSingle() : { data: null };
  const msg: any = m.data;
  if (msg?.media_id && ["image", "document", "video"].includes(msg.message_type)) background(saveDocs(convId));
  const waiting = rows.find((s: any) => s.status === "waiting_owner");
  if (waiting) {
    if (msg && msg.message_type === "text" && SAID_NO.test(String(msg.body || ""))) {
      await db.from("owner_price_studies").update({ status: "send_failed", send_error: "owner_said_no_to_the_template", updated_at: new Date().toISOString() }).eq("id", waiting.id).eq("status", "waiting_owner");
      const { name, phone, conv } = await studyContext(waiting);
      await tellAhmed(secret, waiting.company_id, conv?.route_key === "barka" ? "barka" : "muscat", `ℹ️ المالك ${name} رد «${short(msg.body, 60)}» على رسالة «دراسة سعر عقارك جاهزة»، فما انرسلت له الدراسة\nافتح المحادثة: https://wa.me/${phone}`, `price_study_no:${waiting.id}`);
      return { study_id: waiting.id, held: "owner_said_no" };
    }
    return await sendStudy(waiting.id, "waiting_owner");
  }
  // SQL95: Ahmed already approved it, it only waited for a way to reach the owner; his message opened the 24-hour window
  const held = rows.find((s: any) => s.status === "approved" && s.send_error === "template_not_approved");
  if (held) return await sendStudy(held.id, "approved");
  const sent = rows.find((s: any) => s.status === "sent" && !s.owner_reaction && s.sent_at && Date.now() - Date.parse(s.sent_at) < 14 * 86400000);
  if (sent) return await readReaction(sent, secret);
  return { conversation_id: convId, skipped: "no_study_waiting" };
}

// SQL95: approved studies that only wait for the template are tried again (cron, every 30 minutes while one waits); the
// template check inside sendStudy asks Meta, so the first run after its approval sends them. Oldest approval first.
async function heldTick(secret: string) {
  const q = await db.from("owner_price_studies").select("id,company_id").eq("status", "approved").eq("send_error", "template_not_approved").order("decided_at", { ascending: true }).limit(10);
  const out: any[] = [];
  for (const r of q.data || []) { out.push(await sendStudy(r.id, "approved")); await pause(1500); }
  // Meta approved the template but not as UTILITY, or refused it: nothing goes out with it; Ahmed is told once per number
  const companyId = (q.data || [])[0]?.company_id;
  if (companyId) {
    const reg = await db.from("whatsapp_template_registry").select("route_key,template_name,status,category").eq("company_id", companyId).in("template_name", TEMPLATES.map((x) => x.name)).eq("language", "ar");
    const rows = reg.data || [];
    const good = (x: any) => String(x.status || "").toUpperCase() === "APPROVED" && String(x.category || "").toUpperCase() === "UTILITY";
    for (const t of rows) {
      const status = String(t.status || "").toUpperCase(), category = String(t.category || "").toUpperCase();
      const marketing = status === "APPROVED" && category !== "UTILITY", refused = status === "REJECTED";
      if (!marketing && !refused) continue;
      // a number that has a usable template (v2 after v1 was rated MARKETING) needs no alert, nor one that still waits for Meta
      if (rows.some((x: any) => x.route_key === t.route_key && (good(x) || String(x.status || "").toUpperCase() === "PENDING"))) continue;
      const key = `price_study_template_${marketing ? "marketing" : "rejected"}:${t.route_key}:${t.template_name}`;
      const seen = await db.from("whatsapp_automation_events").select("id").eq("company_id", companyId).eq("action_type", "owner_notify").eq("status", "applied").eq("reason", key).limit(1);
      if ((seen.data || []).length) continue;
      const told = await tellAhmed(secret, companyId, t.route_key === "barka" ? "barka" : "muscat", [
        `ℹ️ قالب «دراسة سعر عقارك جاهزة» على رقم ${branchAr(t.route_key)}: ${marketing ? "Meta اعتمدته كقالب تسويقي (MARKETING)" : "Meta رفضته"}`,
        "ما ينرسل تلقائي. الدراسات اللي وافقت عليها تنرسل أول ما يكتب المالك",
        "قل لـ Claude يعدل نص القالب ويرسله من جديد",
      ].join("\n"), key);
      out.push({ route: t.route_key, template: marketing ? "marketing" : "rejected", told_ahmed: told.sent });
    }
  }
  return out;
}

// ---------- the template at Meta ----------
async function templates(action: "create" | "status", companyId: string) {
  const out: any[] = [];
  for (const rk of ["barka", "muscat"]) {
    try {
      const a = await db.from("company_lead_routes").select("meta_waba_id").eq("company_id", companyId).eq("route_key", rk).eq("is_active", true).maybeSingle();
      const waba = String(a.data?.meta_waba_id || "");
      const tokens = await routeTokens(companyId, rk);
      if (!waba || !tokens.length) { out.push({ route: rk, error: "route_not_ready" }); continue; }
      for (const tpl of TEMPLATES.filter((x) => x.routes.includes(rk))) {
        let t: any = null, err: string | null = null, reached = false;
        for (const token of tokens) {
          const f = await fetch(`https://graph.facebook.com/${GRAPH}/${waba}/message_templates?name=${tpl.name}&fields=name,status,category,language,id`, { headers: { Authorization: `Bearer ${token}` } });
          const p = await f.json().catch(() => ({}));
          if (!f.ok) { err = short(p?.error?.message || `HTTP ${f.status}`, 300); continue; }
          reached = true; err = null;
          t = (p.data || []).find((x: any) => x.name === tpl.name && String(x.language).toLowerCase().startsWith("ar")) || null;
          if (!t && action === "create") {
            const c = await fetch(`https://graph.facebook.com/${GRAPH}/${waba}/message_templates`, {
              method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify({ name: tpl.name, language: "ar", category: "UTILITY", components: [{ type: "BODY", text: tpl.text }, { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: TEMPLATE_BUTTON }] }] }),
            });
            const cp = await c.json().catch(() => ({}));
            if (c.ok) t = { id: cp.id, status: cp.status || "PENDING", category: cp.category || "UTILITY" };
            else err = short(cp?.error?.error_user_msg || cp?.error?.message || `HTTP ${c.status}`, 300);
          }
          break;
        }
        if (reached) {
          const row = { company_id: companyId, route_key: rk, waba_id: waba, template_name: tpl.name, language: "ar", template_id: t?.id || null,
            status: t ? String(t.status || "PENDING").toUpperCase() : (err ? "ERROR" : "MISSING"), category: t?.category || "UTILITY", last_error: err,
            last_checked_at: new Date().toISOString(), updated_at: new Date().toISOString() };
          if (t || err) await db.from("whatsapp_template_registry").upsert(row, { onConflict: "company_id,route_key,template_name,language" });
        }
        out.push({ route: rk, name: tpl.name, status: t ? String(t.status).toUpperCase() : (err ? "ERROR" : "MISSING"), category: t?.category || null, error: err });
      }
    } catch (e) { out.push({ route: rk, error: short(String((e as any)?.message || e), 200) }); }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false }, 405);
  const secret = req.headers.get("x-crm-agent") || "";
  const ok = secret ? await db.rpc("crm_reply_agent_secret_ok", { p_secret: secret }) : null;
  if (!ok || ok.error || ok.data !== true) return json({ ok: false, error: "not_authorized" }, 403);
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || "");
  const uuid = (v: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || "")) ? String(v) : "";
  try {
    if (action === "save_docs") { const id = uuid(body?.conversation_id); return id ? json({ ok: true, result: await saveDocs(id) }) : json({ ok: false, error: "conversation_id_required" }, 400); }
    if (action === "sign") { const id = uuid(body?.conversation_id); return id ? json({ ok: true, documents: await signDocs(id) }) : json({ ok: false, error: "conversation_id_required" }, 400); }
    if (action === "sign_inspection") { const id = uuid(body?.task_id); return id ? json({ ok: true, photos: await signInspection(id) }) : json({ ok: false, error: "task_id_required" }, 400); }
    if (action === "pull_files") { const id = uuid(body?.study_id); return id ? json({ ok: true, result: await pullFiles(id, secret) }) : json({ ok: false, error: "study_id_required" }, 400); }
    if (action === "send") { const id = uuid(body?.study_id); return id ? json({ ok: true, result: await sendStudy(id, "approved") }) : json({ ok: false, error: "study_id_required" }, 400); }
    if (action === "owner_inbound") { const id = uuid(body?.conversation_id); return id ? json({ ok: true, result: await ownerInbound(id, uuid(body?.message_id), secret) }) : json({ ok: false, error: "conversation_id_required" }, 400); }
    if (action === "held_tick") return json({ ok: true, results: await heldTick(secret) });
    if (action === "template") {
      const c = await db.from("whatsapp_automation_runtime").select("company_id").limit(1).maybeSingle();
      if (!c.data?.company_id) return json({ ok: false, error: "company_missing" }, 500);
      return json({ ok: true, results: await templates(body?.op === "create" ? "create" : "status", c.data.company_id) });
    }
    return json({ ok: false, error: "unknown_action" }, 400);
  } catch (e) {
    console.error("[price-study]", action, String((e as any)?.message || e));
    return json({ ok: false, error: "internal_error", detail: short(String((e as any)?.message || e), 200) }, 500);
  }
});
