// Sends a WhatsApp reply draft after the owner approves it (optionally edited) in the CRM.
// Guards: owner only, draft still pending (claimed atomically so it is sent once), customer
// wrote within the last 24 hours, conversation on an allowed company route, never to a
// company number. Afterwards the CRM is updated the same way the agent's direct mode does.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const GRAPH = Deno.env.get("META_GRAPH_VERSION") || "v25.0";
const WINDOW_MS = 24 * 3600 * 1000;
const ALLOWED_ORIGINS = ["https://omanvilla.github.io"];

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const enc = new TextEncoder();
const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const short = (v: unknown, n = 1500) => { const s = String(v ?? "").trim(); return s.length > n ? s.slice(0, n) + "…" : s; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function b64(s: string) { const b = atob(s); const o = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) o[i] = b.charCodeAt(i); return o; }
function cors(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

async function routeTokens(companyId: string, routeKey: string) {
  const out: string[] = [];
  try {
    const c = await db.from("whatsapp_route_credentials").select("token_ciphertext,token_iv,expires_at").eq("company_id", companyId).eq("route_key", routeKey).maybeSingle();
    if (c.data && (!c.data.expires_at || new Date(c.data.expires_at).getTime() > Date.now() + 60000)) {
      const seed = enc.encode(`${META_APP_SECRET}|${companyId}|${routeKey}|habib-crm-whatsapp-v1`);
      const key = await crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", seed), { name: "AES-GCM" }, false, ["decrypt"]);
      out.push(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(c.data.token_iv) }, key, b64(c.data.token_ciphertext))));
    }
  } catch (e) { console.error("[reply-send] credential", String((e as any)?.message || e)); }
  if (WHATSAPP_ACCESS_TOKEN && !out.includes(WHATSAPP_ACCESS_TOKEN)) out.push(WHATSAPP_ACCESS_TOKEN);
  return out;
}

async function metaSend(tokens: string[], phoneId: string, to: string, payload: any) {
  for (const t of tokens) {
    const r = await fetch(`https://graph.facebook.com/${GRAPH}/${phoneId}/messages`, {
      method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, ...payload }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) return d?.messages?.[0]?.id || null;
    console.error("[reply-send] meta", r.status, JSON.stringify(d).slice(0, 400));
  }
  throw new Error("meta_send_failed");
}

Deno.serve(async (req) => {
  const headers = { ...cors(req), "content-type": "application/json; charset=utf-8" };
  const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers });
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ ok: false }, 405);

  // the caller must be the company owner
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const u = await db.auth.getUser(jwt);
  if (u.error || !u.data.user) return json({ ok: false, error: "not_signed_in" }, 401);
  const prof = await db.from("profiles").select("id,company_id,role,is_active").eq("id", u.data.user.id).single();
  if (prof.error || prof.data.role !== "owner" || prof.data.is_active === false) return json({ ok: false, error: "owner_only" }, 403);
  const owner = prof.data;

  const body = await req.json().catch(() => ({}));
  const draftId = String(body?.draft_id || "");
  const edited = Array.isArray(body?.messages) ? body.messages.map((t: unknown) => String(t ?? "").trim()).filter(Boolean).slice(0, 5) : null;
  if (!draftId) return json({ ok: false, error: "draft_id_required" }, 400);

  const d0 = await db.from("whatsapp_reply_drafts").select("*").eq("id", draftId).eq("company_id", owner.company_id).maybeSingle();
  if (d0.error || !d0.data) return json({ ok: false, error: "draft_not_found" }, 404);
  const draft = d0.data;
  if (draft.status !== "pending") return json({ ok: false, error: "draft_not_pending", status: draft.status }, 409);
  if (draft.analysis?.dry_run === true) return json({ ok: false, error: "dry_run_draft" }, 409);
  const texts: string[] = edited && edited.length ? edited : (draft.reply_messages || []);
  if (!texts.length) return json({ ok: false, error: "empty_reply" }, 400);
  const wasEdited = !!edited && JSON.stringify(edited) !== JSON.stringify(draft.reply_messages || []);

  const [convR, clientR, routesR, lastInR] = await Promise.all([
    db.from("whatsapp_conversations").select("*").eq("id", draft.conversation_id).single(),
    db.from("clients").select("id,name,phone,phone_normalized").eq("id", draft.client_id).single(),
    db.from("company_lead_routes").select("route_key,whatsapp_number,meta_phone_number_id"),
    db.from("whatsapp_messages").select("message_timestamp").eq("conversation_id", draft.conversation_id).eq("direction", "inbound")
      .order("message_timestamp", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const conv = convR.data, client = clientR.data;
  if (!conv || !client) return json({ ok: false, error: "context_missing" }, 409);
  const to = digits(client.phone_normalized || client.phone);
  const companyNumbers = (routesR.data || []).map((r: any) => digits(r.whatsapp_number)).filter(Boolean);
  if (!to || companyNumbers.includes(to)) return json({ ok: false, error: "company_number" }, 409);
  if (!["barka", "muscat"].includes(conv.route_key)) return json({ ok: false, error: "route_blocked" }, 409);
  const lastIn = lastInR.data?.message_timestamp ? new Date(lastInR.data.message_timestamp).getTime() : 0;
  if (!lastIn || Date.now() - lastIn > WINDOW_MS) return json({ ok: false, error: "outside_24h" }, 409);

  // claim the draft so a second tap or another device cannot send it twice
  const claim = await db.from("whatsapp_reply_drafts").update({ status: "sending" }).eq("id", draftId).eq("status", "pending").select("id").maybeSingle();
  if (claim.error || !claim.data) return json({ ok: false, error: "draft_not_pending" }, 409);

  const analysis = draft.analysis || {};
  const outgoing: any[] = texts.map((t) => ({ type: "text", text: { preview_url: false, body: t } }));
  let prop: any = null;
  if (analysis.property_id) {
    const p = await db.from("properties").select("id,map_url,lockbox_image_url,visit_method,owner_id,area").eq("id", analysis.property_id).maybeSingle();
    prop = p.data || null;
  }
  if ((analysis.action === "send_location" || analysis.action === "send_lockbox") && prop?.map_url) outgoing.push({ type: "text", text: { preview_url: true, body: prop.map_url } });
  if (analysis.action === "send_lockbox" && prop?.lockbox_image_url) outgoing.push({ type: "image", image: { link: prop.lockbox_image_url } });
  if (analysis.action === "send_owner_number" && prop?.visit_method === "owner_lives" && prop.owner_id) {
    const o = await db.from("owners").select("phone").eq("id", prop.owner_id).maybeSingle();
    if (o.data?.phone) outgoing.push({ type: "text", text: { preview_url: false, body: digits(o.data.phone) } });
  }

  const tokens = await routeTokens(owner.company_id, conv.route_key);
  const phoneId = digits(conv.meta_phone_number_id);
  const sentIds: string[] = [];
  try {
    for (let i = 0; i < outgoing.length; i++) {
      if (i) await sleep(1200);
      const wamid = await metaSend(tokens, phoneId, to, outgoing[i]);
      if (!wamid) continue;
      sentIds.push(wamid);
      await db.from("whatsapp_messages").insert({
        company_id: owner.company_id, conversation_id: conv.id, client_id: client.id, whatsapp_message_id: wamid,
        direction: "outbound", message_type: outgoing[i].type, sender_wa_id: phoneId, recipient_wa_id: to,
        body: outgoing[i].type === "text" ? outgoing[i].text.body : "[صورة صندوق المفتاح]",
        message_timestamp: new Date().toISOString(), delivery_status: "sent", actor_type: "automated",
        channel_source: "crm_reply_agent", raw_payload: { source: "reply_agent_approved", draft_id: draftId, approved_by: owner.id, edited: wasEdited },
      });
    }
  } catch (e) {
    const why = short((e as any)?.message || e, 500);
    await db.from("whatsapp_reply_drafts").update({ status: sentIds.length ? "sent" : "failed", error: why, approved_messages: texts, decided_by: owner.id, decided_at: new Date().toISOString(), sent_at: sentIds.length ? new Date().toISOString() : null }).eq("id", draftId);
    return json({ ok: false, error: why, sent: sentIds.length }, 502);
  }

  const now = new Date().toISOString();
  await db.from("whatsapp_reply_drafts").update({
    status: "sent", approved_messages: texts, decided_by: owner.id, decided_at: now, sent_at: now, error: null,
    analysis: { ...analysis, approved_edited: wasEdited },
  }).eq("id", draftId);

  // keep the CRM up to date, like the agent's direct mode
  const convPatch: any = { ai_summary: short(analysis.crm_note, 1500), last_automation_action: { scenario: "reply_agent_v1", action: analysis.action, at: now, category: analysis.category, approved: true }, updated_at: now };
  if (analysis.action === "handoff") Object.assign(convPatch, { human_handoff_required: true, handoff_reason: short(analysis.handoff_reason || analysis.intent, 500), handoff_updated_at: now });
  await db.from("whatsapp_conversations").update(convPatch).eq("id", conv.id);
  try {
    const flags: any = {};
    if (analysis.category === "buyer" || analysis.category === "tenant") flags.is_buyer = true;
    if (analysis.category === "seller") flags.is_seller = true;
    if (analysis.category === "investor") flags.is_investor = true;
    if (analysis.area) flags.preferred_area = short(analysis.area, 200);
    if (Object.keys(flags).length) await db.from("clients").update(flags).eq("id", client.id);
  } catch (_) { /* optional */ }
  await db.from("whatsapp_automation_events").insert({
    company_id: owner.company_id, conversation_id: conv.id, message_id: draft.message_id, client_id: client.id, property_id: prop?.id || null,
    action_type: "reply_agent_v1", status: "applied", confidence: 1, reason: short(analysis.intent, 500), payload: { ...analysis, approved_by: owner.id, edited: wasEdited }, applied_at: now,
  });
  return json({ ok: true, sent: sentIds.length });
});
