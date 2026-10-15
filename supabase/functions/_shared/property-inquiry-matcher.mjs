// Pure evidence matching shared by live WhatsApp intake and reviewed replay.
// No network, database writes, model-selected IDs, or customer communication.
// Callers must supply the complete company/branch/private-authorized inventory.
const digit = c => String('٠١٢٣٤٥٦٧٨٩'.includes(c) ? '٠١٢٣٤٥٦٧٨٩'.indexOf(c) : '۰۱۲۳۴۵۶۷۸۹'.indexOf(c));
const words = value => String(value ?? '').toLowerCase().normalize('NFKC')
  .replace(/[٠-٩۰-۹]/g, digit).replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/[\u064B-\u065F\u0670\u0640]/g, '');

export function normalizeListingText(value) {
  return words(value).replace(/[٬,](?=\d{3}(?:\D|$))/g, '')
    .replace(/٫/g, '.').replace(/(\d+(?:\.\d+)?)\s*(?:الف|الاف|thousand|k)(?=\s|[^\p{L}]|$)/gu,
      (_, n) => String(Number(n) * 1000))
    .replace(/([\u0621-\u064A])(\d)|(\d)([\u0621-\u064A])/g, (_, letter1, n1, n2, letter2) => letter1 ? `${letter1} ${n1}` : `${n2} ${letter2}`)
    .replace(/[^\p{L}\p{N}.]+/gu, ' ').replace(/\.(?!\d)|(?<!\d)\./g, ' ')
    .trim().replace(/\s+/g, ' ');
}
const whole = (body, value) => Boolean(value) && (` ${body} `).includes(` ${value} `);
const propertyWords = /(?:فيلا|فلل|فله|عقار|بيت|بيوت|منزل|شقه|شقق|ارض|اراضي|تاون هاوس|توين|villa|house|apartment|property|land|listing)/i;
const askWords = /(?:تفاصيل|تفاصل|معلومات|صور|سعر|قيمه|موجود|متوفر|متاح|نعاين|اعاين|اشوف|نشوف|زياره|زيارة|وين|موقع|اريد|بغيت|ابغي|ابغى|ابحث|نبحث|ادور|ندور|كلمتك|بخصوص|ممكن|هل|عندك|looking|searching|details|available|viewing|interested|price|location|information)/i;
const specificAsk = /(?:تفاصيل|تفاصل|معلومات|صور|سعرها|قيمتها|هذا|هذي|هذه|هاذي|المعلن|الاعلان|معروض|موجود|متوفر|متاح|نعاين|اعاين|اشوف|نشوف|زياره|موقع|details|available|this|viewing|the villa|the property)/i;
const generalSearch = /(?:ابحث|نبحث|ادور|ندور|دور لي|تبحث|ميزاني|بحدود|حدود ميزان|بحد اقصي|بحد اقصى|ما يزيد|اقل من|لا يتجاوز|لا تتجاوز|بين \d|عندكم (?:فلل|بيوت|شقق|اراضي|عقارات)|عندك (?:فلل|بيوت|شقق|اراضي|عقارات)|looking for|searching|budget|up to|under \d)/i;
const rejection = /(?:غير مهتم|مو مهتم|لست مهتم|ما مهتم|ما (?:اريد|بغيت|ابغي|ابغى|يناسب|يناسبني|ناسبني|عجبني)|لا (?:اريد|ابغي|ابغى|يناسب|يناسبني)|لم يناسب|لا شكرا|تم البيع|انباع|not interested|do not want|don't want|not suitable|already sold)/i;
const seller = /(?:انا المالك|انا مالك|عندي (?:فيلا|فله|عقار|بيت|منزل|شقه|ارض).{0,45}(?:للبيع|للايجار)|اريد ابيع|بغيت ابيع|اعرض (?:عقار|فيلا|بيت)|i am the owner|my (?:villa|house|property) for sale)/i;

// These are spelling aliases, not geographic routing rules. Unknown areas use
// their exact stored name; a broad wilayat never becomes a specific area.
const areaDefinitions = [
  ['الخوض', ['الخوض', 'الخوضه', 'al khoudh', 'al khoud', 'khoudh', 'khoud']],
  ['المعبيله', ['المعبيله', 'المعبيلة', 'al mabella', 'mabella', 'maabilah', 'mabellah']],
  ['الموالح', ['الموالح', 'al mawaleh', 'mawaleh']], ['الحيل', ['الحيل', 'al hail']],
  ['العذيبه', ['العذيبه', 'العزيبه', 'al azaiba', 'azaiba']], ['بوشر', ['بوشر', 'bousher', 'bosher']],
  ['القرم', ['القرم', 'qurum']], ['الانصب', ['الانصب', 'ansab']], ['غلا', ['غلا', 'ghala']],
  ['صومحان', ['الصومحان', 'صومحان', 'soumahan', 'soumahan', 'souham', 'soumhan']],
  ['الهرم', ['الهرم', 'الحرم', 'al harm', 'al hurm']], ['الرميس', ['الرميس', 'الرميث', 'rumais', 'rumays']],
  ['العاصم', ['العاصم', 'حي عاصم', 'al asim']], ['العقده', ['العقده', 'al aqda']],
  ['المريصي', ['المريصي', 'المريسي', 'al muraisi']], ['الشخاخيط', ['الشخاخيط']],
  ['السوادي', ['السوادي', 'sawadi']], ['المنومه', ['المنومه', 'المنعمه', 'al manumah']],
  ['الفليج', ['الفليج']], ['العامرات', ['العامرات', 'al amerat', 'amerat']],
  ['الموج', ['الموج', 'al mouj']], ['وادي زها', ['وادي زها', 'وادي زهاء', 'wadi zahaa', 'wadi zaha']],
  ['يتي', ['يتي', 'yiti']], ['روي', ['روي', 'ruwi']], ['مطرح', ['مطرح', 'muttrah']],
].map(([name, aliases]) => ({name, aliases: [...new Set(aliases.map(normalizeListingText))]}));
const ordinals = new Map([
  ['الاولي', '1'], ['الاول', '1'], ['الاولى', '1'], ['الثانيه', '2'], ['الثاني', '2'],
  ['الثالثه', '3'], ['الثالث', '3'], ['الرابعه', '4'], ['الرابع', '4'], ['الخامسه', '5'], ['الخامس', '5'],
  ['السادسه', '6'], ['السادس', '6'], ['السابعه', '7'], ['السابع', '7'], ['الثامنه', '8'], ['الثامن', '8'],
  ['التاسعه', '9'], ['التاسع', '9'], ['الشماليه', 'north'], ['شمال', 'north'], ['north', 'north'],
  ['الجنوبيه', 'south'], ['جنوب', 'south'], ['south', 'south'],
].map(([name, n]) => [normalizeListingText(name), n]));
function escaped(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function areaOccurrences(body, definitions = areaDefinitions) {
  const found = [];
  for (const def of definitions) for (const alias of def.aliases) {
    const re = new RegExp(`(?:^| )(?:و|ب|وب|ل|ول|ف)?(${escaped(alias)})(?= |$)`, 'g');
    for (const hit of body.matchAll(re)) {
      const start = hit.index + hit[0].length - hit[1].length;
      const tail = body.slice(start + alias.length).trimStart().split(' ')[0];
      const subarea = ordinals.get(tail) || (/^[1-9]$/.test(tail) ? tail : null);
      if (!found.some(x => x.start === start && x.name === def.name)) found.push({name: def.name, start, end: start + alias.length, subarea});
    }
  }
  return found.sort((a, b) => a.start - b.start || b.end - a.end);
}
function inventoryAreas(candidate) {
  const body = normalizeListingText([candidate.area, candidate.title].filter(Boolean).join(' '));
  const known = areaOccurrences(body);
  if (known.length) return known;
  const area = normalizeListingText(candidate.area);
  return area.length >= 3 ? [{name: area, subarea: null}] : [];
}
function definitionsFor(candidates) {
  const defs = [...areaDefinitions];
  for (const candidate of candidates) {
    const area = normalizeListingText(candidate.area);
    if (area.length >= 3 && !areaOccurrences(area).length && !defs.some(x => x.name === area)) defs.push({name: area, aliases: [area]});
  }
  return defs;
}
function propertyIntentInfo(text, areas = areaOccurrences(normalizeListingText(text))) {
  const body = normalizeListingText(text);
  const denied = rejection.test(body) || seller.test(body);
  const explicit = specificAsk.test(body);
  const indefiniteSearch = /(?:اريد|بغيت|ابغي|ابغى|عندك|عندكم) (?:اشتري |شراء )?(?:فيلا|فله|بيت|عقار|منزل|شقه|ارض)(?: |$)/.test(body) && !explicit;
  const generic = (generalSearch.test(body) || indefiniteSearch) && !/(?:تفاصيل (?:هذا|هذي|هذه|الفيلا|البيت|العقار)|this (?:villa|house|property))/i.test(body);
  const terse = areas.length > 0 && /\d/.test(body) && body.split(' ').length <= 10 && !generic;
  const bareQuestion = /^(?:ممكن |لو سمحت |اريد |بغيت )?(?:(?:ال)?(?:تفاصيل|تفاصل|معلومات|صور)|كم السعر|كم سعرها|كم قيمتها|السعر|الموقع|متوفر|متاح|وين موقعها|وين الموقع|هل متوفر|how much|what is the price|is it available)(?: |$)/i.test(body)
    || /^(?:هل )?(?:هذا|هذي|هذه|هاذي).{0,20}(?:متوفر|موجود|متاح)/.test(body);
  const sendRequest = /(?:^| )(?:ارسل|ارسلي|ارسلوا|ترسل|ترسلي|تبعتيلي|تبعتي|ابعث|ابعثي)(?: |$)/.test(body)
    && (areas.length > 0 || propertyWords.test(body) || /(?:الموقع|التفاصيل|الصور)/.test(body));
  const intent = !denied && ((propertyWords.test(body) && askWords.test(body)) || (explicit && areas.length > 0) || bareQuestion || sendRequest || terse);
  return {body, denied, explicit, generic, terse, intent};
}
export function isPropertyRequest(text) { return propertyIntentInfo(text).intent; }
export function isHumanListingResponse(message) {
  return message?.direction === 'outbound' && message?.actor_type === 'human'
    && !['failed', 'undelivered', 'rejected'].includes(String(message?.delivery_status || '').toLowerCase())
    && Boolean(String(message?.body || message?.caption || '').trim());
}

// Preserve case-sensitive media IDs. A host/profile alone is never a listing.
export function normalizeListingUrl(input) {
  const value = String(input || '').replace(/&amp;/g, '&').trim().replace(/[\])}>,.;!؟،]+$/g, '');
  let match = value.match(/^(?:https?:\/\/)?(?:www\.)?(?:instagram\.com|instagr\.am)\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)(?:[/?#]|$)/i);
  if (match) return `instagram:${match[1]}`;
  match = value.match(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\/share\/(?:reel|p)\/([A-Za-z0-9_-]+)(?:[/?#]|$)/i);
  if (match) return `instagram-share:${match[1]}`;
  match = value.match(/^(?:https?:\/\/)?(?:www\.)?youtu\.be\/([A-Za-z0-9_-]+)(?:[/?#]|$)/i)
    || value.match(/^(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/([A-Za-z0-9_-]+)(?:[/?#]|$)/i);
  if (match) return `youtube:${match[1]}`;
  match = value.match(/^(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?[^#]*\bv=([A-Za-z0-9_-]+)/i);
  return match ? `youtube:${match[1]}` : null;
}
function linksIn(text) {
  return [...new Set((String(text || '').match(/(?:https?:\/\/|www\.)[^\s<>"']+/gi) || []).map(normalizeListingUrl).filter(Boolean))];
}
function candidateLinks(candidate) {
  const urls = Array.isArray(candidate.marketing_urls) ? candidate.marketing_urls : [];
  const keys = Array.isArray(candidate.marketing_keys) ? candidate.marketing_keys : [];
  return new Set([...urls.map(normalizeListingUrl).filter(Boolean), ...keys.filter(x => /^(instagram|instagram-share|youtube):[A-Za-z0-9_-]+$/.test(x))]);
}

export function matchListingReferences(text, candidates, {requireIntent = true} = {}) {
  const raw = String(text || '').slice(0, 12000);
  const inventory = [...new Map((Array.isArray(candidates) ? candidates : []).filter(x => x?.id).map(x => [String(x.id), x])).values()];
  const body = normalizeListingText(raw), areas = areaOccurrences(body, definitionsFor(inventory));
  const info = propertyIntentInfo(raw, areas);
  const result = {matches: [], ambiguous: false, hasPropertyIntent: info.intent, generalRequest: !info.denied && info.generic, areas: [...new Set(areas.map(x => x.name))]};
  if (!body || (requireIntent && (info.denied || info.generic))) return result;
  const matched = new Map(), conflicts = [], titlePriceEvidence = new Map();
  const evidenceRank = {exact_link: 4, exact_code: 3, exact_title: 2, area_price: 1};
  const addGroup = (rows, facts, quote = raw.trim().slice(0, 6000)) => {
    if (rows.length > 1) { conflicts.push({ids: rows.map(x => String(x.id)), kind: facts.kind}); return; }
    if (rows.length === 1) {
      const id = String(rows[0].id), prior = matched.get(id);
      if (!prior || evidenceRank[facts.kind] > evidenceRank[prior.matched_facts.kind]) matched.set(id, {property_id: id, quote, matched_facts: facts});
    }
  };

  // A pasted exact unique saved listing link/code is itself a specific reference.
  for (const key of linksIn(raw)) addGroup(inventory.filter(x => candidateLinks(x).has(key)), {kind: 'exact_link', link_key: key});
  for (const value of new Set(inventory.map(x => normalizeListingText(x.property_code)).filter(x => x.length >= 3))) {
    if (!whole(body, value) || /^\d{7,}$/.test(value)) continue;
    if (/^\d+$/.test(value) && !new RegExp(`(?:رمز العقار|property code) ${escaped(value)}(?: |$)`).test(body)) continue;
    if (requireIntent && !info.intent && body !== value && !/(?:رمز العقار|property code)/i.test(body)) continue;
    addGroup(inventory.filter(x => normalizeListingText(x.property_code) === value), {kind: 'exact_code', code: value});
  }
  if (!requireIntent || info.intent) {
    for (const title of new Set(inventory.map(x => normalizeListingText(x.title)).filter(x => x.length >= 8 && propertyWords.test(x)))) {
      if (whole(body, title) && (info.explicit || !requireIntent)) addGroup(inventory.filter(x => normalizeListingText(x.title) === title), {kind: 'exact_title', title});
    }
    const prices = [...body.matchAll(/\b\d+(?:\.\d+)?\b/g)].map(hit => ({value: Number(hit[0]), raw: hit[0], start: hit.index, end: hit.index + hit[0].length}));
    let priorListingPriceEnd = -1;
    for (const token of prices) {
      if (token.raw.split('.')[0].length > 6 || (token.value >= 1900 && token.value <= 2100 && !/(?:ريال|omr|rial)/i.test(body.slice(Math.max(0, token.start - 8), token.end + 12)))) continue;
      const beforeAmount = body.slice(Math.max(0, token.start - 28), token.start);
      if (/(?:مساح[\p{L}]*|غرف[\p{L}]*|حمام[\p{L}]*|رقم(?: [\p{L}]+){0,2}|الهاتف|هاتف|واتساب|قطع[\p{L}]*|سن[\p{L}]*|موديل|سنه|عام|phone|plot|sqm|size|bedrooms?|bathrooms?|year)\s*$/u.test(beforeAmount)) continue;
      // A listing may place many room/size details between area and price.
      // End its section at an evidenced price; never carry the preceding
      // listing's area forward to the following listing's price.
      const maxDistance = (!requireIntent || info.explicit) ? 2000 : 65;
      const surrounding = areas.filter(area => area.start > priorListingPriceEnd)
        .map(area => ({...area, before: area.end <= token.start, distance: token.start >= area.end ? token.start - area.end : area.start >= token.end ? area.start - token.end : 0}));
      const preceding = surrounding.filter(area => area.before && area.distance <= maxDistance);
      const conflictingAreas = new Set(preceding.map(area => area.name)).size > 1
        || new Set(preceding.map(area => area.subarea).filter(Boolean)).size > 1;
      const ranked = (preceding.length ? preceding : surrounding.filter(area => area.distance <= 65)).sort((a, b) => a.distance - b.distance);
      if (!ranked.length || ranked[0].distance > maxDistance) continue;
      const nearest = ranked.filter(x => x.distance === ranked[0].distance);
      if (new Set(nearest.map(x => x.name)).size > 1) { result.ambiguous = true; continue; }
      const area = nearest[0];
      // A numbered area (الخوض 7) is not itself a price; nor are room counts,
      // phone numbers, dimensions or dates. Bare shorthand needs listing intent.
      if (token.value < 10 || /(?:غرف|غرفه|حمام|متر|م2|m2|sqm|bed|bath|سنوات|سنه|year)/i.test(body.slice(token.end, token.end + 12))) continue;
      const currency = /(?:ريال|omr|rial)/i.test(body.slice(Math.max(0, token.start - 6), token.end + 12));
      const possible = new Set([token.value]);
      if (token.value >= 10 && token.value < 1000 && (info.explicit || info.terse || !requireIntent)) possible.add(token.value * 1000);
      if (token.value < 1000 && !currency && !info.explicit && !info.terse && requireIntent) continue;
      const explicitPrice = currency || /(?:السعر|سعرها|المطلوب|المبلغ|قيمتها|price|asking)\s*$/i.test(beforeAmount);
      const matchesInventoryPrice = inventory.some(candidate => possible.has(Number(candidate.price)));
      if (conflictingAreas) {
        if (explicitPrice || matchesInventoryPrice) { result.ambiguous = true; priorListingPriceEnd = token.end; }
        continue;
      }
      for (const candidate of inventory) {
        if (matched.get(String(candidate.id))?.matched_facts.kind !== 'exact_title'
          || !inventoryAreas(candidate).some(a => a.name === area.name && (!area.subarea || a.subarea === area.subarea))) continue;
        if (!titlePriceEvidence.has(String(candidate.id))) titlePriceEvidence.set(String(candidate.id), new Set());
        for (const value of possible) titlePriceEvidence.get(String(candidate.id)).add(value);
      }
      const rows = inventory.filter(candidate => possible.has(Number(candidate.price)) && inventoryAreas(candidate).some(a => a.name === area.name && (!area.subarea || a.subarea === area.subarea)));
      addGroup(rows, {kind: 'area_price', area: area.name, subarea: area.subarea, price: rows.length === 1 ? Number(rows[0].price) : null});
      if (rows.length || explicitPrice) priorListingPriceEnd = token.end;
    }
  }
  // A title alone cannot overrule an explicitly incompatible price for that
  // area. A saved link/code still identifies the listing despite a stale price.
  for (const candidate of inventory) {
    const id = String(candidate.id), amounts = titlePriceEvidence.get(id);
    if (matched.get(id)?.matched_facts.kind === 'exact_title' && amounts?.size && !amounts.has(Number(candidate.price))) {
      matched.delete(id); result.ambiguous = true;
    }
  }
  result.matches = [...matched.values()];
  if (result.matches.length) result.hasPropertyIntent = true;
  // Strong exact evidence may resolve a coarse duplicate-area/price ambiguity.
  if (conflicts.some(group => !group.ids.some(id => matched.has(id) && evidenceRank[matched.get(id).matched_facts.kind] > evidenceRank[group.kind]))) result.ambiguous = true;
  return result;
}
