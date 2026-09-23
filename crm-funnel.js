/* Property acquisition insights. Reads are explicit and use the caller's RLS. */
(function (root) {
  'use strict';

  function escape(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function count(value) {
    if (value == null || value === '' || typeof value === 'boolean') return null;
    var n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  function number(value) {
    var n = count(value);
    return n == null ? 'غير متاح' : n.toLocaleString('ar-OM');
  }

  function instagramUrl(raw) {
    try {
      var parsed = new URL(String(raw || '').trim());
      if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) return null;
      if (!/^(www\.|m\.)?instagram\.com$/i.test(parsed.hostname)) return null;
      var match = parsed.pathname.match(/^\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)\/?$/);
      return match ? 'https://www.instagram.com/' + (match[1] === 'reels' ? 'reel' : match[1]) + '/' + match[2] + '/' : null;
    } catch (_) { return null; }
  }

  function mediaIdentity(item) {
    if (item.media_id || item.instagram_media_id) return 'id:' + String(item.media_id || item.instagram_media_id);
    var url = instagramUrl(item.url);
    if (url) return 'shortcode:' + url.split('/')[4];
    return item.id ? 'event:' + String(item.id) : null;
  }

  function uniqueMedia(rows) {
    var latest = new Map();
    (rows || []).forEach(function (row) {
      var key = mediaIdentity(row);
      if (!key) return;
      var previous = latest.get(key);
      var timestamp = Date.parse(row.last_synced_at || row.updated_at || row.created_at || '') || 0;
      var previousTime = previous ? Date.parse(previous.last_synced_at || previous.updated_at || previous.created_at || '') || 0 : -1;
      if (!previous || timestamp > previousTime || (timestamp === previousTime && row.sync_status === 'synced' && previous.sync_status !== 'synced')) latest.set(key, row);
    });
    // Before the first sync the same media may be identified only by its URL.
    var canonical = new Map();
    latest.forEach(function (row) {
      var url = instagramUrl(row.url);
      var key = url ? 'shortcode:' + url.split('/')[4] : mediaIdentity(row);
      var previous = canonical.get(key);
      var t = Date.parse(row.last_synced_at || row.updated_at || row.created_at || '') || 0;
      var pt = previous ? Date.parse(previous.last_synced_at || previous.updated_at || previous.created_at || '') || 0 : -1;
      if (!previous || t > pt || (t === pt && row.sync_status === 'synced' && previous.sync_status !== 'synced')) canonical.set(key, row);
    });
    return Array.from(canonical.values());
  }

  function summarizeMedia(rows) {
    var media = uniqueMedia(rows);
    var result = { media_count: media.length, views: null, reach_non_unique: null, interactions: null, known: {}, media: media };
    [['views', 'views'], ['reach_non_unique', 'reach'], ['interactions', 'total_interactions']].forEach(function (pair) {
      var values = media.map(function (item) { return count(item[pair[1]]); }).filter(function (v) { return v != null; });
      result[pair[0]] = values.length ? values.reduce(function (sum, n) { return sum + n; }, 0) : null;
      result.known[pair[0]] = values.length;
    });
    return result;
  }

  function cohortRate(numerator, denominator) {
    var n = count(numerator), d = count(denominator);
    if (n == null || d == null || d === 0 || n > d) return null;
    return Math.round(n / d * 1000) / 10;
  }

  function parseLinks(text) {
    var invalid = [], links = [], identities = new Set(), duplicates = 0;
    String(text || '').split(/\r?\n/).forEach(function (line, index) {
      line = line.trim();
      if (!line) return;
      var url = instagramUrl(line);
      if (!url) { invalid.push(index + 1); return; }
      var identity = url.split('/')[4];
      if (identities.has(identity)) { duplicates++; return; }
      identities.add(identity); links.push(url);
    });
    return { links: links, invalid_lines: invalid, duplicate_count: duplicates };
  }

  function normalizePhone(value) {
    var text = String(value || '').replace(/[٠-٩۰-۹]/g, function (c) { var n = c.charCodeAt(0); return String(n >= 1776 ? n - 1776 : n - 1632); }).replace(/[\s().-]/g, '');
    if (/^00/.test(text)) text = '+' + text.slice(2);
    if (/^[279]\d{7}$/.test(text)) text = '+968' + text;
    if (!/^\+?[1-9]\d{7,14}$/.test(text)) throw new Error('أدخل رقم واتساب المكتب الصحيح مع رمز الدولة');
    return text.replace(/^\+/, '');
  }

  function whatsappLink(property, phone, mediaUrl) {
    var target = normalizePhone(phone);
    var url = instagramUrl(mediaUrl);
    var code = String(property.property_code || property.property_id || property.id || '').trim();
    if (!url && !/^[A-Za-z0-9_-]{1,80}$/.test(code)) throw new Error('أضف رابط منشور أو رمز عقار صالح أولًا');
    var message = 'مرحبًا مهتم بهذا العقار' + (property.title ? ' ' + String(property.title).slice(0, 180) : '');
    // A received permalink provides Instagram evidence. A UUID fallback identifies
    // the property only; it must not be presented as proven Instagram attribution.
    message += '\n' + (url || '[property-code:' + code + ']');
    return 'https://wa.me/' + target + '?text=' + encodeURIComponent(message);
  }

  var api = { instagramUrl: instagramUrl, mediaIdentity: mediaIdentity, uniqueMedia: uniqueMedia, summarizeMedia: summarizeMedia, cohortRate: cohortRate, parseLinks: parseLinks, normalizePhone: normalizePhone, whatsappLink: whatsappLink };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CRMFunnel = api;
  if (typeof document === 'undefined') return;

  var overviewData = null, overviewQuery = '', overviewPage = 0, overviewVersion = 0;
  var propertyVersions = new Map(), propertyData = new Map(), busy = new Set();
  var reviewRows = [], reviewPage = 0, reviewPropertyId = null, reviewVersion = 0;
  var scopeKey = null, routes = [], routesLoaded = false, dialog = null, dialogProperty = null, pendingFocus = null;
  var PAGE_SIZE = 12;

  function getScope() {
    return (typeof currentProfile !== 'undefined' && currentProfile ? currentProfile.company_id : '') + ':' + (typeof currentUser !== 'undefined' && currentUser ? currentUser.id : '');
  }

  function ensureScope() {
    var next = getScope();
    if (next !== scopeKey) { reset(); scopeKey = next; }
    return next;
  }

  function reset() {
    overviewData = null; overviewQuery = ''; overviewPage = 0; overviewVersion++;
    propertyVersions.clear(); propertyData.clear(); routes = []; routesLoaded = false;
    reviewRows = []; reviewVersion++;
    ['igPerformanceContent', 'pdAcquisitionFunnel'].forEach(function (id) { var el = document.getElementById(id); if (el) el.replaceChildren(); });
    if (dialog && dialog.open) dialog.close();
  }

  function canWrite() { return typeof canEdit === 'function' && canEdit(); }
  function toast(message, type) { if (typeof showToast === 'function') showToast(message, type || 'info'); }
  function message(error) {
    var raw = String(error && error.message || error || 'تعذر الاتصال');
    var mapped = {
      link_already_mapped_to_another_property: 'هذا المنشور مربوط بعقار آخر. راجع العقار الصحيح قبل إعادة استخدام الرابط.',
      instagram_post_or_reel_link_required: 'أدخل رابط منشور أو Reel كاملًا من Instagram.',
      one_to_fifty_links_required: 'أضف من 1 إلى 50 رابطًا في كل عملية.',
      property_not_found: 'العقار غير متاح لحسابك أو لم يعد موجودًا.',
      not_allowed: 'لا تملك صلاحية هذا الإجراء.'
    };
    var key = Object.keys(mapped).find(function (item) { return raw.includes(item); });
    return key ? mapped[key] : raw;
  }
  function stamp(value) {
    if (!value || Number.isNaN(Date.parse(value))) return 'لم تُحدّث القياسات بعد';
    return new Date(value).toLocaleString('ar-OM', { dateStyle: 'short', timeStyle: 'short' });
  }
  function button(action, text, id, extra) { return '<button type="button" class="btn-secondary" data-funnel-action="' + action + '"' + (id ? ' data-property-id="' + escape(id) + '"' : '') + (extra || '') + '>' + escape(text) + '</button>'; }
  function metric(label, value, hint) { return '<div class="cf-metric"><strong>' + number(value) + '</strong><span>' + escape(label) + '</span>' + (hint ? '<small>' + escape(hint) + '</small>' : '') + '</div>'; }
  function errorHtml(message, action, id) { return '<div class="cf-error" role="alert"><strong>تعذر تحميل البيانات</strong><p>' + escape(message) + '</p>' + button(action, 'إعادة المحاولة', id) + '</div>'; }
  function loadingHtml() { return '<div class="empty" role="status" style="padding:24px">جاري تحميل الأداء المحفوظ…</div>'; }

  async function fetchFunnel(propertyId) {
    var result = await supa.rpc('crm_property_acquisition_funnel', { p_property_id: propertyId || null });
    if (result.error) throw result.error;
    var data = result.data;
    if (!data || !Array.isArray(data.properties)) throw new Error('استجابة الأداء غير مكتملة؛ لم نعتبرها أرقامًا صفرية');
    return data;
  }

  async function loadOverview() {
    var mount = document.getElementById('igPerformanceContent');
    if (!mount) return;
    var scope = ensureScope(), version = ++overviewVersion;
    mount.innerHTML = loadingHtml();
    try {
      var data = await fetchFunnel(null);
      if (version !== overviewVersion || scope !== getScope()) return;
      overviewData = data;
      if (Array.isArray(data.whatsapp_routes)) routes = data.whatsapp_routes;
      data.properties.forEach(function (property) { propertyData.set(property.property_id, property); });
      renderOverview();
    } catch (error) {
      if (version === overviewVersion && scope === getScope()) mount.innerHTML = errorHtml(message(error), 'overview');
    }
  }

  function renderOverview() {
    var mount = document.getElementById('igPerformanceContent');
    if (!mount || !overviewData) return;
    var properties = overviewData.properties;
    var summary = summarizeMedia(properties.reduce(function (all, p) { return all.concat(p.media || []); }, []));
    var h = '<div class="cf-note">هذه مؤشرات المنشورات المرتبطة بعقارات CRM، وليست إجمالي حساب إنستغرام. تُحسب كل قطعة محتوى مرة واحدة حتى إن رُبطت بأكثر من عقار.</div>';
    h += '<div class="cf-metrics">' + metric('منشورات مختلفة مرتبطة', summary.media_count) + metric('مجموع المشاهدات المسجلة', summary.views, 'المشاهدة قد تتكرر للشخص نفسه') + metric('مجموع الوصول لكل منشور', summary.reach_non_unique, 'ليس عدد أشخاص فريدًا بين المنشورات') + metric('مجموع التفاعلات المسجلة', summary.interactions) + '</div>';
    h += '<div class="cf-footnote">المشاهدات متاحة لـ ' + number(summary.known.views) + ' من ' + number(summary.media_count) + ' منشورات. غير المتاح لا يُعرض كصفر. الأرقام محفوظة من آخر تحديث لكل منشور وقد تختلف أوقاته.</div>';
    if (Number(overviewData.unresolved_total) > 0) h += '<div class="cf-note">' + number(overviewData.unresolved_total) + ' رسالة أو صورة أو مرجع عقار بانتظار الربط البشري. لم تُنسب لعقار بالتخمين. ' + button('review', 'مراجعة المراجع غير المرتبطة') + '</div>';
    h += '<label class="fl" for="cfPropertySearch">ابحث عن العقار بالاسم أو الرمز</label><input class="fi" id="cfPropertySearch" value="' + escape(overviewQuery) + '" placeholder="اسم العقار أو رمزه" autocomplete="off">';
    h += '<div id="cfPropertyResults"></div>';
    mount.innerHTML = h;
    mount.querySelector('#cfPropertySearch').addEventListener('input', function (event) { overviewQuery = event.target.value; overviewPage = 0; renderOverviewRows(); });
    renderOverviewRows();
  }

  function renderOverviewRows() {
    var target = document.getElementById('cfPropertyResults');
    if (!target || !overviewData) return;
    var query = overviewQuery.trim().toLocaleLowerCase('ar');
    var rows = overviewData.properties.filter(function (p) { return !query || [p.title, p.property_code].join(' ').toLocaleLowerCase('ar').includes(query); }).sort(function (a, b) { return (Number(b.media_count) || 0) - (Number(a.media_count) || 0) || String(a.title || '').localeCompare(String(b.title || ''), 'ar'); });
    var pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    overviewPage = Math.min(overviewPage, pages - 1);
    var shown = rows.slice(overviewPage * PAGE_SIZE, (overviewPage + 1) * PAGE_SIZE);
    var h = '<div class="cf-property-grid">';
    shown.forEach(function (p) {
      var media = summarizeMedia(p.media || []);
      h += '<article class="cf-property"><div><h3>' + escape(p.title || 'عقار') + '</h3>' + (p.property_code ? '<small>رمز العقار: ' + escape(p.property_code) + '</small>' : '') + '</div><div class="cf-mini-metrics">' + metric('منشورات مرتبطة', media.media_count) + metric('مشاهدات مسجلة', media.views) + metric('مستفسرون بدليل إنستغرام', p.instagram_attributed_clients) + metric('طلبات العقار المرتبطة', p.attributed_requests) + '</div><p class="cf-footnote">آخر تحديث قياسات: ' + escape(stamp(p.latest_synced_at)) + '</p><div class="cf-actions">' + button('open-property', 'فتح أداء العقار', p.property_id) + (canWrite() ? button('links', 'إضافة روابط', p.property_id) : '') + '</div></article>';
    });
    h += '</div>';
    if (!shown.length) h += '<div class="empty">' + (query ? 'لا يوجد عقار يطابق البحث' : 'لا توجد عقارات ظاهرة لحسابك. أضف العقار من قسم العقارات ثم اربط منشوراته.') + '</div>';
    h += '<div class="cf-pagination"><span>' + number(rows.length) + ' عقار · صفحة ' + number(overviewPage + 1) + ' من ' + number(pages) + '</span>' + button('previous', 'السابق', null, overviewPage === 0 ? ' disabled' : '') + button('next', 'التالي', null, overviewPage + 1 >= pages ? ' disabled' : '') + '</div>';
    target.innerHTML = h;
  }

  function cohortHtml(property) {
    var cohort = property.conversion_cohort || {};
    var denominator = count(cohort.attributed_request_count);
    var stages = [['qualified_request_count', 'طلبات مؤهلة'], ['requests_with_booked_visit', 'طلبات لها زيارة مسجلة'], ['requests_with_completed_visit', 'طلبات لها زيارة مكتملة'], ['requests_with_closed_deal', 'طلبات لها صفقة مغلقة']];
    var h = '<h4>نتائج نفس مجموعة الطلبات المرتبطة</h4><p class="cf-footnote">الأساس: ' + number(denominator) + ' طلبًا مختلفًا مرتبطًا بهذا العقار من جميع المصادر، وليست نسبة تحويل حصرية لإنستغرام. كل نسبة من هذه المجموعة نفسها؛ المراحل قد تتداخل ولا تمثل قسمة عدد زيارات على عدد أشخاص.</p><div class="cf-cohort">';
    stages.forEach(function (stage) {
      var value = count(cohort[stage[0]]), rate = cohortRate(value, denominator);
      h += '<div><strong>' + number(value) + '</strong><span>' + escape(stage[1]) + '</span><small>' + (rate == null ? 'لا توجد نسبة قابلة للمقارنة' : rate.toLocaleString('ar-OM') + '% من الطلبات المرتبطة') + '</small>' + (rate == null ? '' : '<meter min="0" max="100" value="' + rate + '" aria-label="' + escape(stage[1]) + '">' + rate + '%</meter>') + '</div>';
    });
    return h + '</div>';
  }

  function mediaHtml(media) {
    if (!media.length) return '<div class="cf-note">لا توجد روابط منشورات لهذا العقار. أضف رابط كل Reel أو منشور لعرض قياساته وتسهيل التعرف على العقار من رسالة العميل.</div>';
    var h = '<details class="cf-media" open><summary>المنشورات المرتبطة (' + number(media.length) + ')</summary><div class="cf-table-wrap"><table class="tbl"><thead><tr><th>المنشور</th><th>المشاهدات</th><th>الوصول</th><th>التفاعلات</th><th>القياسات</th><th>آخر تحديث</th></tr></thead><tbody>';
    media.forEach(function (item, index) {
      var url = instagramUrl(item.url);
      var state = item.sync_status === 'synced' ? 'متزامن' : item.sync_status === 'error' ? 'تعذر التحديث' : item.sync_status === 'manual' ? 'قياسات يدوية / لم تتزامن' : 'بانتظار المزامنة';
      h += '<tr><td>' + (url ? '<a href="' + escape(url) + '" target="_blank" rel="noopener noreferrer">منشور ' + number(index + 1) + ' ↗</a>' : 'الرابط غير صالح') + '</td><td>' + number(item.views) + '</td><td>' + number(item.reach) + '</td><td>' + number(item.total_interactions) + '</td><td>' + escape(state) + '</td><td>' + escape(stamp(item.last_synced_at)) + '</td></tr>';
    });
    return h + '</tbody></table></div></details>';
  }

  function propertyHtml(property, data) {
    var summary = summarizeMedia(property.media || []), id = property.property_id;
    var h = '<div class="card cf-funnel"><div class="card-head"><div><h3>من المنشور إلى الاستفسار والصفقة</h3><p class="cf-footnote">' + escape(property.title || 'العقار') + ' · بيانات تراكمية منذ بدء التسجيل</p></div><div class="cf-actions">' + button('property', 'تحديث العرض', id);
    if (canWrite()) h += button('links', 'إضافة روابط منشورات', id) + button('sync', 'تحديث القياسات من Meta', id);
    h += button('wa-link', 'نسخ رابط واتساب للعقار', id) + (Number(data.unresolved_total) > 0 ? button('review', 'مراجعة صور وروابط غير مرتبطة', id) : '') + '</div></div><div class="card-body"><div class="cf-metrics">' + metric('منشورات مختلفة', summary.media_count) + metric('مجموع المشاهدات', summary.views) + metric('مجموع وصول المنشورات', summary.reach_non_unique, 'غير فريد بين المنشورات') + metric('مجموع التفاعلات', summary.interactions) + '</div>';
    h += '<p class="cf-footnote">آخر تحديث: ' + escape(stamp(property.latest_synced_at)) + ' · قياسات المشاهدات متاحة لـ ' + number(summary.known.views) + ' من ' + number(summary.media_count) + ' منشورات. لا يمكن التعرف على هوية المشاهد أو ربط كل مشاهدة بعميل.</p>';
    h += '<h4>الاستفسارات والطلبات المسجلة</h4><div class="cf-metrics">' + metric('مستفسرو العقار — كل المصادر', property.attributed_clients) + metric('منهم بدليل إنستغرام', property.instagram_attributed_clients) + metric('منهم عبر واتساب', property.whatsapp_attributed_clients) + metric('طلبات مرتبطة بالعقار', property.attributed_requests) + '</div>';
    h += '<div class="cf-mini-metrics">' + metric('طلبات بدليل إنستغرام', property.instagram_attributed_requests) + metric('طلبات عبر واتساب', property.whatsapp_attributed_requests) + metric('زيارات مسجلة', property.booked_visits) + metric('زيارات مكتملة', property.completed_visits) + metric('صفقات مغلقة', property.closed_deals) + '</div>';
    h += '<p class="cf-footnote">استفسارات بلا طلب مرتبط: ' + number(property.legacy_inquiries_without_request) + ' — تظهر ضمن استفسارات العقار ولا تدخل في نسب الطلبات حتى ربطها. الزيارات المسجلة تستبعد الإلغاء وعدم الحضور.</p>';
    h += '<div class="cf-note">' + escape(data.attribution_note || 'تثبت النسبة إلى إنستغرام عند وجود رابط أو دليل مسجل. مجرد ذكر المنطقة أو السعر لا يثبت مصدر العميل. أعداد واتساب وإنستغرام قد تتداخل ولا تُجمع.') + ' لا نحسب تحويل المشاهدات إلى عملاء؛ المشاهدات ليست مجموعة أشخاص يمكن مطابقتها مع CRM.</div>';
    h += cohortHtml(property) + mediaHtml(summary.media) + '</div></div>';
    return h;
  }

  async function loadProperty(propertyId) {
    var mount = document.getElementById('pdAcquisitionFunnel');
    if (!mount || mount.dataset.propertyId !== propertyId) return;
    var scope = ensureScope(), version = (propertyVersions.get(propertyId) || 0) + 1;
    propertyVersions.set(propertyId, version);
    mount.innerHTML = loadingHtml();
    try {
      var data = await fetchFunnel(propertyId);
      if (scope !== getScope() || propertyVersions.get(propertyId) !== version || mount.dataset.propertyId !== propertyId || !mount.isConnected) return;
      var property = data.properties.find(function (p) { return p.property_id === propertyId; });
      if (!property) throw new Error('العقار غير متاح لحسابك أو لم يعد موجودًا');
      propertyData.set(propertyId, property);
      if (Array.isArray(data.whatsapp_routes)) routes = data.whatsapp_routes;
      mount.innerHTML = propertyHtml(property, data);
    } catch (error) {
      if (scope === getScope() && propertyVersions.get(propertyId) === version && mount.dataset.propertyId === propertyId && mount.isConnected) mount.innerHTML = errorHtml(message(error), 'property', propertyId);
    }
  }

  async function refreshProperty(propertyId) {
    await loadProperty(propertyId);
    var page = document.getElementById('page-instagram');
    if (page && page.classList.contains('active')) await loadOverview();
  }

  function cleanLegacyInsights(container) {
    var firstCard = container.firstElementChild;
    if (firstCard) Array.from(firstCard.querySelectorAll('div')).forEach(function (item) {
      var label = item.firstElementChild;
      if (label && !label.children.length && /^(📱 مشاهدات Instagram|🎯 وصول Instagram|💬 تفاعلات Instagram)$/.test(label.textContent.trim())) item.remove();
    });
    Array.from(container.children).forEach(function (item) {
      if (!item.classList.contains('card') && item.textContent.includes('Instagram Insights API لم يتم توصيله')) item.remove();
    });
  }

  function installPropertyHook() {
    var original = root.loadPropertyPerformance;
    if (typeof original !== 'function' || original.__funnelWrapped) return;
    var wrapped = async function (propertyId) {
      var result = await original.apply(this, arguments);
      if (!root.viewingProperty || root.viewingProperty.id !== propertyId) return result;
      var container = document.getElementById('pdPerformance');
      if (!container) return result;
      cleanLegacyInsights(container);
      var mount = document.getElementById('pdAcquisitionFunnel');
      if (!mount || !container.contains(mount)) { mount = document.createElement('section'); mount.id = 'pdAcquisitionFunnel'; container.prepend(mount); }
      mount.dataset.propertyId = propertyId;
      await loadProperty(propertyId);
      return result;
    };
    wrapped.__funnelWrapped = true;
    root.loadPropertyPerformance = wrapped;
  }

  function createDialog() {
    if (dialog) return dialog;
    dialog = document.createElement('dialog'); dialog.id = 'cfDialog'; dialog.className = 'cf-dialog'; dialog.setAttribute('dir', 'rtl');
    document.body.appendChild(dialog);
    dialog.addEventListener('close', function () { dialogProperty = null; if (pendingFocus && pendingFocus.isConnected) pendingFocus.focus(); });
    dialog.addEventListener('click', function (event) { if (event.target === dialog) dialog.close(); });
    return dialog;
  }

  async function openReview(propertyId) {
    ensureScope(); reviewPage = 0; reviewPropertyId = propertyId || null;
    pendingFocus = document.activeElement;
    var box = createDialog(); dialogProperty = null;
    box.innerHTML = '<div class="cf-dialog-head"><h3>صور وروابط تحتاج تحديد العقار</h3>' + button('close', 'إغلاق') + '</div><p class="cf-footnote">هذه عناصر لم تُنسب لعقار تلقائيًا. افتح المحادثة لمراجعة الصورة أو النص، ثم اختر العقار المؤكد. لا تستخدم تشابه السعر أو المنطقة وحده للحسم.</p><div id="cfReviewList"></div>';
    if (!box.open) box.showModal();
    await loadReview();
  }

  async function loadReview() {
    var mount = document.getElementById('cfReviewList');
    if (!mount) return;
    var scope = getScope(), version = ++reviewVersion;
    mount.innerHTML = loadingHtml();
    try {
      var results = await Promise.all([
        supa.from('unmatched_property_links').select('id,raw_url,provider,link_key,created_at,conversation_id,property_id', { count: 'exact' }).eq('company_id', currentProfile.company_id).eq('status', 'pending').order('created_at', { ascending: false }).order('id', { ascending: true }).range(reviewPage * 20, reviewPage * 20 + 19),
        fetchFunnel(null)
      ]);
      if (scope !== getScope() || version !== reviewVersion || !mount.isConnected) return;
      if (results[0].error) throw results[0].error;
      reviewRows = results[0].data || [];
      var total = results[0].count, properties = results[1].properties;
      if (!reviewRows.length) { mount.innerHTML = '<div class="empty">لا توجد عناصر معلقة في هذه الصفحة.</div>' + (reviewPage ? button('review-previous', 'السابق') : ''); return; }
      var h = '';
      reviewRows.forEach(function (row) {
        var kind = String(row.link_key || '').startsWith('image:') ? 'صورة تحتاج مراجعة' : row.provider === 'instagram' ? 'رابط إنستغرام غير مرتبط' : 'مرجع عقار يحتاج مراجعة';
        h += '<article class="cf-review-row"><strong>' + escape(kind) + '</strong><p class="cf-review-evidence" dir="auto">' + escape(row.raw_url || row.link_key || 'لا يوجد نص إضافي') + '</p><small>' + escape(stamp(row.created_at)) + '</small><div class="cf-actions">';
        if (row.conversation_id) h += '<button class="btn-secondary" data-funnel-action="review-conversation" data-review-id="' + escape(row.id) + '">فتح المحادثة لمراجعة الدليل</button>';
        h += '</div>';
        if (canWrite()) h += '<label class="fl" for="cfReviewProperty-' + escape(row.id) + '">العقار الصحيح بعد مراجعة الرسالة</label><select class="fs" id="cfReviewProperty-' + escape(row.id) + '"><option value="">اختر العقار</option>' + properties.map(function (p) { return '<option value="' + escape(p.property_id) + '"' + (p.property_id === reviewPropertyId ? ' selected' : '') + '>' + escape(p.title || p.property_code || 'عقار') + (p.property_code ? ' · ' + escape(p.property_code) : '') + '</option>'; }).join('') + '</select><button class="btn-secondary" data-funnel-action="resolve-review" data-review-id="' + escape(row.id) + '" style="margin-top:10px">ربط الرسالة بالعقار المحدد</button>';
        h += '<div class="cf-review-error" id="cfReviewError-' + escape(row.id) + '" role="alert"></div></article>';
      });
      h += '<div class="cf-pagination"><span>' + number(total) + ' عنصر معلق</span>' + button('review-previous', 'السابق', null, reviewPage === 0 ? ' disabled' : '') + button('review-next', 'التالي', null, total != null && (reviewPage + 1) * 20 >= total ? ' disabled' : '') + '</div>';
      mount.innerHTML = h;
    } catch (error) { if (scope === getScope() && version === reviewVersion && mount.isConnected) mount.innerHTML = errorHtml(message(error), 'review-retry'); }
  }

  async function resolveReview(id, element) {
    var select = document.getElementById('cfReviewProperty-' + id), errors = document.getElementById('cfReviewError-' + id);
    var propertyId = select && select.value;
    if (!propertyId) { if (errors) errors.textContent = 'اختر العقار الذي تأكدت أنه المقصود أولًا'; return; }
    if (busy.has('review:' + id)) return;
    var scope = getScope(); busy.add('review:' + id); element.disabled = true;
    try {
      var result = await supa.rpc('resolve_unmatched_property_link', { p_unmatched_id: id, p_property_id: propertyId });
      if (result.error) throw result.error;
      if (!result.data || result.data.ok !== true) throw new Error('تعذر تأكيد حفظ الربط؛ حدّث القائمة قبل المحاولة مجددًا');
      if (scope !== getScope()) return;
      toast('تم ربط الدليل بالعقار وتحديث الاستفسار', 'success');
      propertyData.delete(propertyId);
      await loadReview(); await refreshProperty(propertyId);
    } catch (error) { if (scope === getScope() && errors && errors.isConnected) errors.textContent = message(error); }
    finally { busy.delete('review:' + id); if (element.isConnected) element.disabled = false; }
  }

  async function getProperty(propertyId) {
    ensureScope();
    if (propertyData.has(propertyId)) return propertyData.get(propertyId);
    var scope = getScope(), data = await fetchFunnel(propertyId);
    if (scope !== getScope()) throw new Error('تغيرت جلسة المستخدم؛ أعد فتح العقار');
    var property = data.properties.find(function (p) { return p.property_id === propertyId; });
    if (!property) throw new Error('العقار غير متاح لحسابك');
    if (Array.isArray(data.whatsapp_routes)) routes = data.whatsapp_routes;
    propertyData.set(propertyId, property);
    return property;
  }

  async function openLinks(propertyId) {
    if (!canWrite()) { toast('لا تملك صلاحية إضافة روابط للعقار', 'error'); return; }
    var property = await getProperty(propertyId), box = createDialog();
    pendingFocus = document.activeElement; dialogProperty = property;
    box.innerHTML = '<div class="cf-dialog-head"><h3>روابط منشورات العقار</h3>' + button('close', 'إغلاق') + '</div><p>' + escape(property.title || 'العقار') + '</p><label class="fl" for="cfLinksInput">رابط Reel أو منشور Instagram في كل سطر</label><textarea id="cfLinksInput" class="fta" rows="6" dir="ltr" placeholder="https://www.instagram.com/reel/…/"></textarea><div id="cfLinksPreview" class="cf-footnote" aria-live="polite"></div><div id="cfDialogError" role="alert"></div><div class="cf-note">تُحفظ الروابط على هذا العقار مع تجاهل الرابط المكرر. تحديث القياسات خطوة مستقلة ولا يرسل رسائل للعملاء.</div>' + button('save-links', 'حفظ الروابط', propertyId);
    box.querySelector('#cfLinksInput').addEventListener('input', previewLinks);
    previewLinks(); box.showModal(); box.querySelector('#cfLinksInput').focus();
  }

  function previewLinks() {
    var input = document.getElementById('cfLinksInput'), preview = document.getElementById('cfLinksPreview');
    if (!input || !preview) return;
    var parsed = parseLinks(input.value);
    preview.textContent = parsed.links.length + ' روابط مختلفة صالحة' + (parsed.duplicate_count ? ' · تم تجاهل ' + parsed.duplicate_count + ' تكرار' : '') + (parsed.invalid_lines.length ? ' · راجع الأسطر: ' + parsed.invalid_lines.join('، ') : '');
  }

  async function saveLinks(propertyId, element) {
    if (busy.has('links:' + propertyId) || !dialogProperty || dialogProperty.property_id !== propertyId) return;
    var input = document.getElementById('cfLinksInput'), errors = document.getElementById('cfDialogError');
    var parsed = parseLinks(input && input.value);
    if (!parsed.links.length || parsed.invalid_lines.length || parsed.links.length > 50) { errors.textContent = 'أضف من 1 إلى 50 رابطًا صالحًا، وصحح الأسطر غير الصالحة قبل الحفظ'; return; }
    var scope = getScope(); busy.add('links:' + propertyId); element.disabled = true; errors.textContent = '';
    try {
      var result = await supa.rpc('crm_add_property_marketing_links', { p_property_id: propertyId, p_urls: parsed.links });
      if (result.error) throw result.error;
      var data = result.data;
      if (!data || data.ok === false || count(data.inserted_count) == null || count(data.existing_count) == null) throw new Error('تعذر تأكيد نتيجة الحفظ؛ حدّث العرض قبل تكرار المحاولة');
      if (scope !== getScope()) return;
      toast('تم حفظ ' + data.inserted_count + ' رابط جديد · ' + data.existing_count + ' موجود مسبقًا', 'success');
      if (dialogProperty && dialogProperty.property_id === propertyId) dialog.close();
      await refreshProperty(propertyId);
    } catch (error) { if (scope === getScope() && errors.isConnected) errors.textContent = message(error); }
    finally { busy.delete('links:' + propertyId); if (element.isConnected) element.disabled = false; }
  }

  async function openWhatsAppLink(propertyId) {
    var property = await getProperty(propertyId), box = createDialog();
    var routeWarning = '', scope = getScope();
    if (!routesLoaded) {
      try {
        var result = await supa.rpc('crm_public_business_routes', {});
        if (result.error) throw result.error;
        if (!Array.isArray(result.data)) throw new Error('تعذر التحقق من أرقام المكتب');
        if (scope !== getScope()) return;
        routes = result.data; routesLoaded = true;
      } catch (_) { routeWarning = 'تعذر تحميل أرقام المكتب المحفوظة؛ يمكنك إدخال رقم المكتب يدويًا.'; }
    }
    if (scope !== getScope()) return;
    pendingFocus = document.activeElement; dialogProperty = property;
    var media = uniqueMedia(property.media || []).filter(function (m) { return !!instagramUrl(m.url); });
    var allowedRoutes = routes.filter(function (route) { return !!route.whatsapp_number; });
    var h = '<div class="cf-dialog-head"><h3>رابط واتساب خاص بالعقار</h3>' + button('close', 'إغلاق') + '</div><p>' + escape(property.title || 'العقار') + '</p>';
    if (allowedRoutes.length) h += '<label class="fl" for="cfRoute">رقم المكتب</label><select class="fs" id="cfRoute"><option value="">اختر الرقم المناسب</option>' + allowedRoutes.map(function (route, index) { return '<option value="' + index + '">' + escape(route.label || route.route_key) + ' · ' + escape(route.whatsapp_number) + '</option>'; }).join('') + '</select>';
    h += '<label class="fl" for="cfBusinessPhone">رقم واتساب المكتب مع رمز الدولة</label><input class="fi" id="cfBusinessPhone" type="tel" dir="ltr" placeholder="+968…" autocomplete="off">';
    if (routeWarning) h += '<p class="cf-footnote">' + escape(routeWarning) + '</p>';
    if (media.length) h += '<label class="fl" for="cfSourceMedia">المنشور الذي سيرتبط بالرسالة</label><select class="fs" id="cfSourceMedia">' + media.map(function (m, i) { return '<option value="' + escape(instagramUrl(m.url)) + '">منشور ' + (i + 1) + ' · ' + escape(instagramUrl(m.url).split('/')[4]) + '</option>'; }).join('') + '</select>';
    h += '<div class="cf-note">انسخ الرابط وضعه مع الإعلان. لا تُرسل أي رسالة عند إنشاء الرابط أو نسخه؛ تُسجل نسبة الاستفسار للعقار بعد أن يرسل العميل الرسالة ويتعرف النظام على الرابط أو الرمز. النقر وحده غير مقاس.' + (media.length ? '' : ' لا يوجد منشور مربوط، لذلك يستخدم رمز العقار للتعرف عليه دون افتراض أن مصدره إنستغرام.') + '</div><div id="cfDialogError" role="alert"></div>' + button('build-wa', 'إنشاء الرابط', propertyId) + '<div id="cfWaResult"></div>';
    box.innerHTML = h;
    var routeSelect = box.querySelector('#cfRoute');
    if (routeSelect) routeSelect.addEventListener('change', function () { box.querySelector('#cfBusinessPhone').value = routeSelect.value === '' ? '' : allowedRoutes[Number(routeSelect.value)].whatsapp_number; box.querySelector('#cfWaResult').replaceChildren(); });
    ['#cfBusinessPhone', '#cfSourceMedia'].forEach(function (selector) { var item = box.querySelector(selector); if (item) item.addEventListener('input', function () { box.querySelector('#cfWaResult').replaceChildren(); }); });
    box.showModal(); (routeSelect || box.querySelector('#cfBusinessPhone')).focus();
  }

  function buildWhatsAppLink() {
    var errors = document.getElementById('cfDialogError'), target = document.getElementById('cfWaResult');
    if (!dialogProperty || !target) return;
    try {
      var url = whatsappLink(dialogProperty, document.getElementById('cfBusinessPhone').value, (document.getElementById('cfSourceMedia') || {}).value);
      errors.textContent = '';
      target.innerHTML = '<label class="fl" for="cfWaUrl">الرابط الجاهز للنسخ</label><textarea id="cfWaUrl" class="fta" rows="3" readonly dir="ltr">' + escape(url) + '</textarea>' + button('copy-wa', 'نسخ الرابط');
    } catch (error) { errors.textContent = error.message; target.replaceChildren(); }
  }

  async function handleAction(event) {
    var element = event.target.closest('[data-funnel-action]');
    if (!element || element.disabled) return;
    var action = element.dataset.funnelAction, id = element.dataset.propertyId;
    try {
      if (action === 'overview') return loadOverview();
      if (action === 'property') return loadProperty(id);
      if (action === 'previous') { overviewPage--; return renderOverviewRows(); }
      if (action === 'next') { overviewPage++; return renderOverviewRows(); }
      if (action === 'open-property') { if (typeof viewProperty === 'function') return viewProperty(id); }
      if (action === 'links') return await openLinks(id);
      if (action === 'review') return await openReview(id);
      if (action === 'review-retry') return await loadReview();
      if (action === 'review-next') { reviewPage++; return await loadReview(); }
      if (action === 'review-previous') { reviewPage = Math.max(0, reviewPage - 1); return await loadReview(); }
      if (action === 'resolve-review') return await resolveReview(element.dataset.reviewId, element);
      if (action === 'review-conversation') {
        var row = reviewRows.find(function (item) { return item.id === element.dataset.reviewId; });
        if (row && row.conversation_id && typeof openWhatsAppConversation === 'function') {
          dialog.close();
          if (typeof navigate === 'function') navigate('whatsapp', document.querySelector('.nav-link[onclick*="whatsapp"]'));
          return await openWhatsAppConversation(row.conversation_id);
        }
        throw new Error('المحادثة غير متاحة؛ افتح سجل العميل لمراجعة الرسالة');
      }
      if (action === 'save-links') return await saveLinks(id, element);
      if (action === 'wa-link') return await openWhatsAppLink(id);
      if (action === 'build-wa') return buildWhatsAppLink();
      if (action === 'close') { if (dialog) dialog.close(); return; }
      if (action === 'copy-wa') {
        var text = document.getElementById('cfWaUrl');
        if (!text) return;
        try { await navigator.clipboard.writeText(text.value); toast('تم نسخ رابط العقار', 'success'); }
        catch (_) { text.focus(); text.select(); toast('حددنا الرابط؛ انسخه يدويًا لأن المتصفح لم يسمح بالنسخ', 'info'); }
        return;
      }
      if (action === 'sync') {
        if (typeof root.syncInstagramProperty !== 'function') throw new Error('مزامنة Instagram غير متاحة في هذه النسخة');
        element.disabled = true;
        try { await root.syncInstagramProperty(id); } finally { if (element.isConnected) element.disabled = false; }
      }
    } catch (error) { toast(error.message || 'تعذر تنفيذ الإجراء', 'error'); }
  }

  function installStyles() {
    if (document.getElementById('crmFunnelStyles')) return;
    var style = document.createElement('style'); style.id = 'crmFunnelStyles';
    style.textContent = '.cf-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:12px 0}.cf-metric{border:1px solid var(--cream-deeper);border-radius:12px;background:#fff;padding:14px;display:flex;flex-direction:column;gap:5px;min-width:0}.cf-metric strong{font-size:23px;color:var(--espresso);overflow-wrap:anywhere}.cf-metric span{font-size:12px;color:var(--umber)}.cf-metric small,.cf-footnote{font-size:11px;color:var(--umber);line-height:1.8}.cf-footnote{margin:7px 0 12px}.cf-note{padding:12px 14px;background:#f4f7f6;border:1px solid #d6e3df;border-radius:10px;font-size:12px;line-height:1.9;margin:10px 0}.cf-error{padding:18px;background:#fff4f3;border:1px solid #ebc9c5;border-radius:10px}.cf-error p{margin:8px 0;overflow-wrap:anywhere}.cf-property-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,310px),1fr));gap:14px;margin-top:14px}.cf-property{background:white;border:1px solid var(--cream-deeper);border-radius:14px;padding:16px}.cf-property h3,.cf-funnel h3{font-size:16px;margin:0}.cf-property small{font-size:11px;color:var(--umber)}.cf-mini-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin:12px 0}.cf-mini-metrics .cf-metric{padding:10px}.cf-mini-metrics strong{font-size:20px}.cf-actions,.cf-pagination{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.cf-pagination{margin:16px 0;justify-content:center;font-size:12px}.cf-funnel{margin-bottom:16px;border-color:#bacfc7}.cf-funnel h4{font-size:14px;margin-top:20px}.cf-cohort{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:20px}.cf-cohort>div{display:flex;flex-direction:column;gap:7px;background:#f7f5ef;border-radius:10px;padding:12px}.cf-cohort strong{font-size:23px}.cf-cohort span{font-size:12px}.cf-cohort small{font-size:10px;color:var(--umber)}.cf-cohort meter{width:100%;height:12px;accent-color:var(--emerald)}.cf-media summary{font-size:13px;font-weight:700;cursor:pointer;padding:10px 0}.cf-table-wrap{overflow:auto}.cf-table-wrap td,.cf-table-wrap th{white-space:nowrap}.cf-dialog{border:1px solid var(--cream-deeper);border-radius:16px;padding:22px;width:min(580px,92vw);max-height:88vh;overflow:auto;margin:auto;background:white;color:var(--espresso);font-family:inherit}.cf-dialog::backdrop{background:rgba(42,33,24,.6)}.cf-dialog-head{display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:10px}.cf-dialog h3{font-size:17px}.cf-dialog .fl{margin-top:14px}.cf-dialog p{font-size:13px;line-height:1.8}.cf-dialog [role=alert]{color:var(--ruby);font-size:12px;margin:10px 0}.cf-dialog textarea{resize:vertical}.cf-dialog #cfWaResult{margin-top:15px}.cf-dialog #cfWaResult button{margin-top:8px}#igInboxPanel[hidden],#igPerformancePanel[hidden]{display:none!important}@media(max-width:700px){.cf-metrics,.cf-cohort{grid-template-columns:repeat(2,minmax(0,1fr))}.cf-funnel .card-body{padding:12px}.cf-funnel .card-head{padding:14px}.cf-actions .btn-secondary{padding:9px 11px;font-size:11px}.cf-dialog{padding:17px;width:94vw}}';
    style.textContent += '.cf-review-row{border:1px solid var(--cream-deeper);border-radius:12px;padding:14px;margin:12px 0}.cf-review-row>small{display:block;font-size:11px;color:var(--umber);margin-bottom:10px}.cf-review-evidence{overflow-wrap:anywhere;white-space:pre-wrap;max-height:150px;overflow:auto;background:#f7f7f5;padding:9px;border-radius:8px}.cf-review-error{color:var(--ruby);font-size:12px;margin-top:8px}';
    document.head.appendChild(style);
  }

  function activate() {
    installStyles(); installPropertyHook();
    document.addEventListener('click', handleAction);
    // Keep the existing marketing form accurate now that Insights is connected.
    var oldHint = root.updatePropertyMarketingHint;
    root.updatePropertyMarketingHint = function () {
      if (typeof oldHint === 'function') oldHint.apply(this, arguments);
      var hint = document.getElementById('pmAutoHint'), channel = document.getElementById('pmChannel');
      if (hint && channel && channel.value === 'instagram') hint.textContent = 'احفظ رابط المنشور لربطه بالعقار. حدّث قياساته من قسم أداء العقار؛ المزامنة تتطلب صلاحيات الحساب وأن يكون المنشور تابعًا للحساب المربوط. عدم توفر القياس لا يعني صفر مشاهدة.';
    };
    if (typeof supa !== 'undefined' && supa.auth) supa.auth.onAuthStateChange(function (event) { if (event === 'SIGNED_OUT') { scopeKey = null; reset(); } });
  }

  api.loadOverview = loadOverview; api.loadProperty = loadProperty; api.refreshProperty = refreshProperty; api.reset = reset;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', activate);
  else activate();
})(typeof window !== 'undefined' ? window : globalThis);
