// Owner-only, read-only probe: what Meta returns for a public Instagram post or
// professional account that is not the connected @omanvilla account. Used to
// decide how external/collab links can be measured. Never posts or messages.
import { createClient } from "npm:@supabase/supabase-js@2";
const URL_ = Deno.env.get("SUPABASE_URL") ?? "", ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "", KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "", APP_ID = "1639659247753419";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...cors, "content-type": "application/json" } });
async function graph(path: string, token: string) {
  const r = await fetch("https://graph.facebook.com/v25.0/" + path, { headers: { Authorization: "Bearer " + token }, redirect: "error", signal: AbortSignal.timeout(20000) });
  const d = await r.json().catch(() => ({}));
  return r.ok ? { ok: true, data: d } : { ok: false, error: { code: d?.error?.code, sub: d?.error?.error_subcode, message: String(d?.error?.message || r.status).slice(0, 300) } };
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const auth = req.headers.get("authorization") || "";
  const user = createClient(URL_, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const admin = createClient(URL_, KEY, { auth: { persistSession: false } });
  const { data: u } = await user.auth.getUser();
  if (!u?.user) return json({ ok: false, error: "invalid_auth" }, 401);
  const { data: p } = await admin.from("profiles").select("role,company_id,is_active").eq("id", u.user.id).single();
  if (!p || p.role !== "owner" || !p.is_active) return json({ ok: false, error: "owner_only" }, 403);
  const body = await req.json().catch(() => ({}));
  const { data: a } = await admin.from("instagram_accounts").select("id,company_id,instagram_user_id").eq("company_id", p.company_id).eq("connection_status", "connected").limit(1).single();
  const { data: c } = await admin.from("instagram_account_credentials").select("token_ciphertext,token_iv").eq("account_id", a.id).single();
  const bytes = (s: string) => Uint8Array.from(atob(s), (x) => x.charCodeAt(0));
  const seed = new TextEncoder().encode(`${APP_SECRET}|${a.company_id}|${a.id}|habib-crm-instagram-v1`);
  const key = await crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", seed), { name: "AES-GCM" }, false, ["decrypt"]);
  const token = new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(c.token_iv) }, key, bytes(c.token_ciphertext)));
  const out: Record<string, unknown> = {};
  const username = String(body?.username || "").replace(/[^A-Za-z0-9_.]/g, "");
  const shortcode = String(body?.shortcode || "").replace(/[^A-Za-z0-9_-]/g, "");
  if (body?.url) out.oembed = await graph("instagram_oembed?fields=author_name,author_url&url=" + encodeURIComponent(String(body.url)), APP_ID + "|" + APP_SECRET);
  out.pages = await graph("me?fields=id,name,instagram_business_account{id,username}", token);
  if (username) {
    for (const fields of ["id,permalink,shortcode,like_count,comments_count,view_count,timestamp,media_product_type", "id,permalink,like_count,comments_count,timestamp,media_product_type"]) {
      const r: any = await graph(`${a.instagram_user_id}?fields=business_discovery.username(${username}){username,followers_count,media_count,media.limit(100){${fields}}}`, token);
      out["discovery:" + fields.includes("view_count")] = r.ok ? { ok: true, username: r.data?.business_discovery?.username, media_count: r.data?.business_discovery?.media_count,
        match: (r.data?.business_discovery?.media?.data || []).find((m: any) => String(m.permalink || "").includes(shortcode)) || null,
        sample_keys: Object.keys(r.data?.business_discovery?.media?.data?.[0] || {}) } : r;
    }
  }
  if (body?.media_id) out.collab_media = await graph(String(body.media_id).replace(/\D/g, "") + "?fields=id,owner,username,permalink", token);
  return json({ ok: true, out });
});
