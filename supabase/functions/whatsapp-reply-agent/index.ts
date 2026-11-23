import { createClient } from "npm:@supabase/supabase-js@2";
import { transcribeVoice } from "../_shared/voice.ts";
// The brain and investor knowledge live in whatsapp_agent_prompts (synced from the repo by agent-prompt-sync),
// so wording changes do not need a redeploy.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const OPENAI_MODEL = Deno.env.get("REPLY_AGENT_MODEL") || Deno.env.get("OPENAI_MODEL") || "gpt-5.6-luna";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const GRAPH = Deno.env.get("META_GRAPH_VERSION") || "v25.0";
const DEBOUNCE_MS = Number(Deno.env.get("REPLY_DEBOUNCE_MS") || 35000); // wait for the customer to finish typing (30 to 60 seconds)
// Only these handoffs keep the agent out of the chat until Ahmed answers (negotiation, serious buyer, owner price study).
// Any other handoff ("send photos", "call me", "not sure") no longer silences the agent: the next message is answered
// and the open item stays on Ahmed's list.
// R45 (Ahmed 14 Nov): a meeting request («اجتماع:») silences the agent too; Ahmed answers the client himself
const HARD_HANDOFF = /^\s*(تفاوض|مشتري جاد|دراسة سعر|سؤال ما عندي جوابه|اجتماع)\s*:/;
// R61: a question about a contest (we run none). R62: a question about a YouTube channel or video of the property.
const CONTEST_ASK = /مسابق[ةه]|المسابقات/;
// R89 (Ahmed 16 Nov 2026, Jehan: he wrote «اليوم مناسب للتواصل الساعة 10:00 صباح، صحيح؟», she answered «نعم بإذن الله», and nobody was
// at the office phone): when a client confirms a meeting or a call time the office proposed, in a chat the agent stays out of,
// Ahmed gets a WhatsApp alert from that branch number. Not for a visit to an open house (the client goes alone).
const MEET_TALK = /اجتماع|ميتينج|ميتنج|meeting|[اأ]ونلاين|online|zoom|زوم|للتواصل|نتواصل|[اأ]تصل|اتصال|المكتب|مكتبهم|مكتبنا|موعد|نلتقي|نتقابل|[اأ]قابلك|نقابلك/i;
const MEET_TIME = /الساع[ةه]\s*[0-9٠-٩]|[0-9٠-٩]{1,2}\s*[:.]\s*[0-9٠-٩]{2}|[0-9٠-٩]\s*(صباح|الصبح|مساء|العصر|الظهر|المغرب)|اليوم|بكر[هة]|باكر|السبت|ال[اأ]حد|ال[اإ]ثنين|الثلاثاء|ال[اأ]ربعاء|الخميس|الجمع[ةه]/;
const MEET_VISIT = /تزور|زيار[ةه]|تشوف(ين|ون)?\s*(ال)?(بيت|فيلا|عقار|شق[ةه]|[اأ]رض)|معاين|لوكيشن|البيت\s*مفتوح/;
const MEET_YES = /^(?:[\s،,.!؟?]|\p{Extended_Pictographic}|نعم|[اإ]ي\s*نعم|اي|ايه|ايوه|ايوا|تمام|اوكي|اوك|ok(?:ay)?|yes|مناسب(?:\s*لي)?|يناسبني|موافق[ةه]?|[اأ]كيد|خلاص|صحيح|صح|زين|طيب|تم|[اإ]ن\s*شاء\s*الله|ب[اإ]ذن\s*الله|على\s*بركة\s*الله|حياك(?:\s*الله)?)+$/iu;
// rows: the last messages of the chat, oldest first. Returns what we proposed and what he answered, or null.
function meetingConfirmed(rows: any[]) {
  const text = (h: any) => String(h?.transcript || h?.body || "").trim();
  let lastOut = -1; (rows || []).forEach((h: any, i: number) => { if (h.direction === "outbound") lastOut = i; });
  if (lastOut < 0) return null;
  const said = rows.slice(lastOut + 1).filter((h: any) => h.direction === "inbound").map(text).filter(Boolean).join(" ");
  if (!said || said.length > 60 || !MEET_YES.test(said)) return null;
  let from = lastOut; while (from > 0 && rows[from - 1].direction === "outbound" && lastOut - from < 2) from--;
  const ours = rows.slice(from, lastOut + 1).map(text).filter(Boolean).join(" ");
  if (!MEET_TALK.test(ours) || !MEET_TIME.test(ours) || MEET_VISIT.test(ours)) return null;
  return { ours: text(rows[lastOut]), said, at: String(rows[lastOut].message_timestamp || "") };
}
const STRANGER_OPENER =/سيدي\s*الرئيس|هل\s*هذا\s*[اأ]نت(\s*حق[اًا]*)?\s*[؟?]|هل\s*سبق\s*لك\s*[اأ]ن\s*زرت|is\s*this\s*(really\s*)?you\s*[?؟]/i;
// R66 (Ahmed 14 Nov 2026, changes R22): a Barka property is offered on the Muscat number only to a client who said he looks
// in المعبيلة or near Barka (the word بركاء, or the area of a listed Barka property, in his own messages)
const R66_BARKA_OFFER = /(تقبل|تقبلين|يناسبك|تناسبك)\s*(في\s*)?بركاء/;
const R66_DETAILS_ASK = /تحب(ين)?\s*[اأ]رسل(ك|ج)?\s*(لك\s*)?تفاصيل/;
const R66_GENERIC = ["بركاء", "مسقط", "ولايه", "منطقه", "شماليه", "جنوبيه", "شرقيه", "غربيه"];
function nearBarka(said: unknown, barkaAreas: unknown[]) {
  const n = (s: unknown) => String(s ?? "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه");
  const words = (s: unknown) => n(s).split(/[^ء-ي]+/).map((w) => w.replace(/^ال/, "")).filter((w) => w.length > 2 && !R66_GENERIC.includes(w));
  const t = n(said), mine = words(said);
  return /معبيل|بركاء|بركا(?![ء-ي])/.test(t) || (barkaAreas || []).flatMap(words).some((w) => mine.includes(w));
}
const YOUTUBE_ASK = /يوتيوب|يوتوب|youtube/i;
const YOUTUBE_LINES = ["الافضل تشوف العقار على الطبيعة احسن من الفيديو والصور", "متى يناسبك تزور ؟"];
// R41 (Ahmed 12 Nov): a question whose answer is not written in front of the agent gets no reply at all; the chat goes back to Ahmed
const UNKNOWN_Q = /^\s*سؤال ما عندي جوابه\s*:/;
// R74 to R79: Ahmed's six decisions of 15 Nov 2026 after the dry run on 124 chats, held by code (brain.ts has no room left)
const LOCATION_ASK = /موقع|لوكيشن|لوكشن|location|الخريط|المكان\s*بالضبط/i;
// (review of the live replies after v101, 18 Nov: «اهم شي الموقع … بس رسلي الموقع اول واشوف البيت», «ما اريد إذا ما موقع
// أشوفه قبل … ما ادور شي ما مقتنعه بموقعه», «اريد اشوفه بعد بينه وبين الخوض»: the place decides, so R74 sends it; the last
// six alternatives of AREA_REASON)
const AREA_REASON = /ما\s*([اأ]ريد|[اأ]بي|[اأ]بغى|[اأ]با|بغيت)\s*[اأ]زور|[اأ]عرف\s*(ال)?(مكان|موقع)\s*بالضبط|(اعرف|أعرف|اشوف|أشوف|نشوف|اتاكد|أتأكد|اتأكد)[^\n]{0,40}(يناسب(ني|نا)|مناسب\s*(لي|لنا)|قريب|بعيد)|(يناسب|مناسب)(ني|نا|ه)?\s*(لي\s*)?(او|أو|ولا|والا)\s*(لا|ما)|مو\s*لازم\s*(لل)?زيار|الزيار[ةه]\s*تعتمد|تعتمد\s*(على|ع)\s*(ال)?موقع|[اأ]شوف\s*وين|(اذا|إذا|لو)\s*ي?ناسب(ني|نا)|([اأ]هم)\s*شي\s*(ال)?(موقع|لوكيشن|مكان)|(ال)?(موقع|لوكيشن)\s*(ال)?([اأ]ول|قبل)|[اأ]شوف(ه|ها)?\s*(ال)?(قبل|[اأ]ول)|مقتنع(ه|ة)?\s*ب?(ال)?موقع|بين(ه|ها)\s*وبين|كم\s*(يبعد|تبعد|بعيد|المساف)/;
// «اريد أشوف البيت من الخارج لان من سكان الحيل الشماليه» (eleventh dry-run batch): the same wish without the word «موقع»
const OUTSIDE_LOOK = /([اأ]شوف|نشوف|[اأ]مر|نمر|[اأ]طل)[^\n]{0,25}من\s*(ال)?(خارج|برع|برا)(\s|$)/;
const locationForArea = (said: string) => (LOCATION_ASK.test(said) && AREA_REASON.test(said)) || OUTSIDE_LOOK.test(said);
const LOCATION_HELD = /(موقع|لوكيشن)[^\n]{0,40}(قبل|مع|وقت|بعد)\s*(تحديد|الزيار|موعد)|برسلك\s*الموقع|نرسله/;
const AREA_LINES = ["تفضل هذا الموقع", "شوف اذا المنطقة تناسبك وخبرني متى يناسبك تزور"];
const INSIDE_VIDEO_ASK = /(فيديو|فديو|مقطع|تصوير)[^\n]{0,60}داخل|داخل[^\n]{0,30}(فيديو|فديو|مقطع)/;
const VIDEO_PROMISE = /(برسل|بنرسل|ارسل|نرسل)(ك|كم)?\s*(لك|لكم)?\s*(ال)?(فيديو|فديو)/;
const FAREWELL = /الله\s*(يوفقك|يسعدك|يحفظك)|بالتوفيق/;
// a question about the commission, not an advertisement that mentions one (ninth dry-run batch: a broker's ad got the owner's lines)
const COMMISSION_ASK = /(كم|على\s*من|من\s*(اللي\s*)?يدفع|مين|نسب[ةه]|مقدار)[^\n]{0,30}عمول|عمول[^\n]{0,30}(كم|على\s*من|على\s*مين|من\s*(اللي\s*)?يدفع|[؟?])/;
const THEIR_OFFICE = /(معنا|عندنا|معانا)\s*(في\s*)?(ال)?مكتب|مكتبنا|(بتجي|بتيجي|تجي|تيجي|تجون|تجينا|تزورنا|تزورونا|تمر(ون)?\s*علينا|تشرفنا|تشرفونا)(\s|$)/;
// a question that only repeats what the client said («قصدك البيت المعروض في الحيل الجنوبية ؟»)
const ASK_CONFIRM = /^(قصدك|تقصد(ين)?)\s[^\n]{0,90}؟\s*$/;
const WE_SHOW = /(^|\s)عارض(ين|ه|ة)?\s+(لل?بيع\s+)?(فل[ةه]|فيلا|بيت|منزل|شق[ةه]|[اأ]رض)|(فل[ةه]|فيلا|بيت|منزل)\s*(ال)?معروض|معروض\s*عندكم/;
const MY_OWN = /(^|\s)(عندي|بيتي|فلتي|[اأ]رضي|ملكي|عقاري)(\s|$)|[اأ](بي|بغى|با|ريد)\s*[اأ]عرض|(^|\s)نعرض/;
const SILENT_TYPES =["revoke", "reaction", "system", "edit", "unsupported"];
const COMMISSION_BUYER_LINES = ["ما عليك عمولة للمكتب", "العمولة على الطرف المفوض وهو المالك"];
const COMMISSION_OWNER_LINES = ["بخصوص العمولة نحتاج اول شي نزور الموقع بعد ما ترسل لنا المستندات ونطلع على العقار", "وبعدها نتفق ان شاء الله على كل شي"];
const ASK_LINK = /رابط\s*(ال)?(فيديو|اعلان|إعلان)|صور[ةه]\s*منه|[اأ]ي\s*(فيلا|بيت|عقار|شق[ةه]|[اأ]رض)\s*(بالضبط|تقصد|قصدك)/;
const areaKey = (s: unknown) => String(s ?? "").replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/(^|\s)ال/g, "$1").replace(/\s+/g, " ").trim();
const BOOKING_ASK = /عربون|(اذا|إذا|لو)\s*حجز(ت|نا)|([اأ]بي|[اأ]بغى|[اأ]با|[اأ]ريد|نبي|نبغى|بغيت|حاب|ودي)\s*[اأن]حجز|(كيف|طريق[ةه])\s*(ال)?حجز|[اأن]حجز\s*(ال)?(فيلا|فل[ةه]|بيت|شق[ةه]|منزل|عقار|[اأ]رض)|لحجز\s*(ال)?(فيلا|فل[ةه]|بيت|شق[ةه]|منزل|عقار|[اأ]رض)/;
const BOOKING_NOT = /موعد|زيار|معاين|استراح|شاليه|مزرع|يومي|ليل[ةه]|تاريخ|[0-9٠-٩]{1,2}\s*[\/\-]\s*[0-9٠-٩]/;
const ASK_HOUR = /كم\s*الساع[ةه]/;
const NEEDS_AHMED = /(يحتاج|تحتاج|ينتظر|تنتظر)\s*رد\s*(من\s*)?(الاستاذ\s*|الأستاذ\s*)?[اأ]حمد/;
const FIXED_PRICE_LINE ="الاسعار تختلف حسب الوحدة والمساحة والمرحلة";
const IG_CODE = /instagram\.com\/(?:reels?|p|tv)\/([A-Za-z0-9_-]+)/i;
const LAYOUT_ASK = /تقسيم|توزيع\s*(ال)?غرف|مساح(ة|ه|ات)\s*(كل\s*)?(ال)?غرف|مقاس(ات)?\s*(كل\s*)?(ال)?غرف|مخطط|خرا[ئي]ط/;
const LAYOUT_LINES = ["الافضل تشوف العقار على الطبيعة وتطلع على الخرائط وكل شي هناك مرة وحدة", "متى يناسبك تزور ؟"];
const OUR_HOUR = /الساع[ةه]\s*[0-9٠-٩]|[0-9٠-٩]\s*(العصر|الصبح|الصباح|المغرب|المسا|المساء|الظهر|الليل)/;
const HOUR_SAID = /(الساع[ةه]|على)\s*[0-9٠-٩]|[0-9٠-٩]\s*(ونص|العصر|الصبح|الصباح|المغرب|المسا|الظهر|الليل|م(\s|$)|ص(\s|$)|pm|am)|(^|\n)\s*[0-9٠-٩]{1,2}([:.][0-9٠-٩]{2})?\s*(\n|$)|العصر|الصبح|الصباح|الفجر|الضحى|المغرب|العشا|الظهر|الليل|المسا|الحين|ال[اآ]ن|ذلحين|هالحين|(^|\s)تو(\s|$)|طالع|في\s*الطريق|جاي/;
const OWNER_TIME_LINE ="تواصل مع صاحب العقار مباشرة ونسق معه وقت الزيارة";
const REASON_Q = /الاسباب|ليش\s*ما\s*ناسب/;
const VISIT_Q = /(تزور|تزورون|تزورين)\s*؟/;
// c: { history, burstSaid, prop, visitedProp, visitedAny, saidVisited, handoffOpen, hardHandoff }. Returns the reply lines; marks out.
// R115 (18 Nov audit): a client who never visited answers our «… انحجزت» + «تحب تشوف خيارات ثانية ؟» with «نعم» / «صورة
// وموقع». He wants the alternative, not «ايش اللي ناقصك» nor a silent handoff. Returns the two fixed lines naming the nearest
// available home of this branch («تقدر تزيد شوي ؟» when it is over his budget by more than 15%), or null when the last
// office message was not that notice or no home is available.
function soldNoticeYes(out: any, c: any): string[] | null {
  let lastOut = ""; for (const h of c.history) if (h.direction === "outbound") lastOut = String(h.transcript || h.body || "");
  if (!/خيارات\s*ثاني/.test(lastOut)) return null;
  const homes = ((c.available || []) as any[]).filter((p: any) => ["villa", "twin_villa", "house"].includes(String(p.type)) && p.listing_purpose !== "rent"
    && (!c.route || !["muscat", "barka"].includes(String(p.branch_key)) || p.branch_key === c.route) && Number(p.price) > 0)
    .sort((a: any, b: any) => Number(a.price) - Number(b.price));
  const h0 = homes.find((p: any) => !c.budget || Number(p.price) >= Number(c.budget) * 0.85) || homes[homes.length - 1];
  if (!h0) return null;
  const k = Math.round(Number(h0.price) / 1000), label = c.typeLabel ? c.typeLabel(h0.type) : "فيلا";
  out.action = "none"; out.handoff_reason = null; out.property_id = h0.id; out.guard_sold_notice_yes = true;
  return c.budget && Number(h0.price) > Number(c.budget) * 1.15
    ? [`حالياً ما عندنا ${label} بحدود ${Math.round(Number(c.budget) / 1000)} الف`, `اقرب شي عندنا في ${h0.area} ${label} بـ${k} الف تقدر تزيد شوي ؟`]
    : [`اقرب شي عندنا في ${h0.area} ${label} بـ${k} الف`, "تحب ارسلك تفاصيلها ؟"];
}
// R45 (reply audit 22 Nov, علي من الأحواز 2d32eee8): «ان شاء الله» right after our «… نرتب لك اجتماع … يناسبك ؟» is a yes, even when
// the same burst asks something else («تعرض لي فيديوهات الفيلا ؟»); the model answered nothing and booked nothing. Returns the place or null.
const INVITE_RE = /(نرتب|نرتبلك|نسوي|نحدد)\s*(لك|لكم|لج)?\s*اجتماع/;
const MEETING_YES = /(^|[\s.!،,])(ان\s*شاء\s*الله|إن\s*شاء\s*الله|انشاء\s*الله|انشالله|ايوا|ايوه|إيوه|اي\s*نعم|نعم|اكيد|أكيد|تمام|اوك|اوكي|ok|okay|يناسبني|مناسب|موافق|زين|طيب)(?=$|[\s.!،,؟?])/i;
const MEETING_NO = /ما\s*(يناسب|ابي|أبي|اريد|أريد|اقدر|أقدر)|مو\s*مناسب|مب\s*مناسب|لا\s*(شكرا|مشكور)|^\s*لا(\s|$)|بعدين|مب\s*الحين|مو\s*الحين|مشغول|بفكر|افكر|أفكر|بشوف|برد\s*عليك|برجع\s*لك|ارجع\s*لك|أرجع\s*لك/;
function meetingYes(history: any[]): string | null {
  let li = -1; history.forEach((h: any, i: number) => { if (h.direction === "outbound") li = i; });
  if (li < 0) return null;
  let s = li; while (s > 0 && history[s - 1].direction === "outbound") s--;
  const invite = history.slice(s, li + 1).map((h: any) => String(h.body || "")).join("\n");
  if (!INVITE_RE.test(invite) || !/يناسبك\s*؟\s*$/.test(invite.trim())) return null;
  const said = history.slice(li + 1).filter((h: any) => h.direction === "inbound").map((h: any) => String(h.transcript || h.body || "")).join("\n");
  if (!said.trim() || !MEETING_YES.test(said) || MEETING_NO.test(said)) return null;
  return /اونلاين|أونلاين/.test(invite) ? "online" : /المطور|مكتبهم|العذيبة|صبور/.test(invite) ? "developer" : "office";
}
function ownerDecisions(out: any, lines: string[], c: any) {
  let texts = [...lines];
  const body = (h: any) => String(h.transcript || h.body || "");
  const inbound = c.history.filter((h: any) => h.direction === "inbound");
  const recentIn = inbound.slice(-6).map(body).join(" ");
  const sentBefore = (s: string) => c.history.some((h: any) => h.direction === "outbound" && String(h.body || "").includes(s));
  // ninth dry-run batch: the client's last messages are only deleted ones, reactions or edits (no word of his): nothing is
  // answered («اسمك الكريم ؟ ارسل الملكية…» went to three deleted messages)
  let lastOut = -1; c.history.forEach((h: any, i: number) => { if (h.direction === "outbound") lastOut = i; });
  const tail = c.history.slice(lastOut + 1).filter((h: any) => h.direction === "inbound");
  // (on the real chat the deleted messages were not in the history at all: the message being answered is checked too)
  const silentMsg = SILENT_TYPES.includes(String(c.msgType || "")) && !String(c.burstSaid || "").trim();
  if (out.action === "none" && texts.length && (silentMsg || (tail.length && tail.every((h: any) => SILENT_TYPES.includes(String(h.message_type || "")))))) {
    out.guard_nothing_said = true; return [];
  }
  // R78 (Ahmed: «يسأل مره اخيره عن السبب واذا ما جاوب ما يضغط عليه»): why the property did not suit is asked once in a chat
  if (texts.some((t) => REASON_Q.test(t)) && c.history.some((h: any) => h.direction === "outbound" && REASON_Q.test(String(h.body || "")))) {
    texts = texts.filter((t) => !REASON_Q.test(t)); out.guard_reason_once = true;
  }
  // R11 day words (used by R74 below and by R11 further down; declared here so both read the same ones)
  const DAY_WITH = /(^|[\s،,.])(ا?ليوم|الحين|ال[اآ]ن|بكر[ةه]?|باكر|الليل[ةه]|السبت|ال[اأ]حد|ال[اإ]ثنين|الثلاثاء|ال[اأ]ربعاء|الخميس|الجمع[ةه])($|[\s،,.؟?!])/;
  const DAY_NOT = /ما\s*(يناسب|[اأ]قدر|بقدر|اقدر|بيمدي|يمدي)|صعب|مب\s*ا?ليوم|مو\s*ا?ليوم/;
  // R74 (Ahmed: «نعم نرسل الموقع في هذه الحاله»; changes R11 in this case only): a client who asks for the location to see
  // whether the place suits him, before he chooses a time, gets it, once. No visit is recorded from it (location_for_area).
  // (rows 1521-1560: «الفيلا اللي سألت عنها ما متوفره حالياً» went with the location of that same villa: not for a property the
  // reply says is gone, nor one whose status is not available)
  // (18 Nov, Blessed «اريد اشوفه بعد بينه وبين الخوض»: the distance question became a silent «سؤال ما عندي جوابه»; the location answers it)
  const distanceUnknown = out.action === "handoff" && UNKNOWN_Q.test(String(out.handoff_reason || "")) && /مساف|بعيد|يبعد|بين[^\n]{0,30}وبين|قريب/.test(String(out.handoff_reason || ""));
  // (same review: «اهم شي الموقع» and the distance question came with no property_id, so the location never went. The
  // property is then the available one whose area our last messages named, when exactly one map fits.)
  let areaProp = c.prop;
  if (!areaProp && locationForArea(recentIn)) {
    const recentOut = c.history.filter((h: any) => h.direction === "outbound").slice(-8).map(body).join(" ");
    const fits = ((c.available || []) as any[]).filter((p: any) => p.map_url && p.area && recentOut.includes(String(p.area)));
    if (fits.length && new Set(fits.map((p: any) => String(p.map_url).split("?")[0])).size === 1) areaProp = fits[0];
  }
  if (locationForArea(recentIn) && (out.action === "none" || distanceUnknown) && areaProp?.map_url && ["buyer", "tenant"].includes(out.category) && !sentBefore(String(areaProp.map_url))
    && !texts.some((t) => t.length <= 200 && /ما\s*متوفر|انباع|انحجز(ت)?\s*(ال|$)/.test(t)) && (!areaProp.status || areaProp.status === "available")) {
    if (distanceUnknown) { out.handoff_reason = null; delete out.soft_handoff_no_reply; }
    if (!c.prop) { out.property_id = areaProp.id; c.prop = areaProp; }
    out.action = "send_location"; out.location_for_area = true; out.guard_location_for_area = true;
    // (17 Nov: «تمام شوف الموقع اول واذا ناسبك خبرني» before «تفضل هذا الموقع / شوف اذا المنطقة تناسبك» said it twice)
    // (19 Nov, R11 test back in CI: «اريد اعرف الموقع اول حاجه يمكن السبت» got «اذا تأكدت من الوقت يوم الخميس خبرني عشان ارسل
    // لك الموقع» beside the location itself. The promise to send it goes, and a client who already named a day is not asked
    // «متى يناسبك تزور» again.)
    texts = texts.filter((t) => !(t.length <= 200 && (LOCATION_HELD.test(t) || FAREWELL.test(t) || /شوف\s*(ال)?(موقع|لوكيشن|منطق)|ناسب(ك|تك)\s*خبرني/.test(t)
      || /(ارسل|أرسل|برسل|نرسل)\s*(لك|ل[كج])?\s*(ال)?(موقع|لوكيشن|اللوكيشن)/.test(t))) && !VISIT_Q.test(t)).slice(0, 1);
    const dayNamed = DAY_WITH.test(String(c.burstSaid || "")) && !DAY_NOT.test(String(c.burstSaid || ""));
    texts.push(...(dayNamed ? AREA_LINES.slice(0, 1) : AREA_LINES));
  }
  // R75 (Ahmed gave the reel): a request for a video of the inside gets the reel marked «من الداخل» in the property's
  // marketing journal. The agent says nothing of its own about what a video shows.
  // («اقصد من الداخل» after «هل متوفر فيديو للفله» is the same request: the last lines are read together when the new ones say «داخل»)
  if ((INSIDE_VIDEO_ASK.test(c.burstSaid) || (/داخل/.test(c.burstSaid) && INSIDE_VIDEO_ASK.test(recentIn))) && c.prop?.videoInside && out.action !== "handoff") {
    const code = (String(c.prop.videoInside).match(IG_CODE) || [])[1] || String(c.prop.videoInside);
    const sent = sentBefore(code);
    texts = texts.filter((t) => !(t.length <= 200 && /فيديو|فديو|تصوير|مصور|الصور|التقسيم/.test(t)) && !/instagram\.com/.test(t));
    texts = [...(sent ? ["الفيديو من الداخل ارسلته لك فوق"] : ["هذا الفيديو من الداخل", String(c.prop.videoInside)]), ...texts];
    if (out.action === "none" && !c.visitedProp && !texts.some((t) => VISIT_Q.test(t))) texts.push("متى يناسبك تزور ؟");
    out.guard_inside_video = true;
  }
  // R5 / R34 (dry run of 15 Nov, second part: «تمام برسلك الفيديو» with a handoff «طلب فيديو»): the video is never promised.
  // The property's reel goes now when it has one and it was not sent in this chat; with no reel the promise is only taken out.
  if (texts.some((t) => t.length <= 200 && VIDEO_PROMISE.test(t) && !/instagram\.com/.test(t))) {
    texts = texts.filter((t) => !(t.length <= 200 && VIDEO_PROMISE.test(t) && !/instagram\.com/.test(t)));
    const vcode = c.prop?.video ? (String(c.prop.video).match(IG_CODE) || [])[1] || String(c.prop.video) : "";
    if (vcode && !sentBefore(vcode) && !texts.some((t) => t.includes(vcode))) {
      texts.push(String(c.prop.video));
      if (out.action === "handoff" && /فيديو|فديو/.test(String(out.handoff_reason || "")) && !c.hardHandoff) { out.action = "none"; out.handoff_reason = null; delete out.soft_handoff_no_reply; }
    }
    out.guard_video_promise = true;
  }
  // R34 (third dry-run batch: «ممكن صور الفيلا» got «ما عندنا صور» and the visit question, without the video): a photo
  // request about a property that has a reel gets the reel with it, when it was not sent in this chat
  if (/صور/.test(c.burstSaid) && out.action === "none" && texts.length && c.prop?.video && !texts.some((t) => /instagram\.com/.test(t)) && texts.some((t) => /صور/.test(t))) {
    const pcode = (String(c.prop.video).match(IG_CODE) || [])[1] || String(c.prop.video);
    if (!sentBefore(pcode)) {
      const q = texts.filter((t) => VISIT_Q.test(t));
      texts = [...texts.filter((t) => !VISIT_Q.test(t)).slice(0, 1), String(c.prop.video), ...q.slice(0, 1)];
      out.guard_photo_video = true;
    }
  }
  // fourth dry-run batch: «الفيلا اللي سألت عنها ما متوفره حالياً» + «متى يناسبك تزور ؟» with nothing offered in its place.
  // The visit question goes only with a property to visit.
  // (dry run rows 701-740, 17 Nov: the other property's full ad, with no «عندنا» in it, counts as the offer: the visit question stays)
  if (texts.some((t) => t.length <= 200 && /ما\s*متوفر[هة]?\s*حالي|انباع/.test(t)) && !texts.some((t) => t.length > 200 || /عندنا|متوفر[هة]?\s*(الحين|حالياً\s*و)|المتبقي/.test(t.replace(/ما\s*متوفر[هة]?\s*حالي\S*/g, ""))) && out.action === "none") {
    const kept = texts.filter((t) => !VISIT_Q.test(t));
    if (kept.length !== texts.length) { texts = kept; out.guard_visit_nothing = true; }
  }
  // R75, eighth dry-run batch: «هذا فيديو الفيلا من الداخل والخارج» with the ordinary reel. What a video shows is said only
  // for the reel marked «من الداخل» (above); elsewhere the claim is taken out of the line.
  if (!out.guard_inside_video) texts = texts.map((t) => (t.length <= 200 && /فيديو|فديو/.test(t) ? t.replace(/\s*من\s*(ال)?(داخل|خارج|برع)(\s*و\s*(من\s*)?(ال)?(داخل|خارج|برع))?/g, "") : t));
  // «… والتملك حر لأي جنسية واسمك الكريم ؟»: the name question is not glued to the end of a sentence about something else
  // (dry run rows 711-776, 17 Nov: «الفيلا اللي سألت عنها انباعت واسمك الكريم ؟» is short; the sold line is cut too, and the
  // name question comes back on its own before the last question)
  {
    const glued = (t: string) => (t.length > 60 || VISIT_Q.test(t) || /انباع|ما\s*متوفر/.test(t)) && !/^https?:/.test(t) && /\S\s*و\s*اسمك\s*الكريم\s*؟/.test(t);
    const cut = texts.some(glued);
    texts = texts.map((t) => (glued(t) ? t.replace(/\s*و\s*اسمك\s*الكريم\s*؟/g, "").trim() : t)).filter(Boolean);
    if (cut && /انباع|ما\s*متوفر/.test(texts.join("\n")) && !texts.some((t) => /اسمك\s*الكريم/.test(t))) {
      if (texts.length > 1 && /؟\s*$/.test(texts[texts.length - 1])) texts.splice(texts.length - 1, 0, "اسمك الكريم ؟"); else texts.push("اسمك الكريم ؟");
    }
  }
  // (same rows: an owner was told «وبعدها نسألك عن سكن المالك والرهن»: the next questions are asked, not announced)
  texts = texts.filter((t) => !(t.length <= 120 && /^\s*(و\s*)?بعدها\s*(ن|ب)?(سأل|نسأل)/.test(t)));
  // the fixed project line is said once («… ⏎ العرض الحالي … والاسعار تختلف حسب الوحدة والمساحة والمرحلة»)
  if (texts.includes(FIXED_PRICE_LINE)) texts = texts.map((t) => (t === FIXED_PRICE_LINE ? t : t.replace(new RegExp(`\\s*و?${FIXED_PRICE_LINE}`), "").trim())).filter(Boolean);
  // R76 (Ahmed: «اللي يسأل عن التقسيم يفضل يزور الموقع لان الخرائط تختلف عن الواقع»; changes R41 for this question only)
  if (out.action === "handoff" && UNKNOWN_Q.test(String(out.handoff_reason || "")) && LAYOUT_ASK.test(`${c.burstSaid} ${out.handoff_reason}`)
    && ["buyer", "tenant"].includes(out.category) && !c.visitedProp
    // decision 21 (Ahmed 18 Nov 2026, a fixed rule): invited to the visit once; if he insists on the sizes, the agent stays
    // silent and the chat goes to the office (the R41 handoff is kept)
    && !c.history.some((h: any) => h.direction === "outbound" && /على\s*الطبيع[ةه]/.test(body(h)) && /الخرائط/.test(body(h)))) {
    out.action = "none"; out.handoff_reason = null; out.guard_layout = true;
    texts = [...texts.filter((t) => !VISIT_Q.test(t)).slice(0, 1), ...LAYOUT_LINES];
  }
  // R77 (Ahmed: «ما يحدد الوقت لازم ينسق مع المالك»): a visit arranged with the owner carries no hour of ours
  if (out.action === "send_owner_number" && texts.some((t) => t.length <= 200 && OUR_HOUR.test(t))) {
    texts = [...texts.filter((t) => !(t.length <= 200 && OUR_HOUR.test(t)) && !/نسق|تنسق/.test(t)), OWNER_TIME_LINE];
    out.guard_owner_time = true;
  }
  // R77, fifth dry-run batch: on a property whose owner lives in it the agent wrote «الزيارة تحتاج تنسيق مع المالك قبل يوم»
  // and then «كم الساعة تقريباً اليوم ؟». The hour is the owner's: the question about it is taken out.
  if (c.prop?.visit_method === "owner_lives" && texts.some((t) => t.length <= 200 && ASK_HOUR.test(t))) {
    texts = texts.map((t) => (t.length <= 200 && ASK_HOUR.test(t) ? t.replace(/\s*و?\s*كم\s*الساع[ةه][^؟?\n]*[؟?]?/g, "").trim() : t)).filter(Boolean);
    out.guard_owner_time = true;
    // dry run of 16 Nov (rows 513 to 552): «متى ممكن الزيارة؟ بكرة ممكن؟» was left with «اسمك الكريم ؟» alone. He named the
    // day, the hour is the owner's: the owner's number goes with the fixed line, as on the chats where the model sends it itself.
  }
  // dry run of 16 Nov (rows 513 to 552): «متى ممكن الزيارة؟ بكرة ممكن؟» for a house the owner lives in came back as «اسمك الكريم ؟»
  // alone, and on a second run as «خبرني باليوم والوقت المناسب». He named the day and the hour is the owner's (R77, R11): the
  // owner's number goes with the fixed line, as on the chats where the model sends it itself. Only when the model itself read a
  // visit day, the client's words name one, and what is left of the reply is the name question or a question about the time.
  if (c.prop?.visit_method === "owner_lives" && out.action === "none" && ["buyer", "tenant"].includes(out.category) && out.viewing_date
    && /بكر|باكر|السبت|ال[اأ]حد|ال[اإ]ثنين|الثلاثاء|ال[اأ]ربعاء|الخميس|الجمع[ةه]/.test(String(c.burstSaid || ""))
    && !c.history.some((h: any) => h.direction === "outbound" && /تواصل\s*مع\s*(صاحب\s*العقار|المالك)/.test(String(h.body || "")))) {
    // (third run of the same message: «ممكن بكره بس». Any short reply goes, unless it says the day does not work.)
    // («الزيارة تحتاج تنسيق مع المالك قبل بيوم» does not hold him back when the day he named is tomorrow or later)
    const ahead = String(out.viewing_date) > new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Muscat" }).format(new Date());
    const NAME_Q = /^\s*و?اسمك\s*الكريم\s*؟\s*$/, DAY_NO = ahead ? /يوم\s*ثاني|صعب|ما\s*(ينفع|يصير|يمدي)/ : /قبل\s*ب?يوم|يوم\s*ثاني|صعب|ما\s*(ينفع|يصير|يمدي)/;
    if (!texts.some((t) => t.length > 200 || DAY_NO.test(t))) {
      out.action = "send_owner_number"; texts = [OWNER_TIME_LINE, ...texts.filter((t) => NAME_Q.test(t))]; out.guard_owner_number_day = true;
    }
  }
  // R41, same batch: «… يحتاج رد أحمد» with no handoff leaves the client waiting for nobody. It becomes the silent handoff
  // «سؤال ما عندي جوابه:» (R41), unless a handoff or a location is already going out.
  if (out.action === "none" && texts.some((t) => t.length <= 200 && NEEDS_AHMED.test(t))) {
    texts = []; out.action = "handoff"; out.guard_needs_ahmed = true;
    out.handoff_reason = `سؤال ما عندي جوابه: ${String(c.burstSaid || "").replace(/\s+/g, " ").trim().slice(0, 200)}`;
  }
  // R80 (Ahmed 15 Nov 2026 evening): who pays the commission. A buyer on a property we list for its owner is told he pays the
  // office nothing: the party who mandated us (the owner) does. An owner who asks our commission is told we visit first and
  // agree after. No figure ever (the brain's line stays). A broker is still not answered (brain, 9 Nov).
  // (rows 1321-1360: «نعتذر منك احنا ما نستلم عقارات مرهونة» then the commission lines; after a decline nothing more is said)
  if (COMMISSION_ASK.test(c.burstSaid) && !texts.some((t) => /ما\s*(نقدر\s*)?(نستلم|نقبل)|نعتذر[^\n]{0,40}(ورث|مرهون|مسكون|ساكن)|نشتغل\s*في\s*مسقط\s*وبركاء\s*فقط/.test(t)) && (out.action === "none" || (out.action === "handoff" && !c.hardHandoff) || UNKNOWN_Q.test(String(out.handoff_reason || "")))) {
    const lines = out.category === "seller" ? COMMISSION_OWNER_LINES : out.category === "buyer" && c.prop?.owner_id && c.prop?.listing_purpose !== "rent" ? COMMISSION_BUYER_LINES : null;
    if (lines) {
      texts = [...texts.filter((t) => !(t.length <= 250 && /عمول|[اأ]حمد/.test(t))).slice(0, 1), ...lines];
      if (out.action === "handoff") { out.action = "none"; out.handoff_reason = null; delete out.soft_handoff_no_reply; }
      out.guard_commission = true;
    }
  }
  // R82 (Ahmed, same evening: «كان محدد أي عقار بالضبط ومعانا هذا العقار كان، بس الحين ما معانا… يحول حال أقرب عقار»): the
  // client names a property by its area, we no longer have it, and the model asked for a link: he is told it is not available
  // and offered the nearest one we have (same number, same kind, price within 10,000), as R24 / R6 say.
  if (out.action === "none" && !c.prop && ["buyer", "tenant"].includes(out.category) && texts.some((t) => t.length <= 200 && ASK_LINK.test(t))) {
    const said = areaKey(c.burstSaid), named = (rows: any[]) => (rows || []).filter((p: any) => areaKey(p.area).length > 2 && said.includes(areaKey(p.area)));
    const gone = named(c.gone)[0];
    if (gone && !named(c.available).length) {
      const group = (t: unknown) => (/villa|house|twin/i.test(String(t || "")) ? "home" : String(t || ""));
      const alt = (c.available || []).filter((p: any) => p.branch_key === c.route && (p.listing_purpose || "sale") === (gone.listing_purpose || "sale") && group(p.type) === group(gone.type)
        && Math.abs(Number(p.price || 0) - Number(gone.price || 0)) <= 10000).sort((a: any, b: any) => Math.abs(Number(a.price) - Number(gone.price)) - Math.abs(Number(b.price) - Number(gone.price)))[0];
      const label = (p: any) => `${c.typeLabel ? c.typeLabel(p.type) : "عقار"} ${String(p.area || "").trim()}`;
      texts = [`${label(gone)} اللي سألت عنها ما متوفره حالياً`,
        ...(alt ? [`بس عندنا ${c.typeLabel ? c.typeLabel(alt.type) : "عقار"} في ${String(alt.area || "").trim()} بـ ${Math.round(Number(alt.price || 0) / 1000)} الف`, "تحب ارسلك تفاصيلها ؟"] : ["اول ما يتوفر بتواصل معك"])];
      out.guard_named_gone = true;
    }
  }
  const SOLD_AD = /تم\s*البيع|sold\s*out|نبارك\s*للشاري|تم\s*الحجز|انباع(ت)?(\s|$)/i;
  // R44 / R32, tenth dry-run batch: «شفت بيت معروض فحيل الجنوبية عطوني تفاصيل» got «قصدك البيت المعروض في الحيل الجنوبية ؟»,
  // and «عارضين بيت للبيع ف الحيل الجنوبية» was answered as an owner («ارسل تفاصيل البيت والمستندات»). The client names an
  // area where this number has exactly one available property and no word says the property is his: he gets its details.
  {
    const echo = out.action === "none" && texts.some((t) => ASK_CONFIRM.test(t.trim()));
    const asOwner = out.action === "none" && out.category === "seller" && WE_SHOW.test(c.burstSaid) && !MY_OWN.test(recentIn);
    // (dry run rows 1086-1125, 17 Nov: «بكم الفلل الي ف الصومحان» got «ارسل لي رابط الفيديو» although the Al Sawmhan units are
    // listed: a link asked for an area we have counts too, and units with the same ad and price count as one)
    // (rows 1441-1480: «صومحان» alone got «ايش المواصفات اللي تبحث عنها في الصومحان…»: a short message naming an area we list
    // counts like a link request)
    const linkAsk = out.action === "none" && !c.prop && ["buyer", "tenant"].includes(out.category)
      && texts.some((t) => t.length <= 200 && (ASK_LINK.test(t) || (/ايش\s*المواصفات\s*اللي\s*تبحث/.test(t) && String(c.burstSaid || "").trim().length <= 30)));
    if (echo || asOwner || linkAsk) {
      const said = areaKey(c.burstSaid);
      // «الصومحان» names «الصومحان الجنوبية» and «الرميس» names «بركاء الرميس» when the client gives no north / south of his own
      const base = (a: unknown) => areaKey(a).replace(/^(ولايه\s+)?(بركاء|مسقط)\s+/, "").replace(/\s+(جنوبيه|شماليه|جنوب|شمال)$/, "");
      const names = (a: unknown) => said.includes(areaKey(a)) || (base(a).length > 2 && said.includes(base(a)) && !/جنوب|شمال/.test(said));
      const here = (c.available || []).filter((p: any) => p.branch_key === c.route && areaKey(p.area).length > 2 && names(p.area))
        // (units of one owner, same area, type and price are one offer; the fullest ad of them is sent)
        // (dry run on the branch: one unit's longest caption is the «تم البيع Sold out … نبارك للشاري» post of its sold sibling;
        // an ad that says sold is never the one sent, and goes last)
        .sort((a: any, b: any) => (SOLD_AD.test(String(a.marketing || "")) ? 1 : 0) - (SOLD_AD.test(String(b.marketing || "")) ? 1 : 0)
          || String(b.marketing || "").length - String(a.marketing || "").length)
        .filter((p: any, i: number, a: any[]) => a.findIndex((q: any) => Number(q.price || 0) === Number(p.price || 0)
          && (String(q.marketing || "").slice(0, 80) === String(p.marketing || "").slice(0, 80) || (!!q.owner_id && q.owner_id === p.owner_id && q.type === p.type && q.area === p.area))) === i);
      // («شفتك مصور بيت في رميس فله»: Al Rumais has a villa and a rest house; the word «فله» picks the villa)
      const homes = /فيل|فل[ةه]|فلل|توين/.test(said) ? here.filter((x: any) => /villa|twin/i.test(String(x.type || "")) || String(x.type || "") === "house") : here;
      const p = here.length === 1 ? here[0] : homes.length === 1 ? homes[0] : null;
      if (p && p.marketing && !SOLD_AD.test(String(p.marketing)) && !sentBefore(String(p.marketing).slice(0, 40))) {
        texts = [String(p.marketing), "متى يناسبك تزور ؟"];
        out.property_id = p.id; if (asOwner) out.category = "buyer";
        out.guard_named_available = true;
      }
    }
  }
  // R81 (Ahmed, same evening: «دام إنه وصل موضوع حجز مفروض يتحول عندي… مشتري جاد… ما يرد عليه بشيء»; widens R79): a buyer who
  // asks about booking a property or a deposit, visited or not, gets no reply: the chat goes to Ahmed as «مشتري جاد:» with
  // the WhatsApp alert. Not a visit appointment, not a short rent of a rest house, not over another hard handoff or a call request.
  if (["buyer", "active_deal"].includes(out.category) && (!c.hardHandoff || UNKNOWN_Q.test(String(out.handoff_reason || ""))) && !/^\s*طلب اتصال/.test(String(out.handoff_reason || ""))
    && BOOKING_ASK.test(c.burstSaid) && !BOOKING_NOT.test(c.burstSaid)) {
    texts = []; out.action = "handoff"; out.guard_booking_serious = true; delete out.soft_handoff_no_reply;
    out.handoff_reason = `مشتري جاد: يسأل عن الحجز: ${String(c.burstSaid || "").replace(/\s+/g, " ").trim().slice(0, 160)}`;
  }
  // R79 (Ahmed: «افضل على واتسابي»): a client who visited and asks about a deposit or booking is «مشتري جاد:», so the
  // WhatsApp alert of R7 reaches Ahmed. Once, when the chat is not already with him; never over a hard handoff or a call request.
  if (out.action === "handoff" && !c.handoffOpen && !c.hardHandoff && !/^\s*طلب اتصال/.test(String(out.handoff_reason || "")) && ["buyer", "active_deal"].includes(out.category)
    && DEPOSIT_SAID.test(recentIn) && (c.visitedProp || c.visitedAny || c.saidVisited)) {
    out.handoff_reason = `مشتري جاد: ${String(out.handoff_reason || out.intent || "زار ويسأل عن العربون والحجز").replace(/^[^:\n]{0,30}:\s*/, "")}`;
    out.guard_deposit_serious = true; delete out.soft_handoff_no_reply;
  }
  // R84 (Ahmed 16 Nov 2026: «أفضل يسأله يعني الساعة كم بدل لا هو يحدد»): the client named a day and no hour («بكره»), and the
  // agent wrote «تقدر تشوفه بكره الساعة 4 العصر» (the 16:00 a visit with no hour is saved at). The hour is his to say: ours is
  // taken out of the line and he is asked «كم الساعة تقريباً ؟». The location still goes (R11 is about the day or the hour).
  // Not for a visit arranged with the owner (R77) and not for the location sent to judge the area (R74).
  // The same line with no location going out (it went earlier in the chat): only a line about seeing the open house, and only
  // when the client never said an hour anywhere in the chat.
  const sendingPlace = ["send_location", "send_lockbox"].includes(out.action);
  const ourHour = (t: string) => t.length <= 200 && OUR_HOUR.test(t) && (sendingPlace || (/مفتوح|تشوف/.test(t) && !/[اأ]مس|كانت/.test(t)));
  if ((sendingPlace || (out.action === "none" && ["buyer", "tenant"].includes(out.category))) && !out.location_for_area && c.prop?.visit_method !== "owner_lives"
    && !HOUR_SAID.test((sendingPlace ? inbound.slice(-3) : inbound).map(body).join(" \n ")) && texts.some(ourHour)) {
    const PART = "(العصر|الصبح|الصباح|المغرب|المسا|المساء|الظهر|الليل)";
    texts = texts.map((t) => (ourHour(t)
      ? t.replace(new RegExp(`\\s*(على\\s*)?الساع[ةه]\\s*[0-9٠-٩]+(\\s*ونص)?(\\s*${PART})?`, "g"), "").replace(new RegExp(`\\s*[0-9٠-٩]+(\\s*ونص)?\\s*${PART}`, "g"), "").replace(/\s+/g, " ").trim() : t)).filter(Boolean);
    if (!texts.some((t) => ASK_HOUR.test(t))) texts.push("كم الساعة تقريباً ؟");
    out.viewing_time = null; out.guard_hour_asked = true;
  }
  // decision 17 (Ahmed 18 Nov 2026: «يرسل له لوكيشن حق العصر… بعد ما يرسل له لوكيشن يسأله الساعة كم تقريبا إذا كان ما محدد»,
  // changes the «العصر» exception of R84): a part of the day with no hour («بكره العصر», «المغرب») gets the location, then
  // «كم الساعة تقريباً ؟» after it. Not «الحين» or «في الطريق» (the time is now), not when he said a clock hour, not where the
  // owner arranges the visit (R77), not for the R74 area location.
  {
    const PERIOD = /(^|[^ء-ي])(ال|بال|في\s*ال)?(عصر|مغرب|صبح|صباح|ظهر|ضحى|فجر|عشا|عشاء|ليل|مسا|مساء)(?![ء-ي])/;
    const NOW_OR_CLOCK = /[0-9٠-٩]|الساع[ةه]\s*(وحد[ةه]|ثنت|ثلاث|[اأ]ربع|خمس|ست|سبع|ثمان|تسع|عشر)|الحين|ال[اآ]ن|ذلحين|هالحين|(^|\s)تو(\s|$)|طالع|في\s*الطريق|جاي|واصل|وصلت/;
    const lastSaid = inbound.slice(-3).map(body).join(" \n ");
    const methodOk = c.prop && ["open", "lockbox"].includes(String(c.prop.visit_method || ""));
    if (PERIOD.test(lastSaid) && !NOW_OR_CLOCK.test(lastSaid) && methodOk && !out.location_for_area && ["buyer", "tenant"].includes(out.category) && !c.hardHandoff) {
      // the model held the location back and only asked the hour: the location goes now
      if (out.action === "none" && c.prop.map_url && !sentBefore(String(c.prop.map_url)) && texts.some((t) => t.length <= 200 && ASK_HOUR.test(t))) {
        out.action = c.prop.visit_method === "lockbox" ? "send_lockbox" : "send_location";
        texts = texts.filter((t) => !(t.length <= 200 && (ASK_HOUR.test(t) || LOCATION_HELD.test(t))));
        if (!texts.length) texts = [c.prop.visit_method === "lockbox" ? "تفضل هذا الموقع" : "البيت مفتوح تقدر تشوفه"];
      }
      if (["send_location", "send_lockbox"].includes(out.action)) {
        const PART = "(العصر|الصبح|الصباح|المغرب|المسا|المساء|الظهر|الليل)";
        texts = texts.map((t) => (t.length <= 200 && OUR_HOUR.test(t)
          ? t.replace(new RegExp(`\\s*(على\\s*)?الساع[ةه]\\s*[0-9٠-٩]+(\\s*ونص)?(\\s*${PART})?`, "g"), "").replace(new RegExp(`\\s*[0-9٠-٩]+(\\s*ونص)?\\s*${PART}`, "g"), "").replace(/\s+/g, " ").trim() : t))
          .filter((t) => !(t.length <= 200 && ASK_HOUR.test(t))).filter(Boolean);
        texts.push("كم الساعة تقريباً ؟");
        out.viewing_time = null; out.guard_period_hour = true;
      }
    }
  }
  // Audit of the replies really sent (11 to 15 Nov 2026), three wordings the code itself produced or let through:
  // R44: «حي عاصم» becomes «الرميس», which left «الرميس ولا الرميس ؟» and «… قريب الشارع العام او الرميس» in two sent replies.
  // The second mention in the same line is taken out.
  if (out.guard_r44) texts = texts.map((t) => (t.length <= 250 ? t.replace(/(الرميس[^\n؟?]{0,60}?)\s+(او|أو|ولا|و)\s*(في\s*|ب)?الرميس(?![ء-ي])/g, "$1") : t));
  // R45: «متى يناسبك ؟» becomes «يناسبك ؟», which left «… ونعرض لك الوحدات المتوفرة ويناسبك ؟»
  texts = texts.map((t) => (t.length <= 250 ? t.replace(/\s+و\s*يناسبك\s*؟/g, " يناسبك ؟") : t));
  // «متى يناسبك تزور واسمك الكريم ؟» (dry run of 16 Nov): the name question is not glued inside the visit question
  texts = texts.map((t) => (t.length <= 120 ? t.replace(/(تزور(ون|ين)?)\s*و\s*اسمك\s*الكريم\s*؟/g, "$1 ؟") : t));
  // R66: Barka offered on the Muscat number in other words than «اذا تقبل بركاء» («الاقرب لمبلغ التمويل عندنا فيلا في الصومحان
  // الجنوبية بـ69 الف», 14 Nov, to a client who named no area). Same rule: only for a client who said المعبيلة or near Barka,
  // and never when he himself sent the property (a link or a picture: R48 answers that).
  if (c.route === "muscat" && out.action === "none" && ["buyer", "tenant"].includes(out.category)
    && !inbound.some((h: any) => /instagram\.com|facebook\.com|fb\.watch/.test(body(h)) || ["image", "video"].includes(String(h.message_type || "")))) {
    const barka = (c.available || []).filter((p: any) => p.branch_key === "barka");
    const keys = barka.map((p: any) => areaKey(String(p.area || "").replace(/^\s*(ولاية\s+)?بركاء\s+/, "")).split(" ")[0]).filter((k: string) => k.length > 2 && !R66_GENERIC.includes(k));
    // (the Barka branch line written by the model itself for a property the client never named is the same offer)
    const offers = (t: string) => t.length <= 250 && (/92344273/.test(t) || (/عندنا|[اأ]قرب|متوفر|[0-9٠-٩]\s*[اأ]لف|تزيد/.test(t) && keys.some((k: string) => areaKey(t).includes(k))));
    // (a property the office already named in this chat is the topic, not a new offer: R48 answers that)
    const raised = c.history.some((h: any) => h.direction === "outbound" && (/92344273/.test(body(h)) || keys.some((k: string) => areaKey(body(h)).includes(k))));
    if (texts.some(offers) && !raised && !nearBarka(inbound.map(body).join(" "), barka.map((p: any) => p.area))) {
      texts = texts.filter((t) => !offers(t) && !(t.length <= 250 && (R66_DETAILS_ASK.test(t) || /تزيد/.test(t))) && !VISIT_Q.test(t));
      const line = (out.request?.areas || []).length ? "اول ما يتوفر بتواصل معك" : "في اي منطقة تبحث ؟";
      if (!texts.includes(line)) texts.push(line);
      out.guard_barka_offer = true; out.property_id = null;
    }
  }
  // R34 (dry run of 16 Nov, c151bb05 «ما رحت .. انتظر صور الشقق من المالك»): the privacy line went with the reel link and no
  // visit offer. The house the owner lives in gets the two fixed lines after it, and no video link (that is for an empty one).
  // (live check after v85: «ما صورنا الشقق من الداخل» is the same line)
  if (texts.some((t) => /ما\s*صورنا\s*[^\n]{0,20}?من\s*الداخل/.test(t)) && out.action !== "handoff" && !c.visitedProp) {
    texts = texts.filter((t) => !/^\s*https?:\/\/(www\.)?instagram\.com\/\S+\s*$/.test(t));
    const at = texts.findIndex((t) => /ما\s*صورنا\s*[^\n]{0,20}?من\s*الداخل/.test(t));
    if (!texts.some((t) => /نرتب\s*لك\s*زيارة/.test(t))) texts.splice(at + 1, 0, "بس نقدر نرتب لك زيارة وتشوف البيت من الداخل على راحتك");
    if (!texts.some((t) => /يناسبك/.test(t))) texts.push("متى يناسبك ؟");
    out.guard_privacy_visit = true;
  }
  // R78 (dry run of 16 Nov, 550b4985 «ممكن تفاصيل» + a reel, then «؟؟»; de9733c5 «رسلت لهم ما ردوا علي»): «ايش اللي ناقصك او
  // ما ناسبك في اللي شفته ؟» went to clients who never visited (an old office line «هل الفيلا ما ناسبتك» was read as a visit).
  // Asked only after a recorded visit or the client's own words; a reel nobody recognised gets the R23 question instead.
  const SEEN_Q = /ما\s*ناسب(ك|ج|كم)\s*في\s*اللي\s*شف|اللي\s*ناقص(ك|ج|كم)\s*(او|أو)/;
  if (texts.some((t) => SEEN_Q.test(t)) && !c.visitedProp && !c.visitedSome && !c.saidVisited) {
    texts = texts.filter((t) => !SEEN_Q.test(t));
    const linkSent = tail.some((h: any) => /instagram\.com|facebook\.com|fb\.watch/.test(body(h)));
    if (linkSent && !out.property_id) texts.push("اكتب لي المنطقة او السعر اللي في الاعلان اذا ما عليك امر");
    // R115 (18 Nov audit, 99448993 «ارسل صورة وموقع ان امكن» after «… انحجزت» + «تحب تشوف خيارات ثانية ؟»): the yes to the
    // sold notice got «ايش اللي ناقصك» and then a silent «ما عرفنا» handoff (one dry run of two). He wants the alternative:
    // the nearest available home of this branch is named, with «تقدر تزيد شوي ؟» when it is over his budget by more than 15%.
    if (!texts.some((t) => !/^\s*اسمك\s*الكريم\s*؟?\s*$/.test(t))) texts = soldNoticeYes(out, c) || texts;
    if (!texts.some((t) => !/^\s*اسمك\s*الكريم\s*؟?\s*$/.test(t))) {
      texts = []; out.action = "handoff"; out.handoff_reason = `ما عرفنا: العميل ما زار وكتب «${String(c.burstSaid || "").slice(0, 120)}»`;
    }
    out.guard_seen_q = true;
  }
  // (live check of v100: the same yes got «ايش المواصفات اللي ناقصتك في الفيلا السابقة ؟», a wording SEEN_Q does not catch)
  const MISSING_Q = /ناقص(ك|تك|ج|تج|كم)|ما\s*ناسب(ك|تك|ج|كم)/;
  if (!c.visitedProp && !c.visitedSome && !c.saidVisited && texts.some((t) => MISSING_Q.test(t))) {
    const alt = soldNoticeYes(out, c);
    if (alt) texts = alt;
  }
  // dry run of 16 Nov (307af714, b387b2de, 2 more): «اسمك الكريم ؟» stuck inside «الفيلا اللي سألت عنها انباعت», before the
  // details of the other property, read as one message «انباعت / اسمك الكريم ؟ / بس عندنا…». It moves before the last question.
  // ---- audit of the replies really sent 16 Nov 12:20 to 17 Nov 13:00 (Ahmed 17 Nov: «إيه صلّحهم») ----
  // R11 (401f1402 «وزين ترسلي الموقع بحاول باذن الله امر ليوم»): he asked for the location and named the day, and got the reel
  // and «متى يناسبك تزور ؟» with no location. A day said with the request is enough (R11: the day or the hour).
  if (out.action === "none" && ["buyer", "tenant"].includes(out.category) && !c.hardHandoff && c.prop?.map_url
    && !["owner_lives", "office"].includes(String(c.prop.visit_method || "")) && !sentBefore(String(c.prop.map_url))
    && LOCATION_ASK.test(String(c.burstSaid || "")) && DAY_WITH.test(String(c.burstSaid || "")) && !DAY_NOT.test(String(c.burstSaid || ""))) {
    // (dry run on the branch: «اذا تأكدت من الوقت يوم الخميس خبرني عشان ارسل لك الموقع» stayed beside the location itself)
    texts = texts.filter((t) => !(t.length <= 200 && (LOCATION_HELD.test(t) || /(ارسل|أرسل|برسل|نرسل)\s*(لك|ل[كج])?\s*(ال)?(موقع|لوكيشن|اللوكيشن)/.test(t))) && !VISIT_Q.test(t));
    if (!texts.length) texts = ["تفضل هذا الموقع"];
    out.action = "send_location"; out.guard_location_day = true;
  }
  // 007be129 «هذا هو» at the door, e06229f1 «أنا موجود حالياً في الفيلا. جالس أشوفها»: «وايش انطباعك بعد ما شفتها ؟» went to a
  // client who had only arrived. The opinion is asked once he has seen it; now he gets «حياك الله خذ راحتك».
  const OPINION_Q = /انطباع(ك|ج|كم)|كيف\s*(شفت|لقيت)(ها|ه|يها|يه)?|(ايش|وش)\s*ر[اأ]ي(ك|ج)\s*(فيها|فيه|بعد)/;
  const ARRIVING = /^\s*(هذا|هذي|هذه|هاذا)\s*(هو|هي)?\s*[.!]*\s*$|(^|\s)(وصلت|وصلنا|واصل|واصلين|واصله|واصلة|بدخل|ندخل|[اأ]دخل|تدخل|جالس\s*[اأ]شوف|موجود\s*(حالياً|حاليا|الحين)?\s*(جنب|عند|قدام|في)\s*(ال)?(فيلا|فل[ةه]|بيت|موقع))/;
  const SEEN_WORDS = /عجب|حلو|حلوه|ناسب|ما\s*ناسب|شفته|شفتها|شفناه|شفناها|خلصت|طلعت|زرت|غال(ي|يه)|صغير|ضيق|واسع|زين/;
  // (rows 930-969: «انا قريبه», then a photo and «هذا البيت» right after «الاستاذ احمد وصل وينتظرك هناك»: also an arrival)
  const lastOuts = c.history.filter((h: any) => h.direction === "outbound").slice(-3).map(body).join(" ");
  const arrivedAtOurs = (/^\s*(هذا|هذي|هذه)\s*(البيت|الفيلا|الفل[ةه])\s*$/.test(String(c.burstSaid || "").trim()) && /وصل|ينتظرك|مفتوح|تقدر\s*تشوف/.test(lastOuts))
    || /(^|\s)[اأ]نا\s*قريب(ه|ة)?(\s|$)/.test(String(c.burstSaid || ""));
  if (texts.some((t) => t.length <= 200 && OPINION_Q.test(t)) && (ARRIVING.test(String(c.burstSaid || "")) || arrivedAtOurs) && !SEEN_WORDS.test(String(c.burstSaid || "")) && out.action !== "handoff") {
    texts = texts.map((t) => (t.length <= 200 && OPINION_Q.test(t) ? t.replace(/\s*و?\s*(ايش|وش|كيف)?\s*(انطباع(ك|ج|كم)|ر[اأ]ي(ك|ج)|شفت(ها|ه)?|لقيت(ها|ه)?)[^؟?\n]*[؟?]?/g, "").trim() : t))
      .filter((t) => t.replace(/[^ء-ي]/g, "").length > 0);
    // (dry run on the branch, e06229f1 «إذا تأذن لي إني أدخل أشوف الفيلا»: he asked to go in, he is told the house is open)
    if (/[اأ]دخل/.test(String(c.burstSaid || "")) && c.prop?.visit_method === "open" && !texts.some((t) => /مفتوح/.test(t))) texts.push("البيت مفتوح تفضل");
    // decision 30 (Ahmed 18 Nov 2026: «حياك» is banned always): «حياك الله» is taken out, and a reply left with nothing but the
    // name question gets «تمام خذ راحتك» first
    texts = texts.map((t) => t.replace(/^\s*حياك(\s*الله)?\s*/, "").trim()).filter((t) => t.replace(/[^ء-ي]/g, "").length > 0);
    if (!texts.some((t) => !/^\s*و?اسمك\s*الكريم\s*؟?\s*$/.test(t) && t.replace(/[^ء-ي]/g, "").length > 2)) texts = ["تمام خذ راحتك", ...texts.filter((t) => /اسمك\s*الكريم/.test(t))];
    out.guard_arrived = true;
  }
  // rows 1201-1240: «عاينت الفيلا ؟» → «ايوا» got «وايش انطباعك عن الفيلا بعد ما شفتها ؟» and «متى يناسبك تزور ؟» together. Asking
  // what he thought of it means he saw it: the visit question goes.
  if (texts.some((t) => t.length <= 200 && OPINION_Q.test(t) && /بعد\s*ما\s*شفت|شفتها|شفته|زرت/.test(t)) && texts.some((t) => VISIT_Q.test(t))) {
    texts = texts.filter((t) => !(VISIT_Q.test(t) && !OPINION_Q.test(t))); out.guard_opinion_no_visit = true;
  }
  // rows 1241-1280 (and 1132): «بنسق معك لما تكون لي جيه هناك» got «تمام خذ راحتك» + «متى يناسبك تزور ؟». «خذ راحتك» leaves
  // the time to him: no visit question beside it.
  if (texts.some((t) => t.length <= 80 && /خذ(وا|ي)?\s*راحت(ك|كم|ج)/.test(t)) && texts.some((t) => VISIT_Q.test(t))) {
    texts = texts.filter((t) => !(VISIT_Q.test(t) && t.length <= 40)); out.guard_take_time = true;
  }
  // 4736075f: a video we could not read, then «السعر موجود في الفيديو اللي رسلته لك», then «انت ما تعرف تقرأ الرقم ؟؟»: the
  // same «اكتب لي السعر / المنطقة» went three times. Asked once; asked again, it goes to Ahmed with no reply (he can watch it).
  // rows 930-969: «اشوف الموقع اخي اذا ناسبني بزورها» about an ad picture nobody recognised got «تمام» alone. A location asked
  // for a property the agent cannot name gets the R23 question instead of a filler.
  const FILLER_ONLY = /^\s*(تمام|طيب|اوكي|ان\s*شاء\s*الله|حياك\s*الله)(\s*(خذ\s*راحتك|ان\s*شاء\s*الله))?\s*$/;
  if (out.action === "none" && ["buyer", "tenant"].includes(out.category) && !c.prop && !out.property_id && LOCATION_ASK.test(String(c.burstSaid || "")) && texts.length && texts.every((t) => FILLER_ONLY.test(t))) {
    texts = ["اكتب لي المنطقة او السعر اللي في الاعلان اذا ما عليك امر"]; out.guard_location_which = true;
  }
  // rows 1441-1480: a reel link nobody recognised got «وعليكم السلام ورحمة الله وبركاته / الحمدلله» and nothing else: the R23
  // question is added
  if (out.action === "none" && !c.prop && !out.property_id && /instagram\.com|facebook\.com|fb\.watch/.test(String(c.burstSaid || ""))
    && texts.length && texts.every((t) => /^[\s\n]*(وعليكم\s*السلام(\s*ورحمة\s*الله(\s*وبركاته)?)?|الحمد\s*لله|مرحبتين|تفضل)[\s\n]*((وعليكم\s*السلام[^\n]*|الحمد\s*لله|تفضل)[\s\n]*)*$/.test(t))) {
    texts = [...texts, "اكتب لي المنطقة او السعر اللي في الاعلان اذا ما عليك امر"]; out.guard_link_greeting_only = true;
  }
  const WHICH_ASK = /اكتب\s*(لي\s*)?(ال)?(رقم|سعر|منطق[ةه])|رابط\s*(ال)?(فيديو|اعلان|إعلان)|صور[ةه]\s*منه|احدد\s*العقار/;
  if (out.action === "none" && !c.prop && texts.some((t) => t.length <= 200 && WHICH_ASK.test(t))
    && c.history.slice(-8).some((h: any) => h.direction === "outbound" && WHICH_ASK.test(String(h.body || "")))) {
    texts = []; out.action = "handoff"; out.guard_which_twice = true;
    out.handoff_reason = `ما عرفنا: العميل أرسل العقار وما قدرنا نحدده وكتب «${String(c.burstSaid || "").replace(/\s+/g, " ").trim().slice(0, 120)}»`;
  }
  // 247f8277 «بكم تعرض البيت للبيع ؟» as a first message was answered as an owner («ارسل تفاصيل البيت كاملة والسعر اللي في
  // بالك»). «بكم تعرضون / بكم معروض» is a buyer asking our price: he is asked which property, as for any unnamed one.
  const ASK_OUR_PRICE = /بكم\s*(تعرض(ون)?|معروض[هة]?|عارضين|تبيع(ون)?)\s*(ال)?(بيت|فيلا|فل[ةه]|شق[ةه]|[اأ]رض|منزل|عقار)/;
  // 23 Nov 2026 (Ahmed's note on 743468e3: «هذا يبحث عن منزل وليس مالك عقار»): «عارض بيت للبيع في حي عاصم كم مطلوب» (you show a house
  // … how much do you ask) was taken as an owner and opened an owner offer. «عارض / معروض … كم مطلوب / كم السعر» is the same buyer.
  const ASK_THEIR_AD = /(عارض(ين)?|معروض[هة]?|تعرض(ون)?)\s*(ال)?(بيت|فيلا|فل[ةه]|شق[ةه]|[اأ]رض|منزل|عقار)[^؟?\n]{0,60}?(كم|بكم)\s*(ال)?(مطلوب|سعر[ها]?|يطلب|تطلبون|تبيعون)/;
  if (out.action === "none" && out.category === "seller" && (ASK_OUR_PRICE.test(String(c.burstSaid || "")) || ASK_THEIR_AD.test(String(c.burstSaid || ""))) && !MY_OWN.test(recentIn)) {
    // (dry run on the branch: «الحمدلله التثمين تبيه للبنك…» rode along; only a line that is nothing but the greeting stays)
    texts = [...texts.filter((t) => /^\s*(وعليكم\s*السلام(\s*ورحمة\s*الله(\s*وبركاته)?)?|الحمد\s*لله|مرحبتين(\s*تفضل)?)\s*$/.test(t)), "ارسل لي رابط الفيديو او صورة منه عشان ارسلك التفاصيل والسعر بالضبط"];
    out.category = "buyer"; out.guard_our_price = true;
  }
  // dry run rows 701-740 (17 Nov), 2abc2e0b «فلة الرميس اللي ب59 الف» with no ad sent: «الفيلا اللي سألتي عنها انباعت» + «بس عندنا
  // فيلا ثانية في الرميس بـ 59 الف». She named the one we have (another 59 in Al Rumais was sold): the sold line goes.
  {
    // (live check after v91: «سألتِ» with a kasra slipped through; the diacritics are allowed)
    // (dry run, same day: «الفيلا اللي سألتي عنها في الرميس بـ59 الف انباعت»: words between «عنها» and «انباعت»)
    const SOLD_ASKED = /(اللي\s*)?(سألت|سألتي|سألتو|سألتوا)[ً-ْ]*\s*عنها[^\n]{0,40}?(انباعت|ما\s*متوفر[هة]?(\s*حالي\S*)?)/;
    const west = String(c.burstSaid || "").replace(/[٠-٩]/g, (d: string) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
    const n = Number((west.match(/([0-9]{2,3})\s*(ال|أل|ا)?ف/) || [])[1] || 0);
    const said = areaKey(c.burstSaid);
    const adSent = inbound.slice(-6).some((h: any) => /instagram\.com|facebook\.com|fb\.watch/.test(body(h)) || ["image", "video"].includes(String(h.message_type || "")));
    const named = n && !adSent ? (c.available || []).find((p: any) => p.branch_key === c.route && Math.round(Number(p.price || 0) / 1000) === n
      && areaKey(p.area).split(" ").some((w: string) => w.length > 2 && said.includes(w))) : null;
    if (named && texts.some((t) => t.length <= 250 && SOLD_ASKED.test(t))) {
      texts = texts.map((t) => (t.length <= 250 && SOLD_ASKED.test(t) ? t.split("\n").filter((l) => !SOLD_ASKED.test(l)).join("\n").trim() : t)).filter(Boolean)
        .map((t) => t.replace(/^(\s*)بس\s+عندنا/, "$1عندنا").replace(/(فيلا|فل[ةه]|بيت|شق[ةه])\s+ثاني[ةه]/, "$1"));
      // (and when what is left offers another area, the one she named is sent instead)
      const namedBase = areaKey(named.area).replace(/^(ولايه\s+)?(بركاء|مسقط)\s+/, "");
      if (!texts.some((t) => areaKey(t).includes(namedBase)) && named.marketing && !/تم\s*البيع|sold\s*out|نبارك\s*للشاري/i.test(String(named.marketing))) {
        texts = [String(named.marketing), "متى يناسبك تزور ؟"];
      }
      out.property_id = named.id; out.guard_named_price_available = true;
    }
  }
  // same rows (5d29…, Al Khoud 7): «اول ما يتوفر بتواصل معك» and then «بس عندنا بيت في الحيل الجنوبية…»: with something offered
  // the waiting-list line is taken out.
  if (texts.some((t) => /(^|\n)\s*بس\s*عندنا/.test(t)) && texts.some((t) => /اول\s*ما\s*يتوفر\s*بتواصل\s*معك/.test(t))) {
    texts = texts.map((t) => t.split("\n").filter((l) => !/^\s*اول\s*ما\s*يتوفر\s*بتواصل\s*معك\s*$/.test(l)).join("\n").trim()).filter(Boolean);
    out.guard_wait_and_offer = true;
  }
  // dry run rows 817-852 (17 Nov): «بروم» got «اكتب لي طلبك» and «ممكن لبرووم» got «تقصد البرومبت ولا عرض عقاري ؟». A short
  // message asking for the «برو…م» is the salary video's prompt (brain: «برو» / «برومت» = البرومبت): the fixed line answers it.
  {
    const said = String(c.burstSaid || "").replace(/\s+/g, " ").trim();
    const PROMPT_LINE = "ارسل على الفيديو نفسه في الانستجرام وراح يوصلك البرومبت";
    // (rows 853-892: «ماذا اقوول لشات جي بي تي» as a first message got no reply; asked once, before the line went in this chat)
    const askGpt = said.length <= 60 && /شات\s*جي\s*بي\s*تي|جي\s*بي\s*تي|chat\s*gpt/i.test(said) && !sentBefore(PROMPT_LINE);
    if (((said.length <= 50 && /(^|\s|ل)(ال)?بر+و+م+(ت|بت|يت)?(\s|$|[؟?.!])/.test(said)) || askGpt) && ["none", "handoff"].includes(out.action) && !c.hardHandoff && !texts.includes(PROMPT_LINE)) {
      texts = [...texts.filter((t) => /^\s*(وعليكم\s*السلام(\s*ورحمة\s*الله(\s*وبركاته)?)?|مرحبتين)\s*$/.test(t)), PROMPT_LINE];
      out.action = "none"; out.handoff_reason = null; out.guard_prompt_word = true;
    }
  }
  // dry run rows 1161-1200 (and 914, 1058): an owner the office already sent to the other number («تواصل على هذا الرقم» + the
  // contact card) answered «طيب», and got «عقارك تتابعه معنا على رقم مسقط…» again. A bare acknowledgement after that gets nothing.
  {
    const ACK_ONLY = /^\s*(طيب|تمام|اوك|اوكي|ok|okay|زين|ابشر|ان\s*شاء\s*الله|إن\s*شاء\s*الله|ان\s*شاءالله)\s*[.!]*\s*$/i;
    const REDIRECT = /تتابعه\s*معنا\s*على\s*رقم|هذا\s*الرقم\s*خاص|تتابعها\s*معنا\s*على\s*رقم/;
    // (only the office's own pointer: the contact card or «تواصل على هذا الرقم»; after the agent's own line R48 decides)
    const pointed = c.history.some((h: any) => h.direction === "outbound" && (String(h.message_type || "") === "contacts" || /\[contacts\]|تواصل\s*على\s*(هذا|هال)\s*الرقم/.test(String(h.body || ""))));
    if (ACK_ONLY.test(String(c.burstSaid || "")) && texts.length && texts.every((t) => REDIRECT.test(t)) && pointed) { texts = []; out.guard_ack_after_redirect = true; }
  }
  // rows 1361-1400 (and 900, 970): a tenant asking for a house in Salalah («بيوت ارضي للايجار في صلاله») or Ibri got «حالياً ما
  // متوفر… اول ما يتوفر بتواصل معك», a promise for a place the office does not work in (R56). He gets R56's line instead.
  {
    const FAR = /(^|\s|في|ف|ب)(صلال[هة]|ظفار|صحار|صحم|السويق|الخابور[هة]|شناص|لوى|البريمي|نزوى|بهلاء|ازكي|إزكي|سمائل|عبري|الرستاق|ابراء|إبراء|المضيبي|جعلان|الدقم|مسندم|خصب)|(في|ولاي[ةه]|مدين[ةه])\s+صور(\s|$|[؟?])/;
    const OURS = /مسقط|بركاء|بركا(\s|$)|المعبيل|السيب|بوشر|الخوض|العامرات|الموالح|الحيل|العذيب|الغبر|القرم|الانصب|الأنصب|الرميس|الصومحان|الشخاخيط|المنوم/;
    const said = String(c.burstSaid || "");
    if (["buyer", "tenant"].includes(out.category) && out.action === "none" && FAR.test(said) && !OURS.test(said) && texts.some((t) => /اول\s*ما\s*يتوفر|ما\s*متوفر/.test(t))) {
      texts = [...texts.filter((t) => /^\s*(وعليكم\s*السلام(\s*ورحمة\s*الله(\s*وبركاته)?)?|مرحبتين)\s*$/.test(t)), "نعتذر منك احنا حالياً نشتغل في مسقط وبركاء فقط"];
      out.guard_far_request = true;
    }
  }
  // R115 (dry run of 799202aa on the branch, one run of three): the yes to «… انحجزت ⏎ تحب تشوف خيارات ثانية ؟» got only
  // «حاليا ما عندنا فيلا متوفره في الرميس ⏎ اول ما يتوفر بتواصل معك». A reply that offers nothing gets the nearest home instead.
  if (out.action === "none" && out.category === "buyer" && !c.visitedProp && texts.length
    && !/^\s*(لا|لاا|ما\s*(ابي|أبي|اريد|أريد|ابغى)|مب|مو|مشكور|شكرا)/.test(String(c.burstSaid || ""))
    // (live check of v103: «حالياً ما متوفر … ⏎ اول ما يتوفر بتواصل معك ⏎ متى يناسبك تزور ؟»: a visit question with nothing to visit
    // does not stop it)
    && texts.some((t) => !VISIT_Q.test(t)) && texts.filter((t) => !VISIT_Q.test(t)).every((t) => /ما\s*(عندنا|متوفر|في)|اول\s*ما\s*يتوفر|بتواصل\s*معك/.test(t))) {
    const alt = soldNoticeYes(out, c);
    if (alt) { texts = alt; out.guard_sold_yes_nothing = true; }
  }
  // R116 (reply audit 19 Nov, Ahmed chose «متى يناسبك تزور ؟» then «اسمك الكريم ؟»; c53c9aee and four more): an offer with no
  // question left the client with nothing to answer («ارسلي اشوف» got the ad of the Al Sawmhan villa only, 799202aa). An available
  // home offered to a buyer who has not seen it gets its reel (when not sent in this chat) and the visit question.
  // (dry run on the branch: the model now asked the visit question itself but left the reel out; the reel goes with the ad
  // before the last question either way)
  if (out.action === "none" && out.category === "buyer" && c.prop && (!c.prop.status || c.prop.status === "available") && !c.visitedProp && !out.viewing_date
    && texts.some((t) => t.length > 120 && !/^https?:/.test(t))) {
    const vcode = c.prop.video ? (String(c.prop.video).match(IG_CODE) || [])[1] || String(c.prop.video) : "";
    const hasQ = texts.some((t) => /[؟?]/.test(t));
    if (vcode && !sentBefore(vcode) && !texts.some((t) => t.includes(vcode))) {
      if (hasQ && /[؟?]\s*$/.test(texts[texts.length - 1])) texts.splice(texts.length - 1, 0, String(c.prop.video)); else texts.push(String(c.prop.video));
      out.guard_offer_question = true;
    }
    if (!hasQ) { texts.push("متى يناسبك تزور ؟"); out.guard_offer_question = true; }
  }
  // R22 (reply audit 22 Nov, اسماء الهنائي 35bb3ae0): «بـ60 الف ما عندنا … الصراحة» + «اقرب شي … بـ69 الف» with no question left her
  // nothing to answer; the nearest home above the budget ends with «تقدر تزيد شوي ؟» (Azza 4b7e6a19 got it right the next day)
  if (out.action === "none" && out.category === "buyer" && texts.length && !texts.some((t) => /[؟?]/.test(t))
    && texts.some((t) => t.length <= 250 && /ما\s*عندنا/.test(t) && /\d/.test(t)) && texts.some((t) => /(اقرب|أقرب)\s*شي/.test(t))) {
    texts.push("تقدر تزيد شوي ؟"); out.guard_budget_question = true;
  }
  // R45 (reply audit 22 Nov, احمد الشريف d4d12e25): the invitation «الافضل نرتب لك اجتماع …» always ends with «يناسبك ؟»
  if (texts.some((t) => t.length <= 300 && /(نرتب|نرتبلك|نسوي|نحدد)\s*(لك|لكم|لج)?\s*اجتماع/.test(t)) && !texts.some((t) => /[؟?]/.test(t))) { texts.push("يناسبك ؟"); out.guard_invite_question = true; }
  // brain «إذا سأل عن الحال: "الحمدلله" وكمل» (reply audit 22 Nov, Azza 4b7e6a19: «كيف الحال ؟» got no answer)
  if (texts.length && /(^|[\s.!،,])(كيف\s*(ال)?حال(ك|كم|ج)?|كيفك|كيفكم|شلونك|شلونكم|علومك|علومكم)\s*[؟?]?(?=$|[\s.!،,])/.test(String(c.burstSaid || "")) && !texts.some((t) => /الحمد\s*لله|الحمدالله/.test(t))) {
    // on the first line of the reply (inside the same message), never a message of its own: the reply keeps at most 3 and the
    // trimming below dropped the offer line for it (live check of v106, Azza 4b7e6a19)
    const i = /^\s*وعليكم\s*السلام/.test(texts[0]) && texts.length > 1 ? 1 : 0;
    texts[i] = i === 0 && /^\s*وعليكم\s*السلام/.test(texts[0]) ? `${texts[0]}\nالحمدلله` : `الحمدلله\n${texts[i]}`; out.guard_how_are_you = true;
  }
  // R116: «اسمك الكريم ؟ ومتى يناسبك تزور ؟» in one line: the other question first, the name question last on its own line
  {
    let moved = false;
    texts = texts.map((t) => t.split("\n").map((l) => {
      const m = l.match(/^\s*اسمك\s*الكريم\s*؟\s*و\s*(\S.*[؟?])\s*$/);
      if (!m) return l;
      moved = true; return m[1].trim();
    }).join("\n"));
    if (moved) {
      texts = texts.map((t) => t.split("\n").filter((l) => !/^\s*اسمك\s*الكريم\s*؟\s*$/.test(l)).join("\n")).filter((t) => t.trim());
      texts.push("اسمك الكريم ؟");
      out.guard_name_after_q = true;
    }
  }
  const NAME_LINE = /^\s*اسمك\s*الكريم\s*؟\s*$/;
  for (let i = 0; i < texts.length - 1; i++) {
    const ls = texts[i].split("\n");
    if (ls.length > 1 && ls.some((l) => NAME_LINE.test(l))) {
      texts[i] = ls.filter((l) => !NAME_LINE.test(l)).join("\n");
      if (!texts.some((t) => /اسمك\s*الكريم/.test(t))) {
        if (/؟\s*$/.test(texts[texts.length - 1])) texts.splice(texts.length - 1, 0, "اسمك الكريم ؟"); else texts.push("اسمك الكريم ؟");
      }
      out.guard_name_last = true;
    }
  }
  return texts;
}
const DEPOSIT_SAID = /عربون|مقدم\s*حجز|(ا|أ|ن)حجز\s*(ال)?(فيلا|فل[ةه]|بيت|شق[ةه]|منزل|عقار|[اأ]رض)|لحجز\s*(ال)?(فيلا|فل[ةه]|بيت|شق[ةه]|منزل|عقار|[اأ]رض)/;
// R40 (Ahmed 12 Nov): people the office never answers; the chat leaves «العقل موقوف عندهم» for the ignored list
const IGNORE_LABEL: Record<string, string> = { job: "طالب وظيفة", broker_signup: "يبي يتسجل وسيط عندنا", foreign_broker: "وسيط أو شركة من برا عمان", bank: "موظف بنك يعرض تعاون", service: "يعرض خدمة", contest: "يسأل عن مسابقة", stranger: "رسالة مشبوهة من رقم غريب", not_real_estate: "غريب يطلب شي مو عقاري (مساعدة، تبرع)" };
// Ahmed's strict rule (6 Nov): never promise the customer a reply ("بشوف وارد عليك"). Silence is better than a promise nobody keeps.
// R12 (9 Nov, in code 10 Nov): first-person call promises too ("بتصل عليك", "بكلمك"). The one allowed sentence is R12's third-person
// "اول ما يفضى يتصل فيك", which none of these match; "اول ما يتوفر بتواصل معك" is not a call promise and stays.
const PROMISE_RE = /(بشوف|بأشوف|اشوف|أشوف|بتأكد|باتأكد|أتأكد|اتأكد|بأكد|باكد|أأكد|اأكد|بنسق|براجع|بسأل|بنشوف)[^\n]{0,40}(وارد|و ارد|وبرد|وأرد|وارجع|وبرجع|ونرد|ونرجع)\s*(لك|عليك|عليج|عليكم)|(برد|بارد|برجع|بنرد|بنرجع|بيرد)\s*(لك|عليك|عليج|عليكم)\s*(بعدين|بعد شوي|قريب)?\s*$|(بتصل|باتصل|بأتصل)\s*(عليك|عليج|عليكم|فيك|فيج|فيكم)|بكلمك|بكلمج|بكلمكم|(ا|أ)تصل\s*(عليك|عليج|عليكم)|بتواصل\s*(معك|معج|معكم)\s*بالاتصال/;
const CALL_PROMISE_RE = /(بتصل|باتصل|بأتصل)\s*(عليك|عليج|عليكم|فيك|فيج|فيكم)|بكلمك|بكلمج|بكلمكم|(ا|أ)تصل\s*(عليك|عليج|عليكم)|بتواصل\s*(معك|معج|معكم)\s*بالاتصال/;
// R1 (Ahmed 8 Nov, docs/agent-rules.md): once a person from the office types in a chat, the agent stays out until Ahmed
// hands it back from the inbox. Decided in SQL by crm_chat_hold() so the agent, follow-ups and inbox agree.
// R2: no negotiation before the customer has visited that property: the agent books the visit instead.
const NEGOTIATION_HANDOFF = /^\s*(تفاوض|مشتري جاد)\s*:/;
// R15: a name that starts with «أم» / «ام» (Umm Rakan) is a woman
const FEMALE_KUNYA_RE = /(^|[\s|،,(])(أم|ام|إم)\s+[ء-ي]{2,}/;
// the same name typed in Latin letters («Om Muhsen», «Umm Ali»). «Om» is also an Indian man's name (Om Prakash), so the
// Latin form only counts when the customer writes to us in Arabic.
const FEMALE_KUNYA_LATIN_RE = /(^|[\s|,(])(umm|um|oum|omm|om)[\s_.-]+[a-z]{3,}/i;
// R17 (dry run 10 Nov): a residency line must not promise it («الإقامة الدائمة ما لها سعر محدد ومضمونة بمجرد شراء العقار»).
// A line about work rights («ما تعطي حق العمل تلقائياً») is the allowed knowledge line and stays.
const RESIDENCY_WORD_RE = /(إقام|اقام)(ة|ه)/;
const RESIDENCY_PROMISE_RE = /مضمون|نضمن|يضمن\s*لك|تضمن\s*لك|تلقائي|بمجرد|ما\s*(لها|له)\s*سعر|100\s*%/;
const RESIDENCY_WORK_RE = /حق\s*العمل|الشغل|وزارة\s*العمل|تشتغل/;
const promisesResidency = (t: string) => RESIDENCY_WORD_RE.test(t) && RESIDENCY_PROMISE_RE.test(t) && !RESIDENCY_WORK_RE.test(t);
// R17: a residency answer that opens with a denial («ما في عقار يضمن إقامة», «ما في إقامة», «ما في قيمة عقار تضمن...»)
const NEG_RESIDENCY_RE = /^\s*(ما\s*(في|فيه)\s*(عقار|قيمة|شي)[^\n]{0,30}(يضمن|تضمن|يعطي|تعطي)[^\n]{0,20}(إقامة|اقامة)|ما\s*(في|فيه)\s*(إقامة|اقامة)|(لا\s*يوجد|ما\s*عندنا)\s*(عقار)?[^\n]{0,20}(يضمن|تضمن)[^\n]{0,20}(إقامة|اقامة))/;
const SAID_VISITED = /(?<!(?:ما|مب|مو|لسا|لسه|بعدني|بعدنا)\s{0,2})(مشيت شفت|مريت عليه|مريت عليها|زرت|زرنا|زرناه|زرناها|عاينت|عاينا|شفت البيت|شفت الفيلا|شفنا البيت|شفنا الفيلا|شفناه|شفناها|رحت شفت|رحنا شفنا|دخلت البيت|دخلنا)/;
// R16 (9 Nov): our after-visit question («كيف لقيت…» / «قدرت تشوفه ؟» / «قدرتي تشوفينه ؟»), not a question about a video or photos
const AFTER_VISIT_Q = /كيف\s*لقي|كيف\s*شفت|قدرت[يوا]*\s*تشوف/;
// R29 (Ahmed 11 Nov): «مبروك» only when the customer says they bought, reserved or paid. «ايوه لقيناها الفيلا» after our
// after-visit question means they found the place, not that they bought (Umm Mawadda got «مبروك الله يبارك لك 🌷»).
const CONGRATS_RE = /مبروك|مبارك\s*عليك|يبارك\s*لك/;
const BOUGHT_RE = /(اشتري|اشترينا|اشتريت|شرينا|شريت|حجزنا|حجزت|دفعنا|دفعت|عربون|تم\s*البيع|استلمنا|وقعنا|وقعت|سجلنا|تزوج|عرس|مولود|نجح|تخرج|توظف)/;
// R71 (Ahmed 14 Nov 2026, notes 6793c909 / 7c28d6ca / 41e2db0a: «دام إنه الشخص حجز عقاره وباركنا له… فما يحتاج إن نرد عليه»):
// a client told us she booked or bought, we congratulated her, and her answer is only closing words («الله يبارك فيك», «شكراً»,
// 🌷): no reply and no draft (this changes R49 here only), her active requests close (search_stopped) and nothing follows her.
const BOOKED_RE = /(اشترينا|اشتريت|شرينا|شريت|حجزنا|حجزت|دفعنا|دفعت|عربون|استلمنا|وقعنا|وقعت|تم\s*البيع|تم\s*الحجز)/;
const CLOSING_WORDS = /(الله\s*)?(يبارك|بارك)(\s*الله)?(\s*(فيك|فيكي|فيكم|فيج|بك|بكم))?|شكرا|شكراً|جزيلا|جزيلاً|مشكور(ين|ه|ة)?|تسلم(ون|ين)?|(الله\s*)?يسلمك|يعطيك\s*العافي[هة]|جزا(ك|كم)?\s*الله\s*خير(ا|اً)?|[اآ]مين|(الله\s*)?يحفظك|ما\s*قصرت(وا)?|الحمد\s*لله|ولله\s*الحمد|خلاص|تمام|اوكي|ok|thanks|thank\s*you|وياك(م)?|حياك(م)?(\s*الله)?|ان\s*شاء\s*الله|الله\s*يسعدك|يعطيك\s*الصح[هة]/gi;
function closingOnly(h: any) {
  if (["reaction", "sticker"].includes(String(h.message_type || ""))) return true;
  const s = `${h.body || ""} ${h.transcript || ""}`;
  if (/[؟?]/.test(s)) return false;
  return !s.replace(CLOSING_WORDS, " ").replace(/[^ء-يA-Za-z]+/g, "");
}
// R49 by code (15 Nov 2026): the client's words are thanks and nothing else (greeting and filler words aside)
// (rows 1321-1360: «جزا الله خيرا» got «تفضل»)
const THANKS_WORD = /شكر|مشكور|تسلم|يسلمو|يعطيك\s*العافي|جزاك|جزا\s*الله|جزيت|بارك\s*الله|يبارك|ما\s*قصرت|ما\s*تقصر|thank/i;
const THANKS_FILLER = /(^|\s)(تم|طيب|اخي|اخوي|أخي|أخوي|الغالي|عزيزي|حبيبي|يا|والله|خير|خيرا|خيراً|كثير|كثيرا|جدا|لك|لكم|وعليكم السلام|ورحمة الله|ورحمه الله|وبركاته|استاذ|أستاذ)(?=\s|$)/g;
const thanksOnly = (s: string) => !/[؟?]/.test(s) && THANKS_WORD.test(s) && !s.replace(/[ً-ْ]/g, "").replace(CLOSING_WORDS, " ").replace(THANKS_FILLER, " ").replace(/[^ء-يA-Za-z]+/g, "");
function closedAfterBooking(history: any[]) {
  const said = history.filter((h: any) => !["edit", "revoke", "system", "unsupported"].includes(String(h.message_type || "")));
  let lastOut = -1; said.forEach((h: any, i: number) => { if (h.direction === "outbound") lastOut = i; });
  if (lastOut < 0 || !CONGRATS_RE.test(String(said[lastOut].body || ""))) return false;
  const burst = said.slice(lastOut + 1).filter((h: any) => h.direction === "inbound");
  let prevOut = -1; for (let i = lastOut - 1; i >= 0; i--) if (said[i].direction === "outbound") { prevOut = i; break; }
  const before = said.slice(prevOut + 1, lastOut).filter((h: any) => h.direction === "inbound").map((h: any) => `${h.body || ""} ${h.transcript || ""}`).join(" ");
  return burst.length > 0 && BOOKED_RE.test(before) && burst.every(closingOnly);
}
// Ahmed 14 Nov 2026 (same notes): «أمر للذكاء الاصطناعي» that says not to answer («ما يحتاج نرد», «ما في أي رد», «لا ترد»,
// «الغي المتابعة», «خوزه من هنا») closes the draft at once instead of asking the model again; an order that also says what to send does not.
const NO_REPLY_ORDER = /ما\s*(في|فيه|فيها)\s*(أي|اي|اى)?\s*رد|ما\s*(يحتاج|نحتاج|تحتاج|له\s*داعي|لها\s*داعي)\s*(ا|إ)?(ن)?\s*(ن|ت)?رد|(^|\s)(لا|ما)\s*(ت|ن)رد(ون)?(\s*(عليه|عليها|عليهم|بشي|بشيء))?\s*($|[.!،,]|خلاص)|بدون\s*(أي|اي)?\s*رد|(ا|إ)?لغ(ي|ى|يه|يها)\s*(ال)?(رد|متابع[هة])|لغ(يه|يها)\s*من\s*هنا|(خوز|شيل)(ه|ها|ة)?\s*من\s*هنا/;
const ORDER_DO = /(^|\s)(ارسل|أرسل|رسل|ارسله|ارسلها|قل|قول|قوله|قولها|اكتب|اسأل|اسال|اسأله|اساله|عطه|عطيه|خبره|خبرها|بلغه|بلغها|اعرض|وضح)(\s|$)/;
const noReplyOrder = (t: string) => NO_REPLY_ORDER.test(t) && !ORDER_DO.test(t);
const NOT_A_VISIT_Q = /فيديو|الصور|صور البيت|صور الفيلا|الرابط|الريل|الاعلان|الإعلان/;
// R10 / R20 (8 and 10 Nov): an owner is declined politely (heirs, occupied, mortgaged); this reply always goes out.
// A bare «نعتذر منك» (sorry for the delay) is not a decline.
const DECLINE_RE = /ما\s*(نقدر\s*)?(نستلم|نقبل|نتعامل\s*مع)|(نعتذر|المعذر[هة])[^\n]{0,40}(ورث|مرهون|مسكون|ساكن)|نشتغل\s*في\s*مسقط\s*وبركاء\s*فقط/;
// R56 (Ahmed 14 Nov 2026): the office works in Muscat governorate and wilayat Barka only, because a land or a building must be
// seen on site. An owner (or a broker) who offers a property anywhere else gets these lines, is asked for nothing, and no
// price study is opened (the lines match DECLINE_RE, so R37 closes the offer). The place is read from what the model wrote
// in owner_offer: a wilayat name outside the two, never when a Muscat or Barka name stands beside it. Names that are also
// plain words (نخل، صور، منح…) count only as the whole wilayat field.
// Step F (decision 77, Ahmed 18 Nov 2026): the branch line towards the other number, as the brain (old or new wording), R9 for
// owners or R48 write it, becomes «عقارات {area} يتابعها رقم فرع X {number} وبنرسلك منه» (an owner: «عقارك في {area} يتابعه …»).
// The model's branch_transfer adds the line when it forgot it. Returns the reply and the transfer, or null.
const BRANCH_OLD_RE = /^(هذا العقار|طلبك|عقارك)\s*تتابعه\s*معنا\s*على\s*رقم\s*(مسقط|بركاء)\s*(?:71770030|92344273)?\s*واتساب\s*$/;
const BRANCH_NEW_RE = /^(عقارات|عقارك)\s*(?:في\s+)?(.*?)\s*يتابع(?:ها|ه)\s*رقم\s*فرع\s*(مسقط|بركاء)\s*(?:71770030|92344273)?\s*وبنرسلك\s*منه\s*$/;
function transferArea(raw: unknown, branch: string) {
  const s = String(raw ?? "").replace(/[^ء-ي0-9A-Za-z ]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40).trim();
  return s && !/^(غير محدد|اي مكان|أي مكان|null)$/.test(s) ? s : branch;
}
function branchTransferLines(out: any, here: unknown, prop: any, branchOf: (k: any) => { name: string; number: string } | null) {
  if (!["muscat", "barka"].includes(String(here))) return null;
  // R9 (reply audit 22 Nov, علي من الأحواز f0b8d16b): the investor line already sends him to Muscat; the model's branch_transfer
  // added «عقارات سلطنة عمان يتابعها رقم فرع مسقط …» under it. The investor line stays alone (decision 77).
  if ((out.reply_messages || []).some((t) => /الاستثمار والمشاريع\s*تتابعها\s*معنا\s*على\s*رقم\s*مسقط/.test(String(t)))) return null;
  const hit: { to: string; area: string }[] = [];
  const req: string[] = out.request && Array.isArray(out.request.areas) ? out.request.areas : [];
  const make = (to: string, owner: boolean, named: unknown) => {
    const b = branchOf(to)!;
    const area = transferArea((out.branch_transfer?.to === to ? out.branch_transfer.area : "") || named || (prop?.branch_key === to ? prop.area : "")
      || (owner ? out.owner_offer?.area || out.owner_offer?.wilayat : "") || req[0] || out.area, b.name);
    hit.push({ to, area });
    if (owner) return area === b.name ? `عقارك يتابعه رقم فرع ${b.name} ${b.number} وبنرسلك منه` : `عقارك في ${area} يتابعه رقم فرع ${b.name} ${b.number} وبنرسلك منه`;
    return `عقارات ${area} يتابعها رقم فرع ${b.name} ${b.number} وبنرسلك منه`;
  };
  let lines = (out.reply_messages || []).map((t: any) => {
    const s = String(t).trim();
    const o = BRANCH_OLD_RE.exec(s), n = o ? null : BRANCH_NEW_RE.exec(s);
    if (!o && !n) return t;
    const to = (o ? o[2] : n![3]) === "مسقط" ? "muscat" : "barka";
    return to === here ? t : make(to, (o ? o[1] : n![1]) === "عقارك", n ? n[2] : "");
  });
  const bt = out.branch_transfer;
  if (!hit.length && bt && ["muscat", "barka"].includes(bt.to) && bt.to !== here) lines = [...lines.slice(0, 2), make(bt.to, out.category === "seller", "")];
  return hit.length ? { lines, ...hit[hit.length - 1] } : null;
}
const OUT_OF_AREA_LINES = ["نعتذر منك احنا حالياً نشتغل في مسقط وبركاء فقط", "اذا عندك عقار في مسقط ارسله على رقم مسقط 71770030 واذا في بركاء على رقم بركاء 92344273"];
const OUT_OF_AREA_SAID = /نشتغل\s*في\s*مسقط\s*وبركاء\s*فقط/;
const areaNorm = (s: unknown) => String(s ?? "").replace(/[ً-ٰٟـ]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[^ء-ي\s]/g, " ").replace(/\s+/g, " ").trim();
const IN_AREA = /(^| )(ال)?(بركاء|بركا|بركه|مسقط|سيب|بوشر|مطرح|عامرات|قريات|حيل|خوض|معبيله|موالح|خوير|غبره|عذيبه|قرم|انصب|سيفه|يتي|روي|وطيه)( |$)|مدينه السلطان/;
const OUT_AREA = /(^| )(ال)?(صلاله|ظفار|مرباط|ثمريت|مسندم|خصب|بريمي|نزوي|بهلاء|بهلا|ازكي|سمائل|سمايل|بدبد|جبل الاخضر|صحار|شناص|صحم|خابوره|سويق|رستاق|عوابي|وادي المعاول|وادي المعلول|مصنعه|جعلان|ابراء|مضيبي|سناو|عبري|دقم|هيماء)( |$)/;
const OUT_WILAYAT = ["طاقه", "رخيوت", "ضلكوت", "مزيونه", "مقشن", "شليم", "سدح", "دبا", "بخا", "مدحاء", "محضه", "سنينه", "منح", "حمراء", "ادم", "لوي", "نخل", "صور", "كامل", "كامل والوافي", "مصيره", "ابرا", "بديه", "قابل", "وادي بني خالد", "دماء والطائيين", "ينقل", "ضنك", "هيما", "محوت", "جازر", "داخليه", "شرقيه", "ظاهره", "وسطي", "شمال الباطنه"];
function outsideArea(area: unknown, wilayat: unknown) {
  const all = areaNorm(`${area || ""} ${wilayat || ""}`);
  if (!all || IN_AREA.test(all)) return "";
  const m = all.match(OUT_AREA);
  if (m) return m[3];
  const w = areaNorm(wilayat).replace(/^(ولايه|محافظه) /, "").replace(/^ال/, "");
  return OUT_WILAYAT.includes(w) ? w : "";
}
const ALLOWED_ORIGINS = ["https://omanvilla.github.io"]; // the approval screen asks for a rewrite from here

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
// SQL137: the key-box photo is a path in the private bucket property-keys; WhatsApp gets a 10-minute signed URL.
// An old https value still works as it is.
async function lockboxLink(v: unknown): Promise<string> {
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (/^https:\/\//.test(s)) return s;
  if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$/.test(s)) return "";
  const r = await db.storage.from("property-keys").createSignedUrl(s, 600);
  return r.error ? "" : (r.data?.signedUrl || "");
}
// the owner's order not to answer: the waiting draft leaves «ردود تنتظر موافقتك» as rejected, with his words kept
async function closeDraft(draftId: string, analysis: any, instruction: string, by: string | null) {
  const u = await db.from("whatsapp_reply_drafts").update({ status: "rejected", decided_at: new Date().toISOString(), decided_by: by, reply_messages: [],
    approver_note: `أمر المدير: ${instruction}`.slice(0, 500), analysis: { ...(analysis || {}), reply_messages: [], owner_instruction: instruction, closed_by_order: true } })
    .eq("id", draftId).eq("status", "pending").select("id");
  if (!(u.data || []).length) return { ok: false, error: "draft_not_pending" };
  return { ok: true, status: "closed", reply_messages: [] };
}
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
  // links are kept exactly as they are (7 Nov: "https://www instagram com/reel/..." did not open for the customer)
  const urls: string[] = [];
  let s = String(t || "").replace(/\r/g, "").replace(/https?:\/\/[^\s]+/gi, (u) => { urls.push(u.replace(/[.,،]+$/, "")); return `\u0001${urls.length - 1}\u0001`; });
  s = s.replace(/[“”«»"]/g, "").replace(/\s*[—–]\s*/g, " ").replace(/!+/g, "");
  s = s.replace(/(\D)\.(\s+|$)/g, "$1\n").replace(/(\D)\.(?=\S)/g, "$1 ");
  s = s.replace(/\s*[،,]\s*(?!\d)/g, " ");
  s = /[؀-ۿ]/.test(s) ? s.replace(/\s*[؟?]/g, " ؟") : s.replace(/\s*[؟?]/g, "?");
  s = s.replace(/[ \t]+/g, " ").split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
  return s.replace(/\u0001(\d+)\u0001/g, (_, i) => urls[Number(i)] || "").trim();
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

// 18 Nov audit (Mody, 10:10): Meta answered 500 #131000 «Something went wrong» (a passing error), the next token got 400
// Authorization Error and the reply was lost. A passing error (5xx, 429, or codes 1, 2, 4, 80007, 130429, 131000, 131016)
// is tried again on the same token after 1.5 s and 4 s before the next token.
const META_PASSING = new Set([1, 2, 4, 80007, 130429, 131000, 131016]);
async function metaSend(tokens: string[], phoneId: string, to: string, payload: any) {
  for (const t of tokens) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await fetch(`https://graph.facebook.com/${GRAPH}/${phoneId}/messages`, {
        method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, ...payload }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) return d?.messages?.[0]?.id || null;
      console.error("[reply-agent] meta", r.status, attempt, JSON.stringify(d).slice(0, 400));
      const passing = r.status >= 500 || r.status === 429 || META_PASSING.has(Number(d?.error?.code));
      if (!passing || attempt === 2) break;
      await new Promise((ok) => setTimeout(ok, attempt === 0 ? 1500 : 4000));
    }
  }
  throw new Error("meta_send_failed");
}

// Voice notes: see ../_shared/voice.ts (full transcribe model + Omani vocabulary + context correction).
async function saveVoice(id: string, v: { text: string; raw: string; model: string; unclear: boolean }) {
  const cur = await db.from("whatsapp_messages").select("automation_result").eq("id", id).maybeSingle();
  const ar = { ...((cur.data as any)?.automation_result || {}), voice: { raw: v.raw, model: v.model, unclear: v.unclear, at: new Date().toISOString() } };
  await db.from("whatsapp_messages").update({ transcript: v.text, transcription_status: "completed", automation_result: ar }).eq("id", id);
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

// Facebook (11 Nov 2026, Ahmed): properties are posted on the Facebook page and customers send its links, mostly
// «facebook.com/share/r|v/...». Same keys as normalize_property_marketing_link (SQL80).
const FB_URL_RE = /https?:\/\/(?:www\.|m\.|web\.|business\.)?(?:facebook\.com|fb\.com|fb\.watch)\/[^\s<>"']+/gi;
const FB_HOSTS = new Set(["facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com", "business.facebook.com", "fb.com", "www.fb.com", "fb.watch", "www.fb.watch"]);
export function facebookKeyOf(url: string): string {
  const u = String(url || "").trim().replace(/&amp;/g, "&").replace(/[\])}>,.;!؟،]+$/, "");
  const host = "^(?:https?:\\/\\/)?(?:www\\.|m\\.|web\\.|business\\.)?(?:facebook|fb)\\.com";
  const tries: [RegExp, string][] = [
    [new RegExp(host + "\\/reel\\/([0-9]+)(?:[\\/?#]|$)", "i"), "facebook:"],
    [new RegExp(host + "\\/[^\\/?#]+\\/videos\\/(?:[^\\/?#]+\\/)?([0-9]+)(?:[\\/?#]|$)", "i"), "facebook:"],
    [new RegExp(host + "\\/watch\\/?\\?[^#]*\\bv=([0-9]+)", "i"), "facebook:"],
    [new RegExp(host + "\\/[^\\/?#]+\\/posts\\/([A-Za-z0-9]+)(?:[\\/?#]|$)", "i"), "facebook:"],
    [new RegExp(host + "\\/(?:permalink|story)\\.php\\?[^#]*\\bstory_fbid=([A-Za-z0-9]+)", "i"), "facebook:"],
    [new RegExp(host + "\\/share\\/(?:[a-z]\\/)?([A-Za-z0-9_-]+)(?:[\\/?#]|$)", "i"), "facebook-share:"],
    [/^(?:https?:\/\/)?(?:www\.)?fb\.watch\/([A-Za-z0-9_-]+)(?:[\/?#]|$)/i, "facebook-share:"],
  ];
  for (const [re, prefix] of tries) { const m = u.match(re); if (m) return prefix + m[1]; }
  return "";
}
const decodeHtml = (s: string) => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#([0-9]+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
// Opens a Facebook link (fixed Facebook hosts only, at most 4 redirects) and reads the real video/post id and the
// public post text. Nothing is sent or posted. Returns null when the page cannot be read.
export async function readFacebookLink(url: string, fetcher: typeof fetch = fetch) {
  let current = url, key = facebookKeyOf(url), html = "";
  for (let hop = 0; hop < 5; hop++) {
    let host = "";
    try { host = new URL(current).hostname.toLowerCase(); } catch { return null; }
    if (!FB_HOSTS.has(host)) return null;
    const r = await fetcher(current, { redirect: "manual", headers: { "User-Agent": "facebookexternalhit/1.1", "Accept-Language": "ar,en" }, signal: AbortSignal.timeout(7000) });
    const loc = r.headers.get("location");
    if (r.status >= 300 && r.status < 400 && loc) {
      current = new URL(loc, current).toString();
      const k = facebookKeyOf(current); if (k.startsWith("facebook:")) key = k;
      continue;
    }
    if (!r.ok) return null;
    html = (await r.text()).slice(0, 900000);
    break;
  }
  const meta = (name: string) => decodeHtml((html.match(new RegExp(`<meta[^>]+property="${name}"[^>]+content="([^"]*)"`, "i")) || html.match(new RegExp(`<meta[^>]+content="([^"]*)"[^>]+property="${name}"`, "i")) || [])[1] || "");
  const canonical = decodeHtml((html.match(/<link rel="canonical" href="([^"]+)"/i) || [])[1] || "") || meta("og:url");
  const k2 = facebookKeyOf(canonical); if (k2.startsWith("facebook:")) key = k2;
  const page = (canonical.match(/(?:facebook|fb)\.com\/([0-9]{6,})\//i) || [])[1] || null;
  const caption = meta("og:description").slice(0, 2000);
  if (!key.startsWith("facebook:") && !caption) return null;
  return { resolved_key: key.startsWith("facebook:") ? key : null, page_id: page, caption: caption || null };
}

const NAME_NOT_GIVEN = "ما ذكر اسمه، الاسم المسجل من الواتساب مو اسمه الحقيقي";
const schema = {
  type: "object", additionalProperties: false,
  properties: {
    reply_messages: { type: "array", items: { type: "string" } },
    category: { type: "string", enum: ["buyer", "tenant", "investor", "seller", "general", "broker", "active_deal", "unclear", "ignore"] },
    ignore_kind: { type: ["string", "null"], enum: ["job", "broker_signup", "foreign_broker", "bank", "service", "contest", "not_real_estate", null] },
    source: { type: "string", enum: ["reel", "property_link", "image", "video", "ad", "referral", "direct", "unknown"] },
    intent: { type: "string" },
    budget_asked_now: { type: "boolean" },
    budget: { type: ["string", "null"] },
    area: { type: ["string", "null"] },
    property_id: { type: ["string", "null"] },
    action: { type: "string", enum: ["none", "send_location", "send_owner_number", "send_lockbox", "book_viewing", "book_meeting", "handoff"] },
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
        // R46 (Ahmed 14 Nov): how we get in when Ahmed comes to inspect (open / key in a lockbox / the owner or someone opens)
        visit_method: { type: ["string", "null"], enum: ["open", "lockbox", "office", null] }, visit_instructions: { type: ["string", "null"] },
        // SQL101 (Ahmed 14 Nov): the owner's answer about electricity and water, asked once with the key question
        electricity: { type: ["string", "null"], enum: ["yes", "no", null] }, water: { type: ["string", "null"], enum: ["yes", "no", null] },
      },
      required: ["kind", "area", "wilayat", "price", "land_size", "built_size", "visit_method", "visit_instructions", "electricity", "water"],
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
    // R22 (Ahmed 10 Nov): how serious the client is, judged every turn from his history and this chat
    seriousness: { type: "string", enum: ["strong", "possible", "weak", "unknown"] },
    seriousness_reason: { type: "string" },
    // R19 (Ahmed 10 Nov): the meeting the client fixed (office in Mawaleh, online, or the developer's office)
    meeting: { anyOf: [{ type: "null" }, {
      type: "object", additionalProperties: false,
      properties: {
        place: { type: "string", enum: ["office", "online", "developer", "dar_global", "project_tbd"] },
        date: { type: ["string", "null"] },
        time: { type: ["string", "null"] },
      },
      required: ["place", "date", "time"],
    }] },
    // R31 (Ahmed 11 Nov): the client asked about «المستحقين» units (stopped for now) and goes on the waiting list
    mustahiq_waitlist: { type: "boolean" },
    // step F (decision 77, Ahmed 18 Nov): the client wrote to the wrong branch number about the other branch's area; the right
    // number messages him (whatsapp-outreach kind branch_transfer, SQL140)
    branch_transfer: { anyOf: [{ type: "null" }, {
      type: "object", additionalProperties: false,
      properties: { to: { type: "string", enum: ["muscat", "barka"] }, area: { type: "string" } },
      required: ["to", "area"],
    }] },
  },
  required: ["reply_messages", "category", "ignore_kind", "source", "intent", "budget_asked_now", "budget", "area", "property_id", "action", "viewing_date", "viewing_time", "handoff_reason", "crm_note", "matched_rule_id", "alternatives", "close_other_branch", "owner_offer", "request", "seriousness", "seriousness_reason", "meeting", "branch_transfer", "client_name_stated", "name_declined", "mustahiq_waitlist"],
};

// The marketing text (property description, or the longest reel caption for it) is what the office
// sends customers as "the details"; links and phone numbers are taken out because the agent
// must not write links and the location goes through send_location.
function publicText(v: unknown) {
  return String(v ?? "").replace(/https?:\/\/\S+/gi, "").replace(/\+?968[\s-]?\d{8}|\b[79]\d{7}\b/g, "")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n")
    // reel calls to action ("ارسل كلمة صومحان على الواتساب"، "علق"، "تابعنا") are for Instagram, not for a customer already on WhatsApp
    .split("\n").filter((l) => !CTA_RE.test(l))
    // R117 (reply audit 19 Nov, Blessed da239273): a reel caption went out with «راسلني واتساب على وأرد عليك على طول» (number
    // taken out), «اللي يسبق يختار» and «تبي الموقع أو التفاصيل كاملة أو ترتيب معاينة؟». Those sentences are dropped from the line,
    // the description stays.
    .map((l) => l.split(/(?<=[.؟?!])\s+/).filter((s) => !AD_PITCH_RE.test(s)).join(" ").trim()).filter(Boolean)
    .join("\n").replace(/#\S+/g, "").trim();
}
const AD_PITCH_RE = /راسل(ني|نا)|كلم(ني|نا)|واتس\s*اب|وارد\s*عليك|وأرد\s*عليك|يسبق\s*يختار|تبي\s*الموقع\s*(أو|او)|ترتيب\s*معاينة|لا\s*تفوت|سارع|العرض\s*لفترة/;
const CTA_RE = /(^|[\s،.:-])(ارسل|أرسل|ارسلوا|أرسلوا|اكتب|اكتبوا|ابعث|علق|علّق|كومنت|تابعنا|تابعونا|اضغط|للتواصل|التواصل|تواصل|تواصلوا)(?=$|[\s،.:])|الرابط في|البايو|في الخاص|\b(dm|comment|follow)\b/i;

// Internal type codes never reach the client (twin_villa went out in follow-ups, 7 Nov). Known codes become Arabic.
const TYPE_AR: Record<string, string> = { house: "بيت", villa: "فيلا", twin_villa: "فيلا", "twin villa": "فيلا", apartment: "شقة", flat: "شقة", land: "أرض", land_residential: "أرض سكنية", land_commercial: "أرض تجارية", land_mixed: "أرض", building: "بناية", commercial_building: "مبنى تجاري", residential_building: "مبنى سكني", income_property: "عقار مؤجر", shop: "محل", office: "مكتب", farm: "مزرعة", chalet: "شاليه", resthouse: "استراحة", townhouse: "تاون هاوس", penthouse: "بنتهاوس", warehouse: "مخزن" };
const typeAr = (t: unknown) => TYPE_AR[String(t || "").toLowerCase()] || (/[a-z]/i.test(String(t || "")) || !t ? "عقار" : String(t));
function arabicOnly(s: string): string {
  const t = String(s || "");
  // 10 Nov: this text is now really sent. An English reply to an English-speaking client stays English ("see the apartment first"),
  // and links stay exactly as they are (a reel code or a map link can hold "-land-" or "villa")
  if (!/[؀-ۿ]/.test(t)) return t;
  return t.split(/(https?:\/\/\S+)/i).map((part, i) => (i % 2 ? part : arabicWords(part))).join("");
}
function arabicWords(s: string): string {
  let x = s.replace(/\btwin[\s_-]*villa\b/gi, "فيلا");
  for (const [k, v] of Object.entries(TYPE_AR)) x = x.replace(new RegExp(`\\b${k.replace(/_/g, "[\\s_]")}\\b`, "gi"), v);
  return x.replace(/(فيلا\s+){2,}/g, "فيلا ");
}
// Contract A (10 Nov): property_archive_reasons labels. Only withdrawn / not_available rows reach the agent's "no longer available" list.
const ARCHIVE_REASON_AR: Record<string, string> = { contract_expired: "انتهى عقد التسويق", owner_withdrew: "المالك سحب العقار", sold_by_owner: "المالك باعه بنفسه أو عن طريق غيرنا", sold_by_us: "انباع عن طريقنا", rented: "انأجر", duplicate: "سجل مكرر", test_record: "سجل تجريبي أو خطأ إدخال", other: "سبب آخر", unrecorded: "سبب الأرشفة غير مسجل" };
const DEAL_STAGE_AR: Record<string, string> = { new: "جديدة", viewing_scheduled: "موعد زيارة", viewing_no_show: "ما حضر الزيارة", viewing_cancelled: "الزيارة انلغت", viewing_postponed: "الزيارة تأجلت", visit: "زار العقار", negotiation: "تفاوض", deposit: "عربون", awaiting_finance: "ينتظر التمويل", finance_approved: "التمويل انوافق", awaiting_clearance: "ينتظر المخالصة", ownership_transfer: "نقل الملكية" };
// A reply that names a developer project waits for the owner, whatever the category (7 Nov: Wadi Zaha and AIDA prices went out on their own).
let projectRe: { at: number; re: RegExp | null } = { at: 0, re: null };
async function mentionsProject(companyId: string, texts: string[]): Promise<boolean> {
  if (Date.now() - projectRe.at > 300000) {
    const r = await db.from("investment_projects").select("name,aliases").eq("company_id", companyId).eq("archived", false);
    const words = [...new Set((r.data || []).flatMap((p: any) => [p.name, ...(p.aliases || [])]).map((w: any) => String(w || "").trim()).filter((w: string) => w.length > 2)), "وادي زها", "الايكونيك", "الآيكونيك", "AIDA", "عايدة", "اليزن"].map((w) => String(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    projectRe = { at: Date.now(), re: words.length ? new RegExp(words.join("|"), "i") : null };
  }
  return !!projectRe.re && texts.some((x) => projectRe.re!.test(x));
}

// Office titles carry owner names ("فيلا الرميس 59 سلطان"), so the agent only sees a neutral label.
function propLine(p: any) {
  const name = `${typeAr(p.type)} ${p.listing_purpose === "rent" ? "للإيجار" : "للبيع"}`;
  const bits = [p.area, p.wilayat, p.price ? `${p.listing_purpose === "rent" ? "الإيجار " : ""}${Number(p.price).toLocaleString("en-US")} ريال` : "", p.bedrooms ? `${p.bedrooms} غرف` : "",
    p.land_size ? `أرض ${p.land_size}م` : "", p.built_size ? `بناء ${p.built_size}م` : ""].filter(Boolean).join("، ");
  const visit = { open: "مفتوح ويروح بروحه", lockbox: "صندوق مفتاح برمز", owner_lives: "المالك ساكن (يعطى رقم المالك)", office: "تنسيق منا (handoff)" }[p.visit_method as string] || "غير محدد (handoff للمعاينة)";
  const TERMS: Record<string, string> = { daily: "يومي", weekly: "أسبوعي", monthly: "شهري", "3m": "3 شهور", "6m": "6 شهور", yearly: "سنة" };
  const terms = p.listing_purpose === "rent" ? ` | مدة الإيجار المسموحة: ${(p.rental_terms || []).length ? (p.rental_terms as string[]).map((t) => TERMS[t] || t).join(" او ") : "غير محددة (handoff اذا سأل عن مدة قصيرة)"}` : "";
  const rented = p.rented_units ? ` | المؤجر حالياً: ${p.rented_units}` : "";
  // R42 (Ahmed 12 Nov): a fixed price is answered after the visit; negotiable or not set goes to Ahmed (R16)
  const nego = p.listing_purpose === "rent" ? "" : p.price_negotiable === "fixed" ? " | السعر: ثابت" : p.price_negotiable === "negotiable" ? " | السعر: قابل للتفاوض" : " | السعر: ما حدده أحمد";
  // SQL101 / R52 (Ahmed 14 Nov): electricity and water, said only when the office or the owner recorded them
  const util = `${p.electricity_connected === "yes" ? " | الكهرباء: موصلة" : p.electricity_connected === "no" ? " | الكهرباء: غير موصلة" : ""}${p.water_connected === "yes" ? " | الماء: موصل" : p.water_connected === "no" ? " | الماء: غير موصل" : ""}${p.utilities_note ? ` | الماي والكهرباء (جواب أحمد): ${String(p.utilities_note).replace(/\s+/g, " ").slice(0, 200)}` : ""}`;
  return `- id=${p.id} | ${name} | ${bits}${terms}${rented}${nego}${util} | الزيارة: ${visit}${p.visit_instructions ? ` (${p.visit_instructions})` : ""}${p.map_url ? " | اللوكيشن متوفر (action=send_location)" : " | اللوكيشن غير متوفر"} | الفرع: ${p.branch_key === "muscat" ? "مسقط (رقم 71770030)" : p.branch_key === "barka" ? "بركاء (رقم 92344273)" : "غير محدد"}${p.video ? ` | رابط الفيديو (ترسله إذا طلب فيديو): ${p.video}` : ""}${p.public_details ? `\n  تفاصيل: ${short(p.public_details, 500).replace(/\n+/g, " / ")}` : ""}${p.marketing ? `\n  وصف الإعلان: ${short(p.marketing, 1600)}` : ""}`;
}
// The same neutral label (type, area, price) for visits, deals and properties no longer available: never the office title
function neutralLabel(p: any) {
  if (!p) return "عقار";
  return [`${typeAr(p.type)} ${p.listing_purpose === "rent" ? "للإيجار" : "للبيع"}`, [p.area, p.wilayat].filter(Boolean).join("، "),
    p.price ? `${Number(p.price).toLocaleString("en-US")} ريال` : ""].filter(Boolean).join(" | ");
}

async function notifyHandoff(companyId: string, conv: any, client: any, reason: string, toOwner = false) {
  try {
    // 10 Nov: a booked meeting (R19) is Ahmed's own step, so it goes to the active owner whoever holds the chat (Barka chats sit
    // with the Barka agent). Any other handoff goes to the chat's assignee only while that account is active (352 chats still sit
    // on a retired account), otherwise to the owner
    let userId = toOwner ? null : (conv.assigned_to || null);
    if (userId) {
      const a = await db.from("profiles").select("is_active").eq("id", userId).eq("company_id", companyId).maybeSingle();
      if (a.data?.is_active !== true) userId = null;
    }
    if (!userId) {
      const o = await db.from("profiles").select("id").eq("company_id", companyId).eq("role", "owner").eq("is_active", true).limit(1).maybeSingle();
      userId = o.data?.id || null;
    }
    if (!userId) return;
    await db.from("notifications").insert({
      user_id: userId, type: "whatsapp_handoff", is_read: false, client_id: client.id, link: "whatsapp",
      title: `${/^طلب اتصال/.test(reason) ? "📞 طلب اتصال" : /^(مشتري جاد|تفاوض)/.test(reason) ? "🔥 مشتري جاد" : /^اجتماع/.test(reason) ? "📅 اجتماع" : "محادثة تحتاجك"}: ${client.name || conv.customer_name || client.phone || "عميل"}`,
      body: short(reason, 400),
    });
  } catch (e) { console.error("[reply-agent] notify", String((e as any)?.message || e)); }
}

// Visit watch: most visits are agreed in chats a person is handling, where the agent stays quiet, so visits are
// read from the conversation on their own path instead of depending on the reply. A location request or
// "I may pass by" is interest, not a visit. Manual visits are never moved or cancelled from here.
const VISIT_HINT = /زيار|زور|معاين|اشوف|أشوف|بشوف|نشوف|شفت|شفنا|زرت|زرنا|بمر|بجي|بوصل|رحت|رحنا|موعد|اليوم|بكره|بكرة|باكر|عصر|الصبح|صباح|ظهر|المغرب|الليل|الساعة|الساعه|السبت|الأحد|الاحد|الاثنين|الثلاثاء|الاربعاء|الأربعاء|الخميس|الجمعة|الجمعه|نخليها|خلها|أجل|اجل|تأجيل|تاجيل|نغير|تغيير|ما اقدر|ما أقدر|ما بقدر|ما بجي|ما بيجي|الغي|ألغي|الحين|الان|الآن|بروح|اروح|بنروح|بزور|نزور|طالع|وصلت|وصلنا|visit|view|tomorrow|today|now/i;
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
    db.from("properties").select("id,type,area,price,bedrooms,land_size,listing_purpose,branch_key").eq("company_id", msg.company_id).in("status", ["available", "reserved"]).eq("archived", false),
    db.from("viewings").select("id,property_id,viewing_date,viewing_time,status,created_via,notes").eq("client_id", msg.client_id).eq("archived", false).in("status", ["scheduled", "confirmed", "postponed"]),
  ]);
  const props = propsR.data || [];
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Muscat" }).format(new Date());
  const input = [`تاريخ اليوم: ${today}`, "", "العقارات:",
    props.map((p: any) => `- id=${p.id} | ${typeAr(p.type)} ${p.listing_purpose === "rent" ? "للإيجار" : "للبيع"} | ${p.area} | ${Number(p.price || 0).toLocaleString("en-US")} | ${p.bedrooms || "?"} غرف | أرض ${p.land_size || "?"}م`).join("\n"),
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
  // R84: a visit saved with no hour said carries «(الساعة ما تحددت)» in its note until the client says one (the confirmation then names no hour)
  const addNote = () => [time ? String(open?.notes || "").replace(/ ?\(الساعة ما تحددت\)/g, "") : open?.notes, short(out.note, 500)].filter(Boolean).join("\n").slice(0, 1000);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(out.date || "") ? out.date : (open?.viewing_date || null);
  // "الحين" / "طالع" / "بروح الحين" (8 Nov, Ahmed): the visit is now, so it is recorded at the current Muscat time, not a guessed 16:00
  // (17 Nov, e06229f1 «أنا موجود جنب الفيلا… إذا تأذن لي إني أدخل»: saved at 16:00 with «الساعة ما تحددت», so the opinion
  // question went 5 minutes later while he was inside. Standing by the property is now too.)
  const immediate = /(الحين|الان|الآن|طالع|وصلت|وصلنا|(موجود|واقف)\s*(حالياً|حاليا)?\s*(جنب|عند|قدام)|جالس\s*[اأ]شوف)/.test(lastIn) && !/بكر|باكر|العصر|الصبح|المغرب|الظهر/.test(lastIn);
  const nowHM = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Muscat", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(out.time || "") ? out.time : (out.event === "agreed" && immediate ? nowHM : null);
  const provenance = { created_via: "whatsapp_ai", source_whatsapp_message_id: msg.id, auto_confidence: out.confidence };
  let w: any = null;
  if (out.event === "agreed") {
    if ((!prop && !open) || !date || date < today) return { ...out, applied: false, why: "no_property_or_date" };
    if (open) {
      // owner's decision, 6 Nov: any change the client makes is saved at once, whoever recorded the visit
      if (open.status !== "postponed" && open.viewing_date === date && (!time || open.viewing_time?.slice(0, 5) === time)) return { ...out, applied: false, why: "already_recorded" };
      w = await db.from("viewings").update({ viewing_date: date, viewing_time: time || open.viewing_time, status: "scheduled", notes: addNote() }).eq("id", open.id);
    } else {
      // R48: no new visit is booked from a chat on the other branch's number (the customer is sent to that number instead)
      if (["muscat", "barka"].includes(String(prop.branch_key))) {
        const cv = await db.from("whatsapp_conversations").select("route_key").eq("id", msg.conversation_id).maybeSingle();
        if (["muscat", "barka"].includes(String(cv.data?.route_key)) && cv.data!.route_key !== prop.branch_key) return { ...out, applied: false, why: "other_branch" };
      }
      w = await db.from("viewings").insert({ company_id: msg.company_id, client_id: msg.client_id, property_id: prop.id, viewing_date: date, viewing_time: time || "16:00", duration_minutes: 30, status: "scheduled", notes: short(`${out.note || ""}${time ? "" : " (الساعة ما تحددت)"}`, 1000), ...provenance });
    }
  } else if (out.event === "done") {
    if (open) w = await db.from("viewings").update({ status: "done" }).eq("id", open.id);
    else if (prop) {
      // one real visit, one done viewing (Ahmed 10 Nov): "زرته" said again a few minutes later inserted 3 done viewings and a second deal card (7 Nov)
      const since14 = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Muscat" }).format(new Date(Date.now() - 14 * 86400000));
      const seen = await db.from("viewings").select("id").eq("client_id", msg.client_id).eq("property_id", prop.id).eq("archived", false).eq("status", "done").gte("viewing_date", since14).limit(1);
      if (seen.error) throw new Error(seen.error.message);
      if ((seen.data || []).length) return { ...out, applied: false, why: "already_recorded" };
      w = await db.from("viewings").insert({ company_id: msg.company_id, client_id: msg.client_id, property_id: prop.id, viewing_date: date && date <= today ? date : today, viewing_time: time, duration_minutes: 30, status: "done", notes: short(out.note, 1000), ...provenance });
    }
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
  // the dry-run copy (whatsapp-reply-agent-dryrun) runs this same code: it can never send, even when the body leaves out dry_run (10 Nov)
  let forcedDry = false;
  try { forcedDry = new URL(req.url).pathname.includes("reply-agent-dryrun"); } catch (_) { forcedDry = String(req.url || "").includes("reply-agent-dryrun"); }
  // review only: never sends, never touches the CRM. An inline request is always a dry run, even when dry_run is left out
  let dry = body?.dry_run === true || body?.inline === true || forcedDry;
  // redo: the owner, from the approval screen, asks for a waiting draft to be rewritten following
  // their instruction ("ارسل له تفاصيل العقار"). The new reply replaces the draft and still waits for approval.
  let redo: { draftId: string; instruction: string; by: string } | null = null;
  // resume (11 Nov, Ahmed): «كمّل يا عقل» on a paused chat. The agent reads the whole chat again and answers the customer's
  // last message now, if nobody answered it; when it still cannot, the chat comes back to Ahmed with the reason.
  let resume = false;
  const resumeTarget = async (companyId: string | null, conversationId: string) => {
    let q = db.from("whatsapp_messages").select("id,company_id").eq("conversation_id", conversationId).eq("direction", "inbound")
      .order("message_timestamp", { ascending: false }).order("created_at", { ascending: false }).limit(1);
    if (companyId) q = q.eq("company_id", companyId);
    const r = await q.maybeSingle();
    return r.data?.id || null;
  };
  const secret = req.headers.get("x-crm-agent") || "";
  const ok = secret ? await db.rpc("crm_reply_agent_secret_ok", { p_secret: secret }) : null;
  if (ok && !ok.error && ok.data === true && body?.resume === true && body?.conversation_id && !dry) {
    resume = true; message_id = await resumeTarget(null, String(body.conversation_id));
  } else if (!ok || ok.error || ok.data !== true) {
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const u = jwt ? await db.auth.getUser(jwt) : null;
    const prof = u?.data?.user ? await db.from("profiles").select("id,company_id,role,is_active").eq("id", u.data.user.id).maybeSingle() : null;
    // 11 Nov (Ahmed): staff (manager, agent) may «كمّل يا عقل» too; every other caller action stays owner-only. Never on the
    // owner's private line, and a «دراسة سعر» chat stays with Ahmed (R26; whatsapp-inbox clears the hold first and checks it).
    const staffResume = !!prof?.data && ["manager", "agent"].includes(prof.data.role) && prof.data.is_active !== false
      && body?.resume === true && !!body?.conversation_id && !dry;
    if (staffResume) {
      const c = await db.from("whatsapp_conversations").select("route_key").eq("id", String(body.conversation_id)).eq("company_id", prof!.data.company_id).maybeSingle();
      if (!c.data || c.data.route_key === "owner") return json({ ok: false, error: "owner_only" }, 403);
    }
    if (!prof?.data || (prof.data.role !== "owner" && !staffResume) || prof.data.is_active === false) return json({ ok: false, error: "owner_only" }, 403);
    if (body?.resume === true && body?.conversation_id && !dry) {
      resume = true; message_id = await resumeTarget(prof.data.company_id, String(body.conversation_id));
      if (!message_id) return json({ ok: true, ignored: "nothing_to_answer" });
    } else {
    const instruction = short(body?.instruction, 1000);
    if (!body?.draft_id || !instruction) return json({ ok: false, error: "instruction_required" }, 400);
    const d = await db.from("whatsapp_reply_drafts").select("id,message_id,status,analysis").eq("id", String(body.draft_id)).eq("company_id", prof.data.company_id).maybeSingle();
    if (!d.data) return json({ ok: false, error: "draft_not_found" }, 404);
    if (d.data.status !== "pending") return json({ ok: false, error: "draft_not_pending" }, 409);
    // 14 Nov (Ahmed, three times on one draft): an order not to answer closes the draft at once, with no new reply
    if (noReplyOrder(instruction)) return json(await closeDraft(d.data.id, d.data.analysis, instruction, prof.data.id));
    redo = { draftId: d.data.id, instruction, by: prof.data.id };
    message_id = d.data.message_id;
    dry = forcedDry || d.data.analysis?.dry_run === true;
    }
  }
  if (!message_id) return json({ ok: false, error: "message_id_required" }, 400);
  // inline dry run (10 Nov): {dry_run:true, inline:true, message_id, brain_sha?} claims no draft and writes nothing (reads only), so it
  // also works on a message that already has a real draft; the answer comes back in the HTTP response
  const inline = !redo && dry && body?.inline === true;

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
  if (!review && !resume) await sleep(DEBOUNCE_MS);
  const latest = await db.from("whatsapp_messages").select("id").eq("conversation_id", msg.conversation_id).eq("direction", "inbound")
    .order("message_timestamp", { ascending: false }).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!review && latest.data?.id !== msg.id) return json({ ok: true, ignored: "superseded" });
  // a bare greeting is usually followed by the question: give the customer a little longer
  if (!review && !resume) {
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

  let draftId = "";
  if (redo) draftId = redo.draftId;
  else if (resume) {
    // the message already had a run (it was handed to Ahmed): the same draft row is reopened, its earlier outcome kept
    const prev = await db.from("whatsapp_reply_drafts").select("id,status,error,analysis").eq("message_id", msg.id).maybeSingle();
    if (prev.data) {
      if (prev.data.status === "sent") return json({ ok: true, ignored: "already_answered" });
      // (Ahmed's note 22 Nov, أم محمود 74d9f11d: two «كمّل يا عقل» calls 4 seconds apart; the second found the draft «pending» from
      // the first, reopened it again, and both runs sent a reply.) A draft another run holds is left to that run.
      if (["pending", "sending", "approved"].includes(String(prev.data.status))) return json({ ok: true, ignored: "already_processing" });
      const reopened = await db.from("whatsapp_reply_drafts").update({ status: "pending", error: null, analysis: { ...(prev.data.analysis || {}), resumed: { from: prev.data.status, error: prev.data.error, at: new Date().toISOString() } } }).eq("id", prev.data.id).eq("status", prev.data.status).select("id").maybeSingle();
      if (!reopened.data) return json({ ok: true, ignored: "already_processed" });
      draftId = reopened.data.id;
    } else {
      const claim = await db.from("whatsapp_reply_drafts").insert({ company_id: msg.company_id, conversation_id: msg.conversation_id, message_id: msg.id, client_id: msg.client_id, status: "pending", analysis: { resumed: { from: null, at: new Date().toISOString() } } }).select("id").single();
      if (claim.error) return json({ ok: true, ignored: "already_processed" });
      draftId = claim.data.id;
    }
  }
  else if (!inline) {
    const claim = await db.from("whatsapp_reply_drafts").insert({ company_id: msg.company_id, conversation_id: msg.conversation_id, message_id: msg.id, client_id: msg.client_id, status: "pending", analysis: dry ? { dry_run: true } : {} }).select("id").single();
    if (claim.error) return json({ ok: true, ignored: "already_processed" });
    draftId = claim.data.id;
  }
  // a failed rewrite leaves the owner's waiting draft as it was; an inline dry run has no draft to mark
  const fail = async (why: string, status = "skipped") => { if (!redo && !inline) await db.from("whatsapp_reply_drafts").update({ status, error: why }).eq("id", draftId); return json({ ok: !redo, ignored: why, error: redo ? why : undefined, ...(inline ? { inline: true } : {}) }); };

  try {
    const [rtR, convR, clientR, routesR] = await Promise.all([
      db.from("whatsapp_automation_runtime").select("*").eq("company_id", msg.company_id).single(),
      db.from("whatsapp_conversations").select("*").eq("id", msg.conversation_id).single(),
      db.from("clients").select("id,name,phone,phone_normalized,followup_suppressed,notes,budget_min,budget_max,payment_method,purchase_timing").eq("id", msg.client_id).single(),
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
    const hardHandoff = !!conv.human_handoff_required && HARD_HANDOFF.test(String(conv.handoff_reason || ""));
    let silentOwner = false;
    // R89: the client confirmed a meeting or call time the office proposed, in a chat the agent stays out of → Ahmed is told
    // on WhatsApp from this branch number, once per proposal. An inline dry run sends nothing and shows the text.
    const meetingAlert = async (why: string) => {
      try {
        const r = await db.from("whatsapp_messages").select("direction,body,transcript,message_timestamp").eq("conversation_id", conv.id).lte("message_timestamp", msg.message_timestamp).order("message_timestamp", { ascending: false }).limit(8);
        const m = meetingConfirmed((r.data || []).reverse());
        if (!m) return null;
        const text = [`📅 العميل أكّد الموعد · ${conv.route_key === "barka" ? "بركاء" : "مسقط"}`, `الاسم: ${client.name || conv.customer_name || "عميل"}`, `الرقم: +${to}`, `رسالتنا: ${short(m.ours, 200)}`, `رده: ${short(m.said, 80)}`, "العقل ما رد عليه، الموعد عندك"].join("\n");
        if (inline) return json({ ok: true, inline: true, ignored: why, meeting_confirmed_alert: text });
        const key = `meeting_confirmed:${conv.id}:${m.at}`;
        const told = await db.from("whatsapp_automation_events").select("id").eq("company_id", msg.company_id).eq("action_type", "owner_notify").eq("status", "applied").eq("payload->>event_key", key).limit(1);
        if ((told.data || []).length) return null; // «نعم» then «بإذن الله» are two messages: one alert
        await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-owner-hot-alert`, { method: "POST", headers: { "Content-Type": "application/json", "x-crm-agent": secret },
          body: JSON.stringify({ action: "notify_owner", company_id: msg.company_id, route_key: conv.route_key, text, event_key: key }) });
      } catch (e) { console.error("[reply-agent] meeting alert", String((e as any)?.message || e)); }
      return null;
    };
    if (!review && hardHandoff) { await watch(); return (await meetingAlert("human_handoff_open")) || fail("human_handoff_open"); }
    if (!review && client.followup_suppressed) { await watch(); return fail("client_paused"); }

    // R1: Ahmed (or anyone in the office) typed in this chat and has not handed it back → stay out (fails closed).
    // Replaces the 6 Nov rule "carry on 30 seconds after Ahmed answers" that answered Tasnim mid-negotiation.
    // (an inline dry run with check_hold: true goes through the hold too, to test silentOwner; it writes nothing either way)
    if (!review || (inline && body?.check_hold === true)) {
      const hold = await db.rpc("crm_chat_hold", { p_conversation: conv.id });
      if (hold.error) { await watch(); return fail("hold_check_failed"); }
      if (hold.data === "manual_reply") {
        // (Ahmed 22 Nov, عادل العامري 97f4e834: details and papers on 15 Nov while the office was typing, no price study until 22 Nov)
        // An owner's chat the office took is still read, silently, when he may have sent what a price study needs: an open owner
        // lead or a «seller» draft in this chat, and no open «دراسة سعر» task. Nothing is sent; see silentOwner after the model.
        const [lead, sold, task] = await Promise.all([
          db.from("owner_leads").select("id").eq("conversation_id", conv.id).eq("status", "open").limit(1),
          db.from("whatsapp_reply_drafts").select("id").eq("conversation_id", conv.id).eq("analysis->>category", "seller").limit(1),
          db.from("tasks").select("id").eq("client_id", client.id).ilike("title", "دراسة سعر%").eq("done", false).limit(1),
        ]);
        silentOwner = !resume && !redo && ((lead.data || []).length > 0 || (sold.data || []).length > 0) && !(task.data || []).length && !task.error;
        if (!silentOwner) { await watch(); return (await meetingAlert("staff_active")) || fail("staff_active"); }
      }
      if (hold.data === "negotiation") { await watch(); return fail("human_handoff_open"); }
      if (hold.data === "muted") { await watch(); return fail("agent_muted"); }
    }
    // R87 (Ahmed 16 Nov 2026): the staff phoned this number as an owner or an advertiser («سجّل اتصال») and he now writes on
    // WhatsApp, usually to send what she asked for. The agent stays out and the chat goes to the office with the reason, until
    // someone hands it back (a handoff changed after the call) or presses «كمّل يا عقل». Fails open: with no answer from the
    // lookup the agent works as before. An inline dry run writes nothing.
    if (!review && !resume) {
      const called = await db.rpc("crm_staff_called", { p_company: msg.company_id, p_phone: to });
      const call = called.error ? null : called.data;
      const mine = /^\s*اتصال المكتب\s*:/.test(String(conv.handoff_reason || ""));
      if (call?.at && ((conv.human_handoff_required && mine) || new Date(call.at).getTime() > new Date(conv.handoff_updated_at || 0).getTime())) {
        if (!inline && !(conv.human_handoff_required && mine)) {
          const nowC = new Date().toISOString();
          await db.from("whatsapp_conversations").update({ human_handoff_required: true, handoff_updated_at: nowC, updated_at: nowC,
            handoff_reason: `اتصال المكتب: ${call.by || "الموظف"} اتصل على هذا الرقم (${call.kind === "owner" ? "مالك" : "معلن"}${call.name ? `، ${call.name}` : ""}) وهو الحين يرسل على الواتساب. الرد عندكم.` }).eq("id", conv.id);
        }
        await watch(); return fail("staff_called");
      }
    }
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
      db.from("whatsapp_messages").select("id,direction,message_type,body,transcript,media_id,actor_type,message_timestamp,delivery_status,matched_property_id,property_link_key,property_image_analysis,referral:raw_payload->referral")
        .eq("conversation_id", conv.id).lte("message_timestamp", msg.message_timestamp).order("message_timestamp", { ascending: false }).limit(60),
      db.from("properties").select("id,title,internal_name,type,area,wilayat,price,bedrooms,bathrooms,land_size,built_size,listing_purpose,public_details,description,map_url,visit_method,visit_instructions,lockbox_image_url,owner_id,branch_key,rental_terms,rented_units,price_negotiable,electricity_connected,water_connected")
        .eq("company_id", msg.company_id).eq("status", "available").eq("archived", false),
      db.from("whatsapp_reply_rules").select("id,situation,approved_reply,category,auto_send,auto_match_regex").eq("company_id", msg.company_id).eq("active", true).order("created_at", { ascending: false }).limit(40),
      db.from("whatsapp_reply_drafts").select("analysis,status").eq("conversation_id", conv.id).in("status", ["sent", "approved", "edited"]),
    ]);
    // 14 Nov 2026: a message Meta refused (delivery_status failed, e.g. 131042 when the free tier ran out on the Barka number)
    // never reached the customer, so it is not part of the chat the agent reads: otherwise the ad, the name question or the
    // branch line count as already sent and the customer is left without them.
    const history = (histR.data || []).reverse().filter((h: any) => !(h.direction === "outbound" && h.delivery_status === "failed"));
    const props = propsR.data || [];
    // decision 20 (Ahmed 18 Nov 2026): Ahmed's answer about water and electricity is kept on the property (utilities_note, SQL134)
    // so the agent answers it to this client and every one after. Read on its own: before the column exists the error is ignored.
    try {
      const un = props.length ? await db.from("properties").select("id,utilities_note").in("id", props.map((p: any) => p.id)) : null;
      if (un && !un.error) for (const r of (un.data || []) as any[]) { const p: any = props.find((x: any) => x.id === r.id); if (p && r.utilities_note) p.utilities_note = r.utilities_note; }
    } catch (_) { /* no column yet */ }
    // decision 42 (Ahmed 18 Nov 2026: «العقل يبلغه أكيد»): a sold / reserved notice that was skipped because the client wrote
    // after it was queued (kind property_sold, status skipped, reason sold_client_wrote_after, older rows client_wrote_after) is
    // said by the agent in its first reply, while the property is still gone (not in the available list). Then its reason
    // becomes told_by_agent (the status stays skipped: the queue's status check has no other value for it).
    let soldUntold: any[] = [];
    try {
      const sq = await db.from("whatsapp_outreach_queue").select("id,property_id,messages").eq("conversation_id", conv.id).eq("kind", "property_sold")
        .eq("status", "skipped").in("reason", ["sold_client_wrote_after", "client_wrote_after"]).order("created_at", { ascending: false }).limit(5);
      soldUntold = ((sq.data || []) as any[]).filter((r: any) => r.property_id && !props.some((p: any) => p.id === r.property_id)
        && Array.isArray(r.messages) && /انحجز|انباع/.test(String(r.messages[0] || "")));
    } catch (_) { /* the notice queue could not be read: nothing is added */ }
    const soldLine = soldUntold.length ? String(soldUntold[0].messages[0]).trim() : "";
    // R2: the customer's visits, so the agent knows whether a price talk can start (only after a visit).
    // Listed by a neutral label (type, area, price): the office title carries the owner's name (10 Nov)
    const visR = await db.from("viewings").select("property_id,viewing_date,viewing_time,status,properties(type,area,wilayat,price,listing_purpose)").eq("client_id", msg.client_id).eq("archived", false)
      .order("viewing_date", { ascending: false }).limit(20);
    const visits = visR.data || [];
    const visitedIds = new Set<string>(visits.filter((v: any) => v.status === "done" && v.property_id).map((v: any) => v.property_id));
    const VIS_AR: Record<string, string> = { done: "زارها", scheduled: "موعد محجوز", confirmed: "موعد مؤكد", postponed: "تأجلت", cancelled: "انلغت", no_show: "ما حضر" };
    const visitsText = visits.length
      ? visits.map((v: any) => `- ${neutralLabel(v.properties)} | ${v.viewing_date || ""}${v.viewing_time ? ` ${String(v.viewing_time).slice(0, 5)}` : ""} | ${VIS_AR[v.status] || v.status} | property_id=${v.property_id || ""}`).join("\n")
      : "ما في أي زيارة مسجلة لهذا العميل";
    // R16: a booked visit whose day (and hour, when there is one) has passed counts as seen
    const dayM = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Muscat" }).format(new Date());
    const hmM = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Muscat", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
    const visitPassed = (v: any) => ["scheduled", "confirmed"].includes(v.status) && !!v.viewing_date
      && (v.viewing_date < dayM || (v.viewing_date === dayM && !!v.viewing_time && String(v.viewing_time).slice(0, 5) <= hmM));
    // the ad text for each property: its description, or else the longest caption of a reel about it
    const capR = props.length ? await db.from("instagram_media_catalog").select("property_id,caption,permalink,likes,comments").in("property_id", props.map((p: any) => p.id)) : { data: [] };
    // R75: a reel whose note in the marketing journal says «من الداخل» is the property's video of the inside
    const insideR = props.length ? await db.from("property_marketing_events").select("property_id,url").in("property_id", props.map((p: any) => p.id)).ilike("notes", "%من الداخل%").order("published_at", { ascending: false }) : { data: [] };
    for (const p of props as any[]) {
      p.videoInside = (((insideR as any).data || []).find((e: any) => e.property_id === p.id && /^https:\/\/(www\.)?instagram\.com\//.test(String(e.url || ""))) || {}).url || null;
      // the video to send when someone asks for it: the reel of this property that did best
      // (17 Nov: two reels of an available Al Sawmhan unit were re-captioned «تم البيع Sold out … نبارك للشاري» when its sibling
      // sold; one went to a customer as «the video» and the office deleted it. A reel whose caption says sold is never this
      // property's video or ad text.)
      const soldCap = (c: any) => /تم\s*البيع|sold\s*out|نبارك\s*للشاري/i.test(String(c.caption || ""));
      // (Ahmed, same evening: units 1, 2 and 3 of one owner share their reels on purpose, «حتى لو سوينا عليه تم البيع عادي»:
      // the reel still goes for the units left. A reel without «تم البيع» is preferred when there is one; the sold caption
      // text itself is never used as the ad, below.)
      const vids = ((capR as any).data || []).filter((c: any) => c.property_id === p.id && /^https:\/\/(www\.)?instagram\.com\//.test(String(c.permalink || "")))
        .sort((a: any, b: any) => (soldCap(a) ? 1 : 0) - (soldCap(b) ? 1 : 0) || (Number(b.likes || 0) + Number(b.comments || 0)) - (Number(a.likes || 0) + Number(a.comments || 0)));
      p.video = vids[0]?.permalink || null;
      const caps = ((capR as any).data || []).filter((c: any) => c.property_id === p.id && !soldCap(c)).map((c: any) => publicText(c.caption)).sort((a: string, b: string) => b.length - a.length);
      p.marketing = [publicText(p.public_details), publicText(p.description), caps[0] || ""].sort((a: string, b: string) => b.length - a.length)[0] || ""; // the fullest ad text wins
    }
    // 15 Nov 2026 (dry run, three chats): the reel of a group of similar units is saved on one unit, so a photo request about
    // another unit ended as a handoff «ما عندنا رابط فيديو». A unit with no reel uses the reel of its sibling: same owner,
    // area and type, price within 10%.
    for (const p of props as any[]) {
      if (p.video) continue;
      const sib = (props as any[]).find((q: any) => q.video && q.id !== p.id && q.owner_id && q.owner_id === p.owner_id && q.area === p.area && q.type === p.type
        && Math.abs(Number(q.price || 0) - Number(p.price || 0)) <= 0.1 * Number(p.price || 0));
      if (sib) p.video = sib.video;
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
    const pr = await db.from("whatsapp_agent_prompts").select("key,content").in("key", ["brain", "brain_base", "knowledge"]);
    let BRAIN = (pr.data || []).find((x: any) => x.key === "brain")?.content || "";
    let INVESTOR_KNOWLEDGE = (pr.data || []).find((x: any) => x.key === "knowledge")?.content || "";
    // dry run only: try a brain from a repo commit (plus Ahmed's open CRM notes) before it goes live. The same commit's
    // knowledge.ts goes with it (10 Nov): R18's figures live there, and agent-prompt-sync publishes the two files together
    if (dry && /^[0-9a-f]{40}$/.test(String(body?.brain_sha || ""))) {
      const r = await fetch(`https://raw.githubusercontent.com/omanvilla/habib-crm/${body.brain_sha}/supabase/functions/whatsapp-reply-agent/brain.ts`);
      const m = r.ok ? (await r.text()).match(/=\s*`([\s\S]*)`;?\s*$/) : null;
      const base = (pr.data || []).find((x: any) => x.key === "brain_base")?.content || "";
      if (m && m[1].length > 2000) BRAIN = m[1] + (base && BRAIN.startsWith(base) ? BRAIN.slice(base.length) : "");
      const rk = await fetch(`https://raw.githubusercontent.com/omanvilla/habib-crm/${body.brain_sha}/supabase/functions/whatsapp-reply-agent/knowledge.ts`);
      const mk = rk.ok ? (await rk.text()).match(/=\s*`([\s\S]*)`;?\s*$/) : null;
      if (mk && mk[1].length > 1000) INVESTOR_KNOWLEDGE = mk[1];
    }
    // decision 15 (Ahmed 18 Nov 2026: «يوقف لحاله 30 نوفمبر»): the zero-down offer of Sultan Haitham City ends 30 Nov 2026. From
    // 1 Dec its lines (each written on a line of its own in brain.ts and knowledge.ts) leave the prompt, and the reply guard below
    // takes out any line that still names it. The three pinned replies about it are switched off in the CRM on 1 Dec.
    const ZERO_DOWN = /بدون\s*دفع[ةه]\s*مقدم[ةه]|صفر\s*(ال)?مقدم|دفع[ةه]\s*صفر|zero\s*down/i;
    const zeroDownOver = dayM >= "2026-12-01";
    if (zeroDownOver) {
      BRAIN = BRAIN.split("\n").filter((l: string) => !ZERO_DOWN.test(l)).join("\n")
        + "\n- عرض مدينة السلطان هيثم بدون مقدم انتهى 30 نوفمبر 2026: لا تعرضه، واللي يسأل عنه قل إن العرض انتهى وكمل بسطر الاسعار والاجتماع (R18، R19).";
      INVESTOR_KNOWLEDGE = INVESTOR_KNOWLEDGE.split("\n").filter((l: string) => !ZERO_DOWN.test(l)).join("\n");
    }
    if (BRAIN.length < 2000) return fail("prompt_missing", "failed");

    // understand the latest voice notes
    const pendingAudio = history.filter((h: any) => h.direction === "inbound" && h.message_type === "audio" && !h.transcript && h.media_id).slice(-3);
    for (const a of pendingAudio) {
      const ctx = history.filter((h: any) => String(h.message_timestamp) < String(a.message_timestamp)).slice(-8)
        .map((h: any) => `${h.direction === "inbound" ? "العميل" : "المكتب"}: ${short(h.transcript || h.body || `[${h.message_type}]`, 300)}`).join("\n");
      // an inline dry run reads the voice note but keeps neither the transcript nor the audio copy
      const v = await transcribeVoice(tokens, a.media_id, GRAPH, ctx, inline ? undefined : (b, m) => db.storage.from("whatsapp-voice").upload(`${msg.company_id}/${a.media_id}`, b, { contentType: m, upsert: true }));
      if (v) {
        a.transcript = v.unclear ? `${v.text} (الصوت مو واضح كامل)` : v.text;
        if (!inline) await saveVoice(a.id, { ...v, text: a.transcript });
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
    // Facebook links: the key as sent (often a share code), then the real video/post id read from Facebook (cached).
    const fbOf: Record<string, { sent: string; key: string; caption: string | null; page_id: string | null }> = {};
    try {
      const sent: { id: string; url: string; key: string }[] = [];
      for (const h of history) {
        const urls = String(h.body || "").match(FB_URL_RE) || [];
        const ref = String(h.referral?.source_url || "");
        if (ref) urls.push(ref);
        for (const url of urls) { const key = facebookKeyOf(url); if (key) { sent.push({ id: h.id, url, key }); break; } }
      }
      if (sent.length) {
        const keys = [...new Set(sent.map((x) => x.key))];
        const cached = await db.from("facebook_link_cache").select("link_key,resolved_key,page_id,caption,status,fetched_at").in("link_key", keys);
        const cache: Record<string, any> = {};
        for (const c of cached.data || []) cache[c.link_key] = c;
        let reads = 0;
        for (const x of sent) {
          let c = cache[x.key];
          const stale = c && c.status === "unreadable" && Date.now() - Date.parse(c.fetched_at) > 6 * 3600000;
          if ((!c || stale) && reads < 3) {
            reads++;
            const got = await readFacebookLink(x.url).catch(() => null);
            c = got ? { link_key: x.key, ...got, status: "resolved" } : { link_key: x.key, resolved_key: x.key.startsWith("facebook:") ? x.key : null, page_id: null, caption: null, status: "unreadable" };
            cache[x.key] = c;
            if (!inline) await db.from("facebook_link_cache").upsert({ ...c, fetched_at: new Date().toISOString() }); // an inline dry run writes nothing
          }
          const key = c?.resolved_key || x.key;
          fbOf[x.id] = { sent: x.key, key, caption: c?.caption || null, page_id: c?.page_id || null };
          codes.add(key); codes.add(x.key);
        }
      }
    } catch (e) { console.error("[reply-agent] facebook links", String((e as any)?.message || e)); }
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
      // Facebook: a video saved on a property (journal channel facebook) or read from the link
      for (const f of Object.values(fbOf)) if (!reels[f.key]) reels[f.key] = { link_key: f.key, caption: f.caption, property_id: null, state: null, facebook: true };
      for (const e of ev.data || []) if (reels[e.link_key]) (reels[e.link_key].propertyIds ||= []).push(e.property_id);
      // a share link saved on the property as it was copied (facebook-share:...) counts for the video it opens
      for (const f of Object.values(fbOf)) if (f.sent !== f.key) for (const e of ev.data || []) if (e.link_key === f.sent && !(reels[f.key].propertyIds || []).includes(e.property_id)) (reels[f.key].propertyIds ||= []).push(e.property_id);
      for (const f of Object.values(fbOf)) { const r = reels[f.key]; r.facebook = true; if (!r.caption && f.caption) r.caption = f.caption; if (!r.property_id && r.propertyIds?.length === 1) r.property_id = r.propertyIds[0]; }
    }

    // recently sold or booked: the agent must recognise them and answer with the sold rule, never offer them
    let soldList = "";
    let soldRows: any[] = [];
    // R38 (Ahmed 12 Nov 2026, SQL97): a unit that was sold or booked while a unit of its group (same owner, area and kind, near
    // specifications) is still available. The customer hears «انحجزت وحدة منها والمتبقي …» and is shown the remaining unit,
    // never a bare «انباع» and never another alternative. The sentence comes from crm_unit_groups, the same one the notices use.
    let unitGroups: any[] = [];
    try { const ug = await db.rpc("crm_unit_groups", { p_company: msg.company_id }); if (!ug.error && Array.isArray(ug.data)) unitGroups = ug.data; } catch (_) { /* optional */ }
    const groupOf = (id: any) => unitGroups.find((g: any) => g.property_id === id);
    const remainingIds = new Set<string>(unitGroups.flatMap((g: any) => (g.remaining_ids || []) as string[]));
    // the reel of a group is often saved on the units still available, so a customer who sends it is linked to an available
    // unit: that unit carries the same sentence in the available list («من مجموعة انحجزت منها وحدة»)
    const groupOfRemaining = (id: any) => unitGroups.find((g: any) => ((g.remaining_ids || []) as string[]).includes(id));
    try {
      // newest first (8 Nov: with 55 sold rows and no order, a property sold today could miss the 40), archived ones included
      // (a property sold elsewhere is often archived, and its old reels still bring questions)
      const sr = await db.from("properties").select("id,type,area,wilayat,price,status,title,map_url").eq("company_id", msg.company_id).in("status", ["sold", "reserved"])
        .gte("updated_at", new Date(Date.now() - 150 * 86400000).toISOString()).order("updated_at", { ascending: false }).limit(40);
      soldRows = sr.data || [];
      soldList = (sr.data || []).map((p: any) => `- ${typeAr(p.type)} | ${[p.area, p.wilayat].filter(Boolean).join("، ")} | ${p.price ? Number(p.price).toLocaleString("en-US") + " ريال" : ""} | ${p.status === "sold" ? "انباع" : "انحجز"}${groupOf(p.id) ? ` | وحدة من مجموعة: ${groupOf(p.id).line} | المتبقي متاح: ${(groupOf(p.id).remaining_ids || []).join(" و ")}` : ""}`).join("\n");
    } catch (_) { /* optional */ }
    // R24 (Ahmed 10 Nov): archived but not sold (withdrawn, contract ended, rented...) in the last 150 days: "ما متوفر حالياً", never "انباع".
    // Duplicate and test records are left out. Before the archive reasons exist (contract A) the same rows are read without them.
    let goneList = "";
    let goneRows: any[] = [];
    try {
      const since = new Date(Date.now() - 150 * 86400000).toISOString();
      const goneQ = (cols: string) => db.from("properties").select(cols).eq("company_id", msg.company_id).eq("archived", true).in("status", ["withdrawn", "not_available"])
        .gte("archived_at", since).order("archived_at", { ascending: false }).limit(40);
      let gr: any = await goneQ("id,type,area,wilayat,price,listing_purpose,status,archive_reason,map_url");
      if (gr.error) gr = await goneQ("id,type,area,wilayat,price,listing_purpose,status,map_url");
      goneRows = ((gr.data || []) as any[]).filter((p: any) => !["duplicate", "test_record"].includes(String(p.archive_reason || "")));
      goneList = goneRows.map((p: any) => `- ${neutralLabel(p)} | ${ARCHIVE_REASON_AR[String(p.archive_reason || "")] || "ما عاد متوفر"}`).join("\n");
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
    // Dry run 10 Nov: a buyer standing at the location we sent was told «انباعت، الموقع كان لها» although that map belonged to the
    // available villa. Every map link in the chat now says which property it is and whether it is still available.
    const mapKey = (u: any) => String(u || "").trim().split("?")[0].replace(/\/+$/, "");
    const mapOwners: { key: string; label: string; state: string }[] = [];
    for (const p of props as any[]) if (p.map_url) mapOwners.push({ key: mapKey(p.map_url), label: neutralLabel(p), state: "متوفر حالياً" });
    for (const p of soldRows) if (p.map_url) mapOwners.push({ key: mapKey(p.map_url), label: neutralLabel(p), state: p.status === "reserved" ? "انحجز" : "انباع" });
    for (const p of goneRows) if (p.map_url) mapOwners.push({ key: mapKey(p.map_url), label: neutralLabel(p), state: "ما عاد متوفر (مو مباع)" });
    const mapNote = (text: string) => {
      const links = String(text || "").match(/https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|(www\.)?google\.[a-z.]+\/maps)[^\s]*/gi) || [];
      const hits = links.map((l) => mapOwners.find((o) => o.key && mapKey(l) === o.key)).filter(Boolean) as any[];
      return hits.length ? ` {هذا اللوكيشن لعقار: ${hits.map((o) => `${o.label} — ${o.state}`).join(" / ")}}` : "";
    };
    const transcript = history.map((h: any) => {
      const who = h.direction === "inbound" ? "العميل" : (h.actor_type === "human" ? "المكتب (شخص)" : "المكتب (رد سابق منك)");
      let text = h.transcript ? `[رسالة صوتية: ${h.transcript}]` : (h.body || (h.message_type === "audio" ? "[رسالة صوتية ما انفهمت]" : `[${h.message_type}]`));
      const key = fbOf[h.id]?.key || String(h.property_link_key || "") || ((String(h.body || "").match(IG_RE) || [])[1] ? `instagram:${String(h.body).match(IG_RE)![1]}` : "");
      const reel = key ? reels[key] : null;
      let extra = "";
      if (reel?.facebook) extra += reel.property_id
        ? ` {منشور فيسبوك من صفحتنا${reel.caption ? `. وصفه: ${short(reel.caption, 300).replace(/\n+/g, " / ")}` : ""} | عقار مرتبط: ${reel.property_id}}`
        : reel.caption
          ? ` {منشور فيسبوك (الوصف مقروء من الرابط، مو مربوط بعقار): ${short(reel.caption, 400).replace(/\n+/g, " / ")}. حدد العقار من القائمة بالمواصفات، وإذا ما تطابق شي اسأل مثل الريل المو مسجل}`
          : " {منشور فيسبوك ما قدرنا نقرأ وصفه: عامله مثل الريل المو مسجل}";
      else if (reel) extra += ` {ريل من حسابنا. وصفه: ${short(reel.caption, 300).replace(/\n+/g, " / ")}${reel.property_id ? ` | عقار مرتبط: ${reel.property_id}` : ""}${reel.project ? ` | عن مشروع استثماري: ${reel.project.name}${reel.project.developer ? ` للمطور ${reel.project.developer}` : ""}` : ""}${(reel.propertyIds || []).length > 1 ? ` | نفس الفيديو لعقارات متطابقة: ${reel.propertyIds.join(" و ")}، إذا واحد راح اعرض الثاني المتوفر` : ""}}`;
      else if (key) extra += " {ريل ما عرفنا وصفه}";
      // R6: say plainly when the property behind a reel or message was sold, so the sold rule applies (old reels of sold villas)
      const soldOf = (id: any) => soldRows.find((s: any) => s.id === id);
      const sold = soldOf(reel?.property_id) || soldOf(h.matched_property_id) || (reel?.propertyIds || []).map(soldOf).find(Boolean);
      const soldGroup = sold ? groupOf(sold.id) : null;
      if (sold && !props.some((p: any) => p.id === reel?.property_id || p.id === h.matched_property_id)) extra += soldGroup
        ? ` {هذا العقار وحدة من مجموعة وحدات متشابهة: ${typeAr(sold.type)} ${sold.area || ""} ${sold.price ? Math.round(Number(sold.price) / 1000) + " الف" : ""}. ${soldGroup.line}. المتبقي متاح: ${(soldGroup.remaining_ids || []).join(" و ")}. قل له هذا السطر واعرض الوحدة المتبقية، لا تقول انباع وخلاص ولا تعرض بديل ثاني (R38)}`
        : ` {هذا العقار ${sold.status === "reserved" ? "انحجز" : "انباع"}: ${typeAr(sold.type)} ${sold.area || ""} ${sold.price ? Math.round(Number(sold.price) / 1000) + " الف" : ""}. طبق قاعدة المباع واعرض أقرب متاح}`;
      // R24: archived without being sold (withdrawn, contract ended): no longer available, and never called sold
      const goneOf = (id: any) => goneRows.find((s: any) => s.id === id);
      const gone = sold ? null : (goneOf(reel?.property_id) || goneOf(h.matched_property_id) || (reel?.propertyIds || []).map(goneOf).find(Boolean));
      if (gone && !props.some((p: any) => p.id === reel?.property_id || p.id === h.matched_property_id)) extra += ` {هذا العقار ما عاد متوفر (مو مباع): ${typeAr(gone.type)} ${gone.area || ""} ${gone.price ? Math.round(Number(gone.price) / 1000) + " الف" : ""}. قول ما متوفر حالياً ولا تقول انباع، واعرض أقرب متاح}`;
      extra += mapNote(h.body);
      if (h.matched_property_id) extra += ` {عقار مرتبط: ${h.matched_property_id}}`;
      if (h.property_image_analysis) extra += ` {تحليل الصورة: ${short(JSON.stringify(h.property_image_analysis), 300)}}`;
      const when = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Muscat", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(h.message_timestamp));
      return `[${when}] ${who}: ${short(text, 700)}${extra}`;
    }).join("\n");

    const askedName = await db.from("whatsapp_messages").select("id").eq("conversation_id", conv.id).eq("direction", "outbound").ilike("body", "%اسمك%").limit(1);
    let behaviorText = "";
    try {
      if (inline) {
        // crm_client_behavior_text recomputes and saves the row; an inline dry run reads the saved one in the same wording
        const cb = await db.from("client_behavior").select("tier_ar,score,approach,facts").eq("client_id", client.id).maybeSingle();
        const f: any = cb.data?.facts || {};
        if (cb.data) behaviorText = `سلوك العميل (محسوب من سجله): ${cb.data.tier_ar ?? ""} | درجة ${cb.data.score ?? ""} من 100\nله ${f.first_contact_days ?? ""} يوم يتواصل، كتب في ${f.active_days ?? ""} يوم مختلف، سأل عن ${f.properties_asked ?? ""} عقار، زار ${f.visits_done ?? ""} (${f.properties_visited ?? ""} عقار مختلف)\nأسلوب التعامل: ${cb.data.approach ?? ""}`;
      } else { const bh = await db.rpc("crm_client_behavior_text", { p_client: client.id }); if (!bh.error && bh.data) behaviorText = String(bh.data); }
    } catch (_) { /* optional */ }
    const nameAskedBefore = (askedName.data || []).length > 0 || String(client.notes || "").includes(NAME_NOT_GIVEN);
    // «ملف العميل» (contract C, 10 Nov): what we already know, so the agent guides instead of asking again: his open request, the budget,
    // payment and timing on his card, his open deals (neutral label and stage) and the agent's own notes from earlier turns.
    // Branch isolation: the other number's request stays out (a branch-free 'general' request shows on both numbers), and an
    // investment request (route_key or branch_key 'investment', SQL18) and the deals on it only show on the Muscat number.
    // A query that fails adds no line: the agent is never told "nothing" when we simply could not read it.
    const REQ_AR: Record<string, string> = { buyer: "شراء", tenant: "إيجار", seller: "بيع عقاره", landlord: "تأجير عقاره", consultation: "استشارة", investor: "استثمار" };
    const PAY_AR: Record<string, string> = { cash: "كاش", bank_ready: "تمويل بنك جاهز", needs_finance: "يحتاج تمويل", not_sure: "مو متأكد", unclear: "غير واضح" };
    const TIMING_AR: Record<string, string> = { immediate: "على طول", this_week: "هذا الأسبوع", this_month: "هذا الشهر", "3_months": "خلال 3 شهور", just_looking: "يتفرج بس", not_sure: "مو متأكد" };
    const SERIOUS_AR: Record<string, string> = { strong: "جاد", possible: "محتمل", weak: "ضعيف", unknown: "غير واضح" };
    const money = (n: any) => `${Number(n).toLocaleString("en-US")} ريال`;
    const range = (lo: any, hi: any) => (hi ? `${lo ? `من ${money(lo)} ` : ""}لين ${money(hi)}` : "");
    const profile: string[] = [];
    const invReq = (r: any) => r.route_key === "investment" || r.branch_key === "investment";
    const hiddenReqIds = new Set<string>();
    let reqsRead = false;
    try {
      const reqR = await db.from("client_requests").select("id,status,request_type,preferred_areas,preferred_area,property_types,property_type,budget_min,budget_max,bedrooms_min,notes,route_key,branch_key")
        .eq("client_id", client.id).order("updated_at", { ascending: false }).limit(30);
      if (reqR.error) throw new Error(reqR.error.message);
      const allReqs = (reqR.data || []) as any[];
      for (const r of allReqs) if (invReq(r) && conv.route_key !== "muscat") hiddenReqIds.add(r.id);
      reqsRead = true;
      const reqs = allReqs.filter((r: any) => r.status === "active" && !hiddenReqIds.has(r.id)
        && (invReq(r) || !r.route_key || r.route_key === "general" || r.route_key === conv.route_key)).slice(0, 2);
      for (const r of reqs) {
        const areas = (r.preferred_areas || []).length ? r.preferred_areas : (r.preferred_area ? [r.preferred_area] : []);
        const types = ((r.property_types || []).length ? r.property_types : (r.property_type ? [r.property_type] : [])).map((t: any) => typeAr(t));
        profile.push(`- الطلب المفتوح: ${REQ_AR[r.request_type] || r.request_type || "غير محدد"} | المناطق: ${areas.join("، ") || "غير محددة"} | النوع: ${types.join("، ") || "غير محدد"} | الميزانية: ${range(r.budget_min, r.budget_max) || "غير معروفة"} | الغرف: ${r.bedrooms_min ? `${r.bedrooms_min} وفوق` : "غير محددة"}${r.notes ? ` | ملاحظات: ${short(String(r.notes).replace(/\+?968[\s-]?\d{8}|\b[79]\d{7}\b/g, ""), 300).replace(/\n+/g, " / ")}` : ""}`);
      }
      if (!reqs.length) profile.push("- الطلب المفتوح: ما في طلب مسجل");
    } catch (_) { /* optional */ }
    const card = [range(client.budget_min, client.budget_max) ? `الميزانية ${range(client.budget_min, client.budget_max)}` : "",
      client.payment_method ? `الدفع: ${PAY_AR[client.payment_method] || client.payment_method}` : "",
      client.purchase_timing ? `متى يشتري: ${TIMING_AR[client.purchase_timing] || client.purchase_timing}` : ""].filter(Boolean);
    profile.push(`- من بطاقة العميل: ${card.join(" | ") || "ما في ميزانية ولا طريقة دفع مسجلة"}`);
    try {
      // merged duplicate cards (contract B) never show; before merged_into_deal_id exists the same deals are read without it
      const dealQ = (cols: string) => db.from("deals").select(cols).eq("company_id", msg.company_id).eq("client_id", client.id)
        .not("stage", "in", "(lost,closed,commission_collected)").order("updated_at", { ascending: false }).limit(10);
      let dr: any = await dealQ("id,stage,property_id,request_id,merged_into_deal_id,properties(type,area,wilayat,price,listing_purpose,branch_key)");
      if (dr.error) dr = await dealQ("id,stage,property_id,request_id,properties(type,area,wilayat,price,listing_purpose,branch_key)");
      if (dr.error) throw new Error(dr.error.message);
      // off the Muscat number a deal on a request we could not read stays out (it may be an investment one)
      const openDeals = ((dr.data || []) as any[]).filter((d: any) => !d.merged_into_deal_id && !hiddenReqIds.has(d.request_id)
        && (conv.route_key === "muscat" || ((reqsRead || !d.request_id) && d.properties?.branch_key !== "investment")));
      profile.push(openDeals.length
        ? `- صفقاته المفتوحة: ${openDeals.map((d: any) => `${neutralLabel(d.properties)} (المرحلة: ${DEAL_STAGE_AR[d.stage] || d.stage}) property_id=${d.property_id || ""}`).join(" / ")}`
        : "- صفقاته المفتوحة: ما في");
    } catch (_) { /* optional */ }
    // the agent's own memory (agent_note, never overwritten by the webhook); before it exists, the conversation summary
    profile.push(`- ملاحظات العقل السابقة عن العميل: ${short(conv.agent_note || conv.ai_summary || "لا يوجد", 1500)}`);
    if (conv.agent_seriousness) profile.push(`- تقييمك السابق لجديته: ${SERIOUS_AR[conv.agent_seriousness] || conv.agent_seriousness}${conv.agent_seriousness_reason ? ` (${short(conv.agent_seriousness_reason, 200)})` : ""}`);
    const context = [
      `الوقت الحالي في عمان: ${omanNow()}`,
      `الاسم المسجل من الواتساب، مو دليل على اسمه الحقيقي: ${client.name || conv.customer_name || "غير معروف"}`,
      // R15 (dry run 10 Nov: «أم راكان» was still answered in the masculine): «أم فلان» is a woman, say it plainly
      ...(FEMALE_KUNYA_RE.test(`${client.name || ""} | ${conv.customer_name || ""}`)
        || (FEMALE_KUNYA_LATIN_RE.test(`${client.name || ""} | ${conv.customer_name || ""}`)
          && history.some((h: any) => h.direction === "inbound" && /[ء-ي]/.test(String(h.body || "")))) ? ["العميلة امرأة (اسمها «أم ...»): خاطبها بالمؤنث في كل الكلام (تقدرين، تشوفينه، يناسبك، متى يناسبك تزورين ؟)، R15"] : []),
      `هل سألناه عن اسمه قبل: ${nameAskedBefore ? "نعم، لا تسأل مرة ثانية أبداً" : "لا"}`,
      ...(behaviorText ? [behaviorText, "(استخدم سلوك العميل لتفهم جديته وتختار أسلوب الرد: لا تعامل المتجوّل مثل الساخن، ولا ترد على الكل بنفس الأسلوب)"] : []),
      `الرقم اللي كلمنا عليه: ${conv.route_key === "barka" ? "رقم بركاء" : "رقم مسقط"}`,
      `هل سألنا عن الميزانية قبل في هذه المحادثة: ${budgetAskedBefore ? "نعم، لا تسأل مرة ثانية أبداً" : "لا"}`,
      "",
      "ملف العميل:",
      ...profile,
      "",
      "زيارات العميل المسجلة في الـ CRM (التفاوض على السعر بس على عقار زاره فعلاً، هنا أو قال في المحادثة إنه زاره):",
      visitsText,
      ...(soldLine ? ["", `عقار سأل عنه انحجز وما انقال له لين الحين (قرار 42): «${soldLine}». أول رد منك يبدأ بهذا السطر بس (بدون "تحب تشوف خيارات ثانية ؟")، وبعده جاوب على رسالته. لا تعرض عليه هذا العقار.`] : []),
      // R23 (10 Nov): an open soft handoff (a booked «اجتماع:» meeting, a photo or appointment request) never silences the agent by itself
      ...(conv.human_handoff_required && !hardHandoff ? [`موضوع محول لأحمد ولسا ما خلص (من ${String(conv.handoff_updated_at || "").slice(0, 16)}): ${conv.handoff_reason || ""}. أحمد بيكمل هذا الموضوع بنفسه وهو عنده في القائمة، وهذا التحويل ما يسكّتك (R23): رد على رسالة العميل عادي. إذا سأل عن نفس الموضوع اعطه اللي تقدر عليه بدون وعد (رد قصير، معلومة مكتوبة قدامك، أو سؤال يكمل مثل "متى يناسبك ؟"). إذا الموضوع "اجتماع:" فالموعد محجوز: أكد له اليوم والساعة إذا سأل وجاوب أسئلته البسيطة و action=none، وإذا غيّر الموعد book_meeting بالموعد الجديد. action=handoff بس إذا طلب شي جديد لازم أحمد يسويه. تسكت (reply_messages=[] و action=none) بس في حالات R23، أو إذا يستعجل أو يعيد طلب ما يقدر عليه غير أحمد (موعد ينتظر تأكيده، اتصال، معلومة مو مكتوبة قدامك) وانت رديت عليه فيه قبل`] : []),
      "",
      "العقارات المتاحة الآن (لا تعرض غيرها، ولا تذكر id للعميل):",
      props.map((p: any) => propLine(p) + (groupOfRemaining(p.id) ? ` | من مجموعة انحجزت منها وحدة: ${groupOfRemaining(p.id).line} (R38)` : "")).join("\n") || "لا يوجد",
      "",
      "عقارات انباعت او انحجزت مؤخراً (لا تعرضها، واذا العميل سأل عنها طبق قاعدة المباع. اللي جنبه \"وحدة من مجموعة\" له وحدة متاحة من نفس المجموعة: طبق R38):",
      soldList || "لا يوجد",
      "",
      "عقارات ما عادت متوفرة (مو مباعة):",
      "(انسحبت او خلص عقدها او ما عادت متاحة. لا تعرضها، واذا العميل سأل عن واحد منها قول ما متوفر حالياً بدون ما تقول انباع وبدون السبب، واعرض أقرب متاح مثل قاعدة المباع)",
      goneList || "لا يوجد",
      "",
      "معلومات المستثمرين:",
      INVESTOR_KNOWLEDGE,
      "",
      rulesR.data?.length ? "ردود مثبتة اعتمدها المدير:\n" + rulesR.data.map((r: any) => `- rule_id=${r.id} | الموقف: ${r.situation}\n  الرد: ${pickedVariant[r.id].reply}`).join("\n") : "ردود مثبتة: لا يوجد",
      "",
      ...(otherRoute ? [otherRoute, ""] : []),
      "المحادثة (الأقدم أولاً، وآخر سطر هو اللي ترد عليه):",
      transcript,
      ...(resume || (inline && body?.resume_preview === true) ? ["", "أحمد رجّع لك هذي المحادثة («كمّل يا عقل»): اقرأ المحادثة كاملة من أولها وافهم وين وصلنا مع العميل وكمّل معه من هالنقطة، بنفس القواعد. إذا لسا ما تعرف كيف ترد، action=handoff وسبب يبدأ بـ«ما عرفنا» يوضح وش الناقص بالضبط."] : []),
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
        parts.push({ type: "input_text", text: `غلاف ريل العقار id=${p.id} (${typeAr(p.type)} ${p.area || ""} ${p.price ? Math.round(Number(p.price) / 1000) + " الف" : ""}):` });
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
    // silentOwner (22 Nov): the office took this chat, so nothing is sent. Only a «دراسة سعر:» handoff of an owner opens the study
    // (the same task as below and the chat's handoff, so priceStudyOpen holds); anything else stays the office's (staff_active).
    if (silentOwner) {
      const study = out.category === "seller" && out.action === "handoff" && /^\s*دراسة سعر/.test(String(out.handoff_reason || ""));
      if (!study) return (await meetingAlert("staff_active")) || fail("staff_active");
      if (inline) return json({ ok: true, inline: true, ignored: "staff_active", silent_owner_study: short(out.handoff_reason, 200) });
      try {
        const o = await db.from("profiles").select("id").eq("company_id", msg.company_id).eq("role", "owner").eq("is_active", true).limit(1).maybeSingle();
        await db.from("tasks").insert({ company_id: msg.company_id, user_id: o.data?.id || null, client_id: client.id, title: short(out.handoff_reason, 200), notes: short(out.crm_note, 1000), due_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10) });
        const nowS = new Date().toISOString();
        await db.from("whatsapp_conversations").update({ human_handoff_required: true, handoff_reason: short(out.handoff_reason, 500), handoff_updated_at: nowS, updated_at: nowS }).eq("id", conv.id);
      } catch (e) { console.error("[reply-agent] silent owner study", String((e as any)?.message || e)); }
      return fail("staff_active_study_opened");
    }
    // R40: nothing is said and nothing is handed to Ahmed; below the chat is muted for good and kept in the ignored list
    // R61 (note of 14 Nov 2026 on a chat that asked «متى تبدأ المسابقة؟»): the office runs no contest. Whoever asks about one,
    // with no property in the chat, is ignored for good like R40, whatever the model chose. Kept in the list as «other».
    {
      let from = 0;
      history.forEach((h: any, i: number) => { if (h.direction === "outbound") from = i + 1; });
      const asked = history.slice(from).filter((h: any) => h.direction === "inbound").map((h: any) => String(h.transcript || h.body || "")).join(" ");
      if (CONTEST_ASK.test(asked) && !out.property_id && !history.some((h: any) => h.matched_property_id) && ["general", "unclear", "ignore"].includes(out.category) && !IGNORE_LABEL[String(out.ignore_kind || "")]) {
        out.category = "ignore"; out.ignore_kind = "contest"; out.guard_contest = true;
      }
      // R86 (Ahmed 16 Nov 2026: «ايوه تجاهل هذيله … رقمه من الصين … مشكوك في امره»): a stranger's opener from a number outside
      // Oman («سيدي الرئيس، هل هذا أنت حقاً؟», «هل سبق لك أن زرت الصين؟») with no property in the chat is ignored for good, like R40.
      if (STRANGER_OPENER.test(asked) && !/^968/.test(to) && !out.property_id && !history.some((h: any) => h.matched_property_id) && ["general", "unclear", "ignore"].includes(out.category) && !IGNORE_LABEL[String(out.ignore_kind || "")]) {
        out.category = "ignore"; out.ignore_kind = "stranger"; out.guard_stranger = true;
      }
    }
    const ignored = out.category === "ignore" && !!IGNORE_LABEL[String(out.ignore_kind || "")];
    if (out.category === "ignore" && !ignored) out.category = "unclear";
    if (ignored) { out.reply_messages = []; out.action = "none"; out.handoff_reason = null; }
    // R41: «سؤال ما عندي جوابه: …» = silence and a hard handoff (the agent stays quiet in that chat until it is given back)
    if (out.action === "handoff" && UNKNOWN_Q.test(String(out.handoff_reason || ""))) out.reply_messages = [];
    // decisions 16 and 46 (Ahmed 18 Nov 2026: «ما نلحقهم بس نرد»): investors are answered and their meetings booked, but no
    // follow-up of ours is set for them until 12 Feb 2027
    if (out.category === "investor" && dayM < "2027-02-12" && out.request) { out.request.followup_in_days = null; out.request.followup_note = null; }
    // R45 (reply audit 22 Nov, 2d32eee8): a yes («ان شاء الله», «تمام») to our meeting invitation is booked like the model's
    // book_meeting (silent «اجتماع:» below), before the under-57,000 check so that check still holds it
    if ((out.action === "none" || (out.action === "handoff" && !HARD_HANDOFF.test(String(out.handoff_reason || ""))))
      && out.category !== "ignore") {
      const place = meetingYes(history);
      if (place) {
        out.action = "book_meeting"; out.meeting = { place, date: out.meeting?.date ?? null, time: out.meeting?.time ?? null };
        if (!/^\s*(اجتماع|طلب اجتماع|طلب موعد)\s*:/.test(String(out.handoff_reason || ""))) out.handoff_reason = null;
        out.guard_meeting_yes = true;
      }
    }
    // decisions 10 and 11 (Ahmed 18 Nov 2026: «حاجز في الكود»): in a Sultan Haitham City chat (Al Ahli Sabour: Wadi Zaha, the
    // Iconic Tower) where a price or budget under 57,000 was mentioned and the office has not said since that the available
    // units start from 57,000, the meeting is not booked, even when the client agreed (this beats R45). He is told and asked.
    if (conv.route_key === "muscat" && (out.action === "book_meeting" || (out.action === "handoff" && /^\s*(اجتماع|طلب اجتماع|طلب موعد)\s*:/.test(String(out.handoff_reason || ""))))) {
      const HAITHAM = /هيثم|وادي\s*زها|زها\s*ريزيدنس|[اآأ]?ل?[اآأ]يكونيك|icon(ic)?\s*tower|صبور/i;
      const said = (h: any) => String(h.transcript || h.body || "");
      const wn = (s: string) => s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
      // a figure in rials under 57,000: «20,800», «25000», «30 الف»; not a residency line («50 الف وفوق يعطي إقامة»), a date or a phone
      const lowPrice = (s: string) => !/[اإ]قام[ةه]/.test(s) && [...wn(s).matchAll(/(\d[\d,٬.]*)\s*(الف|ألف|آلاف|k|م²|م2|متر|m2|sqm|م(?![ء-ي]))?/gi)].some((m) => {
        if (m[2] && !/الف|ألف|آلاف|k/i.test(m[2])) return false; // a size, not a price
        const n = Number(m[1].replace(/[,٬]/g, "")) * (m[2] ? 1000 : 1);
        return n >= 5000 && n < 57000;
      });
      const rows = history.filter((h: any) => ["inbound", "outbound"].includes(h.direction));
      let lastLow = -1; rows.forEach((h: any, i: number) => { if (lowPrice(said(h))) lastLow = i; });
      const told = lastLow >= 0 && rows.slice(lastLow + 1).some((h: any) => h.direction === "outbound" && /57/.test(wn(said(h))) && /يبد[اأ]|المتوفر|خلص/.test(said(h)));
      const project = HAITHAM.test(rows.map(said).join(" ")) || out.meeting?.place === "developer";
      if (lastLow >= 0 && !told && project) {
        out.action = "none"; out.handoff_reason = null; out.meeting = null;
        out.reply_messages = ["المتوفر الحين في مدينة السلطان هيثم يبدأ من 57 الف", "يناسبك ؟"];
        out.guard_under_57 = true;
      }
    }
    // R19 / R30 / R33 / R45: any meeting request (the model's book_meeting, or a handoff it labelled «اجتماع:» / «طلب موعد:»)
    // becomes the silent hard handoff «اجتماع: …» with whatever day and hour the client said; Ahmed confirms the time himself.
    // R30 (Ahmed 11 Nov): a project meeting (Al Ahli Sabour) is at the developer's office in Al Udhaybah, not ours in Mawaleh;
    // the time is only a request until Ahmed confirms it (it must not clash with his day), and never the same day.
    // R33 (Ahmed 12 Nov): a project meeting is at that project's developer: Al Ahli Sabour in Al Udhaybah, Aida (Dar Global) at
    // their office by the Opera House; a project whose office Ahmed has not named yet (Al Yazan) waits for him to set the place
    const MEETING_PLACE: Record<string, string> = { office: "مكتب الموالح", online: "اونلاين", developer: "مكتب الأهلي صبور في العذيبة", dar_global: "مكتب دار جلوبال عند دار الأوبرا", project_tbd: "عند المطور (المكان يحدده أحمد)" };
    // R45 (Ahmed 14 Nov, replaces the «تمام وصلت» of R19 / R30 and the «طلب موعد:» of R23): the moment a client asks for a meeting
    // or an office visit, or accepts the agent's invitation, the agent says nothing, stops in that chat (hard handoff «اجتماع:»),
    // Ahmed gets the WhatsApp alert and a task to confirm. Only Ahmed fixes the time and confirms it (button «أكّد الموعد»).
    const MEETING_ASK = /^\s*(اجتماع|طلب اجتماع|طلب اجتماع بدون موعد|طلب موعد)\s*:/;
    if (out.action === "book_meeting" || (out.action === "handoff" && MEETING_ASK.test(String(out.handoff_reason || "")))) {
      const mt = out.meeting || null;
      const hm = String(mt?.time || "").trim().match(/^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
      if (mt && hm) mt.time = `${hm[1].padStart(2, "0")}:${hm[2]}`;
      const dated = !!mt && /^\d{4}-\d{2}-\d{2}$/.test(String(mt.date || "")) && String(mt.date) >= dayM;
      if (mt && !dated) mt.date = null;
      if (mt && !hm) mt.time = null;
      const topic = String(out.handoff_reason || "").replace(MEETING_ASK, "").replace(/\s*\(ينتظر تأكيدك\)\s*$/, "").trim() || String(out.intent || out.crm_note || "");
      // 15 Nov 2026 (Ahmed on the chat of a developer who asked «متي بتيجي معنا المكتب»: the alert read «مكتب الموالح» and then
      // «مكتب الأهلي صبور في العذيبة»): when the client invites us to his own office, the place is his office.
      const theirOffice = THEIR_OFFICE.test(history.filter((h) => h.direction === "inbound").slice(-10).map((h) => String(h.transcript || h.body || "")).join(" "));
      const slot = [theirOffice && mt?.place !== "online" ? "مكتب العميل" : MEETING_PLACE[mt?.place] || "", mt?.date || "", mt?.time || ""].filter(Boolean).join(" ") || "بدون موعد";
      out.action = "book_meeting";
      out.handoff_reason = short(`اجتماع: ${client.name || conv.customer_name || "عميل"} ${slot} ${short(topic, 120)} (ينتظر تأكيدك)`, 300);
      out.reply_messages = [];
    }

    // the agent may only touch properties that are really available
    const prop = props.find((p: any) => p.id === out.property_id) || null;
    let texts: string[] = (out.reply_messages || []).map((t: string) => humanize(t)).filter(Boolean);
    if (budgetAskedBefore) texts = texts.filter((t) => !/ميزاني|في حدود كم|كم تقريب/.test(t));
    // decision 15: from 1 Dec 2026 no line offers the ended zero-down offer
    if (zeroDownOver && texts.some((t) => t.length <= 250 && ZERO_DOWN.test(t))) { texts = texts.filter((t) => !(t.length <= 250 && ZERO_DOWN.test(t))); out.guard_zero_down_over = true; }
    texts = texts.filter((t) => !/(الموظف|موظف)\s*(بيتواصل|يتواصل|بيرد|يرد)|بيتواصل معك الموظف|تم تحويل/.test(t));
    // R12: a call promise is taken out like any promise, and Ahmed gets the call request (below, after the pinned reply)
    const callPromised = texts.some((t) => CALL_PROMISE_RE.test(t));
    texts = texts.filter((t) => !PROMISE_RE.test(t));
    // R17 (Ahmed 9 Nov) and the dry run of 10 Nov: a residency answer must not open with a denial. The model still wrote
    // «ما في قيمة عقار تضمن إقامة دائمة» once, so such a line is replaced by Ahmed's two fixed residency lines.
    // A line that promises residency («مضمونة بمجرد شراء العقار») goes the same way; when the other lines already give
    // the 50,000 fact it is only dropped.
    const badResidency = (t: string) => NEG_RESIDENCY_RE.test(t) || promisesResidency(t);
    if (texts.some(badResidency)) {
      const fixed = ["في مدينة السلطان هيثم الشراء بـ 50 الف وفوق يعطي إقامة للمشتري وعائلته وتتجدد كل سنتين حسب الأنظمة", "والإقامة الذهبية من 200 الف وتتجدد كل 10 سنوات"];
      const kept = texts.filter((t) => !badResidency(t));
      const factsKept = kept.some((t) => RESIDENCY_WORD_RE.test(t) && /50|٥٠|خمسين/.test(t));
      texts = factsKept ? kept : texts.flatMap((t) => (badResidency(t) ? fixed : [t])).filter((t, i, a) => a.indexOf(t) === i);
    }
    // R29: a congratulation needs the customer's own words about buying, reserving or paying (or a happy occasion) since our
    // last message. Otherwise it is dropped; after our after-visit question the customer is asked the opinion instead.
    if (texts.some((t) => CONGRATS_RE.test(t))) {
      let lastOutIdx = -1; history.forEach((h: any, i: number) => { if (h.direction === "outbound") lastOutIdx = i; });
      const saidSince = history.slice(lastOutIdx + 1).filter((h: any) => h.direction === "inbound").map((h: any) => `${h.body || ""} ${h.transcript || ""}`).join(" ");
      if (!BOUGHT_RE.test(saidSince)) {
        texts = texts.filter((t) => !CONGRATS_RE.test(t));
        const lastOutBody = lastOutIdx >= 0 ? String(history[lastOutIdx]?.body || "") : "";
        if (!texts.length && out.action !== "book_meeting" && AFTER_VISIT_Q.test(lastOutBody) && !NOT_A_VISIT_Q.test(lastOutBody)) texts = ["وايش انطباعك بعد الزيارة ؟"];
      }
    }
    // R14 (9 Nov): never send a line we already sent to this customer in the last 15 minutes (Amer Ali got "ارسل الكروكي" twice)
    if (!review && texts.length) {
      const recent = await db.from("whatsapp_messages").select("body").eq("conversation_id", conv.id).eq("direction", "outbound").neq("delivery_status", "failed")
        .gt("message_timestamp", new Date(Date.now() - 15 * 60 * 1000).toISOString()).limit(40);
      const norm = (t: unknown) => String(t || "").replace(/[\s؟?.!،,]+/g, " ").trim();
      // R54: one sent message now holds several lines, so each paragraph of it counts as a line already sent
      const seen = new Set((recent.data || []).flatMap((r: any) => [r.body, ...String(r.body || "").split(/\n\s*\n/)]).map((b: any) => norm(b)).filter(Boolean));
      texts = texts.filter((t) => !seen.has(norm(t)));
    }
    // never tell a customer that a property is sold when the CRM still lists it as available
    const SOLD_RE = /ابتاع|انباع|انحجز|تم البيع|مباع/;
    const linkedAvailable = props.some((p: any) => p.id === out.property_id || history.some((h: any) => h.matched_property_id === p.id));
    // R6 (8 Nov): when the customer asked about a property that really was sold, "انباع" + the nearest available one is the
    // right answer, even though the alternative is available: the guard is only for calling an available one sold.
    const soldIds = new Set<string>(soldRows.map((s: any) => s.id));
    const linkedSold = history.some((h: any) => soldIds.has(h.matched_property_id))
      || Object.values(reels).some((r: any) => soldIds.has(r.property_id) || (r.propertyIds || []).some((id: string) => soldIds.has(id)))
      || (!!prop && texts.some((t) => /بس عندنا/.test(t)) && soldRows.some((s: any) => s.type === prop.type
        && String(s.area || "").replace(/^بركاء\s+/, "") === String(prop.area || "").replace(/^بركاء\s+/, "")));
    // R38: «انحجزت وحدة منها والمتبقي …» about a group whose remaining unit is the one in hand is true, not a wrong «انباع»
    const groupTalk = [out.property_id, prop?.id, ...history.map((h: any) => h.matched_property_id)].some((id: any) => !!id && remainingIds.has(id))
      && texts.filter((t) => SOLD_RE.test(t)).every((t) => /المتبقي|متاح|باقي/.test(t));
    if (linkedAvailable && !linkedSold && !groupTalk && texts.some((t) => SOLD_RE.test(t))) {
      texts = texts.filter((t) => !SOLD_RE.test(t));
      out.action = "handoff"; out.handoff_reason = "العقل كان بيقول العقار انباع وهو متوفر في الـ CRM، راجع المحادثة";
    }
    // R2 (Ahmed 8 Nov): no negotiation before the customer has visited that property. A discount / "last price" question
    // before a visit gets "see it first" and the visit question; it is never handed to Ahmed as a negotiation (Tasnim, 7 Nov).
    // R16 (9 Nov, in code 10 Nov): he has seen it when our last message was the after-visit question («كيف لقيت…» / «قدرت تشوف…»),
    // or its booked visit time has passed, or its location or its owner's number went out in this chat. Then the model's
    // تفاوض / مشتري جاد handoff stays as written (Abdullah, 9 Nov: told "see it first" after his visit).
    // decision 24 (Ahmed 18 Nov 2026: «لازم نتأكد نحنا هل العميل هذا شاف العقار»): «visited» needs a recorded visit (visitedIds)
    // or the client's own words. A location that went out (the area location of R74, the day location of R11), the owner's
    // number or a booked time that passed are no proof any more. His answer to our after-visit question counts, unless it says
    // he did not go.
    const r16Seen = async (_pid: string | null): Promise<string | null> => {
      let lastOutAt = -1;
      history.forEach((h: any, i: number) => { if (h.direction === "outbound") lastOutAt = i; });
      const lastBody = lastOutAt >= 0 ? String(history[lastOutAt]?.body || "") : "";
      const answer = history.slice(lastOutAt + 1).filter((h: any) => h.direction === "inbound").map((h: any) => String(h.transcript || h.body || "")).join(" ");
      const NOT_SEEN = /(ما|مب|مو|لسا|لسه|بعدني|بعدنا|للحين\s*ما)\s*(زرت|زرنا|رحت|رحنا|شفت|شفنا|قدرت|قدرنا|مريت|عاينت|لحقت|وصلت)/;
      if (AFTER_VISIT_Q.test(lastBody) && !NOT_A_VISIT_Q.test(lastBody) && !NOT_SEEN.test(answer)) return "رد على سؤال بعد الزيارة";
      return null;
    };
    if (out.action === "handoff" && NEGOTIATION_HANDOFF.test(String(out.handoff_reason || ""))) {
      const visitedThis = out.property_id ? visitedIds.has(out.property_id) : visitedIds.size > 0;
      const saidVisited = history.some((h: any) => h.direction === "inbound" && SAID_VISITED.test(String(h.transcript || h.body || "")));
      const r16 = visitedThis || saidVisited ? null : await r16Seen(out.property_id || null);
      if (!visitedThis && !saidVisited && !r16) {
        texts = ["شوف العقار أول واذا ناسبك نتكلم في السعر", "متى يناسبك تزور ؟"];
        // decision 24: a fixed price is said to be fixed from the start. Decision 27: a buyer still sorting out his bank is not
        // asked when he visits (Tasnim, «بنك الاسكان معطيينا سقف»).
        if (prop?.price_negotiable === "fixed") texts[0] = "بالنسبة للسعر نعم ثابت";
        if (/بنك|تمويل|قرض|سقف/.test(history.filter((h: any) => h.direction === "inbound").slice(-6).map((h: any) => String(h.transcript || h.body || "")).join(" "))) texts = texts.slice(0, 1);
        // crm_note is the agent's memory now (agent_note): the marker goes on top, the running note stays
        out.crm_note = short(`مهتم بالسعر قبل الزيارة: ${out.handoff_reason}${out.crm_note ? `\n${out.crm_note}` : ""}`, 1500);
        out.action = "none"; out.handoff_reason = null; out.visit_first = true;
      } else if (r16) out.r16_seen = r16;
    }
    // ---- 14 Nov 2026 (Ahmed: «ما على كل مرة نعدل نفس الاشياء»): rules that were only words in the brain are held here. ----
    // R16 the other way round: a client who has seen the property is never told «شوف العقار أول». The line (and the visit
    // question with it) is dropped; a price question that would be left with no handoff reaches Ahmed as «مشتري جاد:».
    const SEE_FIRST = /شوف[يوا]{0,2}\s*(العقار|البيت|الفيلا|الشقة|المكان)\s*(أول|اول)/;
    if (!out.visit_first && texts.some((t) => SEE_FIRST.test(t))) {
      const visitedThis = out.property_id ? visitedIds.has(out.property_id) : visitedIds.size > 0;
      const saidVisited = history.some((h: any) => h.direction === "inbound" && SAID_VISITED.test(String(h.transcript || h.body || "")));
      const seen = visitedThis ? "زيارته مسجلة" : saidVisited ? "قال إنه زار" : await r16Seen(out.property_id || null);
      if (seen) {
        texts = texts.filter((t) => !SEE_FIRST.test(t) && !(t.length < 90 && /(تزور|تزورون|تزورين)\s*؟/.test(t)));
        out.r16_seen = seen; out.guard_see_first = true;
        // (dry run rows 1046-1085, 17 Nov: a tenant asking «شي معكم مؤثثه؟» got «مشتري جاد: … يسأل عن السعر». The label is for
        // a price question; anything else left with no reply is «سؤال ما عندي جوابه:».)
        const lastSaid = history.filter((h: any) => h.direction === "inbound").slice(-3).map((h: any) => String(h.transcript || h.body || "")).join(" ");
        const askedPrice = /سعر|بكم|كم\s*(المطلوب|اخر|آخر|النهائي)|تفاوض|ينزل|تنزل|خصم|نهائي|مجال/.test(lastSaid);
        if (out.action === "none" && askedPrice && (prop?.price_negotiable !== "fixed" || !texts.length)) {
          out.action = "handoff"; out.handoff_reason = short(`مشتري جاد: زار العقار ويسأل عن السعر. ${out.intent || ""}`, 300);
        } else if (out.action === "none" && !askedPrice && !texts.filter((t) => !/^\s*اسمك\s*الكريم\s*؟?\s*$/.test(t)).length) {
          texts = []; out.action = "handoff"; out.handoff_reason = short(`سؤال ما عندي جوابه: ${lastSaid.replace(/\s+/g, " ").trim()}`, 300);
        }
      }
    }
    // R24: a property that left the market without being sold (withdrawn, contract ended, rented) is «ما متوفره حالياً», never «انباع»
    const goneNotSold = new Set<string>(goneRows.filter((g: any) => !/^sold_/.test(String(g.archive_reason || ""))).map((g: any) => g.id));
    const linkedGone = history.some((h: any) => goneNotSold.has(h.matched_property_id))
      || Object.values(reels).some((r: any) => goneNotSold.has(r.property_id) || (r.propertyIds || []).some((id: string) => goneNotSold.has(id)));
    if (linkedGone && !linkedSold && !linkedAvailable && !groupTalk && texts.some((t) => SOLD_RE.test(t))) {
      texts = texts.map((t) => (SOLD_RE.test(t) ? "حالياً ما متوفره" : t)).filter((t, i, a) => a.indexOf(t) === i);
      out.guard_gone_not_sold = true;
    }
    // R34: we have no photos, only the video. A promise or an offer of photos is taken out; a reply left empty says so.
    const PHOTO_PROMISE = /(برسل|بارسل|بأرسل|بنرسل|نرسل|برسلك|بارسلك)\s*(لك|لج|لكم)?\s*(ال)?صور|(ارسل|أرسل|ارسلك|أرسلك)\s*(لك|لج|لكم)\s*(ال)?صور|(ارسلك|أرسلك)\s*(ال)?صور/;
    if (texts.some((t) => PHOTO_PROMISE.test(t))) {
      texts = texts.filter((t) => !PHOTO_PROMISE.test(t));
      if (!texts.length && out.action === "none") texts = ["السموحة ما عندنا صور", "عندنا الفيديو بس"];
      out.guard_photo_promise = true;
    }
    // R44: the two questions Ahmed banned on 12 Nov, and the old area name is never explained to the customer
    const BANNED_R44 = /البيت\s*لك\s*ولا\s*تعرضه|تشتري(ها|ه)\s*ولا\s*تعرض(ها|ه)/;
    if (texts.some((t) => BANNED_R44.test(t))) { texts = texts.filter((t) => !BANNED_R44.test(t)); out.guard_r44 = true; }
    if (texts.some((t) => /حي\s*(ال)?عاصم/.test(t))) { texts = texts.map((t) => t.replace(/حي\s*(ال)?عاصم/g, "الرميس")); out.guard_r44 = true; }
    // R9 / R22: no project and no developer unit is named on the Barka number, whatever category the model chose (until now this
    // was only flagged as project_named). The line is taken out; a reply left empty goes to Ahmed instead of silence.
    if (conv.route_key === "barka" && out.category !== "investor" && texts.length) {
      // not the office ad (long text from the CRM) and not a distance line: Barka ads say «قريب من مدينة السلطان هيثم», which is a
      // place there, not an offer of the project
      const named: boolean[] = [];
      for (const t of texts) named.push(t.length <= 250 && !/قريب|قرب|تبعد|دقيقة|دقايق|دقائق/.test(t) && await mentionsProject(msg.company_id, [t]));
      if (named.some(Boolean)) {
        texts = texts.filter((_t, i) => !named[i]);
        out.guard_barka_project = true;
        if (!texts.length && out.action === "none") { out.action = "handoff"; out.handoff_reason = "العقل كان بيذكر مشروع على رقم بركاء (R9)، راجع المحادثة"; }
      }
    }
    // ---- 14 Nov 2026, batch 2 ----
    let burstStart = 0;
    history.forEach((h: any, i: number) => { if (h.direction === "outbound") burstStart = i + 1; });
    const burstSaid = history.slice(burstStart).filter((h: any) => h.direction === "inbound").map((h: any) => String(h.transcript || h.body || "")).join(" ");
    // R2 / R42: before a visit the agent does not talk about the price being fixed or negotiable, and a discount question gets
    // «شوف العقار أول» + the visit question. The price itself stays; only the negotiation words are taken out.
    const NEGO_SAID = /قابل\s*للتفاوض|غير\s*قابل|يتفاوض|نتفاوض|ننزل|ينزل\s*(السعر|شوي)|نخصم|خصم|(آخر|اخر)\s*سعر|السعر\s*النهائي|(السعر\s*)?(وهو\s*|وهي\s*)?ثابت/;
    const NEGO_ASK = /قابل\s*للتفاوض|تفاوض|ينزل|تنزل|خصم|(آخر|اخر)\s*سعر|السعر\s*النهائي|نهائي|في(ه)?\s*مجال/;
    // decision 27 (Ahmed 18 Nov 2026): a buyer still sorting out his bank is not asked when he visits
    const bankWait = /بنك|تمويل|قرض|سقف/.test(history.filter((h: any) => h.direction === "inbound").slice(-6).map((h: any) => String(h.transcript || h.body || "")).join(" "));
    // decision 24 (Ahmed 18 Nov 2026: «إلا إذا كان العقار غير قابل للتفاوض نقوله من بداية السعر ثابت»): a client who has not
    // visited and asks about the price of a property whose price is fixed is told it is fixed, not «شوف العقار أول».
    if (prop?.price_negotiable === "fixed" && !out.visit_first && !out.guard_see_first && ["buyer", "tenant"].includes(out.category) && out.action === "none"
      && NEGO_ASK.test(burstSaid) && !visitedIds.has(prop.id) && !history.some((h: any) => h.direction === "inbound" && SAID_VISITED.test(String(h.transcript || h.body || "")))) {
      const nego = (t: string) => t.length <= 250 && (SEE_FIRST.test(t) || /ثابت|قابل\s*للتفاوض|نتكلم\s*(في|ب)\s*?ال?سعر/.test(t));
      const visitQ = texts.filter((t) => t.length < 90 && /(تزور|تزورون|تزورين)\s*؟/.test(t));
      texts = [...texts.filter((t) => !nego(t) && !visitQ.includes(t)), "بالنسبة للسعر نعم ثابت", ...(bankWait ? [] : visitQ.length ? visitQ.slice(0, 1) : ["متى يناسبك تزور ؟"])];
      out.guard_fixed_from_start = true;
    }
    if (!out.visit_first && !out.guard_see_first && !out.guard_fixed_from_start && ["buyer", "tenant"].includes(out.category) && out.action !== "handoff"
      && texts.some((t) => t.length <= 250 && NEGO_SAID.test(t) && !SEE_FIRST.test(t))) {
      const visitedThis = out.property_id ? visitedIds.has(out.property_id) : visitedIds.size > 0;
      const saidVisited = history.some((h: any) => h.direction === "inbound" && SAID_VISITED.test(String(h.transcript || h.body || "")));
      if (!visitedThis && !saidVisited && !(await r16Seen(out.property_id || null))) {
        texts = texts.flatMap((t) => {
          if (t.length > 250 || !NEGO_SAID.test(t) || SEE_FIRST.test(t)) return [t];
          const kept = /[0-9٠-٩]/.test(t) ? t.replace(/\s*(و\s*)?(هو\s*|هي\s*|السعر\s*)?(ثابت|غير\s*قابل\s*للتفاوض|قابل\s*للتفاوض)[^\n]*/g, "").trim() : "";
          return kept && !NEGO_SAID.test(kept) ? [kept] : [];
        });
        if (NEGO_ASK.test(burstSaid) && !texts.some((t) => SEE_FIRST.test(t))) texts.push("شوف العقار أول واذا ناسبك نتكلم في السعر");
        if (!bankWait && !texts.some((t) => /(تزور|تزورون|تزورين)\s*؟/.test(t)) && !["send_location", "send_owner_number", "send_lockbox", "book_viewing"].includes(out.action)) texts.push("متى يناسبك تزور ؟");
        out.guard_price_before_visit = true;
      }
    }
    // R11: the location, the lockbox or the owner's number never goes out before the client said when he is coming
    if (["send_location", "send_owner_number", "send_lockbox"].includes(out.action)) {
      const TIME_SAID = /ا?ليوم|الحين|الان|الآن|بكر|باكر|بعد|العصر|الصبح|الصباح|المغرب|الظهر|الليل|المسا|الساع|طالع|جاي|في الطريق|وصلت|وصلنا|السبت|ال[اأ]حد|ال[اإ]ثنين|الثلاثاء|ال[اأ]ربعاء|الخميس|الجمعة|[0-9٠-٩]/;
      const recentIn = history.filter((h: any) => h.direction === "inbound").slice(-6).map((h: any) => String(h.transcript || h.body || "")).join(" ");
      const booked = visits.some((v: any) => (!prop || v.property_id === prop.id) && ["scheduled", "confirmed", "postponed"].includes(v.status));
      if (!out.viewing_date && !out.viewing_time && !booked && !TIME_SAID.test(recentIn)) {
        out.action = "none"; out.guard_location_before_time = true;
        texts = texts.filter((t) => !/تقدر\s*تشوف|مفتوح|المفتاح|الرمز/.test(t));
        if (!texts.some((t) => /(تزور|تزورون|تزورين)\s*؟/.test(t))) texts = [...texts.slice(0, 1), "ان شاء الله برسلك الموقع", "متى يناسبك تزور ؟"];
      }
    }
    // R45: the agent never asks for or proposes a day or an hour for a meeting, and never confirms one; the invitation ends with «يناسبك ؟»
    const MEETING_WORD = /اجتماع|نجتمع|المطور|تمر\s*(علينا\s*)?المكتب|في\s*المكتب|مكتبهم|اونلاين|أونلاين/;
    if (texts.some((t) => t.length <= 250 && MEETING_WORD.test(t))) {
      const before = texts.join("\n");
      texts = texts.filter((t) => !(t.length <= 250 && MEETING_WORD.test(t) && /نشوفك|تم\s*الحجز|تم\s*ت[اأ]كيد|الموعد\s*مؤكد|موعدنا/.test(t)))
        .map((t) => (t.length <= 250 && MEETING_WORD.test(t) ? t.replace(/(أي|اي)\s*(يوم|وقت)\s*يناسبك\s*؟?|متى\s*يناسبك\s*؟?|الساعة\s*كم\s*يناسبك\s*؟?/g, "يناسبك ؟")
          : /^\s*((أي|اي)\s*(يوم|وقت)|متى)\s*يناسبك\s*؟?\s*$/.test(t) ? "يناسبك ؟" : t));
      if (texts.join("\n") !== before) out.guard_meeting_time = true;
    }
    // R18: on the Muscat number a line about a project carries only the figures Ahmed wrote (57 الف, the offer's date, the
    // residency figures). Any other figure about a project is replaced by the fixed line.
    if (conv.route_key === "muscat" && texts.length) {
      const ALLOWED_NUM = new Set(["57", "57000", "30", "2026", "50", "50000", "200", "200000", "2", "10", "0", "71770030", "92344273"]);
      const western = (s: string) => s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
      const fixedLine = "الاسعار تختلف حسب الوحدة والمساحة والمرحلة";
      const bad: boolean[] = [];
      for (const t of texts) {
        const nums = (western(t).match(/\d[\d,٬]*/g) || []).map((n) => n.replace(/[,٬]/g, ""));
        bad.push(t.length <= 250 && !/https?:\/\//.test(t) && !/قريب|قرب|تبعد|دقيقة|دقايق|دقائق/.test(t) && nums.some((n) => !ALLOWED_NUM.has(n))
          && (/الآيكونيك|الايكونيك|وادي\s*زها|المطور/.test(t) || await mentionsProject(msg.company_id, [t])));
      }
      if (bad.some(Boolean)) {
        texts = texts.map((t, i) => (bad[i] ? fixedLine : t)).filter((t, i, a) => a.indexOf(t) === i);
        out.guard_project_figure = true;
      }
      // nothing is glued to the fixed line («… وما عندي سعر محدد لغرفتين وصالة», dry run of 15 Nov: R41 never says «ما عندي»)
      const glued = (t: string) => t.length <= 200 && t.includes(fixedLine) && t.trim() !== fixedLine && /ما\s*(عندي|عندنا|معي)/.test(t);
      if (texts.some(glued)) {
        texts = texts.map((t) => (glued(t) ? fixedLine : t)).filter((t, i, a) => a.indexOf(t) === i);
        out.guard_fixed_line = true;
      }
    }
    // ---- 14 Nov 2026, batch 3 ----
    // R12: a clear call request is never answered with words: no reply, and Ahmed gets «طلب اتصال:». The one exception stays with
    // the brain: a client who says he already tried to call and nobody answered gets the allowed sentence.
    const CALL_ASK = /(^|\s)(اتصل|اتصلوا|دق|دقوا|رن)\s*(علي|عليي|عليّ|بي|فيني|فيي|عليه)(\s|$|[.!،,؟?])|ممكن\s*(رقمك|تتصل|اتصال)|متى\s*(تتصل|تتصلون|بتتصل)|(ابي|ابغى|ابغا|اريد|أريد|ابيك|اباك)\s*(تتصل|اتصال|احد يتصل|أحد يتصل)|(احسن|أحسن|الافضل|الأفضل)\s*(اتصل|تتصل|اتصال)/;
    const CALL_TRIED = /(حاولت|اتصلت|دقيت|رنيت|اتصلنا)[^\n]{0,30}(ما|ولا|محد|ماحد)/;
    const callReason = /^\s*طلب اتصال/.test(String(out.handoff_reason || ""));
    if (CALL_ASK.test(burstSaid) && !CALL_TRIED.test(burstSaid) && !ignored && out.action !== "book_meeting"
      && !(out.action === "handoff" && (callReason || HARD_HANDOFF.test(String(out.handoff_reason || ""))))) {
      texts = []; out.action = "handoff"; out.handoff_reason = short(`طلب اتصال: ${out.intent || out.crm_note || "العميل طلب اتصال"}`, 300);
      out.guard_call_request = true;
    }
    // R93 (Ahmed 17 Nov 2026 night: «ايه حوّله لي بتنبيه»): a client who says the number we gave (the owner's, the other
    // branch's) or ours did not answer («تواصلت محد يرد», «رسلت لهم ما ردوا علي», «م يردوا») was sent back to the same number.
    // Now he gets R12's allowed sentence once, the chat goes to Ahmed as «ما يردون:», and Ahmed is told on WhatsApp.
    const NO_ANSWER = /(تواصلت|اتصلت|راسلت|رسلت|ارسلت|أرسلت|دقيت|كلمت|حاولت)[^\n]{0,40}(محد|ماحد|ما\s*حد|(ما|م)\s*رد(و|وا)?(\s|$)|(ما|م)\s*ير?د(و|ون|وا)?(\s|$)|ولا\s*رد|(ما|م)\s*حصلت\s*رد)|(^|\s)(محد|ماحد)\s*ير?د|(^|\s)(ما|م)\s*(يردوا|يردون|يردو|ردوا|ردو)(\s|$)/;
    if (NO_ANSWER.test(burstSaid) && !ignored && out.action !== "book_meeting" && !/^\s*(تفاوض|مشتري جاد|دراسة سعر|اجتماع)\s*:/.test(String(out.handoff_reason || ""))) {
      const R12_LINE = "حاليا الاستاذ احمد مشغول ان شاء الله اول ما يفضى يتصل فيك بس خبرنا وش الموضوع ونقدر نساعدك هنا في الواتساب";
      const saidIt = history.slice(-6).some((h: any) => h.direction === "outbound" && String(h.body || "").includes("اول ما يفضى يتصل فيك"));
      texts = saidIt ? [] : [R12_LINE];
      out.action = "handoff"; out.handoff_reason = short(`ما يردون: ${burstSaid.replace(/\s+/g, " ").trim()}`, 300);
      out.guard_no_answer = true; out.no_answer_alert = true;
    }
    // R10 / R20: an owner who says the property belongs to heirs, or is mortgaged or lived in, is declined with the fixed lines and
    // asked for nothing. Only on his own clear words (never on «ما فيه رهن» / «فاضي»), and never in a chat where the office wrote
    // itself (the property Ahmed brought is the written exception).
    if (out.category === "seller" && !review && !texts.some((t) => DECLINE_RE.test(t)) && out.action !== "handoff"
      && !history.some((h: any) => h.direction === "outbound" && h.actor_type === "human")) {
      const ownerSaid = history.filter((h: any) => h.direction === "inbound").slice(-8).map((h: any) => String(h.transcript || h.body || "")).join("\n");
      // R91 dry run: «مؤجر وما فيه رهن» is a «no» too (the «و» stuck to «ما»)
      const neg = (re: RegExp) => new RegExp(`(^|\\s)و?(ما|مو|مب|ماهو|مافي|بدون|لا|ولا|ليس|غير|مش)\\s*(هو\\s*|هي\\s*|في\\s*|فيه\\s*|عليه\\s*|عليها\\s*|فيها\\s*)?(${re.source})`);
      const HEIRS = /(مال|حق|ملك|باسم|بين)\s*(ال)?ورث|(البيت|العقار|الارض|الأرض|الفيلا|المزرعة)\s*(هذا\s*|هذي\s*)?(ال)?ورث|للورث|ورثة\s*(ابو|أبو|والد|المرحوم)|تركة|تركه/;
      const MORTGAGED = /مرهون|مرهونة|(عليه|عليها|فيه|فيها|في)\s*رهن/;
      // R91 (Ahmed 16 Nov 2026): «مسكون» means the owner or his family live in it. A rented property (a tenant lives in it) is
      // taken as usual, so the owner's line that names a tenant or a rent never counts as lived in.
      const OCCUPIED = /ساكنين\s*(فيه|فيها|في البيت)|(انا|أنا|احنا|نحن|اهلي|أهلي|عيالي|عائلتي|العايلة|العائلة|الاهل|الأهل)\s*(ساكن|ساكنين)|مسكون|مسكونة/;
      const RENTED = /مستأجر|مستاجر|مأجر|ماجر|مؤجر|موجر|ايجار|إيجار|اجار|أجار|للإيجار|ساكن\s*فيه\s*(واحد|ناس|عايلة|عائلة|اجانب|أجانب|وافد)/;
      const says = (re: RegExp) => re.test(ownerSaid) && !neg(re).test(ownerSaid);
      const ownerLives = ownerSaid.split("\n").some((l: string) => OCCUPIED.test(l) && !neg(OCCUPIED).test(l) && !RENTED.test(l));
      const heirs = says(HEIRS), held = says(MORTGAGED) || ownerLives;
      if (heirs || held) {
        texts = [heirs ? "نعتذر منك احنا ما نستلم عقارات الورثة" : "نعتذر منك احنا ما نستلم عقارات مرهونة او ساكن فيها صاحبها","الله يسعدك 🌷"];
        out.action = "none"; out.guard_owner_decline = heirs ? "heirs" : "mortgaged_or_occupied";
      }
      // dry run rows 1046-1085 (17 Nov): «تعرض فيلا للبيع مسكونه سنه» (lived in for a year: its age) got the R91 apology from
      // the model itself. When «مسكون» only gives how long it was lived in, and nothing else says the owner lives there or it is
      // mortgaged or heirs', the owner is asked R91's question instead.
      const LIVED_AGE = /مسكون[هة]?\s*(من\s*|لمد[ةه]\s*)?(سن[هة]|سنتين|شهور|[0-9٠-٩]+\s*(سن|شه))/;
      if (!heirs && !says(MORTGAGED) && LIVED_AGE.test(ownerSaid) && !ownerSaid.replace(LIVED_AGE, " ").split("\n").some((l: string) => OCCUPIED.test(l) && !neg(OCCUPIED).test(l) && !RENTED.test(l))
        && texts.some((t) => /ساكن\s*فيها\s*صاحبها|ما\s*نستلم\s*عقارات\s*(مسكون|ساكن)/.test(t))) {
        texts = ["البيت الحين فاضي ولا مؤجر ولا ساكنين فيه ؟"]; out.action = "none"; delete out.guard_owner_decline; out.guard_lived_age = true;
      }
    }
    // R92 (Ahmed 17 Nov 2026 evening: an owner who says he will move in later if it does not sell, «بسكن فيها من بداية شهر ١٢»,
    // is taken, not declined: «اذا تريد تعرض معانا… ما يصير بعدين تسكن في البيت، لازم تنتظر شوية… واذا ما بتاع… عندك الحرية
    // التامة»). Also the «مسكونه سنه» case when the apology came from the model itself (the block above only runs when the model
    // did not decline). Never over a mortgage, heirs, or the owner living there now.
    if (out.category === "seller" && !review && out.action !== "handoff") {
      const said2 = history.filter((h: any) => h.direction === "inbound").slice(-8).map((h: any) => String(h.transcript || h.body || "")).join("\n");
      const declinedLived = texts.some((t) => /ساكن\s*فيها\s*صاحبها|ما\s*نستلم\s*عقارات\s*(مسكون|ساكن)/.test(t));
      const mortgaged2 = /مرهون|(عليه|عليها|فيه|فيها|في)\s*رهن/.test(said2) && !/(^|\s)و?(ما|مو|مب|بدون|لا|مافي)\s*(في\s*|فيه\s*|عليه\s*|عليها\s*)?(رهن|مرهون)/.test(said2);
      const heirs2 = /(مال|حق|ملك|باسم|بين)\s*(ال)?ورث|ورثة|تركة|تركه/.test(said2);
      const LIVED_AGE2 = /مسكون[هة]?\s*(من\s*|لمد[ةه]\s*)?(سن[هة]|سنتين|شهور|[0-9٠-٩]+\s*(سن|شه))/;
      const FUTURE_LIVE = /(^|\s)(بسكن|بنسكن|بسكنها|بنسكنها|راح\s*(اسكن|نسكن)|ناوي\s*(اسكن|نسكن)|ننوي\s*نسكن|بنتقل\s*(فيه|فيها|له|لها))/;
      const NOW_LIVE = /ساكنين\s*(فيه|فيها|في\s*البيت)|(انا|أنا|احنا|نحن|اهلي|أهلي|عيالي|عائلتي|الاهل|الأهل)\s*(ساكن|ساكنين)|حاليا\s*ساكن/;
      const nowLives = said2.split("\n").some((l: string) => NOW_LIVE.test(l) || (/مسكون/.test(l) && !LIVED_AGE2.test(l) && !/مستأجر|مستاجر|مؤجر|موجر|ايجار|إيجار/.test(l)));
      const FUTURE_LINE = "اذا تبي تعرضه معانا لازم يظل البيت فاضي فترة التسويق واذا ما انباع بعدين لك الحرية تسكن فيه";
      if (!mortgaged2 && !heirs2 && !nowLives) {
        if (FUTURE_LIVE.test(said2)) {
          const told = history.some((h: any) => h.direction === "outbound" && String(h.body || "").includes("لازم يظل البيت فاضي"));
          if (declinedLived) { texts = [FUTURE_LINE, "يناسبك ؟"]; out.action = "none"; delete out.guard_owner_decline; out.guard_future_live = true; }
          else if (!told && texts.length) { texts = [FUTURE_LINE, ...texts]; out.guard_future_live = true; }
        } else if (declinedLived && LIVED_AGE2.test(said2)) {
          texts = ["البيت الحين فاضي ولا مؤجر ولا ساكنين فيه ؟"]; out.action = "none"; delete out.guard_owner_decline; out.guard_lived_age = true;
        }
      }
    }
    // R23, measured only: a soft handoff that leaves the customer with no reply is marked, so it can be counted
    if (out.action === "handoff" && !texts.length && !HARD_HANDOFF.test(String(out.handoff_reason || "")) && !/^\s*طلب اتصال/.test(String(out.handoff_reason || ""))) out.soft_handoff_no_reply = true;
    // Ahmed 14 Nov: «حصلت» / «اشتريت» after our «لين الحين تبحث ؟» means the search is over. No reply and no «مبروك»; the
    // client's active requests are closed further down and Ahmed gets a note in the CRM. «ما حصلت» is not that.
    let lastOutBody = "";
    for (const h of history) if (h.direction === "outbound") lastOutBody = String(h.body || "");
    const FOUND_RE = /(^|\s)(حصل|حصلت|حصلنا|لقيت|لقينا|اشتريت|اشترينا|شريت|شرينا|وقفت\s*البحث)(\s|$|[.!،,])/;
    const NOT_FOUND_RE = /(^|\s)(ما|مب|مو|لسا|لسه|بعدني|بعدنا|لا)\s+(حصل|لقي)/;
    // 15 Nov 2026 (dry run on 124 chats: «وجدت خيار مناسب», «اخذت بيت في سيب», «حصلنا فيلا بقيمه أقل», «حاليا متوقف عن
    // الشراء» came as answers to our other follow-ups, «انحجزت وحدة منها…» and «ما متوفره حالياً بس عندنا…», and the requests
    // stayed open): the same R50 after any follow-up of ours, but only when the client names what he found (a property word)
    // or says he stopped buying, so «حصلت رقمكم» after an offer is not read as the end of the search.
    const FOLLOWUP_SAID = /لين الحين (تبحث|تدور)|خيارات ثاني[ةه]|انحجزت وحد[ةه]|ما متوفر[ةه] حالياً|[اأ]رسلك تفاصيل|عندنا (فيلا|بيت|شق[ةه]|[اأ]رض|منزل)/;
    const FOUND_THING_RE = /(^|\s)((حصل(ت|نا)?|لقي(ت|نا)|اشتري(ت|نا)|شري(ت|نا)|وجد(ت|نا)|[اأ]خذ(ت|نا)|خذي(ت|نا))\s*(لي\s*|لنا\s*)?(خيار|بيت|فيلا|فل[ةه]|شق[ةه]|[اأ]رض|منزل|عقار)|(متوقف(ين)?|وقف(ت|نا))\s*(عن\s*)?(ال)?(شراء|بحث))/;
    if (!NOT_FOUND_RE.test(burstSaid) && !/[؟?]/.test(burstSaid) && out.action !== "handoff"
      // decision 70 (Ahmed 18 Nov 2026): a bare «حصلت» after «نزل عندنا … ممكن يناسب طلبك» is the same R50 (no «الله يسعدك»)
      && ((/لين الحين تبحث|نزل عندنا/.test(lastOutBody) && FOUND_RE.test(burstSaid)) || (FOLLOWUP_SAID.test(lastOutBody) && FOUND_THING_RE.test(burstSaid)))) {
      texts = []; out.action = "none"; out.search_stopped = true;
    }
    // R71 (Ahmed 14 Nov 2026): she booked or bought, we congratulated, and she only closes the talk: no reply, no draft, the search ends
    if (closedAfterBooking(history)) { texts = []; out.action = "none"; out.handoff_reason = null; out.search_stopped = true; out.guard_closed_after_booking = true; }
    // R49 held by code (15 Nov 2026; an absolute rule that was words only, no failure of it was seen in the dry run): the client's
    // last words are thanks only, so the reply is «العفو» alone, with no question, offer or repeated line. Only over a plain reply: not when
    // the model chose to say nothing, not with a handoff or a location going out, and R71 above already took its case.
    const welcome = /[ء-ي]/.test(burstSaid) ? "العفو" : "You're welcome"; // R69: an English-writing client is answered in English
    if (texts.length && out.action === "none" && !out.search_stopped && thanksOnly(burstSaid) && !(texts.length === 1 && String(texts[0]).trim() === welcome)) {
      texts = [welcome]; out.guard_thanks_only = true;
    }
    // the ad text goes once per conversation: if a long office message about this property already went out, drop it
    if (prop) {
      const priceKey = prop.price ? String(Math.round(Number(prop.price) / 1000)) : "";
      // same price is not enough (7 Nov: the Sowmhan 69 ad counted as the Shakhakheet 69 ad and the customer got nothing):
      // the old ad must also name this property's area
      const areaKey = String(prop.area || "").replace(/^(ولاية|بركاء|مسقط)\s+/, "").split(/\s+/)[0].replace(/^ال/, "");
      // and its land size (8 Nov: the sold Rumais 59 villa 300 m² ad counted as the ad of the Rumais 59 villa 305 m² offered instead)
      const sizeKey = prop.land_size ? String(Math.round(Number(prop.land_size))) : "";
      const sentAd = history.some((h: any) => h.direction === "outbound" && String(h.body || "").length > 250
        && (!priceKey || String(h.body).replace(/[,٬]/g, "").includes(priceKey))
        && (!areaKey || String(h.body).includes(areaKey))
        && (!sizeKey || String(h.body).includes(sizeKey)));
      // Moe (6 Nov): a short summary went out and he asked for the full details "like the first one":
      // when the customer asks for more / complete details, the full ad may go again.
      let lastOutIdx = -1; history.forEach((h: any, i: number) => { if (h.direction === "outbound") lastOutIdx = i; });
      const askedFull = history.slice(lastOutIdx + 1).some((h: any) => h.direction === "inbound"
        && /تفاصيل|كامل|مختصر|ناقص|اكثر|أكثر|زياده|زيادة|مثل الاول|مثل الأول|details|more info/i.test(String(h.transcript || h.body || "")));
      if (sentAd && !askedFull) texts = texts.filter((t) => t.length <= 250);
      // after the ad, always ask when they can visit (unless the action already books it)
      const hasAd = texts.some((t) => t.length > 250);
      const asksVisit = texts.some((t) => /تزور|الزيارة|زياره|تشوف/.test(t));
      const waitsBank = /تمويل|البنك|بنك/.test(String(out.request?.followup_note || ""));
      // not after closing words, and not when the visit is already with the owner or was already asked about
      const onlyClosing = texts.every((t) => t.length < 25 && /العفو|الله يسعدك|مبروك|تسلم|حياك/.test(t));
      const visitHandled = history.some((h: any) => h.direction === "outbound" && /تزور|زيار|المالك مباشرة|نسق مع المالك|\[contacts\]/.test(String(h.body || "") + (h.message_type === "contacts" ? "[contacts]" : "")));
      // (dry run rows 777-816, 17 Nov: «الفيلا اللي ارسلتها ما متوفره حالياً» + «متى يناسبك تزور ؟» with nothing else offered)
      const goneOnly = texts.some((t) => t.length <= 200 && /ما\s*متوفر|انباع/.test(t)) && !texts.some((t) => t.length > 250 || /عندنا|المتبقي/.test(t));
      if (texts.length && !onlyClosing && !waitsBank && (hasAd || sentAd) && !asksVisit && !goneOnly && out.action === "none" && !visitHandled) texts.push("متى يناسبك تزور ؟");
    }
    // ---- R66 (Ahmed 14 Nov 2026, note 85d613bb; changes R22): Barka is not offered to every client of the Muscat number ----
    // «اذا تقبل بركاء عندنا …» and «تحب ارسلك تفاصيلها ؟» are taken out unless he said he looks in المعبيلة or near Barka. A client
    // who named his area gets «اول ما يتوفر بتواصل معك» (R53); one who has not is asked where he looks. Not over a handoff.
    if (conv.route_key === "muscat" && out.action === "none" && texts.some((t) => t.length <= 250 && R66_BARKA_OFFER.test(t))) {
      const saidAll = history.filter((h: any) => h.direction === "inbound").map((h: any) => String(h.transcript || h.body || "")).join(" ");
      if (!nearBarka(saidAll, props.filter((p: any) => p.branch_key === "barka").map((p: any) => p.area))) {
        texts = texts.filter((t) => !(t.length <= 250 && (R66_BARKA_OFFER.test(t) || R66_DETAILS_ASK.test(t))));
        const line = (out.request?.areas || []).length ? "اول ما يتوفر بتواصل معك" : "في اي منطقة تبحث ؟";
        if (!texts.includes(line)) texts.push(line);
        out.guard_barka_offer = true;
      }
    }
    // ---- R62 (note of 14 Nov 2026, مرام, chat KLD): «عندك قناة في يوتيوب ؟» about a property ----
    // The reel is the whole video; the answer is the fixed pair «الافضل تشوف العقار على الطبيعة…» + the visit question, like the
    // photo request (R34). Only for a buyer or tenant on an available property he has not visited, when the reply is a plain
    // one (no handoff, no location going out). The branch rule (R48) still runs after this and takes the visit question out.
    if (YOUTUBE_ASK.test(burstSaid) && texts.length && prop && !visitedIds.has(prop.id) && ["buyer", "tenant"].includes(out.category) && out.action === "none"
      && !texts.some((t) => /على الطبيع[ةه]/.test(t))) {
      texts = texts.filter((t) => !(t.length < 90 && /(تزور|تزورون|تزورين|يناسبك)\s*؟/.test(t)) && !(t.length <= 250 && YOUTUBE_ASK.test(t)));
      texts.push(...YOUTUBE_LINES);
      out.guard_youtube = true;
    }
    // ---- R56 (Ahmed 14 Nov 2026): a property outside Muscat and Barka is declined, whatever the model wrote ----
    // Also over a «دراسة سعر:» handoff (13 Nov: two lands in Salalah were sent to pricing). Not over another handoff, not when
    // the lines are already in the reply, and never in a chat where the office wrote itself (a property Ahmed brought).
    if (out.category === "seller" && !texts.some((t) => OUT_OF_AREA_SAID.test(t)) && (out.action !== "handoff" || /^\s*دراسة سعر/.test(String(out.handoff_reason || "")))
      && !history.some((h: any) => h.direction === "outbound" && h.actor_type === "human")) {
      const place = outsideArea(out.owner_offer?.area, out.owner_offer?.wilayat);
      if (place) {
        // 15 Nov (dry run): the apology already went out in this chat (the owner only reacted to it): it is not sent twice
        const told = history.some((h: any) => h.direction === "outbound" && OUT_OF_AREA_SAID.test(String(h.body || "")));
        const salam = texts.find((t) => /^وعليكم السلام/.test(String(t).trim()));
        texts = told ? [] : [...(salam ? [salam] : []), ...OUT_OF_AREA_LINES, ...(salam ? [] : ["الله يسعدك 🌷"])];
        out.action = "none"; out.handoff_reason = null; out.guard_owner_area = place;
        if (told) out.guard_owner_area_repeat = true;
      }
    }
    // the visit question is its own message, never glued to the end of an ad (7 Nov, Ahmed)
    texts = texts.flatMap((t) => {
      const lines = t.split("\n");
      const last = lines[lines.length - 1] || "";
      return lines.length > 2 && /(تزور|تزورون|تزورين|الزيارة|تشوفه|تشوفها)\s*؟?\s*$/.test(last) && last.length < 90
        ? [lines.slice(0, -1).join("\n"), last] : [t];
    });
    // one visit question is enough
    // R74 to R79: Ahmed's decisions of 15 Nov 2026 (ownerDecisions above). The branch rule (R48) still runs after this.
    texts = ownerDecisions(out, texts, { history, burstSaid, prop, visitedProp: !!prop && visitedIds.has(prop.id), visitedAny: !out.property_id && visitedIds.size > 0, visitedSome: visitedIds.size > 0,
      saidVisited: history.some((h: any) => h.direction === "inbound" && SAID_VISITED.test(String(h.transcript || h.body || ""))),
      handoffOpen: !!conv.human_handoff_required, hardHandoff: HARD_HANDOFF.test(String(out.handoff_reason || "")),
      gone: goneRows, available: props, route: String(conv.route_key || ""), typeLabel: typeAr, msgType: msg.message_type,
      budget: Number(out.request?.budget_max || client?.budget_max || 0) || null });
    // R114 guard (18 Nov audit, Raiaheen «فلا الرميس قابله للتفاوض؟»): a question about a villa got the rest house ad (the rest
    // house is the only available property in that area and its ad says «فيلا مصممة كاستراحة»). The brain rule alone did not
    // hold in the dry run. A client who asks about a villa and never spoke of a rest house, with no budget that reaches the
    // rest house, is not shown it: if a villa in that area is sold or reserved he hears that (the sold rule, the notice's own
    // second line), otherwise the rest house lines are taken out and, if nothing is left, he is asked for the ad link.
    {
      const said = String(burstSaid || "");
      const villaAsk = /(^|[\s،,])(ال)?(فيلا|ڤيلا|في?ل[ةه]|فلا|ڤل[ةه]|فلل)($|[\s،,؟?!.])/.test(said);
      const restSaid = /استراح/.test(said) || history.some((h: any) => h.direction === "inbound" && /استراح/.test(String(h.transcript || h.body || "")));
      const rest = props.find((p: any) => p.type === "resthouse" && (p.id === out.property_id || texts.some((t) => /استراح/.test(t))));
      const budget = Number(out.request?.budget_max || client?.budget_max || 0);
      if (villaAsk && !restSaid && rest && texts.some((t) => /استراح/.test(t)) && !(budget && budget >= Number(rest.price || 0) * 0.92)) {
        const sameArea = (a: any) => { const x = String(a || ""), y = String(rest.area || ""); return !!x && !!y && (x.includes(y) || y.includes(x)); };
        const goneVilla = soldRows.find((s: any) => ["villa", "twin_villa", "house"].includes(String(s.type)) && sameArea(s.area));
        // (reply audit 22 Nov, Azza 4b7e6a19 «متوفر معكم فلل ف الرميس او حي عاصم او حلبان ؟»: a general search named no villa, so
        // «الفيلا اللي سألت عنها انحجزت» was wrong; she hears there are none there and the budget question)
        const general = /فلل|متوفر/.test(said) && !/https?:\/\//.test(said) && !history.slice(burstStart).some((h: any) => h.direction === "inbound" && h.message_type === "image");
        if (goneVilla && general) {
          texts = [`${out.guard_how_are_you ? "الحمدلله\n" : ""}حالياً ما عندنا فلل متوفره في ${rest.area}`, "في حدود كم ميزانيتك ؟"];
        } else if (goneVilla) {
          texts = [`الفيلا اللي سألت عنها ${goneVilla.status === "reserved" ? "انحجزت" : "انباعت"}`, "تحب تشوف خيارات ثانية ؟"];
        } else {
          texts = texts.map((t) => t.length > 200 && /استراح/.test(t) ? "" : t.split("\n").filter((l) => !/استراح/.test(l)).join("\n").trim()).filter(Boolean);
          if (!texts.length) texts = ["ارسل لي رابط الاعلان او صورة منه عشان ارسلك التفاصيل والسعر بالضبط"];
        }
        if (out.property_id === rest.id) out.property_id = null;
        out.action = "none"; out.handoff_reason = null; out.guard_no_resthouse_for_villa = true;
      }
    }
    let askedOnce = false;
    texts = texts.filter((t) => { const q = t.length < 90 && /(تزور|تزورون|تزورين)\s*؟/.test(t); if (!q) return true; if (askedOnce) return false; askedOnce = true; return true; });
    // R22 / R116 last check (reply audit 22 Nov, اسماء الهنائي 35bb3ae0, dry run: the question the model wrote was taken out by a
    // later step and the offer went with none): a buyer offered the nearest home ends with a question
    if (out.action === "none" && out.category === "buyer" && texts.length && !texts.some((t) => /[؟?]/.test(t))
      && texts.some((t) => /(اقرب|أقرب)\s*شي/.test(t) && /\d/.test(t))) {
      texts.push(/[0-9٠-٩]/.test(String(burstSaid || "")) || out.request?.budget_max ? "تقدر تزيد شوي ؟" : "متى يناسبك تزور ؟"); out.guard_budget_question = true;
    }
    // keep the question even when there are two ads
    if (texts.length > 3) { const q = texts.find((t) => t.length < 90 && /تزور|تزيد\s*شوي/.test(t)); texts = q ? [...texts.filter((t) => t !== q).slice(0, 2), q] : texts.slice(0, 3); }
    out.reply_messages = texts.slice(0, 3);
    // decision 42: the skipped sold notice opens the first reply, once (not over silence, an ignored chat or a line that already says it)
    if (soldLine && out.reply_messages.length && !ignored) {
      if (!out.reply_messages.some((t: string) => /انحجز|انباع|ابتاع/.test(t))) out.reply_messages = [soldLine, ...out.reply_messages];
      // (dry run 18 Nov, 0e02cf11: the notice said «انحجزت» and the model wrote «انباعت»: the notice's own line is used)
      else {
        const i = out.reply_messages.findIndex((t: string) => t.length <= 120 && /انحجز|انباع|ابتاع/.test(t));
        if (i >= 0 && out.reply_messages[i] !== soldLine) out.reply_messages[i] = soldLine;
      }
      out.sold_told = true;
    }
    // a pinned reply only counts when the id is real
    const rule = (rulesR.data || []).find((r: any) => r.id === out.matched_rule_id) || null;
    out.matched_rule_id = rule?.id || null;
    out.variant_label = rule ? pickedVariant[rule.id].label : null;
    // other ways to say it, for the owner to pick from (investors)
    out.alternatives = (out.alternatives || []).map((a: string[]) => (a || []).map((t) => humanize(t)).filter(Boolean).slice(0, 3)).filter((a: string[]) => a.length).slice(0, 2);
    // the location, lockbox photo and owner's number go after the text; the list that is really sent is built further down
    // from the FINAL reply (after the R9 redirect and arabicOnly), so what the draft records is what the customer gets (10 Nov)
    const actionMsgs: any[] = [];

    if (out.action === "send_location" || out.action === "send_lockbox") {
      // (R74 may pick the property by area when the model gave none: then it is out.property_id)
      const mapProp = prop || props.find((p: any) => p.id === out.property_id);
      if (mapProp?.map_url) actionMsgs.push({ type: "text", text: { preview_url: true, body: mapProp.map_url } });
      else { out.action = "handoff"; out.handoff_reason = "العميل يبي يزور واللوكيشن غير مسجل للعقار"; }
    }
    if (out.action === "send_lockbox") {
      const lockLink = prop?.lockbox_image_url ? await lockboxLink(prop.lockbox_image_url) : "";
      if (lockLink) actionMsgs.push({ type: "image", image: { link: lockLink } });
      else { out.action = "handoff"; out.handoff_reason = "معاينة بصندوق مفتاح وصورة الرمز غير مرفوعة"; }
    }
    if (out.action === "send_owner_number") {
      if (prop?.visit_method === "owner_lives" && prop.owner_id) {
        const o = await db.from("owners").select("phone").eq("id", prop.owner_id).maybeSingle();
        // the location goes with the owner's number: the customer arranges the visit with him directly
        if (prop.map_url) actionMsgs.push({ type: "text", text: { preview_url: true, body: prop.map_url } });
        if (o.data?.phone) actionMsgs.push({ type: "text", text: { preview_url: false, body: digits(o.data.phone) } });
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
      // 14 Nov: a pinned reply never goes out over a reply a code guard just corrected (the pinned text is applied after the guards)
      if (ruleAuto && (out.search_stopped || Object.keys(out).some((k) => k.startsWith("guard_")))) ruleAuto = false;
      // the pinned wording is sent as it is, with no link preview (the send list is rebuilt from it below)
      if (ruleAuto) out.reply_messages = String(pickedVariant[rule.id].reply).split("\n").map((t) => t.trim()).filter(Boolean).slice(0, 3);
    }
    if (out.reply_messages.some((t: string) => PROMISE_RE.test(t))) {
      out.reply_messages = out.reply_messages.filter((t: string) => !PROMISE_RE.test(t));
      if (out.action === "none") { out.action = "handoff"; out.handoff_reason ||= short(out.intent || out.crm_note, 300); }
    }
    // R12: the call promise that was taken out reaches Ahmed as a call request, never as silence
    if (callPromised && out.action === "none") {
      out.action = "handoff";
      out.handoff_reason = /^\s*طلب اتصال/.test(String(out.handoff_reason || "")) ? out.handoff_reason : `طلب اتصال: ${short(out.intent || out.crm_note, 280)}`;
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
        const row: any = { kind: o.kind, area: o.area, wilayat: o.wilayat, price: o.price, land_size: o.land_size, built_size: o.built_size, notes: short(out.crm_note, 1000), updated_at: new Date().toISOString() };
        // R46: the owner's answer to «المفتاح وين يكون ؟» is kept on the offer (SQL100 columns) and never wiped by a later empty answer
        if (o.visit_method && ["open", "lockbox", "office"].includes(o.visit_method)) row.visit_method = o.visit_method;
        if (String(o.visit_instructions || "").trim()) row.visit_instructions = short(o.visit_instructions, 300);
        // R91 (Ahmed 16 Nov 2026): a rented property is taken; the inspection is arranged with the tenant through the owner
        const ownerLines = history.filter((h: any) => h.direction === "inbound").slice(-8).map((h: any) => String(h.transcript || h.body || "")).join("\n");
        if (!row.visit_method && /مستأجر|مستاجر|مؤجر|موجر|مأجر|ماجر/.test(ownerLines) && !/(ما|مو|مب|مش|غير)\s*(مؤجر|موجر|مأجر|ماجر)/.test(ownerLines)) {
          row.visit_method = "office";
          if (!row.visit_instructions) row.visit_instructions = "مؤجر: المعاينة تنسيق مع المستأجر عن طريق المالك";
        }
        // SQL101: electricity and water as the owner said them; an empty answer never wipes a saved one
        if (["yes", "no"].includes(o.electricity)) row.electricity_connected = o.electricity;
        if (["yes", "no"].includes(o.water)) row.water_connected = o.water;
        if ((ex.data || []).length) await db.from("owner_leads").update(row).eq("id", ex.data![0].id);
        else await db.from("owner_leads").insert({ ...row, company_id: msg.company_id, client_id: client.id, conversation_id: conv.id });
        await db.rpc("crm_match_owner_leads");
        // SQL101: a property of this owner already in the CRM takes the electricity / water answer where the office left it empty
        if (row.electricity_connected || row.water_connected) {
          const ow2 = await db.from("owners").select("id,phone").eq("company_id", msg.company_id).limit(2000);
          const ids2 = (ow2.data || []).filter((x: any) => digits(x.phone).slice(-8) && digits(x.phone).slice(-8) === to.slice(-8)).map((x: any) => x.id);
          if (ids2.length) {
            if (row.electricity_connected) await db.from("properties").update({ electricity_connected: row.electricity_connected }).in("owner_id", ids2).eq("archived", false).is("electricity_connected", null);
            if (row.water_connected) await db.from("properties").update({ water_connected: row.water_connected }).in("owner_id", ids2).eq("archived", false).is("water_connected", null);
          }
        }
        // R46: a property of this owner already in the CRM without a way in gets the same answer (never over what the office wrote)
        if (row.visit_method || row.visit_instructions) {
          const ow = await db.from("owners").select("id,phone").eq("company_id", msg.company_id).limit(2000);
          const ids = (ow.data || []).filter((x: any) => digits(x.phone).slice(-8) && digits(x.phone).slice(-8) === to.slice(-8)).map((x: any) => x.id);
          if (ids.length) {
            const pr = await db.from("properties").select("id,visit_method,visit_instructions").in("owner_id", ids).eq("archived", false).is("visit_method", null).limit(5);
            for (const p of pr.data || []) await db.from("properties").update({ visit_method: row.visit_method || null, visit_instructions: p.visit_instructions || row.visit_instructions || null }).eq("id", p.id).is("visit_method", null);
          }
        }
      } catch (e) { console.error("[reply-agent] owner lead", String((e as any)?.message || e)); }
    }
    // an owner sent everything (kroki or house details, and the price): a price study goes on Ahmed's task list
    if (!review && out.action === "handoff" && /^دراسة سعر/.test(String(out.handoff_reason || "")) && !out.reply_messages.some((t: string) => DECLINE_RE.test(t))) {
      try {
        const o = await db.from("profiles").select("id").eq("company_id", msg.company_id).eq("role", "owner").eq("is_active", true).limit(1).maybeSingle();
        const open = await db.from("tasks").select("id").eq("client_id", client.id).ilike("title", "دراسة سعر%").eq("done", false).limit(1);
        if (!(open.data || []).length) await db.from("tasks").insert({ company_id: msg.company_id, user_id: o.data?.id || null, client_id: client.id, title: short(out.handoff_reason, 200), notes: short(out.crm_note, 1000), due_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10), done: false });
      } catch (e) { console.error("[reply-agent] task", String((e as any)?.message || e)); }
    }
    if (redo) {
      // a rewrite that leaves nothing to send is closed too (Ahmed 14 Nov): an empty reply never waits for approval
      if (!out.reply_messages.length) return json(await closeDraft(draftId, analysis, redo.instruction, redo.by));
      // only while it still waits: if it was sent or rejected meanwhile, nothing changes
      const u = await db.from("whatsapp_reply_drafts").update({ analysis, reply_messages: out.reply_messages }).eq("id", draftId).eq("status", "pending").select("id");
      if (!(u.data || []).length) return json({ ok: false, error: "draft_not_pending" }, 409);
      return json({ ok: true, status: "rewritten", reply_messages: out.reply_messages, action: out.action, analysis });
    }
    // the agent's own memory (contract C, 10 Nov): its running note and its read of the client's seriousness, kept apart from ai_summary
    // (the webhook overwrites that with a one-message summary). Live runs only, and only the columns that exist (agent-sql adds them).
    if (!review) {
      try {
        const mem: any = {};
        // an empty note never wipes what the agent already knows about the client
        if ("agent_note" in conv && String(out.crm_note || "").trim()) mem.agent_note = short(out.crm_note, 1500);
        if ("agent_seriousness" in conv) mem.agent_seriousness = ["strong", "possible", "weak", "unknown"].includes(out.seriousness) ? out.seriousness : "unknown";
        if ("agent_seriousness_reason" in conv) mem.agent_seriousness_reason = short(out.seriousness_reason, 300) || null;
        if ("agent_profile_at" in conv) mem.agent_profile_at = new Date().toISOString();
        if (Object.keys(mem).length) {
          const mw = await db.from("whatsapp_conversations").update(mem).eq("id", conv.id);
          if (mw.error) console.error("[reply-agent] memory", mw.error.message);
        }
      } catch (e) { console.error("[reply-agent] memory", String((e as any)?.message || e)); }
    }
    // an owner Ahmed is handling himself: he typed in this chat after it was last handed back to the agent, or a price study for
    // him is open. Decision 67 (Ahmed 18 Nov 2026: «يسكت لين أرجعها»): R1 wins, so the old 72-hour limit (note f229cffe, 10 Nov)
    // is gone; any typed office message since the hand-back counts. The polite declines (heirs, occupied, mortgaged: R10 / R20) always go out.
    const backAt = conv.agent_returned_at ? new Date(conv.agent_returned_at).getTime() : 0;
    const ahmedTyped = history.some((h: any) => h.direction === "outbound" && h.actor_type === "human" && new Date(h.message_timestamp).getTime() > backAt);
    const priceStudyOpen = !!conv.human_handoff_required && /^\s*دراسة سعر\s*:/.test(String(conv.handoff_reason || ""));
    const declining = out.reply_messages.some((t: string) => DECLINE_RE.test(t));
    const ownerWithAhmed = out.category === "seller" && !declining && (ahmedTyped || priceStudyOpen);
    analysis.owner_with_ahmed = ownerWithAhmed;
    // R37 (Ahmed 11 Nov 2026, SQL94): a property we do not take (heirs, mortgaged, occupied: the polite decline of R10 / R20)
    // closes its owner offer with the reason, so it leaves the open offers; no price study task is opened for it (above).
    // A property Ahmed brought himself is never declined by the brain, so it never comes here. The reply is not changed.
    if (!review && out.category === "seller" && declining) {
      try {
        const reply = out.reply_messages.join(" ");
        const ownerSaid = `${history.filter((h: any) => h.direction === "inbound").slice(-8).map((h: any) => String(h.transcript || h.body || "")).join(" ")} ${out.crm_note || ""}`;
        // R91: a tenant is not «مسكون» (a rented property is taken), so only the owner's living there counts
        const mortgaged = /مرهون|رهن/.test(ownerSaid), occupied = /مسكون|ساكن/.test(ownerSaid);
        const why = OUT_OF_AREA_SAID.test(reply) ? "خارج مسقط وبركاء" : /ورث|ترك[ةه]/.test(reply) ? "ورثة" : mortgaged && occupied ? "مرهون ومسكون" : mortgaged ? "مرهون" : occupied ? "مسكون" : "مرهون أو مسكون";
        analysis.owner_offer_closed = why;
        const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Muscat" }).format(new Date());
        const openLeads = await db.from("owner_leads").select("id,notes").eq("conversation_id", conv.id).eq("status", "open");
        for (const l of openLeads.data || []) {
          await db.from("owner_leads").update({ status: "closed", notes: [l.notes, `ما نستلم: ${why} (${day})`].filter(Boolean).join("\n").slice(0, 2000), updated_at: new Date().toISOString() }).eq("id", l.id);
        }
      } catch (e) { console.error("[reply-agent] decline closes the offer", String((e as any)?.message || e)); }
    }
    if (!review && ownerWithAhmed) {
      await db.from("whatsapp_reply_drafts").update({ analysis, reply_messages: out.reply_messages, status: "skipped", error: "owner_with_ahmed" }).eq("id", draftId);
      return json({ ok: true, ignored: "owner_with_ahmed" });
    }
    // a client who just came from a project video (a project reel among the messages being answered) is an investor (R9).
    // 10 Nov: an old project reel further up no longer turns a later Barka listing question into the redirect, now that the
    // redirect is really sent (once per chat)
    let burstFrom = 0;
    history.forEach((h: any, i: number) => { if (h.direction === "outbound") burstFrom = i + 1; });
    const reelKeyOf = (h: any) => fbOf[h.id]?.key || String(h.property_link_key || "") || ((String(h.body || "").match(IG_RE) || [])[1] ? `instagram:${String(h.body).match(IG_RE)![1]}` : "");
    if (history.slice(burstFrom).some((h: any) => h.direction === "inbound" && reels[reelKeyOf(h)]?.project)) { out.category = "investor"; analysis.project_reel_investor = true; }
    // 8 Nov (Ahmed): investors and owners of Muscat-area properties who write to the Barka number are sent to the Muscat number (R9), nothing is held
    const MUSCAT_AREAS = /(الحيل|الخوض|السيب|بوشر|العامرات|مطرح|قريات|المعبيلة|الموالح|مسقط|الأنصب|الانصب|مدينة السلطان)/;
    const muscatOwner = out.category === "seller" && MUSCAT_AREAS.test(`${(out as any).owner_offer?.area || ""} ${(out as any).owner_offer?.wilayat || ""}`);
    const redirectToMuscat = conv.route_key === "barka" && (out.category === "investor" || muscatOwner);
    if (redirectToMuscat) {
      const salam = (out.reply_messages || []).find((r: string) => /^وعليكم السلام/.test(String(r).trim()));
      const line = out.category === "investor" ? "الاستثمار والمشاريع تتابعها معنا على رقم مسقط 71770030 واتساب" : "عقارك تتابعه معنا على رقم مسقط 71770030 واتساب";
      // once per chat (10 Nov), counted from this line only: the brain's «طلبك / هذا العقار تتابعه معنا على رقم مسقط» lines are about a request
      // or a listing (most Barka chats that already have the Muscat number got one of those), so they never stand in for this line
      const lineRe = out.category === "investor" ? /الاستثمار والمشاريع\s*تتابعها\s*معنا\s*على\s*رقم\s*مسقط/ : /عقارك\s*تتابعه\s*معنا\s*على\s*رقم\s*مسقط|عقارك\s.*يتابعه\s*رقم\s*فرع\s*مسقط/;
      const lineOut = history.filter((h: any) => h.direction === "outbound" && lineRe.test(String(h.body || "")));
      const redirectSent = lineOut.length > 0;
      const lineRecent = lineOut.some((h: any) => Date.now() - new Date(h.message_timestamp).getTime() < 15 * 60 * 1000);
      const redirectLines = [...(salam ? [salam] : []), line, "هذا الرقم خاص لعقارات بركاء"];
      // R23: a handoff the model chose for negotiation, a serious buyer, a price study or a call request stays as it is, its silence too
      const why = String(out.handoff_reason || "");
      // (R93: «ما يردون» stays with Ahmed too: the same number is not sent again to a client who says it does not answer)
      const keepHandoff = out.action === "handoff" && (HARD_HANDOFF.test(why) || /^\s*(طلب اتصال|ما يردون)/.test(why));
      if (!keepHandoff && !redirectSent) out.reply_messages = redirectLines;
      // otherwise the model's own reply goes (after the line the brain answers and reminds once, and «تمام» gets nothing), but never a
      // project or a figure on the Barka number (R9): such a reply becomes the line again, unless it went out in the last 15 minutes (R14)
      else if (out.reply_messages.length && (out.reply_messages.some((t: string) => /[0-9٠-٩]/.test(t.replace(/71770030|92344273/g, "")))
        || await mentionsProject(msg.company_id, out.reply_messages))) out.reply_messages = !redirectSent ? redirectLines : lineRecent ? [] : [line];
      // a question after the line that the model left unanswered gets the line again as the reminder, at most once in 15 minutes
      else if (!out.reply_messages.length && !keepHandoff && !lineRecent
        && history.slice(burstFrom).some((h: any) => h.direction === "inbound" && /[؟?]/.test(String(h.transcript || h.body || "")))) out.reply_messages = [line];
      // the first redirect closes the topic here (action none); after it, a handoff the model chose stays so Ahmed is told: no silent dead end
      if (!keepHandoff && (!redirectSent || out.action !== "handoff")) out.action = "none";
      analysis.redirected_to_muscat = true;
      if (redirectSent) analysis.redirect_already_sent = true;
      if (keepHandoff) analysis.redirect_kept_handoff = true;
    }
    // R48 (Ahmed 14 Nov 2026): a listed property is followed on its own branch number. The brain says so («العميل اللي كلم الرقم
    // الثاني»), but on 12-14 Nov the model served four chats about Barka properties on the Muscat number (the ad, the video, a pinned
    // «برسلك الموقع», the location and a visit). The code holds it now: no ad, link, location or visit question for a property of the
    // other branch; the customer gets the branch line, once per chat. A short answer keeps going with the line after it, the
    // «اذا تقبل» offer of R22 and a strong handoff (R23) stay as they are.
    const branchOf = (k: any) => k === "barka" ? { name: "بركاء", number: "92344273" } : k === "muscat" ? { name: "مسقط", number: "71770030" } : null;
    const propBranch = branchOf(prop?.branch_key);
    if (!redirectToMuscat && propBranch && branchOf(conv.route_key) && prop.branch_key !== conv.route_key && !out.guard_barka_offer) {
      const bLine = `هذا العقار تتابعه معنا على رقم ${propBranch.name} ${propBranch.number} واتساب`;
      const bOut = history.filter((h: any) => h.direction === "outbound" && String(h.body || "").includes(propBranch.number));
      const bSent = bOut.length > 0;
      const bRecent = bOut.some((h: any) => Date.now() - new Date(h.message_timestamp).getTime() < 15 * 60 * 1000);
      const said = (out.reply_messages || []).map((t: any) => String(t));
      const bWhy = String(out.handoff_reason || "");
      const bKeep = out.action === "handoff" && (HARD_HANDOFF.test(bWhy) || /^\s*طلب اتصال/.test(bWhy));
      const serving = ["send_location", "send_lockbox", "send_owner_number", "book_viewing"].includes(out.action)
        || said.some((t: string) => /https?:\/\//.test(t) || t.length > 220 || /(تزور|تزورون|تزورين|اللوكيشن|الموقع)/.test(t));
      const offer = said.some((t: string) => /[اإ]ذا\s*(تقبل|يناسبك)|تحب\s*[اأ]رسل/.test(t));
      const hasLine = said.some((t: string) => t.includes(propBranch.number));
      if (!bKeep && serving) {
        const salam = said.map((t: string) => t.trim().split("\n")[0]).find((t: string) => /^وعليكم السلام/.test(t));
        out.reply_messages = !bSent ? [...(salam ? [salam] : []), bLine] : bRecent ? [] : [bLine];
        out.action = "none"; out.viewing_date = null; out.viewing_time = null;
        actionMsgs.length = 0;
        analysis.branch_redirect = prop.branch_key; analysis.viewing_date = null; analysis.viewing_time = null;
        if (bSent) analysis.branch_line_already_sent = true;
      } else if (!bKeep && said.length && !hasLine && !bSent && !offer && !(said.length === 1 && /^(العفو|You're welcome)\s*$/.test(said[0]))) {
        out.reply_messages = [...said.slice(0, 2), bLine];
        analysis.branch_redirect = prop.branch_key;
      }
    }
    // no English type codes reach the customer (links are left as they are)
    out.reply_messages = (out.reply_messages || []).map((r: string) => arabicOnly(r));
    // Step F (decision 77, Ahmed 18 Nov 2026): a client (buyer or owner) who wrote to the wrong branch number about the other
    // branch's area is moved there by us: the line «… تتابعه معنا على رقم X واتساب» (brain, R9 for owners, R48) becomes «عقارات
    // {area} يتابعها رقم فرع X {number} وبنرسلك منه» (never «بيتواصل معك»), and the transfer is queued: the right number sends
    // branch_transfer_ar_v1 (APPROVED + UTILITY only) or the same text inside its 24 hours, once its line here went out, and then
    // closes what waited here for that topic (whatsapp-outreach, SQL140). The investor line (R9) stays as it is.
    const stepF = branchTransferLines(out, conv.route_key, prop, branchOf);
    if (stepF) {
      out.reply_messages = stepF.lines;
      // R14 again on the rewritten lines (reply audit 22 Nov, محمد الزدجالي 35b4ef9e: «عقارك في المعبيلة السادسة يتابعه رقم فرع مسقط …»
      // went out twice in two minutes, the model's old wording passed R14 and only became the same line here)
      if (!review) {
        const rec = await db.from("whatsapp_messages").select("body").eq("conversation_id", conv.id).eq("direction", "outbound").neq("delivery_status", "failed")
          .gt("message_timestamp", new Date(Date.now() - 15 * 60 * 1000).toISOString()).limit(40);
        const nrm = (t: unknown) => String(t || "").replace(/[\s؟?.!،,]+/g, " ").trim();
        const sent = new Set((rec.data || []).flatMap((r: any) => [r.body, ...String(r.body || "").split(/\n\s*\n/)]).map((b: any) => nrm(b)).filter(Boolean));
        const kept = out.reply_messages.filter((t: string) => !(BRANCH_NEW_RE.test(String(t).trim()) && sent.has(nrm(t))));
        if (kept.length !== out.reply_messages.length) { out.reply_messages = kept; analysis.r14_branch_line = true; }
      }
      analysis.branch_transfer = { to: stepF.to, area: stepF.area };
      // nothing of the other branch is served here (no location, lockbox, owner number or visit); a handoff stays
      if (["send_location", "send_lockbox", "send_owner_number", "book_viewing"].includes(out.action)) { out.action = "none"; out.viewing_date = null; out.viewing_time = null; actionMsgs.length = 0; analysis.viewing_date = null; analysis.viewing_time = null; }
      if (!review) {
        const bt = await db.rpc("crm_branch_transfer_queue", { p_conversation: conv.id, p_to_route: stepF.to, p_area: stepF.area });
        analysis.branch_transfer_queue = bt.error ? short(bt.error.message, 200) : bt.data;
      }
    }
    // decision 30 (Ahmed 18 Nov 2026): humanize() strips commas from the model's lines, but lines the code adds after it (fixed
    // lines, pinned replies, the ad text) kept theirs; and «حياك» is banned always. Links and figures («59,000») are left alone.
    out.reply_messages = out.reply_messages.map((r: string) => {
      const urls: string[] = [];
      const s = String(r || "").replace(/https?:\/\/[^\s]+/gi, (u) => { urls.push(u); return `\u0001${urls.length - 1}\u0001`; })
        .replace(/^\s*حياك(\s*الله)?(\s+|$)/, "").replace(/[ \t]*[،,][ \t]*(?!\d)/g, " ").replace(/[ \t]+/g, " ");
      return s.replace(/\u0001(\d+)\u0001/g, (_, i) => urls[Number(i)] || "").trim();
    }).filter((r: string) => r.replace(/[^ء-يA-Za-z0-9]/g, "").length > 0);
    // the draft records the final reply, action and category: whatsapp-reply-send adds the location / owner number from
    // analysis.action when a held draft is approved, so a redirected customer must not get the property location after it
    Object.assign(analysis, { reply_messages: out.reply_messages, action: out.action, category: out.category });
    // 1 (10 Nov): the send list is rebuilt from the FINAL reply, so the R9 redirect and the arabicOnly text are what really goes out
    // (9 Nov: the redirect was recorded in the draft but never sent). The location / lockbox / owner's number follow the text,
    // except after a redirect (that customer is not booked here).
    const outgoingParts: any[] = [...out.reply_messages.map((t: string) => ({ type: "text", text: { preview_url: !ruleAuto && /https?:\/\//.test(t), body: t } })), ...(redirectToMuscat ? [] : actionMsgs)];
    // R54 (Ahmed 14 Nov 2026: «ادمج الفقاعات في رسالة وحدة»): Meta counts every bubble as one service message against the 1,000 free a
    // month per number, so the whole reply goes as ONE text message: the reply lines, then the location link or the owner's number,
    // each part on its own paragraph. Only an image (the lockbox photo) stays a message of its own.
    // decision 17: «كم الساعة تقريباً ؟» goes after the location link, not before it
    if (out.guard_period_hour && !redirectToMuscat) {
      const qi = outgoingParts.findIndex((m: any) => m.type === "text" && /كم\s*الساع[ةه]\s*تقريب/.test(String(m.text.body || "")));
      if (qi >= 0) outgoingParts.push(...outgoingParts.splice(qi, 1));
    }
    const textParts = outgoingParts.filter((m: any) => m.type === "text");
    const outgoing: any[] = [
      ...(textParts.length ? [{ type: "text", text: { preview_url: textParts.some((m: any) => m.text.preview_url), body: textParts.map((m: any) => String(m.text.body)).join("\n\n") } }] : []),
      ...outgoingParts.filter((m: any) => m.type !== "text")];
    const projectNamed = await mentionsProject(msg.company_id, out.reply_messages);
    if (projectNamed) analysis.project_named = true;
    // 9 Nov (Ahmed): investors are answered by the agent too (anything it does not know comes back to him as a handoff); only running deals wait
    const holdForOwner = rt.reply_agent_mode === "direct" && !redirectToMuscat && out.category === "active_deal";
    // 9 Nov (Ahmed): a chat whose customer last wrote more than 24h ago cannot get free text. It goes to «متابعة اليوم» with the proposed text instead of the approval screen.
    // 10 Nov: the R9 redirect is really sent now, so it follows the same rule (Meta refuses free text after 24h)
    if (!review && !dry && (out.reply_messages || []).length) {
      const li = await db.from("whatsapp_messages").select("message_timestamp").eq("conversation_id", conv.id).eq("direction", "inbound").order("message_timestamp", { ascending: false }).limit(1).maybeSingle();
      const lastInMs = li.data?.message_timestamp ? new Date(li.data.message_timestamp).getTime() : 0;
      if (lastInMs && Date.now() - lastInMs > 23.5 * 3600 * 1000) {
        const q = await db.from("whatsapp_outreach_queue").insert({ company_id: msg.company_id, kind: "request_followup", conversation_id: conv.id, client_id: client.id, route_key: conv.route_key, messages: out.reply_messages, status: "pending", reason: "تعدّى 24 ساعة بدون رد: يحتاج رد منك", dry_run: false, summary: short(out.crm_note, 120), scheduled_for: new Date().toISOString(), auto_ok: false, reviewed_at: new Date().toISOString(), review_reason: "تعدّى 24 ساعة بدون رد: افتح المحادثة وارسل الرد المقترح بنفسك", owner_text: out.reply_messages.join("\n") });
        if (!q.error) {
          await db.from("whatsapp_reply_drafts").update({ analysis, reply_messages: out.reply_messages, status: "skipped", error: "outside_24h" }).eq("id", draftId);
          return json({ ok: true, ignored: "outside_24h_to_followups" });
        }
      }
    }
    // inline dry run: the answer and what would be sent come back here, nothing is written (the owner's number is masked).
    // forced_dry shows whether the dry-run copy recognised itself from its URL (true there, false on the live function)
    if (inline) {
      const send_preview = outgoing.map((m: any) => m.type === "text" ? String(m.text.body).split("\n\n").map((p: string) => (/^\d{8,}$/.test(p) ? "[رقم صاحب العقار]" : p)).join("\n\n") : "[صورة صندوق المفتاح]");
      return json({ ok: true, inline: true, forced_dry: forcedDry, reply_messages: out.reply_messages, action: out.action, handoff_reason: out.handoff_reason ?? null, category: out.category,
        seriousness: out.seriousness ?? "unknown", seriousness_reason: out.seriousness_reason ?? "", meeting: out.meeting ?? null, mustahiq_waitlist: out.mustahiq_waitlist === true, crm_note: out.crm_note ?? "", send_preview, analysis });
    }
    // 15 Nov 2026 (Ahmed, on the card of a visited client asking about a deposit: «ليش كاتب ينتظر موافقتي ومع انه خلاص متفقين
    // على هذا النوع من المحادثات»): a handoff with no reply has nothing to approve. It never waits on «ردود تنتظر موافقتك»
    // («المحرك يقترح عدم الرد»): the chat goes to Ahmed at once with its alert, like every silent handoff of R23. Before this a
    // running deal (active_deal) with an empty reply sat on the approval screen and the chat was not marked for him.
    const silentHandoff = !dry && !review && !out.reply_messages.length && out.action === "handoff";
    if (dry || holdForOwner || (rt.reply_agent_mode === "approval" && !autoSend)) {
      if (silentHandoff) analysis.silent_handoff_direct = true;
      else {
        // nothing to say (closing words, the other branch handles it): no empty card in the approval screen
        const nothing = !dry && !out.reply_messages.length && out.action === "none";
        await db.from("whatsapp_reply_drafts").update({ analysis, reply_messages: out.reply_messages, status: nothing ? "skipped" : "pending", error: nothing ? "no_reply_needed" : null }).eq("id", draftId);
        return json({ ok: true, status: "awaiting_approval" });
      }
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
    // decision 42: the notice the client never got was said in this reply: its queue rows are marked so it is not said again
    if (sentIds.length && !review && out.sold_told && out.reply_messages.some((t: string) => /انحجز|انباع|ابتاع/.test(t))) {
      const ids = soldUntold.map((r: any) => r.id);
      // (the status check allows no new value: the row stays skipped and its reason becomes told_by_agent)
      const mk = await db.from("whatsapp_outreach_queue").update({ reason: "told_by_agent" }).in("id", ids).eq("status", "skipped");
      if (mk.error) console.error("[reply-agent] sold told", mk.error.message);
    }

    // a location (or the owner's number) went out: the client is going to see the property, so the visit is recorded even when
    // his time was vague ("الحين", "العصر") and the question after 1.5 h can follow (8 Nov, Ahmed)
    if (sentIds.length && prop && !review && !out.location_for_area && ["send_location", "send_owner_number", "send_lockbox"].includes(out.action)) {
      try {
        const todayM = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Muscat" }).format(new Date());
        const nowM = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Muscat", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
        const open = await db.from("viewings").select("id").eq("client_id", client.id).eq("property_id", prop.id).eq("archived", false).in("status", ["scheduled", "confirmed", "postponed", "done"]).gte("viewing_date", todayM).limit(1).maybeSingle();
        if (!open.data) {
          const vd = /^\d{4}-\d{2}-\d{2}$/.test(out.viewing_date || "") && out.viewing_date >= todayM ? out.viewing_date : todayM;
          const vt = /^([01]\d|2[0-3]):[0-5]\d$/.test(out.viewing_time || "") ? out.viewing_time : (vd === todayM ? nowM : "16:00");
          const w = await db.from("viewings").insert({ company_id: msg.company_id, client_id: client.id, property_id: prop.id, viewing_date: vd, viewing_time: vt, duration_minutes: 30, status: "scheduled", notes: `انرسل للعميل اللوكيشن، الوقت تقريبي${/^([01]d|2[0-3]):[0-5]d$/.test(out.viewing_time || "") || vd === todayM ? "" : " (الساعة ما تحددت)"}`, created_via: "whatsapp_ai", source_whatsapp_message_id: msg.id });
          if (w.error) console.error("[reply-agent] location visit", w.error.message);
        }
      } catch (e) { console.error("[reply-agent] location visit", String((e as any)?.message || e)); }
    }
    // keep the CRM up to date
    const convPatch: any = { ai_summary: short(out.crm_note, 1500), last_automation_action: { scenario: "reply_agent_v1", action: out.action, at: now, category: out.category, source: out.source }, updated_at: now };
    // R45: a meeting request is a hard handoff «اجتماع: …» (Ahmed is alerted and answers; the agent stays out of the chat)
    const meetingBooked = out.action === "book_meeting" && /^\s*اجتماع\s*:/.test(String(out.handoff_reason || ""));
    if (out.action === "handoff" || meetingBooked) Object.assign(convPatch, { human_handoff_required: true, handoff_reason: short(out.handoff_reason || out.intent, 500), handoff_updated_at: now });
    if (ignored) Object.assign(convPatch, { agent_muted: true, agent_muted_reason: `متجاهل: ${IGNORE_LABEL[out.ignore_kind]}`, ignored_at: now, ignore_kind: ["contest", "stranger", "not_real_estate"].includes(out.ignore_kind) ? "other" : out.ignore_kind,
      human_handoff_required: false, handoff_reason: null, handoff_updated_at: now });
    // a handoff that only said "which property ?" is closed by the agent itself once it answers normally (8 Nov, Ahmed: it must not wait for him)
    if (out.action !== "handoff" && !meetingBooked && sentIds.length && out.reply_messages.length && conv.human_handoff_required && /مو واضح|ما عرفنا|أي عقار|اي عقار|العقار.*(واضح|محدد)/.test(String(conv.handoff_reason || "")) && !HARD_HANDOFF.test(String(conv.handoff_reason || ""))) {
      Object.assign(convPatch, { human_handoff_required: false, handoff_reason: null, handoff_updated_at: now });
    }
    await db.from("whatsapp_conversations").update(convPatch).eq("id", conv.id);
    // an open handoff already on Ahmed's list does not alert him again unless it turned into negotiation / serious buyer / price study
    if (out.action === "handoff" && (!conv.human_handoff_required || HARD_HANDOFF.test(String(out.handoff_reason || "")))) await notifyHandoff(msg.company_id, conv, client, out.handoff_reason || out.crm_note || out.intent);
    // R93: «ما يردون» reaches Ahmed on WhatsApp from this branch number, once per client message
    if (out.no_answer_alert) {
      try {
        const text = [`📵 العميل يقول ما أحد رد عليه · ${conv.route_key === "barka" ? "بركاء" : conv.route_key === "muscat" ? "مسقط" : ""}`, `الاسم: ${client.name || conv.customer_name || "عميل"}`, `الرقم: +${to}`, `كلامه: ${short(String(out.handoff_reason || "").replace(/^ما يردون:\s*/, ""), 240)}`].join("\n");
        await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-owner-hot-alert`, { method: "POST", headers: { "Content-Type": "application/json", "x-crm-agent": secret },
          body: JSON.stringify({ action: "notify_owner", company_id: msg.company_id, route_key: conv.route_key, text, event_key: `no_answer:${conv.id}:${msg.id}` }) });
      } catch (e) { console.error("[reply-agent] no-answer alert", String((e as any)?.message || e)); }
    }
    // a booked meeting reaches Ahmed once, with a task on the meeting day (like the price study task); the same slot again does not.
    // The alert goes to the owner himself, not to whoever holds the chat (a retired account, or a branch agent: investment is owner-only)
    if (meetingBooked && !out.meeting_already_booked) {
      await notifyHandoff(msg.company_id, conv, client, out.handoff_reason, true);
      try {
        const o = await db.from("profiles").select("id").eq("company_id", msg.company_id).eq("role", "owner").eq("is_active", true).limit(1).maybeSingle();
        // R30: the task is to confirm the slot, so it is due today (the meeting day is in its title)
        const open = await db.from("tasks").select("id").eq("client_id", client.id).ilike("title", "اجتماع%").eq("done", false).limit(1);
        if (!(open.data || []).length) await db.from("tasks").insert({ company_id: msg.company_id, user_id: o.data?.id || null, client_id: client.id, title: short(out.handoff_reason, 200), notes: short(`أكد الموعد مع العميل أو اقترح وقت ثاني. ${out.crm_note || ""}`, 1000), due_date: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Muscat" }).format(new Date()), priority: "high", done: false });
      } catch (e) { console.error("[reply-agent] meeting task", String((e as any)?.message || e)); }
    }
    // R31 (Ahmed 11 Nov): a client asking about the «المستحقين» units goes on their waiting list (one row per client), so
    // he can be messaged as soon as new units open. Never on the owner's private line.
    if (out.mustahiq_waitlist === true && client?.id && conv.route_key !== "owner") {
      try {
        await db.from("mustahiq_waitlist").upsert({ company_id: msg.company_id, client_id: client.id, conversation_id: conv.id, route_key: conv.route_key,
          note: short(out.crm_note || out.intent || "", 500), last_asked_at: now }, { onConflict: "company_id,client_id" });
      } catch (e) { console.error("[reply-agent] mustahiq waitlist", String((e as any)?.message || e)); }
    }
    try {
      const flags: any = {};
      if (out.category === "buyer" || out.category === "tenant") flags.is_buyer = true;
      if (out.category === "seller") flags.is_seller = true;
      if (out.category === "investor") flags.is_investor = true;
      if (out.area) flags.preferred_area = short(out.area, 200);
      if (Object.keys(flags).length) await db.from("clients").update(flags).eq("id", client.id);
    } catch (_) { /* optional */ }
    // Ahmed 14 Nov: the client found a property and stopped searching: his active requests are closed and Ahmed is told
    if (out.search_stopped && !review) {
      try {
        const c = await db.from("client_requests").update({ status: "cancelled", closed_reason: "العميل قال إنه حصل عقار ووقف البحث (قفله العقل)", closed_at: now, updated_at: now })
          .eq("client_id", client.id).eq("company_id", msg.company_id).eq("status", "active").select("id");
        if (c.error) console.error("[reply-agent] search stopped", c.error.message);
        const o = await db.from("profiles").select("id").eq("company_id", msg.company_id).eq("role", "owner").eq("is_active", true).limit(1).maybeSingle();
        if (o.data?.id) await db.from("notifications").insert({ user_id: o.data.id, type: "whatsapp_handoff", is_read: false, client_id: client.id, link: "whatsapp",
          title: `وقف البحث: ${client.name || conv.customer_name || client.phone || "عميل"}`, body: `العميل قال إنه حصل عقار. انقفل ${(c.data || []).length} طلب له بدون رد. إذا تبي تكمل معه افتح المحادثة.` });
      } catch (e) { console.error("[reply-agent] search stopped", String((e as any)?.message || e)); }
    }
    // keep what the client is looking for in their open request, so a matching listing can be sent later
    try {
      const rq = out.request;
      if (!out.search_stopped && rq && (rq.areas?.length || rq.property_types?.length || rq.budget_max || rq.bedrooms_min)) {
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
    return json({ ok: true, sent: sentIds.length, action: out.action, ...(resume ? { resumed: true, reply_messages: out.reply_messages, handoff_reason: out.handoff_reason ?? null } : {}) });
  } catch (e) {
    const why = short((e as any)?.message || e, 800);
    if (!redo && !inline) await db.from("whatsapp_reply_drafts").update({ status: "failed", error: why }).eq("id", draftId);
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
