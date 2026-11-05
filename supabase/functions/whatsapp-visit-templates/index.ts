// Submits the four visit follow-up templates (SQL54) to Meta for the Barka and Muscat numbers,
// or refreshes their approval status, and keeps whatsapp_template_registry in step.
// Only these fixed texts can be created here (approved by the owner on 2 Nov and 5 Nov 2026); nothing is
// sent to customers. Called with the reply-agent secret (x-crm-agent), e.g. from SQL net.http_post.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CID = Deno.env.get("CRM_COMPANY_ID") ?? "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const GRAPH = Deno.env.get("META_GRAPH_VERSION") || "v25.0";

const TEMPLATES: Record<string, string> = {
  visit_followup_1_ar_v1: "بخصوص الزيارة قدرت تشوف العقار ؟ كيف لقيته ؟",
  visit_followup_2_ar_v1: "اذا العقار ما ناسبك خبرني ايش اللي تدور عليه بالضبط عشان اشوف لك شي يناسبك",
  visit_followup_3_ar_v1: "لين الحين تدور على عقار ؟ اذا تحب برسلك المتوفر عندنا الحين",
  visit_followup_4_ar_v1: "اذا لين الحين ما حصلت اللي يناسبك خبرني وبشوف لك الجديد اول ما يتوفر",
  // Meta rated versions 1 of steps 2 to 4 as MARKETING. These ask about the visit or request only (SQL60).
  visit_followup_2_ar_v2: "بخصوص زيارتك الاخيرة للعقار هل عندك ملاحظة عليه ؟",
  visit_followup_3_ar_v2: "بخصوص زيارتك الاخيرة للعقار هل وصلت لقرار ؟",
  visit_followup_4_ar_v2: "نراجع طلبك المسجل عندنا هل طلبك لين الحين قائم ؟",
};

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const enc = new TextEncoder();
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json; charset=utf-8" } });
const short = (v: unknown, n = 300) => { const s = String(v ?? "").trim(); return s.length > n ? s.slice(0, n) + "…" : s; };
function b64(s: string) { const b = atob(s); const o = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) o[i] = b.charCodeAt(i); return o; }

async function route(rk: string) {
  const a = await db.from("company_lead_routes").select("route_key,meta_waba_id").eq("company_id", CID).eq("route_key", rk).eq("is_active", true).maybeSingle();
  if (a.error || !a.data?.meta_waba_id) return null;
  const c = await db.from("whatsapp_route_credentials").select("token_ciphertext,token_iv,expires_at").eq("company_id", CID).eq("route_key", rk).maybeSingle();
  if (c.error || !c.data || (c.data.expires_at && new Date(c.data.expires_at).getTime() <= Date.now() + 60000)) return null;
  const key = await crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", enc.encode(`${META_APP_SECRET}|${CID}|${rk}|habib-crm-whatsapp-v1`)), { name: "AES-GCM" }, false, ["decrypt"]);
  const token = new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(c.data.token_iv) }, key, b64(c.data.token_ciphertext)));
  return { waba: String(a.data.meta_waba_id), token };
}

async function find(r: any, name: string) {
  const q = await fetch(`https://graph.facebook.com/${GRAPH}/${r.waba}/message_templates?name=${encodeURIComponent(name)}&fields=name,status,category,language,id`, { headers: { Authorization: `Bearer ${r.token}` } });
  const p = await q.json().catch(() => ({}));
  if (!q.ok) throw new Error(short(p?.error?.message || `HTTP ${q.status}`));
  return (p.data || []).find((t: any) => t.name === name && String(t.language).toLowerCase().startsWith("ar")) || null;
}

async function record(rk: string, waba: string, name: string, t: any, error: string | null) {
  const row = { company_id: CID, route_key: rk, waba_id: waba, template_name: name, language: "ar", template_id: t?.id || null,
    status: t ? String(t.status || "PENDING").toUpperCase() : "ERROR", category: t?.category || "UTILITY", last_error: error,
    last_checked_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  const r = await db.from("whatsapp_template_registry").upsert(row, { onConflict: "company_id,route_key,template_name,language" });
  if (r.error) throw new Error(r.error.message);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false }, 405);
  const ok = await db.rpc("crm_reply_agent_secret_ok", { p_secret: req.headers.get("x-crm-agent") || "" });
  if (ok.error || ok.data !== true) return json({ ok: false, error: "forbidden" }, 403);
  const { action } = await req.json().catch(() => ({}));
  if (!["create", "status"].includes(action)) return json({ ok: false, error: "action_must_be_create_or_status" }, 400);
  const out: any[] = [];
  for (const rk of ["barka", "muscat"]) {
    let r: any = null;
    try { r = await route(rk); } catch (e) { out.push({ route: rk, error: short((e as any)?.message || e) }); continue; }
    if (!r) { out.push({ route: rk, error: "route_not_ready" }); continue; }
    for (const [name, text] of Object.entries(TEMPLATES)) {
      try {
        let t = await find(r, name);
        let err: string | null = null;
        if (!t && action === "create") {
          const q = await fetch(`https://graph.facebook.com/${GRAPH}/${r.waba}/message_templates`, {
            method: "POST", headers: { Authorization: `Bearer ${r.token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ name, language: "ar", category: "UTILITY", components: [{ type: "BODY", text }] }),
          });
          const p = await q.json().catch(() => ({}));
          if (q.ok) t = { id: p.id, status: p.status || "PENDING", category: p.category || "UTILITY" };
          else err = short(p?.error?.error_user_msg || p?.error?.message || `HTTP ${q.status}`);
        }
        await record(rk, r.waba, name, t, err);
        out.push({ route: rk, name, status: t ? String(t.status).toUpperCase() : (err ? "ERROR" : "MISSING"), category: t?.category || null, error: err });
      } catch (e) { out.push({ route: rk, name, error: short((e as any)?.message || e) }); }
    }
  }
  return json({ ok: true, action, results: out });
});
