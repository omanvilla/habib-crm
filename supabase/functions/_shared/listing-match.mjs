// SQL123 / R-listing (18 Nov 2026, Ahmed: «نعم سوي اقتراحك»). Which open requests a new (or cheaper) listing goes to.
// Before: any shared word in the area or the wilayat was a match, no order and no limit: «فيلا الصومحان 69» matched 138
// buyers in Barka, all waiting for approval at once. Now every request gets a score and only the best LISTING_CAP go:
//   area     same area (الصومحان ⇄ الصومحان الجنوبية) 40 = «مطابق»; same wilayat only 10 = «قريب», and «قريب» needs a budget
//            the price fits, otherwise it is not sent at all
//   type     the same kind 15, a near word (فيلا for a twin villa) 10, no kind in the request 0
//   budget   price within the budget and at least 80 percent of it 25, cheaper than that 15, up to 15 percent over 10
//   recency  the client's last message: 14 days 20, 45 days 12, 120 days 5. A request without a budget needs a message in
//            the last 60 days (the request's updated_at is touched by bulk repairs, so it says nothing).
export const LISTING_CAP = 20;
const DAY = 86400000;

// «الصومحان الجنوبية»، «صومحان الجنوبيه» and «بركاء الصومحان الجنوبية» are one area (same rule as SQL97 unit_area_key)
export function areaKey(v) {
  return String(v ?? "").trim().toLowerCase()
    .replace(/[ةأإآى]/g, (c) => ({ "ة": "ه", "أ": "ا", "إ": "ا", "آ": "ا", "ى": "ي" })[c])
    .replace(/^(بركاء|بركا|مسقط)\s+/, "").replace(/(^|\s)ال/g, "$1").replace(/\s+/g, " ").trim()
    .replace(/^بركا$/, "بركاء");
}

// a request area that says nothing («غير محدد», «لا محدود», «.», «موقع مميز») is empty; «اي مكان في بركا» keeps «بركا»
export function cleanArea(v) {
  const s = String(v ?? "").replace(/ﻓ/g, "ف").trim()
    .replace(/^(اي|أي)\s*(مكان|منطقه|منطقة)(\s+قريب)?\s*(في\s+)?/, "").trim();
  if (s.replace(/[^\p{L}]/gu, "").length < 2) return "";
  if (/^(غير\s*محد|لا\s*محد|موقع\s*مميز|قريب$)/.test(s)) return "";
  return s;
}

const TYPE_WORDS = {
  villa: ["فيلا", "فله", "فلة", "villa"], twin_villa: ["توين", "فيلا", "villa"], house: ["بيت", "منزل", "house"], apartment: ["شقة", "شقه", "apartment"],
  land: ["ارض", "أرض", "land"], land_residential: ["ارض", "أرض", "land"], land_commercial: ["ارض", "أرض", "land"], resthouse: ["استراحة", "استراحه"], chalet: ["شاليه"], townhouse: ["تاون"],
};

// did an office message already name this price ? «69 الف», «69,000», «69000» (never a bare «69», which is in phone
// numbers and other prices); a rent such as 250 counts only as a whole number
export function priceMentioned(body, price) {
  const p = Math.round(Number(price || 0));
  if (!p) return false;
  const s = String(body || "");
  if (p >= 1000) {
    const k = Math.round(p / 1000);
    return new RegExp(`(^|[^0-9])${k}\\s*(الف|ألف|k\\b)`, "i").test(s) || s.includes(String(p)) || s.includes(p.toLocaleString("en-US"));
  }
  return new RegExp(`(^|[^0-9.,])${p}([^0-9]|$)`).test(s);
}

// the score of one request for one property; null = not sent
export function scoreRequest(prop, r, lastInboundAt, now = Date.now()) {
  const pArea = areaKey(prop.area), pWil = areaKey(prop.wilayat);
  const wanted = [...(Array.isArray(r.preferred_areas) ? r.preferred_areas : []), r.preferred_area].map((a) => areaKey(cleanArea(a)))
    .filter((a) => a.length >= 3 && !/^(جنوبي|جنوبيه|شمالي|شماليه|شرقي|شرقيه|غربي|غربيه|مدينه|حي|منطقه|قريب|اي مكان)$/.test(a));
  const rWil = areaKey(r.wilayat);
  let level = null;
  if (pArea && pArea !== pWil && wanted.some((a) => a !== pWil && (a.includes(pArea) || pArea.includes(a)))) level = "exact";
  else if (pWil && [...wanted, rWil].some((a) => a && (a === pWil || a.includes(pWil) || pWil.includes(a)))) level = "near";
  if (!level) return null;

  const types = [...(Array.isArray(r.property_types) ? r.property_types : []), r.property_type].filter(Boolean).map(String);
  const words = TYPE_WORDS[prop.type] || [];
  let typeScore = 0;
  if (types.length) {
    if (types.includes(prop.type)) typeScore = 15;
    else if (types.some((t) => words.some((w) => t.includes(w)))) typeScore = 10;
    else return null;
  }

  const price = Number(prop.price || 0), budget = Number(r.budget_max || 0);
  let budgetScore = 0;
  if (budget && price) {
    if (price > budget * 1.15) return null;
    budgetScore = price > budget ? 10 : price >= budget * 0.8 ? 25 : 15;
  }
  if (level === "near" && !(budget && price)) return null;

  const ageDays = lastInboundAt ? (now - new Date(lastInboundAt).getTime()) / DAY : Infinity;
  if (!budget && ageDays > 60) return null;
  const recency = ageDays <= 14 ? 20 : ageDays <= 45 ? 12 : ageDays <= 120 ? 5 : 0;

  return { level, score: (level === "exact" ? 40 : 10) + typeScore + budgetScore + recency };
}

// sort the scored candidates, the best first; equal scores: the most recent client message first
export function rankCandidates(list) {
  return [...list].sort((a, b) => b.score - a.score || (new Date(b.lastInboundAt || 0).getTime() - new Date(a.lastInboundAt || 0).getTime()));
}
