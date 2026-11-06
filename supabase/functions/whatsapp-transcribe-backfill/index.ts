// Turns old WhatsApp voice notes into text so the reply agent (and owner reviews) can read them.
// Server-to-server only: requires the same x-crm-agent secret as the reply agent. Never sends anything.
import { createClient } from "npm:@supabase/supabase-js@2";
import { transcribeVoice } from "../_shared/voice.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const GRAPH = Deno.env.get("META_GRAPH_VERSION") || "v25.0";
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const enc = new TextEncoder();
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json; charset=utf-8" } });
function b64(s: string) { const b = atob(s); const o = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) o[i] = b.charCodeAt(i); return o; }

const tokenCache: Record<string, string[]> = {};
async function routeTokens(companyId: string, routeKey: string) {
  const k = companyId + "|" + routeKey;
  if (tokenCache[k]) return tokenCache[k];
  const out: string[] = [];
  try {
    const c = await db.from("whatsapp_route_credentials").select("token_ciphertext,token_iv,expires_at").eq("company_id", companyId).eq("route_key", routeKey).maybeSingle();
    if (c.data && (!c.data.expires_at || new Date(c.data.expires_at).getTime() > Date.now() + 60000)) {
      const seed = enc.encode(`${META_APP_SECRET}|${companyId}|${routeKey}|habib-crm-whatsapp-v1`);
      const key = await crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", seed), { name: "AES-GCM" }, false, ["decrypt"]);
      out.push(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(c.data.token_iv) }, key, b64(c.data.token_ciphertext))));
    }
  } catch (e) { console.error("[transcribe-backfill] credential", String((e as any)?.message || e)); }
  if (WHATSAPP_ACCESS_TOKEN && !out.includes(WHATSAPP_ACCESS_TOKEN)) out.push(WHATSAPP_ACCESS_TOKEN);
  return (tokenCache[k] = out);
}

async function contextFor(conversationId: string, mediaMessageId: string) {
  const cur = await db.from("whatsapp_messages").select("message_timestamp").eq("id", mediaMessageId).maybeSingle();
  const h = await db.from("whatsapp_messages").select("direction,message_type,body,transcript").eq("conversation_id", conversationId)
    .lt("message_timestamp", (cur.data as any)?.message_timestamp || new Date().toISOString()).order("message_timestamp", { ascending: false }).limit(8);
  return (h.data || []).reverse().map((x: any) => `${x.direction === "inbound" ? "العميل" : "المكتب"}: ${String(x.transcript || x.body || `[${x.message_type}]`).slice(0, 300)}`).join("\n");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false }, 405);
  const secret = req.headers.get("x-crm-agent") || "";
  const ok = secret ? await db.rpc("crm_reply_agent_secret_ok", { p_secret: secret }) : null;
  if (!ok || ok.error || ok.data !== true) return json({ ok: false, error: "forbidden" }, 403);
  const body = await req.json().catch(() => ({}));
  const limit = Math.min(Math.max(Number(body?.limit) || 20, 1), 40);
  const convIds: string[] = Array.isArray(body?.conversation_ids) ? body.conversation_ids.map(String).slice(0, 200) : [];

  let q = db.from("whatsapp_messages").select("id,company_id,conversation_id,media_id,whatsapp_conversations!inner(route_key)")
    .eq("message_type", "audio").is("transcript", null).not("media_id", "is", null)
    // SQL68: voice notes on the owner's private line are not sent for transcription.
    .neq("whatsapp_conversations.route_key", "owner")
    .or("transcription_status.is.null,transcription_status.not.in.(completed,failed)")
    .order("message_timestamp", { ascending: false }).limit(limit);
  if (convIds.length) q = q.in("conversation_id", convIds);
  const rows = await q;
  if (rows.error) return json({ ok: false, error: rows.error.message }, 500);

  let done = 0, failed = 0;
  for (const m of rows.data || []) {
    const routeKey = (m as any).whatsapp_conversations?.route_key;
    const v = await transcribeVoice(await routeTokens(m.company_id, routeKey), m.media_id, GRAPH, await contextFor(m.conversation_id, m.id));
    if (!v) {
      failed++;
      await db.from("whatsapp_messages").update({ transcription_status: "failed" }).eq("id", m.id);
      console.warn("[transcribe-backfill]", m.id, "unavailable");
    } else {
      done++;
      const cur = await db.from("whatsapp_messages").select("automation_result").eq("id", m.id).maybeSingle();
      const ar = { ...((cur.data as any)?.automation_result || {}), voice: { raw: v.raw, model: v.model, unclear: v.unclear, at: new Date().toISOString() } };
      await db.from("whatsapp_messages").update({ transcript: v.unclear ? `${v.text} (الصوت مو واضح كامل)` : v.text, transcription_status: "completed", automation_result: ar }).eq("id", m.id);
    }
  }
  return json({ ok: true, picked: (rows.data || []).length, done, failed });
});
