// Reply audit (19 Nov 2026, Ahmed: «فاحص الردود الآلية مرتين باليوم … تطوير لمدرّب الردود الموجود»).
// 07:30 and 14:30 Muscat (cron reply_audit_morning / reply_audit_afternoon, SQL144). Each run covers from the last run to now:
//  - replies the agent sent, drafts it skipped («no_reply_needed»), drafts that failed, chats left with no reply
//  - each chat with an agent reply is judged by the model against the brain, whatsapp_reply_rules, docs/agent-rules.md
//    (rules.ts, generated) and the mistakes we already fixed (KNOWN_MISTAKES), with the property list beside it
//  - at most 5 findings per report, same type grouped in one item with the count; a type a pinned rule covers is a repeat
//  - open findings of earlier reports are listed first («باقي من قبل») and not written again
//  - critical (invented price / fact, sold or reserved property offered, serious buyer not handed to Ahmed): the agent is
//    muted on that chat at once (agent_muted, cleared by «كمّل يا عقل») and Ahmed is told on WhatsApp + CRM right away
//  - the report goes every time, also with nothing wrong: how many replies, who got them, system health
// Ahmed decides in the Claude chat (crm_reply_audit_open / _decide / _apply). Nothing here changes what customers receive,
// except muting the agent on a chat with a critical mistake.
// Calls: x-crm-agent secret. Body: {trigger?, hours?, dry?, wait?}. dry = judge and return the report, write and send nothing.
import { createClient } from "npm:@supabase/supabase-js@2";
import { RULES_DIGEST } from "./rules.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const db = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false, autoRefreshToken: false } });
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const MODEL = Deno.env.get("REPLY_AUDIT_MODEL") || Deno.env.get("REPLY_COACH_MODEL") || Deno.env.get("REPLY_AGENT_MODEL") || Deno.env.get("OPENAI_MODEL") || "gpt-5.6-luna";
const MAX_FINDINGS = 5, CHUNK = 10, MAX_CHATS = 70;
const short = (v: unknown, n = 600) => { const s = String(v ?? "").replace(/\s+\n/g, "\n").trim(); return s.length > n ? s.slice(0, n) + "…" : s; };
const id8 = (v: unknown) => String(v || "").slice(0, 8);

export const TYPES: Record<string, { label: string; critical?: boolean }> = {
  invented_info: { label: "سعر أو معلومة غلط أو مخترعة", critical: true },
  sold_offered: { label: "عرض عقار انباع أو انحجز", critical: true },
  serious_not_handed: { label: "مشتري جاد أو تفاوض ما تحوّل لأحمد", critical: true },
  call_not_handed: { label: "طلب اتصال ما تحوّل لأحمد" },
  broker_as_buyer: { label: "رد على وسيط كأنه مشتري" },
  style: { label: "تكرار أو رد طويل أو مو باللهجة" },
  ignored_question: { label: "تجاهل سؤال العميل" },
  full_details: { label: "أعطى كل تفاصيل العقار" },
  rule_violation: { label: "مخالفة قاعدة ثابتة" },
  known_mistake: { label: "غلط سبق صلّحناه ورجع" },
  send_failed: { label: "فشل إرسال" },
  unanswered: { label: "عميل ما انرد عليه" },
};
// When a rule went live in the agent (brain sync or deploy, UTC). A reply sent before that is not a mistake of today's agent and
// is not reported. Add a line with every agent publish that adds or changes a rule (docs/agent-rules.md, «طريقة التعديل» 7).
export const RELEASES: { at: string; rules: string[] }[] = [
  { at: "2026-11-18T11:37:00Z", rules: ["R112", "R113", "R114", "R115"] }, // brain 103a979, then v101 ab76b4e (11:49Z)
  { at: "2026-11-18T13:33:40Z", rules: ["R74"] }, // v102 73cacaa
  { at: "2026-11-19T06:47:09Z", rules: ["R116", "R117"] }, // v103 6651f9b (first reply audit)
  { at: "2026-11-19T06:49:59Z", rules: ["R115"] }, // v104 e6f9cf9 (R115 with a visit question)
  { at: "2026-11-22T07:31:00Z", rules: ["R45", "R22", "R9", "R14", "R114"] }, // v106 94c4ac1 (reply audit 22 Nov guards)
  { at: "2026-11-23T02:39:15Z", rules: ["R118", "R38"] }, // v110 438bcfb (unsupported attachment asked again; «عارض… كم مطلوب» buyer) + SQL154 «انباعت وحدة منها»
];
const releasedAfter = (rule: string, at: string) => RELEASES.some((r) => r.rules.includes(rule) && new Date(at).getTime() < new Date(r.at).getTime());
const MODEL_TYPES = Object.keys(TYPES).filter((k) => !["send_failed", "unanswered"].includes(k));

// Mistakes already fixed (step 1 of Ahmed's request): from approver notes, rejected / superseded drafts, the review backup and
// the review sections of docs/agent-rules.md. The auditor knows them so a come-back is reported as known_mistake.
export const KNOWN_MISTAKES: string[] = [
  "رد على رسالة قديمة ما انرد عليها من أيام (مراجعة 4 نوفمبر، 80 مسودة انتخطت): الرد يكون على آخر كلام العميل بس",
  "رد على موضوع ماشي في الرقم الثاني (رفض أحمد: «الموضوع ماشي في رقم مسقط»): إذا الموضوع ماشي مع الفرع الثاني ما نرد",
  "رد على شي ما نشتغل فيه (المدارس، رفع التثمين R63، المسابقات R61): نعتذر أو نتجاهل حسب القاعدة",
  "تفاوض قبل الزيارة أو تحويل الخصم لأحمد قبل ما يزور (R2): الرد «شوف العقار أول واذا ناسبك نتكلم في السعر» + «متى يناسبك تزور ؟»",
  "وعد برد أو اتصال «بشوف وارد عليك» «بتصل عليك» (R5 / R12 / R53): ممنوع، المسموح بالاسم بس",
  "قال «انباعت» عن عقار متوفر سمّاه العميل، أو عرض عقار انباع / انحجز كأنه متوفر (R6، guard_named_price_available)",
  "ريل كابشنه «تم البيع» انرسل كإعلان لعقار متاح (17 نوفمبر)",
  "اللوكيشن أو صندوق المفتاح أو رقم المالك انرسل قبل ما العميل يحدد يوم الزيارة (R11)، أو ما انرسل لما حدد اليوم",
  "سؤال الرأي «كيف شفت…» أو «ايش اللي ما ناسبك في اللي شفته» لعميل ما زار، أو لعميل واصل البيت الحين (R78، guard_arrived)",
  "«اسمك الكريم ؟» لاصق في نص سطر ثاني («انباعت» أو قبل التفاصيل): ينتقل سطر لحاله قبل آخر سؤال (guard_name_last، 16 نوفمبر)",
  "نفس السؤال («اي فيلا بالضبط ؟» / «اكتب لي السعر والمنطقة») انسأل مرتين: المرة الثانية تروح لأحمد بدون رد (guard_which_twice)",
  "«بكم تعرض البيت ؟» من مشتري انفهم إنه مالك يعرض: هذا مشتري يسأل عن سعرنا",
  "مذكر / مؤنث غلط: المؤنث بس لاسم أنثوي واضح أو «أم فلان» أو كتابة بالمؤنث (R15)",
  "سطر مكرر أو نفس الرسالة مرتين خلال دقايق (R14)، أو أكثر من 3 رسائل في الرد",
  "أرقام مشاريع غير أرقام أحمد (R18): الأسعار تختلف حسب الوحدة والمساحة والدور",
  "الإقامة بأرقام أو شروط غلط (R17)",
  "اعتذار عن عقار مؤجر كأنه مسكون (R91): المؤجر نستلمه، اللي صاحبه ساكن فيه نعتذر عنه",
  "«العفو» بعد «شكرا» وبعدها سطر رقم الفرع الثاني أو سؤال (R49)",
  "طلب اتصال واضح («اتصل علي»، «ممكن رقمك») انرد عليه بدل ما يتحول لأحمد بدون رد (R12)",
  "«تواصلت محد يرد» عن رقم أعطيناه: يروح لأحمد بتنبيه مع جملة R12 (R93)",
  "مشتري يطلب تفاصيل بالمنطقة بس وفي أكثر من عقار: انرسلت تفاصيل وسعر قبل ما يحدد أي وحدة (القاعدة المثبتة «اي فيلا بالضبط ؟»)",
  "عميل على بركاء ينعرض عليه مسقط أو العكس بدون سبب، أو المستثمر ما انحول لمسقط (R9 / R66)",
  "إجابة بالإنجليزي أو كلام رسمي مو باللهجة («بقيمة»، «بسعر قدره»، نقطة آخر السطر)",
  "«مبروك» أو أسئلة بعد ما العميل قال «حصلت» (R50 / R111): بدون رد",
  "«ان شاء الله» أو «تمام» بعد عزيمة الاجتماع «… يناسبك ؟» وما انحجز اجتماع (R45، فحص 22 نوفمبر)، أو عزيمة بدون «يناسبك ؟»",
  "عرض أقرب بيت فوق ميزانية العميل بدون «تقدر تزيد شوي ؟» أو أي سؤال (R22، فحص 22 نوفمبر)",
  "«كيف الحال ؟» بدون «الحمدلله»، أو «الفيلا اللي سألت عنها انحجزت» لعميل يدور بشكل عام وما سمّى فيلا (فحص 22 نوفمبر)",
  "سطر «عقارات … يتابعها رقم فرع مسقط» تحت سطر الاستثمار على رقم بركاء (R9)، أو سطر الفرع نفسه مرتين خلال 15 دقيقة (R14)",
];

async function ai(instructions: string, input: string, sch: any, name: string) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 170000);
  try {
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", signal: ctl.signal, headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, store: false, reasoning: { effort: "medium" }, instructions, input, text: { format: { type: "json_schema", name, strict: true, schema: sch } } }),
    });
    const p = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(p?.error?.message || `openai_${r.status}`);
    return JSON.parse(p.output_text || p.output?.flatMap((x: any) => x?.content || []).find((x: any) => x?.type === "output_text")?.text || "{}");
  } finally { clearTimeout(t); }
}

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["chats"],
  properties: { chats: { type: "array", items: { type: "object", additionalProperties: false, required: ["chat", "problems"],
    properties: { chat: { type: "integer" }, problems: { type: "array", items: { type: "object", additionalProperties: false,
      required: ["draft", "error_type", "certain", "before_fix", "customer_message", "explanation", "options", "rule_r", "pinned_rule", "known_mistake"],
      properties: {
        draft: { type: "integer", description: "رقم مسودة العقل (#) اللي فيها الغلط" },
        error_type: { type: "string", enum: MODEL_TYPES },
        certain: { type: "boolean", description: "true بس إذا الغلط أكيد من المحادثة والقائمة، مو تخمين" },
        before_fix: { type: "boolean", description: "true إذا القاعدة اللي تغطي الغلط تاريخها بعد يوم الرد (يعني انصلح بعدين)" },
        customer_message: { type: "string", description: "رسالة العميل اللي رد عليها العقل غلط، نصها" },
        explanation: { type: "string", description: "سطرين بالعربي البسيط لأحمد: وش الغلط وليش" },
        options: { type: "array", items: { type: "string" }, description: "2 أو 3 ردود صحيحة بديلة، كل رد كامل، كل رسالة في سطر" },
        rule_r: { type: "string", description: "رقم القاعدة من agent-rules مثل R6، أو فاضي" },
        pinned_rule: { type: "string", description: "أول 8 حروف من id الرد المثبت اللي يغطي الموقف، أو فاضي" },
        known_mistake: { type: "integer", description: "رقم الغلط المعروف (من 1) إذا هذا هو نفسه رجع، أو 0" },
      } } } } } } },
};

const INSTRUCTIONS = (brain: string, knowledge: string, pinned: string, props: string) => `انت فاحص ردود مكتب «عمان فيلا» للوساطة العقارية (بركاء ومسقط). العقل الآلي يرد على العملاء في الواتساب. شغلك تلقى أغلاطه الحقيقية في الردود اللي سواها، عشان أحمد (صاحب المكتب) يصلحها.
لكل محادثة تشوف آخر الرسائل، وتحتها مسودات العقل المرقمة (#) في فترة الفحص: اللي انرسلت، واللي العقل قرر ما يرد فيها (ومعها سبب التحويل إذا حوّل).
احكم على كل مسودة: هل الرد صح حسب قواعد المكتب تحت؟ رجّع بس الأغلاط الحقيقية. الرد الصح أو اللي فيه شك بسيط ما ترجعه. لا تخترع أغلاط عشان تملي.
أنواع الأغلاط (error_type):
- invented_info: سعر أو مساحة أو معلومة مو موجودة في قائمة العقارات أو معرفة المشاريع، أو تخالفها
- sold_offered: عرض عقار حالته sold أو reserved أو withdrawn كأنه متوفر، أو قال «انباع» عن عقار متوفر
- serious_not_handed: عميل زار ويتفاوض، أو مشتري جاد يبي يحجز أو يدفع عربون، والعقل رد عليه بدل ما يحوّل لأحمد بدون رد (R3 / R16)
- call_not_handed: طلب اتصال واضح والعقل رد بدل التحويل (R12)
- broker_as_buyer: الكاتب وسيط أو مكتب ثاني والعقل عامله كمشتري
- style: تكرار سطر، أكثر من 3 رسائل، رد طويل، كلام رسمي أو مو باللهجة العمانية البيضاء
- ignored_question: العميل سأل سؤال واضح والرد ما جاوبه، أو العقل قرر ما يرد وكان لازم يرد
- full_details: أعطى كل تفاصيل العقار والسعر قبل ما يحدد العميل أي عقار أو قبل الوقت المناسب حسب القواعد
- rule_violation: خالف قاعدة R أو رد مثبت ما ينطبق عليه نوع فوق (اكتب رقمها في rule_r)
- known_mistake: نفس غلط من «الأغلاط اللي سبق صلّحناها» رجع (اكتب رقمه في known_mistake)
certain=true بس إذا الغلط واضح أكيد. خاصة الأنواع الخطيرة (invented_info و sold_offered و serious_not_handed): هذي توقف العقل على المحادثة، فلا تقول certain إلا إذا متأكد من القائمة والمحادثة.
لا تحكم على شي سواه المكتب بيده (المكتب) ولا على رسائل المتابعة الآلية، بس على مسودات العقل المرقمة.
سطر «(المكتب رجّع المحادثة للعقل بالزر)» يعني العقل يحق له يرد بعده: رده بعد رسالة المكتب مو مخالفة R1. وإرسال الموقع مرة ثانية لأن العميل طلبه مو تكرار. والوحدة اللي تبدأ من 57 الف في مدينة السلطان هيثم هي استوديو الآيكونيك تاور، فـ«أرخص شقة من 57 الف» مو مخترعة. ومطور أو شركة داخل عمان تعزم الوسطاء على عرض مشروع مو من المتجاهلين (R40)، وتحويلها لأحمد صح. (فحص 22 نوفمبر)
المعلومة المكتوبة في نص الإعلان أو الوصف أو كابشن الريل أو طريقة الزيارة أو معرفة المشاريع مو مخترعة، ورابط الريل المكتوب تحت العقار مو مخترع.
المؤنث صح لاسم أنثوي واضح أو «أم فلان» أو إذا العميل كتب بالمؤنث (R15)، ولا تحكم إنه غلط إلا إذا ما في أي واحد منها في المحادثة. والعقار اللي ما له تفاصيل في القائمة (مباع أو مؤرشف) لا تحكم على تفاصيله إلا إذا تخالف القائمة.
كل قاعدة R جنبها تاريخها: إذا تاريخ القاعدة بعد يوم الرد، الغلط انصلح بعدين، اكتب before_fix=true.
الاقتراحات (options): 2 أو 3 ردود كاملة صحيحة يقدر أحمد يختار منها، باللهجة العمانية البيضاء وعلى طريقة كتابة المكتب بالضبط (رسائل قصيرة، كل رسالة في سطر، بدون نقطة آخر السطر، « ؟» بمسافة)، وبدون أي معلومة مو مكتوبة في القائمة أو المعرفة. إذا الصح إن العقل ما يرد ويحوّل لأحمد، اكتب في الاقتراح: «(بدون رد، تحويل لأحمد: …)».
explanation: سطرين بالعربي البسيط.

# الأغلاط اللي سبق صلّحناها
${KNOWN_MISTAKES.map((m, i) => `${i + 1}. ${m}`).join("\n")}

# الردود المثبتة (whatsapp_reply_rules، النشطة)
${pinned}

# قواعد أحمد الثابتة (docs/agent-rules.md، مختصرة)
${RULES_DIGEST.join("\n")}

# العقارات (كل القائمة: الحالة available متوفر، reserved محجوز، sold مباع، withdrawn / not_available ما متوفر)
${props}

# معرفة المشاريع
${knowledge}

# تعليمات العقل نفسه (اللي المفروض يمشي عليها)
${brain}`;

const ROUTE = (k: unknown) => (k === "barka" ? "بركاء" : k === "muscat" ? "مسقط" : String(k || ""));
const omanTime = (iso: string) => new Date(new Date(iso).getTime() + 4 * 3600000).toISOString().slice(5, 16).replace("T", " ");

async function chatBlock(n: number, conv: any, drafts: any[], start: string) {
  const first = drafts[0].created_at;
  const [msgs, visits] = await Promise.all([
    db.from("whatsapp_messages").select("direction,actor_type,body,transcript,message_type,message_timestamp")
      .eq("conversation_id", conv.id).lte("message_timestamp", new Date(Date.now()).toISOString()).order("message_timestamp", { ascending: false }).limit(45),
    conv.client_id ? db.from("viewings").select("status,viewing_date,property_id,pipeline_outcome,outcome_note").eq("archived", false).eq("client_id", conv.client_id).order("viewing_date", { ascending: false }).limit(5) : Promise.resolve({ data: [] }),
  ]);
  const all = (msgs.data || []).reverse();
  // keep 10 messages before the first draft of the period, and everything after it
  const idx = all.findIndex((m: any) => m.message_timestamp >= new Date(new Date(first).getTime() - 5 * 60000).toISOString());
  const rows = idx < 0 ? all.slice(-15) : all.slice(Math.max(0, idx - 10));
  // (22 Nov: the office's «رجّعها للعقل» was invisible, so a reply after it was called an R1 mistake, سليمه 0b1c7b83)
  if (conv.agent_returned_at && rows.length && conv.agent_returned_at >= rows[0].message_timestamp) {
    rows.push({ returned: true, message_timestamp: conv.agent_returned_at });
    rows.sort((a: any, b: any) => new Date(a.message_timestamp).getTime() - new Date(b.message_timestamp).getTime());
  }
  const who = (m: any) => m.direction === "inbound" ? "العميل" : m.actor_type === "human" ? "المكتب" : "آلي";
  const lines = rows.map((m: any) => m.returned ? `[${omanTime(m.message_timestamp)}] (المكتب رجّع المحادثة للعقل بالزر)` : `[${omanTime(m.message_timestamp)}] ${who(m)}: ${short(m.transcript || m.body || `[${m.message_type}]`, 350)}`);
  const vs = (visits as any).data || [];
  const ds = drafts.map((d: any, i: number) => {
    const a = d.analysis || {};
    const text = (d.approved_messages?.length ? d.approved_messages : d.reply_messages || a.reply_messages || []).join("\n");
    const head = `#${i + 1} [${omanTime(d.created_at)}] ${d.status === "sent" ? "العقل رد (انرسل)" : d.status === "failed" ? "العقل رد (فشل الإرسال)" : "العقل قرر ما يرد"}`;
    const meta = [a.category && `الفئة: ${a.category}`, a.intent && `النية: ${short(a.intent, 80)}`, a.action && `الإجراء: ${a.action}`,
      a.property_id && `العقار: ${id8(a.property_id)}`, a.handoff_reason && `سبب التحويل: ${short(a.handoff_reason, 160)}`,
      a.matched_rule_id && `رد مثبت: ${id8(a.matched_rule_id)}`, d.error && `السبب: ${d.error}`].filter(Boolean).join(" | ");
    return `${head}\n${meta}${text ? `\n${short(text, 900)}` : ""}`;
  });
  return [
    `## محادثة ${n} · ${ROUTE(conv.route_key)} · ${conv.name || "عميل"}`,
    vs.length ? `الزيارات: ${vs.map((v: any) => `${v.status} ${String(v.viewing_date || "").slice(0, 10)} عقار ${id8(v.property_id)}${(v.outcome_note || v.pipeline_outcome) ? ` (${short(v.outcome_note || v.pipeline_outcome, 60)})` : ""}`).join(" · ")}` : "الزيارات: ما في زيارة مسجلة",
    "الرسائل:", ...lines, "مسودات العقل في فترة الفحص:", ...ds,
  ].join("\n");
}

async function audit(companyId: string, opts: { hours?: number; dry?: boolean; trigger?: string; secret?: string }) {
  const end = new Date();
  const last = await db.from("whatsapp_reply_audit_runs").select("period_end").eq("company_id", companyId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  let start = opts.hours ? new Date(end.getTime() - opts.hours * 3600000) : last.data?.period_end ? new Date(last.data.period_end) : new Date(end.getTime() - 24 * 3600000);
  if (end.getTime() - start.getTime() > 72 * 3600000) start = new Date(end.getTime() - 72 * 3600000);
  const S = start.toISOString(), E = end.toISOString();

  const [draftsR, rulesR, propsR, brainR, knowR, openR, health, unanswered, ownerR, notifyR] = await Promise.all([
    db.from("whatsapp_reply_drafts").select("id,conversation_id,client_id,status,error,analysis,reply_messages,approved_messages,created_at,sent_at")
      .eq("company_id", companyId).gte("created_at", S).lt("created_at", E).order("created_at"),
    db.from("whatsapp_reply_rules").select("id,situation,approved_reply,category").eq("company_id", companyId).eq("active", true),
    db.from("properties").select("id,title,internal_name,type,area,wilayat,price,status,archived,listing_purpose,branch_key,bedrooms,bathrooms,land_size,built_size,public_details,description,visit_method,visit_instructions,map_url,rental_terms,price_negotiable,electricity_connected,water_connected,updated_at").eq("company_id", companyId),
    db.from("whatsapp_agent_prompts").select("content").eq("key", "brain").maybeSingle(),
    db.from("whatsapp_agent_prompts").select("content").eq("key", "knowledge").maybeSingle(),
    db.from("whatsapp_reply_audit_findings").select("id,conversation_id,customer_name,error_type,severity,conversations,conversations_count,created_at,paused").eq("company_id", companyId).eq("status", "open").order("created_at"),
    db.rpc("crm_reply_audit_health", { p_company: companyId, p_since: S }),
    db.rpc("crm_reply_audit_unanswered", { p_company: companyId, p_since: S }),
    db.from("profiles").select("id").eq("company_id", companyId).eq("role", "owner").eq("is_active", true).limit(1).maybeSingle(),
    db.from("whatsapp_automation_events").select("id").eq("company_id", companyId).eq("action_type", "owner_notify").eq("status", "failed").gte("created_at", S),
  ]);
  // the reels of each property: the agent sends their link as the video and may take the ad text from the caption
  const reelsR = await db.from("instagram_media_catalog").select("property_id,permalink,caption,published_at").eq("company_id", companyId)
    .not("property_id", "is", null).order("published_at", { ascending: false }).limit(300);
  const reels: Record<string, any[]> = {};
  for (const r of reelsR.data || []) (reels[r.property_id] ||= []).push(r);
  const drafts = draftsR.data || [];
  const sent = drafts.filter((d: any) => d.status === "sent"), failed = drafts.filter((d: any) => d.status === "failed");
  const skipped = drafts.filter((d: any) => d.status === "skipped");
  const judged = drafts.filter((d: any) => d.status === "sent" || (d.status === "skipped" && d.error === "no_reply_needed"));

  // conversations of the judged drafts
  const convIds = [...new Set(judged.map((d: any) => d.conversation_id))];
  const convs: Record<string, any> = {};
  for (let i = 0; i < convIds.length; i += 100) {
    const r = await db.from("whatsapp_conversations").select("id,client_id,route_key,customer_name,customer_phone,agent_muted,agent_returned_at,clients(name,phone)").in("id", convIds.slice(i, i + 100));
    for (const c of r.data || []) convs[c.id] = { ...c, name: (c as any).clients?.name || c.customer_name || c.customer_phone, phone: (c as any).clients?.phone || c.customer_phone };
  }
  const sentConvs = [...new Set(sent.map((d: any) => d.conversation_id))];
  const replied_clients = sentConvs.map((cid) => ({ conversation_id: cid, name: convs[cid]?.name || "عميل", phone: convs[cid]?.phone || null, route: convs[cid]?.route_key || null,
    replies: sent.filter((d: any) => d.conversation_id === cid).length }));

  // ---------- model judgment, chunk by chunk ----------
  const byConv = convIds.slice(0, MAX_CHATS).map((cid) => ({ conv: convs[cid] || { id: cid }, drafts: judged.filter((d: any) => d.conversation_id === cid) }));
  const pinned = (rulesR.data || []).map((r: any) => `${id8(r.id)} | ${short(r.situation, 300)} | الرد: ${short(r.approved_reply, 200).replace(/\n/g, " / ")}`).join("\n") || "ما في";
  // the properties on offer (available / reserved) with everything the agent may say about them (the ad text, how to visit,
  // utilities), so a fact taken from the ad is not called invented; the others in one line each with their status
  const VISIT: Record<string, string> = { open: "البيت مفتوح", lockbox: "صندوق مفتاح", owner: "تواصل مع المالك", office: "تنسيق من المكتب" };
  const live = (p: any) => !p.archived && ["available", "reserved"].includes(p.status);
  const props = (propsR.data || []).sort((a: any, b: any) => Number(live(b)) - Number(live(a))).map((p: any) => {
    const head = [id8(p.id), p.title || p.internal_name, p.type, [p.area, p.wilayat].filter(Boolean).join("/"), p.price ? `${p.price} ريال` : "بدون سعر",
      `الحالة: ${p.status}${p.archived ? " (مؤرشف)" : ""}${p.status !== "available" && p.updated_at ? ` من ${String(p.updated_at).slice(0, 10)}` : ""}`,
      p.listing_purpose, p.branch_key, p.bedrooms ? `${p.bedrooms} غرف` : "", p.land_size ? `أرض ${p.land_size}` : "", p.built_size ? `بناء ${p.built_size}` : ""].filter(Boolean).join(" | ");
    if (!live(p)) return head;
    return [head,
      p.visit_method ? `  طريقة الزيارة: ${VISIT[p.visit_method] || p.visit_method}${p.visit_instructions ? ` (${short(p.visit_instructions, 250)})` : ""}` : "",
      p.map_url ? "  له لوكيشن" : "", p.price_negotiable != null ? `  السعر قابل للتفاوض: ${p.price_negotiable ? "نعم" : "لا"}` : "",
      p.electricity_connected != null || p.water_connected != null ? `  الكهرباء: ${p.electricity_connected ? "موصلة" : "مو موصلة / مو معروف"} · الماي: ${p.water_connected ? "موصل" : "مو موصل / مو معروف"}` : "",
      p.rental_terms ? `  شروط الإيجار: ${short(typeof p.rental_terms === "string" ? p.rental_terms : JSON.stringify(p.rental_terms), 200)}` : "",
      p.public_details ? `  نص الإعلان: ${short(p.public_details, 1200).replace(/\n+/g, " / ")}` : "",
      p.description ? `  وصف: ${short(p.description, 500).replace(/\n+/g, " / ")}` : "",
      ...(reels[p.id] || []).slice(0, 4).map((r: any, i: number) => `  ريل ${i + 1}: ${r.permalink || ""}${r.caption ? ` · الكابشن: ${short(r.caption, i ? 200 : 900).replace(/\n+/g, " / ")}` : ""}`)].filter(Boolean).join("\n");
  }).join("\n");
  const instructions = INSTRUCTIONS(String(brainR.data?.content || ""), String(knowR.data?.content || ""), pinned, props);
  const problems: any[] = [];
  const errors: string[] = [];
  let beforeFix = 0;
  const chunks: any[][] = [];
  for (let i = 0; i < byConv.length; i += CHUNK) chunks.push(byConv.slice(i, i + CHUNK));
  await Promise.all(chunks.map(async (chunk, ci) => {
    try {
      const blocks = await Promise.all(chunk.map((c, j) => chatBlock(j + 1, { ...c.conv, id: c.conv.id }, c.drafts, S)));
      const out = await ai(instructions, `فترة الفحص: ${omanTime(S)} لين ${omanTime(E)} بتوقيت مسقط\n\n${blocks.join("\n\n")}`, SCHEMA, "reply_audit");
      for (const ch of out.chats || []) {
        const c = chunk[Number(ch.chat) - 1]; if (!c) continue;
        for (const p of ch.problems || []) {
          const d = c.drafts[Number(p.draft) - 1] || c.drafts[c.drafts.length - 1];
          if (!TYPES[p.error_type]) continue;
          // the rule that covers it came after this reply: fixed since, not a mistake of today's agent
          const rs = String(p.rule_r || "").match(/R\d+/g) || [];
          if (p.before_fix === true || (rs.length && d && rs.every((r: string) => releasedAfter(r, d.created_at)))) { beforeFix++; continue; }
          problems.push({ ...p, conv: c.conv, draft: d });
        }
      }
    } catch (e) { errors.push(`دفعة ${ci + 1}: ${String((e as any)?.message || e).slice(0, 160)}`); }
  }));

  // ---------- deterministic: failed sends and chats left without a reply ----------
  for (const d of failed) problems.push({ error_type: "send_failed", certain: true, conv: convs[d.conversation_id] || { id: d.conversation_id }, draft: d,
    customer_message: "", explanation: `الرد انكتب بس ما وصل للعميل (${d.error || "فشل"}).\nيحتاج يترسل يدوي أو يتأكد إنه انرسل بعدين.`, options: [], rule_r: "", pinned_rule: "", known_mistake: 0 });
  for (const u of unanswered.data || []) {
    if (failed.some((d: any) => d.conversation_id === u.conversation_id)) continue;
    problems.push({ error_type: "unanswered", certain: true, conv: { id: u.conversation_id, client_id: u.client_id, name: u.name, phone: u.phone, route_key: u.route_key }, draft: null,
      customer_message: u.last_message || "", explanation: `آخر رسالة من العميل (${omanTime(u.last_inbound_at)}) ما انرد عليها ولا العقل كتب لها رد${u.last_draft_status === "failed" ? " (آخر رد فشل)" : ""}.\nالمحادثة مو موقوفة ولا محولة.`,
      options: [], rule_r: "", pinned_rule: "", known_mistake: 0 });
  }

  // ---------- open findings from earlier reports: listed first, not written again ----------
  const open = openR.data || [];
  const openKey = new Set<string>();
  for (const f of open) { openKey.add(`${f.conversation_id}|${f.error_type}`); for (const o of f.conversations || []) openKey.add(`${o.conversation_id}|${f.error_type}`); }
  const fresh = problems.filter((p) => !openKey.has(`${p.conv?.id}|${p.error_type}`));

  // ---------- group by type, order by severity ----------
  const ruleIds = new Map((rulesR.data || []).map((r: any) => [id8(r.id), r.id]));
  const isCritical = (p: any) => !!TYPES[p.error_type]?.critical && p.certain === true;
  const groups = new Map<string, any[]>();
  // same type = one item; a rule violation is grouped by its rule (R114 four times is one item, not one with R48 and R74)
  const firstR = (p: any) => String(p.rule_r || "").match(/R\d+/)?.[0] || "";
  for (const p of fresh) {
    const k = p.error_type === "rule_violation" ? `rule_violation|${firstR(p)}` : p.error_type;
    if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(p);
  }
  const items = [...groups.entries()].map(([key, ps]) => {
    const type = key.split("|")[0];
    ps.sort((a, b) => Number(isCritical(b)) - Number(isCritical(a)) || Number(!!b.certain) - Number(!!a.certain));
    const head = ps[0];
    const repeatRule = ps.map((p) => ruleIds.get(String(p.pinned_rule || "").slice(0, 8))).find(Boolean) || null;
    const repeatR = ps.map((p) => String(p.rule_r || "").match(/R\d+/)?.[0]).find(Boolean) || null;
    const label = type === "rule_violation" && repeatR ? `${TYPES[type].label} ${repeatR}` : TYPES[type].label;
    return { type, label, ps, head, critical: ps.some(isCritical), repeatRule, repeatR, known: ps.some((p) => Number(p.known_mistake) > 0), certain: ps.some((p) => p.certain) };
  }).sort((a, b) => Number(b.critical) - Number(a.critical) || Number(!!b.repeatRule) - Number(!!a.repeatRule) || Number(b.known) - Number(a.known)
    || Number(b.certain) - Number(a.certain) || b.ps.length - a.ps.length);
  const kept = items.slice(0, MAX_FINDINGS), dropped = items.slice(MAX_FINDINGS);

  // ---------- system health ----------
  const h = (health.data || {}) as any;
  const reasons: string[] = [];
  for (const j of h.cron_failed || []) reasons.push(`الكرون ${j.job} فشل ${j.failed} مرة`);
  for (const j of h.cron_silent || []) reasons.push(`الكرون ${j} ما اشتغل`);
  for (const u of h.usage || []) if (u.blocked) reasons.push(`رقم ${ROUTE(u.route_key)}: آخر رسائل النظام ما وصلت (الرصيد أو الدفع في ميتا)`);
  if (failed.length) reasons.push(`${failed.length} رد فشل إرساله`);
  if (failed.some((d: any) => /credit|quota|insufficient/i.test(String(d.error || "")))) reasons.push("رصيد OpenAI خلص");
  if ((notifyR.data || []).length) reasons.push(`${notifyR.data!.length} تنبيه لأحمد على الواتساب فشل`);
  if (errors.length) reasons.push(`الفاحص نفسه: ${errors.length} دفعة ما انفحصت`);
  if (draftsR.error) reasons.push("ما قدرت أقرأ مسودات الردود");
  const system_health = { status: reasons.length ? "problem" : "ok", reasons, usage: (h.usage || []).map((u: any) => ({ route: u.route_key, used: u.used, blocked: u.blocked })) };

  const stats = { sent: sent.length, skipped: skipped.length, failed: failed.length, judged: judged.length, chats_judged: byConv.length, chats_total: convIds.length,
    unanswered: (unanswered.data || []).length, skipped_by_reason: skipped.reduce((a: any, d: any) => { a[d.error || "-"] = (a[d.error || "-"] || 0) + 1; return a; }, {}),
    problems_found: problems.length, fixed_since: beforeFix, repeated_open: problems.length - fresh.length, dropped_types: dropped.map((g) => ({ type: g.type, count: g.ps.length })), errors };

  const shift = new Date(end.getTime() + 4 * 3600000).getUTCHours() < 12 ? "الصبح" : "الظهر";
  const lineOf = (g: any, i: number) => `${i + 1}. ${g.critical ? "🔴" : "🟡"} ${g.label} · ${g.head.conv?.name || "عميل"}${g.ps.length > 1 ? ` (+${g.ps.length - 1} محادثة)` : ""}${g.critical ? " · وقفت العقل" : ""}${g.repeatRule || g.known ? " · تكرر رغم القاعدة" : ""}`;
  const names = replied_clients.map((r) => r.name);
  const summary = [
    `🧠 فحص الردود · ${shift}`,
    `من ${omanTime(S)} لين ${omanTime(E)}`,
    `انفحص: ${sent.length} رد انرسل لـ ${replied_clients.length} عميل · تخطى ${skipped.length} · فشل ${failed.length} · ما انرد ${stats.unanswered}`,
    names.length ? `انرد على: ${names.slice(0, 12).join("، ")}${names.length > 12 ? ` و${names.length - 12} غيرهم` : ""}` : "ما انرسل أي رد آلي",
    system_health.status === "ok" ? "النظام: شغال ✅" : `النظام: ⚠️ ${reasons.join(" · ")}`,
    open.length ? `باقي من قبل: ${open.length} (${open.slice(0, 3).map((f: any) => `${TYPES[f.error_type]?.label || f.error_type} · ${f.customer_name || ""}`).join("، ")})` : "",
    kept.length ? `الأغلاط الجديدة (${kept.length}):\n${kept.map(lineOf).join("\n")}` : "ما في أغلاط جديدة ✅",
    dropped.length ? `وفي ${dropped.length} نوع ثاني أقل خطورة ما انعرض` : "",
    kept.length || open.length ? "الاختيار في محادثة Claude" : "",
  ].filter(Boolean).join("\n");

  if (opts.dry) return { dry: true, period: { start: S, end: E }, summary, stats, system_health, replied_clients,
    findings: kept.map((g) => ({ type: g.type, critical: g.critical, count: g.ps.length, repeat_rule: g.repeatRule, repeat_r: g.repeatR, head: { name: g.head.conv?.name, customer_message: g.head.customer_message, explanation: g.head.explanation, options: g.head.options, certain: g.head.certain } })),
    all_problems: problems.map((p) => ({ type: p.error_type, certain: p.certain, name: p.conv?.name, conv: p.conv?.id, draft: p.draft?.id, msg: short(p.customer_message, 120), why: p.explanation, rule_r: p.rule_r })) };

  // ---------- write the run and the findings ----------
  const run = await db.from("whatsapp_reply_audit_runs").insert({ company_id: companyId, period_start: S, period_end: E, checked_count: judged.length, replied_clients,
    findings_count: kept.length, system_health, summary, stats, trigger: opts.trigger || "cron" }).select("id").single();
  if (run.error) throw new Error(`run_insert: ${run.error.message}`);
  const paused: any[] = [];
  for (const g of kept) {
    const crit = g.ps.filter(isCritical);
    // critical: mute the agent on every chat of the group with a certain critical mistake
    for (const p of crit) {
      const cid = p.conv?.id; if (!cid || paused.some((x) => x.id === cid)) continue;
      const now = new Date().toISOString();
      const up = await db.from("whatsapp_conversations").update({ agent_muted: true, agent_muted_reason: `فحص الردود: ${g.label}`, updated_at: now }).eq("id", cid).eq("agent_muted", false).select("id");
      p.paused = !up.error; paused.push({ id: cid, p, g, already: !up.error && !(up.data || []).length });
    }
    const draftText = (d: any) => d ? short((d.approved_messages?.length ? d.approved_messages : d.reply_messages || []).join("\n"), 1500) : null;
    const lastIn = async (p: any) => {
      if (p.customer_message) return short(p.customer_message, 800);
      if (!p.conv?.id) return null;
      const m = await db.from("whatsapp_messages").select("body,transcript").eq("conversation_id", p.conv.id).eq("direction", "inbound").lte("message_timestamp", p.draft?.created_at || E).order("message_timestamp", { ascending: false }).limit(1).maybeSingle();
      return short(m.data?.transcript || m.data?.body || "", 800) || null;
    };
    const others = await Promise.all(g.ps.slice(1).map(async (p: any) => ({ conversation_id: p.conv?.id || null, client_id: p.conv?.client_id || null, customer_name: p.conv?.name || null,
      phone: p.conv?.phone || null, draft_id: p.draft?.id || null, customer_message: await lastIn(p), ai_reply: draftText(p.draft), explanation: short(p.explanation, 400),
      options: (p.options || []).slice(0, 3), paused: !!p.paused, certain: !!p.certain })));
    const h0 = g.head;
    await db.from("whatsapp_reply_audit_findings").insert({ run_id: run.data.id, company_id: companyId, conversation_id: h0.conv?.id || null, client_id: h0.conv?.client_id || null,
      customer_name: h0.conv?.name || null, phone: h0.conv?.phone || null, customer_message: await lastIn(h0), ai_reply: draftText(h0.draft), draft_id: h0.draft?.id || null,
      error_type: g.type, severity: g.critical ? "critical" : "normal", explanation: short(h0.explanation, 600), options: (h0.options || []).slice(0, 3),
      repeat_of_rule_id: g.repeatRule, repeat_of_r: g.repeatR || (g.known ? `معروف ${g.ps.map((p: any) => p.known_mistake).filter((x: any) => x > 0)[0]}` : null),
      conversations: others, conversations_count: g.ps.length, paused: g.ps.some((p: any) => p.paused) });
  }

  // ---------- tell Ahmed: critical right away, then the report ----------
  const secret = opts.secret;
  const notifyOwner = async (route: string, text: string, key: string) => {
    if (!secret) return false;
    const r = await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-owner-hot-alert`, { method: "POST", headers: { "Content-Type": "application/json", "x-crm-agent": secret },
      body: JSON.stringify({ action: "notify_owner", company_id: companyId, route_key: route === "barka" ? "barka" : "muscat", text, event_key: key }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    return !!j?.sent;
  };
  for (const x of paused) {
    const c = x.p.conv;
    const text = [`🚨 فحص الردود: غلط خطير · ${ROUTE(c.route_key)}`, `الاسم: ${c.name || "عميل"}`, c.phone ? `الرقم: ${c.phone}` : "", `الغلط: ${x.g.label}`,
      short(x.p.explanation, 300), x.already ? "العقل كان موقوف على المحادثة من قبل" : "وقفت العقل على هالمحادثة، ترجّعه من «كمّل يا عقل»"].filter(Boolean).join("\n");
    await notifyOwner(c.route_key, text, `reply_audit:${run.data.id}:${c.id}`);
    if (ownerR.data?.id) await db.from("notifications").insert({ user_id: ownerR.data.id, type: "reply_audit", is_read: false, link: "whatsapp", client_id: c.client_id || null,
      title: `🚨 غلط خطير في رد آلي: ${c.name || "عميل"}`, body: short(`${x.g.label}\n${x.p.explanation}`, 400) });
  }
  const sentOk = await notifyOwner("muscat", short(summary, 890), `reply_audit_report:${run.data.id}`);
  if (ownerR.data?.id) await db.from("notifications").insert({ user_id: ownerR.data.id, type: "reply_audit", is_read: false, link: "home",
    title: kept.length ? `🧠 فحص الردود: ${kept.length} غلط` : "🧠 فحص الردود: ما في أغلاط", body: short(summary, 400) });
  await db.from("whatsapp_reply_audit_runs").update({ report_sent: sentOk }).eq("id", run.data.id);
  return { run_id: run.data.id, period: { start: S, end: E }, summary, stats, system_health, paused: paused.map((x) => ({ conversation_id: x.id, name: x.p.conv?.name, type: x.g.type, already: x.already })), report_sent: sentOk };
}

Deno.serve(async (req) => {
  const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json; charset=utf-8" } });
  if (req.method !== "POST") return json({ ok: false }, 405);
  const secret = req.headers.get("x-crm-agent") || "";
  const ok = secret ? await db.rpc("crm_reply_agent_secret_ok", { p_secret: secret }) : null;
  if (!ok || ok.error || ok.data !== true) return json({ ok: false, error: "not_authorized" }, 403);
  const body = await req.json().catch(() => ({}));
  const opts = { hours: Number(body?.hours) > 0 ? Math.min(72, Number(body.hours)) : undefined, dry: body?.dry === true, trigger: String(body?.trigger || "manual").slice(0, 20), secret };
  const work = async () => {
    const companies = await db.from("whatsapp_automation_runtime").select("company_id");
    const out: any[] = [];
    for (const c of companies.data || []) {
      try { out.push(await audit(c.company_id, opts)); } catch (e) { console.error("[reply-audit]", String((e as any)?.message || e)); out.push({ error: String((e as any)?.message || e) }); }
    }
    return out;
  };
  if (body?.wait === true || opts.dry) return json({ ok: true, out: await work() });
  // cron: answer at once, finish in the background
  (globalThis as any).EdgeRuntime?.waitUntil ? (globalThis as any).EdgeRuntime.waitUntil(work()) : work();
  return json({ ok: true, started: true });
});
