// When a property is sold or booked, everyone who asked about it (except the buyer) is told once:
// "بخصوص الفيلا اللي سألت عنها في الهرم انحجزت" + "تحب تشوف خيارات ثانية ؟".
// The reply agent takes the conversation from there (asks specs/budget or proposes an alternative).
// Nothing is sent unless the owner approved the row; sending only 9am–9pm Oman time.
// R38 (Ahmed 12 Nov 2026): the same wording as whatsapp-outreach queue_sold. When a unit of the same group is still available
// (SQL97, crm_unit_group_notice): "… انحجزت وحدة منها والمتبقي الثانية والثالثة" + "تحب تشوفها ؟" (template
// property_unit_booked_ar_v1 outside the 24 hours). R1/R3: nothing is sent to a chat Ahmed took or negotiates in, and nothing
// is prepared for a negotiation (crm_chat_hold). The database trigger calls whatsapp-outreach; this older entry point is kept
// in step with it.
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false, autoRefreshToken: false } });
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const GRAPH = Deno.env.get("META_GRAPH_VERSION") || "v25.0";
const TEMPLATE = "property_booked_options_ar_v1"; // body: بخصوص {{1}} اللي سألت عنها {{2}}\nتحب تشوف خيارات ثانية ؟
const UNIT_TEMPLATE = "property_unit_booked_ar_v1"; // body: بخصوص {{1}} اللي سألت عنها في {{2}}\nانحجزت وحدة منها والمتبقي {{3}}\nتحب تشوفها ؟
const LOOKBACK_DAYS = 90;
// R1/R3 (crm_chat_hold; an error counts as held). Sending: any hold (someone typed in the chat by hand, a negotiation, muted).
// Preparing: only a negotiation with Ahmed or a muted chat, as in whatsapp-outreach.
async function held(conversationId: string, hardOnly = false) {
  const h = await db.rpc("crm_chat_hold", { p_conversation: conversationId });
  if (h.error) return true;
  return hardOnly ? ["negotiation", "muted"].includes(String(h.data || "")) : !!h.data;
}
const enc = new TextEncoder();
const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json; charset=utf-8" } });
function b64(s: string) { const b = atob(s); const o = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) o[i] = b.charCodeAt(i); return o; }
const omanHour = () => +new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Muscat", hour: "2-digit", hour12: false }).format(new Date());
const NOUN: Record<string, [string, string]> = {
  villa: ["الفيلا", "انحجزت"], twin_villa: ["الفيلا", "انحجزت"], townhouse: ["الفيلا", "انحجزت"], house: ["البيت", "انحجز"],
  land: ["الارض", "انحجزت"], land_residential: ["الارض", "انحجزت"], land_commercial: ["الارض", "انحجزت"], apartment: ["الشقة", "انحجزت"],
  resthouse: ["الاستراحة", "انحجزت"], chalet: ["الشاليه", "انحجز"], farm: ["المزرعة", "انحجزت"],
};

async function token(companyId: string, routeKey: string) {
  const c = await db.from("whatsapp_route_credentials").select("token_ciphertext,token_iv,expires_at").eq("company_id", companyId).eq("route_key", routeKey).maybeSingle();
  if (!c.data) return null;
  const key = await crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", enc.encode(`${META_APP_SECRET}|${companyId}|${routeKey}|habib-crm-whatsapp-v1`)), { name: "AES-GCM" }, false, ["decrypt"]);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(c.data.token_iv) }, key, b64(c.data.token_ciphertext)));
}
async function meta(t: string, phoneId: string, to: string, payload: any) {
  const r = await fetch(`https://graph.facebook.com/${GRAPH}/${phoneId}/messages`, { method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, ...payload }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error?.message || `meta_${r.status}`);
  return d?.messages?.[0]?.id || null;
}

// Fill the queue for one property: who asked about it, minus the buyer.
async function collect(propertyId: string, dry: boolean) {
  const p = await db.from("properties").select("id,company_id,type,area,wilayat,status,title").eq("id", propertyId).single();
  if (p.error) throw new Error("property_not_found");
  const prop = p.data;
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();
  const [msgs, reels, views, reqs, deals, routes] = await Promise.all([
    db.from("whatsapp_messages").select("conversation_id,client_id").eq("matched_property_id", propertyId).eq("direction", "inbound").gte("message_timestamp", since),
    db.from("instagram_media_catalog").select("link_key").eq("property_id", propertyId),
    db.from("viewings").select("client_id").eq("property_id", propertyId),
    db.from("client_requests").select("client_id").eq("subject_property_id", propertyId),
    db.from("deals").select("client_id,stage").eq("property_id", propertyId),
    db.from("company_lead_routes").select("whatsapp_number"),
  ]);
  const keys = (reels.data || []).map((r: any) => r.link_key).filter(Boolean);
  const reelMsgs = keys.length ? await db.from("whatsapp_messages").select("conversation_id,client_id").in("property_link_key", keys).eq("direction", "inbound").gte("message_timestamp", since) : { data: [] };
  const buyers = new Set((deals.data || []).filter((d: any) => d.stage !== "lost").map((d: any) => d.client_id));
  const ids = new Set<string>();
  for (const r of [...(msgs.data || []), ...((reelMsgs as any).data || []), ...(views.data || []), ...(reqs.data || [])]) if (r.client_id && !buyers.has(r.client_id)) ids.add(r.client_id);
  if (!ids.size) return { property: prop.title, rows: [] };
  const company = (routes.data || []).map((r: any) => digits(r.whatsapp_number));
  const [cl, cv] = await Promise.all([
    db.from("clients").select("id,name,phone,phone_normalized,archived,followup_suppressed").in("id", [...ids]),
    db.from("whatsapp_conversations").select("id,client_id,route_key,last_inbound_at,meta_phone_number_id").in("client_id", [...ids]).order("last_inbound_at", { ascending: false }),
  ]);
  const [noun, verb] = NOUN[prop.type] || ["العقار", "انحجز"];
  const where = prop.area || prop.wilayat || "";
  // R38: is a unit of the same group still available ?
  const grp = await db.rpc("crm_unit_group_notice", { p_property: prop.id });
  if (grp.error) console.error("[sold-notify] unit group", grp.error.message);
  const unit: any = !grp.error && grp.data?.line && grp.data?.remaining_text ? grp.data : null;
  const rows: any[] = [];
  for (const c of cl.data || []) {
    const conv = (cv.data || []).find((x: any) => x.client_id === c.id);
    let reason: string | null = null;
    if (c.archived) reason = "client_archived";
    else if (c.followup_suppressed) reason = "client_paused";
    else if (!conv) reason = "no_conversation";
    else if (company.includes(digits(c.phone_normalized || c.phone))) reason = "company_number";
    else if (await held(conv.id, true)) reason = "owner_chat";
    const service = !!conv?.last_inbound_at && Date.now() - new Date(conv.last_inbound_at).getTime() < 23 * 3600000;
    rows.push({
      company_id: prop.company_id, kind: "property_sold", property_id: prop.id, client_id: c.id, conversation_id: conv?.id || null,
      route_key: conv?.route_key || null, send_mode: service ? "service" : "template", dry_run: dry,
      ...(unit
        ? { step: "unit_booked", template_name: UNIT_TEMPLATE, template_params: [noun, where || "نفس المنطقة", String(unit.remaining_text)],
            messages: [`بخصوص ${noun} اللي سألت عنها${where ? ` في ${where}` : ""} ${unit.line}`, "تحب تشوفها ؟"] }
        : { step: "booked", template_name: TEMPLATE, template_params: [noun, `${where ? `في ${where} ` : ""}${verb}`],
            messages: [`بخصوص ${noun} اللي سألت عنها${where ? ` في ${where}` : ""} ${verb}`, "تحب تشوف خيارات ثانية ؟"] }),
      status: reason ? "skipped" : "pending", reason,
    });
  }
  // a row already handled (approved/sent) is never reset
  const existing = await db.from("whatsapp_outreach_queue").select("client_id,status").eq("kind", "property_sold").eq("property_id", prop.id);
  const done = new Set((existing.data || []).filter((e: any) => ["approved", "sent"].includes(e.status)).map((e: any) => e.client_id));
  const fresh = rows.filter((r) => !done.has(r.client_id));
  if (fresh.length) {
    const up = await db.from("whatsapp_outreach_queue").upsert(fresh, { onConflict: "kind,property_id,client_id" });
    if (up.error) throw new Error(up.error.message);
  }
  return { property: prop.title, rows: rows.map((r) => ({ client_id: r.client_id, status: r.status, reason: r.reason, send_mode: r.send_mode, messages: r.messages })) };
}

// Send rows the owner approved.
async function sendApproved() {
  const h = omanHour();
  if (h < 9 || h >= 21) return { sent: 0, reason: "outside_sending_hours" };
  // only the sold notices: every other approved row belongs to whatsapp-outreach
  const q = await db.from("whatsapp_outreach_queue").select("*").eq("status", "approved").eq("dry_run", false).eq("kind", "property_sold").limit(20);
  const reg = await db.from("whatsapp_template_registry").select("route_key,template_name,status");
  const approvedTpl = new Set((reg.data || []).filter((x: any) => String(x.status).toUpperCase() === "APPROVED").map((x: any) => `${x.route_key}|${x.template_name}`));
  let sent = 0;
  for (const r of q.data || []) {
    try {
      const [cl, cv] = await Promise.all([
        db.from("clients").select("phone,phone_normalized,followup_suppressed").eq("id", r.client_id).single(),
        db.from("whatsapp_conversations").select("id,meta_phone_number_id,last_inbound_at").eq("id", r.conversation_id).single(),
      ]);
      if (cl.data?.followup_suppressed) { await db.from("whatsapp_outreach_queue").update({ status: "skipped", reason: "client_paused" }).eq("id", r.id); continue; }
      // R1/R3: the row waits while Ahmed holds the chat
      if (await held(r.conversation_id)) continue;
      const t = await token(r.company_id, r.route_key);
      if (!t || !cv.data) throw new Error("route_not_ready");
      const to = digits(cl.data?.phone_normalized || cl.data?.phone), phoneId = digits(cv.data.meta_phone_number_id);
      const service = !!cv.data.last_inbound_at && Date.now() - new Date(cv.data.last_inbound_at).getTime() < 23 * 3600000;
      const now = new Date().toISOString();
      const out: string[] = [];
      if (service) { for (const m of r.messages) out.push(await meta(t, phoneId, to, { type: "text", text: { preview_url: false, body: m } })); }
      else {
        // the row's own template and parameters (R38); rows queued before them carry only the text
        let name = String(r.template_name || TEMPLATE);
        let params: string[] = Array.isArray(r.template_params) ? r.template_params.map(String) : [];
        if (!params.length) {
          const mm = String((r.messages as string[])[0] || "").match(/^بخصوص (\S+) اللي سألت عنها (.+)$/);
          if (!mm) throw new Error("template_params");
          name = TEMPLATE; params = [mm[1], mm[2]];
        }
        if (!approvedTpl.has(`${r.route_key}|${name}`)) { await db.from("whatsapp_outreach_queue").update({ error: "template_pending" }).eq("id", r.id); continue; }
        out.push(await meta(t, phoneId, to, { type: "template", template: { name, language: { code: "ar" }, components: [{ type: "body", parameters: params.map((x) => ({ type: "text", text: x })) }] } }));
      }
      for (let i = 0; i < out.length; i++) if (out[i]) await db.from("whatsapp_messages").insert({
        company_id: r.company_id, conversation_id: r.conversation_id, client_id: r.client_id, whatsapp_message_id: out[i], direction: "outbound",
        message_type: service ? "text" : "template", sender_wa_id: phoneId, recipient_wa_id: to, body: service ? r.messages[i] : (r.messages as string[]).join("\n"),
        message_timestamp: now, delivery_status: "sent", actor_type: "automated", channel_source: "crm_outreach", raw_payload: { source: "property_sold_notice", queue_id: r.id, property_id: r.property_id },
      });
      await db.from("whatsapp_outreach_queue").update({ status: "sent", sent_at: now, send_mode: service ? "service" : "template", error: null }).eq("id", r.id);
      sent++;
    } catch (e) { await db.from("whatsapp_outreach_queue").update({ status: "failed", error: String((e as any)?.message || e).slice(0, 500) }).eq("id", r.id); }
  }
  return { sent };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false }, 405);
  const secret = req.headers.get("x-crm-agent") || "";
  const ok = secret ? await db.rpc("crm_reply_agent_secret_ok", { p_secret: secret }) : null;
  if (!ok || ok.error || ok.data !== true) return json({ ok: false, error: "not_authorized" }, 403);
  const body = await req.json().catch(() => ({}));
  try {
    if (body?.send_approved === true) return json({ ok: true, ...(await sendApproved()) });
    if (!body?.property_id) return json({ ok: false, error: "property_id_required" }, 400);
    return json({ ok: true, ...(await collect(String(body.property_id), body?.dry_run !== false)) });
  } catch (e) { return json({ ok: false, error: String((e as any)?.message || e) }, 500); }
});
