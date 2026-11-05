// Daily follow-ups (owner's decisions, 5 Nov 2026). Called by cron with the reply-agent secret.
// 1. Writes a personal text for each waiting follow-up, which the owner sends from the branch phone.
// 2. What he has not sent by 10am the next day goes out by itself, 20 a day at most: a UTILITY template, or free
//    text inside the 24 hour window. Anything that would cost a MARKETING template keeps waiting for him.
// Stops when whatsapp_automation_runtime.visit_followups_auto is false. A failed send stays on the list.
import { createClient } from "npm:@supabase/supabase-js@2";

const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const OPENAI_MODEL = Deno.env.get("REPLY_AGENT_MODEL") || Deno.env.get("OPENAI_MODEL") || "gpt-5.6-luna";
const GRAPH = Deno.env.get("META_GRAPH_VERSION") || "v25.0";
const WINDOW_MS = 24 * 3600 * 1000;
const DAILY_LIMIT = 20, DRAFTS_PER_RUN = 12;

const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const enc = new TextEncoder();
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json; charset=utf-8" } });
const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const short = (v: unknown, n = 500) => { const s = String(v ?? "").trim(); return s.length > n ? s.slice(0, n) + "…" : s; };
function b64(s: string) { const b = atob(s); const o = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) o[i] = b.charCodeAt(i); return o; }
// due at 10am Muscat on the day after it was prepared
function autoAfter(created: string) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Muscat" }).format(new Date(created));
  return new Date(new Date(`${day}T10:00:00+04:00`).getTime() + 24 * 3600 * 1000).getTime();
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
  } catch (e) { console.error("[followup-auto] credential", String((e as any)?.message || e)); }
  if (WHATSAPP_ACCESS_TOKEN && !out.includes(WHATSAPP_ACCESS_TOKEN)) out.push(WHATSAPP_ACCESS_TOKEN);
  return out;
}

async function metaSend(tokens: string[], phoneId: string, to: string, payload: any) {
  let last = "meta_send_failed";
  for (const t of tokens) {
    const r = await fetch(`https://graph.facebook.com/${GRAPH}/${phoneId}/messages`, {
      method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, ...payload }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) return d?.messages?.[0]?.id || null;
    last = short(d?.error?.message || `HTTP ${r.status}`, 300);
    console.error("[followup-auto] meta", r.status, JSON.stringify(d).slice(0, 400));
  }
  throw new Error(last);
}

const DRAFT_RULES = `تكتب رسالة متابعة واتساب واحدة يرسلها صاحب مكتب عقاري في عمان بنفسه لعميل، باللهجة العمانية البسيطة.
تبدأ بـ "السلام عليكم". سطر أو سطرين بس، وسؤال واحد ينتهي بـ " ؟".
استخدم اللي قدامك من المحادثة عشان تكون خاصة بهذا العميل: العقار أو المنطقة أو آخر كلام قاله. لا تخترع شي مو مكتوب.
إذا ما نعرف هل زار فعلاً، اسأل هل قدر يشوف العقار. إذا مرت فترة طويلة، اسأل هل لين الحين يبحث عن عقار.
ممنوع: الفواصل والنقاط وعلامات التعجب، الأسعار، التفاوض، الوعود، الأسماء، كلمة هلا.
رجّع نص الرسالة بس.`;

async function writeOwnerText(item: any, reason: string, about: string) {
  const hist = item.conversation_id
    ? await db.from("whatsapp_messages").select("direction,body,transcript,message_type").eq("conversation_id", item.conversation_id).order("message_timestamp", { ascending: false }).limit(10)
    : { data: [] as any[] };
  const lines = ((hist as any).data || []).reverse().map((m: any) => `${m.direction === "inbound" ? "العميل" : "المكتب"}: ${short(m.transcript || m.body || `[${m.message_type}]`, 250)}`).join("\n");
  const ai = await fetch("https://api.openai.com/v1/responses", {
    method: "POST", headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: OPENAI_MODEL, store: false, reasoning: { effort: "low" }, instructions: DRAFT_RULES, input: `سبب المتابعة: ${reason}\n${about}\nآخر المحادثة:\n${lines || "ما في محادثة مسجلة"}` }),
  });
  const p = await ai.json().catch(() => ({}));
  if (!ai.ok) throw new Error(p?.error?.message || `openai_${ai.status}`);
  const text = String(p.output_text || p.output?.flatMap((x: any) => x?.content || []).find((x: any) => x?.type === "output_text")?.text || "").trim();
  return text.replace(/[،,!]/g, " ").replace(/\.(\s|$)/g, "$1").replace(/\s*[؟?]/g, " ؟").replace(/[ \t]+/g, " ").trim();
}

async function writeDrafts(companyId: string) {
  let done = 0;
  const f = await db.from("whatsapp_visit_followups").select("id,conversation_id,viewing_id,step").eq("company_id", companyId).eq("status", "awaiting_approval").is("owner_text", null).limit(DRAFTS_PER_RUN);
  for (const x of f.data || []) {
    try {
      const v = await db.from("viewings").select("viewing_date,status,properties(type,area)").eq("id", x.viewing_id).maybeSingle();
      const pr: any = (v.data as any)?.properties;
      const about = `العقار: ${pr?.type || "عقار"} في ${pr?.area || "غير معروف"}. موعد الزيارة: ${v.data?.viewing_date || "غير معروف"}. ${v.data?.status === "done" ? "الزيارة تمت" : "ما نعرف هل زار"}.`;
      const text = await writeOwnerText(x, `متابعة بعد الزيارة، الخطوة ${x.step}`, about);
      if (text) { await db.from("whatsapp_visit_followups").update({ owner_text: short(text, 400) }).eq("id", x.id); done++; }
    } catch (e) { console.error("[followup-auto] draft", String((e as any)?.message || e)); }
  }
  const left = DRAFTS_PER_RUN - done;
  if (left <= 0) return done;
  const q = await db.from("whatsapp_outreach_queue").select("id,conversation_id,template_params").eq("company_id", companyId).eq("status", "pending").eq("kind", "request_followup").eq("dry_run", false).is("owner_text", null).limit(left);
  for (const x of q.data || []) {
    try {
      const text = await writeOwnerText(x, "متابعة طلب: هل لين الحين يبحث", `طلبه: ${(x.template_params || [])[0] || "غير محدد"}.`);
      if (text) { await db.from("whatsapp_outreach_queue").update({ owner_text: short(text, 400) }).eq("id", x.id); done++; }
    } catch (e) { console.error("[followup-auto] draft", String((e as any)?.message || e)); }
  }
  return done;
}

async function sendOne(f: any, numbers: string[]) {
  const stop = async (status: string, why: string) => { await db.from("whatsapp_visit_followups").update({ status, error: why, updated_at: new Date().toISOString() }).eq("id", f.id).eq("status", "awaiting_approval"); return why; };
  const [convR, clientR, lastInR, tplR] = await Promise.all([
    db.from("whatsapp_conversations").select("*").eq("id", f.conversation_id).single(),
    db.from("clients").select("id,phone,phone_normalized,followup_suppressed,archived").eq("id", f.client_id).single(),
    db.from("whatsapp_messages").select("message_timestamp").eq("conversation_id", f.conversation_id).eq("direction", "inbound").order("message_timestamp", { ascending: false }).limit(1).maybeSingle(),
    db.from("whatsapp_template_registry").select("status,category").eq("company_id", f.company_id).eq("route_key", f.route_key).eq("template_name", f.template_name).maybeSingle(),
  ]);
  const conv = convR.data, client = clientR.data;
  if (!conv || !client) return "context_missing";
  const to = digits(client.phone_normalized || client.phone);
  // the two company numbers never message each other
  if (!to || numbers.includes(to)) return stop("rejected", "company_number");
  if (!["barka", "muscat"].includes(conv.route_key) || conv.route_key !== f.route_key) return "route_blocked";
  if (client.followup_suppressed || client.archived || conv.agent_muted || conv.human_handoff_required) return "held";
  const lastIn = lastInR.data?.message_timestamp ? new Date(lastInR.data.message_timestamp).getTime() : 0;
  if (lastIn > new Date(f.created_at).getTime()) return stop("superseded", "client_wrote_after");
  const service = lastIn > 0 && Date.now() - lastIn < WINDOW_MS;
  const tpl = tplR.data;
  const utility = String(tpl?.status || "").toUpperCase() === "APPROVED" && String(tpl?.category || "").toUpperCase() === "UTILITY";
  if (!service && !utility) return "waits_for_utility_template";
  const claim = await db.from("whatsapp_visit_followups").update({ status: "sending" }).eq("id", f.id).eq("status", "awaiting_approval").select("id").maybeSingle();
  if (claim.error || !claim.data) return "taken";
  const payload = service
    ? { type: "text", text: { preview_url: false, body: f.body } }
    : { type: "template", template: { name: f.template_name, language: { code: "ar" } } };
  const now = new Date().toISOString();
  try {
    const wamid = await metaSend(await routeTokens(f.company_id, f.route_key), digits(conv.meta_phone_number_id), to, payload);
    if (wamid) await db.from("whatsapp_messages").insert({
      company_id: f.company_id, conversation_id: conv.id, client_id: f.client_id, whatsapp_message_id: wamid,
      direction: "outbound", message_type: service ? "text" : "template", sender_wa_id: digits(conv.meta_phone_number_id), recipient_wa_id: to,
      body: f.body, message_timestamp: now, delivery_status: "sent", actor_type: "automated", channel_source: "crm_followup",
      raw_payload: { source: "visit_followup", followup_id: f.id, step: f.step, viewing_id: f.viewing_id, template_name: service ? null : f.template_name, auto: true },
    });
    await db.from("whatsapp_visit_followups").update({ status: "sent", send_mode: service ? "service" : "template", sent_at: now, meta_message_id: wamid, decided_at: now, error: null, updated_at: now }).eq("id", f.id);
    await db.from("whatsapp_conversations").update({ last_message_at: now, last_outbound_at: now, updated_at: now }).eq("id", conv.id);
    return "sent";
  } catch (e) {
    // stays on the list; a billing problem must not lose the follow-up
    const why = short((e as any)?.message || e);
    await db.from("whatsapp_visit_followups").update({ status: "awaiting_approval", error: why, updated_at: now }).eq("id", f.id);
    await alertOwner(f.company_id, why);
    return "failed";
  }
}

async function alertOwner(companyId: string, why: string) {
  const title = "الإرسال التلقائي للمتابعات فشل";
  const o = await db.from("profiles").select("id").eq("company_id", companyId).eq("role", "owner").eq("is_active", true).limit(1).maybeSingle();
  if (!o.data) return;
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const seen = await db.from("notifications").select("id").eq("user_id", o.data.id).eq("title", title).gte("created_at", since).limit(1);
  if ((seen.data || []).length) return;
  await db.from("notifications").insert({ user_id: o.data.id, type: "system_alert", is_read: false, link: "dash", title, body: short(`تأكد من طريقة الدفع في Meta Billing Hub. الرسالة: ${why}`, 400) });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false }, 405);
  const ok = await db.rpc("crm_reply_agent_secret_ok", { p_secret: req.headers.get("x-crm-agent") || "" });
  if (ok.error || ok.data !== true) return json({ ok: false, error: "forbidden" }, 403);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Muscat", hour: "2-digit", hour12: false }).format(new Date()));
  if (hour < 9 || hour >= 21) return json({ ok: true, reason: "outside_hours" });
  const rts = await db.from("whatsapp_automation_runtime").select("company_id,mode,visit_followups_auto");
  const out: Record<string, number> = {};
  const routes = await db.from("company_lead_routes").select("whatsapp_number");
  const numbers = (routes.data || []).map((r: any) => digits(r.whatsapp_number)).filter(Boolean);
  for (const rt of rts.data || []) {
    if (rt.mode !== "live") continue;
    out.drafts = (out.drafts || 0) + await writeDrafts(rt.company_id);
    if (!rt.visit_followups_auto) continue;
    const dayStart = new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Muscat" }).format(new Date())}T00:00:00+04:00`).toISOString();
    const sentF = await db.from("whatsapp_visit_followups").select("id", { count: "exact", head: true }).eq("company_id", rt.company_id).in("send_mode", ["template", "service"]).gte("sent_at", dayStart);
    const relQ = await db.from("whatsapp_outreach_queue").select("id", { count: "exact", head: true }).eq("company_id", rt.company_id).eq("kind", "request_followup").eq("reason", "auto_after_wait").gte("approved_at", dayStart);
    let room = DAILY_LIMIT - (sentF.count || 0) - (relQ.count || 0);
    const list = await db.from("whatsapp_visit_followups").select("*").eq("company_id", rt.company_id).eq("status", "awaiting_approval").order("due_at").limit(60);
    const waiting = new Set((list.data || []).map((f: any) => f.client_id));
    let failed = false;
    for (const f of list.data || []) {
      if (room <= 0 || failed) break;
      if (Date.now() < autoAfter(f.created_at)) continue;
      const r = await sendOne(f, numbers);
      out[r] = (out[r] || 0) + 1;
      if (r === "failed") failed = true;
      if (r === "sent") { room--; await new Promise((x) => setTimeout(x, 1500)); }
    }
    if (failed || room <= 0) continue;
    // request follow-ups are sent by whatsapp-outreach once approved; only with an approved UTILITY template and a chat
    const reg = await db.from("whatsapp_template_registry").select("route_key,template_name,status,category").eq("company_id", rt.company_id);
    const usable = new Set((reg.data || []).filter((t: any) => String(t.status).toUpperCase() === "APPROVED" && String(t.category).toUpperCase() === "UTILITY").map((t: any) => `${t.route_key}|${t.template_name}`));
    const qs = await db.from("whatsapp_outreach_queue").select("id,client_id,route_key,template_name,created_at,conversation_id").eq("company_id", rt.company_id).eq("status", "pending").eq("kind", "request_followup").eq("dry_run", false).order("created_at").limit(60);
    for (const q of qs.data || []) {
      if (room <= 0) break;
      if (waiting.has(q.client_id) || !q.conversation_id || Date.now() < autoAfter(q.created_at) || !usable.has(`${q.route_key}|${q.template_name}`)) continue;
      await db.from("whatsapp_outreach_queue").update({ status: "approved", approved_at: new Date().toISOString(), reason: "auto_after_wait" }).eq("id", q.id).eq("status", "pending");
      out.released = (out.released || 0) + 1; room--;
    }
  }
  return json({ ok: true, results: out });
});
