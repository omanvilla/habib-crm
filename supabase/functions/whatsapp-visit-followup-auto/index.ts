// Daily follow-ups (owner's decisions, 5 Nov 2026). Called by cron with the reply-agent secret.
// 1. Reads each waiting follow-up's whole chat, voice notes included. It either writes a text for this client to send
//    from the branch phone, removes it (owner offering, moved to the other branch, topic closed), or saves what the client wants.
// 2. Owner's decision, 6 Nov: this function never sends a paid template. What needs one stays on his list with the text
//    ready, and he sends it from the branch phone. What he has not sent by 10am the next day goes only if it is still free.
// 3. 90 minutes after a visit it asks the client's opinion as free text inside the 24 hour window, never a template (SQL68).
// 4. If the window would close before that moment, it asks the client to confirm the visit while the window is still open,
//    so a reply keeps the after-visit follow-up free (SQL70).
// Stops when whatsapp_automation_runtime.visit_followups_auto is false. A failed send stays on the list.
import { createClient } from "npm:@supabase/supabase-js@2";

const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const OPENAI_MODEL = Deno.env.get("REPLY_AGENT_MODEL") || Deno.env.get("OPENAI_MODEL") || "gpt-5.6-luna";
const GRAPH = Deno.env.get("META_GRAPH_VERSION") || "v25.0";
const WINDOW_MS = 24 * 3600 * 1000;
const REVIEWS_PER_RUN = 24, REVIEWS_AT_ONCE = 6, AFTER_VISIT_PER_RUN = 10;

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
- skip: ما يحتاج متابعة. مثل: مالك أو وسيط يعرض عقار أو بناية، أو حولناه للرقم الثاني أو موضوعه ماشي هناك، أو موضوعه انتهى، أو اشترى أو حصل، أو قال ما يبغى، أو مو عميل يدور عقار (موظف، بنك، شركة، مقاول). وكذلك: سأل عن عقار واستلم التفاصيل أو الموقع وبعدها ما رد ولا طلب زيارة، سكوته جواب.
- wait_for_match: شاف أو سأل ووضح اللي يبغاه، وما عندنا الحين شي يناسبه. سؤال "لين الحين تبحث" ما له داعي. مثال: شاف فيلا وسأل عن السعر النهائي وقال ما يناسبه قيد الإنشاء ويدور جاهز. احفظ اللي يبغاه في request، ونرسله لما يتوفر.
- followup: في سبب حقيقي نتابعه، وهو واحد من هذي بس: طلب زيارة أو تحدد له موعد وما نعرف النتيجة، أو زار والكلام لسه مفتوح، أو سأل سؤال وما جاه رد، أو في القائمة عقار متاح يطابق اللي قال يبغاه. إذا في القائمة عقار متاح يطابق اللي يبغاه، اعرضه في text باختصار.

التفاوض لصاحب المكتب بس: لا تفتح موضوع السعر ولا تخفيض في text.
إذا فيه "[رسالة صوتية قديمة ما انقرت]" قريب من آخر المحادثة، ما تعرف اللي انقال فيها: لا تخمن، قل هذا في reason، وخل auto_ok=false.

text (لـ followup بس): رسالة واحدة يرسلها صاحب المكتب بنفسه باللهجة العمانية البسيطة. إذا واضح من الاسم أو الكلام إنها امرأة خاطبها بالمؤنث. تبدأ بـ "السلام عليكم". سطر أو سطرين، خاصة بهذا العميل، وسؤال واحد ينتهي بـ " ؟". لا تكرر سؤال انجاب عليه، واقرأ ردود المكتب الصوتية كاملة قبل ما تقول إن سؤاله ما انجاب. لا تخترع شي مو مكتوب. لا تنقل كلمات وقت من كلام قديم (اليوم، بكرة، أمس، بعد الصلاة، الساعة)، اسأل عن العقار نفسه بدون وقت. لا تناديه باسم إلا إذا قاله بنفسه في المحادثة، اسم الواتساب مو دليل على اسمه. ممنوع: الفواصل والنقاط وعلامات التعجب، الأسعار إلا سعر عقار تعرضه، الوعود، كلمة هلا.
reason: سطر قصير لصاحب المكتب يوضح وضع العميل، مثل "شاف فيلا الرميس وما عجبه الموقع".
auto_ok: true بس إذا النص الثابت "${"{fixed}"}" مناسب لهذا العميل لو انرسل بدل text. إذا العميل سأل سؤال وما جاه رد، auto_ok=false.
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
  return `[${String(m.message_timestamp).slice(0, 10)}] ${who}: ${short(body, 3000)}`;
};
const chatOf = async (conversationId: string, limit: number) => {
  const r = await db.from("whatsapp_messages").select("direction,body,transcript,message_type,message_timestamp").eq("conversation_id", conversationId).order("message_timestamp", { ascending: false }).limit(limit);
  return (r.data || []).reverse().map(lineOf).join("\n");
};

async function review(item: any, companyId: string, available: string, fixed: string, about: string) {
  const chat = item.conversation_id ? await chatOf(item.conversation_id, 40) : "";
  const others = await db.from("whatsapp_conversations").select("id,route_key").eq("company_id", companyId).eq("client_id", item.client_id).neq("id", item.conversation_id || "00000000-0000-0000-0000-000000000000").limit(2);
  const person = await db.from("clients").select("name").eq("id", item.client_id).maybeSingle();
  let other = "";
  for (const c of others.data || []) other += `\nمحادثته على رقم ${c.route_key === "barka" ? "بركاء" : "مسقط"}:\n${await chatOf(c.id, 12)}\n`;
  const ai = await fetch("https://api.openai.com/v1/responses", {
    method: "POST", headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: OPENAI_MODEL, store: false, reasoning: { effort: "low" }, instructions: REVIEW_RULES.replace("{fixed}", fixed),
      input: `تاريخ اليوم: ${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Muscat" }).format(new Date())}\nسبب وجوده في القائمة: ${about}\nالاسم المسجل من الواتساب، يفيد بس لمعرفة إذا امرأة: ${person.data?.name || "غير معروف"}\nرقمنا اللي نتابع منه: ${item.route_key === "barka" ? "بركاء" : "مسقط"}\n\nالعقارات المتاحة الآن:\n${available || "لا يوجد"}\n\nالمحادثة:\n${chat || "ما في محادثة مسجلة"}\n${other}`,
      text: { format: { type: "json_schema", name: "followup_review", strict: true, schema: reviewSchema } } }),
  });
  const p = await ai.json().catch(() => ({}));
  if (!ai.ok) throw new Error(p?.error?.message || `openai_${ai.status}`);
  const out = JSON.parse(p.output_text || p.output?.flatMap((x: any) => x?.content || []).find((x: any) => x?.type === "output_text")?.text || "{}");
  out.text = out.text ? String(out.text).replace(/[،,!]/g, " ").replace(/\.(\s|$)/g, "$1").replace(/\s*[؟?]/g, " ؟").replace(/\s+/g, " ").trim() : null;
  if (out.text && !out.text.startsWith("السلام عليكم")) out.text = `السلام عليكم ${out.text}`;
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

async function judge(kind: "visit" | "request", x: any, companyId: string, available: string) {
  // a new voice note still being transcribed: read this client on a later run, so nothing reaches him half read
  if (x.conversation_id) {
    const pending = await db.from("whatsapp_messages").select("id").eq("conversation_id", x.conversation_id).eq("message_type", "audio").is("transcript", null).gte("message_timestamp", new Date(Date.now() - 48 * 3600 * 1000).toISOString()).limit(1);
    if ((pending.data || []).length) throw new Error("voice_note_pending");
  }
  let about = "متابعة طلب: هل لين الحين يبحث";
  if (kind === "visit") {
    const v = await db.from("viewings").select("viewing_date,status,properties(type,area)").eq("id", x.viewing_id).maybeSingle();
    const pr: any = (v.data as any)?.properties;
    about = `متابعة بعد زيارة ${pr?.type || "عقار"} في ${pr?.area || "غير معروف"} يوم ${v.data?.viewing_date || "غير معروف"}. ${v.data?.status === "done" ? "الزيارة تمت" : "ما نعرف هل زار"}.`;
    if (x.after_visit) about += " هذي متابعة بعد موعد الزيارة بساعة ونص، وهذا أهم وقت للبيع. قرارك followup واسأله عن رأيه في العقار بالضبط، إلا إذا المحادثة تقول إنه ما زار أو موضوعه انتهى أو قال رأيه.";
  }
  const fixed = kind === "visit" ? String(x.body || "") : (x.messages || []).join(" ");
  return review(x, companyId, available, fixed, about);
}

async function reviewOne(kind: "visit" | "request", x: any, companyId: string, available: string) {
  const now = new Date().toISOString();
  const table = kind === "visit" ? "whatsapp_visit_followups" : "whatsapp_outreach_queue";
  const openStatus = kind === "visit" ? "awaiting_approval" : "pending";
  const out = await judge(kind, x, companyId, available);
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

async function availableText(companyId: string) {
  const props = await db.from("properties").select("type,area,price,bedrooms,listing_purpose,public_details,rented_units").eq("company_id", companyId).eq("status", "available").eq("archived", false);
  return (props.data || []).map((p: any) => `- ${p.type} ${p.listing_purpose === "rent" ? "للإيجار" : "للبيع"} في ${p.area} بـ ${Number(p.price || 0).toLocaleString("en-US")} ${p.bedrooms ? `${p.bedrooms} غرف` : ""}${p.rented_units ? ` | المؤجر حالياً: ${short(p.rented_units, 200)}` : ""}${p.public_details ? ` | التفاصيل: ${short(p.public_details, 700).replace(/\n+/g, " / ")}` : ""}`).join("\n");
}

// Reads what is on the list again under the current rules and returns the decisions. Writes nothing.
// Follow-ups the owner decided himself (they carry a reason) are left out.
async function preview(companyId: string, offset: number) {
  const f = await db.from("whatsapp_visit_followups").select("id,client_id,route_key,conversation_id,viewing_id,step,body").eq("company_id", companyId).eq("status", "awaiting_approval").not("reviewed_at", "is", null).order("id");
  const q = await db.from("whatsapp_outreach_queue").select("id,client_id,route_key,conversation_id,request_id,messages").eq("company_id", companyId).eq("status", "pending").eq("kind", "request_followup").eq("dry_run", false).is("reason", null).not("reviewed_at", "is", null).order("id");
  const all: ["visit" | "request", any][] = [...(f.data || []).map((x: any) => ["visit", x] as ["visit", any]), ...(q.data || []).map((x: any) => ["request", x] as ["request", any])];
  const jobs = all.slice(offset, offset + REVIEWS_PER_RUN);
  const names = await db.from("clients").select("id,name").in("id", jobs.map(([, x]) => x.client_id));
  const nameOf = new Map((names.data || []).map((c: any) => [c.id, c.name]));
  const available = await availableText(companyId);
  const items: any[] = [];
  for (let i = 0; i < jobs.length; i += REVIEWS_AT_ONCE) {
    await Promise.all(jobs.slice(i, i + REVIEWS_AT_ONCE).map(async ([kind, x]) => {
      try { const r = await judge(kind, x, companyId, available); items.push({ kind, id: x.id, client: nameOf.get(x.client_id), route: x.route_key, decision: r.decision, reason: short(r.reason, 200), text: r.text, request: r.request }); }
      catch (e) { items.push({ kind, id: x.id, client: nameOf.get(x.client_id), error: String((e as any)?.message || e) }); }
    }));
  }
  return { total: all.length, offset, items };
}

async function reviewAll(companyId: string, out: Record<string, number>) {
  const f = await db.from("whatsapp_visit_followups").select("id,client_id,route_key,conversation_id,viewing_id,step,body").eq("company_id", companyId).eq("status", "awaiting_approval").is("reviewed_at", null).limit(REVIEWS_PER_RUN);
  const left = REVIEWS_PER_RUN - (f.data || []).length;
  const q = left > 0 ? await db.from("whatsapp_outreach_queue").select("id,client_id,route_key,conversation_id,request_id,messages").eq("company_id", companyId).eq("status", "pending").eq("kind", "request_followup").eq("dry_run", false).is("reviewed_at", null).limit(left) : { data: [] as any[] };
  const jobs: ["visit" | "request", any][] = [...(f.data || []).map((x: any) => ["visit", x] as ["visit", any]), ...((q as any).data || []).map((x: any) => ["request", x] as ["request", any])];
  if (!jobs.length) return;
  const available = await availableText(companyId);
  for (let i = 0; i < jobs.length; i += REVIEWS_AT_ONCE) {
    await Promise.all(jobs.slice(i, i + REVIEWS_AT_ONCE).map(async ([kind, x]) => {
      try { const r = await reviewOne(kind, x, companyId, available); out[r] = (out[r] || 0) + 1; }
      catch (e) { out.review_failed = (out.review_failed || 0) + 1; console.error("[followup-auto] review", String((e as any)?.message || e)); }
    }));
  }
}

// Free text only: if the window closed meanwhile it stays on the daily list and no template goes.
async function afterVisit(companyId: string, numbers: string[], out: Record<string, number>) {
  const q = await db.rpc("crm_queue_fast_visit_followups", { p_limit: AFTER_VISIT_PER_RUN });
  if (q.error) { console.error("[followup-auto] after visit", q.error.message); return; }
  const ids: string[] = (q.data || []);
  if (!ids.length) return;
  const available = await availableText(companyId);
  for (const id of ids) {
    try {
      const x = await db.from("whatsapp_visit_followups").select("*").eq("id", id).single();
      if (x.error || x.data.company_id !== companyId) continue;
      const r = await reviewOne("visit", { ...x.data, after_visit: true }, companyId, available);
      const k = `after_visit_${r}`; out[k] = (out[k] || 0) + 1;
      if (r !== "kept") continue;
      const f = await db.from("whatsapp_visit_followups").select("*").eq("id", id).single();
      const s = await sendOne(f.data, numbers);
      const k2 = `after_visit_${s}`; out[k2] = (out[k2] || 0) + 1;
    } catch (e) { out.after_visit_failed = (out.after_visit_failed || 0) + 1; console.error("[followup-auto] after visit", String((e as any)?.message || e)); }
  }
}

// "اليوم الساعة 4 العصر"; with no saved time only the day
function visitWhen(date: string, time: string | null) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Muscat" }).format(new Date());
  const day = date === today ? "اليوم" : "بكرة";
  if (!time) return day;
  const [h, m] = time.split(":").map(Number);
  const part = h < 12 ? "الصبح" : h < 15 ? "الظهر" : h < 18 ? "العصر" : h < 20 ? "المغرب" : "الليل";
  const mins = m === 30 ? " ونص" : m ? `:${String(m).padStart(2, "0")}` : "";
  return `${day} الساعة ${h % 12 || 12}${mins} ${part}`;
}

// Free text inside the window. One per visit: the message itself is the record.
async function confirmBeforeVisit(companyId: string, numbers: string[], out: Record<string, number>) {
  const c = await db.rpc("crm_visit_confirm_candidates");
  if (c.error) { console.error("[followup-auto] confirm", c.error.message); return; }
  for (const v of (c.data || []).filter((x: any) => x.company_id === companyId).slice(0, AFTER_VISIT_PER_RUN)) {
    const to = digits(v.phone);
    if (!to || numbers.includes(to)) continue;
    const body = `السلام عليكم نأكد موعد زيارة العقار في ${v.area || "الموقع"} ${visitWhen(v.viewing_date, v.viewing_time)} ؟`;
    const now = new Date().toISOString();
    try {
      const wamid = await metaSend(await routeTokens(companyId, v.route_key), digits(v.meta_phone_number_id), to, { type: "text", text: { preview_url: false, body } });
      if (wamid) await db.from("whatsapp_messages").insert({
        company_id: companyId, conversation_id: v.conversation_id, client_id: v.client_id, whatsapp_message_id: wamid,
        direction: "outbound", message_type: "text", sender_wa_id: digits(v.meta_phone_number_id), recipient_wa_id: to,
        body, message_timestamp: now, delivery_status: "sent", actor_type: "automated", channel_source: "crm_followup",
        raw_payload: { source: "visit_confirm", viewing_id: v.viewing_id, auto: true },
      });
      await db.from("whatsapp_conversations").update({ last_message_at: now, last_outbound_at: now, updated_at: now }).eq("id", v.conversation_id);
      out.confirm_sent = (out.confirm_sent || 0) + 1;
    } catch (e) { out.confirm_failed = (out.confirm_failed || 0) + 1; console.error("[followup-auto] confirm", String((e as any)?.message || e)); }
  }
}

// Free text inside the 24 hour window only.
async function sendOne(f: any, numbers: string[]) {
  const stop = async (status: string, why: string) => { await db.from("whatsapp_visit_followups").update({ status, error: why, updated_at: new Date().toISOString() }).eq("id", f.id).eq("status", "awaiting_approval"); return why; };
  const [convR, clientR, lastInR] = await Promise.all([
    db.from("whatsapp_conversations").select("*").eq("id", f.conversation_id).single(),
    db.from("clients").select("id,phone,phone_normalized,followup_suppressed,archived").eq("id", f.client_id).single(),
    db.from("whatsapp_messages").select("message_timestamp").eq("conversation_id", f.conversation_id).eq("direction", "inbound").order("message_timestamp", { ascending: false }).limit(1).maybeSingle(),
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
  if (!service) return "window_closed";
  const claim = await db.from("whatsapp_visit_followups").update({ status: "sending" }).eq("id", f.id).eq("status", "awaiting_approval").select("id").maybeSingle();
  if (claim.error || !claim.data) return "taken";
  const body = f.owner_text || f.body;
  const payload = { type: "text", text: { preview_url: false, body } };
  const now = new Date().toISOString();
  try {
    const wamid = await metaSend(await routeTokens(f.company_id, f.route_key), digits(conv.meta_phone_number_id), to, payload);
    if (wamid) await db.from("whatsapp_messages").insert({
      company_id: f.company_id, conversation_id: conv.id, client_id: f.client_id, whatsapp_message_id: wamid,
      direction: "outbound", message_type: "text", sender_wa_id: digits(conv.meta_phone_number_id), recipient_wa_id: to,
      body, message_timestamp: now, delivery_status: "sent", actor_type: "automated", channel_source: "crm_followup",
      raw_payload: { source: "visit_followup", followup_id: f.id, step: f.step, viewing_id: f.viewing_id, auto: true },
    });
    await db.from("whatsapp_visit_followups").update({ status: "sent", send_mode: "service", sent_at: now, meta_message_id: wamid, decided_at: now, error: null, updated_at: now }).eq("id", f.id);
    await db.from("whatsapp_conversations").update({ last_message_at: now, last_outbound_at: now, updated_at: now }).eq("id", conv.id);
    return "sent";
  } catch (e) {
    // stays on the list
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
  await db.from("notifications").insert({ user_id: o.data.id, type: "system_alert", is_read: false, link: "dash", title, body: short(`المتابعة باقية في قائمتك. الرسالة: ${why}`, 400) });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false }, 405);
  const ok = await db.rpc("crm_reply_agent_secret_ok", { p_secret: req.headers.get("x-crm-agent") || "" });
  if (ok.error || ok.data !== true) return json({ ok: false, error: "forbidden" }, 403);
  const input = await req.json().catch(() => ({}));
  if (input?.preview) {
    const co = await db.from("whatsapp_automation_runtime").select("company_id").eq("mode", "live").limit(1).maybeSingle();
    return json({ ok: true, ...(await preview(co.data?.company_id, Number(input.offset) || 0)) });
  }
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Muscat", hour: "2-digit", hour12: false }).format(new Date()));
  if (hour < 9 || hour >= 21) return json({ ok: true, reason: "outside_hours" });
  const rts = await db.from("whatsapp_automation_runtime").select("company_id,mode,visit_followups_auto");
  const out: Record<string, number> = {};
  const routes = await db.from("company_lead_routes").select("whatsapp_number");
  const numbers = (routes.data || []).map((r: any) => digits(r.whatsapp_number)).filter(Boolean);
  for (const rt of rts.data || []) {
    if (rt.mode !== "live") continue;
    if (rt.visit_followups_auto) await confirmBeforeVisit(rt.company_id, numbers, out);
    if (rt.visit_followups_auto) await afterVisit(rt.company_id, numbers, out);
    await reviewAll(rt.company_id, out);
    if (!rt.visit_followups_auto) continue;
    const list = await db.from("whatsapp_visit_followups").select("*").eq("company_id", rt.company_id).eq("status", "awaiting_approval").order("due_at").limit(60);
    let failed = false;
    for (const f of list.data || []) {
      if (failed) break;
      // only what the review kept and said is safe to send without him
      if (!f.reviewed_at || !f.auto_ok || Date.now() < autoAfter(f.reviewed_at)) continue;
      const r = await sendOne(f, numbers);
      out[r] = (out[r] || 0) + 1;
      if (r === "failed") failed = true;
      if (r === "sent") await new Promise((x) => setTimeout(x, 1500));
    }
  }
  return json({ ok: true, results: out });
});
