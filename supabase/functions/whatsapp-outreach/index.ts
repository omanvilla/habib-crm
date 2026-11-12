// Messages the office starts (owner decisions, 4 Nov 2026). Everything is queued in whatsapp_outreach_queue
// and waits for the owner's approval in "ردود تنتظر موافقتك"; approved rows go out 9am–9pm Oman time,
// as plain text inside the 24-hour window or as an approved template outside it.
//   queue_requests  (hourly cron)  weekly follow-up of open requests: still searching ? / financing approved ?
//                                   never when the client wrote in the last 7 days, max 2 unanswered, stop on "ما ابي"
//   queue_sold      {property_id}   "بخصوص الفيلا اللي سألت عنها في … انحجزت" to everyone who asked, except the buyer.
//                                   R38 (Ahmed 12 Nov): when a unit of the same group is still available (SQL97,
//                                   crm_unit_group_notice) the message is "… انحجزت وحدة منها والمتبقي الثانية والثالثة" +
//                                   "تحب تشوفها ؟" instead (template property_unit_booked_ar_v1 outside the 24 hours)
//   queue_listing   {property_id}   a new listing to open requests that match it, asking first if they still search
//   send_approved   (cron)          sends approved rows
//   templates       {submit}        submits / refreshes the four templates on both numbers
//   approve         (owner JWT)     {ids, decision: approve|reject} → approve sends right away (within hours)
import { createClient } from "npm:@supabase/supabase-js@2";

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
};
const NOUN: Record<string, [string, string, string]> = { // label, "booked" verb, indefinite
  villa: ["الفيلا", "انحجزت", "فيلا"], twin_villa: ["الفيلا", "انحجزت", "توين فيلا"], townhouse: ["الفيلا", "انحجزت", "تاون هاوس"], house: ["البيت", "انحجز", "بيت"],
  land: ["الارض", "انحجزت", "ارض"], land_residential: ["الارض", "انحجزت", "ارض سكنية"], land_commercial: ["الارض", "انحجزت", "ارض تجارية"],
  apartment: ["الشقة", "انحجزت", "شقة"], resthouse: ["الاستراحة", "انحجزت", "استراحة"], chalet: ["الشاليه", "انحجز", "شاليه"], farm: ["المزرعة", "انحجزت", "مزرعة"],
  building: ["المبنى", "انحجز", "مبنى"], penthouse: ["البنتهاوس", "انحجز", "بنتهاوس"], office: ["المكتب", "انحجز", "مكتب"], shop: ["المحل", "انحجز", "محل"],
  warehouse: ["المخزن", "انحجز", "مخزن"], other: ["العقار", "انحجز", "عقار"],
};
const TYPE_WORDS: Record<string, string[]> = {
  villa: ["فيلا", "فله", "فلة", "villa"], twin_villa: ["توين", "فيلا", "villa"], house: ["بيت", "منزل", "house"], apartment: ["شقة", "شقه", "apartment"],
  land: ["ارض", "أرض", "land"], land_residential: ["ارض", "أرض", "land"], land_commercial: ["ارض", "أرض", "land"], resthouse: ["استراحة", "استراحه"], chalet: ["شاليه"], townhouse: ["تاون"],
};
const STOP_RE = /ما\s*ابي|ماابي|ما\s*اريد|لا\s*شكرا|لاشكرا|ما\s*احتاج|وقف|توقف|stop/i;
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
  const area = (Array.isArray(r.preferred_areas) && r.preferred_areas.length ? r.preferred_areas[0] : r.preferred_area) || "";
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
    if (STOP_RE.test(said)) { await db.from("clients").update({ followup_suppressed: true }).eq("id", r.client_id); await db.from("client_requests").update({ next_followup: null, status: "paused", next_action: "العميل طلب ما نتابع" }).eq("id", r.id); continue; }
    // "found" is not an allowed search_status (client_requests_search_status_check): the update failed every hour
    // and the request came back each run (10 Nov 2026). "stopped" (توقف عن البحث) + the reason in next_action.
    if (FOUND_RE.test(said)) { const up = await db.from("client_requests").update({ next_followup: null, status: "paused", search_status: "stopped", next_action: "العميل قال حصل" }).eq("id", r.id); if (up.error) out.push({ request: r.id, error: up.error.message }); continue; }
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
    db.from("deals").select("client_id,stage").eq("property_id", propertyId),
    routes(),
  ]);
  const keys = (reels.data || []).map((r: any) => r.link_key).filter(Boolean);
  const reelMsgs = keys.length ? await db.from("whatsapp_messages").select("client_id").in("property_link_key", keys).eq("direction", "inbound").gte("message_timestamp", since) : { data: [] };
  const buyers = new Set((deals.data || []).filter((d: any) => d.stage !== "lost").map((d: any) => d.client_id));
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
async function queueListing(propertyId: string, dry: boolean) {
  const p = await db.from("properties").select("id,company_id,type,area,wilayat,price,listing_purpose,status,archived,title").eq("id", propertyId).single();
  if (p.error) throw new Error("property_not_found");
  const prop = p.data;
  if (prop.status !== "available" || prop.archived) return { property: prop.title, queued: 0, reason: "not_available" };
  const wantType = prop.listing_purpose === "rent" ? "tenant" : "buyer";
  const reqs = await db.from("client_requests").select("id,client_id,request_type,property_type,property_types,preferred_area,preferred_areas,wilayat,budget_max,last_contact_at,search_status,updated_at")
    .eq("company_id", prop.company_id).eq("status", "active").eq("request_type", wantType).gte("updated_at", new Date(Date.now() - 120 * DAY).toISOString()).limit(500);
  const placeWords = [prop.area, prop.wilayat].filter(Boolean).map((x: string) => x.replace(/^ال/, ""));
  const typeWords = TYPE_WORDS[prop.type] || [];
  const done = await db.from("whatsapp_outreach_queue").select("client_id").eq("kind", "new_listing").eq("property_id", prop.id);
  const already = new Set((done.data || []).map((d: any) => d.client_id));
  // people who already asked about this very property got it in their conversation; and one office message a week
  const reelKeys = ((await db.from("instagram_media_catalog").select("link_key").eq("property_id", prop.id)).data || []).map((r: any) => r.link_key).filter(Boolean);
  const asked = new Set<string>([
    ...(((await db.from("whatsapp_messages").select("client_id").eq("matched_property_id", prop.id)).data || []).map((m: any) => m.client_id)),
    ...(reelKeys.length ? ((await db.from("whatsapp_messages").select("client_id").in("property_link_key", reelKeys)).data || []).map((m: any) => m.client_id) : []),
  ]);
  // and people the office already wrote to about this area (the ad, the details, "متوفر"): for them it is not news.
  // Their open request is followed up weekly instead ("بخصوص طلبك ... لين الحين تبحث ؟").
  const tok = String(prop.area || prop.wilayat || "").replace(/^(بركاء|بركا|مسقط)\s+/, "").split(/\s+/)
    .filter((w: string) => w.length >= 3 && !/^(الجنوبي|الجنوبية|الجنوبيه|الشمالي|الشمالية|الشماليه|مدينة|حي|منطقة)$/.test(w))
    .sort((x: string, y: string) => y.length - x.length)[0];
  const priceKeys = prop.price ? [String(Math.round(Number(prop.price) / 1000)), Number(prop.price).toLocaleString("en-US"), String(Math.round(Number(prop.price)))] : [];
  if (tok) for (const m of ((await db.from("whatsapp_messages").select("client_id,body").eq("company_id", prop.company_id).eq("direction", "outbound")
    .ilike("body", `%${tok}%`).gte("message_timestamp", new Date(Date.now() - 150 * DAY).toISOString()).limit(5000)).data || []))
    if (!priceKeys.length || priceKeys.some((k) => String(m.body || "").includes(k))) asked.add(m.client_id);
  const busy = new Set<string>(((await db.from("whatsapp_outreach_queue").select("client_id").in("status", ["pending", "approved", "sent"]).gte("created_at", new Date(Date.now() - 7 * DAY).toISOString())).data || []).map((m: any) => m.client_id));
  const rows: any[] = [], seen = new Set<string>();
  const noun = NOUN[prop.type]?.[2] || "عقار";
  const label = `${noun} في ${prop.area || prop.wilayat || ""} بـ ${thousands(prop.price)}`.replace(/\s+/g, " ").trim();
  for (const r of reqs.data || []) {
    if (seen.has(r.client_id) || already.has(r.client_id) || asked.has(r.client_id) || busy.has(r.client_id) || r.search_status === "found") continue;
    // without a budget we only trust a recent request
    if (!r.budget_max && new Date(r.updated_at).getTime() < Date.now() - 30 * DAY) continue;
    const areas = [...(Array.isArray(r.preferred_areas) ? r.preferred_areas : []), r.preferred_area, r.wilayat].filter(Boolean).map(String);
    const areaOk = areas.length > 0 && areas.some((a) => placeWords.some((w) => w && (a.includes(w) || w.includes(a.replace(/^ال/, "")))));
    const types = [...(Array.isArray(r.property_types) ? r.property_types : []), r.property_type].filter(Boolean).map(String);
    const typeOk = !types.length || types.some((t) => t === prop.type || typeWords.some((w) => t.includes(w)));
    const budgetOk = !r.budget_max || !prop.price || Number(prop.price) <= Number(r.budget_max) * 1.15;
    if (!areaOk || !typeOk || !budgetOk) continue;
    const cl = await db.from("clients").select("archived,followup_suppressed").eq("id", r.client_id).maybeSingle();
    if (!cl.data || cl.data.archived || cl.data.followup_suppressed) continue;
    const conv = await latestConv(r.client_id);
    if (!conv || await held(conv.id)) continue;
    seen.add(r.client_id);
    rows.push({ company_id: prop.company_id, kind: "new_listing", property_id: prop.id, request_id: r.id, client_id: r.client_id, conversation_id: conv.id, route_key: conv.route_key,
      step: "ask_still_searching", template_name: "new_listing_match_ar_v1", template_params: [label], messages: [`نزل عندنا ${label} ممكن يناسب طلبك`, "لين الحين تبحث ؟"],
      summary: `طلبه: ${requestSummary(r)}`, dry_run: dry, status: "pending" });
  }
  return { property: prop.title, queued: await upsertRows(rows) };
}

// ---- sending ---------------------------------------------------------------------------------------
async function sendRows(ids?: string[]) {
  const h = omanHour();
  if (h < 9 || h >= 21) return { sent: 0, reason: "outside_sending_hours" };
  let q = db.from("whatsapp_outreach_queue").select("*").eq("status", "approved").eq("dry_run", false).lte("scheduled_for", new Date().toISOString()).limit(20);
  if (ids?.length) q = q.in("id", ids);
  const rowsR = await q;
  const reg = await db.from("whatsapp_template_registry").select("route_key,template_name,status");
  const approvedTpl = new Set((reg.data || []).filter((t: any) => String(t.status).toUpperCase() === "APPROVED").map((t: any) => `${t.route_key}|${t.template_name}`));
  let sent = 0;
  for (const r of rowsR.data || []) {
    try {
      const [cl, cv] = await Promise.all([
        db.from("clients").select("phone,phone_normalized,followup_suppressed").eq("id", r.client_id).single(),
        db.from("whatsapp_conversations").select("id,meta_phone_number_id,last_inbound_at,route_key").eq("id", r.conversation_id).single(),
      ]);
      if (cl.data?.followup_suppressed) { await db.from("whatsapp_outreach_queue").update({ status: "skipped", reason: "client_paused" }).eq("id", r.id); continue; }
      // R1/R3 (Ahmed 8 Nov): nothing goes to a chat Ahmed took or is negotiating in; the row waits until he hands it back
      const hold = await db.rpc("crm_chat_hold", { p_conversation: r.conversation_id });
      if (hold.error || hold.data) continue;
      // the client wrote after this was queued: the reply agent / owner handles the live conversation instead
      if (cv.data?.last_inbound_at && new Date(cv.data.last_inbound_at).getTime() > new Date(r.created_at).getTime()) {
        await db.from("whatsapp_outreach_queue").update({ status: "skipped", reason: "client_wrote_after" }).eq("id", r.id); continue;
      }
      const t = await token(r.company_id, r.route_key);
      if (!t || !cv.data) throw new Error("route_not_ready");
      const to = digits(cl.data?.phone_normalized || cl.data?.phone), phoneId = digits(cv.data.meta_phone_number_id);
      const service = !!cv.data.last_inbound_at && Date.now() - new Date(cv.data.last_inbound_at).getTime() < 23 * 3600000;
      if (!service && !approvedTpl.has(`${r.route_key}|${r.template_name}`)) { await db.from("whatsapp_outreach_queue").update({ error: "template_pending" }).eq("id", r.id); continue; }
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
        matched_property_id: r.kind === "new_listing" ? r.property_id : null,
        raw_payload: { source: `outreach_${r.kind}`, queue_id: r.id, property_id: r.property_id, template_name: service ? null : r.template_name },
      });
      await db.from("whatsapp_outreach_queue").update({ status: "sent", sent_at: now, send_mode: service ? "service" : "template", meta_message_id: outs[0]?.id || null, error: null }).eq("id", r.id);
      await db.from("whatsapp_conversations").update({ last_message_at: now, last_outbound_at: now, updated_at: now }).eq("id", r.conversation_id);
      if (r.request_id) await db.from("client_requests").update({ last_contact_at: now }).eq("id", r.request_id);
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
      const g = await fetch(`https://graph.facebook.com/${GRAPH}/${rt.meta_waba_id}/message_templates?name=${name}&fields=name,status,language`, { headers: { Authorization: `Bearer ${t}` } });
      const gd = await g.json().catch(() => ({}));
      let status = (gd?.data || []).find((x: any) => x.name === name)?.status || "MISSING";
      if (status === "MISSING" && submit) {
        const c = await fetch(`https://graph.facebook.com/${GRAPH}/${rt.meta_waba_id}/message_templates`, { method: "POST", headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
          body: JSON.stringify({ name, language: "ar", category: tp.category, components: [{ type: "BODY", text: tp.body, example: { body_text: [tp.example] } }] }) });
        const cd = await c.json().catch(() => ({}));
        status = c.ok ? (cd.status || "PENDING") : `ERROR: ${short(cd?.error?.error_user_msg || cd?.error?.message, 200)}`;
      }
      out.push({ route: rt.route_key, name, status });
      if (!status.startsWith("ERROR") && status !== "MISSING") {
        await db.from("whatsapp_template_registry").upsert({ company_id: rt.company_id, route_key: rt.route_key, waba_id: String(rt.meta_waba_id), template_name: name, language: "ar", category: tp.category, status: String(status).toUpperCase(), last_checked_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "company_id,route_key,template_name,language" });
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
        case "queue_listing": return json({ ok: true, ...(await queueListing(String(body.property_id), body.dry_run !== false)) });
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
    if (!ids.length || !["approve", "reject"].includes(body?.decision)) return json({ ok: false, error: "bad_request" }, 400);
    const now = new Date().toISOString();
    const up = await db.from("whatsapp_outreach_queue").update({ status: body.decision === "approve" ? "approved" : "skipped", reason: body.decision === "reject" ? "owner_rejected" : null, approved_at: now, decided_by: prof.data.id })
      .in("id", ids).eq("company_id", prof.data.company_id).eq("status", "pending").eq("dry_run", false).select("id");
    if (up.error) return json({ ok: false, error: up.error.message }, 500);
    const done = (up.data || []).map((x: any) => x.id);
    const res = body.decision === "approve" && done.length ? await sendRows(done) : { sent: 0 };
    return json({ ok: true, decided: done.length, ...res });
  } catch (e) { return json({ ok: false, error: short((e as any)?.message || e, 500) }, 500); }
});
