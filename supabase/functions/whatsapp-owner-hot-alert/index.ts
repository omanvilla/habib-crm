// Ahmed 8 Nov 2026 (docs/agent-rules.md R7): a serious buyer / negotiation handoff (after a visit, R2) is sent at once to
// Ahmed's private WhatsApp from the branch number of that chat (Barka chat → Barka number, Muscat chat → Muscat number),
// with the customer's name, number, the reason and a link to open the chat. CRM notifications do not reach his phone.
// Called by the trigger crm_owner_hot_alert on whatsapp_conversations (pg_net, x-crm-agent secret). Free text works inside
// the 24-hour window Ahmed opens every day by writing «هلا» to both company numbers; outside it Meta refuses and the
// failure is recorded (whatsapp_automation_events action_type=owner_hot_alert) so it is visible, never silent.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const GRAPH = Deno.env.get("META_GRAPH_VERSION") || "v25.0";
// R19 (10 Nov): a meeting the agent booked («اجتماع:») also reaches Ahmed; it is a soft handoff, the agent keeps answering.
const HOT = /^\s*(مشتري جاد|تفاوض|اجتماع)\s*:/;

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const enc = new TextEncoder();
const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const short = (v: unknown, n = 400) => { const s = String(v ?? "").trim(); return s.length > n ? s.slice(0, n) + "…" : s; };
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json; charset=utf-8" } });
function b64(s: string) { const b = atob(s); const o = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) o[i] = b.charCodeAt(i); return o; }

async function routeTokens(companyId: string, routeKey: string) {
  const out: string[] = [];
  try {
    const c = await db.from("whatsapp_route_credentials").select("token_ciphertext,token_iv,expires_at").eq("company_id", companyId).eq("route_key", routeKey).maybeSingle();
    if (c.data && (!c.data.expires_at || new Date(c.data.expires_at).getTime() > Date.now() + 60000)) {
      const seed = enc.encode(`${META_APP_SECRET}|${companyId}|${routeKey}|habib-crm-whatsapp-v1`);
      const key = await crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", seed), { name: "AES-GCM" }, false, ["decrypt"]);
      out.push(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(c.data.token_iv) }, key, b64(c.data.token_ciphertext))));
    }
  } catch (e) { console.error("[owner-hot-alert] credential", String((e as any)?.message || e)); }
  if (WHATSAPP_ACCESS_TOKEN && !out.includes(WHATSAPP_ACCESS_TOKEN)) out.push(WHATSAPP_ACCESS_TOKEN);
  return out;
}

async function metaText(tokens: string[], phoneId: string, to: string, body: string) {
  let last = "";
  for (const t of tokens) {
    const r = await fetch(`https://graph.facebook.com/${GRAPH}/${phoneId}/messages`, {
      method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body } }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) return { id: d?.messages?.[0]?.id || null, error: null };
    last = short(d?.error?.message || `meta_${r.status}`, 300) + (d?.error?.code ? ` (${d.error.code})` : "");
  }
  return { id: null, error: last || "no_token" };
}

// Price study report (11 Nov 2026, Ahmed): every «دراسة سعر:» chat is sent to his private WhatsApp from the branch number
// of that chat, as one block per client: a separator header «📋 دراسة سعر n من N», the name, number and chat link, what the
// agent handed over, the owner offer on record (type, area, price, land, built, plot, notes), the chat summary and the
// owner's own words (voice notes as their transcript), then every image, document and video he sent (downloaded from Meta
// and sent again from the branch number), and an end line. Nothing goes to the customer. One report per handoff.
async function graphJson(tokens: string[], path: string) {
  for (const t of tokens) {
    const r = await fetch(`https://graph.facebook.com/${GRAPH}/${path}`, { headers: { Authorization: `Bearer ${t}` } });
    if (r.ok) return { data: await r.json(), token: t };
  }
  return { data: null, token: "" };
}
async function metaSend(tokens: string[], phoneId: string, to: string, payload: Record<string, unknown>) {
  let last = "";
  for (const t of tokens) {
    const r = await fetch(`https://graph.facebook.com/${GRAPH}/${phoneId}/messages`, {
      method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, ...payload }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) return { id: d?.messages?.[0]?.id || null, error: null };
    last = short(d?.error?.message || `meta_${r.status}`, 300) + (d?.error?.code ? ` (${d.error.code})` : "");
  }
  return { id: null, error: last || "no_token" };
}
// one media message of the customer, sent again to Ahmed from the branch number
async function forwardMedia(tokens: string[], phoneId: string, to: string, m: any, caption: string) {
  const meta = await graphJson(tokens, String(m.media_id));
  const url = meta.data?.url, mime = String(meta.data?.mime_type || "application/octet-stream").split(";")[0];
  if (!url) return { id: null, error: "media_expired" };
  const f = await fetch(url, { headers: { Authorization: `Bearer ${meta.token}` } });
  if (!f.ok) return { id: null, error: `download_${f.status}` };
  const buf = await f.arrayBuffer();
  if (buf.byteLength > 15 * 1024 * 1024) return { id: null, error: "too_big" };
  const raw = m.raw_payload || {};
  const filename = String(raw?.document?.filename || raw?.message?.document?.filename || `${m.message_type}-${String(m.id).slice(0, 8)}`);
  let upId = "", upErr = "";
  for (const t of tokens) {
    const form = new FormData();
    form.append("messaging_product", "whatsapp"); form.append("type", mime);
    form.append("file", new Blob([buf], { type: mime }), filename);
    const u = await fetch(`https://graph.facebook.com/${GRAPH}/${phoneId}/media`, { method: "POST", headers: { Authorization: `Bearer ${t}` }, body: form });
    const d = await u.json().catch(() => ({}));
    if (u.ok && d?.id) { upId = d.id; break; }
    upErr = short(d?.error?.message || `upload_${u.status}`, 200);
  }
  if (!upId) return { id: null, error: upErr || "upload_failed" };
  const kind = m.message_type === "image" ? "image" : m.message_type === "video" ? "video" : "document";
  const body: any = kind === "document" ? { id: upId, caption, filename } : { id: upId, caption };
  return await metaSend(tokens, phoneId, to, { type: kind, [kind]: body });
}
const OWNER_KINDS: Record<string, string> = { land: "أرض", villa: "فيلا", house: "بيت", building: "مبنى", apartment: "شقة", farm: "مزرعة", shop: "محل", chalet: "شاليه", rest_house: "استراحة" };
async function priceStudy(convId: string, n: number, total: number, force: boolean, queuedId = "") {
  const c = await db.from("whatsapp_conversations").select("id,company_id,client_id,route_key,customer_name,customer_phone,customer_wa_id,human_handoff_required,handoff_reason,handoff_updated_at,meta_phone_number_id,ai_summary,agent_note").eq("id", convId).maybeSingle();
  const conv: any = c.data;
  if (!conv) return { conversation_id: convId, error: "conversation_not_found" };
  if (!["barka", "muscat"].includes(conv.route_key)) return { conversation_id: convId, skipped: "route" };
  if (!/^\s*دراسة\s*سعر/.test(String(conv.handoff_reason || ""))) return { conversation_id: convId, skipped: "not_price_study" };
  const at = String(conv.handoff_updated_at || "");
  if (!force) {
    const seen = await db.from("whatsapp_automation_events").select("id").eq("conversation_id", conv.id).eq("action_type", "owner_price_study").eq("status", "applied").contains("payload", { handoff_at: at }).limit(1);
    if ((seen.data || []).length) return { conversation_id: convId, skipped: "already_sent" };
  }
  const routes = await db.from("company_lead_routes").select("route_key,meta_phone_number_id").eq("company_id", conv.company_id);
  const route = (routes.data || []).find((r: any) => r.route_key === conv.route_key);
  const prof = await db.from("profiles").select("phone").eq("company_id", conv.company_id).eq("role", "owner").eq("is_active", true).limit(1).maybeSingle();
  const raw = digits(prof.data?.phone), to = raw.length === 8 ? "968" + raw : raw;
  const phoneId = digits(route?.meta_phone_number_id || conv.meta_phone_number_id);
  if (!to || !phoneId) return { conversation_id: convId, error: "route_missing" };
  const tokens = await routeTokens(conv.company_id, conv.route_key);

  const cl = conv.client_id ? await db.from("clients").select("name,phone,phone_normalized").eq("id", conv.client_id).maybeSingle() : { data: null };
  const phone = digits((cl.data as any)?.phone_normalized || (cl.data as any)?.phone || conv.customer_phone || conv.customer_wa_id);
  const name = (cl.data as any)?.name || conv.customer_name || "مالك";
  const branch = conv.route_key === "barka" ? "بركاء" : "مسقط";
  const tag = total > 1 ? `${n} من ${total}` : `${n}`;
  let lq = db.from("owner_leads").select("kind,area,wilayat,price,land_size,built_size,plot_no,notes,created_at").eq("company_id", conv.company_id).order("created_at", { ascending: false }).limit(1);
  lq = conv.client_id ? lq.or(`conversation_id.eq.${conv.id},client_id.eq.${conv.client_id}`) : lq.eq("conversation_id", conv.id);
  const lead: any = (await lq.maybeSingle()).data;
  const msgs = await db.from("whatsapp_messages").select("id,message_type,body,transcript,media_id,raw_payload,message_timestamp").eq("conversation_id", conv.id).eq("direction", "inbound")
    .gte("message_timestamp", new Date(Date.now() - 45 * 86400000).toISOString()).order("message_timestamp", { ascending: true }).limit(300);
  const all = msgs.data || [];
  const words = all.map((m: any) => m.message_type === "audio" ? (m.transcript ? `🎤 ${m.transcript}` : "") : m.message_type === "text" ? String(m.body || "") : "")
    .map((s: string) => s.trim()).filter(Boolean);
  let said = ""; for (const w of words.slice(-25)) { const line = `- ${short(w, 300)}\n`; if ((said + line).length > 1600) break; said += line; }
  const media = all.filter((m: any) => ["image", "document", "video"].includes(m.message_type) && m.media_id).slice(-15);
  const leadLine = lead ? [OWNER_KINDS[lead.kind] || lead.kind || "", [lead.area, lead.wilayat].filter(Boolean).join(" ، "),
    lead.price ? `السعر اللي في باله ${Number(lead.price).toLocaleString("en-US")}` : "بدون سعر", lead.land_size ? `أرض ${lead.land_size} م²` : "",
    lead.built_size ? `بناء ${lead.built_size} م²` : "", lead.plot_no ? `قطعة ${lead.plot_no}` : ""].filter(Boolean).join(" · ") : "";
  const head = [
    "━━━━━━━━━━━━━━━━━━",
    `📋 دراسة سعر ${tag} · ${branch}`,
    "━━━━━━━━━━━━━━━━━━",
    `الاسم: ${name}`,
    `الرقم: ${phone}`,
    `المحادثة: https://wa.me/${phone}`,
    `المطلوب: ${short(String(conv.handoff_reason || "").replace(/^\s*دراسة\s*سعر\s*:?\s*/, ""), 500)}`,
    leadLine ? `العقار: ${leadLine}` : "",
    lead?.notes ? `ملاحظات العرض: ${short(lead.notes, 400)}` : "",
    conv.ai_summary ? `ملخص المحادثة: ${short(conv.ai_summary, 600)}` : "",
    said ? `كلام المالك:\n${said.trim()}` : "",
    media.length ? `المستندات والصور: ${media.length} (تحت)` : "المستندات والصور: ما أرسل شي",
  ].filter(Boolean).join("\n");
  const results: any[] = [];
  // Ahmed 11 Nov: the parts of one client arrived mixed with the next one. WhatsApp does not keep the order of messages
  // sent back to back, so every part waits for the one before it (a pause after each, longer after a video or document).
  const first = await metaText(tokens, phoneId, to, short(head, 3900));
  results.push({ part: "details", ok: !!first.id, error: first.error });
  if (first.id) {
    await pause(3000);
    let k = 0;
    for (const m of media) {
      k++;
      const cap = short(`${tag} · ${name} · ${k}/${media.length}${m.body ? ` · ${m.body}` : ""}`, 900);
      const r = await forwardMedia(tokens, phoneId, to, m, cap);
      results.push({ part: m.message_type, ok: !!r.id, error: r.error });
      if (r.id) await pause(m.message_type === "image" ? 2500 : 6000);
    }
    await pause(3000);
    const end = await metaText(tokens, phoneId, to, `✅ نهاية دراسة السعر ${tag} (${name})\n━━━━━━━━━━━━━━━━━━`);
    results.push({ part: "end", ok: !!end.id, error: end.error });
  }
  const okAll = results.every((r) => r.ok);
  const ev = {
    company_id: conv.company_id, conversation_id: conv.id, client_id: conv.client_id, action_type: "owner_price_study",
    status: first.id ? "applied" : "failed", applied_at: first.id ? new Date().toISOString() : null,
    reason: first.error ? short(first.error, 400) : (okAll ? "sent" : "sent_with_missing_media"),
    payload: { handoff_at: at, route_key: conv.route_key, to_owner: true, parts: results.length, media: media.length, failed: results.filter((r) => !r.ok), n, total },
  };
  if (queuedId) await db.from("whatsapp_automation_events").update(ev).eq("id", queuedId);
  else await db.from("whatsapp_automation_events").insert(ev);
  return { conversation_id: convId, name, sent: !!first.id, media: media.length, failed: results.filter((r) => !r.ok) };
}

// Ahmed 11 Nov: price study reports go one client at a time, in order, with at least 2 minutes between two clients, so
// each client's details and documents arrive complete before the next starts. Every report (live handoff or a resend of
// all of them) is queued as an «owner_price_study» event (status detected, reason queued → sending → applied); the tick (cron every minute, and right
// after a report is queued) sends the oldest one only when nothing is being sent and the last one finished 2+ minutes ago.
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const GAP_MS = 2 * 60 * 1000;
async function enqueuePriceStudy(convId: string, n: number, total: number, force: boolean, seq: number) {
  const c = await db.from("whatsapp_conversations").select("id,company_id,client_id,route_key,handoff_reason,handoff_updated_at").eq("id", convId).maybeSingle();
  const conv: any = c.data;
  if (!conv) return { conversation_id: convId, error: "conversation_not_found" };
  if (!/^\s*دراسة\s*سعر/.test(String(conv.handoff_reason || ""))) return { conversation_id: convId, skipped: "not_price_study" };
  const at = String(conv.handoff_updated_at || "");
  const open = await db.from("whatsapp_automation_events").select("id,status").eq("conversation_id", conv.id).eq("action_type", "owner_price_study")
    .in("status", force ? ["detected"] : ["detected", "applied"]).contains("payload", { handoff_at: at }).limit(1);
  if ((open.data || []).length) return { conversation_id: convId, skipped: "already_queued_or_sent" };
  const ins = await db.from("whatsapp_automation_events").insert({
    company_id: conv.company_id, conversation_id: conv.id, client_id: conv.client_id, action_type: "owner_price_study", status: "detected",
    reason: "queued", payload: { handoff_at: at, route_key: conv.route_key, to_owner: true, n, total, force, seq },
  }).select("id").single();
  return { conversation_id: convId, queued: !ins.error, error: ins.error?.message || null };
}
async function priceStudyTick() {
  const now = Date.now();
  const busy = await db.from("whatsapp_automation_events").select("id,created_at,payload").eq("action_type", "owner_price_study").eq("status", "detected").eq("reason", "sending").limit(5);
  for (const b of busy.data || []) {
    const since = Date.parse(String((b.payload as any)?.sending_at || b.created_at));
    if (now - since < 10 * 60 * 1000) return { waiting: "sending" };
    await db.from("whatsapp_automation_events").update({ status: "failed", reason: "stuck_sending" }).eq("id", b.id).eq("status", "detected").eq("reason", "sending");
  }
  const last = await db.from("whatsapp_automation_events").select("applied_at").eq("action_type", "owner_price_study").in("status", ["applied"])
    .not("applied_at", "is", null).order("applied_at", { ascending: false }).limit(1).maybeSingle();
  const lastAt = last.data?.applied_at ? Date.parse(last.data.applied_at) : 0;
  if (now - lastAt < GAP_MS) return { waiting: "gap", next_at: new Date(lastAt + GAP_MS).toISOString() };
  const q = await db.from("whatsapp_automation_events").select("id,conversation_id,payload,created_at").eq("action_type", "owner_price_study").eq("status", "detected").eq("reason", "queued")
    .order("created_at", { ascending: true }).limit(50);
  const rows = (q.data || []).sort((a: any, b: any) => (a.created_at === b.created_at ? Number(a.payload?.seq || 0) - Number(b.payload?.seq || 0) : 0));
  const next: any = rows[0];
  if (!next) return { idle: true };
  const claim = await db.from("whatsapp_automation_events").update({ reason: "sending", payload: { ...next.payload, sending_at: new Date().toISOString() } })
    .eq("id", next.id).eq("status", "detected").eq("reason", "queued").select("id");
  if (!(claim.data || []).length) return { waiting: "claimed_elsewhere" };
  const p = next.payload || {};
  const r = await priceStudy(String(next.conversation_id), Math.max(1, Number(p.n) || 1), Math.max(1, Number(p.total) || 1), p.force === true, next.id);
  if ((r as any).skipped || (r as any).error && !(r as any).name) {
    await db.from("whatsapp_automation_events").update({ status: "skipped", reason: String((r as any).skipped || (r as any).error) }).eq("id", next.id);
  }
  return { sent: r, left: rows.length - 1 };
}

// Ahmed 8 Nov (R8): every day, an hour before the 24-hour window of each company number would close, that number writes
// «هلا» to Ahmed's private number, so he answers it (even a dot) and the window stays open for the hot buyer alerts.
// The hour is counted from Ahmed's last message to that number, so it moves with him day by day. Runs every 15 minutes.
// WhatsApp only renews the window when Ahmed's message reaches the number; the «هلا» is what reminds him in time.
async function keepAlive(force = false) {
  const out: any[] = [];
  const routes = await db.from("company_lead_routes").select("company_id,route_key,meta_phone_number_id").in("route_key", ["barka", "muscat"]);
  for (const rt of routes.data || []) {
    const prof = await db.from("profiles").select("phone").eq("company_id", rt.company_id).eq("role", "owner").eq("is_active", true).limit(1).maybeSingle();
    const raw = digits(prof.data?.phone), to = raw.length === 8 ? "968" + raw : raw;
    if (!to) { out.push({ route: rt.route_key, skipped: "no_owner_phone" }); continue; }
    const convs = await db.from("whatsapp_conversations").select("id").eq("company_id", rt.company_id).eq("route_key", rt.route_key).like("customer_wa_id", `%${to.slice(-8)}`);
    const ids = (convs.data || []).map((c: any) => c.id);
    const lastIn = ids.length ? await db.from("whatsapp_messages").select("message_timestamp").in("conversation_id", ids).eq("direction", "inbound").order("message_timestamp", { ascending: false }).limit(1).maybeSingle() : { data: null };
    const last = lastIn.data?.message_timestamp ? new Date(lastIn.data.message_timestamp).getTime() : 0;
    const now = Date.now(), closes = last + 24 * 3600 * 1000;
    if (!last) { out.push({ route: rt.route_key, skipped: "ahmed_never_wrote" }); continue; }
    const sent = await db.from("whatsapp_automation_events").select("id,status").eq("company_id", rt.company_id).eq("action_type", "owner_keepalive").contains("payload", { route_key: rt.route_key, window_from: new Date(last).toISOString() }).limit(5);
    const already = (sent.data || []).some((e: any) => e.status === "applied");
    if (!force && (already || now < closes - 3600 * 1000)) { out.push({ route: rt.route_key, waiting: true, closes_at: new Date(closes).toISOString(), already }); continue; }
    if (!force && now >= closes) {
      if (!(sent.data || []).length) await db.from("whatsapp_automation_events").insert({ company_id: rt.company_id, action_type: "owner_keepalive", status: "failed", reason: "window_closed: Ahmed did not answer the last «هلا»", payload: { route_key: rt.route_key, window_from: new Date(last).toISOString() } });
      out.push({ route: rt.route_key, closed: true });
      continue;
    }
    const r = await metaText(await routeTokens(rt.company_id, rt.route_key), digits(rt.meta_phone_number_id), to, "هلا");
    await db.from("whatsapp_automation_events").insert({ company_id: rt.company_id, action_type: "owner_keepalive", status: r.id ? "applied" : "failed", applied_at: r.id ? new Date().toISOString() : null, reason: r.error ? short(r.error, 400) : "هلا", payload: { route_key: rt.route_key, window_from: new Date(last).toISOString(), closes_at: new Date(closes).toISOString(), meta_message_id: r.id, forced: force } });
    out.push({ route: rt.route_key, sent: !!r.id, error: r.error });
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false }, 405);
  const secret = req.headers.get("x-crm-agent") || "";
  const ok = secret ? await db.rpc("crm_reply_agent_secret_ok", { p_secret: secret }) : null;
  if (!ok || ok.error || ok.data !== true) return json({ ok: false, error: "not_authorized" }, 403);
  const body = await req.json().catch(() => ({}));
  if (body?.action === "keepalive") return json({ ok: true, routes: await keepAlive(body?.force === true) });
  // price study report: one chat (trigger) or every open «دراسة سعر» chat now (batch, numbered «n من N»)
  // both only queue the reports; the tick sends them one client at a time with 2+ minutes between clients
  if (body?.action === "price_study") {
    const q1 = await enqueuePriceStudy(String(body?.conversation_id || ""), Math.max(1, Number(body?.n) || 1), Math.max(1, Number(body?.total) || 1), body?.force === true, 1);
    return json({ ok: true, queued: q1, tick: await priceStudyTick() });
  }
  if (body?.action === "price_study_batch") {
    const q = await db.from("whatsapp_conversations").select("id,route_key,handoff_updated_at").eq("human_handoff_required", true).in("route_key", ["barka", "muscat"])
      .ilike("handoff_reason", "دراسة%سعر%").order("handoff_updated_at", { ascending: true }).limit(40);
    // Ahmed 11 Nov: numbered per branch («1 من 6» Barka, «1 من 3» Muscat), Barka first then Muscat, each oldest first
    const all = q.data || [], out: any[] = [];
    const rows = ["barka", "muscat"].flatMap((rk) => all.filter((r: any) => r.route_key === rk));
    const totals: Record<string, number> = {}, counts: Record<string, number> = {};
    for (const r of rows) totals[r.route_key] = (totals[r.route_key] || 0) + 1;
    for (let i = 0; i < rows.length; i++) {
      const rk = rows[i].route_key; counts[rk] = (counts[rk] || 0) + 1;
      out.push(await enqueuePriceStudy(rows[i].id, counts[rk], totals[rk], body?.force === true, i + 1));
    }
    return json({ ok: true, total: rows.length, queued: out, tick: await priceStudyTick() });
  }
  if (body?.action === "price_study_tick") return json({ ok: true, tick: await priceStudyTick() });
  if (body?.action === "notify_owner") {
    // Ahmed 8 Nov: plain alert text to his private number from the given branch number (missing property details, new land study).
    const companyId = String(body?.company_id || ""), routeKey = body?.route_key === "barka" ? "barka" : "muscat", text = short(body?.text, 900);
    if (!companyId || !text) return json({ ok: false, error: "company_and_text_required" }, 400);
    const rts = await db.from("company_lead_routes").select("route_key,meta_phone_number_id").eq("company_id", companyId);
    const rt = (rts.data || []).find((r: any) => r.route_key === routeKey);
    const pf = await db.from("profiles").select("phone").eq("company_id", companyId).eq("role", "owner").eq("is_active", true).limit(1).maybeSingle();
    const raw2 = digits(pf.data?.phone), to2 = raw2.length === 8 ? "968" + raw2 : raw2, pid = digits(rt?.meta_phone_number_id);
    if (!to2 || !pid) return json({ ok: false, error: "route_missing" }, 500);
    const sent = await metaText(await routeTokens(companyId, routeKey), pid, to2, text);
    await db.from("whatsapp_automation_events").insert({ company_id: companyId, action_type: "owner_notify", status: sent.id ? "applied" : "failed", applied_at: sent.id ? new Date().toISOString() : null, reason: sent.error ? short(sent.error, 400) : String(body?.event_key || ""), payload: { route_key: routeKey, event_key: body?.event_key || null, to_owner: true, meta_message_id: sent.id } });
    return json({ ok: !!sent.id, sent: !!sent.id, error: sent.error });
  }
  const convId = String(body?.conversation_id || "");
  const test = body?.test === true;
  if (!convId) return json({ ok: false, error: "conversation_id_required" }, 400);

  const c = await db.from("whatsapp_conversations").select("id,company_id,client_id,route_key,customer_name,customer_phone,customer_wa_id,human_handoff_required,handoff_reason,handoff_updated_at,meta_phone_number_id").eq("id", convId).single();
  const conv = c.data;
  if (!conv) return json({ ok: false, error: "conversation_not_found" }, 404);
  if (!["barka", "muscat"].includes(conv.route_key)) return json({ ok: true, skipped: "route" });
  if (!test && !(conv.human_handoff_required && HOT.test(String(conv.handoff_reason || "")))) return json({ ok: true, skipped: "not_hot" });

  // one alert per handoff
  const at = String(conv.handoff_updated_at || "");
  if (!test) {
    const seen = await db.from("whatsapp_automation_events").select("id").eq("conversation_id", conv.id).eq("action_type", "owner_hot_alert").eq("status", "applied").contains("payload", { handoff_at: at }).limit(1);
    if ((seen.data || []).length) return json({ ok: true, skipped: "already_sent" });
  }

  const routes = await db.from("company_lead_routes").select("route_key,whatsapp_number,meta_phone_number_id").eq("company_id", conv.company_id);
  const route = (routes.data || []).find((r: any) => r.route_key === conv.route_key);
  // Ahmed's private number: the owner's profile phone (8 digits get the Oman code)
  const prof = await db.from("profiles").select("phone").eq("company_id", conv.company_id).eq("role", "owner").eq("is_active", true).limit(1).maybeSingle();
  const raw = digits(prof.data?.phone);
  const to = raw.length === 8 ? "968" + raw : raw;
  const phoneId = digits(route?.meta_phone_number_id || conv.meta_phone_number_id);
  if (!to || !phoneId) return json({ ok: false, error: "route_missing" }, 500);

  const cl = conv.client_id ? await db.from("clients").select("name,phone,phone_normalized").eq("id", conv.client_id).maybeSingle() : { data: null };
  const phone = digits(cl.data?.phone_normalized || cl.data?.phone || conv.customer_phone || conv.customer_wa_id);
  const name = cl.data?.name || conv.customer_name || "عميل";
  const branch = conv.route_key === "barka" ? "بركاء" : "مسقط";
  const reason = String(conv.handoff_reason || "").replace(/^\s*(مشتري جاد|تفاوض|اجتماع)\s*:\s*/, "");
  const meeting = /^\s*اجتماع/.test(String(conv.handoff_reason || ""));
  const kind = meeting ? "اجتماع" : /^\s*تفاوض/.test(String(conv.handoff_reason || "")) ? "يبي يتفاوض" : "مشتري جاد";
  const text = [
    `${test ? "🧪 تجربة تنبيه\n" : ""}${meeting ? "📅 طلب اجتماع ينتظر تأكيدك" : `🔥 عميل ساخن (${kind})`} · ${branch}`,
    `الاسم: ${name}`,
    `الرقم: ${phone}`,
    reason ? `${meeting ? "الموعد اللي طلبه" : "الموضوع"}: ${short(reason, 300)}` : "",
    `افتح المحادثة: https://wa.me/${phone}`,
    // R30 (Ahmed 11 Nov): the agent only took the requested slot; Ahmed confirms it or offers another time
    meeting ? "العقل قال له «تمام وصلت» بس. أكد له الموعد أو اقترح وقت ثاني" : "العقل ساكن في محادثته لين ترد عليه",
  ].filter(Boolean).join("\n");

  const r = await metaText(await routeTokens(conv.company_id, conv.route_key), phoneId, to, text);
  await db.from("whatsapp_automation_events").insert({
    company_id: conv.company_id, conversation_id: conv.id, client_id: conv.client_id, action_type: "owner_hot_alert",
    status: r.id ? "applied" : "failed", applied_at: r.id ? new Date().toISOString() : null, reason: r.error ? short(r.error, 400) : (test ? "test" : kind),
    payload: { handoff_at: at, route_key: conv.route_key, to_owner: true, meta_message_id: r.id, test },
  });
  return json({ ok: !!r.id, sent: !!r.id, error: r.error });
});
