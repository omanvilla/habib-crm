// Daily follow-ups (owner's decisions, 5 Nov 2026). Called by cron with the reply-agent secret.
// 1. Reads each waiting follow-up's whole chat, voice notes included. It either writes a text for this client to send
//    from the branch phone, removes it (owner offering, moved to the other branch, topic closed), or saves what the client wants.
// 2. What he has not sent by 10am the next day goes out by itself, 20 a day at most, only if the review says the fixed
//    text fits: a UTILITY template, or free text inside the 24 hour window. MARKETING cost keeps waiting for him.
// Stops when whatsapp_automation_runtime.visit_followups_auto is false. A failed send stays on the list.
import { createClient } from "npm:@supabase/supabase-js@2";

const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const OPENAI_MODEL = Deno.env.get("REPLY_AGENT_MODEL") || Deno.env.get("OPENAI_MODEL") || "gpt-5.6-luna";
const GRAPH = Deno.env.get("META_GRAPH_VERSION") || "v25.0";
const WINDOW_MS = 24 * 3600 * 1000;
const DAILY_LIMIT = 20, REVIEWS_PER_RUN = 24, REVIEWS_AT_ONCE = 6;

const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const enc = new TextEncoder();
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json; charset=utf-8" } });
const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const short = (v: unknown, n = 500) => { const s = String(v ?? "").trim(); return s.length > n ? s.slice(0, n) + "…" : s; };
function b64(s: string) { const b = atob(s); const o = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) o[i] = b.charCodeAt(i); return o; }
// due at 10am Muscat on the day after it reached his list (the review puts it there)
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

const REVIEW_RULES = `أنت تراجع متابعة عميل لمكتب عقاري في عمان قبل ما يرسلها صاحب المكتب. اقرأ المحادثة كاملة، ومحادثة الرقم الثاني إذا موجودة، وقرر واحد:
- skip: ما يحتاج متابعة. مثل: مالك أو وسيط يعرض عقار أو بناية، أو حولناه للرقم الثاني أو موضوعه ماشي هناك، أو موضوعه انتهى، أو اشترى أو حصل، أو قال ما يبغى، أو مو عميل يدور عقار (موظف، بنك، شركة، مقاول).
- wait_for_match: شاف أو سأل ووضح اللي يبغاه، وما عندنا الحين شي يناسبه. سؤال "لين الحين تبحث" ما له داعي. مثال: شاف فيلا وسأل عن السعر النهائي وقال ما يناسبه قيد الإنشاء ويدور جاهز. احفظ اللي يبغاه في request، ونرسله لما يتوفر.
- followup: في سبب حقيقي نتابعه. إذا في القائمة عقار متاح يطابق اللي يبغاه، اعرضه في text باختصار.

التفاوض لصاحب المكتب بس: لا تفتح موضوع السعر ولا تخفيض في text.
إذا فيه "[رسالة صوتية قديمة ما انقرت]" قريب من آخر المحادثة، ما تعرف اللي انقال فيها: لا تخمن، قل هذا في reason، وخل auto_ok=false.

text (لـ followup بس): رسالة واحدة يرسلها صاحب المكتب بنفسه باللهجة العمانية البسيطة. إذا واضح من الاسم أو الكلام إنها امرأة خاطبها بالمؤنث. تبدأ بـ "السلام عليكم". سطر أو سطرين، خاصة بهذا العميل، وسؤال واحد ينتهي بـ " ؟". لا تكرر سؤال انجاب عليه. لا تخترع شي مو مكتوب. ممنوع: الفواصل والنقاط وعلامات التعجب، الأسعار إلا سعر عقار تعرضه، الوعود، كلمة هلا.
reason: سطر قصير لصاحب المكتب يوضح وضع العميل، مثل "شاف فيلا الرميس وما عجبه الموقع".
auto_ok: true بس إذا النص الثابت "${"{fixed}"}" مناسب لهذا العميل لو انرسل بدل text.
request: اللي يبغاه العميل إذا واضح من كلامه، وإلا null. لا تكتب شي ما قاله.`;
const reviewSchema = {
  type: "object", additionalProperties: false,
  properties: {
    decision: { type: "string", enum: ["followup", "skip", "wait_for_match"] },
    reason: { type: "string" },
    text: { type: ["string", "null"] },
    auto_ok: { type: "boolean" },
    request: { anyOf: [{ type: "null" }, {
      type: "object", additionalProperties: false,
      properties: {
        areas: { type: "array", items: { type: "string" } },
        property_types: { type: "array", items: { type: "string" } },
        budget_max: { type: ["number", "null"] },
        must_haves: { type: "array", items: { type: "string" } },
      },
      required: ["areas", "property_types", "budget_max", "must_haves"],
    }] },
  },
  required: ["decision", "reason", "text", "auto_ok", "request"],
};
const lineOf = (m: any) => {
  const who = m.direction === "inbound" ? "العميل" : "المكتب";
  const body = m.transcript ? `[رسالة صوتية: ${m.transcript}]` : m.message_type === "audio" ? "[رسالة صوتية قديمة ما انقرت]" : (m.body || `[${m.message_type}]`);
  return `[${String(m.message_timestamp).slice(0, 10)}] ${who}: ${short(body, 500)}`;
};
const chatOf = async (conversationId: string, limit: number) => {
  const r = await db.from("whatsapp_messages").select("direction,body,transcript,message_type,message_timestamp").eq("conversation_id", conversationId).order("message_timestamp", { ascending: false }).limit(limit);
  return (r.data || []).reverse().map(lineOf).join("\n");
};

async function review(item: any, companyId: string, available: string, fixed: string, about: string) {
  const chat = item.conversation_id ? await chatOf(item.conversation_id, 40) : "";
  const others = await db.from("whatsapp_conversations").select("id,route_key").eq("company_id", companyId).eq("client_id", item.client_id).neq("id", item.conversation_id || "00000000-0000-0000-0000-000000000000").limit(2);
  let other = "";
  for (const c of others.data || []) other += `\nمحادثته على رقم ${c.route_key === "barka" ? "بركاء" : "مسقط"}:\n${await chatOf(c.id, 12)}\n`;
  const ai = await fetch("https://api.openai.com/v1/responses", {
    method: "POST", headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: OPENAI_MODEL, store: false, reasoning: { effort: "low" }, instructions: REVIEW_RULES.replace("{fixed}", fixed),
      input: `تاريخ اليوم: ${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Muscat" }).format(new Date())}\nسبب وجوده في القائمة: ${about}\nرقمنا اللي نتابع منه: ${item.route_key === "barka" ? "بركاء" : "مسقط"}\n\nالعقارات المتاحة الآن:\n${available || "لا يوجد"}\n\nالمحادثة:\n${chat || "ما في محادثة مسجلة"}\n${other}`,
      text: { format: { type: "json_schema", name: "followup_review", strict: true, schema: reviewSchema } } }),
  });
  const p = await ai.json().catch(() => ({}));
  if (!ai.ok) throw new Error(p?.error?.message || `openai_${ai.status}`);
  const out = JSON.parse(p.output_text || p.output?.flatMap((x: any) => x?.content || []).find((x: any) => x?.type === "output_text")?.text || "{}");
  out.text = out.text ? String(out.text).replace(/[،,!]/g, " ").replace(/\.(\s|$)/g, "$1").replace(/\s*[؟?]/g, " ؟").replace(/[ \t]+/g, " ").trim() : null;
  // one question only
  if (out.text && out.text.includes("؟")) out.text = out.text.slice(0, out.text.indexOf("؟") + 1);
  // an unread voice note near the end means nobody knows what was said; he decides, never the automatic send
  if (chat.split("\n").slice(-6).some((l: string) => l.includes("[رسالة صوتية قديمة ما انقرت]"))) out.auto_ok = false;
  return out;
}

// What the client said he wants goes on his open request, so a matching listing finds him. Staff notes are kept.
async function saveRequest(companyId: string, item: any, wanted: any, reason: string) {
  const now = new Date().toISOString();
  const patch: any = { updated_at: now, next_followup: null, next_action: short(`ننتظر عقار يناسبه: ${reason}`, 300) };
  if (wanted?.areas?.length) { patch.preferred_areas = wanted.areas.slice(0, 6); patch.preferred_area = wanted.areas[0]; }
  if (wanted?.property_types?.length) { patch.property_types = wanted.property_types.slice(0, 4); patch.property_type = wanted.property_types[0]; }
  if (wanted?.budget_max) patch.budget_max = wanted.budget_max;
  if (wanted?.must_haves?.length) patch.must_haves = wanted.must_haves.slice(0, 8);
  const open = await db.from("client_requests").select("id").eq("client_id", item.client_id).eq("status", "active").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const w = open.data
    ? await db.from("client_requests").update(patch).eq("id", open.data.id)
    : await db.from("client_requests").insert({ ...patch, company_id: companyId, client_id: item.client_id, request_type: "buyer", route_key: item.route_key, branch_key: item.route_key, status: "active", source: "whatsapp", created_via: "ai" });
  if (w.error) console.error("[followup-auto] request", w.error.message);
}

async function reviewOne(kind: "visit" | "request", x: any, companyId: string, available: string) {
  const now = new Date().toISOString();
  const table = kind === "visit" ? "whatsapp_visit_followups" : "whatsapp_outreach_queue";
  const openStatus = kind === "visit" ? "awaiting_approval" : "pending";
  let about = "متابعة طلب: هل لين الحين يبحث";
  if (kind === "visit") {
    const v = await db.from("viewings").select("viewing_date,status,properties(type,area)").eq("id", x.viewing_id).maybeSingle();
    const pr: any = (v.data as any)?.properties;
    about = `متابعة بعد زيارة ${pr?.type || "عقار"} في ${pr?.area || "غير معروف"} يوم ${v.data?.viewing_date || "غير معروف"}. ${v.data?.status === "done" ? "الزيارة تمت" : "ما نعرف هل زار"}.`;
  }
  const fixed = kind === "visit" ? String(x.body || "") : (x.messages || []).join(" ");
  const out = await review(x, companyId, available, fixed, about);
  const reason = short(out.reason, 300);
  if (out.decision === "followup" && out.text) {
    await db.from(table).update({ owner_text: short(out.text, 500), review_reason: reason, auto_ok: !!out.auto_ok, reviewed_at: now }).eq("id", x.id).eq("status", openStatus);
    return "kept";
  }
  // removed from the list; the reason stays on the record
  if (kind === "visit") await db.from(table).update({ status: "stopped", error: `review_${out.decision}`, review_reason: reason, reviewed_at: now, updated_at: now }).eq("id", x.id).eq("status", openStatus);
  else await db.from(table).update({ status: "skipped", reason: `review_${out.decision}`, review_reason: reason, reviewed_at: now }).eq("id", x.id).eq("status", openStatus);
  if (out.decision === "wait_for_match") { await saveRequest(companyId, x, out.request, reason); return "waiting_match"; }
  if (kind === "request" && x.request_id) await db.from("client_requests").update({ next_followup: null, next_action: short(`ما يحتاج متابعة: ${reason}`, 300) }).eq("id", x.request_id);
  return "removed";
}

async function reviewAll(companyId: string, out: Record<string, number>) {
  const f = await db.from("whatsapp_visit_followups").select("id,client_id,route_key,conversation_id,viewing_id,step,body").eq("company_id", companyId).eq("status", "awaiting_approval").is("reviewed_at", null).limit(REVIEWS_PER_RUN);
  const left = REVIEWS_PER_RUN - (f.data || []).length;
  const q = left > 0 ? await db.from("whatsapp_outreach_queue").select("id,client_id,route_key,conversation_id,request_id,messages").eq("company_id", companyId).eq("status", "pending").eq("kind", "request_followup").eq("dry_run", false).is("reviewed_at", null).limit(left) : { data: [] as any[] };
  const jobs: ["visit" | "request", any][] = [...(f.data || []).map((x: any) => ["visit", x] as ["visit", any]), ...((q as any).data || []).map((x: any) => ["request", x] as ["request", any])];
  if (!jobs.length) return;
  const props = await db.from("properties").select("type,area,price,bedrooms,listing_purpose").eq("company_id", companyId).eq("status", "available").eq("archived", false);
  const available = (props.data || []).map((p: any) => `- ${p.type} ${p.listing_purpose === "rent" ? "للإيجار" : "للبيع"} في ${p.area} بـ ${Number(p.price || 0).toLocaleString("en-US")} ${p.bedrooms ? `${p.bedrooms} غرف` : ""}`).join("\n");
  for (let i = 0; i < jobs.length; i += REVIEWS_AT_ONCE) {
    await Promise.all(jobs.slice(i, i + REVIEWS_AT_ONCE).map(async ([kind, x]) => {
      try { const r = await reviewOne(kind, x, companyId, available); out[r] = (out[r] || 0) + 1; }
      catch (e) { out.review_failed = (out.review_failed || 0) + 1; console.error("[followup-auto] review", String((e as any)?.message || e)); }
    }));
  }
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
  const body = service ? (f.owner_text || f.body) : f.body;
  const payload = service
    ? { type: "text", text: { preview_url: false, body } }
    : { type: "template", template: { name: f.template_name, language: { code: "ar" } } };
  const now = new Date().toISOString();
  try {
    const wamid = await metaSend(await routeTokens(f.company_id, f.route_key), digits(conv.meta_phone_number_id), to, payload);
    if (wamid) await db.from("whatsapp_messages").insert({
      company_id: f.company_id, conversation_id: conv.id, client_id: f.client_id, whatsapp_message_id: wamid,
      direction: "outbound", message_type: service ? "text" : "template", sender_wa_id: digits(conv.meta_phone_number_id), recipient_wa_id: to,
      body, message_timestamp: now, delivery_status: "sent", actor_type: "automated", channel_source: "crm_followup",
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
    await reviewAll(rt.company_id, out);
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
      // only what the review kept and said the fixed text fits
      if (!f.reviewed_at || !f.auto_ok || Date.now() < autoAfter(f.reviewed_at)) continue;
      const r = await sendOne(f, numbers);
      out[r] = (out[r] || 0) + 1;
      if (r === "failed") failed = true;
      if (r === "sent") { room--; await new Promise((x) => setTimeout(x, 1500)); }
    }
    if (failed || room <= 0) continue;
    // request follow-ups are sent by whatsapp-outreach once approved; only with an approved UTILITY template and a chat
    const reg = await db.from("whatsapp_template_registry").select("route_key,template_name,status,category").eq("company_id", rt.company_id);
    const usable = new Set((reg.data || []).filter((t: any) => String(t.status).toUpperCase() === "APPROVED" && String(t.category).toUpperCase() === "UTILITY").map((t: any) => `${t.route_key}|${t.template_name}`));
    const qs = await db.from("whatsapp_outreach_queue").select("id,client_id,route_key,template_name,created_at,conversation_id,reviewed_at,auto_ok").eq("company_id", rt.company_id).eq("status", "pending").eq("kind", "request_followup").eq("dry_run", false).order("created_at").limit(60);
    for (const q of qs.data || []) {
      if (room <= 0) break;
      if (!q.reviewed_at || !q.auto_ok || waiting.has(q.client_id) || !q.conversation_id || Date.now() < autoAfter(q.reviewed_at) || !usable.has(`${q.route_key}|${q.template_name}`)) continue;
      await db.from("whatsapp_outreach_queue").update({ status: "approved", approved_at: new Date().toISOString(), reason: "auto_after_wait" }).eq("id", q.id).eq("status", "pending");
      out.released = (out.released || 0) + 1; room--;
    }
  }
  return json({ ok: true, results: out });
});
