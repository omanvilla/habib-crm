// The owner records a voice note in the CRM (a note for Claude, or an instruction to the reply agent)
// and gets it back as text. Owner only; the audio is not stored.
import { createClient } from "npm:@supabase/supabase-js@2";
import { VOICE_VOCAB } from "../_shared/voice.ts";
const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false, autoRefreshToken: false } });
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const MODEL = Deno.env.get("OPENAI_TRANSCRIBE_MODEL_V2") || "gpt-4o-transcribe";
const FALLBACK = "gpt-4o-mini-transcribe";
const ALLOWED_ORIGINS = ["https://omanvilla.github.io"];
Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const headers = { "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0], "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin", "content-type": "application/json; charset=utf-8" };
  const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers });
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ ok: false }, 405);
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const u = jwt ? await db.auth.getUser(jwt) : null;
  const prof = u?.data?.user ? await db.from("profiles").select("role,is_active").eq("id", u.data.user.id).maybeSingle() : null;
  if (!prof?.data || prof.data.role !== "owner" || prof.data.is_active === false) return json({ ok: false, error: "owner_only" }, 403);
  const body = await req.json().catch(() => ({}));
  const b64 = String(body?.audio || "");
  const mime = String(body?.mime || "audio/webm").split(";")[0];
  if (!b64 || b64.length > 14_000_000) return json({ ok: false, error: "audio_missing_or_too_long" }, 400);
  const bin = atob(b64); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac") ? "m4a" : mime.includes("ogg") ? "ogg" : mime.includes("wav") ? "wav" : mime.includes("mpeg") ? "mp3" : "webm";
  const NOTE_VOCAB = VOICE_VOCAB + " ملاحظة من أحمد وسيط عقاري عن ردود الواتساب للعملاء: فلل الشخاخيط، فيلا الشاعر، مدينة السلطان هيثم، وادي زها، العقل، الرد الآلي، متابعة اليوم، مستثمر، تنازل.";
  const run = async (model: string) => {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: mime }), `note.${ext}`);
    form.append("model", model);
    form.append("prompt", NOTE_VOCAB.slice(0, 900));
    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }, body: form });
    const p = await r.json().catch(() => ({}));
    return { r, p };
  };
  let { r, p } = await run(MODEL);
  if (!r.ok || !p?.text) ({ r, p } = await run(FALLBACK));
  if (!r.ok || !p?.text) return json({ ok: false, error: p?.error?.message || `transcribe_${r.status}` }, 502);
  return json({ ok: true, text: String(p.text).trim() });
});
