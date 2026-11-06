// Voice notes → text, tuned for Omani real-estate chats (6 Nov 2026).
// Before: gpt-4o-mini-transcribe, forced language=ar, no context → words dropped and dialect/area names misheard
// ("بركة" for بركاء, "كرة" for كورنر, "صومح" for الصومحان, half sentences).
// Now: 1) the full transcribe model with a vocabulary prompt + the last office message as context,
//      no forced language (English voice notes stay English), fallback to the mini model;
//      2) a short correction pass with the chat model that only fixes misheard words using the conversation,
//         never adds meaning. The raw text is kept so nothing is lost.

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const PRIMARY = Deno.env.get("OPENAI_TRANSCRIBE_MODEL_V2") || "gpt-4o-transcribe";
const FALLBACK = "gpt-4o-mini-transcribe";
const FIX_MODEL = Deno.env.get("VOICE_FIX_MODEL") || Deno.env.get("REPLY_AGENT_MODEL") || Deno.env.get("OPENAI_MODEL") || "gpt-5.6-luna";

export const VOICE_VOCAB =
  "رسالة صوتية على واتساب لمكتب عقاري في سلطنة عمان باللهجة العمانية. " +
  "فيلا، بيت، منزل، أرض، شقة، كورنر، توين، طابقين، غرفة ماستر، مجلس، صالة، مطبخ، دورات مياه، ارتداد، " +
  "مساحة الأرض، مساحة البناء، متر، ألف، ريال، معاينة، زيارة، لوكيشن، الكروكي، الملكية، صاحب العقار، تمويل، الإسكان، عربون. " +
  "بركاء، الرميس، الصومحان الجنوبية، الصومحان الشمالية، الهرم، الشخاخيط، حي العزة، المريصي، الحرادي، نعمان، الفليج، العبر، " +
  "السيب، الخوض، المعبيلة، الحيل الجنوبية، العامرات، بوشر، العذيبة، الموالح، الغبرة، مدينة السلطان قابوس، مسقط، المصنعة، السويق.";

const FIX_RULES = `أنت مدقق لنص رسالة صوتية تحولت كتابة آلياً. العميل يكلم مكتب عقاري في سلطنة عمان (فرع بركاء وفرع مسقط) باللهجة العمانية غالباً.
صحح بس الكلمات اللي واضح إنها انسمعت غلط، مستعين بالمحادثة وبأسماء المناطق والمصطلحات العقارية. أمثلة: "بركة" = بركاء، "صومح" أو "صمحان" = الصومحان، "كرة" أو "كورنا" عن أرض = كورنر، "حي عاصم" = الرميس، "الحرم" في بركاء = الهرم، "شبح" قبل اسم منطقة غالباً = "شي في".
القواعد:
- لا تضيف معنى ولا معلومة مو موجودة، ولا تلخص، ولا تحذف شي. خل الكلام بلهجته.
- إذا كلمة مكررة بسبب التحويل (مثل "تفاصيل تفاصيل") خلها مرة وحدة.
- إذا في جزء ناقص أو مو مفهوم وتقدر تفهمه أكيد من المحادثة (مثل العميل يشير لعقار انرسل له قبل) كمله بين قوسين مربعين [هكذا] عشان يبان إنه تفسير.
- إذا الرسالة بالإنجليزي خلها بالإنجليزي.
- unclear=true إذا النص بعد التصحيح لسا ما ينفهم مقصده.`;

const fixSchema = {
  type: "object", additionalProperties: false,
  properties: { text: { type: "string" }, unclear: { type: "boolean" } },
  required: ["text", "unclear"],
};

async function transcribeBlob(blob: Blob, ext: string, model: string, prompt: string) {
  const form = new FormData();
  form.append("file", blob, `voice.${ext}`);
  form.append("model", model);
  form.append("prompt", prompt.slice(0, 900));
  form.append("response_format", "json");
  const r = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }, body: form });
  const p = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`transcribe_${model}_${r.status}:${String(p?.error?.message || "").slice(0, 160)}`);
  return String(p?.text || "").trim();
}

async function fixText(raw: string, context: string) {
  try {
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: FIX_MODEL, store: false, reasoning: { effort: "low" }, instructions: FIX_RULES,
        input: `آخر المحادثة (الأقدم أولاً):\n${context || "(ما في)"}\n\nنص الصوتية كما طلع من التحويل:\n${raw}`,
        text: { format: { type: "json_schema", name: "voice_fix", strict: true, schema: fixSchema } },
      }),
      signal: AbortSignal.timeout(25000),
    });
    const p = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(p?.error?.message || `fix_${r.status}`);
    const out = JSON.parse(p.output_text || p.output?.flatMap((x: any) => x?.content || []).find((x: any) => x?.type === "output_text")?.text || "{}");
    const text = String(out.text || "").trim();
    // a "fix" that is far longer or shorter than the raw text is not a fix: keep the raw text
    if (!text || text.length > raw.length * 1.6 + 40 || text.length < raw.length * 0.5) return { text: raw, unclear: false };
    return { text, unclear: !!out.unclear };
  } catch (e) {
    console.error("[voice] fix", String((e as any)?.message || e).slice(0, 200));
    return { text: raw, unclear: false };
  }
}

/** Download a WhatsApp voice note with any of the tokens and return the text the agent should read. */
export async function transcribeVoice(tokens: string[], mediaId: string, graph: string, context = ""): Promise<{ text: string; raw: string; model: string; unclear: boolean } | null> {
  if (!OPENAI_API_KEY) return null;
  for (const t of tokens) {
    try {
      const metaR = await fetch(`https://graph.facebook.com/${graph}/${mediaId}`, { headers: { Authorization: `Bearer ${t}` } });
      const meta = await metaR.json().catch(() => ({}));
      if (!metaR.ok || !meta?.url) continue;
      const fileR = await fetch(meta.url, { headers: { Authorization: `Bearer ${t}` } });
      if (!fileR.ok) continue;
      const blob = await fileR.blob();
      const mime = String(meta.mime_type || blob.type || "audio/ogg");
      const ext = mime.includes("mpeg") ? "mp3" : mime.includes("mp4") || mime.includes("m4a") ? "m4a" : mime.includes("wav") ? "wav" : mime.includes("webm") ? "webm" : "ogg";
      const lastOffice = context.split("\n").filter((l) => l.includes("المكتب:")).slice(-1)[0] || "";
      const prompt = VOICE_VOCAB + (lastOffice ? ` آخر رسالة من المكتب: ${lastOffice.replace(/^.*?المكتب:\s*/, "").slice(0, 200)}` : "");
      let raw = "", model = PRIMARY;
      try { raw = await transcribeBlob(blob, ext, PRIMARY, prompt); }
      catch (e) { console.error("[voice]", String((e as any)?.message || e)); }
      if (!raw) { model = FALLBACK; raw = await transcribeBlob(blob, ext, FALLBACK, prompt).catch(() => ""); }
      if (!raw) return null;
      const fixed = await fixText(raw, context);
      return { text: fixed.text.slice(0, 4000), raw: raw.slice(0, 4000), model, unclear: fixed.unclear };
    } catch (e) { console.error("[voice] download", String((e as any)?.message || e).slice(0, 200)); }
  }
  return null;
}
