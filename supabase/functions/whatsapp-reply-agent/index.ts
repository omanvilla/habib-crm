import { createClient } from "npm:@supabase/supabase-js@2";
import { BRAIN } from "./brain.ts";
import { INVESTOR_KNOWLEDGE } from "./knowledge.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const OPENAI_MODEL = Deno.env.get("REPLY_AGENT_MODEL") || Deno.env.get("OPENAI_MODEL") || "gpt-5.6-luna";
const TRANSCRIBE_MODEL = Deno.env.get("OPENAI_TRANSCRIBE_MODEL") || "gpt-4o-mini-transcribe";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const GRAPH = Deno.env.get("META_GRAPH_VERSION") || "v25.0";
const DEBOUNCE_MS = 7000;
const STAFF_QUIET_HOURS = 72; // a person from the office talked to this customer recently → stay out

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const enc = new TextEncoder();
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json; charset=utf-8" } });
const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const short = (v: unknown, n = 1500) => { const s = String(v ?? "").trim(); return s.length > n ? s.slice(0, n) + "…" : s; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function b64(s: string) { const b = atob(s); const o = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) o[i] = b.charCodeAt(i); return o; }
function omanNow() {
  return new Intl.DateTimeFormat("ar-OM", { timeZone: "Asia/Muscat", weekday: "long", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date())
    + " | " + new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Muscat", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

// Make the text look typed by a person on a phone: no full stops, no commas,
// no exclamation marks, " ؟" spacing like the office writes.
function humanize(t: string) {
  let s = String(t || "").replace(/\r/g, "");
  s = s.replace(/[“”«»"]/g, "").replace(/\s*[—–]\s*/g, " ").replace(/!+/g, "");
  s = s.replace(/(\D)\.(\s+|$)/g, "$1\n").replace(/(\D)\.(?=\S)/g, "$1 ");
  s = s.replace(/\s*[،,]\s*(?!\d)/g, " ");
  s = /[؀-ۿ]/.test(s) ? s.replace(/\s*[؟?]/g, " ؟") : s.replace(/\s*[؟?]/g, "?");
  s = s.replace(/[ \t]+/g, " ").split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
  return s.trim();
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
  } catch (e) { console.error("[reply-agent] credential", String((e as any)?.message || e)); }
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
    console.error("[reply-agent] meta", r.status, JSON.stringify(d).slice(0, 400));
  }
  throw new Error("meta_send_failed");
}

// Voice notes: download from WhatsApp and turn into text so the agent understands them.
async function transcribe(tokens: string[], mediaId: string) {
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
      if (tr.ok && p?.text) return short(p.text, 4000);
    } catch (e) { console.error("[reply-agent] transcribe", String((e as any)?.message || e)); }
  }
  return null;
}

const IG_RE = /instagram\.com\/(?:reels?|p|tv)\/([A-Za-z0-9_-]+)/i;

const schema = {
  type: "object", additionalProperties: false,
  properties: {
    reply_messages: { type: "array", items: { type: "string" } },
    category: { type: "string", enum: ["buyer", "tenant", "investor", "seller", "general", "broker", "active_deal", "unclear"] },
    source: { type: "string", enum: ["reel", "property_link", "image", "video", "ad", "referral", "direct", "unknown"] },
    intent: { type: "string" },
    budget_asked_now: { type: "boolean" },
    budget: { type: ["string", "null"] },
    area: { type: ["string", "null"] },
    property_id: { type: ["string", "null"] },
    action: { type: "string", enum: ["none", "send_location", "send_owner_number", "send_lockbox", "book_viewing", "handoff"] },
    viewing_date: { type: ["string", "null"] },
    viewing_time: { type: ["string", "null"] },
    handoff_reason: { type: ["string", "null"] },
    crm_note: { type: "string" },
    matched_rule_id: { type: ["string", "null"] },
    alternatives: { type: "array", items: { type: "array", items: { type: "string" } } },
  },
  required: ["reply_messages", "category", "source", "intent", "budget_asked_now", "budget", "area", "property_id", "action", "viewing_date", "viewing_time", "handoff_reason", "crm_note", "matched_rule_id", "alternatives"],
};

// Office titles carry owner names ("فيلا الرميس 59 سلطان"), so the agent only sees a neutral label.
function propLine(p: any) {
  const name = p.type || "عقار";
  const bits = [p.area, p.wilayat, p.price ? `${Number(p.price).toLocaleString("en-US")} ريال` : "", p.bedrooms ? `${p.bedrooms} غرف` : "",
    p.land_size ? `أرض ${p.land_size}م` : "", p.built_size ? `بناء ${p.built_size}م` : ""].filter(Boolean).join("، ");
  const visit = { open: "مفتوح ويروح بروحه", lockbox: "صندوق مفتاح برمز", owner_lives: "المالك ساكن (يعطى رقم المالك)", office: "تنسيق منا (handoff)" }[p.visit_method as string] || "غير محدد (handoff للمعاينة)";
  return `- id=${p.id} | ${name} | ${bits} | الزيارة: ${visit}${p.visit_instructions ? ` (${p.visit_instructions})` : ""}${p.map_url ? "" : " | اللوكيشن غير متوفر"}${p.public_details ? `\n  تفاصيل: ${short(p.public_details, 500).replace(/\n+/g, " / ")}` : ""}`;
}

async function notifyHandoff(companyId: string, conv: any, client: any, reason: string) {
  try {
    let userId = conv.assigned_to || null;
    if (!userId) {
      const o = await db.from("profiles").select("id").eq("company_id", companyId).eq("role", "owner").eq("is_active", true).limit(1).maybeSingle();
      userId = o.data?.id || null;
    }
    if (!userId) return;
    await db.from("notifications").insert({
      user_id: userId, type: "whatsapp_handoff", is_read: false, client_id: client.id, link: "whatsapp",
      title: `محادثة تحتاجك: ${client.name || conv.customer_name || client.phone || "عميل"}`,
      body: short(reason, 400),
    });
  } catch (e) { console.error("[reply-agent] notify", String((e as any)?.message || e)); }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false }, 405);
  const secret = req.headers.get("x-crm-agent") || "";
  const ok = await db.rpc("crm_reply_agent_secret_ok", { p_secret: secret });
  if (ok.error || ok.data !== true) return json({ ok: false, error: "forbidden" }, 403);
  const { message_id, dry_run } = await req.json().catch(() => ({}));
  const dry = dry_run === true; // review only: never sends, never touches the CRM
  if (!message_id) return json({ ok: false, error: "message_id_required" }, 400);

  const m = await db.from("whatsapp_messages").select("id,company_id,conversation_id,client_id,direction,message_timestamp").eq("id", message_id).single();
  if (m.error || m.data.direction !== "inbound") return json({ ok: true, ignored: "not_inbound" });
  const msg = m.data;

  // let the customer finish typing; only the newest inbound message is answered
  if (!dry) await sleep(DEBOUNCE_MS);
  const latest = await db.from("whatsapp_messages").select("id").eq("conversation_id", msg.conversation_id).eq("direction", "inbound")
    .order("message_timestamp", { ascending: false }).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!dry && latest.data?.id !== msg.id) return json({ ok: true, ignored: "superseded" });

  const claim = await db.from("whatsapp_reply_drafts").insert({ company_id: msg.company_id, conversation_id: msg.conversation_id, message_id: msg.id, client_id: msg.client_id, status: "pending", analysis: dry ? { dry_run: true } : {} }).select("id").single();
  if (claim.error) return json({ ok: true, ignored: "already_processed" });
  const draftId = claim.data.id;
  const fail = async (why: string, status = "skipped") => { await db.from("whatsapp_reply_drafts").update({ status, error: why }).eq("id", draftId); return json({ ok: true, ignored: why }); };

  try {
    const [rtR, convR, clientR, routesR] = await Promise.all([
      db.from("whatsapp_automation_runtime").select("*").eq("company_id", msg.company_id).single(),
      db.from("whatsapp_conversations").select("*").eq("id", msg.conversation_id).single(),
      db.from("clients").select("id,name,phone,phone_normalized,followup_suppressed").eq("id", msg.client_id).single(),
      db.from("company_lead_routes").select("route_key,whatsapp_number,meta_phone_number_id"),
    ]);
    const rt = rtR.data, conv = convR.data, client = clientR.data;
    if (!rt || (!dry && rt.reply_agent_mode === "off")) return fail("agent_off");
    if (!conv || !client) return fail("context_missing", "failed");
    const to = digits(client.phone_normalized || client.phone);
    const companyNumbers = (routesR.data || []).map((r: any) => digits(r.whatsapp_number)).filter(Boolean);
    if (companyNumbers.includes(to)) return fail("company_number");
    if (!dry && rt.mode === "test" && !(rt.allowed_customer_phones || []).map(digits).includes(to)) return fail("not_allowlisted");
    if (!(rt.allowed_routes || []).includes(conv.route_key)) return fail("route_blocked");
    if (!dry && conv.human_handoff_required) return fail("human_handoff_open");
    if (!dry && client.followup_suppressed) return fail("client_paused");

    // someone from the office already answered after this message → stay quiet
    const after = await db.from("whatsapp_messages").select("id").eq("conversation_id", conv.id).eq("direction", "outbound")
      .gt("message_timestamp", msg.message_timestamp).limit(1);
    if (!dry && (after.data || []).length) return fail("staff_replied");
    // a person from the office has been talking to this customer recently → this is their conversation
    const since = new Date(new Date(msg.message_timestamp).getTime() - STAFF_QUIET_HOURS * 3600 * 1000).toISOString();
    const staffRecent = await db.from("whatsapp_messages").select("id,message_timestamp").eq("conversation_id", conv.id).eq("direction", "outbound")
      .eq("actor_type", "human").gte("message_timestamp", since).lte("message_timestamp", msg.message_timestamp).limit(1);
    if ((staffRecent.data || []).length) return fail("staff_active");

    const [histR, propsR, rulesR, priorR] = await Promise.all([
      db.from("whatsapp_messages").select("id,direction,message_type,body,transcript,media_id,actor_type,message_timestamp,matched_property_id,property_link_key,property_image_analysis")
        .eq("conversation_id", conv.id).lte("message_timestamp", msg.message_timestamp).order("message_timestamp", { ascending: false }).limit(30),
      db.from("properties").select("id,title,internal_name,type,area,wilayat,price,bedrooms,bathrooms,land_size,built_size,public_details,map_url,visit_method,visit_instructions,lockbox_image_url,owner_id,branch_key")
        .eq("company_id", msg.company_id).eq("status", "available").eq("archived", false),
      db.from("whatsapp_reply_rules").select("id,situation,approved_reply,category").eq("company_id", msg.company_id).eq("active", true).order("created_at", { ascending: false }).limit(40),
      db.from("whatsapp_reply_drafts").select("analysis,status").eq("conversation_id", conv.id).in("status", ["sent", "approved", "edited"]),
    ]);
    const history = (histR.data || []).reverse();
    const props = propsR.data || [];
    const budgetAskedBefore = (priorR.data || []).some((d: any) => d.analysis?.budget_asked_now === true);
    const tokens = await routeTokens(msg.company_id, conv.route_key);

    // understand the latest voice notes
    const pendingAudio = history.filter((h: any) => h.direction === "inbound" && h.message_type === "audio" && !h.transcript && h.media_id).slice(-3);
    for (const a of pendingAudio) {
      const text = await transcribe(tokens, a.media_id);
      if (text) {
        a.transcript = text;
        await db.from("whatsapp_messages").update({ transcript: text, transcription_status: "completed" }).eq("id", a.id);
      }
    }

    // what the shared reels are about
    const codes = new Set<string>();
    for (const h of history) {
      const k = String(h.property_link_key || "");
      if (k.startsWith("instagram:")) codes.add(k);
      const mm = String(h.body || "").match(IG_RE);
      if (mm) codes.add(`instagram:${mm[1]}`);
    }
    const reels: Record<string, any> = {};
    if (codes.size) {
      const r = await db.from("instagram_media_catalog").select("link_key,caption,property_id,state").eq("company_id", msg.company_id).in("link_key", [...codes]);
      for (const x of r.data || []) reels[x.link_key] = x;
    }

    const transcript = history.map((h: any) => {
      const who = h.direction === "inbound" ? "العميل" : (h.actor_type === "human" ? "المكتب (شخص)" : "المكتب (رد سابق منك)");
      let text = h.transcript ? `[رسالة صوتية: ${h.transcript}]` : (h.body || (h.message_type === "audio" ? "[رسالة صوتية ما انفهمت]" : `[${h.message_type}]`));
      const key = String(h.property_link_key || "") || ((String(h.body || "").match(IG_RE) || [])[1] ? `instagram:${String(h.body).match(IG_RE)![1]}` : "");
      const reel = key ? reels[key] : null;
      let extra = "";
      if (reel) extra += ` {ريل من حسابنا. وصفه: ${short(reel.caption, 300).replace(/\n+/g, " / ")}${reel.property_id ? ` | عقار مرتبط: ${reel.property_id}` : ""}}`;
      else if (key) extra += " {ريل ما عرفنا وصفه}";
      if (h.matched_property_id) extra += ` {عقار مرتبط: ${h.matched_property_id}}`;
      if (h.property_image_analysis) extra += ` {تحليل الصورة: ${short(JSON.stringify(h.property_image_analysis), 300)}}`;
      return `${who}: ${short(text, 700)}${extra}`;
    }).join("\n");

    const context = [
      `الوقت الحالي في عمان: ${omanNow()}`,
      `اسم العميل في الواتساب: ${client.name || conv.customer_name || "غير معروف"}`,
      `الرقم اللي كلمنا عليه: ${conv.route_key === "barka" ? "رقم بركاء" : "رقم مسقط"}`,
      `هل سألنا عن الميزانية قبل في هذه المحادثة: ${budgetAskedBefore ? "نعم، لا تسأل مرة ثانية أبداً" : "لا"}`,
      `ملخص سابق للعميل: ${conv.ai_summary || "لا يوجد"}`,
      "",
      "العقارات المتاحة الآن (لا تعرض غيرها، ولا تذكر id للعميل):",
      props.map(propLine).join("\n") || "لا يوجد",
      "",
      "معلومات المستثمرين:",
      INVESTOR_KNOWLEDGE,
      "",
      rulesR.data?.length ? "ردود مثبتة اعتمدها المدير:\n" + rulesR.data.map((r: any) => `- rule_id=${r.id} | الموقف: ${r.situation}\n  الرد: ${r.approved_reply}`).join("\n") : "ردود مثبتة: لا يوجد",
      "",
      "المحادثة (الأقدم أولاً، وآخر سطر هو اللي ترد عليه):",
      transcript,
    ].join("\n");

    const ai = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OPENAI_MODEL, store: false, reasoning: { effort: "medium" },
        instructions: BRAIN, input: context,
        text: { format: { type: "json_schema", name: "omanvilla_reply", strict: true, schema } },
      }),
    });
    const aiP = await ai.json().catch(() => ({}));
    if (!ai.ok) throw new Error(aiP?.error?.message || `openai_${ai.status}`);
    const out = JSON.parse(aiP.output_text || aiP.output?.flatMap((x: any) => x?.content || []).find((x: any) => x?.type === "output_text")?.text || "{}");

    // the agent may only touch properties that are really available
    const prop = props.find((p: any) => p.id === out.property_id) || null;
    let texts: string[] = (out.reply_messages || []).map((t: string) => humanize(t)).filter(Boolean);
    if (budgetAskedBefore) texts = texts.filter((t) => !/ميزاني|في حدود كم|كم تقريب/.test(t));
    texts = texts.filter((t) => !/(الموظف|موظف)\s*(بيتواصل|يتواصل|بيرد|يرد)|بيتواصل معك الموظف|تم تحويل/.test(t));
    out.reply_messages = texts.slice(0, 3);
    // a pinned reply only counts when the id is real
    const rule = (rulesR.data || []).find((r: any) => r.id === out.matched_rule_id) || null;
    out.matched_rule_id = rule?.id || null;
    // other ways to say it, for the owner to pick from (investors)
    out.alternatives = (out.alternatives || []).map((a: string[]) => (a || []).map((t) => humanize(t)).filter(Boolean).slice(0, 3)).filter((a: string[]) => a.length).slice(0, 2);
    const outgoing: any[] = out.reply_messages.map((t: string) => ({ type: "text", text: { preview_url: false, body: t } }));

    if (out.action === "send_location" || out.action === "send_lockbox") {
      if (prop?.map_url) outgoing.push({ type: "text", text: { preview_url: true, body: prop.map_url } });
      else { out.action = "handoff"; out.handoff_reason = "العميل يبي يزور واللوكيشن غير مسجل للعقار"; }
    }
    if (out.action === "send_lockbox") {
      if (prop?.lockbox_image_url) outgoing.push({ type: "image", image: { link: prop.lockbox_image_url } });
      else { out.action = "handoff"; out.handoff_reason = "معاينة بصندوق مفتاح وصورة الرمز غير مرفوعة"; }
    }
    if (out.action === "send_owner_number") {
      if (prop?.visit_method === "owner_lives" && prop.owner_id) {
        const o = await db.from("owners").select("phone").eq("id", prop.owner_id).maybeSingle();
        if (o.data?.phone) outgoing.push({ type: "text", text: { preview_url: false, body: digits(o.data.phone) } });
        else { out.action = "handoff"; out.handoff_reason = "رقم المالك غير مسجل"; }
      } else { out.action = "handoff"; out.handoff_reason = "طلب معاينة تحتاج تنسيق"; }
    }

    // approval mode still sends on its own when the owner switched the category on and the reply is a pinned one
    const autoSend = !dry && rt.reply_agent_mode === "approval" && !!rule && out.reply_messages.length > 0
      && ["none", "handoff"].includes(out.action) && (rt.auto_send_categories || []).includes(out.category);
    const analysis = { ...out, property_id: prop?.id || null, model: OPENAI_MODEL, dry_run: dry, auto_sent: autoSend, transcribed: pendingAudio.filter((a: any) => a.transcript).length };
    if (dry || (rt.reply_agent_mode === "approval" && !autoSend)) {
      await db.from("whatsapp_reply_drafts").update({ analysis, reply_messages: out.reply_messages, status: "pending" }).eq("id", draftId);
      return json({ ok: true, status: "awaiting_approval" });
    }

    // send, in order, like a person typing separate messages
    const phoneId = digits(conv.meta_phone_number_id);
    const sentIds: string[] = [];
    for (let i = 0; i < outgoing.length; i++) {
      if (i) await sleep(1500);
      const wamid = await metaSend(tokens, phoneId, to, outgoing[i]);
      const body = outgoing[i].type === "text" ? outgoing[i].text.body : "[صورة صندوق المفتاح]";
      if (wamid) {
        sentIds.push(wamid);
        await db.from("whatsapp_messages").insert({
          company_id: msg.company_id, conversation_id: conv.id, client_id: client.id, whatsapp_message_id: wamid,
          direction: "outbound", message_type: outgoing[i].type, sender_wa_id: phoneId, recipient_wa_id: to, body,
          message_timestamp: new Date().toISOString(), delivery_status: "sent", actor_type: "automated",
          channel_source: "crm_reply_agent", raw_payload: { source: autoSend ? "reply_agent_auto_pinned" : "reply_agent_v1", draft_id: draftId, rule_id: rule?.id || null },
        });
      }
    }
    const now = new Date().toISOString();
    await db.from("whatsapp_reply_drafts").update({ analysis, reply_messages: out.reply_messages, status: sentIds.length ? "sent" : "skipped", error: sentIds.length ? null : "no_reply_needed", sent_at: sentIds.length ? now : null }).eq("id", draftId);

    // keep the CRM up to date
    const convPatch: any = { ai_summary: short(out.crm_note, 1500), last_automation_action: { scenario: "reply_agent_v1", action: out.action, at: now, category: out.category, source: out.source }, updated_at: now };
    if (out.action === "handoff") Object.assign(convPatch, { human_handoff_required: true, handoff_reason: short(out.handoff_reason || out.intent, 500), handoff_updated_at: now });
    await db.from("whatsapp_conversations").update(convPatch).eq("id", conv.id);
    if (out.action === "handoff") await notifyHandoff(msg.company_id, conv, client, out.handoff_reason || out.crm_note || out.intent);
    try {
      const flags: any = {};
      if (out.category === "buyer" || out.category === "tenant") flags.is_buyer = true;
      if (out.category === "seller") flags.is_seller = true;
      if (out.category === "investor") flags.is_investor = true;
      if (out.area) flags.preferred_area = short(out.area, 200);
      if (Object.keys(flags).length) await db.from("clients").update(flags).eq("id", client.id);
    } catch (_) { /* optional */ }
    const visitAction = ["book_viewing", "send_location", "send_lockbox", "send_owner_number"].includes(out.action);
    if (visitAction && prop && /^\d{4}-\d{2}-\d{2}$/.test(out.viewing_date || "")) {
      const t = /^([01]\d|2[0-3]):[0-5]\d$/.test(out.viewing_time || "") ? out.viewing_time : "16:00";
      const v = await db.from("viewings").insert({
        company_id: msg.company_id, client_id: client.id, property_id: prop.id, agent_id: conv.assigned_to || null,
        viewing_date: out.viewing_date, viewing_time: t, duration_minutes: 30, location: prop.map_url || prop.area,
        status: "scheduled", created_via: "whatsapp_ai", source_whatsapp_message_id: msg.id, notes: short(out.crm_note, 1000),
      });
      if (v.error) console.error("[reply-agent] viewing", v.error.message);
    }
    await db.from("whatsapp_automation_events").insert({
      company_id: msg.company_id, conversation_id: conv.id, message_id: msg.id, client_id: client.id, property_id: prop?.id || null,
      action_type: "reply_agent_v1", status: "applied", confidence: 1, reason: short(out.intent, 500), payload: analysis, applied_at: now,
    });
    return json({ ok: true, sent: sentIds.length, action: out.action });
  } catch (e) {
    const why = short((e as any)?.message || e, 800);
    await db.from("whatsapp_reply_drafts").update({ status: "failed", error: why }).eq("id", draftId);
    return json({ ok: false, error: why }, 500);
  }
});
