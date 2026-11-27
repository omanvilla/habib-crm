// Messages the office starts (owner decisions, 4 Nov 2026). Everything is queued in whatsapp_outreach_queue
// and waits for the owner's approval in "ردود تنتظر موافقتك"; approved rows go out 9am–9pm Oman time,
// as plain text inside the 24-hour window or as an approved template outside it.
//   queue_requests  (hourly cron)  weekly follow-up of open requests: still searching ? / financing approved ?
//                                   never when the client wrote in the last 7 days, max 2 unanswered (R43: 2 everywhere),
//                                   stop on "ما ابي" as a word of its own (R47); a visit opt-out does not stop it (R45);
//                                   no investor until 12 Feb 2027 (R46)
//   queue_sold      {property_id}   "بخصوص الفيلا اللي سألت عنها في … انحجزت" to everyone who asked, except who booked or bought
//                                   it (R41). Its own switch is the cron outreach_auto_sold_notice (SQL132/133), not
//                                   visit_followups_auto (R39), and it is outside the daily limit of 20 (R71).
//                                   R38 (Ahmed 12 Nov): when a unit of the same group is still available (SQL97,
//                                   crm_unit_group_notice) the message is "… انحجزت وحدة منها والمتبقي الثانية والثالثة" +
//                                   "تحب تشوفها ؟" instead (template property_unit_booked_ar_v1 outside the 24 hours)
//   queue_listing   {property_id}   a new listing to open requests that match it, asking first if they still search.
//                   {price_drop}    SQL123 (18 Nov): scored, the best 20 only, never a unit of a group already offered;
//                   {preview}       also when the price of an available property drops; preview writes nothing
//   queue_listing_details (cron)    SQL166 (Ahmed 27 Nov): a client who got «نزل عندنا … لين الحين تبحث ؟» and wrote nothing for a
//                                   whole day gets ONE second message with the property's details, like a person would write,
//                                   then nothing more. Only while whatsapp_automation_runtime.new_listing_auto is on.
//   send_approved   (cron)          sends approved rows
//                   branch_transfer step F (decision 77, SQL140): the reply agent on the wrong number queued it
//                                   (crm_branch_transfer_queue); it goes from the right number once the agent's line went
//                                   out there, as text inside the 24 hours or as branch_transfer_ar_v1 only when Meta rated it
//                                   APPROVED + UTILITY; then what waited on the wrong number for that topic is closed
//   templates       {submit}        submits / refreshes the four templates on both numbers
//   approve         (owner JWT)     {ids, decision: approve|reject} → approve sends right away (within hours)
import { createClient } from "npm:@supabase/supabase-js@2";
import { cleanArea, LISTING_CAP, priceMentioned, rankCandidates, scoreRequest } from "../_shared/listing-match.mjs";
const EXTRA_CAP = 30;

const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false, autoRefreshToken: false } });
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const GRAPH = Deno.env.get("META_GRAPH_VERSION") || "v25.0";
const ORIGINS = ["https://omanvilla.github.io"];
const DAY = 86400000;
const enc = new TextEncoder();
const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const short = (v: unknown, n = 300) => { const s = String(v ?? "").trim(); return s.length > n ? s.slice(0, n) + "…" : s; };
function b64(s: string) { const b = atob(s); const o = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) o[i] = b.charCodeAt(i); return o; }
const omanHour = () => +new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Muscat", hour: "2-digit", hour12: false }).format(new Date());
const thousands = (p: unknown) => { const n = Number(p || 0); return n >= 1000 ? `${Math.round(n / 1000)} الف` : `${n}`; };

// the four templates (owner approved the wording style: no commas, no full stops, " ؟")
const TEMPLATES: Record<string, { category: string; body: string; example: string[] }> = {
  request_followup_ar_v2: { category: "UTILITY", body: "بخصوص طلبك {{1}}\nلين الحين تبحث ؟", example: ["فيلا في العامرات بحدود 66 الف"] },
  financing_followup_ar_v1: { category: "UTILITY", body: "بخصوص التمويل {{1}}\nطلعت الموافقة ؟", example: ["من بنك الاسكان"] },
  property_booked_options_ar_v1: { category: "MARKETING", body: "بخصوص {{1}} اللي سألت عنها {{2}}\nتحب تشوف خيارات ثانية ؟", example: ["الفيلا", "في الهرم انحجزت"] },
  new_listing_match_ar_v1: { category: "MARKETING", body: "نزل عندنا {{1}} ممكن يناسب طلبك\nلين الحين تبحث ؟", example: ["فيلا في الصومحان بـ 57 الف"] },
  // Ahmed 12 Nov (R38, R39): a unit of a group went and another is left; a booked visit the client did not come to; an
  // available property for a client whose request it fits. He approved the three wordings before they went to Meta.
  property_unit_booked_ar_v1: { category: "MARKETING", body: "بخصوص {{1}} اللي سألت عنها في {{2}}\nانحجزت وحدة منها والمتبقي {{3}}\nتحب تشوفها ؟", example: ["الفيلا", "الصومحان الجنوبية", "الثانية والثالثة"] },
  visit_missed_rebook_ar_v1: { category: "UTILITY", body: "بخصوص موعد زيارتك {{1}}\nتحب نحدد لك موعد ثاني ؟", example: ["فيلا الشخاخيط"] },
  request_offer_match_ar_v1: { category: "MARKETING", body: "بخصوص طلبك {{1}}\nعندنا {{2}} تحب ارسلك تفاصيله ؟", example: ["فيلا في الرميس بحدود 60 الف", "فيلا في الرميس بـ 59 الف"] },
  // SQL166 (Ahmed 27 Nov): the second message of a new listing, a day after the first one went unanswered
  property_details_ar_v1: { category: "MARKETING", body: "هذي تفاصيل {{1}}\n{{2}}\nتحب نرتب لك زيارة ؟", example: ["الفيلا في الصومحان الجنوبية بـ 69 الف", "الارض 400 متر والبناء 300 متر و4 غرف نوم و6 حمامات"] },
};
const NOUN: Record<string, [string, string, string]> = { // label, "booked" verb, indefinite
  villa: ["الفيلا", "انحجزت", "فيلا"], twin_villa: ["الفيلا", "انحجزت", "توين فيلا"], townhouse: ["الفيلا", "انحجزت", "تاون هاوس"], house: ["البيت", "انحجز", "بيت"],
  land: ["الارض", "انحجزت", "ارض"], land_residential: ["الارض", "انحجزت", "ارض سكنية"], land_commercial: ["الارض", "انحجزت", "ارض تجارية"],
  apartment: ["الشقة", "انحجزت", "شقة"], resthouse: ["الاستراحة", "انحجزت", "استراحة"], chalet: ["الشاليه", "انحجز", "شاليه"], farm: ["المزرعة", "انحجزت", "مزرعة"],
  building: ["المبنى", "انحجز", "مبنى"], penthouse: ["البنتهاوس", "انحجز", "بنتهاوس"], office: ["المكتب", "انحجز", "مكتب"], shop: ["المحل", "انحجز", "محل"],
  warehouse: ["المخزن", "انحجز", "مخزن"], other: ["العقار", "انحجز", "عقار"],
};
// R47 (Ahmed 18 Nov «إيوا صلحها»): a stop word counts only as a word of its own, so «موقف سيارات» or «الوقف» never stops the
// follow-ups. Read on normalised Arabic (أ إ آ -> ا, ى -> ي, harakat dropped), so «ما أبي» is caught as well as «ما ابي».
const AR_LETTER = "[\\u0621-\\u064AA-Za-z]";
const STOP_RE = new RegExp(`(?<!${AR_LETTER})(ما\\s*ابي|ماابي|ما\\s*ابغي|ما\\s*اريد|لا\\s*شكرا|لاشكرا|ما\\s*احتاج|وقف|توقف|لا\\s*تراسلني|لا\\s*تراسلوني|لا\\s*ترسل(ي|و)?\\s*لي|stop|unsubscribe)(?!${AR_LETTER})`, "i");
const normAr = (s: unknown) => String(s ?? "").replace(/[ً-ٰٟـ]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/\s+/g, " ");
const stopSaid = (s: unknown) => STOP_RE.test(normAr(s));
// R41 (Ahmed 18 Nov «اللي حجز أو اشترى بس ينستثنى»): the buyer left out of a sold notice is a client whose deal on that property is
// booked, the same test as crm_repair_private.deal_is_booked (SQL134): a confirmed reservation or a stage from the deposit on.
const BOOKED_STAGES = ["deposit", "awaiting_finance", "finance_approved", "awaiting_clearance", "ownership_transfer", "closed", "commission_collected"];
const dealIsBooked = (d: any) => !!d?.reservation_confirmed_at || BOOKED_STAGES.includes(String(d?.stage || ""));
// R46 (Ahmed 18 Nov «نوقف متابعات المستثمرين»): no follow-up of ours to an investor until 12 Feb 2027; booked meetings stay.
// The lane is SQL91's followup_lane, read through crm_followup_investor_paused (SQL136). An error counts as paused.
async function investorPaused(clientId: string, conversationId: string | null, routeKey: string | null, text: string) {
  const r = await db.rpc("crm_followup_investor_paused", { p_client: clientId, p_conversation: conversationId, p_route: routeKey, p_text: text });
  return r.error ? true : r.data === true;
}
const INVESTOR_RESUME = "2027-02-12T09:00:00+04:00";
const FOUND_RE = /حصلت|لقيت|اشتريت|خلاص\s*(اشتريت|حصلت|لقيت)/;

async function routes() {
  const r = await db.from("company_lead_routes").select("company_id,route_key,whatsapp_number,meta_phone_number_id,meta_waba_id").eq("is_active", true);
  return r.data || [];
}
async function token(companyId: string, routeKey: string) {
  const c = await db.from("whatsapp_route_credentials").select("token_ciphertext,token_iv,expires_at").eq("company_id", companyId).eq("route_key", routeKey).maybeSingle();
  if (!c.data || (c.data.expires_at && new Date(c.data.expires_at).getTime() <= Date.now() + 60000)) return null;
  const key = await crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", enc.encode(`${META_APP_SECRET}|${companyId}|${routeKey}|habib-crm-whatsapp-v1`)), { name: "AES-GCM" }, false, ["decrypt"]);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(c.data.token_iv) }, key, b64(c.data.token_ciphertext)));
}
async function meta(t: string, phoneId: string, to: string, payload: any) {
  const r = await fetch(`https://graph.facebook.com/${GRAPH}/${phoneId}/messages`, { method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, ...payload }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error?.message || `meta_${r.status}`);
  return d?.messages?.[0]?.id || null;
}
async function latestConv(clientId: string) {
  const c = await db.from("whatsapp_conversations").select("id,route_key,last_inbound_at,meta_phone_number_id").eq("client_id", clientId).order("last_inbound_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
  return c.data || null;
}
// R1/R3 at preparation too (Ahmed 12 Nov): nothing is even prepared for a chat in a negotiation with Ahmed (تفاوض / مشتري جاد /
// دراسة سعر) or a muted one. A chat someone typed in by hand (manual_reply) is prepared as before, so the office still sees
// it on its lists, and the send refuses it until the chat is handed back (sendRows). An error counts as held.
async function held(conversationId: string) {
  const h = await db.rpc("crm_chat_hold", { p_conversation: conversationId });
  return h.error ? true : ["negotiation", "muted"].includes(String(h.data || ""));
}
async function upsertRows(rows: any[]) {
  if (!rows.length) return 0;
  const ins = await db.from("whatsapp_outreach_queue").insert(rows).select("id");
  if (ins.error) throw new Error(ins.error.message);
  return (ins.data || []).length;
}
function requestSummary(r: any) {
  const t = (Array.isArray(r.property_types) && r.property_types[0]) || r.property_type || "";
  const type = NOUN[t]?.[2] || (/^[\u0600-\u06FF\s]+$/.test(t) ? t : "عقار");
  // the first area that says something («غير محدد» / «اي مكان» are left out: «فيلا بحدود 60 الف», not «فيلا في غير محدد»)
  const area = [...(Array.isArray(r.preferred_areas) ? r.preferred_areas : []), r.preferred_area].map(cleanArea).find(Boolean) || "";
  const budget = r.budget_max ? ` بحدود ${thousands(r.budget_max)}` : "";
  return `${type}${area ? " في " + area : ""}${budget}`.trim();
}

// ---- weekly follow-up of open requests -------------------------------------------------------
async function queueRequests(limit = 25) {
  const now = Date.now();
  const due = await db.from("client_requests").select("id,company_id,client_id,request_type,property_type,property_types,preferred_area,preferred_areas,budget_max,followup_note,next_followup,status,search_status")
    .eq("status", "active").not("next_followup", "is", null).lte("next_followup", new Date(now).toISOString()).order("next_followup").limit(limit);
  const out: any[] = [];
  for (const r of due.data || []) {
    const cl = await db.from("clients").select("id,archived,followup_suppressed").eq("id", r.client_id).maybeSingle();
    if (!cl.data || cl.data.archived || cl.data.followup_suppressed) { await db.from("client_requests").update({ next_followup: null }).eq("id", r.id); continue; }
    const conv = await latestConv(r.client_id);
    if (!conv) { await db.from("client_requests").update({ next_followup: null, next_action: "ما في محادثة واتساب" }).eq("id", r.id); continue; }
    // the client wrote recently: the conversation is alive, check again a week after their last message
    const lastIn = conv.last_inbound_at ? new Date(conv.last_inbound_at).getTime() : 0;
    if (lastIn && now - lastIn < 7 * DAY) { await db.from("client_requests").update({ next_followup: new Date(lastIn + 7 * DAY).toISOString() }).eq("id", r.id); out.push({ request: r.id, skip: "client_active" }); continue; }
    // what did the client say last ? "ما ابي" stops everything, "حصلت" closes the search
    const ins = await db.from("whatsapp_messages").select("body").eq("conversation_id", conv.id).eq("direction", "inbound").order("message_timestamp", { ascending: false }).limit(5);
    const said = (ins.data || []).map((m: any) => String(m.body || "")).join(" ");
    if (stopSaid(said)) { await db.from("clients").update({ followup_suppressed: true }).eq("id", r.client_id); await db.from("client_requests").update({ next_followup: null, status: "paused", next_action: "العميل طلب ما نتابع" }).eq("id", r.id); continue; }
    // "found" is not an allowed search_status (client_requests_search_status_check): the update failed every hour
    // and the request came back each run (10 Nov 2026). "stopped" (توقف عن البحث) + the reason in next_action.
    if (FOUND_RE.test(said)) { const up = await db.from("client_requests").update({ next_followup: null, status: "paused", search_status: "stopped", next_action: "العميل قال حصل" }).eq("id", r.id); if (up.error) out.push({ request: r.id, error: up.error.message }); continue; }
    // R46: an investor's request is not followed up until 12 Feb 2027 (looked at again then)
    if (await investorPaused(r.client_id, conv.id, conv.route_key, `${requestSummary(r)} ${r.followup_note || ""}`)) { await db.from("client_requests").update({ next_followup: INVESTOR_RESUME }).eq("id", r.id); out.push({ request: r.id, skip: "investor_paused" }); continue; }
    // a chat in a negotiation with Ahmed gets no follow-up prepared; looked at again tomorrow
    if (await held(conv.id)) { await db.from("client_requests").update({ next_followup: new Date(now + DAY).toISOString() }).eq("id", r.id); out.push({ request: r.id, skip: "chat_held" }); continue; }
    // one office message a week at most, and two unanswered follow-ups pause the request
    const recent = await db.from("whatsapp_outreach_queue").select("id,status,sent_at,created_at").eq("client_id", r.client_id).in("status", ["pending", "approved", "sent"]).gte("created_at", new Date(now - 7 * DAY).toISOString()).limit(1);
    if ((recent.data || []).length) continue;
    const unanswered = await db.from("whatsapp_outreach_queue").select("id").eq("request_id", r.id).eq("status", "sent").gt("sent_at", new Date(lastIn || 0).toISOString());
    if ((unanswered.data || []).length >= 2) { await db.from("client_requests").update({ next_followup: null, status: "paused", search_status: "no_response", next_action: "ما رد على متابعتين" }).eq("id", r.id); continue; }
    const financing = /تمويل|موافق|بنك|اسكان|إسكان/.test(String(r.followup_note || ""));
    const summary = requestSummary(r);
    const row = financing
      ? { step: "financing", template_name: "financing_followup_ar_v1", template_params: [""], messages: ["بخصوص التمويل طلعت الموافقة ؟"] }
      : { step: "still_searching", template_name: "request_followup_ar_v2", template_params: [summary], messages: [`بخصوص طلبك ${summary}`, "لين الحين تبحث ؟"] };
    if (financing) row.template_params = ["من البنك"];
    out.push({ request: r.id, queued: await upsertRows([{ ...row, company_id: r.company_id, kind: "request_followup", request_id: r.id, client_id: r.client_id, conversation_id: conv.id, route_key: conv.route_key, summary: short(r.followup_note || summary, 200), status: "pending" }]) });
    await db.from("client_requests").update({ next_followup: new Date(now + 7 * DAY).toISOString() }).eq("id", r.id);
  }
  return { checked: (due.data || []).length, results: out };
}

// ---- property sold: tell everyone who asked, except the buyer ----------------------------------
async function queueSold(propertyId: string, dry: boolean) {
  const p = await db.from("properties").select("id,company_id,type,area,wilayat,title").eq("id", propertyId).single();
  if (p.error) throw new Error("property_not_found");
  const prop = p.data, since = new Date(Date.now() - 90 * DAY).toISOString();
  const [msgs, reels, views, reqs, deals, rts] = await Promise.all([
    db.from("whatsapp_messages").select("client_id").eq("matched_property_id", propertyId).eq("direction", "inbound").gte("message_timestamp", since),
    db.from("instagram_media_catalog").select("link_key").eq("property_id", propertyId),
    db.from("viewings").select("client_id").eq("property_id", propertyId),
    db.from("client_requests").select("client_id").eq("subject_property_id", propertyId),
    db.from("deals").select("client_id,stage,reservation_confirmed_at,merged_into_deal_id").eq("property_id", propertyId),
    routes(),
  ]);
  const keys = (reels.data || []).map((r: any) => r.link_key).filter(Boolean);
  const reelMsgs = keys.length ? await db.from("whatsapp_messages").select("client_id").in("property_link_key", keys).eq("direction", "inbound").gte("message_timestamp", since) : { data: [] };
  // R41: only who booked or bought this property is left out; an open card (new, visit, negotiation) still gets the notice
  const buyers = new Set((deals.data || []).filter((d: any) => !d.merged_into_deal_id && dealIsBooked(d)).map((d: any) => d.client_id));
  const ids = new Set<string>();
  for (const r of [...(msgs.data || []), ...((reelMsgs as any).data || []), ...(views.data || []), ...(reqs.data || [])]) if (r.client_id && !buyers.has(r.client_id)) ids.add(r.client_id);
  const company = rts.map((r: any) => digits(r.whatsapp_number));
  const [noun, verb] = NOUN[prop.type] || ["العقار", "انحجز"];
  const where = prop.area || prop.wilayat || "";
  const done = await db.from("whatsapp_outreach_queue").select("client_id").eq("kind", "property_sold").eq("property_id", prop.id);
  const already = new Set((done.data || []).map((d: any) => d.client_id));
  // R38: is a unit of the same group still available ? (same owner, area and kind, near specifications: SQL97)
  const grp = await db.rpc("crm_unit_group_notice", { p_property: prop.id });
  if (grp.error) console.error("[outreach] unit group", grp.error.message);
  const unit: any = !grp.error && grp.data?.line && grp.data?.remaining_text ? grp.data : null;
  const rows: any[] = [];
  if (ids.size) {
    const cl = await db.from("clients").select("id,phone,phone_normalized,archived,followup_suppressed").in("id", [...ids]);
    for (const c of cl.data || []) {
      if (already.has(c.id) || c.archived || c.followup_suppressed || company.includes(digits(c.phone_normalized || c.phone))) continue;
      const conv = await latestConv(c.id);
      if (!conv || await held(conv.id)) continue;
      const second = `${where ? "في " + where + " " : ""}${verb}`;
      const base = { company_id: prop.company_id, kind: "property_sold", property_id: prop.id, client_id: c.id, conversation_id: conv.id, route_key: conv.route_key, dry_run: dry, status: "pending" };
      rows.push(unit
        ? { ...base, step: "unit_booked", template_name: "property_unit_booked_ar_v1", template_params: [noun, where || "نفس المنطقة", String(unit.remaining_text)],
            messages: [`بخصوص ${noun} اللي سألت عنها${where ? " في " + where : ""} ${unit.line}`, "تحب تشوفها ؟"],
            summary: short(`${prop.title} (المتبقي: ${(unit.remaining_titles || []).join(" و ")})`, 200) }
        : { ...base, step: "booked", template_name: "property_booked_options_ar_v1", template_params: [noun, second], messages: [`بخصوص ${noun} اللي سألت عنها ${second}`, "تحب تشوف خيارات ثانية ؟"],
            summary: prop.title });
    }
  }
  return { property: prop.title, unit_group: unit ? unit.line : null, queued: await upsertRows(rows) };
}

// ---- new listing: open requests that match it ---------------------------------------------------
// SQL123 (18 Nov): scored and capped (../_shared/listing-match.mjs); a unit of a group whose sibling was already offered
// is not news for the same clients; a price drop (trigger) runs the same, and reaches only clients the new price now fits.
// preview=true returns who would get it without writing anything.
async function activeRequests(companyId: string, wantType: string) {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const r = await db.from("client_requests").select("id,client_id,request_type,property_type,property_types,preferred_area,preferred_areas,wilayat,budget_max,search_status")
      .eq("company_id", companyId).eq("status", "active").eq("request_type", wantType).order("id").range(from, from + 999);
    if (r.error) throw new Error(r.error.message);
    out.push(...(r.data || []));
    if ((r.data || []).length < 1000) return out;
  }
}
async function lastInbound(clientIds: string[]) {
  const m = new Map<string, any>();
  for (let i = 0; i < clientIds.length; i += 200) {
    const c = await db.from("whatsapp_conversations").select("id,client_id,route_key,last_inbound_at").in("client_id", clientIds.slice(i, i + 200));
    for (const x of c.data || []) {
      const cur = m.get(x.client_id);
      if (!cur || new Date(x.last_inbound_at || 0).getTime() > new Date(cur.last_inbound_at || 0).getTime()) m.set(x.client_id, x);
    }
  }
  return m;
}
async function queueListing(propertyId: string, dry: boolean, preview = false, priceDrop = false) {
  const p = await db.from("properties").select("id,company_id,type,area,wilayat,price,listing_purpose,status,archived,title").eq("id", propertyId).single();
  if (p.error) throw new Error("property_not_found");
  const prop = p.data;
  if (prop.status !== "available" || prop.archived) return { property: prop.title, queued: 0, reason: "not_available" };
  const wantType = prop.listing_purpose === "rent" ? "tenant" : "buyer";
  const reqs = { data: await activeRequests(prop.company_id, wantType) };
  // the available units of the same group (SQL97): a client offered one of them is not offered the other as news
  const sib = await db.rpc("crm_unit_sibling_ids", { p_property: prop.id });
  if (sib.error) console.error("[outreach] siblings", sib.error.message);
  const group = [prop.id, ...((!sib.error && Array.isArray(sib.data)) ? sib.data : [])];
  const done = await db.from("whatsapp_outreach_queue").select("client_id,property_id,status").eq("kind", "new_listing").in("property_id", group);
  const already = new Set((done.data || []).filter((d: any) => d.property_id === prop.id || ["pending", "approved", "sent"].includes(d.status)).map((d: any) => d.client_id));
  // people who already asked about this very property (or a unit of its group) got it in their conversation; and one office message a week
  const reelKeys = ((await db.from("instagram_media_catalog").select("link_key").in("property_id", group)).data || []).map((r: any) => r.link_key).filter(Boolean);
  const asked = new Set<string>([
    ...(((await db.from("whatsapp_messages").select("client_id").in("matched_property_id", group)).data || []).map((m: any) => m.client_id)),
    ...(reelKeys.length ? ((await db.from("whatsapp_messages").select("client_id").in("property_link_key", reelKeys)).data || []).map((m: any) => m.client_id) : []),
  ]);
  // and people the office already wrote to about this area (the ad, the details, "متوفر"): for them it is not news.
  // Their open request is followed up weekly instead ("بخصوص طلبك ... لين الحين تبحث ؟").
  const tok = String(prop.area || prop.wilayat || "").replace(/^(بركاء|بركا|مسقط)\s+/, "").split(/\s+/)
    .filter((w: string) => w.length >= 3 && !/^(الجنوبي|الجنوبية|الجنوبيه|الشمالي|الشمالية|الشماليه|مدينة|حي|منطقة)$/.test(w))
    .sort((x: string, y: string) => y.length - x.length)[0];
  if (tok) for (const m of ((await db.from("whatsapp_messages").select("client_id,body").eq("company_id", prop.company_id).eq("direction", "outbound")
    .ilike("body", `%${tok}%`).gte("message_timestamp", new Date(Date.now() - 150 * DAY).toISOString()).limit(5000)).data || []))
    if (!prop.price || priceMentioned(m.body, prop.price)) asked.add(m.client_id);
  // SQL166 (Ahmed 27 Nov «أي زبون»): a new listing is news, so the weekly gap of the follow-ups no longer holds it back; only a
  // client who got an office message in the last 2 days (or has a new listing waiting to go) is left for the next one
  const busy = new Set<string>([
    ...(((await db.from("whatsapp_outreach_queue").select("client_id").eq("status", "sent").gte("sent_at", new Date(Date.now() - 2 * DAY).toISOString())).data || []).map((m: any) => m.client_id)),
    ...(((await db.from("whatsapp_outreach_queue").select("client_id").in("kind", ["new_listing", "new_listing_details"]).in("status", ["pending", "approved"]).neq("property_id", prop.id)).data || []).map((m: any) => m.client_id)),
  ]);
  const open = (reqs.data || []).filter((r: any) => r.client_id && !already.has(r.client_id) && !asked.has(r.client_id) && !busy.has(r.client_id) && !["found", "stopped"].includes(r.search_status));
  const convs = await lastInbound([...new Set(open.map((r: any) => r.client_id as string))]);
  // the best request of each client
  const best = new Map<string, any>();
  for (const r of open) {
    const conv = convs.get(r.client_id);
    if (!conv) continue;
    const s = scoreRequest(prop, r, conv.last_inbound_at);
    if (s && (!best.has(r.client_id) || s.score > best.get(r.client_id).score)) best.set(r.client_id, { ...s, r, conv, lastInboundAt: conv.last_inbound_at });
  }
  const ranked = rankCandidates([...best.values()]);
  const rows: any[] = [], picked: any[] = [];
  const noun = NOUN[prop.type]?.[2] || "عقار";
  const label = `${noun} في ${prop.area || prop.wilayat || ""} بـ ${thousands(prop.price)}`.replace(/\s+/g, " ").trim();
  let next = 0;
  for (const c of ranked) {
    if (picked.length >= LISTING_CAP) break;
    next++;
    const cl = await db.from("clients").select("archived,followup_suppressed").eq("id", c.r.client_id).maybeSingle();
    if (!cl.data || cl.data.archived || cl.data.followup_suppressed) continue;
    if (await held(c.conv.id)) continue;
    const why = `${c.level === "exact" ? "مطابق" : "قريب (نفس الولاية)"}${priceDrop ? " · بعد نزول السعر" : ""}`;
    picked.push({ client_id: c.r.client_id, request_id: c.r.id, score: c.score, level: c.level, request: requestSummary(c.r) });
    rows.push({ company_id: prop.company_id, kind: "new_listing", property_id: prop.id, request_id: c.r.id, client_id: c.r.client_id, conversation_id: c.conv.id, route_key: c.conv.route_key,
      step: "ask_still_searching", template_name: "new_listing_match_ar_v1", template_params: [label], messages: [`نزل عندنا ${label} ممكن يناسب طلبك`, "لين الحين تبحث ؟"],
      summary: short(`${why} · طلبه: ${requestSummary(c.r)}`, 200), dry_run: dry, status: "pending" });
  }
  // the next ones (up to EXTRA_CAP) are kept as skipped / over_cap: nothing sends them and no rule counts them, Ahmed sees
  // them under «عملاء قريبين» and can move any of them to the approval list (decision "promote")
  // (only those after the last one looked at: a client passed over above, archived or in a negotiation, is not kept)
  const rest = ranked.slice(next, next + EXTRA_CAP);
  const restCl = rest.length ? ((await db.from("clients").select("id,archived,followup_suppressed").in("id", rest.map((c: any) => c.r.client_id))).data || []) : [];
  const okIds = new Set(restCl.filter((x: any) => !x.archived && !x.followup_suppressed).map((x: any) => x.id));
  const extras: any[] = [];
  for (const c of rest) if (okIds.has(c.r.client_id) && !(await held(c.conv.id))) extras.push(c);
  const extraRows = extras.map((c: any) => ({
    company_id: prop.company_id, kind: "new_listing", property_id: prop.id, request_id: c.r.id, client_id: c.r.client_id, conversation_id: c.conv.id, route_key: c.conv.route_key,
    step: "ask_still_searching", template_name: "new_listing_match_ar_v1", template_params: [label], messages: [`نزل عندنا ${label} ممكن يناسب طلبك`, "لين الحين تبحث ؟"],
    summary: short(`${c.level === "exact" ? "مطابق" : "قريب (نفس الولاية)"}${priceDrop ? " · بعد نزول السعر" : ""} · طلبه: ${requestSummary(c.r)}`, 200),
    dry_run: dry, status: "skipped", reason: "over_cap" }));
  const result = { property: prop.title, price_drop: priceDrop, matched: ranked.length, over_cap: extraRows.length, group_units: group.length };
  if (preview) return { ...result, would_queue: picked, extra: extraRows.map((x: any) => x.summary) };
  return { ...result, queued: await upsertRows(rows), kept_extra: await upsertRows(extraRows) };
}

// ---- new listing, step 2: the details a day later ---------------------------------------------------
// SQL166 (Ahmed 27 Nov): «إذا ما رد ... بعد يوم كامل ... تجي رسالة فيها تفاصيل العقار، كنا نرسلها حال شخص عادي ... إذا ما رد عاد
// خلاص». One per client and property (kind new_listing_details), never after the client wrote, never for a property that is gone.
const NUM = (v: unknown) => { const n = Math.round(Number(v || 0)); return n > 0 ? n : 0; };
function detailsLine(p: any) {
  const parts: string[] = [];
  if (NUM(p.land_size)) parts.push(`الارض ${NUM(p.land_size)} متر`);
  if (NUM(p.built_size)) parts.push(`البناء ${NUM(p.built_size)} متر`);
  if (NUM(p.bedrooms)) parts.push(`${NUM(p.bedrooms)} غرف نوم`);
  if (NUM(p.bathrooms)) parts.push(`${NUM(p.bathrooms)} حمامات`);
  return parts.join(" و");
}
async function autoOn(companyId: string) {
  const r = await db.from("whatsapp_automation_runtime").select("new_listing_auto").eq("company_id", companyId).maybeSingle();
  return !r.error && r.data?.new_listing_auto === true;
}
async function queueListingDetails(preview = false) {
  const now = Date.now();
  const sent = await db.from("whatsapp_outreach_queue").select("id,company_id,property_id,client_id,request_id,conversation_id,route_key,sent_at")
    .eq("kind", "new_listing").eq("status", "sent").eq("dry_run", false)
    .lte("sent_at", new Date(now - DAY).toISOString()).gte("sent_at", new Date(now - 3 * DAY).toISOString()).limit(300);
  const out: any[] = [];
  const rows: any[] = [];
  for (const s of sent.data || []) {
    if (!preview && !(await autoOn(s.company_id))) { out.push({ client: s.client_id, skip: "auto_off" }); continue; }
    const dup = await db.from("whatsapp_outreach_queue").select("id").eq("kind", "new_listing_details").eq("property_id", s.property_id).eq("client_id", s.client_id).limit(1);
    if ((dup.data || []).length) continue;
    // the client wrote after the first message: the reply agent talks with him, nothing more from here
    const wrote = await db.from("whatsapp_messages").select("id").eq("client_id", s.client_id).eq("direction", "inbound").gt("message_timestamp", s.sent_at).limit(1);
    if ((wrote.data || []).length) { out.push({ client: s.client_id, skip: "client_wrote" }); continue; }
    const p = await db.from("properties").select("id,type,area,wilayat,price,status,archived,land_size,built_size,bedrooms,bathrooms,public_details").eq("id", s.property_id).maybeSingle();
    if (!p.data || p.data.status !== "available" || p.data.archived) { out.push({ client: s.client_id, skip: "property_gone" }); continue; }
    const cl = await db.from("clients").select("archived,followup_suppressed").eq("id", s.client_id).maybeSingle();
    if (!cl.data || cl.data.archived || cl.data.followup_suppressed) { out.push({ client: s.client_id, skip: "client_paused" }); continue; }
    if (s.request_id) { const rq = await db.from("client_requests").select("status").eq("id", s.request_id).maybeSingle(); if (rq.data && rq.data.status !== "active") { out.push({ client: s.client_id, skip: "request_closed" }); continue; } }
    if (await held(s.conversation_id)) { out.push({ client: s.client_id, skip: "chat_held" }); continue; }
    const prop = p.data;
    const noun = NOUN[prop.type]?.[0] || "العقار";
    const label = `${noun} في ${prop.area || prop.wilayat || ""} بـ ${thousands(prop.price)}`.replace(/\s+/g, " ").trim();
    const line = detailsLine(prop) || short(String(prop.public_details || "").split("\n").filter(Boolean).slice(1, 3).join(" "), 300);
    if (!line) { out.push({ client: s.client_id, skip: "no_details" }); continue; }
    // inside the 24 hours (rare: he did not write since, so only when he wrote just before) the full ad text may go as plain text
    const full = String(prop.public_details || "").trim();
    rows.push({ company_id: s.company_id, kind: "new_listing_details", property_id: s.property_id, request_id: s.request_id, client_id: s.client_id, conversation_id: s.conversation_id,
      route_key: s.route_key, step: "details_after_day", template_name: "property_details_ar_v1", template_params: [label, line],
      messages: [`هذي تفاصيل ${label}`, full && full.length <= 900 ? full : line, "تحب نرتب لك زيارة ؟"],
      summary: short(`تفاصيل بعد يوم بدون رد · ${label}`, 200), dry_run: false, status: "approved", approved_at: new Date().toISOString(), reason: "auto_new_listing", scheduled_for: new Date().toISOString() });
    out.push({ client: s.client_id, queue: label });
  }
  if (preview) return { checked: (sent.data || []).length, would_queue: rows.map((r) => ({ client: r.client_id, messages: r.template_params })), results: out };
  return { checked: (sent.data || []).length, queued: await upsertRows(rows), results: out.filter((x) => x.skip) };
}

// ---- sending ---------------------------------------------------------------------------------------
async function sendRows(ids?: string[]) {
  const h = omanHour();
  if (h < 9 || h >= 21) return { sent: 0, reason: "outside_sending_hours" };
  let q = db.from("whatsapp_outreach_queue").select("*").eq("status", "approved").eq("dry_run", false).lte("scheduled_for", new Date().toISOString()).limit(20);
  if (ids?.length) q = q.in("id", ids);
  const rowsR = await q;
  const reg = await db.from("whatsapp_template_registry").select("route_key,template_name,status,category");
  const approvedTpl = new Set((reg.data || []).filter((t: any) => String(t.status).toUpperCase() === "APPROVED").map((t: any) => `${t.route_key}|${t.template_name}`));
  const utilityTpl = new Set((reg.data || []).filter((t: any) => String(t.status).toUpperCase() === "APPROVED" && String(t.category).toUpperCase() === "UTILITY").map((t: any) => `${t.route_key}|${t.template_name}`));
  // the two company numbers never message each other
  const company = (await routes()).map((x: any) => digits(x.whatsapp_number)).filter(Boolean);
  let sent = 0;
  for (const r of rowsR.data || []) {
    try {
      // step F: the chat on the right number (made when there is none); null = the agent's line on the wrong number has not
      // gone out yet, so it waits (SQL140 skips it after 24 hours)
      if (r.kind === "branch_transfer") {
        const tg = await db.rpc("crm_branch_transfer_target", { p_queue: r.id });
        if (tg.error || !tg.data) continue;
        r.conversation_id = tg.data;
      }
      const [cl, cv] = await Promise.all([
        db.from("clients").select("phone,phone_normalized,followup_suppressed").eq("id", r.client_id).single(),
        db.from("whatsapp_conversations").select("id,meta_phone_number_id,last_inbound_at,route_key").eq("id", r.conversation_id).single(),
      ]);
      if (cl.data?.followup_suppressed) { await db.from("whatsapp_outreach_queue").update({ status: "skipped", reason: "client_paused" }).eq("id", r.id); continue; }
      // R1/R3 (Ahmed 8 Nov): nothing goes to a chat Ahmed took or is negotiating in; the row waits until he hands it back
      const hold = await db.rpc("crm_chat_hold", { p_conversation: r.conversation_id });
      if (hold.error || hold.data) continue;
      // the client wrote after this was queued: the reply agent / owner handles the live conversation instead.
      // R42 (Ahmed 18 Nov «العقل يبلغه أكيد»): a sold notice skipped this way is marked sold_client_wrote_after, and the reply agent
      // tells the client in its first answer that the property went (rows: kind property_sold, status skipped, that reason,
      // conversation_id, property_id, summary = the property).
      if (cv.data?.last_inbound_at && new Date(cv.data.last_inbound_at).getTime() > new Date(r.created_at).getTime()) {
        await db.from("whatsapp_outreach_queue").update({ status: "skipped", reason: r.kind === "property_sold" ? "sold_client_wrote_after" : "client_wrote_after" }).eq("id", r.id); continue;
      }
      const t = await token(r.company_id, r.route_key);
      if (!t || !cv.data) throw new Error("route_not_ready");
      const to = digits(cl.data?.phone_normalized || cl.data?.phone), phoneId = digits(cv.data.meta_phone_number_id);
      if (!to || company.includes(to)) { await db.from("whatsapp_outreach_queue").update({ status: "skipped", reason: to ? "company_number" : "no_phone" }).eq("id", r.id); continue; }
      const service = !!cv.data.last_inbound_at && Date.now() - new Date(cv.data.last_inbound_at).getTime() < 23 * 3600000;
      // step F goes as its template only when Meta rated it UTILITY; a week without that and it is dropped
      const transfer = r.kind === "branch_transfer";
      if (!service && !(transfer ? utilityTpl : approvedTpl).has(`${r.route_key}|${r.template_name}`)) {
        const old = transfer && Date.now() - new Date(r.created_at).getTime() > 7 * DAY;
        await db.from("whatsapp_outreach_queue").update(old ? { status: "skipped", reason: "template_not_utility" } : { error: "template_pending" }).eq("id", r.id); continue;
      }
      const now = new Date().toISOString();
      const outs: { id: string | null; body: string; type: string }[] = [];
      if (service) for (const m of r.messages as string[]) outs.push({ id: await meta(t, phoneId, to, { type: "text", text: { preview_url: false, body: m } }), body: m, type: "text" });
      else {
        // a template without variables (the visit follow-ups chosen by the client's stage, R39) takes no body component
        const params = (r.template_params || []).map((x: string) => ({ type: "text", text: String(x) }));
        outs.push({ id: await meta(t, phoneId, to, { type: "template", template: { name: r.template_name, language: { code: "ar" }, ...(params.length ? { components: [{ type: "body", parameters: params }] } : {}) } }), body: (r.messages as string[]).join("\n"), type: "template" });
      }
      for (const o of outs) if (o.id) await db.from("whatsapp_messages").insert({
        company_id: r.company_id, conversation_id: r.conversation_id, client_id: r.client_id, request_id: r.request_id || null, whatsapp_message_id: o.id, direction: "outbound",
        message_type: o.type, sender_wa_id: phoneId, recipient_wa_id: to, body: o.body, message_timestamp: now, delivery_status: "sent", actor_type: "automated", channel_source: "crm_outreach",
        matched_property_id: ["new_listing", "new_listing_details"].includes(r.kind) ? r.property_id : null,
        raw_payload: { source: `outreach_${r.kind}`, queue_id: r.id, property_id: r.property_id, template_name: service ? null : r.template_name },
      });
      await db.from("whatsapp_outreach_queue").update({ status: "sent", sent_at: now, send_mode: service ? "service" : "template", meta_message_id: outs[0]?.id || null, error: null }).eq("id", r.id);
      await db.from("whatsapp_conversations").update({ last_message_at: now, last_outbound_at: now, updated_at: now }).eq("id", r.conversation_id);
      if (r.request_id) await db.from("client_requests").update({ last_contact_at: now }).eq("id", r.request_id);
      // step F: what waited on the wrong number for this topic is closed (as close_other_branch in the reply agent)
      if (transfer) { const cs = await db.rpc("crm_branch_transfer_close_source", { p_queue: r.id }); if (cs.error) console.error("[outreach] close source", cs.error.message); }
      sent++;
    } catch (e) { await db.from("whatsapp_outreach_queue").update({ status: "failed", error: short((e as any)?.message || e, 500) }).eq("id", r.id); }
  }
  return { sent };
}

// ---- templates -------------------------------------------------------------------------------------
async function templates(submit: boolean) {
  const out: any[] = [];
  for (const rt of await routes()) {
    const t = await token(rt.company_id, rt.route_key);
    if (!t || !rt.meta_waba_id) { out.push({ route: rt.route_key, error: "route_not_ready" }); continue; }
    for (const [name, tp] of Object.entries(TEMPLATES)) {
      const g = await fetch(`https://graph.facebook.com/${GRAPH}/${rt.meta_waba_id}/message_templates?name=${name}&fields=name,status,language,category`, { headers: { Authorization: `Bearer ${t}` } });
      const gd = await g.json().catch(() => ({}));
      const found = (gd?.data || []).find((x: any) => x.name === name);
      let status = found?.status || "MISSING";
      // the category Meta gave it, not the one we asked for (12 Nov): only a template Meta rates UTILITY goes out by itself
      let category = String(found?.category || tp.category).toUpperCase();
      if (status === "MISSING" && submit) {
        const c = await fetch(`https://graph.facebook.com/${GRAPH}/${rt.meta_waba_id}/message_templates`, { method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
          body: JSON.stringify({ name, language: "ar", category: tp.category, components: [{ type: "BODY", text: tp.body, example: { body_text: [tp.example] } }] }) });
        const cd = await c.json().catch(() => ({}));
        status = c.ok ? (cd.status || "PENDING") : `ERROR: ${short(cd?.error?.error_user_msg || cd?.error?.message, 200)}`;
        if (c.ok && cd.category) category = String(cd.category).toUpperCase();
      }
      out.push({ route: rt.route_key, name, status, category });
      if (!status.startsWith("ERROR") && status !== "MISSING") {
        await db.from("whatsapp_template_registry").upsert({ company_id: rt.company_id, route_key: rt.route_key, waba_id: String(rt.meta_waba_id), template_name: name, language: "ar", category, status: String(status).toUpperCase(), last_checked_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "company_id,route_key,template_name,language" });
      }
    }
  }
  return { templates: out };
}

function cors(req: Request) {
  const o = req.headers.get("origin") || "";
  return { "Access-Control-Allow-Origin": ORIGINS.includes(o) ? o : ORIGINS[0], "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
}
Deno.serve(async (req) => {
  const headers = { ...cors(req), "content-type": "application/json; charset=utf-8" };
  const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers });
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ ok: false }, 405);
  const body = await req.json().catch(() => ({}));
  try {
    const secret = req.headers.get("x-crm-agent") || "";
    const ok = secret ? await db.rpc("crm_reply_agent_secret_ok", { p_secret: secret }) : null;
    if (ok && !ok.error && ok.data === true) {
      switch (body?.action) {
        case "queue_requests": return json({ ok: true, ...(await queueRequests()) });
        case "queue_sold": return json({ ok: true, ...(await queueSold(String(body.property_id), body.dry_run !== false)) });
        case "queue_listing": return json({ ok: true, ...(await queueListing(String(body.property_id), body.dry_run !== false, body.preview === true, body.price_drop === true)) });
        case "queue_listing_details": return json({ ok: true, ...(await queueListingDetails(body.preview === true)) });
        case "send_approved": return json({ ok: true, ...(await sendRows()) });
        case "templates": return json({ ok: true, ...(await templates(body.submit === true)) });
      }
      return json({ ok: false, error: "unknown_action" }, 400);
    }
    // the owner approving or rejecting from the CRM
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const u = jwt ? await db.auth.getUser(jwt) : null;
    const prof = u?.data?.user ? await db.from("profiles").select("id,company_id,role,is_active").eq("id", u.data.user.id).maybeSingle() : null;
    if (!prof?.data || prof.data.role !== "owner" || prof.data.is_active === false) return json({ ok: false, error: "owner_only" }, 403);
    const ids: string[] = (Array.isArray(body?.ids) ? body.ids : []).map(String).slice(0, 50);
    if (!ids.length || !["approve", "reject", "promote"].includes(body?.decision)) return json({ ok: false, error: "bad_request" }, 400);
    const now = new Date().toISOString();
    // SQL123: a client kept outside the best 20 (over_cap) goes to the approval list; created_at is now, so «the client wrote
    // after this was prepared» counts from this moment
    if (body.decision === "promote") {
      const pr = await db.from("whatsapp_outreach_queue").update({ status: "pending", reason: null, created_at: now, reviewed_at: null })
        .in("id", ids).eq("company_id", prof.data.company_id).eq("kind", "new_listing").eq("status", "skipped").eq("reason", "over_cap").eq("dry_run", false).select("id");
      if (pr.error) return json({ ok: false, error: pr.error.message }, 500);
      return json({ ok: true, promoted: (pr.data || []).length });
    }
    const up = await db.from("whatsapp_outreach_queue").update({ status: body.decision === "approve" ? "approved" : "skipped", reason: body.decision === "reject" ? "owner_rejected" : null, approved_at: now, decided_by: prof.data.id })
      .in("id", ids).eq("company_id", prof.data.company_id).eq("status", "pending").eq("dry_run", false).select("id");
    if (up.error) return json({ ok: false, error: up.error.message }, 500);
    const done = (up.data || []).map((x: any) => x.id);
    const res = body.decision === "approve" && done.length ? await sendRows(done) : { sent: 0 };
    return json({ ok: true, decided: done.length, ...res });
  } catch (e) { return json({ ok: false, error: short((e as any)?.message || e, 500) }, 500); }
});
