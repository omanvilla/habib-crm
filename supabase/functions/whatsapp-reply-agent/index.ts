import { createClient } from "npm:@supabase/supabase-js@2";
// The brain and investor knowledge live in whatsapp_agent_prompts (synced from the repo by agent-prompt-sync),
// so wording changes do not need a redeploy.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const OPENAI_MODEL = Deno.env.get("REPLY_AGENT_MODEL") || Deno.env.get("OPENAI_MODEL") || "gpt-5.6-luna";
const TRANSCRIBE_MODEL = Deno.env.get("OPENAI_TRANSCRIBE_MODEL") || "gpt-4o-mini-transcribe";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const GRAPH = Deno.env.get("META_GRAPH_VERSION") || "v25.0";
const DEBOUNCE_MS = Number(Deno.env.get("REPLY_DEBOUNCE_MS") || 35000); // wait for the customer to finish typing (30 to 60 seconds)
const STAFF_QUIET_HOURS = 2; // the last reply was typed by a person from the office in the last 2 hours → they are in the chat, stay out
const ALLOWED_ORIGINS = ["https://omanvilla.github.io"]; // the approval screen asks for a rewrite from here

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const enc = new TextEncoder();
const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const short = (v: unknown, n = 1500) => { const s = String(v ?? "").trim(); return s.length > n ? s.slice(0, n) + "…" : s; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function cors(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
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

// Customer photos and PDFs: the agent looks at them itself (a screenshot of our reel, a photo of a villa,
// a kroki, an ownership deed or a listing sheet sent as a file).
async function imageDataUrl(tokens: string[], mediaId: string, kind = /^image\/(jpeg|png|webp)$/, maxBytes = 5 * 1024 * 1024) {
  for (const t of tokens) {
    try {
      const metaR = await fetch(`https://graph.facebook.com/${GRAPH}/${mediaId}`, { headers: { Authorization: `Bearer ${t}` } });
      const meta = await metaR.json().catch(() => ({}));
      if (!metaR.ok || !meta?.url || !kind.test(String(meta.mime_type || ""))) continue;
      if (Number(meta.file_size || 0) > maxBytes) return null;
      const fileR = await fetch(meta.url, { headers: { Authorization: `Bearer ${t}` } });
      if (!fileR.ok) continue;
      const buf = new Uint8Array(await fileR.arrayBuffer());
      if (buf.length > maxBytes) return null;
      let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return `data:${meta.mime_type};base64,${btoa(bin)}`;
    } catch (e) { console.error("[reply-agent] image", String((e as any)?.message || e)); }
  }
  return null;
}

// The cover of the newest reel of each available property, to compare with what the customer sent.
async function reelCovers(companyId: string, propIds: string[]) {
  const out: Record<string, string> = {};
  if (!propIds.length) return out;
  try {
    const cat = await db.from("instagram_media_catalog").select("property_id,instagram_media_id,account_id,published_at").eq("company_id", companyId).in("property_id", propIds)
      .not("instagram_media_id", "is", null).order("published_at", { ascending: false }).limit(60);
    const newest: Record<string, any> = {};
    for (const r of cat.data || []) if (!newest[r.property_id]) newest[r.property_id] = r;
    const tokens: Record<string, string> = {};
    for (const r of Object.values(newest)) {
      if (!tokens[r.account_id]) {
        const c = await db.from("instagram_account_credentials").select("token_ciphertext,token_iv").eq("account_id", r.account_id).eq("company_id", companyId).maybeSingle();
        if (!c.data) continue;
        const key = await crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", enc.encode(`${META_APP_SECRET}|${companyId}|${r.account_id}|habib-crm-instagram-v1`)), { name: "AES-GCM" }, false, ["decrypt"]);
        tokens[r.account_id] = new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(c.data.token_iv) }, key, b64(c.data.token_ciphertext)));
      }
      const g = await fetch(`https://graph.facebook.com/${GRAPH}/${digits(r.instagram_media_id)}?fields=thumbnail_url,media_url,media_type`, { headers: { Authorization: `Bearer ${tokens[r.account_id]}` } });
      const d = await g.json().catch(() => ({}));
      const url = d?.thumbnail_url || (d?.media_type === "IMAGE" ? d?.media_url : null);
      if (g.ok && url) out[r.property_id] = url;
    }
  } catch (e) { console.error("[reply-agent] covers", String((e as any)?.message || e)); }
  return out;
}

const IG_RE = /instagram\.com\/(?:reels?|p|tv)\/([A-Za-z0-9_-]+)/i;

const NAME_NOT_GIVEN = "ما ذكر اسمه، الاسم المسجل من الواتساب مو اسمه الحقيقي";
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
    client_name_stated: { type: ["string", "null"] },
    name_declined: { type: "boolean" },
    matched_rule_id: { type: ["string", "null"] },
    alternatives: { type: "array", items: { type: "array", items: { type: "string" } } },
    close_other_branch: { type: "boolean" },
    owner_offer: { anyOf: [{ type: "null" }, {
      type: "object", additionalProperties: false,
      properties: {
        kind: { type: "string", enum: ["land", "villa", "house", "building", "apartment", "other"] },
        area: { type: ["string", "null"] }, wilayat: { type: ["string", "null"] },
        price: { type: ["number", "null"] }, land_size: { type: ["number", "null"] }, built_size: { type: ["number", "null"] },
      },
      required: ["kind", "area", "wilayat", "price", "land_size", "built_size"],
    }] },
    request: { anyOf: [{ type: "null" }, {
      type: "object", additionalProperties: false,
      properties: {
        request_type: { type: "string", enum: ["buyer", "tenant", "seller", "consultation"] },
        areas: { type: "array", items: { type: "string" } },
        property_types: { type: "array", items: { type: "string" } },
        budget_max: { type: ["number", "null"] },
        bedrooms_min: { type: ["integer", "null"] },
        notes: { type: ["string", "null"] },
        followup_in_days: { type: ["integer", "null"] },
        followup_note: { type: ["string", "null"] },
      },
      required: ["request_type", "areas", "property_types", "budget_max", "bedrooms_min", "notes", "followup_in_days", "followup_note"],
    }] },
  },
  required: ["reply_messages", "category", "source", "intent", "budget_asked_now", "budget", "area", "property_id", "action", "viewing_date", "viewing_time", "handoff_reason", "crm_note", "matched_rule_id", "alternatives", "close_other_branch", "owner_offer", "request", "client_name_stated", "name_declined"],
};

// The marketing text (property description, or the longest reel caption for it) is what the office
// sends customers as "the details"; links and phone numbers are taken out because the agent
// must not write links and the location goes through send_location.
function publicText(v: unknown) {
  return String(v ?? "").replace(/https?:\/\/\S+/gi, "").replace(/\+?968[\s-]?\d{8}|\b[79]\d{7}\b/g, "")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

// Office titles carry owner names ("فيلا الرميس 59 سلطان"), so the agent only sees a neutral label.
function propLine(p: any) {
  const name = `${p.type || "عقار"} ${p.listing_purpose === "rent" ? "للإيجار" : "للبيع"}`;
  const bits = [p.area, p.wilayat, p.price ? `${p.listing_purpose === "rent" ? "الإيجار " : ""}${Number(p.price).toLocaleString("en-US")} ريال` : "", p.bedrooms ? `${p.bedrooms} غرف` : "",
    p.land_size ? `أرض ${p.land_size}م` : "", p.built_size ? `بناء ${p.built_size}م` : ""].filter(Boolean).join("، ");
  const visit = { open: "مفتوح ويروح بروحه", lockbox: "صندوق مفتاح برمز", owner_lives: "المالك ساكن (يعطى رقم المالك)", office: "تنسيق منا (handoff)" }[p.visit_method as string] || "غير محدد (handoff للمعاينة)";
  const TERMS: Record<string, string> = { daily: "يومي", weekly: "أسبوعي", monthly: "شهري", "3m": "3 شهور", "6m": "6 شهور", yearly: "سنة" };
  const terms = p.listing_purpose === "rent" ? ` | مدة الإيجار المسموحة: ${(p.rental_terms || []).length ? (p.rental_terms as string[]).map((t) => TERMS[t] || t).join(" او ") : "غير محددة (handoff اذا سأل عن مدة قصيرة)"}` : "";
  const rented = p.rented_units ? ` | المؤجر حالياً: ${p.rented_units}` : "";
  return `- id=${p.id} | ${name} | ${bits}${terms}${rented} | الزيارة: ${visit}${p.visit_instructions ? ` (${p.visit_instructions})` : ""}${p.map_url ? " | اللوكيشن متوفر (action=send_location)" : " | اللوكيشن غير متوفر"} | الفرع: ${p.branch_key === "muscat" ? "مسقط (رقم 71770030)" : p.branch_key === "barka" ? "بركاء (رقم 92344273)" : "غير محدد"}${p.video ? ` | رابط الفيديو (ترسله إذا طلب فيديو): ${p.video}` : ""}${p.public_details ? `\n  تفاصيل: ${short(p.public_details, 500).replace(/\n+/g, " / ")}` : ""}${p.marketing ? `\n  وصف الإعلان: ${short(p.marketing, 1600)}` : ""}`;
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
      title: `${/^طلب اتصال/.test(reason) ? "📞 طلب اتصال" : /^(مشتري جاد|تفاوض)/.test(reason) ? "🔥 مشتري جاد" : "محادثة تحتاجك"}: ${client.name || conv.customer_name || client.phone || "عميل"}`,
      body: short(reason, 400),
    });
  } catch (e) { console.error("[reply-agent] notify", String((e as any)?.message || e)); }
}

// Visit watch: most visits are agreed in chats a person is handling, where the agent stays quiet, so visits are
// read from the conversation on their own path instead of depending on the reply. A location request or
// "I may pass by" is interest, not a visit. Manual visits are never moved or cancelled from here.
const VISIT_HINT = /زيار|زور|معاين|اشوف|أشوف|بشوف|نشوف|شفت|شفنا|زرت|زرنا|بمر|بجي|بوصل|رحت|رحنا|موعد|اليوم|بكره|بكرة|باكر|عصر|الصبح|صباح|ظهر|المغرب|الليل|الساعة|الساعه|السبت|الأحد|الاحد|الاثنين|الثلاثاء|الاربعاء|الأربعاء|الخميس|الجمعة|الجمعه|نخليها|خلها|أجل|اجل|تأجيل|تاجيل|نغير|تغيير|ما اقدر|ما أقدر|ما بقدر|ما بجي|ما بيجي|الغي|ألغي|visit|view|tomorrow|today/i;
const visitSchema = {
  type: "object", additionalProperties: false,
  properties: {
    event: { type: "string", enum: ["none", "agreed", "done", "cancelled", "postponed"] },
    property_id: { type: ["string", "null"] },
    date: { type: ["string", "null"] },
    time: { type: ["string", "null"] },
    confidence: { type: "number" },
    note: { type: "string" },
  },
  required: ["event", "property_id", "date", "time", "confidence", "note"],
};
const VISIT_RULES = `تقرأ محادثة واتساب لمكتب عقاري وتحدد هل آخر رسائل العميل فيها حدث زيارة لعقار. رجّع واحد بس:
- agreed: العميل حدد يوم يزور فيه عقار (حتى لو الوقت تقريبي مثل "بكره العصر")، أو اتفق معه المكتب على موعد، أو غيّر موعد مسجل (اليوم أو الساعة) حتى لو كلامه مو أكيد مثل "نخليها 11". إذا غيّر الساعة بس، date هو يوم الموعد المسجل. وإذا له موعد مسجل واحد، property_id هو عقار هذا الموعد.
- postponed: العميل قال يبغى يأجل الموعد المسجل وما حدد موعد جديد.
- done: العميل قال إنه زار العقار أو شافه فعلاً.
- cancelled: العميل قال إنه ما بيجي أو ألغى موعد متفق عليه.
- none: أي شي ثاني. طلب اللوكيشن بدون يوم = none. "بمر" أو "بشوف" بدون يوم = none. سؤال "متى يناسبك" من المكتب بدون جواب = none. مقابلة مالك أو وسيط مع المكتب، أو مالك يعرض عقاره = none. موعد قديم فات وما تكلم عنه العميل الحين = none.
property_id: id العقار من القائمة، بس إذا واضح من المحادثة أي عقار. إذا مو واضح خله null.
date بصيغة YYYY-MM-DD حسب تاريخ اليوم المكتوب. time بصيغة HH:MM إذا مذكور، وإلا null (العصر=16:00، المغرب=18:00، الصبح=10:00).
confidence من 0 إلى 1. note سطر قصير بالعربي عن اللي قاله العميل، بدون أسماء.`;

async function watchVisit(msg: any, dry = false) {
  const hist = await db.from("whatsapp_messages").select("direction,actor_type,message_type,body,transcript,message_timestamp")
    .eq("conversation_id", msg.conversation_id).lte("message_timestamp", msg.message_timestamp).order("message_timestamp", { ascending: false }).limit(16);
  const rows = (hist.data || []).reverse();
  const lastIn = rows.filter((h: any) => h.direction === "inbound").slice(-3).map((h: any) => h.transcript || h.body || "").join(" ");
  if (!VISIT_HINT.test(lastIn)) return { event: "none", skipped: "no_hint" };
  const [propsR, openR] = await Promise.all([
    db.from("properties").select("id,type,area,price,bedrooms,land_size,listing_purpose").eq("company_id", msg.company_id).in("status", ["available", "reserved"]).eq("archived", false),
    db.from("viewings").select("id,property_id,viewing_date,viewing_time,status,created_via,notes").eq("client_id", msg.client_id).eq("archived", false).in("status", ["scheduled", "confirmed", "postponed"]),
  ]);
  const props = propsR.data || [];
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Muscat" }).format(new Date());
  const input = [`تاريخ اليوم: ${today}`, "", "العقارات:",
    props.map((p: any) => `- id=${p.id} | ${p.type} ${p.listing_purpose === "rent" ? "للإيجار" : "للبيع"} | ${p.area} | ${Number(p.price || 0).toLocaleString("en-US")} | ${p.bedrooms || "?"} غرف | أرض ${p.land_size || "?"}م`).join("\n"),
    "", "مواعيد مسجلة الحين لهذا العميل:", (openR.data || []).map((v: any) => `- ${v.property_id} يوم ${v.viewing_date} الساعة ${String(v.viewing_time || "غير محددة").slice(0, 5)}`).join("\n") || "لا يوجد",
    "", "المحادثة (الأقدم أولاً):",
    rows.map((h: any) => `[${String(h.message_timestamp).slice(0, 16)}] ${h.direction === "inbound" ? "العميل" : "المكتب"}: ${short(h.transcript || h.body || `[${h.message_type}]`, 400)}`).join("\n")].join("\n");
  const ai = await fetch("https://api.openai.com/v1/responses", {
    method: "POST", headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: OPENAI_MODEL, store: false, reasoning: { effort: "low" }, instructions: VISIT_RULES, input, text: { format: { type: "json_schema", name: "visit_event", strict: true, schema: visitSchema } } }),
  });
  const p = await ai.json().catch(() => ({}));
  if (!ai.ok) throw new Error(p?.error?.message || `openai_${ai.status}`);
  const out = JSON.parse(p.output_text || p.output?.flatMap((x: any) => x?.content || []).find((x: any) => x?.type === "output_text")?.text || "{}");
  if (dry || out.event === "none" || !(out.confidence >= 0.7)) return { ...out, applied: false };
  // one saved visit: a change with no clear property is about that visit
  const only = (openR.data || []).length === 1 ? openR.data![0] : null;
  const open = (openR.data || []).find((v: any) => v.property_id === out.property_id) || (!props.some((x: any) => x.id === out.property_id) ? only : null);
  const prop = props.find((x: any) => x.id === (out.property_id || open?.property_id)) || props.find((x: any) => x.id === open?.property_id);
  const addNote = () => [open?.notes, short(out.note, 500)].filter(Boolean).join("\n").slice(0, 1000);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(out.date || "") ? out.date : (open?.viewing_date || null);
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(out.time || "") ? out.time : null;
  const provenance = { created_via: "whatsapp_ai", source_whatsapp_message_id: msg.id, auto_confidence: out.confidence };
  let w: any = null;
  if (out.event === "agreed") {
    if ((!prop && !open) || !date || date < today) return { ...out, applied: false, why: "no_property_or_date" };
    if (open) {
      // owner's decision, 6 Nov: any change the client makes is saved at once, whoever recorded the visit
      if (open.status !== "postponed" && open.viewing_date === date && (!time || open.viewing_time?.slice(0, 5) === time)) return { ...out, applied: false, why: "already_recorded" };
      w = await db.from("viewings").update({ viewing_date: date, viewing_time: time || open.viewing_time, status: "scheduled", notes: addNote() }).eq("id", open.id);
    } else {
      w = await db.from("viewings").insert({ company_id: msg.company_id, client_id: msg.client_id, property_id: prop.id, viewing_date: date, viewing_time: time || "16:00", duration_minutes: 30, status: "scheduled", notes: short(out.note, 1000), ...provenance });
    }
  } else if (out.event === "done") {
    if (open) w = await db.from("viewings").update({ status: "done" }).eq("id", open.id);
    else if (prop) w = await db.from("viewings").insert({ company_id: msg.company_id, client_id: msg.client_id, property_id: prop.id, viewing_date: date && date <= today ? date : today, viewing_time: time, duration_minutes: 30, status: "done", notes: short(out.note, 1000), ...provenance });
    else return { ...out, applied: false, why: "no_property" };
  } else if (out.event === "cancelled") {
    if (!open) return { ...out, applied: false, why: "nothing_to_cancel" };
    w = await db.from("viewings").update({ status: "cancelled", notes: addNote() }).eq("id", open.id);
  } else if (out.event === "postponed") {
    if (!open) return { ...out, applied: false, why: "nothing_to_postpone" };
    w = await db.from("viewings").update({ status: "postponed", notes: addNote() }).eq("id", open.id);
  }
  if (w?.error) throw new Error(w.error.message);
  return { ...out, applied: true };
}

Deno.serve(async (req) => {
  const headers = { ...cors(req), "content-type": "application/json; charset=utf-8" };
  const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers });
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ ok: false }, 405);
  const body = await req.json().catch(() => ({}));
  let message_id = body?.message_id;
  let dry = body?.dry_run === true; // review only: never sends, never touches the CRM
  // redo: the owner, from the approval screen, asks for a waiting draft to be rewritten following
  // their instruction ("ارسل له تفاصيل العقار"). The new reply replaces the draft and still waits for approval.
  let redo: { draftId: string; instruction: string } | null = null;
  const secret = req.headers.get("x-crm-agent") || "";
  const ok = secret ? await db.rpc("crm_reply_agent_secret_ok", { p_secret: secret }) : null;
  if (!ok || ok.error || ok.data !== true) {
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const u = jwt ? await db.auth.getUser(jwt) : null;
    const prof = u?.data?.user ? await db.from("profiles").select("id,company_id,role,is_active").eq("id", u.data.user.id).maybeSingle() : null;
    if (!prof?.data || prof.data.role !== "owner" || prof.data.is_active === false) return json({ ok: false, error: "owner_only" }, 403);
    const instruction = short(body?.instruction, 1000);
    if (!body?.draft_id || !instruction) return json({ ok: false, error: "instruction_required" }, 400);
    const d = await db.from("whatsapp_reply_drafts").select("id,message_id,status,analysis").eq("id", String(body.draft_id)).eq("company_id", prof.data.company_id).maybeSingle();
    if (!d.data) return json({ ok: false, error: "draft_not_found" }, 404);
    if (d.data.status !== "pending") return json({ ok: false, error: "draft_not_pending" }, 409);
    redo = { draftId: d.data.id, instruction };
    message_id = d.data.message_id;
    dry = d.data.analysis?.dry_run === true;
  }
  if (!message_id) return json({ ok: false, error: "message_id_required" }, 400);

  const m = await db.from("whatsapp_messages").select("id,company_id,conversation_id,client_id,direction,message_timestamp").eq("id", message_id).single();
  if (m.error || m.data.direction !== "inbound") return json({ ok: true, ignored: "not_inbound" });
  const msg = m.data;
  // a read-only look at what the visit watch would decide for this message
  if (body?.visit_test === true && ok?.data === true) return json(await watchVisit(msg, true));
  // a rewrite is reviewed like a dry run: the checks below that only decide whether to send are skipped
  const review = dry || !!redo;
  // never lets a visit problem get in the way of the reply
  const watch = async () => { if (review) return; try { const v = await watchVisit(msg); if (v?.applied) console.log("[reply-agent] visit", v.event); } catch (e) { console.error("[reply-agent] visit", String((e as any)?.message || e)); } };

  // let the customer finish typing; only the newest inbound message is answered
  if (!review) await sleep(DEBOUNCE_MS);
  const latest = await db.from("whatsapp_messages").select("id").eq("conversation_id", msg.conversation_id).eq("direction", "inbound")
    .order("message_timestamp", { ascending: false }).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!review && latest.data?.id !== msg.id) return json({ ok: true, ignored: "superseded" });
  // a bare greeting is usually followed by the question: give the customer a little longer
  if (!review) {
    const lo = await db.from("whatsapp_messages").select("message_timestamp").eq("conversation_id", msg.conversation_id).eq("direction", "outbound")
      .order("message_timestamp", { ascending: false }).limit(1).maybeSingle();
    const burst = await db.from("whatsapp_messages").select("body,message_type").eq("conversation_id", msg.conversation_id).eq("direction", "inbound")
      .gt("message_timestamp", lo.data?.message_timestamp || "1970-01-01").limit(10);
    const GREET = /^\s*(السلام عليكم[\s\S]{0,30}|سلام[\s\S]{0,20}|مرحبا[\s\S]{0,20}|هلا[\s\S]{0,15}|مساء الخير|صباح الخير|كيف الحال[\s\S]{0,10}|عساك بخير|hi|hello|salam[\s\S]{0,15})\s*$/i;
    if ((burst.data || []).length && (burst.data || []).every((m: any) => m.message_type === "text" && GREET.test(String(m.body || "")))) {
      await sleep(25000);
      const l2 = await db.from("whatsapp_messages").select("id").eq("conversation_id", msg.conversation_id).eq("direction", "inbound")
        .order("message_timestamp", { ascending: false }).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (l2.data?.id !== msg.id) return json({ ok: true, ignored: "superseded" });
    }
  }

  let draftId: string;
  if (redo) draftId = redo.draftId;
  else {
    const claim = await db.from("whatsapp_reply_drafts").insert({ company_id: msg.company_id, conversation_id: msg.conversation_id, message_id: msg.id, client_id: msg.client_id, status: "pending", analysis: dry ? { dry_run: true } : {} }).select("id").single();
    if (claim.error) return json({ ok: true, ignored: "already_processed" });
    draftId = claim.data.id;
  }
  // a failed rewrite leaves the owner's waiting draft as it was
  const fail = async (why: string, status = "skipped") => { if (!redo) await db.from("whatsapp_reply_drafts").update({ status, error: why }).eq("id", draftId); return json({ ok: !redo, ignored: why, error: redo ? why : undefined }); };

  try {
    const [rtR, convR, clientR, routesR] = await Promise.all([
      db.from("whatsapp_automation_runtime").select("*").eq("company_id", msg.company_id).single(),
      db.from("whatsapp_conversations").select("*").eq("id", msg.conversation_id).single(),
      db.from("clients").select("id,name,phone,phone_normalized,followup_suppressed,notes").eq("id", msg.client_id).single(),
      db.from("company_lead_routes").select("route_key,whatsapp_number,meta_phone_number_id"),
    ]);
    const rt = rtR.data, conv = convR.data, client = clientR.data;
    if (!rt || (!review && rt.reply_agent_mode === "off")) return fail("agent_off");
    if (!conv || !client) return fail("context_missing", "failed");
    // SQL68: the owner's private line never gets drafts or replies from the agent.
    if (conv.route_key === "owner") return fail("owner_private_route");
    if (conv.agent_muted) { await watch(); return fail("agent_muted"); }
    const to = digits(client.phone_normalized || client.phone);
    const companyNumbers = (routesR.data || []).map((r: any) => digits(r.whatsapp_number)).filter(Boolean);
    if (companyNumbers.includes(to)) return fail("company_number");
    // Ahmed's own number and the staff phones are internal chats: never answered
    const staffR = await db.from("profiles").select("phone").eq("company_id", msg.company_id);
    const staffNums = (staffR.data || []).map((r: any) => digits(r.phone).slice(-8)).filter((x: string) => x.length === 8);
    if (staffNums.includes(to.slice(-8))) return fail("staff_number");
    if (!review && rt.mode === "test" && !(rt.allowed_customer_phones || []).map(digits).includes(to)) return fail("not_allowlisted");
    if (!(rt.allowed_routes || []).includes(conv.route_key)) return fail("route_blocked");
    if (!review && conv.human_handoff_required) { await watch(); return fail("human_handoff_open"); }
    if (!review && client.followup_suppressed) { await watch(); return fail("client_paused"); }

    // someone from the office already answered after this message → stay quiet
    // (an automated reply that went out while the customer was still typing does not count: this newer message still needs its answer)
    const after = await db.from("whatsapp_messages").select("id").eq("conversation_id", conv.id).eq("direction", "outbound").eq("actor_type", "human")
      .gt("message_timestamp", msg.message_timestamp).limit(1);
    if (!review && (after.data || []).length) { await watch(); return fail("staff_replied"); }
    // the office's last reply before this message was typed by a person a short while ago → they are in the chat.
    // Once the agent has answered after them, or a couple of hours passed, the agent carries the conversation on.
    const lastOut = await db.from("whatsapp_messages").select("actor_type,message_timestamp").eq("conversation_id", conv.id).eq("direction", "outbound")
      .lte("message_timestamp", msg.message_timestamp).order("message_timestamp", { ascending: false }).limit(1).maybeSingle();
    const staffInChat = lastOut.data?.actor_type === "human" &&
      new Date(msg.message_timestamp).getTime() - new Date(lastOut.data.message_timestamp).getTime() < STAFF_QUIET_HOURS * 3600 * 1000;
    // a follow-up the owner sent from the daily list hands the chat to the agent; any other message of his keeps it quiet
    let fromList = false;
    if (staffInChat) {
      const since = new Date(new Date(lastOut.data!.message_timestamp).getTime() - 2000).toISOString();
      const [lf, lq] = await Promise.all([
        db.from("whatsapp_visit_followups").select("id").eq("client_id", msg.client_id).eq("send_mode", "owner").gte("sent_at", since).limit(1),
        db.from("whatsapp_outreach_queue").select("id").eq("client_id", msg.client_id).eq("reason", "owner_sent").gte("sent_at", since).limit(1),
      ]);
      fromList = (lf.data || []).length > 0 || (lq.data || []).length > 0;
    }
    if (!review && staffInChat && !fromList) { await watch(); return fail("staff_active"); }
    await watch();
    // the owner of a property we list writes to us: Ahmed answers owners himself
    if (!review) {
      const ow = await db.from("owners").select("id,phone").eq("company_id", msg.company_id).limit(2000);
      const mine = (ow.data || []).filter((o: any) => digits(o.phone).slice(-8) && digits(o.phone).slice(-8) === to.slice(-8)).map((o: any) => o.id);
      if (mine.length) {
        const lp = await db.from("properties").select("id").in("owner_id", mine).in("status", ["available", "reserved"]).eq("archived", false).limit(1);
        if ((lp.data || []).length) return fail("property_owner");
      }
    }

    const [histR, propsR, rulesR, priorR] = await Promise.all([
      db.from("whatsapp_messages").select("id,direction,message_type,body,transcript,media_id,actor_type,message_timestamp,matched_property_id,property_link_key,property_image_analysis")
        .eq("conversation_id", conv.id).lte("message_timestamp", msg.message_timestamp).order("message_timestamp", { ascending: false }).limit(30),
      db.from("properties").select("id,title,internal_name,type,area,wilayat,price,bedrooms,bathrooms,land_size,built_size,listing_purpose,public_details,description,map_url,visit_method,visit_instructions,lockbox_image_url,owner_id,branch_key,rental_terms,rented_units")
        .eq("company_id", msg.company_id).eq("status", "available").eq("archived", false),
      db.from("whatsapp_reply_rules").select("id,situation,approved_reply,category,auto_send,auto_match_regex").eq("company_id", msg.company_id).eq("active", true).order("created_at", { ascending: false }).limit(40),
      db.from("whatsapp_reply_drafts").select("analysis,status").eq("conversation_id", conv.id).in("status", ["sent", "approved", "edited"]),
    ]);
    const history = (histR.data || []).reverse();
    const props = propsR.data || [];
    // the ad text for each property: its description, or else the longest caption of a reel about it
    const capR = props.length ? await db.from("instagram_media_catalog").select("property_id,caption,permalink,likes,comments").in("property_id", props.map((p: any) => p.id)) : { data: [] };
    for (const p of props as any[]) {
      // the video to send when someone asks for it: the reel of this property that did best
      const vids = ((capR as any).data || []).filter((c: any) => c.property_id === p.id && /^https:\/\/(www\.)?instagram\.com\//.test(String(c.permalink || "")))
        .sort((a: any, b: any) => (Number(b.likes || 0) + Number(b.comments || 0)) - (Number(a.likes || 0) + Number(a.comments || 0)));
      p.video = vids[0]?.permalink || null;
      const caps = ((capR as any).data || []).filter((c: any) => c.property_id === p.id).map((c: any) => publicText(c.caption)).sort((a: string, b: string) => b.length - a.length);
      p.marketing = [publicText(p.public_details), publicText(p.description), caps[0] || ""].sort((a: string, b: string) => b.length - a.length)[0] || ""; // the fullest ad text wins
    }
    // A/B/C test: each pinned reply shows the model one wording, picked at random among the active ones
    const ruleIds = (rulesR.data || []).map((r: any) => r.id);
    const varR = ruleIds.length ? await db.from("whatsapp_reply_variants").select("rule_id,label,reply,status").in("rule_id", ruleIds).eq("active", true) : { data: [] };
    const pickedVariant: Record<string, { label: string; reply: string }> = {};
    for (const r of rulesR.data || []) {
      const pool = [{ label: "A", reply: r.approved_reply }, ...((varR as any).data || []).filter((v: any) => v.rule_id === r.id)];
      // a proven wording ("winner") is used 8 times in 10; the rest of the time the others keep being tested
      const winners = pool.filter((v: any) => v.status === "winner");
      const testing = pool.filter((v: any) => v.status !== "winner");
      const from = winners.length && (!testing.length || Math.random() < 0.8) ? winners : (testing.length ? testing : pool);
      pickedVariant[r.id] = from[Math.floor(Math.random() * from.length)];
    }
    const budgetAskedBefore = (priorR.data || []).some((d: any) => d.analysis?.budget_asked_now === true);
    const tokens = await routeTokens(msg.company_id, conv.route_key);
    const pr = await db.from("whatsapp_agent_prompts").select("key,content").in("key", ["brain", "knowledge"]);
    const BRAIN = (pr.data || []).find((x: any) => x.key === "brain")?.content || "";
    const INVESTOR_KNOWLEDGE = (pr.data || []).find((x: any) => x.key === "knowledge")?.content || "";
    if (BRAIN.length < 2000) return fail("prompt_missing", "failed");

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
      const r = await db.from("instagram_media_catalog").select("link_key,caption,property_id,state,project_id").eq("company_id", msg.company_id).in("link_key", [...codes]);
      for (const x of r.data || []) reels[x.link_key] = x;
      // a video can belong to an investment project, or count for identical properties
      const projectIds = [...new Set((r.data || []).map((x: any) => x.project_id).filter(Boolean))];
      if (projectIds.length) {
        const pr = await db.from("investment_projects").select("id,name,developer").in("id", projectIds);
        for (const x of Object.values(reels) as any[]) x.project = (pr.data || []).find((y: any) => y.id === x.project_id) || null;
      }
      const ev = await db.from("property_marketing_events").select("link_key,property_id").eq("company_id", msg.company_id).in("link_key", [...codes]);
      for (const e of ev.data || []) if (reels[e.link_key]) (reels[e.link_key].propertyIds ||= []).push(e.property_id);
    }

    // recently sold or booked: the agent must recognise them and answer with the sold rule, never offer them
    let soldList = "";
    try {
      const sr = await db.from("properties").select("type,area,wilayat,price,status,title").eq("company_id", msg.company_id).in("status", ["sold", "reserved"])
        .eq("archived", false).gte("updated_at", new Date(Date.now() - 150 * 86400000).toISOString()).limit(40);
      soldList = (sr.data || []).map((p: any) => `- ${p.type || "عقار"} | ${[p.area, p.wilayat].filter(Boolean).join("، ")} | ${p.price ? Number(p.price).toLocaleString("en-US") + " ريال" : ""} | ${p.status === "sold" ? "انباع" : "انحجز"}`).join("\n");
    } catch (_) { /* optional */ }
    // the same customer may be talking to the other branch number too
    let otherRoute = "";
    let otherConvId: string | null = null;
    try {
      const oc = await db.from("whatsapp_conversations").select("id,route_key").eq("company_id", msg.company_id).eq("customer_wa_id", conv.customer_wa_id).neq("id", conv.id).neq("route_key", "owner").limit(1).maybeSingle();
      if (oc.data) {
        otherConvId = oc.data.id;
        const om = await db.from("whatsapp_messages").select("direction,message_type,body,transcript").eq("conversation_id", oc.data.id).order("message_timestamp", { ascending: false }).limit(8);
        otherRoute = `محادثة نفس العميل على الرقم الثاني (${oc.data.route_key === "barka" ? "بركاء" : "مسقط"}):\n` + (om.data || []).reverse().map((x: any) => `${x.direction === "inbound" ? "العميل" : "المكتب"}: ${short(x.transcript || x.body || `[${x.message_type}]`, 300)}`).join("\n");
      }
    } catch (_) { /* optional */ }
    const transcript = history.map((h: any) => {
      const who = h.direction === "inbound" ? "العميل" : (h.actor_type === "human" ? "المكتب (شخص)" : "المكتب (رد سابق منك)");
      let text = h.transcript ? `[رسالة صوتية: ${h.transcript}]` : (h.body || (h.message_type === "audio" ? "[رسالة صوتية ما انفهمت]" : `[${h.message_type}]`));
      const key = String(h.property_link_key || "") || ((String(h.body || "").match(IG_RE) || [])[1] ? `instagram:${String(h.body).match(IG_RE)![1]}` : "");
      const reel = key ? reels[key] : null;
      let extra = "";
      if (reel) extra += ` {ريل من حسابنا. وصفه: ${short(reel.caption, 300).replace(/\n+/g, " / ")}${reel.property_id ? ` | عقار مرتبط: ${reel.property_id}` : ""}${reel.project ? ` | عن مشروع استثماري: ${reel.project.name}${reel.project.developer ? ` للمطور ${reel.project.developer}` : ""}` : ""}${(reel.propertyIds || []).length > 1 ? ` | نفس الفيديو لعقارات متطابقة: ${reel.propertyIds.join(" و ")}، إذا واحد راح اعرض الثاني المتوفر` : ""}}`;
      else if (key) extra += " {ريل ما عرفنا وصفه}";
      if (h.matched_property_id) extra += ` {عقار مرتبط: ${h.matched_property_id}}`;
      if (h.property_image_analysis) extra += ` {تحليل الصورة: ${short(JSON.stringify(h.property_image_analysis), 300)}}`;
      const when = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Muscat", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(h.message_timestamp));
      return `[${when}] ${who}: ${short(text, 700)}${extra}`;
    }).join("\n");

    const askedName = await db.from("whatsapp_messages").select("id").eq("conversation_id", conv.id).eq("direction", "outbound").ilike("body", "%اسمك%").limit(1);
    const nameAskedBefore = (askedName.data || []).length > 0 || String(client.notes || "").includes(NAME_NOT_GIVEN);
    const context = [
      `الوقت الحالي في عمان: ${omanNow()}`,
      `الاسم المسجل من الواتساب، مو دليل على اسمه الحقيقي: ${client.name || conv.customer_name || "غير معروف"}`,
      `هل سألناه عن اسمه قبل: ${nameAskedBefore ? "نعم، لا تسأل مرة ثانية أبداً" : "لا"}`,
      `الرقم اللي كلمنا عليه: ${conv.route_key === "barka" ? "رقم بركاء" : "رقم مسقط"}`,
      `هل سألنا عن الميزانية قبل في هذه المحادثة: ${budgetAskedBefore ? "نعم، لا تسأل مرة ثانية أبداً" : "لا"}`,
      `ملخص سابق للعميل: ${conv.ai_summary || "لا يوجد"}`,
      "",
      "العقارات المتاحة الآن (لا تعرض غيرها، ولا تذكر id للعميل):",
      props.map(propLine).join("\n") || "لا يوجد",
      "",
      "عقارات انباعت او انحجزت مؤخراً (لا تعرضها، واذا العميل سأل عنها طبق قاعدة المباع):",
      soldList || "لا يوجد",
      "",
      "معلومات المستثمرين:",
      INVESTOR_KNOWLEDGE,
      "",
      rulesR.data?.length ? "ردود مثبتة اعتمدها المدير:\n" + rulesR.data.map((r: any) => `- rule_id=${r.id} | الموقف: ${r.situation}\n  الرد: ${pickedVariant[r.id].reply}`).join("\n") : "ردود مثبتة: لا يوجد",
      "",
      ...(otherRoute ? [otherRoute, ""] : []),
      "المحادثة (الأقدم أولاً، وآخر سطر هو اللي ترد عليه):",
      transcript,
      ...(redo ? ["", `أمر من المدير لهذا الرد (نفّذه، وهو أهم من أي قاعدة عن طريقة الرد، بس لا تخالف الممنوعات ولا تكتب معلومة مو مكتوبة قدامك): ${redo.instruction}`] : []),
    ].join("\n");

    // photos the customer sent lately (not yet tied to a property) go to the model as images,
    // with the cover of each available property's newest reel to compare against
    const parts: any[] = [{ type: "input_text", text: context }];
    const imgMsgs = history.slice(-15).filter((h: any) => h.direction === "inbound" && h.message_type === "image" && h.media_id && !h.matched_property_id).slice(-2);
    const seenImages: any[] = [];
    for (const h of imgMsgs) {
      const url = await imageDataUrl(tokens, h.media_id);
      if (!url) continue;
      seenImages.push(h);
      parts.push({ type: "input_text", text: `صورة أرسلها العميل (${new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Muscat", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(h.message_timestamp))})${h.body ? ` مع الكلام: ${short(h.body, 200)}` : ""}:` });
      parts.push({ type: "input_image", image_url: url, detail: "high" });
    }
    const docMsgs = history.slice(-20).filter((h: any) => h.direction === "inbound" && h.message_type === "document" && h.media_id).slice(-2);
    let docsSeen = 0, coversSeen = 0;
    for (const h of docMsgs) {
      const url = await imageDataUrl(tokens, h.media_id, /^application\/pdf$/, 8 * 1024 * 1024);
      if (!url) continue;
      docsSeen++;
      parts.push({ type: "input_text", text: `ملف PDF أرسله العميل (${new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Muscat", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(h.message_timestamp))}):` });
      parts.push({ type: "input_file", filename: "file.pdf", file_data: url });
    }
    if (seenImages.length) {
      const covers = await reelCovers(msg.company_id, props.map((p: any) => p.id));
      coversSeen = Object.keys(covers).length;
      for (const p of props as any[]) if (covers[p.id]) {
        parts.push({ type: "input_text", text: `غلاف ريل العقار id=${p.id} (${p.type || "عقار"} ${p.area || ""} ${p.price ? Math.round(Number(p.price) / 1000) + " الف" : ""}):` });
        parts.push({ type: "input_image", image_url: covers[p.id], detail: "low" });
      }
    }
    const ai = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OPENAI_MODEL, store: false, reasoning: { effort: "medium" },
        instructions: BRAIN, input: parts.length > 1 ? [{ role: "user", content: parts }] : context,
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
    // never tell a customer that a property is sold when the CRM still lists it as available
    const SOLD_RE = /ابتاع|انباع|انحجز|تم البيع|مباع/;
    const linkedAvailable = props.some((p: any) => p.id === out.property_id || history.some((h: any) => h.matched_property_id === p.id));
    if (linkedAvailable && texts.some((t) => SOLD_RE.test(t))) {
      texts = texts.filter((t) => !SOLD_RE.test(t));
      if (!texts.length) texts = ["تمام بشوف وارد عليك"];
      out.action = "handoff"; out.handoff_reason = "العقل كان بيقول العقار انباع وهو متوفر في الـ CRM، راجع المحادثة";
    }
    // the ad text goes once per conversation: if a long office message about this property already went out, drop it
    if (prop) {
      const priceKey = prop.price ? String(Math.round(Number(prop.price) / 1000)) : "";
      const sentAd = history.some((h: any) => h.direction === "outbound" && String(h.body || "").length > 250
        && (!priceKey || String(h.body).replace(/[,٬]/g, "").includes(priceKey)));
      if (sentAd) texts = texts.filter((t) => t.length <= 250);
      // after the ad, always ask when they can visit (unless the action already books it)
      const hasAd = texts.some((t) => t.length > 250);
      const asksVisit = texts.some((t) => /تزور|الزيارة|زياره|تشوف/.test(t));
      const waitsBank = /تمويل|البنك|بنك/.test(String(out.request?.followup_note || ""));
      // not after closing words, and not when the visit is already with the owner or was already asked about
      const onlyClosing = texts.every((t) => t.length < 25 && /العفو|الله يسعدك|مبروك|تسلم|حياك/.test(t));
      const visitHandled = history.some((h: any) => h.direction === "outbound" && /تزور|زيار|المالك مباشرة|نسق مع المالك|\[contacts\]/.test(String(h.body || "") + (h.message_type === "contacts" ? "[contacts]" : "")));
      if (texts.length && !onlyClosing && !waitsBank && (hasAd || sentAd) && !asksVisit && out.action === "none" && !visitHandled) texts.push("متى يناسبك تزور ؟");
    }
    out.reply_messages = texts.slice(0, 3);
    // a pinned reply only counts when the id is real
    const rule = (rulesR.data || []).find((r: any) => r.id === out.matched_rule_id) || null;
    out.matched_rule_id = rule?.id || null;
    out.variant_label = rule ? pickedVariant[rule.id].label : null;
    // other ways to say it, for the owner to pick from (investors)
    out.alternatives = (out.alternatives || []).map((a: string[]) => (a || []).map((t) => humanize(t)).filter(Boolean).slice(0, 3)).filter((a: string[]) => a.length).slice(0, 2);
    let outgoing: any[] = out.reply_messages.map((t: string) => ({ type: "text", text: { preview_url: false, body: t } }));
    
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
        // the location goes with the owner's number: the customer arranges the visit with him directly
        if (prop.map_url) outgoing.push({ type: "text", text: { preview_url: true, body: prop.map_url } });
        if (o.data?.phone) outgoing.push({ type: "text", text: { preview_url: false, body: digits(o.data.phone) } });
        else { out.action = "handoff"; out.handoff_reason = "رقم المالك غير مسجل"; }
      } else { out.action = "handoff"; out.handoff_reason = "طلب معاينة تحتاج تنسيق"; }
    }

    // A pinned reply that says "we have none" was right on the day it was pinned; once a rental is in
    // the CRM it may be wrong, so it waits for the owner instead of going out on its own.
    const saysNone = /ما\s*(معنا|عندنا)|ما\s*(في|متوفر)|مو\s*متوفر|غير\s*متوفر/.test(out.reply_messages.join(" "));
    const staleNone = saysNone && out.category === "tenant" && props.some((p: any) => p.listing_purpose === "rent");
    // approval mode still sends on its own when the owner switched the category on and the reply is a pinned one
    // a pinned reply marked auto_send goes out on its own only when what the customer wrote since our last
    // message really is that situation: "^..." patterns must match every message (a bare greeting, nothing after
    // it), other patterns must appear in one of them (the salary-prompt question)
    let ruleAuto = false;
    if (rule?.auto_send && rule.auto_match_regex && out.action === "none") {
      let lastOut = -1; history.forEach((h: any, i: number) => { if (h.direction === "outbound") lastOut = i; });
      const burst = history.slice(lastOut + 1).filter((h: any) => h.direction === "inbound" && !["edit", "revoke", "reaction", "system", "unsupported"].includes(h.message_type));
      const texts2 = burst.map((h: any) => (h.message_type === "text" ? String(h.body || "") : "\u0000" + h.message_type).trim());
      try {
        const re = new RegExp(rule.auto_match_regex, "i");
        ruleAuto = texts2.length > 0 && (rule.auto_match_regex.startsWith("^") ? texts2.every((t: string) => re.test(t)) : texts2.some((t: string) => re.test(t)));
      } catch (_) { ruleAuto = false; }
      if (ruleAuto) {
        out.reply_messages = String(pickedVariant[rule.id].reply).split("\n").map((t) => t.trim()).filter(Boolean).slice(0, 3);
        outgoing = out.reply_messages.map((t: string) => ({ type: "text", text: { preview_url: false, body: t } }));
      }
    }
    const autoSend = !review && rt.reply_agent_mode === "approval" && !!rule && out.reply_messages.length > 0 && !staleNone
      && ["none", "handoff"].includes(out.action) && (ruleAuto || (rt.auto_send_categories || []).includes(out.category));
    const analysis: any = { ...out, property_id: prop?.id || null, model: OPENAI_MODEL, dry_run: dry, images_seen: seenImages.length, covers_seen: coversSeen, docs_seen: docsSeen, auto_sent: autoSend, transcribed: pendingAudio.filter((a: any) => a.transcript).length,
      ...(redo ? { owner_instruction: redo.instruction, rewritten_at: new Date().toISOString() } : {}) };
    // the customer carries on with the other branch number about the same thing: close what waits there
    if (!review && out.close_other_branch && otherConvId) {
      try {
        await db.from("whatsapp_reply_drafts").update({ status: "superseded", superseded_at: new Date().toISOString(), approver_note: "العميل يكمل نفس الموضوع على الرقم الثاني" }).eq("conversation_id", otherConvId).eq("status", "pending");
        await db.from("whatsapp_outreach_queue").update({ status: "skipped", reason: "other_branch" }).eq("conversation_id", otherConvId).eq("status", "pending");
      } catch (_) { /* optional */ }
    }
    // the client said their name, or was asked once and did not: the note says the saved name is not their real one
    if (!review && (out.client_name_stated || out.name_declined)) {
      try {
        const stated = String(out.client_name_stated || "").trim().slice(0, 60);
        const notes = String(client.notes || "");
        if (stated) await db.from("clients").update({ name: stated, notes: notes.replace(NAME_NOT_GIVEN, "").trim() || null }).eq("id", client.id);
        else if (!notes.includes(NAME_NOT_GIVEN)) await db.from("clients").update({ notes: notes ? `${notes}\n${NAME_NOT_GIVEN}` : NAME_NOT_GIVEN }).eq("id", client.id);
      } catch (e) { console.error("[reply-agent] client name", String((e as any)?.message || e)); }
    }
    // an owner who wants to sell is kept as an unlisted offer, so buyers looking for the same thing are found
    if (!review && out.category === "seller" && out.owner_offer && (out.owner_offer.area || out.owner_offer.wilayat)) {
      try {
        const ex = await db.from("owner_leads").select("id").eq("conversation_id", conv.id).limit(1);
        const o = out.owner_offer;
        const row = { kind: o.kind, area: o.area, wilayat: o.wilayat, price: o.price, land_size: o.land_size, built_size: o.built_size, notes: short(out.crm_note, 1000), updated_at: new Date().toISOString() };
        if ((ex.data || []).length) await db.from("owner_leads").update(row).eq("id", ex.data![0].id);
        else await db.from("owner_leads").insert({ ...row, company_id: msg.company_id, client_id: client.id, conversation_id: conv.id });
        await db.rpc("crm_match_owner_leads");
      } catch (e) { console.error("[reply-agent] owner lead", String((e as any)?.message || e)); }
    }
    // an owner sent everything (kroki or house details, and the price): a price study goes on Ahmed's task list
    if (!review && out.action === "handoff" && /^دراسة سعر/.test(String(out.handoff_reason || ""))) {
      try {
        const o = await db.from("profiles").select("id").eq("company_id", msg.company_id).eq("role", "owner").eq("is_active", true).limit(1).maybeSingle();
        const open = await db.from("tasks").select("id").eq("client_id", client.id).ilike("title", "دراسة سعر%").eq("done", false).limit(1);
        if (!(open.data || []).length) await db.from("tasks").insert({ company_id: msg.company_id, user_id: o.data?.id || null, client_id: client.id, title: short(out.handoff_reason, 200), notes: short(out.crm_note, 1000), due_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10), done: false });
      } catch (e) { console.error("[reply-agent] task", String((e as any)?.message || e)); }
    }
    if (redo) {
      // only while it still waits: if it was sent or rejected meanwhile, nothing changes
      const u = await db.from("whatsapp_reply_drafts").update({ analysis, reply_messages: out.reply_messages }).eq("id", draftId).eq("status", "pending").select("id");
      if (!(u.data || []).length) return json({ ok: false, error: "draft_not_pending" }, 409);
      return json({ ok: true, status: "rewritten", reply_messages: out.reply_messages, action: out.action, analysis });
    }
    // an owner Ahmed is already handling himself (he wrote to him in this chat, or a price study is under way): the agent stays out
    const ownerWithAhmed = out.category === "seller" && (
      history.some((h: any) => h.direction === "outbound" && h.actor_type === "human") ||
      (priorR.data || []).some((d: any) => /^دراسة سعر/.test(String(d.analysis?.handoff_reason || ""))));
    analysis.owner_with_ahmed = ownerWithAhmed;
    if (!review && ownerWithAhmed) {
      await db.from("whatsapp_reply_drafts").update({ analysis, reply_messages: out.reply_messages, status: "skipped", error: "owner_with_ahmed" }).eq("id", draftId);
      return json({ ok: true, ignored: "owner_with_ahmed" });
    }
    // a client who came from a project video is an investor, and his replies wait for the owner like any investor
    if (Object.values(reels).some((x: any) => x.project)) out.category = "investor";
    // live ("direct"): everything goes out on its own except investors and running deals, which wait for the owner
    const holdForOwner = rt.reply_agent_mode === "direct" && ["investor", "active_deal"].includes(out.category);
    if (dry || holdForOwner || (rt.reply_agent_mode === "approval" && !autoSend)) {
      // nothing to say (closing words, the other branch handles it): no empty card in the approval screen
      const nothing = !dry && !out.reply_messages.length && out.action === "none";
      await db.from("whatsapp_reply_drafts").update({ analysis, reply_messages: out.reply_messages, status: nothing ? "skipped" : "pending", error: nothing ? "no_reply_needed" : null }).eq("id", draftId);
      return json({ ok: true, status: "awaiting_approval" });
    }

    // the customer wrote again while this reply was being prepared: the newer message's run answers everything
    const newer = await db.from("whatsapp_messages").select("id").eq("conversation_id", conv.id).eq("direction", "inbound").gt("message_timestamp", msg.message_timestamp).limit(1);
    if ((newer.data || []).length) {
      await db.from("whatsapp_reply_drafts").update({ analysis, reply_messages: out.reply_messages, status: "superseded", error: "newer_message" }).eq("id", draftId);
      return json({ ok: true, ignored: "newer_message" });
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
          channel_source: "crm_reply_agent", raw_payload: { source: autoSend ? "reply_agent_auto_pinned" : "reply_agent_v1", draft_id: draftId, rule_id: rule?.id || null, variant: out.variant_label },
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
    // keep what the client is looking for in their open request, so a matching listing can be sent later
    try {
      const rq = out.request;
      if (rq && (rq.areas?.length || rq.property_types?.length || rq.budget_max || rq.bedrooms_min)) {
        const patch: any = { request_type: rq.request_type, updated_at: now, last_contact_at: now };
        if (rq.areas?.length) { patch.preferred_areas = rq.areas.slice(0, 6); patch.preferred_area = rq.areas[0]; }
        if (rq.property_types?.length) { patch.property_types = rq.property_types.slice(0, 4); patch.property_type = rq.property_types[0]; }
        if (rq.budget_max) patch.budget_max = rq.budget_max;
        if (rq.bedrooms_min) patch.bedrooms_min = rq.bedrooms_min;
        if (rq.followup_in_days && rq.followup_in_days > 0) { patch.next_followup = new Date(Date.now() + Math.min(rq.followup_in_days, 120) * 86400000).toISOString(); patch.followup_note = short(rq.followup_note || "متابعة", 300); }
        patch.ai_extracted = { ...rq, source: "reply_agent", at: now }; // never overwrite staff notes
        const open = await db.from("client_requests").select("id").eq("client_id", client.id).eq("status", "active").order("created_at", { ascending: false }).limit(1).maybeSingle();
        const w = open.data
          ? await db.from("client_requests").update(patch).eq("id", open.data.id)
          : await db.from("client_requests").insert({ ...patch, company_id: msg.company_id, client_id: client.id, route_key: conv.route_key, created_via: "ai", origin_whatsapp_message_id: msg.id, source: "whatsapp" });
        if (w.error) console.error("[reply-agent] request", w.error.message);
      }
    } catch (e) { console.error("[reply-agent] request", String((e as any)?.message || e)); }
    if (prop && seenImages.length && out.source === "image") {
      try { await db.from("whatsapp_messages").update({ matched_property_id: prop.id }).eq("id", seenImages[seenImages.length - 1].id).is("matched_property_id", null); } catch (_) { /* optional */ }
    }
    await db.from("whatsapp_automation_events").insert({
      company_id: msg.company_id, conversation_id: conv.id, message_id: msg.id, client_id: client.id, property_id: prop?.id || null,
      action_type: "reply_agent_v1", status: "applied", confidence: 1, reason: short(out.intent, 500), payload: analysis, applied_at: now,
    });
    return json({ ok: true, sent: sentIds.length, action: out.action });
  } catch (e) {
    const why = short((e as any)?.message || e, 800);
    if (!redo) await db.from("whatsapp_reply_drafts").update({ status: "failed", error: why }).eq("id", draftId);
    // the customer got no answer: Ahmed has to know
    if (!review) {
      try {
        const c = await db.from("whatsapp_conversations").select("id,assigned_to,customer_name").eq("id", msg.conversation_id).maybeSingle();
        const cl = await db.from("clients").select("id,name,phone").eq("id", msg.client_id).maybeSingle();
        if (c.data && cl.data) await notifyHandoff(msg.company_id, c.data, cl.data, "العقل ما قدر يرد على آخر رسالة، رد عليه انت (" + short(why, 120) + ")");
      } catch (_) { /* optional */ }
    }
    return json({ ok: false, error: why }, 500);
  }
});
