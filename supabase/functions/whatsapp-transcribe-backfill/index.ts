// Turns old WhatsApp voice notes into text so the reply agent (and owner reviews) can read them.
// Server-to-server only: requires the same x-crm-agent secret as the reply agent. Never sends anything.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const TRANSCRIBE_MODEL = Deno.env.get("OPENAI_TRANSCRIBE_MODEL") || "gpt-4o-mini-transcribe";
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

// returns text, or a reason string prefixed with "!" when it could not be done
async function transcribe(tokens: string[], mediaId: string): Promise<string> {
  let reason = "!media_unavailable";
  for (const t of tokens) {
    try {
      const metaR = await fetch(`https://graph.facebook.com/${GRAPH}/${mediaId}`, { headers: { Authorization: `Bearer ${t}` } });
      const meta = await metaR.json().catch(() => ({}));
      if (!metaR.ok || !meta?.url) continue;
      const fileR = await fetch(meta.url, { headers: { Authorization: `Bearer ${t}` } });
      if (!fileR.ok) continue;
      const blob = await fileR.blob();
      const mime = meta.mime_type || blob.type || "audio/ogg";
      const ext = mime.includes("mpeg") ? "mp3" : mime.includes("mp4") ? "m4a" : mime.includes("wav") ? "wav" : "ogg";
      const form = new FormData();
      form.append("file", blob, `voice.${ext}`);
      form.append("model", TRANSCRIBE_MODEL);
      form.append("language", "ar");
      form.append("response_format", "json");
      const tr = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }, body: form });
      const p = await tr.json().catch(() => ({}));
      if (tr.ok && p?.text) return String(p.text).trim().slice(0, 4000);
      reason = "!transcription_failed";
    } catch (e) { reason = "!" + String((e as any)?.message || e).slice(0, 200); }
  }
  return reason;
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
    .or("transcription_status.is.null,transcription_status.not.in.(completed,failed)")
    .order("message_timestamp", { ascending: false }).limit(limit);
  if (convIds.length) q = q.in("conversation_id", convIds);
  const rows = await q;
  if (rows.error) return json({ ok: false, error: rows.error.message }, 500);

  let done = 0, failed = 0;
  for (const m of rows.data || []) {
    const routeKey = (m as any).whatsapp_conversations?.route_key;
    const text = await transcribe(await routeTokens(m.company_id, routeKey), m.media_id);
    if (text.startsWith("!")) {
      failed++;
      await db.from("whatsapp_messages").update({ transcription_status: "failed" }).eq("id", m.id);
      console.warn("[transcribe-backfill]", m.id, text);
    } else {
      done++;
      await db.from("whatsapp_messages").update({ transcript: text, transcription_status: "completed" }).eq("id", m.id);
    }
  }
  return json({ ok: true, picked: (rows.data || []).length, done, failed });
});
