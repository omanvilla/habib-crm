// Suggests what a WhatsApp conversation is about so staff can classify it in
// one click (SQL42 queue). Reads the recent conversation (customer text, voice
// transcripts, image reading, staff replies with details/links), the customer's
// latest images and the branch inventory with cover photos, and returns:
// property(ies) / general / non_real_estate / unavailable / unclear.
// It only stores a suggestion on the pending queue items; it never links,
// replies to the customer or changes requests. Staff confirm in the CRM.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRM_COMPANY_ID = Deno.env.get("CRM_COMPANY_ID") ?? "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const META_GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") || "v25.0";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") || "gpt-5.6-luna";
const MEDIA_MAX_BYTES = 5 * 1024 * 1024;
const MAX_CUSTOMER_IMAGES = 2;
const MAX_PROPERTY_PHOTOS = 24;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" } });
}
const short = (v: unknown, max = 600) => { const s = String(v ?? "").trim(); return s.length > max ? s.slice(0, max) + "…" : s; };

function allowedMediaUrl(value: string) {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !u.username && !u.password && (!u.port || u.port === "443") &&
      (u.hostname === "graph.facebook.com" || u.hostname === "lookaside.fbsbx.com" || u.hostname.endsWith(".fbsbx.com") || u.hostname.endsWith(".fbcdn.net"));
  } catch { return false; }
}
async function boundedBytes(response: Response, maxBytes: number) {
  if (Number(response.headers.get("content-length") || 0) > maxBytes) { await response.body?.cancel(); throw new Error("media_size_limit"); }
  if (!response.body) throw new Error("media_unavailable");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error("media_size_limit"); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
function imageDataUrl(bytes: Uint8Array, mime: string) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return `data:${mime};base64,${btoa(binary)}`;
}
async function decryptMediaToken(ciphertext: string, iv: string, companyId: string, routeKey: string) {
  const decode = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
  const seed = new TextEncoder().encode(`${META_APP_SECRET}|${companyId}|${routeKey}|habib-crm-whatsapp-v1`);
  const digest = await crypto.subtle.digest("SHA-256", seed);
  const key = await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["decrypt"]);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(iv) }, key, decode(ciphertext)));
}
async function fetchCustomerImage(mediaId: string, tokens: string[]) {
  for (const token of tokens) {
    const options = { headers: { Authorization: `Bearer ${token}` }, redirect: "error" as const };
    const mr = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(mediaId)}`, { ...options, signal: AbortSignal.timeout(10000) });
    if (!mr.ok) { await mr.body?.cancel(); continue; }
    const metadata = JSON.parse(new TextDecoder().decode(await boundedBytes(mr, 65536)));
    const mime = String(metadata?.mime_type || "").toLowerCase();
    if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) return null;
    if (!allowedMediaUrl(String(metadata?.url || ""))) return null;
    const br = await fetch(String(metadata.url), { ...options, signal: AbortSignal.timeout(20000) });
    if (!br.ok) { await br.body?.cancel(); continue; }
    return imageDataUrl(await boundedBytes(br, MEDIA_MAX_BYTES), mime);
  }
  return null;
}
// Only public photos from this project's own storage are sent to the model.
function publicPropertyPhoto(value: unknown) {
  try {
    const u = new URL(String(value || ""));
    const base = new URL(SUPABASE_URL);
    return u.protocol === "https:" && u.host === base.host && u.pathname.startsWith("/storage/v1/object/public/property-images/") ? u.toString() : null;
  } catch { return null; }
}

const schema = {
  type: "object", additionalProperties: false,
  properties: {
    kind: { type: "string", enum: ["property", "general", "non_real_estate", "unavailable", "unclear"] },
    property_ids: { type: "array", maxItems: 10, items: { type: "string" } },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    reason: { type: "string" },
    evidence: { type: "array", maxItems: 6, items: { type: "string" } },
  },
  required: ["kind", "property_ids", "confidence", "reason", "evidence"],
};
const instructions = [
  "You help a real-estate office in Oman classify a WhatsApp conversation. Answer in Arabic in reason/evidence.",
  "links_in_conversation gives the caption of the office's own Instagram post for each link and, when known, the confirmed listing id; a confirmed id is strong evidence, and a caption with area/price/bedrooms can identify the listing.",
  "Decide what the CUSTOMER is asking about, using: customer text and voice transcripts, the text read from customer images, the customer images themselves compared with the inventory cover photos, links the customer sent, and the STAFF replies (staff often send the listing details, an Instagram link, or the location of the exact property the customer asked about).",
  "kind=property: the customer asks about one or more specific listings in the inventory. Return every matching inventory id (e.g. two villas in the same area at the same price are both returned). Only use ids from the inventory list.",
  "kind=unavailable: the listing they ask about is in the inventory but its status is sold or reserved, or staff told them it is no longer available. Return its id if known.",
  "kind=general: a search or budget request without a specific listing. kind=non_real_estate: job seekers, suppliers, personal or unrelated messages.",
  "kind=unclear: evidence is insufficient. Never guess from price or area alone when several listings fit and nothing else distinguishes them; then return all fitting ids with low confidence or unclear.",
  "confidence: 0.9+ only when there is explicit evidence (matching photo, exact link, staff sent that listing's details, unique area+price).",
].join("\n");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  try {
    const authHeader = req.headers.get("authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ ok: false, error: "missing_auth" }, 401);
    if (!OPENAI_API_KEY) return json({ ok: false, error: "ai_not_configured" }, 503);
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user) return json({ ok: false, error: "invalid_auth" }, 401);
    const { data: profile } = await admin.from("profiles").select("id,role,company_id,is_active").eq("id", userData.user.id).maybeSingle();
    if (!profile || profile.is_active === false || !["owner", "manager", "agent"].includes(String(profile.role))) return json({ ok: false, error: "not_allowed" }, 403);
    if (CRM_COMPANY_ID && profile.company_id !== CRM_COMPANY_ID) return json({ ok: false, error: "wrong_company" }, 403);
    const companyId = profile.company_id;
    const payload = await req.json().catch(() => ({}));

    const routesR = await admin.from("company_lead_routes").select("route_key,owner_only_inbox").eq("company_id", companyId);
    const ownerOnly = new Set((routesR.data || []).filter((r: any) => r.owner_only_inbox === true).map((r: any) => String(r.route_key)));

    async function suggest(conversationId: string) {
      // Caller RLS (branch separation) decides access before any read with the service key.
      const cr = await userClient.from("whatsapp_conversations").select("id,client_id,route_key,meta_phone_number_id")
        .eq("company_id", companyId).eq("id", conversationId).maybeSingle();
      if (cr.error || !cr.data) return { ok: false, error: "conversation_not_found" };
      if (profile.role !== "owner" && ownerOnly.has(String(cr.data.route_key || ""))) return { ok: false, error: "conversation_not_found" };
      const conversation = cr.data;
      const branch = conversation.route_key === "barka" ? ["barka"] : conversation.route_key === "muscat" ? ["muscat"] : ["muscat", "barka", "investment"];
      const [mr, pr, ur] = await Promise.all([
        admin.from("whatsapp_messages").select("id,direction,actor_type,message_type,body,transcript,property_image_analysis,media_id,message_timestamp")
          .eq("company_id", companyId).eq("conversation_id", conversationId).in("direction", ["inbound", "outbound"])
          .order("message_timestamp", { ascending: false }).limit(60),
        admin.from("properties").select("id,title,type,area,wilayat,price,bedrooms,status,branch_key,public_details,images,property_code")
          .eq("company_id", companyId).neq("archived", true).in("branch_key", branch).limit(120),
        admin.from("unmatched_property_links").select("id").eq("company_id", companyId).eq("conversation_id", conversationId).eq("status", "pending").limit(500),
      ]);
      if (mr.error || pr.error || ur.error) throw new Error("context_unavailable");
      const messages = (mr.data || []).reverse();
      const inventory = (pr.data || []).filter((p: any) => profile.role === "owner" || p.branch_key !== "investment");
      const transcript = messages.map((m: any) => {
        const who = m.direction === "inbound" ? "العميل" : m.actor_type === "automated" ? "الرد الآلي" : "الموظف";
        const parts = [short(m.body || m.transcript, 800)];
        const vision = m.property_image_analysis;
        if (m.message_type === "image") parts.push("[صورة]" + (vision?.visible_text ? " النص الظاهر: " + short(vision.visible_text, 400) : ""));
        return `${String(m.message_timestamp || "").slice(0, 16)} ${who}: ${parts.filter(Boolean).join(" ")}`;
      }).join("\n").slice(-12000);

      // Customer images: the latest few inbound photos, read through the same route credential as the inbox.
      const customerImages: string[] = [];
      const imageMessages = messages.filter((m: any) => m.direction === "inbound" && m.message_type === "image" && /^\d{1,40}$/.test(String(m.media_id || ""))).slice(-MAX_CUSTOMER_IMAGES);
      if (imageMessages.length) {
        const tokens: string[] = [];
        try {
          const physical = await admin.rpc("resolve_whatsapp_route", { p_company_id: companyId, p_meta_phone_number_id: String(conversation.meta_phone_number_id || "") });
          const route = Array.isArray(physical.data) ? physical.data[0] : physical.data;
          const credentialRoute = String(route?.route_key || "");
          if (["muscat", "barka"].includes(credentialRoute)) {
            const credential = await admin.from("whatsapp_route_credentials").select("token_ciphertext,token_iv,expires_at")
              .eq("company_id", companyId).eq("route_key", credentialRoute).maybeSingle();
            if (credential.data && META_APP_SECRET && (!credential.data.expires_at || Date.parse(credential.data.expires_at) > Date.now() + 60000))
              tokens.push(await decryptMediaToken(credential.data.token_ciphertext, credential.data.token_iv, companyId, credentialRoute));
          }
        } catch { /* fall back to the server credential */ }
        if (WHATSAPP_ACCESS_TOKEN && !tokens.includes(WHATSAPP_ACCESS_TOKEN)) tokens.push(WHATSAPP_ACCESS_TOKEN);
        for (const m of imageMessages) {
          try { const url = await fetchCustomerImage(String(m.media_id), tokens); if (url) customerImages.push(url); } catch { /* expired media */ }
        }
      }
      // Links in the conversation (customer or staff): any confirmed listing for that
      // post and, for the owner only (the catalog is owner-only), its caption.
      const codes = new Set<string>();
      for (const m of messages) for (const match of String(m.body || "").matchAll(/instagram\.com\/(?:[A-Za-z0-9_.]+\/)?(?:reel|reels|p|tv)\/([A-Za-z0-9_-]{5,40})/g)) codes.add("instagram:" + match[1]);
      let links: any[] = [];
      if (codes.size) {
        const keys = [...codes].slice(0, 40);
        const [cat, mk] = await Promise.all([
          profile.role === "owner"
            ? admin.from("instagram_media_catalog").select("link_key,caption,property_id,published_at").eq("company_id", companyId).in("link_key", keys)
            : Promise.resolve({ data: [] as any[] }),
          admin.from("property_marketing_events").select("link_key,property_id").eq("company_id", companyId).in("link_key", keys),
        ]);
        const mapped = new Map((mk.data || []).map((x: any) => [x.link_key, x.property_id]));
        links = keys.map(key => {
          const c = (cat.data || []).find((x: any) => x.link_key === key);
          const property = mapped.get(key) || c?.property_id || null;
          return { link: key, our_post_caption: c ? short(c.caption, 700) : null, confirmed_property_id: property && inventory.some((p: any) => p.id === property) ? property : null };
        });
      }
      const content: any[] = [{ type: "input_text", text: JSON.stringify({
        conversation: transcript,
        links_in_conversation: links,
        inventory: inventory.map((p: any) => ({ id: p.id, title: p.title, type: p.type, area: p.area, wilayat: p.wilayat, price: p.price, bedrooms: p.bedrooms,
          status: p.status, code: p.property_code, details: short(p.public_details, 300) })),
      }) }];
      for (const url of customerImages) { content.push({ type: "input_text", text: "صورة أرسلها العميل:" }); content.push({ type: "input_image", image_url: url, detail: "high" }); }
      if (customerImages.length) {
        let photos = 0;
        for (const p of inventory) {
          const photo = publicPropertyPhoto(Array.isArray(p.images) ? p.images[0] : null);
          if (!photo || photos >= MAX_PROPERTY_PHOTOS) continue;
          content.push({ type: "input_text", text: `صورة العقار id=${p.id}` }); content.push({ type: "input_image", image_url: photo, detail: "low" }); photos++;
        }
      }
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST", signal: AbortSignal.timeout(90000),
        headers: { authorization: `Bearer ${OPENAI_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ model: OPENAI_MODEL, store: false, reasoning: { effort: "low" }, instructions,
          input: [{ role: "user", content }], text: { format: { type: "json_schema", name: "inquiry_classification", strict: true, schema } } }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`ai_http_${response.status}`);
      const output = body?.output_text || body?.output?.flatMap((x: any) => x?.content || []).find((x: any) => x?.type === "output_text")?.text;
      if (!output) throw new Error("ai_empty");
      const parsed = JSON.parse(output);
      const known = new Set(inventory.map((p: any) => p.id));
      const suggestion = {
        kind: ["property", "general", "non_real_estate", "unavailable", "unclear"].includes(parsed.kind) ? parsed.kind : "unclear",
        property_ids: (Array.isArray(parsed.property_ids) ? parsed.property_ids : []).map(String).filter((id: string) => known.has(id)).slice(0, 10),
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
        reason: short(parsed.reason, 500),
        evidence: (Array.isArray(parsed.evidence) ? parsed.evidence : []).map((x: unknown) => short(x, 200)).slice(0, 6),
        images_compared: customerImages.length, model: OPENAI_MODEL, at: new Date().toISOString(),
      };
      if (suggestion.kind === "property" && !suggestion.property_ids.length) suggestion.kind = "unclear";
      const ids = (ur.data || []).map((x: any) => x.id);
      if (ids.length) {
        const up = await admin.from("unmatched_property_links").update({ ai_suggestion: suggestion, ai_checked_at: suggestion.at })
          .eq("company_id", companyId).eq("status", "pending").in("id", ids);
        if (up.error) throw new Error("suggestion_not_saved");
      }
      return { ok: true, conversation_id: conversationId, suggestion, stored_on: ids.length };
    }

    if (payload?.action === "batch") {
      if (profile.role !== "owner") return json({ ok: false, error: "owner_only" }, 403);
      const limit = Math.min(5, Math.max(1, Math.floor(Number(payload?.limit) || 5)));
      const q = await userClient.rpc("crm_attention_queue", { p_limit: 40, p_offset: 0 });
      if (q.error) throw new Error("queue_unavailable");
      const todo = (q.data?.items || []).filter((x: any) => !x.ai_suggestion && Number(x.pending_count) > 0).slice(0, limit);
      const results = [];
      for (const row of todo) {
        try { results.push(await suggest(String(row.conversation_id))); }
        catch (error) { results.push({ ok: false, conversation_id: row.conversation_id, error: String((error as any)?.message || error) }); }
      }
      return json({ ok: true, processed: results.length, results });
    }
    const conversationId = String(payload?.conversation_id || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(conversationId)) return json({ ok: false, error: "conversation_required" }, 400);
    const result = await suggest(conversationId);
    return json(result, result.ok ? 200 : 404);
  } catch (error) {
    console.error("[inquiry-ai-suggest]", String((error as any)?.message || error));
    return json({ ok: false, error: String((error as any)?.message || "failed") }, 500);
  }
});
