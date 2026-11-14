// Daily follow-ups (owner's decisions, 5 Nov 2026). Called by cron with the reply-agent secret.
// 1. Reads each waiting follow-up's whole chat, voice notes included. It either writes a text for this client to send
//    from the branch phone, removes it (owner offering, moved to the other branch, topic closed), or saves what the client wants.
// 2. Owner's decision: everything reaches his list first and he sends it from the branch phone. What he has not sent by
//    10am the day after it reached the list goes out by itself, 20 a day at most, if the review says the fixed text fits:
//    a UTILITY template, or free text inside the 24 hour window. MARKETING cost keeps waiting for him.
// 3. 90 minutes after a visit it asks the client's opinion as free text inside the 24 hour window, never a template (SQL68).
// 4. If the window would close before that moment, it asks the client to confirm the visit while the window is still open,
//    so a reply keeps the after-visit follow-up free (SQL70).
// 5. «أمر للذكاء الاصطناعي» on the list (owner only, SQL72): the owner's instruction rewrites one follow-up from the whole chat,
//    or removes it with the reason kept. The instruction is saved in crm_owner_notes as a lesson that every later review reads.
//    It also covers voice notes nobody can read: he writes what was said and the text follows his words.
// 6. Owner's decision 6 Nov: a reviewed follow-up whose 24 hour window is still open goes out from the AI at once as free text
//    (the review's own text for this client). He does not have to send it. Outside the window nothing changes.
// 7. Owner's decision 6 Nov (SQL73): visit results are the AI's job. A past visit with no result (last 30 days) whose client
//    has written since the last check is read from the chat; done / no_show / postponed / cancelled and the client's opinion
//    are saved on the visit (sync_viewing_to_crm moves the deal). A serious buyer raises «🔥 مشتري جاد» for the owner.
// 8. Ahmed 10 Nov (point 1): a visit already recorded done with no opinion (last 30 days) gets the client's opinion from the
//    chat the same way (liked / hesitant / wants to negotiate / disliked and why). Only the opinion is written, never the status.
//    AGENTS.md deals rule: an opinion is written only while the client's card is still at the visit and the property is
//    available (opinionBlocked); a card at negotiation, a booking or later, or lost is Ahmed's. This pass starts only after
//    SQL77 and its 77b cleanup (a merged card exists). Deploy: apply every 10 Nov SQL file first (76 -> 77 -> 77b -> 76b ->
//    77c -> 78), and only then re-pin this function: an opinion or an R21 row written while 77b runs stops 77b.
// 9. R21 (Ahmed 10 Nov): a client who said «بشوف وبرد عليك» / «بشوف الأهل وأرجع لك» and went quiet gets ONE light question
//    before his 24 hour window closes, then space (once per chat in 14 days). Free text only. It starts with «السلام عليكم»
//    like every follow-up, never «هلا».
// Stops when whatsapp_automation_runtime.visit_followups_auto is false. A failed send stays on the list.
import { createClient } from "npm:@supabase/supabase-js@2";

const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const OPENAI_MODEL = Deno.env.get("REPLY_AGENT_MODEL") || Deno.env.get("OPENAI_MODEL") || "gpt-5.6-luna";
const GRAPH = Deno.env.get("META_GRAPH_VERSION") || "v25.0";
const WINDOW_MS = 24 * 3600 * 1000;
const ALLOWED_ORIGINS = ["https://omanvilla.github.io"]; // «متابعات اليوم» sends the owner's instruction from here
const DAILY_LIMIT = 20, REVIEWS_PER_RUN = 24, REVIEWS_AT_ONCE = 6, AFTER_VISIT_PER_RUN = 10;

const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const enc = new TextEncoder();
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json; charset=utf-8" } });
const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const short = (v: unknown, n = 500) => { const s = String(v ?? "").trim(); return s.length > n ? s.slice(0, n) + "…" : s; };
function cors(req: Request) {
  const origin = req.headers.get("origin") || "";
  return { "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0], "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
}
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

قواعد ثابتة من أحمد (6 و7 نوفمبر)، تنطبق دايماً:
- اقرأ المحادثة كاملة وافهم أي عقار يتكلمون عنه بالضبط (مثل الحيل الجنوبية مو الخوض السابعة) قبل ما تكتب. إذا مو واضح، skip مع reason يشرح، بدل ما تخمن. وافق قواعد الردود الآلية، وما تتعارض معها.
- ما تقول "عزيزتي" أبداً لأنثى، خاطبها بالمؤنث بدون "عزيزتي".
- متابعة بعد زيارة: سمّ العقار بالضبط واسأل هل شافه وهل ناسبه. لو الكلام عن عقار أرسلنا فيه رقم صاحب العقار للزيارة، اسأل هل شاف البيت وهل ناسبه.
- العميل اللي أرسلنا له التفاصيل بس وما سألناه متى يزور، أو ما أرسلنا له رقم صاحب العقار: لا تسأله "كيف لقيت"، اسأله "متى يناسبك تزور ؟".
- العقار اللي سأل عنه العميل وانباع أو انحجز: إذا مكتوب تحت في "وحدات انحجزت ولها وحدة متاحة من نفس المجموعة" (R38، أحمد 12 نوفمبر): لا تقول انباع وخلاص ولا تعرض بديل ثاني. المتابعة تقول السطر المكتوب له بالحرف (مثل "انحجزت وحدة منها والمتبقي الثانية والثالثة") وتسأله "تحب تشوفها ؟". إذا مو مكتوب هناك: المتابعة تقول إنه انباع (أو انحجز) وتعرض الخيارات المتاحة في نفس المنطقة، وإذا ما في خيارات skip.
- متابعة بعد زيارة لعقار مكتوب جنبه "(انباع)" أو "(انحجز)" أو "(ما عاد متوفر)" (R44، أحمد 12 نوفمبر: أمير الرحبي وعبدالله الحارثي): skip. لا تسأله "كيف شفت" عن عقار انباع، رسالة «انحجز/انباع» الجماعية هي اللي توصله. وكذلك أي عميل موضوعه مع أحمد خلص (زار وسأل السعر النهائي ورد عليه أحمد، أو مشتري جاد) وانباع العقار: skip.
- "مشيت شفته" أو "رحت شفته" أو "مريت عليه" أو "شفته" = زار وشاف العقار (R44، مازن). إذا بعدها سأل "في عندك بيوت ثانية ؟" أو "غيره ؟" فهو visited_no_fit: لا تسأله عن انطباعه، اعرض الأقرب من القائمة غير اللي شافه (offer_no)، وإذا ما عرفنا وش يبي subject = "بيت ثاني في [المنطقة]".
- إذا تواصلنا معه أكثر من مرة في نفس الموضوع وما رد (حتى لو من أشهر): skip، ولا تكتب له مرة ثانية. نفس الحال في أي متابعة ثانية بنفس الوضع، بدون ما ينتظر أحمد.
- مواضيع الاستثمار والمشاريع (مدينة السلطان هيثم، وادي زها، الآيكونيك، عايدة، اليزن، المستحقين، التملك الحر، الإقامة) (R35، أحمد 12 نوفمبر): ما تنترك، لها قائمة المستثمرين على رقم مسقط. المتابعة تكمل موضوعه: الأرقام المكتوبة في المعرفة بس (R18)، والعزيمة لاجتماع مع المطور في مكتبه (الأهلي صبور في العذيبة، دار جلوبال عند دار الأوبرا لعايدة) (R33). ممنوع أسئلة الاستبيان مثل "الشراء عندك للسكن ولا للاستثمار ؟" و"تفضل تبحث عن فيلا مستقلة ولا نوع ثاني". العمل بعد الشراء: skip.
- التبادل (عقار بعقار): skip، الموضوع غير مناسب.
- ممنوع أي كلمة إنجليزية أو رمز برمجي (مثل twin_villa أو villa أو apartment) في النص لعميل يكتب بالعربي. اكتب العقار بالاسم اللي يعرفه العميل بالعربي (مثل "فيلا الشخاخيط") وبدون ذكر نوع غريب.
- إذا ما في محادثة مسجلة للعميل (سجل قديم أو نموذج من الموقع وما كلمنا): decision=skip وreason "عميل بدون محادثة واتساب، يحتاج اتصال منك" بدون نص.
- عميل زار البيت ولما سألناه ما أعطى جواب واضح: skip، لأنه إذا ناسبه برجع لنا.
- ما عندنا صور، عندنا الفيديو بس (R34): لا تعد بصور أبداً ولا تسأل "أرسل لك الصور ؟". بيت المالك ساكن فيه: "بحكم إن المالك ساكن في البيت ما صورنا البيت من الداخل عشان الخصوصية بس نقدر نرتب لك زيارة وتشوفه على راحتك متى يناسبك ؟".
- الكلام واضح وصحيح (R35): جملة كاملة مفهومة عن الموضوع اللي سأل عنه العميل بالضبط، بدون كلمات ناقصة أو مركبة غلط (مثل "تفضل تبحث عن فيلا مستقلة نوع ثاني من الوحدات"). إذا سأل سؤال وجوابه مكتوب في تفاصيل العقار (المساحة، الغرف، الإيجار): text يجاوبه ويسأل سؤال واحد بعده. إذا جوابه مو مكتوب: لا تعيد سؤاله عليه ("كم المساحة المتبقية ؟")، اكتب "بخصوص سؤالك عن ..." وسؤال يكمل مثل "متى يناسبك تزور وتشوفه ؟".
- عميل رد خلال أقل من 24 ساعة: القرار followup والنص جاهز يرسل مباشرة، مو للانتظار.
- طلب غرفة وصالة أو شقة وما رجع: اسأل بس "لين الحين تبحث عن غرفة وصالة ؟" بدون كلمة "جديدة". أي رسالة "نزل عندنا" لمن سأل عن نفس الشقة قبل: اسأل بس "لين الحين تبحث عن شقق للإيجار ؟".
- الإيجار القصير (R55، أحمد 14 نوفمبر): عميل يطلب حجز أو إيجار ليوم أو ليلة أو ويكند أو بتاريخ محدد (استراحة، شاليه، مزرعة) وما في القائمة إيجار مدته المسموحة يومي أو أسبوعي: skip، بدون wait_for_match وبدون "اول ما يتوفر". "حجز" استراحة بتاريخ يعني إيجار، مو شراء.
- لا تسأل "للإيجار أو الشراء ؟" أبداً إذا العميل قال قصده أو واضح من كلامه (R55).

وضع العميل (R39، أحمد 12 نوفمبر): قبل القرار اقرأ "ملف العميل من النظام" (زياراته وصفقاته وطلباته) مع المحادثة كاملة، وحدد في stage وين وصل. كل عميل ياخذ رسالة على حسب وضعه، مو نفس الرسالة للكل، واللي جاوب على سؤال ما ينعاد عليه:
- asked_no_visit: سأل وما زار. (القواعد فوق: "متى يناسبك تزور ؟" إذا ما سألناه، وسكوته بعد التفاصيل جواب.)
- booked_no_show: تحدد له موعد زيارة وما جاء، أو انلغى الموعد وما تحدد غيره. اسأله إذا يحب نحدد له موعد ثاني، مو "كيف شفت". واكتب في subject اسم العقار اللي كان موعده عليه.
- visited_not_asked: زار (مسجل إن الزيارة تمت، أو قال إنه زار) وما سألناه عن رأيه. اسأله عن انطباعه وهل ناسبه، بالاسم.
- visited_no_answer: زار وسألناه عن رأيه وما أعطى جواب واضح. skip (القاعدة فوق).
- visited_liked: زار وقال رأي إيجابي أو قال بيفكر أو بيشاور. لا تعيد عليه سؤال "كيف شفت" ولا "هل ناسبك". سؤال واحد يكمل (مثل هل وصل لقرار).
- visited_no_fit: زار وقال ما ناسبه. اكتب السبب في reason (الموقع، المساحة، السعر، التشطيب...). لا تعيد عليه سؤال الرأي. إذا في القائمة عقار متاح يقارب طلبه ويحل السبب اللي قاله: اعرضه في text وحط رقمه في offer_no. إذا ما في: wait_for_match.
- budget_lower: ميزانيته أقل من اللي سأل عنه. اعرض بس اللي في حدود ميزانيته من القائمة (offer_no). إذا ما في: wait_for_match واحفظ ميزانيته في request.
- other_area: يبي منطقة ثانية. اعرض المتاح في المنطقة اللي قالها (offer_no). إذا ما في: wait_for_match.
- negotiating: في تفاوض على السعر، أو عنده صفقة شغالة (تفاوض، عربون، تمويل). skip، هذا لأحمد.
- not_buyer: مالك أو وسيط أو مو عميل يبحث، أو موضوعه انتهى (اشترى، حصل، قال ما يبغى). skip.
- unclear: ما يتضح من المحادثة والملف.

التفاوض لصاحب المكتب بس: لا تفتح موضوع السعر ولا تخفيض في text.
إذا فيه "[رسالة صوتية قديمة ما انقرت]" قريب من آخر المحادثة، ما تعرف اللي انقال فيها: لا تخمن، قل هذا في reason، وخل auto_ok=false.

text (لـ followup بس): رسالة واحدة يرسلها صاحب المكتب بنفسه باللهجة العمانية البسيطة. إذا واضح من الاسم أو الكلام إنها امرأة خاطبها بالمؤنث. تبدأ بـ "السلام عليكم". سطر أو سطرين، خاصة بهذا العميل، وسؤال واحد ينتهي بـ " ؟". لا تكرر سؤال انجاب عليه، واقرأ ردود المكتب الصوتية كاملة قبل ما تقول إن سؤاله ما انجاب. لا تخترع شي مو مكتوب. لا تنقل كلمات وقت من كلام قديم (اليوم، بكرة، أمس، بعد الصلاة، الساعة)، اسأل عن العقار نفسه بدون وقت. لا تناديه باسم إلا إذا قاله بنفسه في المحادثة، اسم الواتساب مو دليل على اسمه. ممنوع: الفواصل والنقاط وعلامات التعجب، الأسعار إلا سعر عقار تعرضه، الوعود، كلمة هلا.
reason: سطر قصير لصاحب المكتب يوضح وضع العميل، مثل "شاف فيلا الرميس وما عجبه الموقع".
auto_ok: true بس إذا النص الثابت "${"{fixed}"}" مناسب لهذا العميل لو انرسل بدل text. إذا العميل سأل سؤال وما جاه رد، auto_ok=false.
request: اللي يبغاه العميل إذا واضح من كلامه، وإلا null. لا تكتب شي ما قاله.
subject (R35): بعد 24 ساعة من آخر رسالة للعميل ما ينرسل text، ينرسل قالب واتساب ثابت "بخصوص طلبك {subject} لين الحين تبحث ؟". اكتب في subject العقار أو الموضوع اللي سأل عنه العميل بالضبط بكلمتين لخمس، بالعربي وبدون "طلبك" وبدون سؤال، مثل "بيت الحيل الجنوبية" أو "توين فيلا الرميس" أو "عقار في مدينة السلطان هيثم" أو "شقة في المعبيلة". إذا ما في موضوع واضح: null.
stage (R39): وحدة من القيم المكتوبة فوق في "وضع العميل".
offer_no (R39): رقم العقار من "العقارات المتاحة الآن" (الرقم اللي بين القوسين في أول سطره) إذا text يعرض عليه عقار منها، وإلا null. لا تعرض عقار مو في القائمة.
قالب متابعة الطلب بعد 24 ساعة على حسب stage (R39): visited_not_asked ينرسل له "السلام عليكم كيف شفت العقار وايش انطباعك عنه ؟"، و booked_no_show ينرسل له "بخصوص موعد زيارتك {subject} تحب نحدد لك موعد ثاني ؟"، واللي له offer_no ينرسل له "بخصوص طلبك {subject} عندنا {العقار} تحب ارسلك تفاصيله ؟"، والباقي "بخصوص طلبك {subject} لين الحين تبحث ؟". في متابعة الطلب auto_ok=true بس إذا قالب وضعه هذا يناسبه لو انرسل بدل text.`;
const reviewSchema = {
  type: "object", additionalProperties: false,
  properties: {
    decision: { type: "string", enum: ["followup", "skip", "wait_for_match"] },
    reason: { type: "string" },
    text: { type: ["string", "null"] },
    auto_ok: { type: "boolean" },
    subject: { type: ["string", "null"] },
    stage: { type: "string", enum: ["asked_no_visit", "booked_no_show", "visited_not_asked", "visited_no_answer", "visited_liked", "visited_no_fit", "budget_lower", "other_area", "negotiating", "not_buyer", "unclear"] },
    offer_no: { type: ["number", "null"] },
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
  required: ["decision", "reason", "text", "auto_ok", "request", "subject", "stage", "offer_no"],
};
// R39: where the client stands, as Ahmed reads it on his list (in front of the review's reason)
const STAGE_AR: Record<string, string> = {
  asked_no_visit: "سأل وما زار", booked_no_show: "حدد زيارة وما جاء", visited_not_asked: "زار وما انسأل عن رأيه", visited_no_answer: "زار وما جاوب",
  visited_liked: "زار وعجبه أو يفكر", visited_no_fit: "زار وما ناسبه", budget_lower: "ميزانيته أقل", other_area: "يبي منطقة ثانية",
  negotiating: "في تفاوض", not_buyer: "مو عميل يبحث أو موضوعه انتهى", unclear: "وضعه مو واضح",
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

// The owner's lessons (his instructions and notes, kept by crm_owner_notes in whatsapp_agent_prompts.lessons), read once a minute
let lessonsCache = { at: 0, text: "" };
async function lessons() {
  if (Date.now() - lessonsCache.at < 60000) return lessonsCache.text;
  const r = await db.from("whatsapp_agent_prompts").select("content").eq("key", "lessons").maybeSingle();
  lessonsCache = { at: Date.now(), text: newestPart(r.data?.content, 6000) };
  return lessonsCache.text;
}
// The lessons are stored oldest first ("- [DD/MM] ..."), so a long text keeps its END: Ahmed's newest corrections were the part
// cut before (audit 10 Nov). It starts at a whole lesson (or line) when one starts in the first half of what is kept.
function newestPart(text: unknown, n = 6000) {
  const s = String(text ?? "").trim();
  if (s.length <= n) return s;
  const tail = s.slice(-n);
  const lesson = tail.indexOf("\n- [");
  const line = tail.indexOf("\n");
  const cut = lesson >= 0 && lesson < n / 2 ? lesson + 1 : line >= 0 && line < n / 2 ? line + 1 : 0;
  return "…" + tail.slice(cut);
}

// R39 (Ahmed 12 Nov): the client's file as the CRM has it, so the review knows where he stands: his visits (result, opinion,
// why it did not suit), his cards (stage, why one closed) and his open requests. No money figure but the listing price.
const VISIT_AR: Record<string, string> = { scheduled: "موعد محدد", confirmed: "موعد مؤكد", postponed: "تأجلت", done: "تمت", cancelled: "انلغت", no_show: "ما جاء" };
const DEAL_AR: Record<string, string> = {
  new: "جديدة", viewing_scheduled: "موعد زيارة", viewing_no_show: "ما جاء للزيارة", viewing_cancelled: "الزيارة انلغت", viewing_postponed: "الزيارة تأجلت", visit: "زار",
  negotiation: "تفاوض", deposit: "عربون", awaiting_finance: "ينتظر التمويل", finance_approved: "التمويل موافق عليه", awaiting_clearance: "ينتظر براءة الذمة",
  ownership_transfer: "نقل الملكية", closed: "تم البيع له", commission_collected: "تم البيع له", lost: "انقفلت",
};
const propLine = (pr: any) => pr ? `${propertyName(pr) || typeAr(pr.type)}${pr.price ? ` بـ ${Number(pr.price).toLocaleString("en-US")}` : ""}${pr.status === "sold" ? " (انباع)" : pr.status === "reserved" ? " (انحجز)" : pr.status && pr.status !== "available" || pr.archived ? " (ما عاد متوفر)" : ""}` : "عقار";
async function clientFile(companyId: string, clientId: string) {
  try {
    const [vs, ds, rs] = await Promise.all([
      db.from("viewings").select("viewing_date,status,liked,client_feedback,rejection_reason,pipeline_outcome,outcome_note,properties(type,area,price,status,archived)").eq("company_id", companyId).eq("client_id", clientId).eq("archived", false).order("viewing_date", { ascending: false }).limit(8),
      db.from("deals").select("stage,lost_from_stage,lost_reason_note,updated_at,properties(type,area,price,status,archived)").eq("company_id", companyId).eq("client_id", clientId).is("merged_into_deal_id", null).order("updated_at", { ascending: false }).limit(6),
      db.from("client_requests").select("property_type,property_types,preferred_area,preferred_areas,budget_max,search_status,next_action").eq("company_id", companyId).eq("client_id", clientId).eq("status", "active").order("updated_at", { ascending: false }).limit(3),
    ]);
    const lines: string[] = [];
    for (const v of vs.data || []) {
      const said = [v.liked === true ? "عجبه" : v.liked === false ? "ما عجبه" : "", v.client_feedback ? `رأيه: ${short(v.client_feedback, 200)}` : "", v.rejection_reason ? `سبب الرفض: ${short(v.rejection_reason, 150)}` : "", v.outcome_note ? `ملاحظة: ${short(v.outcome_note, 150)}` : ""].filter(Boolean).join(" | ");
      lines.push(`- زيارة ${v.viewing_date || ""}: ${propLine((v as any).properties)} | ${VISIT_AR[String(v.status)] || v.status}${said ? ` | ${said}` : v.status === "done" ? " | رأيه ما انسجل" : ""}`);
    }
    for (const d of ds.data || []) lines.push(`- صفقة على ${propLine((d as any).properties)}: ${DEAL_AR[String(d.stage)] || d.stage}${d.stage === "lost" ? `${d.lost_from_stage ? ` من مرحلة ${DEAL_AR[String(d.lost_from_stage)] || d.lost_from_stage}` : ""}${d.lost_reason_note ? ` (${short(d.lost_reason_note, 150)})` : ""}` : ""}`);
    for (const r of rs.data || []) {
      const types = [...(Array.isArray(r.property_types) ? r.property_types : []), r.property_type].filter(Boolean).map(typeAr);
      const areas = [...(Array.isArray(r.preferred_areas) ? r.preferred_areas : []), r.preferred_area].filter(Boolean);
      lines.push(`- طلب مفتوح: ${[...new Set(types)].join(" أو ") || "عقار"}${areas.length ? ` في ${[...new Set(areas)].join(" أو ")}` : ""}${r.budget_max ? ` بحدود ${Number(r.budget_max).toLocaleString("en-US")}` : ""}${r.next_action ? ` | ${short(r.next_action, 120)}` : ""}`);
    }
    return lines.length ? `ملف العميل من النظام (زياراته وصفقاته وطلباته المسجلة، الأحدث أول):\n${lines.join("\n")}` : "ملف العميل من النظام: ما في زيارة ولا صفقة ولا طلب مسجل";
  } catch (e) { console.error("[followup-auto] client file", String((e as any)?.message || e)); return ""; }
}
// R38: units sold or booked in the last 150 days that still have an available unit of their group (SQL97), one minute cache
let unitGroupsCache = { at: 0, company: "", text: "" };
async function unitGroupsText(companyId: string) {
  if (unitGroupsCache.company === companyId && Date.now() - unitGroupsCache.at < 60000) return unitGroupsCache.text;
  let text = "";
  try {
    const g = await db.rpc("crm_unit_groups", { p_company: companyId });
    if (g.error) console.error("[followup-auto] unit groups", g.error.message);
    else text = ((g.data as any[]) || []).map((u: any) => `- ${typeAr(u.type)} ${u.area || ""} بـ ${Number(u.price || 0).toLocaleString("en-US")}: ${u.line}`).join("\n");
  } catch (e) { console.error("[followup-auto] unit groups", String((e as any)?.message || e)); }
  unitGroupsCache = { at: Date.now(), company: companyId, text };
  return text;
}

async function review(item: any, companyId: string, available: string, fixed: string, about: string, instruction = "", current = "") {
  const learnt = await lessons();
  // R39: the whole chat (the last 120 messages; a very long one keeps its newest 30,000 characters), not the last 40
  const chat = item.conversation_id ? newestPart(await chatOf(item.conversation_id, 120), 30000) : "";
  const [file, groups] = await Promise.all([clientFile(companyId, item.client_id), unitGroupsText(companyId)]);
  const others = await db.from("whatsapp_conversations").select("id,route_key").eq("company_id", companyId).eq("client_id", item.client_id).neq("id", item.conversation_id || "00000000-0000-0000-0000-000000000000").limit(2);
  const person = await db.from("clients").select("name").eq("id", item.client_id).maybeSingle();
  let behavior = "";
  try { const bh = await db.rpc("crm_client_behavior_text", { p_client: item.client_id }); if (!bh.error && bh.data) behavior = String(bh.data); } catch (_) { /* optional */ }
  let other = "";
  for (const c of others.data || []) other += `\nمحادثته على رقم ${c.route_key === "barka" ? "بركاء" : "مسقط"}:\n${await chatOf(c.id, 12)}\n`;
  const ai = await fetch("https://api.openai.com/v1/responses", {
    method: "POST", headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: OPENAI_MODEL, store: false, reasoning: { effort: "low" }, instructions: REVIEW_RULES.replace("{fixed}", fixed),
      input: `تاريخ اليوم: ${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Muscat" }).format(new Date())}\nسبب وجوده في القائمة: ${about}\nالاسم المسجل من الواتساب، يفيد بس لمعرفة إذا امرأة: ${person.data?.name || "غير معروف"}\nرقمنا اللي نتابع منه: ${item.route_key === "barka" ? "بركاء" : "مسقط"}${behavior ? `\n\n${behavior}\n(المتجوّل ما نتابعه بنفس الأسلوب: اسأله وش يبحث بالضبط. الساخن أولوية. البارد متابعة متباعدة. غير المعقول طلبه: لا تتابع.)` : ""}${file ? `\n\n${file}` : ""}${learnt ? `\n\nدروس من صاحب المكتب من أوامر سابقة (طبقها إذا الموقف مشابه):\n${learnt}` : ""}${instruction ? `\n\nالنص الحالي للمتابعة (اللي يشوفه أحمد الحين): ${current || "لا يوجد"}\n\nأمر صاحب المكتب على هذي المتابعة (أهم من أي قاعدة فوق): ${instruction}\nكيف تفهم الأمر: أحمد يتكلم بلهجته وأحياناً بالصوت، فالأمر ممكن يجي غير مرتب. افهم قصده الحقيقي، ولا تنقل كلامه حرفياً ولا تلصقه في الرسالة. غالباً هو تصحيح للنص الحالي: (1) "بدل X اكتب Y" أو "لا تكتب X" يعني غيّر هذا الجزء بس وخل باقي النص مثل ما هو. (2) "لا تقول كذا قل كذا" يعني استبدل المعنى. (3) قاعدة عامة (مثل: لا تكتب كلمات إنجليزية لعميل عربي) طبقها على هذي الرسالة وعلى أي كلمة إنجليزية فيها. (4) تغيير الهدف (مثل: اسأله متى يناسبه يزور) اكتب النص من جديد. الناتج رسالة مرتبة بلهجة المكتب وبنفس القواعد الثابتة، مو نسخة من كلام أحمد. إذا يقول إن المتابعة ما لها داعي قرارك skip. لا تخالف الممنوعات ولا تكتب معلومة مو مكتوبة قدامك، وإذا يقول وش انقال في رسالة صوتية صدقه. في reason اكتب بسطر وش فهمت منه وش غيرت.` : ""}\n\nالعقارات المتاحة الآن:\n${available || "لا يوجد"}${groups ? `\n\nوحدات انحجزت ولها وحدة متاحة من نفس المجموعة (R38):\n${groups}` : ""}\n\nالمحادثة:\n${chat || "ما في محادثة مسجلة"}\n${other}`,
      text: { format: { type: "json_schema", name: "followup_review", strict: true, schema: reviewSchema } } }),
  });
  const p = await ai.json().catch(() => ({}));
  if (!ai.ok) throw new Error(p?.error?.message || `openai_${ai.status}`);
  const out = JSON.parse(p.output_text || p.output?.flatMap((x: any) => x?.content || []).find((x: any) => x?.type === "output_text")?.text || "{}");
  out.text = out.text ? String(out.text).replace(/[،,!]/g, " ").replace(/\.(\s|$)/g, "$1").replace(/\s*[؟?]/g, " ؟").replace(/\s+/g, " ").trim() : null;
  if (out.text) out.text = out.text.replace(/\s*عزيزتي\s*/g, " ").replace(/\s+/g, " ").trim();
  if (out.text && !out.text.startsWith("السلام عليكم")) out.text = `السلام عليكم ${out.text}`;
  { const ar = arabicOnly(out.text); out.text = ar.text; if (ar.latin) { out.auto_ok = false; out.reason = short(`${out.reason} (فيه كلمة إنجليزية، راجعها قبل الإرسال)`, 300); } }
  // one question only
  if (out.text && out.text.includes("؟")) out.text = out.text.slice(0, out.text.indexOf("؟") + 1);
  // an unread voice note near the end means nobody knows what was said; he decides, never the automatic send
  if (chat.split("\n").slice(-6).some((l: string) => l.includes("[رسالة صوتية قديمة ما انقرت]"))) out.auto_ok = false;
  // R55: the client's own lines, for the code guard in judge() (removed there, never stored)
  out.client_said = chat.split("\n").filter((l: string) => /^\[[^\]]*\] العميل: /.test(l)).map((l: string) => l.replace(/^\[[^\]]*\] العميل: /, "")).join("\n");
  return out;
}

// R55 (Ahmed 14 Nov 2026 «نعم، سوّها», from Maram's note of 11 Nov: a client asked to book a rest house for 26 Nov and his
// follow-up read «الاستراحة للإيجار أو الشراء ؟»). Held by code after the review answers, on the client's own lines (normAr):
// (1) a short rent of a rest house, chalet or farm (a booking with a date, a day, a night, a weekend) while no available rent
//     accepts a day or a week: no follow-up. skip, not wait_for_match: the brain says no «اول ما يتوفر» for a short rent.
//     Never for a client who spoke of buying, visited, has a visit booked or is negotiating, and only when the follow-up
//     itself is about that rent.
// (2) «للإيجار أو الشراء ؟» is never asked when the client already said which: the row's own wording goes instead and
//     it waits for the office (auto_ok=false).
// Not applied over an instruction given on that follow-up, nor to a message prepared for everyone.
const R55_RENT = /ايجار|اجار|استاجر|تاجير|مستاجر/;
const R55_BUY = /شراء|اشتري|بشتري|نشتري|تملك|للبيع/;
const R55_LEISURE = /استراح|شاليه|مزرع/;
const R55_BOOK = /(حجز|احجز|نحجز|حجوزات)(?!\s*(موعد|زياره|معاينه))/;
const R55_SHORT = /(^|\s)(ال)?يومي(ه)?(?=\s|$)|باليوم|يوم واحد|ليله (وحده|واحده)|ليلتين|ويكند|نهايه الاسبوع|مبيت/;
const R55_DATE = /\d{1,4}\s*[\/\-.]\s*\d{1,2}|تاريخ/;
const R55_ASK = /(ايجار|اجار)\s+(او|ولا|لو|ام|والا)\s+(ال|لل)?(شراء|بيع|تملك)|(شراء|بيع|تملك)\s+(او|ولا|لو|ام|والا)\s+(ال|لل)?(ايجار|اجار)/;
const R55_STAGES = ["asked_no_visit", "budget_lower", "other_area", "not_buyer", "unclear"];
const r55Norm = (s: unknown) => normAr(s).replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
function shortRentGuard(out: any, clientSaid: string, shortRentAvailable: boolean, fallback: string) {
  const said = r55Norm(clientSaid);
  const shortAsk = !R55_BUY.test(said) && ((R55_LEISURE.test(said) && (R55_SHORT.test(said) || (R55_BOOK.test(said) && R55_DATE.test(said)))) || (R55_RENT.test(said) && R55_SHORT.test(said)));
  const about = r55Norm(`${out.text || ""} ${out.subject || ""} ${out.reason || ""}`);
  if (shortAsk && !shortRentAvailable && out.decision !== "skip" && R55_STAGES.includes(String(out.stage)) && (R55_LEISURE.test(about) || R55_RENT.test(about) || R55_BOOK.test(about))) {
    out.reason = short(`(R55) يبي إيجار قصير بيوم أو تاريخ محدد وما عندنا إيجار بهالمدة، ما يحتاج متابعة. ${out.reason || ""}`, 300);
    out.decision = "skip"; out.text = null; out.auto_ok = false; out.offer_no = null; out.guard = "guard_short_rent";
    return out;
  }
  if (out.decision === "followup" && out.text && R55_ASK.test(r55Norm(out.text)) && (shortAsk || R55_RENT.test(said) || R55_BUY.test(said))) {
    const base = String(fallback || "").replace(/\s+/g, " ").trim();
    if (base) out.text = base.startsWith("السلام عليكم") ? base : `السلام عليكم ${base}`;
    else { out.decision = "skip"; out.text = null; }
    out.auto_ok = false; out.guard = "guard_rent_or_buy";
    out.reason = short(`(R55) انشال سؤال «إيجار أو شراء» لأن العميل قال قصده. ${out.reason || ""}`, 300);
  }
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

async function judge(kind: "visit" | "request", x: any, companyId: string, available: string, instruction = "") {
  // a new voice note still being transcribed: read this client on a later run, so nothing reaches him half read
  // (not when the owner has given an instruction: he has told us what he wants)
  if (x.conversation_id && !instruction) {
    const pending = await db.from("whatsapp_messages").select("id").eq("conversation_id", x.conversation_id).eq("message_type", "audio").is("transcript", null).gte("message_timestamp", new Date(Date.now() - 48 * 3600 * 1000).toISOString()).limit(1);
    if ((pending.data || []).length) throw new Error("voice_note_pending");
  }
  let about = "متابعة طلب: هل لين الحين يبحث";
  let name = "";
  if (kind === "visit") {
    const v = await db.from("viewings").select("viewing_date,status,properties(type,area)").eq("id", x.viewing_id).maybeSingle();
    const pr: any = (v.data as any)?.properties;
    name = propertyName(pr);
    about = `متابعة بعد زيارة ${name || "عقار"} يوم ${v.data?.viewing_date || "غير معروف"}. ${v.data?.status === "done" ? "الزيارة تمت" : "ما نعرف هل زار"}.`;
    if (name) about += ` اسم العقار للعميل: ${name}. إذا سؤالك عن الزيارة اسأله عن رأيه في ${name} بالاسم، مثل "كيف شفت ${name} وايش انطباعك عنها ؟" ("عنه" للبيت والمبنى والمحل). ممنوع سؤال عام مثل "قدرت تشوف العقار ؟" أو "شفت العقار ؟" أو "بخصوص الزيارة"، وممنوع "كيف لقيت" (تنفهم «لقيتوا مكانها ؟»، R29).`;
    if (x.after_visit) about += " هذي متابعة بعد موعد الزيارة بساعة ونص، وهذا أهم وقت للبيع (R47، أحمد 14 نوفمبر: بدون استثناء). قرارك followup واسأله عن رأيه في العقار بالاسم، حتى لو أحمد أو الموظفة كتبوا له أو كلمنا بعد الزيارة في شي ثاني. skip بس في ثلاث حالات: قال رأيه في العقار بنفسه بعد الزيارة، أو العقار انباع أو انسحب (R44)، أو في تفاوض أو صفقة شغالة مع أحمد. وإذا المحادثة تقول صراحة إنه ما زار (أجّل أو ألغى) اسأله هل قدر يزور بدل سؤال الرأي.";
  }
  const fixed = kind === "visit" ? String(x.body || "") : (x.messages || []).join(" ");
  // R39: a message prepared for everyone who asked about one property is read against each client's chat and file too.
  // Its wording is Ahmed's and stays; the review only says whether it fits this client.
  if (kind === "request" && x.kind === "property_sold") about = `رسالة جماعية لكل من سأل عن عقار انحجز أو انباع (${short(x.summary, 150) || "عقار"}). النص اللي ينتظر موافقة أحمد وما يتغير: "${fixed}". قرارك followup إذا الرسالة تناسب وضع هذا العميل (واكتب text نفس النص)، و skip إذا ما تناسبه: اشترى أو حصل، قال ما يبغى، زار وقال ما ناسبه، موضوعه انتهى، مو عميل يبحث، أو في تفاوض. auto_ok=false.`;
  if (kind === "request" && x.kind === "new_listing") about = `رسالة جماعية عن عقار جديد نزل ممكن يناسب طلبه (${short(x.summary, 150) || "طلبه"}). النص اللي ينتظر موافقة أحمد وما يتغير: "${fixed}". قرارك followup إذا لين الحين يبحث والعقار يناسب اللي قاله (واكتب text نفس النص)، و skip إذا ما يناسبه أو موضوعه انتهى أو في تفاوض. auto_ok=false.`;
  const out = await review(x, companyId, available, fixed, about, instruction, x.owner_text || fixed);
  // R55: the short-rent guard, before anything else reads the decision
  const clientSaid = String(out.client_said || "");
  delete out.client_said;
  if (!instruction && !(kind === "request" && ["property_sold", "new_listing"].includes(String(x.kind)))) {
    const subject = String(out.subject || "").replace(/^\s*(بخصوص\s+)?طلبك\s+/, "").replace(/[؟?،,.!]/g, " ").replace(/\s+/g, " ").trim();
    const fallback = kind === "request" && subject && subject.length <= 60 && !/[A-Za-z]/.test(subject) ? `بخصوص طلبك ${subject} لين الحين تبحث ؟` : fixed;
    shortRentGuard(out, clientSaid, (await availableList(companyId)).shortRent, fallback);
  }
  if (kind === "visit") out.text = namedVisitQuestion(out.text, name);
  // R39: a client who already gave his opinion is never asked the step-1 opinion question again by the fixed template
  if (kind === "visit" && Number(x.step) === 1 && ["visited_liked", "visited_no_fit"].includes(String(out.stage))) out.auto_ok = false;
  // R39: the offered property is taken from the very list the review read (same snapshot), by its number
  out.offer_label = "";
  if (Number.isInteger(out.offer_no) && out.offer_no > 0) { const l = await availableList(companyId); if (l.text === available) out.offer_label = l.labels[out.offer_no - 1] || ""; }
  // R36: a step-1 follow-up on a test wording asks the same opinion question in that wording (his instruction still wins)
  if (kind === "visit" && Number(x.step) === 1 && !instruction) out.text = variantVisitQuestion(out.text, name, await variantFor(companyId, "visit_step1", x.variant_label));
  return out;
}

// R36 (Ahmed 11 Nov 2026, SQL93): comparison of follow-up wordings. A row carries variant_label. «A» (or no label) is today's
// wording and nothing here changes for it: no read, no rewrite. Another letter is a wording Ahmed wrote and approved on the
// screen, whose template Meta approved as UTILITY on both numbers; it is read from whatsapp_followup_variants (one minute cache).
const variantCache = new Map<string, { at: number; v: any }>();
async function variantFor(companyId: string, kind: "visit_step1" | "request_followup", label: unknown) {
  const l = String(label || "");
  if (!l || l === "A") return null;
  const k = `${companyId}|${kind}|${l}`, hit = variantCache.get(k);
  if (hit && Date.now() - hit.at < 60000) return hit.v;
  const r = await db.from("whatsapp_followup_variants").select("label,text,template_name").eq("company_id", companyId).eq("kind", kind).eq("label", l).in("status", ["testing", "winner"]).maybeSingle();
  variantCache.set(k, { at: Date.now(), v: r.data || null });
  return r.data || null;
}
const oneLine = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
// today's after-visit opinion question (R29), as namedVisitQuestion or the review writes it
const OPINION_Q = /كيف\s+شفت(ي)?\s.*انطباعك/;
function variantVisitQuestion(text: string | null, name: string, v: any) {
  if (!v || !text || !(OPINION_Q.test(text) || GENERIC_VISIT_Q.test(text))) return text;
  return oneLine(String(v.text).replace("{العقار}", name || "العقار"));
}
// Is this text the wording itself, with any property or subject in its place ? A text the review wrote for one client is not.
function isVariantText(text: unknown, wording: unknown, word: string) {
  const quote = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${quote(oneLine(wording)).replace(quote(word), ".+")}$`).test(oneLine(text));
}
// Which wording really went, for the results. undefined = the row is not part of the comparison, leave its label alone.
// A template is its row's wording. Free text counts only when it is that wording; otherwise the label is cleared.
async function sentVisitLabel(f: any, service: boolean, body: string) {
  if (Number(f.step) !== 1 || !f.variant_label) return undefined;
  if (!service) return f.variant_label;
  if (f.variant_label === "A") return OPINION_Q.test(body) || oneLine(body) === oneLine(f.body) ? "A" : null;
  const v = await variantFor(f.company_id, "visit_step1", f.variant_label);
  return v && isVariantText(body, v.text, "{العقار}") ? f.variant_label : null;
}
// The subject the review found goes into a request follow-up on a test wording: its own lines and template variable.
async function variantSubject(id: string, subject: string) {
  const r = await db.from("whatsapp_outreach_queue").select("company_id,variant_label,template_name").eq("id", id).maybeSingle();
  const v = r.data ? await variantFor(r.data.company_id, "request_followup", r.data.variant_label) : null;
  if (!v || v.template_name !== r.data?.template_name) return;
  await db.from("whatsapp_outreach_queue").update({ template_params: [subject], messages: String(v.text).replace("{الموضوع}", subject).split("\n").map(oneLine).filter(Boolean) })
    .eq("id", id).eq("status", "pending").eq("variant_label", v.label);
}

// The property as the client knows it: type and area ("فيلا الرميس"). The title is internal (owner names, numbers).
function propertyName(pr: any) {
  const area = String(pr?.area || "").trim();
  return area ? `${typeAr(pr?.type)} ${area}` : "";
}
// Owner's rule 6 Nov: after a recorded visit the client is asked his opinion of the property by name, never a generic
// "قدرت تشوف العقار ؟" / "بخصوص الزيارة". If the review still wrote one, it becomes the opinion question below.
// R29 (Ahmed 11 Nov): «كيف لقيتي فيلا الشخاخيط ؟» was read as «did you find the place ?» («ايوه لقيناها») and the agent said
// «مبروك». The question asks the opinion in plain words; Ahmed's wording (11 Nov, later): «السلام عليكم كيف شفت(ي) <name>
// وايش انطباعك عنها ؟» («عنه» for a house, building, shop...). Any «كيف لقيت» or the first wording («عجبتك ولا ما ناسبتك») becomes it.
const GENERIC_VISIT_Q = /(تشوف|تشوفين|تشوفي|شفت|شفتي)\s+العقار|بخصوص\s+الزيارة|كيف\s+لقيت(ي|وا|و)?|عجبتك\s+ولا\s+ما\s+ناسبتك/;
function namedVisitQuestion(text: string | null, name: string) {
  if (!text || !GENERIC_VISIT_Q.test(text)) return text;
  const she = /(قدرتي|شفتي|تشوفين|تشوفي|لقيتي)/.test(text);
  // no property name: keep the text, only «كيف لقيت» becomes «كيف شفت» with the impression question
  if (!name) return /كيف\s+لقيت/.test(text) ? text.replace(/كيف\s+لقيت(ي|وا|و)?/, (_m, s) => "كيف شفت" + (s === "ي" ? "ي" : "")).replace(/\s*؟?\s*$/, " وايش انطباعك عنه ؟") : text;
  const him = /^(بيت|منزل|مبنى|محل|مكتب|مستودع|مخزن|معرض)(\s|$)/.test(name);
  return `السلام عليكم كيف شفت${she ? "ي" : ""} ${name} وايش انطباعك ${him ? "عنه" : "عنها"} ؟`;
}

async function reviewOne(kind: "visit" | "request", x: any, companyId: string, available: string) {
  return applyDecision(kind, x, companyId, await judge(kind, x, companyId, available));
}

// R39 (Ahmed 12 Nov 2026): outside the 24 hours a request follow-up goes as the template that fits where the client stands,
// as Ahmed chose by hand for the 35 Rizwan clients on 12 Nov. Only rows on today's template or on one of these (never the
// financing follow-up, never a test wording of R36), and only when the template is approved on the client's number; whether
// it may go by itself is still the UTILITY rule of the sender. null = today's template «بخصوص طلبك … لين الحين تبحث ؟».
const STAGE_TEMPLATES = ["request_followup_ar_v2", "visit_followup_1_ar_v1", "visit_followup_1_ar_v2", "visit_missed_rebook_ar_v1", "request_offer_match_ar_v1"];
async function stageTemplate(x: any, companyId: string, out: any, subject: string) {
  if (x.kind && x.kind !== "request_followup") return null;
  if (x.template_name && !STAGE_TEMPLATES.includes(String(x.template_name))) return null;
  const approved = async (name: string) => {
    const r = await db.from("whatsapp_template_registry").select("status").eq("company_id", companyId).eq("route_key", x.route_key).eq("template_name", name).maybeSingle();
    return String(r.data?.status || "").toUpperCase() === "APPROVED";
  };
  const stage = String(out.stage || "");
  if (stage === "visited_not_asked") {
    const [t, tx] = await Promise.all([db.rpc("crm_visit_followup_template", { p_step: 1, p_route: x.route_key }), db.rpc("crm_visit_followup_text", { p_step: 1, p_route: x.route_key })]);
    const name = String(t.data || ""), text = String(tx.data || "");
    if (!t.error && !tx.error && name && text && await approved(name)) return { step: "visit_impression", template_name: name, template_params: [], messages: [text] };
    return null;
  }
  if (stage === "booked_no_show" && subject && await approved("visit_missed_rebook_ar_v1"))
    return { step: "missed_visit", template_name: "visit_missed_rebook_ar_v1", template_params: [subject], messages: [`بخصوص موعد زيارتك ${subject}`, "تحب نحدد لك موعد ثاني ؟"] };
  const offer = String(out.offer_label || "");
  if (offer && subject && ["visited_no_fit", "budget_lower", "other_area"].includes(stage) && await approved("request_offer_match_ar_v1"))
    return { step: "offer_available", template_name: "request_offer_match_ar_v1", template_params: [subject, offer], messages: [`بخصوص طلبك ${subject}`, `عندنا ${offer} تحب ارسلك تفاصيله ؟`] };
  return null;
}

// Writes the review's decision. With the owner's instruction the instruction is kept on the row and the day's wait
// (reviewed_at) does not move. Returns "kept", "waiting_match", "removed", or "not_pending" when it was sent or changed meanwhile.
async function applyDecision(kind: "visit" | "request", x: any, companyId: string, out: any, instruction = "") {
  const now = new Date().toISOString();
  const table = kind === "visit" ? "whatsapp_visit_followups" : "whatsapp_outreach_queue";
  const openStatus = kind === "visit" ? "awaiting_approval" : "pending";
  // R39: where the client stands goes in front of the reason Ahmed reads on his list, and on the row (client_stage)
  const stage = STAGE_AR[String(out.stage)] ? String(out.stage) : null;
  const reason = short(`${stage && stage !== "unclear" ? `[${STAGE_AR[stage]}] ` : ""}${out.reason}`, 300);
  const extra: any = instruction ? { owner_instruction: short(instruction, 1000), instructed_at: now, client_stage: stage } : { reviewed_at: now, client_stage: stage };
  // a message prepared for everyone (sold notice, new listing): its wording is Ahmed's, so a kept row only gets the reason
  const mass = kind === "request" && ["property_sold", "new_listing"].includes(String(x.kind));
  if (mass && out.decision === "followup") {
    const w = await db.from(table).update({ review_reason: reason, auto_ok: false, ...extra }).eq("id", x.id).eq("status", openStatus).select("id");
    return (w.data || []).length ? "kept" : "not_pending";
  }
  if (out.decision === "followup" && out.text) {
    const w = await db.from(table).update({ owner_text: short(out.text, 500), review_reason: reason, auto_ok: !!out.auto_ok, ...extra }).eq("id", x.id).eq("status", openStatus).select("id");
    // R35 (12 Nov): past 24 hours the template «بخصوص طلبك {1} لين الحين تبحث ؟» goes, so {1} is what the client really asked about
    const subject = String(out.subject || "").replace(/^\s*(بخصوص\s+)?طلبك\s+/, "").replace(/[؟?،,.!]/g, " ").replace(/\s+/g, " ").trim();
    const subjectOk = !!subject && subject.length <= 60 && !/[A-Za-z]/.test(subject);
    // R39 (12 Nov): past 24 hours the template follows where the client stands (asked his opinion after a visit, offered a new
    // time for a missed visit, offered the available property that fits), when that template is approved on his number
    const staged = kind === "request" && (w.data || []).length ? await stageTemplate(x, companyId, out, subjectOk ? subject : "") : null;
    if (staged) {
      const s = await db.from(table).update({ ...staged, variant_label: null }).eq("id", x.id).eq("status", openStatus).in("template_name", STAGE_TEMPLATES).select("id");
      if (s.error) console.error("[followup-auto] stage template", s.error.message);
    } else if (kind === "request" && (w.data || []).length && subjectOk) {
      // a row that was on a stage template and no longer is goes back to today's template first
      if (x.template_name && x.template_name !== "request_followup_ar_v2" && STAGE_TEMPLATES.includes(String(x.template_name))) await db.from(table).update({ template_name: "request_followup_ar_v2", step: "still_searching" }).eq("id", x.id).eq("status", openStatus).eq("template_name", x.template_name);
      const a = await db.from(table).update({ template_params: [subject], messages: [`بخصوص طلبك ${subject}`, "لين الحين تبحث ؟"] }).eq("id", x.id).eq("status", openStatus).eq("template_name", "request_followup_ar_v2").select("id");
      // R36: not on today's template. If it is on a test wording, the subject goes into that wording instead.
      if (!a.error && !(a.data || []).length) await variantSubject(x.id, subject);
    }
    return (w.data || []).length ? "kept" : "not_pending";
  }
  // removed from the list; the reason stays on the record
  const w = kind === "visit"
    ? await db.from(table).update({ status: "stopped", error: `review_${out.decision}`, review_reason: reason, updated_at: now, ...extra, reviewed_at: instruction ? (x.reviewed_at || now) : now }).eq("id", x.id).eq("status", openStatus).select("id")
    : await db.from(table).update({ status: "skipped", reason: `review_${out.decision}`, review_reason: reason, ...extra, reviewed_at: instruction ? (x.reviewed_at || now) : now }).eq("id", x.id).eq("status", openStatus).select("id");
  if (!(w.data || []).length) return "not_pending";
  if (out.decision === "wait_for_match") { await saveRequest(companyId, x, out.request, reason); return "waiting_match"; }
  // (a sold notice or a new listing that does not fit this client says nothing about his request's own follow-up)
  if (kind === "request" && x.request_id && !mass) await db.from("client_requests").update({ next_followup: null, next_action: short(`ما يحتاج متابعة: ${reason}`, 300) }).eq("id", x.request_id);
  return "removed";
}

// The available list the review reads. R39: every line carries a number («[3]») the review returns in offer_no, so an offer
// outside the 24 hours names a property that really is on the list (labels[n - 1]), never one the model made up.
let availableCache = { at: 0, company: "", text: "", labels: [] as string[], shortRent: false };
// R55: the allowed rent terms, in the reply agent's words, so the review knows a short rent is not on the list
const RENT_TERMS: Record<string, string> = { daily: "يومي", weekly: "أسبوعي", monthly: "شهري", "3m": "3 شهور", "6m": "6 شهور", yearly: "سنة" };
const rentTerms = (p: any) => p.listing_purpose === "rent" && (p.rental_terms || []).length ? ` | مدة الإيجار المسموحة: ${(p.rental_terms as string[]).map((t) => RENT_TERMS[t] || t).join(" او ")}` : "";
// a rent that takes a day or a week; a rest house, chalet or farm for rent with no terms written counts too (not known = not refused)
const takesShortRent = (p: any) => p.listing_purpose === "rent" && ((p.rental_terms || []).some((t: string) => t === "daily" || t === "weekly") || (!(p.rental_terms || []).length && ["resthouse", "chalet", "farm"].includes(String(p.type || "").toLowerCase())));
const priceShort = (p: unknown) => { const n = Number(p || 0); return n >= 1000 ? `${String(Math.round(n / 100) / 10)} الف` : `${n} ريال`; };
async function availableList(companyId: string) {
  if (availableCache.company === companyId && Date.now() - availableCache.at < 60000) return availableCache;
  const props = await db.from("properties").select("type,area,price,bedrooms,listing_purpose,public_details,rented_units,rental_terms").eq("company_id", companyId).eq("status", "available").eq("archived", false).order("area").order("price").order("id");
  const rows = props.data || [];
  const text = rows.map((p: any, i: number) => `- [${i + 1}] ${typeAr(p.type)} ${p.listing_purpose === "rent" ? "للإيجار" : "للبيع"} في ${p.area} بـ ${Number(p.price || 0).toLocaleString("en-US")} ${p.bedrooms ? `${p.bedrooms} غرف` : ""}${rentTerms(p)}${p.rented_units ? ` | المؤجر حالياً: ${short(p.rented_units, 200)}` : ""}${p.public_details ? ` | التفاصيل: ${short(p.public_details, 700).replace(/\n+/g, " / ")}` : ""}`).join("\n");
  const labels = rows.map((p: any) => `${typeAr(p.type)}${p.listing_purpose === "rent" ? " للإيجار" : ""} في ${p.area} بـ ${priceShort(p.price)}`.replace(/\s+/g, " ").trim());
  availableCache = { at: Date.now(), company: companyId, text, labels, shortRent: rows.some(takesShortRent) };
  return availableCache;
}
async function availableText(companyId: string) {
  return (await availableList(companyId)).text;
}

// Reads what is on the list again under the current rules and returns the decisions. Writes nothing.
// Follow-ups the owner decided himself (they carry a reason) are left out.
async function preview(companyId: string, offset: number) {
  const f = await db.from("whatsapp_visit_followups").select("id,client_id,route_key,conversation_id,viewing_id,step,body,variant_label").eq("company_id", companyId).eq("status", "awaiting_approval").not("reviewed_at", "is", null).order("id");
  const q = await db.from("whatsapp_outreach_queue").select("id,client_id,route_key,conversation_id,request_id,messages").eq("company_id", companyId).eq("status", "pending").eq("kind", "request_followup").eq("dry_run", false).is("reason", null).not("reviewed_at", "is", null).order("id");
  const all: ["visit" | "request", any][] = [...(f.data || []).map((x: any) => ["visit", x] as ["visit", any]), ...(q.data || []).map((x: any) => ["request", x] as ["request", any])];
  const jobs = all.slice(offset, offset + REVIEWS_PER_RUN);
  const names = await db.from("clients").select("id,name").in("id", jobs.map(([, x]) => x.client_id));
  const nameOf = new Map((names.data || []).map((c: any) => [c.id, c.name]));
  const available = await availableText(companyId);
  const items: any[] = [];
  for (let i = 0; i < jobs.length; i += REVIEWS_AT_ONCE) {
    await Promise.all(jobs.slice(i, i + REVIEWS_AT_ONCE).map(async ([kind, x]) => {
      try { const r = await judge(kind, x, companyId, available); items.push({ kind, id: x.id, client: nameOf.get(x.client_id), route: x.route_key, decision: r.decision, guard: r.guard || null, stage: r.stage, offer: r.offer_label || null, subject: r.subject, auto_ok: !!r.auto_ok, reason: short(r.reason, 200), text: r.text, request: r.request }); }
      catch (e) { items.push({ kind, id: x.id, client: nameOf.get(x.client_id), error: String((e as any)?.message || e) }); }
    }));
  }
  return { total: all.length, offset, items };
}

// R1/R3 at preparation too (Ahmed 12 Nov): a follow-up of a chat that is in a negotiation with Ahmed (تفاوض / مشتري جاد /
// دراسة سعر) or muted is not read, so it is not on any list until the chat is handed back. A chat someone typed in by hand
// is read as before (the office sees it on the list) and every send still refuses it (chatHeld). An error counts as held.
async function negotiationHold(conversationId: string) {
  const r = await db.rpc("crm_chat_hold", { p_conversation: conversationId });
  return r.error ? true : ["negotiation", "muted"].includes(String(r.data || ""));
}
async function notInNegotiation(rows: any[], max: number, out: Record<string, number>) {
  const keep: any[] = [];
  for (const r of rows) {
    if (keep.length >= max) break;
    if (r.conversation_id && await negotiationHold(r.conversation_id)) { out.review_held = (out.review_held || 0) + 1; continue; }
    keep.push(r);
  }
  return keep;
}
async function reviewAll(companyId: string, out: Record<string, number>) {
  const fAll = await db.from("whatsapp_visit_followups").select("id,client_id,route_key,conversation_id,viewing_id,step,body,variant_label").eq("company_id", companyId).eq("status", "awaiting_approval").is("reviewed_at", null).order("created_at").limit(REVIEWS_PER_RUN * 4);
  const f = { data: await notInNegotiation(fAll.data || [], REVIEWS_PER_RUN, out) };
  const left = REVIEWS_PER_RUN - (f.data || []).length;
  // R39: the messages prepared for everyone (sold notice, new listing) are read against each client's chat and file as well
  const qAll = left > 0 ? await db.from("whatsapp_outreach_queue").select("id,client_id,route_key,conversation_id,request_id,messages,kind,summary,template_name,step").eq("company_id", companyId).eq("status", "pending").in("kind", ["request_followup", "property_sold", "new_listing"]).eq("dry_run", false).is("reviewed_at", null).order("created_at").limit(left * 4) : { data: [] as any[] };
  const q = { data: left > 0 ? await notInNegotiation((qAll as any).data || [], left, out) : [] as any[] };
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
      const s = await sendOne(f.data, numbers, true);
      const k2 = `after_visit_${s}`; out[k2] = (out[k2] || 0) + 1;
    } catch (e) { out.after_visit_failed = (out.after_visit_failed || 0) + 1; console.error("[followup-auto] after visit", String((e as any)?.message || e)); }
  }
}

// An unread voice note among the last messages: the text may miss what was said, so it waits for him.
async function unreadVoiceNearEnd(conversationId: string) {
  const r = await db.from("whatsapp_messages").select("message_type,transcript").eq("conversation_id", conversationId).order("message_timestamp", { ascending: false }).limit(8);
  return (r.data || []).some((m: any) => m.message_type === "audio" && !m.transcript);
}
// R1/R3 (Ahmed 8 Nov, docs/agent-rules.md): no follow-up to a chat Ahmed took (typed in it and has not handed it back)
// or that is in a negotiation with him. Same answer as the reply agent: crm_chat_hold(). Fails closed.
async function chatHeld(conversationId: string) {
  const r = await db.rpc("crm_chat_hold", { p_conversation: conversationId });
  return r.error ? true : !!r.data;
}

async function lastInbound(conversationId: string) {
  const r = await db.from("whatsapp_messages").select("message_timestamp").eq("conversation_id", conversationId).eq("direction", "inbound").order("message_timestamp", { ascending: false }).limit(1).maybeSingle();
  return r.data?.message_timestamp ? new Date(r.data.message_timestamp).getTime() : 0;
}

// Follow-ups on his list whose window is still open: the AI sends the review's text now, free. Request follow-ups too.
async function sendInWindow(companyId: string, numbers: string[], out: Record<string, number>) {
  const since = new Date(Date.now() - WINDOW_MS + 10 * 60000).toISOString();
  const open = await db.from("whatsapp_conversations").select("id").eq("company_id", companyId).in("route_key", ["barka", "muscat"]).gte("last_inbound_at", since).limit(200);
  const ids = (open.data || []).map((c: any) => c.id);
  if (!ids.length) return;
  const fs = await db.from("whatsapp_visit_followups").select("*").eq("company_id", companyId).eq("status", "awaiting_approval").not("reviewed_at", "is", null).not("owner_text", "is", null).in("conversation_id", ids).limit(AFTER_VISIT_PER_RUN);
  for (const f of fs.data || []) {
    if (await unreadVoiceNearEnd(f.conversation_id)) { out.in_window_voice_wait = (out.in_window_voice_wait || 0) + 1; continue; }
    const r = await sendOne(f, numbers, true);
    const k = `in_window_${r}`; out[k] = (out[k] || 0) + 1;
  }
  const qs = await db.from("whatsapp_outreach_queue").select("*").eq("company_id", companyId).eq("status", "pending").eq("kind", "request_followup").eq("dry_run", false).not("reviewed_at", "is", null).not("owner_text", "is", null).in("conversation_id", ids).limit(AFTER_VISIT_PER_RUN);
  for (const q of qs.data || []) {
    // one message per client per run: a visit follow-up already went to this client
    const already = await db.from("whatsapp_visit_followups").select("id").eq("client_id", q.client_id).eq("status", "sent").gte("sent_at", new Date(Date.now() - 3600000).toISOString()).limit(1);
    if ((already.data || []).length) continue;
    if (await unreadVoiceNearEnd(q.conversation_id)) { out.in_window_voice_wait = (out.in_window_voice_wait || 0) + 1; continue; }
    const r = await sendQueueText(q, numbers);
    const k = `in_window_request_${r}`; out[k] = (out[k] || 0) + 1;
  }
}

// Free text for a request follow-up inside the window. Same guards as sendOne. It also sends the R21 question (thinking_followup).
async function sendQueueText(q: any, numbers: string[]) {
  const thinking = q.kind === "thinking_followup";
  const [convR, clientR] = await Promise.all([
    db.from("whatsapp_conversations").select("*").eq("id", q.conversation_id).single(),
    db.from("clients").select("id,phone,phone_normalized,followup_suppressed,archived").eq("id", q.client_id).single(),
  ]);
  const conv = convR.data, client = clientR.data;
  if (!conv || !client) return "context_missing";
  const to = digits(client.phone_normalized || client.phone);
  if (!to || numbers.includes(to)) return "company_number";
  if (!["barka", "muscat"].includes(conv.route_key) || conv.route_key !== q.route_key) return "route_blocked";
  if (client.followup_suppressed || client.archived || conv.agent_muted || conv.human_handoff_required) return "held";
  if (await chatHeld(conv.id)) return "held_owner_chat";
  const lastIn = await lastInbound(conv.id);
  if (lastIn > new Date(q.created_at).getTime()) {
    await db.from("whatsapp_outreach_queue").update({ status: "skipped", reason: "client_wrote_after" }).eq("id", q.id).eq("status", "pending");
    return "superseded";
  }
  if (!(lastIn > 0 && Date.now() - lastIn < WINDOW_MS)) return "window_closed";
  const claim = await db.from("whatsapp_outreach_queue").update({ status: "sent", reason: "auto_in_window" }).eq("id", q.id).eq("status", "pending").select("id").maybeSingle();
  if (claim.error || !claim.data) return "taken";
  const now = new Date().toISOString();
  try {
    const wamid = await metaSend(await routeTokens(q.company_id, q.route_key), digits(conv.meta_phone_number_id), to, { type: "text", text: { preview_url: false, body: q.owner_text } });
    if (wamid) await db.from("whatsapp_messages").insert({
      company_id: q.company_id, conversation_id: conv.id, client_id: q.client_id, whatsapp_message_id: wamid,
      direction: "outbound", message_type: "text", sender_wa_id: digits(conv.meta_phone_number_id), recipient_wa_id: to,
      body: q.owner_text, message_timestamp: now, delivery_status: "sent", actor_type: "automated", channel_source: "crm_followup",
      raw_payload: { source: thinking ? "thinking_followup" : "request_followup", outreach_id: q.id, auto: true, in_window: true },
    });
    // R36: this text was written by the review for this client, so it is no wording's result (label cleared, A and the others alike)
    await db.from("whatsapp_outreach_queue").update({ send_mode: "service", sent_at: now, approved_at: now, meta_message_id: wamid, error: null, ...(q.variant_label ? { variant_label: null } : {}) }).eq("id", q.id);
    await db.from("whatsapp_conversations").update({ last_message_at: now, last_outbound_at: now, updated_at: now }).eq("id", conv.id);
    return "sent";
  } catch (e) {
    const why = short((e as any)?.message || e);
    // a request follow-up goes back on his list; the light R21 question is not tried again (a pending row would show on his
    // approvals list, and approving it there later could send it outside the moment it was written for)
    await db.from("whatsapp_outreach_queue").update(thinking ? { status: "failed", error: why } : { status: "pending", reason: null, error: why }).eq("id", q.id);
    await alertOwner(q.company_id, why);
    return "failed";
  }
}

// R21 (Ahmed 10 Nov, docs/agent-rules.md): a client who said «بشوف وبرد عليك» / «بشوف الأهل وأرجع لك» and went quiet gets ONE
// light question before his 24 hour window closes (18 to 23 hours after his last message), then space: once per chat in 14 days.
// Never over a chat Ahmed holds (R1), a muted chat, an open handoff, a running deal, a reply waiting for Ahmed, a follow-up already
// queued, an unread voice note, a company or staff number, an owner of a listed property or a paused client. The model writes the
// line or says it is not that case; the code refuses a number, a promise, pressure, «هلا» or English. Free text only, never a
// template. Like every follow-up (REVIEW_RULES) it starts with «السلام عليكم»; «هلا» is banned in follow-ups.
const THINK_PER_RUN = 10, THINK_EVERY_DAYS = 14, HOUR_MS = 3600 * 1000;
const ACTIVE_DEAL_STAGES = ["negotiation", "deposit", "awaiting_finance", "finance_approved", "awaiting_clearance", "ownership_transfer"];
// Arabic written either way: harakat and tatweel dropped, أ إ آ ٱ -> ا, ى -> ي, ة -> ه
const normAr = (s: unknown) => String(s ?? "").replace(/[\u064B-\u065F\u0670\u0640]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/\s+/g, " ");
// «بشوف وبرد عليك» and close ways of saying it, on normAr text: برد/ارد عليك، برجع لك، بشوف وارد، بشاور، بشوف الاهل، بكلم الاهل،
// بفكر، بخبرك، بعطيك خبر، بعلمك، بكلمك، بتواصل معك، خلني افكر، عطني وقت. The model still decides if it is really that case.
const THINK_RE = /(ب|ا|ن|بن)(رد|رجع)\s*(عليك|عليكم|لك|لكم)|(ب|ا|ن|بن)شوف\s*و\s*(ب|ا|ن|بن)?(رد|رجع|خبر|كلم|قول)|(ب|ا|ن|بن)(شاور|ستشير)|(ب|ا|ن|بن)(شوف|كلم|سال|شاور|تاكد من)\s*(ال)?(اهل|عايله|مدام|زوج|والد)|(ب|ا|ن|بن)فكر|(ب|ا|ن|بن)خبر(ك|كم)|(ب|ا|ن|بن)?عطي(ك|كم)\s*خبر|(ب|ا|ن|بن)علم(ك|كم)|(ب|ا|ن|بن)كلم(ك|كم)|(ب|ا|ن|بن)تواصل\s*مع|خلني\s*(اشوف|افكر|اشاور|اراجع)|(اعطني|عطني|عطوني)\s*(وقت|فرصه)|امهلني/;
const THINK_RULES = `تكتب متابعة خفيفة وحدة لعميل مكتب عقاري في عمان (رقم بركاء أو رقم مسقط). آخر كلام العميل فيه إنه بيشوف أو بيشاور أهله أو بيفكر وبيرد علينا، وفات حوالي يوم وما رد، ونافذة الواتساب قربت تتسكر. قرار أحمد (R21): سؤال خفيف واحد بس قبل ما تتسكر النافذة، وبعدها نعطيه مساحة.
اقرأ المحادثة كاملة وقرر:
- send=true بس إذا العميل فعلاً قال إنه بيفكر أو بيشاور أو بيشوف موضوع عقار أو عرض أرسلناه له وبيرجع لنا، والكلام واقف عنده.
- send=false إذا: كلامه عن وقت زيارة أو وصول (مثل "بخبرك متى أوصل")، أو هو مالك أو وسيط يعرض عقار، أو موضوعه انتهى أو قال ما يبغى أو لقى شي، أو عنده سؤال ما انجاب، أو فيه تفاوض أو حجز أو صفقة شغالة أو طلب اتصال أو اجتماع، أو مو واضح وش يقصد.
text (لـ send=true بس، وإلا null): سطر واحد قصير باللهجة العمانية يبدأ بـ "السلام عليكم" مثل كل المتابعات، وبعده سؤال خفيف واحد عن اللي قال إنه بيسويه، ينتهي بـ " ؟". مثل "السلام عليكم شاورت الأهل ؟" أو "السلام عليكم شفت الموضوع ؟" أو "السلام عليكم فكرت في الموضوع ؟"، وإذا تعرف اسمه "السلام عليكم <اسمه> شاورت الأهل ؟". بدون ضغط ولا استعجال، بدون وعد، بدون أي سعر أو رقم، بدون معلومة أو عرض جديد، ولا تسمّي العقار ولا أي مشروع. لا تناديه باسم إلا إذا قاله بنفسه في المحادثة أو المكتب ناداه به (اسم الواتساب مو دليل). المؤنث بس إذا الاسم أنثوي واضح أو "أم فلان" أو العميلة تكتب بالمؤنث، غير كذا مذكر. ممنوع الفواصل والنقاط وعلامات التعجب والكلمات الإنجليزية وكلمة هلا.
reason: سطر قصير لصاحب المكتب عن قرارك.`;
const thinkSchema = {
  type: "object", additionalProperties: false,
  properties: { send: { type: "boolean" }, text: { type: ["string", "null"] }, reason: { type: "string" } },
  required: ["send", "text", "reason"],
};
// one short line and one question, in Ahmed's punctuation: no commas, full stops or exclamation marks, a space before ؟
function thinkingText(t: unknown) {
  let s = String(t ?? "").replace(/[،,!.]/g, " ").replace(/\s*[؟?]/g, " ؟").replace(/\s+/g, " ").trim();
  if (s.includes("؟")) s = s.slice(0, s.indexOf("؟") + 1);
  // it starts with «السلام عليكم» like every follow-up (a greeting the model wrote itself is not doubled)
  s = s.replace(/^(ال)?سلام\s*عليكم\s*/, "");
  return s ? `السلام عليكم ${s}` : "";
}
// what the code never sends by itself (on normAr text): a number or a price, the word hala (banned in follow-ups, REVIEW_RULES),
// a promise (R5, R12), pressure, the unreleased projects (R18), English
const THINK_BAD = /[0-9\u0660-\u0669\u06F0-\u06F9]|(^|\s)(الف|ريال)(\s|$)|(^|\s)هلا+(\s|$)|اتصل|بتصل|نتصل|بكلمك|ارد عليك|برد عليك|برجع لك|ارجع لك|بخبرك|اتاكد|بتاكد|نتاكد|بسرعه|اخر فرصه|ينباع|ينحجز|احجز|تحجز|نحجز|عربون|خصم|يروح عليك|وادي/;
// the greeting, then a real question of two words at least
function thinkingOk(s: string) {
  const ask = String(s || "").replace(/^السلام عليكم/, "").replace("؟", "").trim();
  return !!s && s.startsWith("السلام عليكم") && s.endsWith("؟") && ask.split(" ").filter(Boolean).length >= 2 && s.length <= 90 && !THINK_BAD.test(normAr(s)) && !arabicOnly(s).latin;
}

// The client's last words: his last message 18 to 23 hours ago and after it only the reply agent's own answer (within 15 minutes);
// «بشوف وبرد عليك» in what he wrote in the half hour up to it; and the office or the agent had written to him before he said it.
async function thinkingMoment(conversationId: string, nowMs: number) {
  const r = await db.from("whatsapp_messages").select("direction,actor_type,channel_source,body,transcript,message_timestamp").eq("conversation_id", conversationId).order("message_timestamp", { ascending: false }).limit(12);
  const ms: any[] = r.data || [];
  const li = ms.findIndex((m: any) => m.direction === "inbound");
  if (li < 0) return null;
  const lastAt = new Date(ms[li].message_timestamp).getTime();
  if (nowMs - lastAt < 18 * HOUR_MS || nowMs - lastAt > 23 * HOUR_MS) return null;
  // a person, a follow-up or a later message after his last words: not this case
  if (ms.slice(0, li).some((m: any) => m.direction !== "outbound" || m.actor_type !== "automated" || m.channel_source !== "crm_reply_agent" || new Date(m.message_timestamp).getTime() - lastAt > 15 * 60000)) return null;
  let ti = -1;
  for (let i = li; i < ms.length; i++) {
    if (lastAt - new Date(ms[i].message_timestamp).getTime() > 30 * 60000) break;
    if (ms[i].direction === "inbound" && THINK_RE.test(normAr(`${ms[i].body || ""} ${ms[i].transcript || ""}`))) ti = i;
  }
  if (ti < 0) return null;
  let answered = ms.slice(ti + 1).some((m: any) => m.direction === "outbound");
  if (!answered && ms.length === 12) {
    const o = await db.from("whatsapp_messages").select("id").eq("conversation_id", conversationId).eq("direction", "outbound").lt("message_timestamp", ms[ti].message_timestamp).limit(1);
    answered = (o.data || []).length > 0;
  }
  return answered ? { lastAt } : null;
}

// Owners of a listed property (available or reserved) are answered by Ahmed himself, as in the reply agent.
async function listedOwnerPhones(companyId: string) {
  const [ow, lp] = await Promise.all([
    db.from("owners").select("id,phone").eq("company_id", companyId).limit(2000),
    db.from("properties").select("owner_id").eq("company_id", companyId).in("status", ["available", "reserved"]).eq("archived", false).limit(2000),
  ]);
  const listed = new Set((lp.data || []).map((p: any) => p.owner_id));
  return (ow.data || []).filter((o: any) => listed.has(o.id)).map((o: any) => digits(o.phone).slice(-8)).filter((x: string) => x.length === 8);
}

async function judgeThinking(c: any, name: string, today: string) {
  const chat = await chatOf(c.id, 30);
  const ai = await fetch("https://api.openai.com/v1/responses", {
    method: "POST", headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: OPENAI_MODEL, store: false, reasoning: { effort: "low" }, instructions: THINK_RULES,
      input: `تاريخ اليوم: ${today}\nرقمنا: ${c.route_key === "barka" ? "بركاء" : "مسقط"}\nالاسم المسجل من الواتساب، يفيد بس لمعرفة إذا امرأة: ${name || "غير معروف"}\n\nالمحادثة:\n${chat}`,
      text: { format: { type: "json_schema", name: "thinking_followup", strict: true, schema: thinkSchema } } }),
  });
  const p = await ai.json().catch(() => ({}));
  if (!ai.ok) throw new Error(p?.error?.message || `openai_${ai.status}`);
  return JSON.parse(p.output_text || p.output?.flatMap((x: any) => x?.content || []).find((x: any) => x?.type === "output_text")?.text || "{}");
}

// Once a run, after the other sends. dry (preview_thinking) reads and writes the line, but inserts and sends nothing.
async function thinkingFollowups(companyId: string, numbers: string[], out: Record<string, number>, dry = false) {
  const items: any[] = [];
  const nowMs = Date.now();
  const cs = await db.from("whatsapp_conversations").select("id,client_id,route_key,agent_muted,human_handoff_required")
    .eq("company_id", companyId).in("route_key", ["barka", "muscat"]).not("client_id", "is", null)
    .gte("last_inbound_at", new Date(nowMs - 23 * HOUR_MS).toISOString()).lte("last_inbound_at", new Date(nowMs - 18 * HOUR_MS).toISOString())
    .order("last_inbound_at", { ascending: true }).limit(100);
  if (cs.error) { console.error("[followup-auto] thinking", cs.error.message); return items; }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Muscat" }).format(new Date());
  const since = new Date(nowMs - THINK_EVERY_DAYS * 24 * HOUR_MS).toISOString();
  const seenClients = new Set<string>();
  let staff: string[] | null = null, owners: string[] | null = null, budget = THINK_PER_RUN;
  for (const c of cs.data || []) {
    if (budget <= 0) break;
    // muted or an open handoff (hard or not): the chat is Ahmed's
    if (c.agent_muted || c.human_handoff_required) continue;
    const skip = (why: string) => { out[`thinking_${why}`] = (out[`thinking_${why}`] || 0) + 1; if (dry) items.push({ conversation_id: c.id, skipped: why }); };
    try {
      const moment = await thinkingMoment(c.id, nowMs);
      if (!moment) continue;
      if (seenClients.has(c.client_id)) { skip("same_client"); continue; }
      const lastIso = new Date(moment.lastAt).toISOString();
      const [clientR, holdR, visitQ, queueQ, prevQ, dealQ, draftQ, tierR, elsewhereQ] = await Promise.all([
        db.from("clients").select("id,name,phone,phone_normalized,followup_suppressed,archived").eq("id", c.client_id).maybeSingle(),
        db.rpc("crm_chat_hold", { p_conversation: c.id }),
        db.from("whatsapp_visit_followups").select("id").eq("client_id", c.client_id).in("status", ["awaiting_approval", "sending"]).limit(1),
        db.from("whatsapp_outreach_queue").select("id").eq("client_id", c.client_id).in("status", ["pending", "approved"]).eq("dry_run", false).limit(1),
        db.from("whatsapp_outreach_queue").select("status,created_at").eq("conversation_id", c.id).eq("kind", "thinking_followup").gte("created_at", since),
        db.from("deals").select("id").eq("client_id", c.client_id).in("stage", ACTIVE_DEAL_STAGES).limit(1),
        db.from("whatsapp_reply_drafts").select("analysis").eq("conversation_id", c.id).eq("status", "pending").limit(5),
        db.from("client_behavior").select("tier").eq("client_id", c.client_id).maybeSingle(),
        db.from("whatsapp_conversations").select("id").eq("client_id", c.client_id).neq("id", c.id).gt("last_inbound_at", lastIso).limit(1),
      ]);
      if ([clientR, holdR, visitQ, queueQ, prevQ, dealQ, draftQ, tierR, elsewhereQ].some((x: any) => x.error)) { skip("check_failed"); continue; }
      const client: any = clientR.data;
      if (!client || client.followup_suppressed || client.archived || tierR.data?.tier === "unrealistic") { skip("paused_client"); continue; }
      const to = digits(client.phone_normalized || client.phone);
      if (!to || numbers.includes(to)) { skip("company_number"); continue; }
      if (!staff) staff = ((await db.from("profiles").select("phone").eq("company_id", companyId)).data || []).map((p: any) => digits(p.phone).slice(-8)).filter((x: string) => x.length === 8);
      if (staff.includes(to.slice(-8))) { skip("staff_number"); continue; }
      if (!owners) owners = await listedOwnerPhones(companyId);
      if (owners.includes(to.slice(-8))) { skip("property_owner"); continue; }
      if (holdR.data) { skip("held_owner_chat"); continue; }
      if ((dealQ.data || []).length || (draftQ.data || []).some((d: any) => !d.analysis?.dry_run)) { skip("with_ahmed"); continue; }
      if ((visitQ.data || []).length || (queueQ.data || []).length) { skip("other_followup_queued"); continue; }
      // once per chat in 14 days, and this silence is read once
      if ((prevQ.data || []).some((q: any) => q.status === "sent" || new Date(q.created_at).getTime() > moment.lastAt)) { skip("done_before"); continue; }
      if ((elsewhereQ.data || []).length) { skip("active_on_other_number"); continue; }
      if (await unreadVoiceNearEnd(c.id)) { skip("voice_wait"); continue; }
      budget--;
      seenClients.add(c.client_id);
      const r = await judgeThinking(c, client.name, today);
      const text = r?.send ? thinkingText(r.text) : "";
      const ok = !!text && thinkingOk(text);
      if (dry) { items.push({ conversation_id: c.id, send: !!r?.send, ok, text: text || null, reason: short(r?.reason, 300) }); continue; }
      // he wrote while the line was being written: the reply agent has the live chat
      if ((await lastInbound(c.id)) > moment.lastAt) { skip("client_wrote"); continue; }
      const now = new Date().toISOString();
      const row = { company_id: companyId, kind: "thinking_followup", conversation_id: c.id, client_id: c.client_id, route_key: c.route_key, review_reason: short(r?.reason, 300), reviewed_at: now, dry_run: false };
      if (!ok) {
        // not that case, or the line broke a rule: kept as skipped so this silence is not read again
        await db.from("whatsapp_outreach_queue").insert({ ...row, messages: [], owner_text: text || null, status: "skipped", reason: r?.send ? "thinking_text_refused" : "thinking_not_needed" });
        skip(r?.send ? "text_refused" : "not_needed");
        continue;
      }
      const ins = await db.from("whatsapp_outreach_queue").insert({ ...row, messages: [text], owner_text: text, summary: "متابعة «بشوف وبرد عليك» (R21)", auto_ok: true, status: "pending" }).select("*").maybeSingle();
      if (ins.error || !ins.data) { skip("not_queued"); continue; }
      // two runs at once: only the first row for this silence goes out
      const first = await db.from("whatsapp_outreach_queue").select("id").eq("conversation_id", c.id).eq("kind", "thinking_followup").gt("created_at", lastIso).order("created_at", { ascending: true }).limit(1).maybeSingle();
      if (first.data?.id !== ins.data.id) {
        await db.from("whatsapp_outreach_queue").update({ status: "skipped", reason: "thinking_duplicate" }).eq("id", ins.data.id).eq("status", "pending");
        skip("duplicate");
        continue;
      }
      const s = await sendQueueText(ins.data, numbers);
      // a guard stopped it at the last moment: the row leaves the queue instead of waiting on a list
      if (!["sent", "failed", "superseded", "taken"].includes(s)) await db.from("whatsapp_outreach_queue").update({ status: "skipped", reason: `thinking_${s}` }).eq("id", ins.data.id).eq("status", "pending");
      out[`thinking_${s}`] = (out[`thinking_${s}`] || 0) + 1;
      if (s === "failed") break;
    } catch (e) { out.thinking_error = (out.thinking_error || 0) + 1; console.error("[followup-auto] thinking", String((e as any)?.message || e)); }
  }
  return items;
}

const RESULT_RULES = `تقرأ محادثة واتساب لمكتب عقاري عن زيارة عقار فات موعدها، وتحدد وش صار. رجّع:
result: done إذا العميل قال إنه زار أو شاف العقار، أو كلامه يبين إنه شافه (مثل "في خيارات وبعد ما قررنا" بعد سؤال عن الزيارة). no_show إذا قال إنه ما راح أو ما قدر يروح وما حدد موعد ثاني. postponed إذا قال بيروح في يوم ثاني. cancelled إذا قال ما يبغى يزور أو لقى شي ثاني قبل الزيارة. unknown إذا ما رد أو كلامه ما يوضح.
opinion (لـ done بس، وإلا unknown): liked عجبه، negotiate يبغى يتفاوض أو سأل عن آخر سعر، hesitant يفكر أو متردد أو يشاور، disliked ما ناسبه، unknown ما قال.
reason (لـ disliked بس، وإلا null): واحد من price location area room_layout design finishing parking financing found_other not_interested not_serious.
new_date: لـ postponed إذا حدد يوم، بصيغة YYYY-MM-DD حسب تاريخ اليوم، وإلا null.
serious: true بس إذا العميل جاد يبغى يشتري أو يستأجر الحين: عجبه وطلب يحجز أو يدفع عربون، أو سأل عن آخر سعر أو يبغى يتفاوض، أو طلب يقابل المالك أو يكلم صاحب المكتب عشان يكمل.
note: سطر قصير بالعربي لصاحب المكتب عن اللي قاله العميل، بدون أسماء. لا تخترع شي مو مكتوب.
confidence من 0 إلى 1.`;
const resultSchema = {
  type: "object", additionalProperties: false,
  properties: {
    result: { type: "string", enum: ["done", "no_show", "postponed", "cancelled", "unknown"] },
    opinion: { type: "string", enum: ["liked", "negotiate", "hesitant", "disliked", "unknown"] },
    reason: { type: ["string", "null"], enum: ["price", "location", "area", "room_layout", "design", "finishing", "parking", "financing", "found_other", "not_interested", "not_serious", null] },
    new_date: { type: ["string", "null"] },
    serious: { type: "boolean" },
    note: { type: "string" },
    confidence: { type: "number" },
  },
  required: ["result", "opinion", "reason", "new_date", "serious", "note", "confidence"],
};
// Ahmed 10 Nov (point 1): a visit already recorded done is read for the client's opinion only; its status stays as it is
const OPINION_RULES = `تقرأ محادثة واتساب لمكتب عقاري عن عقار زاره العميل (الزيارة مسجلة إنها تمت)، وتحدد رأي العميل في هذا العقار بالذات من كلامه هو. رجّع:
opinion: liked عجبه أو ناسبه، negotiate يبغى يتفاوض أو سأل عن آخر سعر، hesitant يفكر أو متردد أو يشاور، disliked ما ناسبه، unknown ما قال رأيه أو كلامه عن عقار ثاني أو مو واضح.
reason (لـ disliked بس، وإلا null): واحد من price location area room_layout design finishing parking financing found_other not_interested not_serious.
serious: true بس إذا العميل جاد يبغى يشتري أو يستأجر الحين: عجبه وطلب يحجز أو يدفع عربون، أو سأل عن آخر سعر أو يبغى يتفاوض، أو طلب يقابل المالك أو يكلم صاحب المكتب عشان يكمل.
note: سطر قصير بالعربي لصاحب المكتب عن رأي العميل، بدون أسماء. لا تخترع شي مو مكتوب.
confidence من 0 إلى 1.`;
const opinionSchema = {
  type: "object", additionalProperties: false,
  properties: {
    opinion: { type: "string", enum: ["liked", "negotiate", "hesitant", "disliked", "unknown"] },
    reason: { type: ["string", "null"], enum: ["price", "location", "area", "room_layout", "design", "finishing", "parking", "financing", "found_other", "not_interested", "not_serious", null] },
    serious: { type: "boolean" },
    note: { type: "string" },
    confidence: { type: "number" },
  },
  required: ["opinion", "reason", "serious", "note", "confidence"],
};
const TYPE_AR: Record<string, string> = { house: "بيت", villa: "فيلا", twin_villa: "فيلا", "twin villa": "فيلا", apartment: "شقة", flat: "شقة", land: "أرض", land_residential: "أرض سكنية", land_commercial: "أرض تجارية", land_mixed: "أرض", building: "بناية", commercial_building: "مبنى تجاري", residential_building: "مبنى سكني", income_property: "عقار مؤجر", shop: "محل", office: "مكتب", farm: "مزرعة", chalet: "شاليه", resthouse: "استراحة", townhouse: "تاون هاوس", penthouse: "بنتهاوس", warehouse: "مخزن" };
// an internal type code must never reach a client: unknown English codes become "عقار"
const typeAr = (t: unknown) => TYPE_AR[String(t || "").toLowerCase()] || (/[a-z]/i.test(String(t || "")) || !t ? "عقار" : String(t));
// Owner's rule (8 Nov): no English words or codes in a text for an Arabic-writing client (twin_villa went out in follow-ups).
// Known type codes become Arabic; anything else in Latin letters (not a link) is left for him to see and blocks the automatic send.
function arabicOnly(text: string | null): { text: string | null; latin: boolean } {
  if (!text) return { text, latin: false };
  let s = text.replace(/\btwin[\s_-]*villa\b/gi, "فيلا");
  for (const [k, v] of Object.entries(TYPE_AR)) s = s.replace(new RegExp(`\\b${k.replace(/_/g, "[\\s_]")}\\b`, "gi"), v);
  s = s.replace(/(فيلا\s+){2,}/g, "فيلا ").replace(/\s+/g, " ").trim();
  return { text: s, latin: /[A-Za-z]{2,}/.test(s.replace(/https?:\/\/\S+/g, "")) };
}

const OPINION: Record<string, { feedback: string; outcome: string; liked: boolean | null }> = {
  liked: { feedback: "liked", outcome: "followup", liked: true },
  negotiate: { feedback: "wants_negotiate", outcome: "negotiation", liked: true },
  hesitant: { feedback: "hesitant", outcome: "followup", liked: null },
  disliked: { feedback: "disliked", outcome: "lost", liked: false },
};

// opinionOnly: a visit recorded done, read for the client's opinion only (OPINION_RULES)
async function judgeResult(v: any, today: string, opinionOnly = false) {
  const convs = await db.from("whatsapp_conversations").select("id,route_key").eq("company_id", v.company_id).eq("client_id", v.client_id).in("route_key", ["barka", "muscat"]).limit(2);
  let chat = "";
  for (const c of convs.data || []) chat += `${(convs.data || []).length > 1 ? `\nعلى رقم ${c.route_key === "barka" ? "بركاء" : "مسقط"}:\n` : ""}${await chatOf(c.id, 30)}\n`;
  if (!chat.trim()) return null;
  const pr: any = v.properties || {};
  const ai = await fetch("https://api.openai.com/v1/responses", {
    method: "POST", headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: OPENAI_MODEL, store: false, reasoning: { effort: "low" }, instructions: opinionOnly ? OPINION_RULES : RESULT_RULES,
      input: `تاريخ اليوم: ${today}\nالزيارة: ${typeAr(pr.type)} في ${pr.area || "غير معروف"} يوم ${v.viewing_date}${v.viewing_time ? ` الساعة ${String(v.viewing_time).slice(0, 5)}` : ""}${opinionOnly ? " (تمت)" : ""}\n\nالمحادثة:\n${chat}`,
      text: { format: { type: "json_schema", name: opinionOnly ? "visit_opinion" : "visit_result", strict: true, schema: opinionOnly ? opinionSchema : resultSchema } } }),
  });
  const p = await ai.json().catch(() => ({}));
  if (!ai.ok) throw new Error(p?.error?.message || `openai_${ai.status}`);
  return JSON.parse(p.output_text || p.output?.flatMap((x: any) => x?.content || []).find((x: any) => x?.type === "output_text")?.text || "{}");
}

async function alertSerious(companyId: string, clientId: string, name: string, body: string) {
  const o = await db.from("profiles").select("id").eq("company_id", companyId).eq("role", "owner").eq("is_active", true).limit(1).maybeSingle();
  if (!o.data) return;
  const seen = await db.from("notifications").select("id").eq("user_id", o.data.id).eq("client_id", clientId).like("title", "🔥%").gte("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString()).limit(1);
  if ((seen.data || []).length) return;
  await db.from("notifications").insert({ user_id: o.data.id, type: "whatsapp_handoff", is_read: false, client_id: clientId, link: "whatsapp", title: `🔥 مشتري جاد: ${name || "عميل"}`, body: short(body, 400) });
}

// Past visits with no result. Owner's rule 9 Nov: no visit stays open.
// 1. The client wrote after the visit day: the AI reads the chat and saves the result (done / no_show / postponed / cancelled).
// 2. Otherwise, or if the chat does not say: the property is sold or off the list -> «cancelled» with that reason (1 day after);
//    nothing known 5 days after the visit -> «cancelled» with a note that no result was found, so nothing hangs open.
// 3. A chat the owner holds himself (muted, he wrote by hand, negotiation) is never closed here; it shows on his list as held.
// 4. Ahmed 10 Nov (point 1): a visit already recorded done with no opinion (last 30 days: the agent's visit watcher, the office or a
//    repair saved "done" only) is read the same way when the client wrote after the visit day and the last check, for his opinion
//    only (liked / hesitant / wants to negotiate / disliked and why). Its status never changes and nothing closes it; unclear only
//    stamps the check; held chats get the same note. Repeated visits of one property are read once a run and saved on each.
// 5. AGENTS.md deals rule (review 10 Nov): an opinion is written only while the client's card is still at the visit
//    (opinionBlocked). A done visit whose card moved on (negotiation, a booking or later, a sale, lost) or whose property is
//    reserved is not read at all; an open visit is still closed with its result, but without the opinion when the card is
//    past the visit or the property is not available. The done-visit pass starts only once SQL77 and its 77b cleanup are
//    applied (a merged card exists): before 77 an opinion could add a second card, and before 77b it would change a card
//    that 77b checks, which stops that migration.
const NO_RESULT_DAYS = 5, OPINION_DAYS = 30;
const opinionSince = () => new Date(Date.now() - OPINION_DAYS * 24 * 3600 * 1000).toISOString().slice(0, 10);
// sync_viewing_to_crm moves this client's card of the property from the visit's opinion: «negotiate» sets negotiation and
// «disliked» sets lost on any card that is not closed (a booking too: lost cancels it), and «liked» / «hesitant» reopens a lost
// card and clears Ahmed's reason and dates. So the AI writes an opinion only when the property is available and every card of
// this client+property (merged duplicates aside) is new, a viewing_* stage or visit. Returns "" when it may, otherwise why it
// is left to Ahmed. Fails closed ("check_failed"). deals is read with * so this also works before SQL77 adds merged_into_deal_id.
const VISIT_STAGES = ["new", "viewing_scheduled", "viewing_no_show", "viewing_cancelled", "viewing_postponed", "visit"];
async function opinionBlocked(v: any) {
  try {
    const [cards, prop] = await Promise.all([
      db.from("deals").select("*").eq("company_id", v.company_id).eq("client_id", v.client_id).eq("property_id", v.property_id).limit(50),
      db.from("properties").select("status,archived").eq("id", v.property_id).maybeSingle(),
    ]);
    if (cards.error || prop.error || !prop.data) return "check_failed";
    if (prop.data.status !== "available" || prop.data.archived === true) return "property_not_available";
    const live = (cards.data || []).filter((d: any) => !d.merged_into_deal_id);
    if (live.some((d: any) => d.stage === "lost")) return "deal_lost";
    if (live.some((d: any) => !VISIT_STAGES.includes(d.stage))) return "deal_moved_on";
    return "";
  } catch (_) {
    return "check_failed";
  }
}
async function visitResults(companyId: string, out: Record<string, number>) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Muscat" }).format(new Date());
  const from = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const vs = await db.from("viewings").select("id,company_id,client_id,property_id,viewing_date,viewing_time,status,notes,ai_checked_at,row_version,properties(type,area,status,archived),clients(name)")
    .eq("company_id", companyId).eq("archived", false).in("status", ["scheduled", "confirmed", "postponed"]).lt("viewing_date", today).gte("viewing_date", from)
    .order("viewing_date", { ascending: false }).limit(80);
  // the done-visit pass waits for SQL77 and its 77b cleanup (point 5): 77b leaves merged cards and nothing removes them
  const merged = await db.from("deals").select("id").not("merged_into_deal_id", "is", null).limit(1);
  const opinionPass = !merged.error && (merged.data || []).length > 0;
  if (!opinionPass) out.visit_opinion_waits_sql77b = 1;
  const ds: any = opinionPass
    ? await db.from("viewings").select("id,company_id,client_id,property_id,viewing_date,viewing_time,status,notes,ai_checked_at,row_version,properties(type,area,status,archived),clients(name)")
      .eq("company_id", companyId).eq("archived", false).eq("status", "done").is("client_feedback", null).is("pipeline_outcome", null).lte("viewing_date", today).gte("viewing_date", opinionSince())
      .order("viewing_date", { ascending: false }).limit(60)
    : { data: [] };
  let budget = AFTER_VISIT_PER_RUN * 2;
  const dayMs = 24 * 3600 * 1000;
  const opinions = new Map<string, any>();
  // per client+property, once a run: "" when an opinion may be written, otherwise why it is left to Ahmed (opinionBlocked)
  const gates = new Map<string, string>();
  for (const v of [...(vs.data || []), ...(ds.data || [])]) {
    const now = new Date().toISOString();
    const done = v.status === "done";
    const pr: any = (v as any).properties || {};
    // a done visit of a property sold or off the list: the property automation closed its deal (Ahmed 10 Nov, point 2) and an
    // opinion written now would move that deal again (sync_viewing_to_crm reopens a lost card), so it is left as it is
    if (done && (["sold", "withdrawn", "not_available"].includes(pr.status) || pr.archived === true)) continue;
    // a done visit whose card is past the visit or lost, or whose property is reserved, is Ahmed's: not read, nothing written
    const key = `${v.client_id}|${v.property_id}`;
    if (done && !gates.has(key)) gates.set(key, await opinionBlocked(v));
    if (done && gates.get(key)) { const k = `visit_opinion_left_${gates.get(key)}`; out[k] = (out[k] || 0) + 1; continue; }
    const daysOver = Math.floor((new Date(`${today}T00:00:00+04:00`).getTime() - new Date(`${v.viewing_date}T00:00:00+04:00`).getTime()) / dayMs);
    const convs = await db.from("whatsapp_conversations").select("id").eq("company_id", companyId).eq("client_id", v.client_id).in("route_key", ["barka", "muscat"]).limit(2);
    const ids = (convs.data || []).map((c: any) => c.id);
    // the owner holds this chat: leave the visit as it is
    let held = false;
    let heldWhy = "";
    for (const id of ids) { const h = await db.rpc("crm_chat_hold", { p_conversation: id }); if (h.data) { held = true; heldWhy = String(h.data); } }
    if (held) {
      out.visit_held_by_owner = (out.visit_held_by_owner || 0) + 1;
      if (!String(v.notes || "").includes("[موقوفة عند أحمد]")) {
        const why = heldWhy === "muted" ? "العقل موقوف عندك" : heldWhy === "negotiation" ? "العميل في تفاوض معك" : "أنت ترد على المحادثة بنفسك";
        await db.from("viewings").update({ notes: [v.notes, `[موقوفة عند أحمد] ${today}: ${why}، ${done ? "رأي العميل بعد الزيارة ينتظرك" : "الزيارة تنتظر نتيجتك"}`].filter(Boolean).join("\n").slice(0, 2000) }).eq("id", v.id);
      }
      continue;
    }
    let patch: any = null, judged = false, writing = false;
    const since = [`${v.viewing_date}T00:00:00+04:00`, v.ai_checked_at].filter(Boolean).map((d: string) => new Date(d).getTime());
    let at = 0;
    if (ids.length) {
      const lastIn = await db.from("whatsapp_messages").select("message_timestamp").in("conversation_id", ids).eq("direction", "inbound").order("message_timestamp", { ascending: false }).limit(1).maybeSingle();
      at = lastIn.data?.message_timestamp ? new Date(lastIn.data.message_timestamp).getTime() : 0;
    }
    try {
      if (at && at > Math.max(...since) && budget > 0) {
        // repeated visits of one property (the visit watcher saved some twice): the opinion is read once a run, saved on each
        const again = done ? opinions.get(key) : undefined;
        if (!again) budget--;
        judged = true;
        const r = again || await judgeResult(v, today, done);
        if (done && r) opinions.set(key, r);
        if (r) {
          const stamp = `[الذكاء الاصطناعي ${today}] ${short(r.note, 300)}`;
          const notes = [v.notes, stamp].filter(Boolean).join("\n").slice(0, 2000);
          if (r.confidence >= 0.75) {
            if (done) {
              // recorded done: the opinion only, never the status
              const o = OPINION[r.opinion];
              if (o) patch = { client_feedback: o.feedback, liked: o.liked, pipeline_outcome: o.outcome, rejection_reason: r.opinion === "disliked" ? (r.reason || null) : null, outcome_note: short(r.note, 500), notes };
              // read the card again just before the write: it may have moved while the chat was read (Ahmed booked it). Then only
              // the check is stamped; repeated visits of this property in this run follow the same answer.
              if (patch && !again) {
                const why = await opinionBlocked(v);
                if (why) gates.set(key, why);
                if (why === "check_failed") throw new Error("deal_check_failed");
                if (why) patch = null;
              }
            } else if (r.result === "done") {
              // a card past the visit (negotiation, a booking or later) or a property not available: the visit is closed done and
              // its opinion is left to Ahmed, so the deal never moves. A lost card is left as before: any status write reopens it
              // in sync_viewing_to_crm (deals-sql guards that), and «disliked» at least keeps it lost.
              let o: any = OPINION[r.opinion];
              const why = o ? await opinionBlocked(v) : "";
              if (why === "check_failed") throw new Error("deal_check_failed");
              if (why && why !== "deal_lost") { o = undefined; out[`visit_opinion_left_${why}`] = (out[`visit_opinion_left_${why}`] || 0) + 1; }
              patch = { status: "done", client_feedback: o?.feedback || null, liked: o ? o.liked : null, pipeline_outcome: o?.outcome || "followup",
                rejection_reason: o && r.opinion === "disliked" ? (r.reason || null) : null, outcome_note: short(r.note, 500), notes };
            } else if (r.result === "no_show") patch = { status: "no_show", attendance: "not_attended", notes };
            else if (r.result === "cancelled") patch = { status: "cancelled", notes };
            else if (r.result === "postponed") patch = /^\d{4}-\d{2}-\d{2}$/.test(r.new_date || "") && r.new_date >= today ? { status: "scheduled", viewing_date: r.new_date, notes } : { status: "postponed", notes };
          }
          if (r.serious && r.confidence >= 0.6 && !again) { await alertSerious(companyId, v.client_id, (v as any).clients?.name, `${typeAr(pr.type)} في ${pr.area || ""}: ${r.note}`); out.serious_alert = (out.serious_alert || 0) + 1; }
          if (done) { const k = patch ? `visit_opinion_${r.opinion}` : gates.get(key) ? `visit_opinion_left_${gates.get(key)}` : "visit_opinion_unclear"; out[k] = (out[k] || 0) + 1; }
          else if (patch) out[`visit_result_${r.result}`] = (out[`visit_result_${r.result}`] || 0) + 1; else out.visit_result_unclear = (out.visit_result_unclear || 0) + 1;
        }
      }
      // nothing found in the chat: close by rule so the visit does not stay open (open visits only: a done visit keeps its status)
      if (!patch && !done) {
        const unavailable = ["sold", "withdrawn"].includes(pr.status) || pr.archived === true;
        if (unavailable && daysOver >= 1) {
          patch = { status: "cancelled", notes: [v.notes, `[الذكاء الاصطناعي ${today}] الزيارة ما صار لها نتيجة والعقار ${pr.status === "sold" ? "انباع" : "ما عاد متاح"}`].filter(Boolean).join("\n").slice(0, 2000) };
          out.visit_closed_unavailable = (out.visit_closed_unavailable || 0) + 1;
        } else if (daysOver >= NO_RESULT_DAYS) {
          patch = { status: "cancelled", notes: [v.notes, `[الذكاء الاصطناعي ${today}] ما لقيت في المحادثة نتيجة للزيارة بعد ${daysOver} أيام، انغلقت بدون نتيجة`].filter(Boolean).join("\n").slice(0, 2000) };
          out.visit_closed_no_result = (out.visit_closed_no_result || 0) + 1;
        }
      }
      if (!patch && !judged) continue;
      // a done visit: written only while it is still done with no opinion (the office may have saved one meanwhile)
      writing = true;
      const w = done
        ? await db.from("viewings").update({ ...(patch || {}), ai_checked_at: now }).eq("id", v.id).eq("row_version", v.row_version).eq("status", "done").is("client_feedback", null)
        : await db.from("viewings").update({ ...(patch || {}), ai_checked_at: now }).eq("id", v.id).eq("row_version", v.row_version).in("status", ["scheduled", "confirmed", "postponed"]);
      if (w.error) throw new Error(w.error.message);
      // the follow-up for this visit on his list was written before the result: read it again with the result known
      if (patch) await db.from("whatsapp_visit_followups").update({ reviewed_at: null }).eq("viewing_id", v.id).eq("status", "awaiting_approval");
    } catch (e) {
      out.visit_result_failed = (out.visit_result_failed || 0) + 1; console.error("[followup-auto] visit result", String((e as any)?.message || e));
      // a done visit whose opinion was read but could not be saved (the deal sync can refuse a visit, e.g. viewing_request_ambiguous):
      // the check is stamped (a column the sync does not watch) so the same chat is not read again every run, only when he writes
      if (done && writing) { try { await db.from("viewings").update({ ai_checked_at: new Date().toISOString() }).eq("id", v.id).eq("status", "done").is("client_feedback", null); } catch (_) { /* read again next run */ } }
    }
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

async function sendOne(f: any, numbers: string[], freeOnly = false) {
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
  // R47 (Ahmed 14 Nov): the question after a visit goes to every client within 90 minutes; the only exceptions are a client who
  // already said his opinion or a property that left the market (the review decides those), and a negotiation or running deal
  // with Ahmed. An open handoff or Ahmed / staff typing in the chat no longer hold it back.
  if (freeOnly) {
    if (client.followup_suppressed || client.archived || conv.agent_muted) return "held";
    if (await negotiationHold(conv.id)) return "held_negotiation";
    if (conv.human_handoff_required && /^\s*(تفاوض|مشتري جاد)\s*:/.test(String(conv.handoff_reason || ""))) return "held_negotiation";
  } else {
    if (client.followup_suppressed || client.archived || conv.agent_muted || conv.human_handoff_required) return "held";
    if (await chatHeld(conv.id)) return "held_owner_chat";
  }
  const lastIn = lastInR.data?.message_timestamp ? new Date(lastInR.data.message_timestamp).getTime() : 0;
  // R47: after a visit the review read the chat when it decided, so only a message after that decision supersedes the question
  if (lastIn > new Date(freeOnly && f.reviewed_at ? f.reviewed_at : f.created_at).getTime()) return stop("superseded", "client_wrote_after");
  const service = lastIn > 0 && Date.now() - lastIn < WINDOW_MS;
  if (freeOnly && !service) return "window_closed";
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
      raw_payload: { source: "visit_followup", followup_id: f.id, step: f.step, viewing_id: f.viewing_id, template_name: service ? null : f.template_name, auto: true, after_visit: freeOnly },
    });
    // R36: the results count this follow-up under the wording that really went
    const went = await sentVisitLabel(f, service, body).catch(() => undefined);
    await db.from("whatsapp_visit_followups").update({ status: "sent", send_mode: service ? "service" : "template", sent_at: now, meta_message_id: wamid, decided_at: now, error: null, updated_at: now, ...(went === undefined ? {} : { variant_label: went }) }).eq("id", f.id);
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

// «أمر للذكاء الاصطناعي» from the daily list. Nothing is sent: a rewritten text waits on the list.
// 11 Nov 2026 (Ahmed, R28): staff (manager, agent) get the button too, and their instruction becomes a lesson like his
// («نعم خلها دروس»); context.by_staff marks who gave it.
async function instruct(companyId: string, ownerId: string, kind: "visit" | "request", id: string, instruction: string, byOwner = true) {
  const table = kind === "visit" ? "whatsapp_visit_followups" : "whatsapp_outreach_queue";
  const openStatus = kind === "visit" ? "awaiting_approval" : "pending";
  const r = await db.from(table).select("*").eq("id", id).eq("company_id", companyId).maybeSingle();
  const x: any = r.data;
  if (!x || (kind === "request" && x.kind !== "request_followup")) return { ok: false, error: "followup_not_found" };
  if (x.status !== openStatus) return { ok: false, error: "followup_not_pending" };
  if (!["barka", "muscat"].includes(x.route_key)) return { ok: false, error: "route_blocked" };
  const before = x.owner_text || (kind === "visit" ? x.body : (x.messages || []).join(" "));
  const out = await judge(kind, x, companyId, await availableText(companyId), instruction);
  const result = await applyDecision(kind, x, companyId, out, instruction);
  if (result === "not_pending") return { ok: false, error: "followup_not_pending" };
  // the lesson: the next reviews (and the reply agent) read it from whatsapp_agent_prompts.lessons
  const note = await db.from("crm_owner_notes").insert({
    company_id: companyId, created_by: ownerId, conversation_id: x.conversation_id || null, outreach_id: kind === "request" ? x.id : null,
    note: short(instruction, 1000), apply_now: true,
    context: { source: "followup_instruction", by_staff: !byOwner, kind, followup_id: x.id, client_id: x.client_id, route_key: x.route_key, decision: out.decision, result, reason: short(out.reason, 300), before: short(before, 500), after: out.decision === "followup" ? out.text : null },
  });
  if (note.error) console.error("[followup-auto] lesson", note.error.message);
  return { ok: true, result, decision: out.decision, text: out.decision === "followup" ? out.text : null, reason: short(out.reason, 300), auto_ok: !!out.auto_ok, lesson_saved: !note.error };
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
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json({ ok: false }, 405);
  const secret = req.headers.get("x-crm-agent") || "";
  const ok = secret ? await db.rpc("crm_reply_agent_secret_ok", { p_secret: secret }) : null;
  if (!ok || ok.error || ok.data !== true) {
    // the owner's instruction from the daily list; nothing else is reachable without the scheduler secret
    const reply = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...cors(req), "content-type": "application/json; charset=utf-8" } });
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const u = jwt ? await db.auth.getUser(jwt) : null;
    const prof = u?.data?.user ? await db.from("profiles").select("id,company_id,role,is_active").eq("id", u.data.user.id).maybeSingle() : null;
    if (!prof?.data || !["owner", "manager", "agent"].includes(prof.data.role) || prof.data.is_active === false) return reply({ ok: false, error: "owner_only" }, 403);
    const body = await req.json().catch(() => ({}));
    const instruction = short(body?.instruction, 1000);
    const kind = body?.kind === "request" ? "request" : body?.kind === "visit" ? "visit" : null;
    if (!kind || !body?.id || instruction.length < 3) return reply({ ok: false, error: "instruction_required" }, 400);
    try { const r = await instruct(prof.data.company_id, prof.data.id, kind, String(body.id), instruction, prof.data.role === "owner"); return reply(r, r.ok ? 200 : 409); }
    catch (e) { console.error("[followup-auto] instruct", String((e as any)?.message || e)); return reply({ ok: false, error: "rewrite_failed" }, 500); }
  }
  const input = await req.json().catch(() => ({}));
  // a test of the visit results: reads the chats of past visits with no result and writes nothing
  // (preview_results: "done" reads the visits recorded done with no opinion, for the opinion only; left_to_ahmed says why the
  // run would not write it: the card moved past the visit or is lost, or the property is not available)
  if (input?.preview_results) {
    const co = await db.from("whatsapp_automation_runtime").select("company_id").eq("mode", "live").limit(1).maybeSingle();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Muscat" }).format(new Date());
    const doneOnly = input.preview_results === "done";
    const base = db.from("viewings").select("id,company_id,client_id,property_id,viewing_date,viewing_time,status,properties(type,area),clients(name)").eq("company_id", co.data?.company_id).eq("archived", false);
    const vs = await (doneOnly ? base.eq("status", "done").is("client_feedback", null).is("pipeline_outcome", null).gte("viewing_date", opinionSince()) : base.in("status", ["scheduled", "confirmed", "postponed"]).lt("viewing_date", today)).order("viewing_date", { ascending: false }).range(Number(input.offset) || 0, (Number(input.offset) || 0) + 11);
    const items = await Promise.all((vs.data || []).map(async (v: any) => { try { return { id: v.id, client: v.clients?.name, date: v.viewing_date, ...(doneOnly ? { left_to_ahmed: (await opinionBlocked(v)) || null } : {}), ...(await judgeResult(v, today, doneOnly)) }; } catch (e) { return { id: v.id, error: String((e as any)?.message || e) }; } }));
    return json({ ok: true, items });
  }
  // a test of R21: finds the «بشوف وبرد عليك» chats and writes the question; inserts and sends nothing
  if (input?.preview_thinking) {
    const co = await db.from("whatsapp_automation_runtime").select("company_id").eq("mode", "live").limit(1).maybeSingle();
    const lines = await db.from("company_lead_routes").select("whatsapp_number");
    const items = await thinkingFollowups(co.data?.company_id, (lines.data || []).map((r: any) => digits(r.whatsapp_number)).filter(Boolean), {}, true);
    return json({ ok: true, items });
  }
  // a test of the owner's instruction on one follow-up: reads and writes nothing
  if (input?.preview_instruction) {
    const pi = input.preview_instruction, kind = pi.kind === "request" ? "request" : "visit";
    const co = await db.from("whatsapp_automation_runtime").select("company_id").eq("mode", "live").limit(1).maybeSingle();
    const r = await db.from(kind === "visit" ? "whatsapp_visit_followups" : "whatsapp_outreach_queue").select("*").eq("id", String(pi.id || "")).eq("company_id", co.data?.company_id).maybeSingle();
    if (!r.data) return json({ ok: false, error: "followup_not_found" }, 404);
    const out = await judge(kind, r.data, co.data?.company_id, await availableText(co.data?.company_id), short(pi.instruction, 1000));
    return json({ ok: true, before: r.data.owner_text || r.data.body || null, decision: out.decision, text: out.text, reason: out.reason, auto_ok: out.auto_ok });
  }
  if (input?.preview) {
    const co = await db.from("whatsapp_automation_runtime").select("company_id").eq("mode", "live").limit(1).maybeSingle();
    return json({ ok: true, ...(await preview(co.data?.company_id, Number(input.offset) || 0)) });
  }
  // a test of R39 on chosen chats (up to 12): where each client stands, the text inside the 24 hours and the template outside
  // them, as a weekly request follow-up would get them today. Reads only: no row is created, changed or sent.
  if (input?.preview_stage) {
    const co = await db.from("whatsapp_automation_runtime").select("company_id").eq("mode", "live").limit(1).maybeSingle();
    const companyId = co.data?.company_id;
    const ids: string[] = (Array.isArray(input.preview_stage.conversation_ids) ? input.preview_stage.conversation_ids : []).map(String).slice(0, 12);
    const available = await availableText(companyId);
    const items: any[] = [];
    for (let i = 0; i < ids.length; i += REVIEWS_AT_ONCE) {
      await Promise.all(ids.slice(i, i + REVIEWS_AT_ONCE).map(async (cid) => {
        try {
          const c = await db.from("whatsapp_conversations").select("id,client_id,route_key").eq("id", cid).eq("company_id", companyId).maybeSingle();
          if (!c.data) { items.push({ conversation: cid, error: "conversation_not_found" }); return; }
          const x = { id: null, kind: "request_followup", client_id: c.data.client_id, conversation_id: c.data.id, route_key: c.data.route_key, template_name: "request_followup_ar_v2", messages: ["بخصوص طلبك", "لين الحين تبحث ؟"] };
          const r = await judge("request", x, companyId, available);
          const subject = String(r.subject || "").replace(/^\s*(بخصوص\s+)?طلبك\s+/, "").replace(/[؟?،,.!]/g, " ").replace(/\s+/g, " ").trim();
          const t = r.decision === "followup" ? await stageTemplate(x, companyId, r, subject && subject.length <= 60 && !/[A-Za-z]/.test(subject) ? subject : "") : null;
          items.push({ conversation: cid, held: await chatHeld(cid), decision: r.decision, guard: r.guard || null, stage: r.stage, stage_ar: STAGE_AR[String(r.stage)] || null, reason: short(r.reason, 220), text: r.decision === "followup" ? r.text : null,
            subject: subject || null, offer: r.offer_label || null, auto_ok: !!r.auto_ok,
            template: r.decision === "followup" ? (t?.template_name || "request_followup_ar_v2") : null, template_text: r.decision === "followup" ? (t?.messages || [`بخصوص طلبك ${subject}`, "لين الحين تبحث ؟"]).join(" / ") : null });
        } catch (e) { items.push({ conversation: cid, error: String((e as any)?.message || e) }); }
      }));
    }
    return json({ ok: true, items });
  }
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Muscat", hour: "2-digit", hour12: false }).format(new Date()));
  if (hour < 9 || hour >= 21) return json({ ok: true, reason: "outside_hours" });
  const rts = await db.from("whatsapp_automation_runtime").select("company_id,mode,visit_followups_auto");
  const out: Record<string, number> = {};
  const routes = await db.from("company_lead_routes").select("whatsapp_number");
  const numbers = (routes.data || []).map((r: any) => digits(r.whatsapp_number)).filter(Boolean);
  // R36: a waiting follow-up whose test wording was stopped, or whose template Meta no longer approves, goes back to A
  // before anything is read or sent. With no test wording this changes nothing.
  { const st = await db.rpc("crm_followup_variants_settle"); if (st.error) console.error("[followup-auto] variants", st.error.message); }
  for (const rt of rts.data || []) {
    if (rt.mode !== "live") continue;
    if (rt.visit_followups_auto) await confirmBeforeVisit(rt.company_id, numbers, out);
    if (rt.visit_followups_auto) await afterVisit(rt.company_id, numbers, out);
    await reviewAll(rt.company_id, out);
    await visitResults(rt.company_id, out);
    if (!rt.visit_followups_auto) continue;
    await sendInWindow(rt.company_id, numbers, out);
    // R21: one light question to a «بشوف وبرد عليك» client before his window closes (never to a client on the daily list)
    await thinkingFollowups(rt.company_id, numbers, out);
    const dayStart = new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Muscat" }).format(new Date())}T00:00:00+04:00`).toISOString();
    const sentF = await db.from("whatsapp_visit_followups").select("id", { count: "exact", head: true }).eq("company_id", rt.company_id).eq("send_mode", "template").gte("sent_at", dayStart);
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
