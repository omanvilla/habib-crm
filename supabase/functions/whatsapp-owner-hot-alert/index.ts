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
const HOT = /^\s*(مشتري جاد|تفاوض)\s*:/;

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

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false }, 405);
  const secret = req.headers.get("x-crm-agent") || "";
  const ok = secret ? await db.rpc("crm_reply_agent_secret_ok", { p_secret: secret }) : null;
  if (!ok || ok.error || ok.data !== true) return json({ ok: false, error: "not_authorized" }, 403);
  const body = await req.json().catch(() => ({}));
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
  const reason = String(conv.handoff_reason || "").replace(/^\s*(مشتري جاد|تفاوض)\s*:\s*/, "");
  const kind = /^\s*تفاوض/.test(String(conv.handoff_reason || "")) ? "يبي يتفاوض" : "مشتري جاد";
  const text = [
    `${test ? "🧪 تجربة تنبيه\n" : ""}🔥 عميل ساخن (${kind}) · ${branch}`,
    `الاسم: ${name}`,
    `الرقم: ${phone}`,
    reason ? `الموضوع: ${short(reason, 300)}` : "",
    `افتح المحادثة: https://wa.me/${phone}`,
    "العقل ساكن في محادثته لين ترد عليه",
  ].filter(Boolean).join("\n");

  const r = await metaText(await routeTokens(conv.company_id, conv.route_key), phoneId, to, text);
  await db.from("whatsapp_automation_events").insert({
    company_id: conv.company_id, conversation_id: conv.id, client_id: conv.client_id, action_type: "owner_hot_alert",
    status: r.id ? "applied" : "failed", applied_at: r.id ? new Date().toISOString() : null, reason: r.error ? short(r.error, 400) : (test ? "test" : kind),
    payload: { handoff_at: at, route_key: conv.route_key, to_owner: true, meta_message_id: r.id, test },
  });
  return json({ ok: !!r.id, sent: !!r.id, error: r.error });
});
