// SQL167 (27 Nov 2026, Ahmed: «أهم شيء عندي إن إذا ما ردينا عليهم ينتقلوا على الواتساب»). The missed-call receptionist.
// Each office Android phone (and, if Ahmed wants, his own phone for the calls forwarded to him 4-8 PM) runs MacroDroid:
//   missed call  → GET/POST https://<project>.supabase.co/functions/v1/missed-call?k=<device key>&n=<caller number>
//   once a day   → …/missed-call?k=<device key>&ping=1   (the morning check sees the phone is alive)
// public.crm_missed_call_plan records the call and decides; this function then
//   1. sends the caller «شفنا اتصالك وما نقدر نرد الحين / اكتب لنا موضوعك هنا ونرد عليك» (4-8 PM: missed_call_evening_ar_v1) from the
//      line that rang: plain text inside the 24-hour window, else the approved template. Only while whatsapp_automation_runtime.missed_call_auto is on;
//      off = dry run (recorded, nothing sent). One per number per 12 hours; never into a chat Ahmed is negotiating in or muted.
//   2. logs it in the chat (made when the number never wrote, so the reply agent and Maram see it when he answers),
//   3. tells Ahmed on his WhatsApp at once, even after 8 PM, when the caller has a viewing around now today or wrote that he is
//      at the property.
// Callers who did not write within 45 minutes become ONE «📞 رجّع اتصال» task for Maram (crm_repair_private.missed_call_tasks).
//   templates {submit} (x-crm-agent secret): submits / refreshes the two templates on both numbers.
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false, autoRefreshToken: false } });
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const GRAPH = Deno.env.get("META_GRAPH_VERSION") || "v25.0";
const enc = new TextEncoder();
const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const short = (v: unknown, n = 300) => { const s = String(v ?? "").trim(); return s.length > n ? s.slice(0, n) + "…" : s; };
function b64(s: string) { const b = atob(s); const o = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) o[i] = b.charCodeAt(i); return o; }
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json; charset=utf-8" } });

// Ahmed's own words (27 Nov): «ما نقدر نرد الحين، اكتب لنا موضوعك هنا ونرد عليك» in the office style (no commas or full stops)
// 4-8 PM the call rang through to Ahmed's iPhone, which cannot tell us whether he answered: a wording that fits both
export const TEMPLATES: Record<string, string> = {
  missed_call_ar_v1: "شفنا اتصالك وما نقدر نرد الحين\nاكتب لنا موضوعك هنا ونرد عليك",
  missed_call_evening_ar_v1: "شكرا على اتصالك\nاذا ما قدرنا نرد عليك اكتب لنا موضوعك هنا ونرد عليك",
};
const LINE_AR: Record<string, string> = { barka: "بركاء", muscat: "مسقط" };

async function token(companyId: string, routeKey: string) {
  const c = await db.from("whatsapp_route_credentials").select("token_ciphertext,token_iv,expires_at").eq("company_id", companyId).eq("route_key", routeKey).maybeSingle();
  if (!c.data || (c.data.expires_at && new Date(c.data.expires_at).getTime() <= Date.now() + 60000)) return null;
  const key = await crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", enc.encode(`${META_APP_SECRET}|${companyId}|${routeKey}|habib-crm-whatsapp-v1`)), { name: "AES-GCM" }, false, ["decrypt"]);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(c.data.token_iv) }, key, b64(c.data.token_ciphertext)));
}
async function meta(t: string, phoneId: string, to: string, payload: any) {
  const r = await fetch(`https://graph.facebook.com/${GRAPH}/${phoneId}/messages`, { method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, ...payload }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(short(d?.error?.message || `meta_${r.status}`, 300) + (d?.error?.code ? ` (${d.error.code})` : ""));
  return d?.messages?.[0]?.id || null;
}
function omanTime(d = new Date()) {
  return new Intl.DateTimeFormat("ar-OM-u-nu-latn", { timeZone: "Asia/Muscat", hour: "numeric", minute: "2-digit", hour12: true }).format(d);
}

// the chat of this number on this line; made when he never wrote (no client is made: a person only becomes a client when he writes)
async function conversation(p: any) {
  if (p.conversation_id) return p.conversation_id as string;
  const ins = await db.from("whatsapp_conversations").insert({
    company_id: p.company_id, route_key: p.line, assigned_to: p.assigned_to || null, client_id: p.client_id || null, meta_phone_number_id: String(p.meta_phone_number_id),
    inbound_number: p.inbound_number, customer_wa_id: p.wa, customer_phone: p.phone, status: "open", unread_count: 0,
  }).select("id").single();
  if (ins.data?.id) return ins.data.id as string;
  // made at the same moment by an incoming message
  const ex = await db.from("whatsapp_conversations").select("id").eq("company_id", p.company_id).eq("meta_phone_number_id", String(p.meta_phone_number_id)).eq("customer_wa_id", p.wa).maybeSingle();
  if (ex.data?.id) return ex.data.id as string;
  throw new Error(ins.error?.message || "conversation_failed");
}

async function sendToCaller(p: any) {
  const t = await token(p.company_id, p.line);
  if (!t) throw new Error("route_not_ready");
  const convId = await conversation(p);
  const phoneId = digits(p.meta_phone_number_id);
  const name = TEMPLATES[p.template] ? p.template : "missed_call_ar_v1", body = TEMPLATES[name];
  const id = p.mode === "text"
    ? await meta(t, phoneId, p.wa, { type: "text", text: { preview_url: false, body } })
    : await meta(t, phoneId, p.wa, { type: "template", template: { name, language: { code: "ar" } } });
  const now = new Date().toISOString();
  if (id) await db.from("whatsapp_messages").insert({
    company_id: p.company_id, conversation_id: convId, client_id: p.client_id || null, whatsapp_message_id: id, direction: "outbound",
    message_type: p.mode === "text" ? "text" : "template", sender_wa_id: phoneId, recipient_wa_id: p.wa, body, message_timestamp: now,
    delivery_status: "sent", actor_type: "automated", channel_source: "crm_missed_call",
    raw_payload: { source: "missed_call", missed_call_id: p.id, template_name: p.mode === "text" ? null : name },
  });
  await db.from("whatsapp_conversations").update({ last_message_at: now, last_outbound_at: now, updated_at: now }).eq("id", convId);
  return { id, convId };
}

// Ahmed's alert, from the same line, as the other owner alerts (free text: the 24 hours he opens each day by writing «هلا»)
async function alertOwner(p: any) {
  const pf = await db.from("profiles").select("phone").eq("company_id", p.company_id).eq("role", "owner").eq("is_active", true).limit(1).maybeSingle();
  const raw = digits(pf.data?.phone), to = raw.length === 8 ? "968" + raw : raw;
  const t = await token(p.company_id, p.line);
  if (!to || !t) return "failed: route_not_ready";
  const text = `📞 اتصال فايت يحتاجك الحين\n${p.client_name || "رقم جديد"} ${p.phone.slice(-8)} اتصل على رقم ${LINE_AR[p.line] || p.line} الساعة ${omanTime()}\nالسبب: ${p.hot}\nhttps://wa.me/${p.wa}`;
  try { const id = await meta(t, digits(p.meta_phone_number_id), to, { type: "text", text: { preview_url: false, body: text } }); return id ? "sent" : "failed"; }
  catch (e) { return "failed: " + short((e as any)?.message || e, 200); }
}

async function templates(submit: boolean) {
  const out: any[] = [];
  const rts = await db.from("company_lead_routes").select("company_id,route_key,meta_waba_id").eq("is_active", true).in("route_key", ["barka", "muscat"]);
  for (const rt of rts.data || []) {
    const t = await token(rt.company_id, rt.route_key);
    if (!t || !rt.meta_waba_id) { out.push({ route: rt.route_key, error: "route_not_ready" }); continue; }
    for (const [name, text] of Object.entries(TEMPLATES)) {
      const g = await fetch(`https://graph.facebook.com/${GRAPH}/${rt.meta_waba_id}/message_templates?name=${name}&fields=name,status,language,category`, { headers: { Authorization: `Bearer ${t}` } });
      const found = ((await g.json().catch(() => ({})))?.data || []).find((x: any) => x.name === name);
      let status = found?.status || "MISSING", category = String(found?.category || "UTILITY").toUpperCase();
      if (status === "MISSING" && submit) {
        const c = await fetch(`https://graph.facebook.com/${GRAPH}/${rt.meta_waba_id}/message_templates`, { method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
          body: JSON.stringify({ name, language: "ar", category: "UTILITY", components: [{ type: "BODY", text }] }) });
        const cd = await c.json().catch(() => ({}));
        status = c.ok ? (cd.status || "PENDING") : `ERROR: ${short(cd?.error?.error_user_msg || cd?.error?.message, 200)}`;
        if (c.ok && cd.category) category = String(cd.category).toUpperCase();
      }
      out.push({ route: rt.route_key, name, status, category });
      if (!status.startsWith("ERROR") && status !== "MISSING") await db.from("whatsapp_template_registry").upsert({ company_id: rt.company_id, route_key: rt.route_key, waba_id: String(rt.meta_waba_id), template_name: name, language: "ar", category, status: String(status).toUpperCase(), last_checked_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "company_id,route_key,template_name,language" });
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (!["GET", "POST"].includes(req.method)) return json({ ok: false }, 405);
  const u = new URL(req.url);
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  try {
    const secret = req.headers.get("x-crm-agent") || "";
    if (secret) {
      const ok = await db.rpc("crm_reply_agent_secret_ok", { p_secret: secret });
      if (ok.error || ok.data !== true) return json({ ok: false, error: "not_authorized" }, 403);
      if (body?.action === "templates") return json({ ok: true, templates: await templates(body.submit === true) });
      return json({ ok: false, error: "unknown_action" }, 400);
    }
    const key = String(body?.k || u.searchParams.get("k") || "");
    const number = String(body?.n || u.searchParams.get("n") || "");
    const ping = String(body?.ping || u.searchParams.get("ping") || "") === "1";
    if (!key) return json({ ok: false, error: "key_required" }, 401);
    const plan = await db.rpc("crm_missed_call_plan", { p_key: key, p_number: number, p_ping: ping });
    if (plan.error) return json({ ok: false, error: short(plan.error.message) }, 500);
    const p: any = plan.data || {};
    if (!p.ok) return json({ ok: false, error: p.error || "refused" }, 401);
    if (!p.id || p.merged) return json(p);
    let status: string | null = null, reason: string | null = null, msgId: string | null = null, convId: string | null = null, alert: string | null = null;
    if (p.send) {
      try { const r = await sendToCaller(p); status = r.id ? "sent" : "failed"; msgId = r.id; convId = r.convId; reason = r.id ? p.mode : "no_message_id"; }
      catch (e) { status = "failed"; reason = short((e as any)?.message || e, 300); }
    }
    if (p.hot) alert = await alertOwner(p);
    if (status || alert) await db.rpc("crm_missed_call_done", { p_id: p.id, p_status: status, p_reason: reason, p_message_id: msgId, p_conversation: convId, p_owner_alert: alert });
    return json({ ok: true, id: p.id, wa_status: status || p.wa_status, wa_reason: reason || p.wa_reason, hot: !!p.hot, owner_alert: alert });
  } catch (e) { return json({ ok: false, error: short((e as any)?.message || e, 300) }, 500); }
});
