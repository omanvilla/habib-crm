(function (value) { return value.toString(16).padStart(2, '0'); }).join('');
    sessionStorage.setItem('instagram_oauth_state', state);
    var redirect = 'https://omanvilla.github.io/habib-crm/';
    var scope = 'pages_show_list,pages_read_engagement,instagram_basic,instagram_manage_insights';
    var url = 'https://www.facebook.com/v25.0/dialog/oauth?client_id=1639659247753419&redirect_uri=' + encodeURIComponent(redirect) + '&response_type=token&auth_type=rerequest&return_scopes=true&scope=' + encodeURIComponent(scope) + '&state=' + encodeURIComponent(state);
    showToast('🔗 جاري فتح موافقة Meta لربط @omanvilla', 'info');
    location.assign(url);
(function () {
  'use strict';

  var igConversations = [];
  var igActiveConversation = null;
  var igRefreshTimer = null;
  var igConnecting = false;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char];
    });
  }

  function time(value) {
    if (!value) return '';
    try { return new Date(value).toLocaleString('ar-OM', { dateStyle: 'short', timeStyle: 'short' }); }
    catch (_) { return String(value); }
  }

  async function invoke(body) {
    var result = await supa.functions.invoke('instagram-api', { body: body });
    if (result.error) throw result.error;
    if (!result.data || result.data.ok === false) throw new Error((result.data && (result.data.message || result.data.error)) || 'فشل طلب Instagram');
    return result.data;
  }

  function installStyles() {
    if (document.getElementById('igCrmStyles')) return;
    var style = document.createElement('style');
    style.id = 'igCrmStyles';
    style.textContent = '.ig-layout{display:grid;grid-template-columns:320px 1fr;min-height:590px;border:1px solid var(--cream-deeper);border-radius:14px;overflow:hidden;background:white}.ig-list{border-left:1px solid var(--cream-deeper);background:#fff}.ig-list-head{padding:13px;border-bottom:1px solid var(--cream-deeper)}.ig-conv{padding:12px 13px;border-bottom:1px solid #f1ece4;cursor:pointer}.ig-conv:hover,.ig-conv.active{background:#fdf4fb}.ig-conv-top{display:flex;align-items:center;gap:8px}.ig-avatar{width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#833ab4,#fd1d1d,#fcb045);color:#fff;display:grid;place-items:center;font-weight:800;overflow:hidden}.ig-avatar img{width:100%;height:100%;object-fit:cover}.ig-name{font-weight:800;color:var(--espresso);flex:1}.ig-unread{background:#d62976;color:#fff;border-radius:999px;min-width:20px;padding:2px 6px;text-align:center;font-size:10px}.ig-preview{font-size:11px;color:var(--umber);margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ig-chat{display:flex;flex-direction:column;min-width:0}.ig-chat-head{padding:14px 16px;border-bottom:1px solid var(--cream-deeper);font-weight:800}.ig-messages{flex:1;padding:18px;overflow:auto;max-height:480px;background:#fffafd}.ig-bubble{max-width:76%;padding:9px 12px;border-radius:14px;margin-bottom:8px;line-height:1.55;font-size:13px;white-space:pre-wrap}.ig-bubble.in{background:#f0edf4;margin-left:auto}.ig-bubble.out{background:#d62976;color:#fff;margin-right:auto}.ig-bubble small{display:block;opacity:.72;font-size:9px;margin-top:4px}.ig-compose{display:flex;gap:8px;padding:12px;border-top:1px solid var(--cream-deeper)}.ig-compose textarea{flex:1}.ig-status{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:14px;border-radius:12px;background:linear-gradient(135deg,#fff7fb,#fff6ed);border:1px solid #f0d7e4}.ig-account-pic{width:54px;height:54px;border-radius:50%;object-fit:cover;background:#eee}@media(max-width:800px){.ig-layout{grid-template-columns:1fr}.ig-list{border-left:0;border-bottom:1px solid var(--cream-deeper)}.ig-messages{max-height:400px}}';
    document.head.appendChild(style);
  }

  function installUi() {
    if (document.getElementById('page-instagram')) return;
    installStyles();
    var settingsNav = Array.from(document.querySelectorAll('.nav-link')).find(function (el) { return String(el.getAttribute('onclick') || '').indexOf("'settings'") >= 0; });
    if (settingsNav) {
      var nav = document.createElement('div');
      nav.className = 'nav-link';
      nav.setAttribute('onclick', "navigate('instagram',this)");
      nav.innerHTML = '<div class="nav-icon">📷</div><span class="nav-text">إنستغرام</span><span class="nav-badge" id="navInstagramCount" style="display:none">0</span>';
      settingsNav.parentNode.insertBefore(nav, settingsNav);
    }

    var settingsPage = document.getElementById('page-settings');
    var page = document.createElement('div');
    page.className = 'page';
    page.id = 'page-instagram';
    page.innerHTML = '<div class="page-header"><div><div class="page-title">صندوق <span>إنستغرام</span></div><div class="page-sub">رسائل حساب @omanvilla والعملاء الجدد في مكان واحد</div></div><button class="btn-secondary" onclick="loadInstagramInbox(true)">🔄 تحديث</button></div><div id="igInboxStatus" style="margin-bottom:12px"></div><div class="ig-layout"><div class="ig-list"><div class="ig-list-head"><input class="fi" id="igSearch" placeholder="🔍 ابحث في المحادثات..." oninput="renderInstagramConversations()"></div><div id="igConversationList"><div class="empty" style="padding:30px">جارٍ التحميل...</div></div></div><div class="ig-chat"><div class="ig-chat-head" id="igChatHead">اختر محادثة</div><div class="ig-messages" id="igMessages"><div class="empty" style="padding:60px">📷 اختر محادثة من القائمة</div></div><div class="ig-compose" id="igCompose" style="display:none"><textarea class="fta" id="igReply" rows="2" placeholder="اكتب ردك على Instagram..." onkeydown="if(event.key===\'Enter\'&&!event.shiftKey){event.preventDefault();sendInstagramMessage()}"></textarea><button class="btn-primary" id="igSendBtn" onclick="sendInstagramMessage()" style="width:auto;padding:9px 18px">إرسال</button></div></div></div>';
    if (settingsPage && settingsPage.parentNode) settingsPage.parentNode.insertBefore(page, settingsPage);

    var card = document.createElement('div');
    card.className = 'card';
    card.id = 'instagramSettingsCard';
    card.style.cssText = 'margin-top:18px;display:none';
    card.innerHTML = '<div class="card-head"><div class="card-title">📷 ربط Instagram بالـCRM</div></div><div class="card-body"><div id="instagramConnectionStatus"><div class="empty" style="padding:18px">جارٍ فحص الاتصال...</div></div></div>';
    if (settingsPage) settingsPage.appendChild(card);
  }

  async function loadStatus() {
    var box = document.getElementById('instagramConnectionStatus');
    var inboxStatus = document.getElementById('igInboxStatus');
    if (!box && !inboxStatus) return null;
    try {
      var data = await invoke({ action: 'status' });
      if (!data.connected) {
        var disconnected = '<div class="ig-status"><div class="ig-avatar">IG</div><div style="flex:1"><div style="font-weight:800;color:var(--espresso)">حساب Instagram غير مربوط</div><div style="font-size:11px;color:var(--umber);margin-top:4px">اربط @omanvilla لاستقبال الرسائل ومزامنة أداء المنشورات.</div></div>' + (typeof isOwner === 'function' && isOwner() ? '<button class="btn-primary" onclick="connectInstagram()" style="width:auto;padding:9px 18px">🔗 ربط @omanvilla</button>' : '') + '</div>';
        if (box) box.innerHTML = disconnected;
        if (inboxStatus) inboxStatus.innerHTML = disconnected;
        return data;
      }
      var account = data.account || {};
      var image = account.profile_picture_url ? '<img class="ig-account-pic" src="' + esc(account.profile_picture_url) + '" alt="Instagram">' : '<div class="ig-avatar" style="width:54px;height:54px">IG</div>';
      var warning = account.webhook_subscribed ? '<span style="color:#16803c;font-weight:800">● الرسائل متصلة</span>' : '<span style="color:#b7791f;font-weight:800">● الحساب متصل — Webhook بانتظار التفعيل</span>';
      var connected = '<div class="ig-status">' + image + '<div style="flex:1"><div style="font-weight:900;color:var(--espresso);font-size:15px">@' + esc(account.username || 'omanvilla') + '</div><div style="font-size:11px;color:var(--umber);margin-top:3px">ID: <span dir="ltr">' + esc(account.instagram_user_id) + '</span> · ' + warning + '</div><div style="font-size:10px;color:var(--umber);margin-top:4px">المتابعون: ' + esc(account.followers_count == null ? '—' : account.followers_count) + ' · المنشورات: ' + esc(account.media_count == null ? '—' : account.media_count) + '</div></div><button class="btn-secondary" onclick="connectInstagram()" style="width:auto">تحديث الصلاحيات</button></div>';
      if (box) box.innerHTML = connected;
      if (inboxStatus) inboxStatus.innerHTML = connected;
      return data;
    } catch (error) {
      var message = '<div class="auth-error">⚠️ ' + esc(error.message || error) + '</div>';
      if (box) box.innerHTML = message;
      if (inboxStatus) inboxStatus.innerHTML = message;
      return null;
    }
  }

  async function connectInstagram() {
    if (igConnecting) return;
    if (typeof isOwner === 'function' && !isOwner()) { showToast('⚠️ فقط صاحب الشركة يمكنه ربط Instagram', 'error'); return; }
    igConnecting = true;
    var stateBytes = new Uint8Array(16);
    crypto.getRandomValues(stateBytes);
    var state = Array.from(stateBytes).map(function (value) { return value.toString(16).padStart(2, '0'); }).join('');
    sessionStorage.setItem('instagram_oauth_state', state);
    var redirect = 'https://omanvilla.github.io/habib-crm/';
    var scope = 'pages_show_list,pages_read_engagement,instagram_basic,instagram_manage_insights';
    var url = 'https://www.facebook.com/v25.0/dialog/oauth?client_id=1639659247753419&redirect_uri=' + encodeURIComponent(redirect) + '&response_type=token&auth_type=rerequest&return_scopes=true&scope=' + encodeURIComponent(scope) + '&state=' + encodeURIComponent(state);
    showToast('🔗 جاري فتح موافقة Meta لربط @omanvilla', 'info');
    location.assign(url);
  }

  async function handleInstagramOAuthReturn() {
    var params = new URLSearchParams(location.hash.replace(/^#/, ''));
    var token = params.get('access_token');
    var returnedState = params.get('state');
    if (!token) return false;
    var expectedState = sessionStorage.getItem('instagram_oauth_state');
    history.replaceState(null, '', location.pathname + location.search);
    if (!expectedState || returnedState !== expectedState) {
      sessionStorage.removeItem('instagram_oauth_state');
      showToast('⚠️ تعذّر التحقق من جلسة ربط Meta. حاول مرة أخرى.', 'error');
      return false;
    }
    sessionStorage.removeItem('instagram_oauth_state');
    try {
      showToast('⏳ جاري تثبيت ربط Instagram داخل CRM...', 'info');
      var data = await invoke({ action: 'connect', access_token: token, instagram_user_id: '17841444560608289' });
      showToast(data.webhook_subscribed ? '✅ تم ربط @' + (data.username || 'omanvilla') + ' والرسائل بالـCRM' : '✅ تم ربط الحساب. بقي تفعيل Webhook من لوحة Meta.', 'success');
      var nav = Array.from(document.querySelectorAll('.nav-link')).find(function (item) { return item.textContent.indexOf('إنستغرام') >= 0; });
      if (typeof navigate === 'function' && nav) navigate('instagram', nav);
      await loadStatus();
      await loadInstagramInbox(true);
      return true;
    } catch (error) {
      showToast('⚠️ تعذّر ربط Instagram: ' + (error.message || error), 'error');
      return false;
    } finally { igConnecting = false; }
  }

  async function loadInstagramInbox(force) {
    var list = document.getElementById('igConversationList');
    if (!list) return;
    if (force) list.innerHTML = '<div class="empty" style="padding:30px"><div class="loader-spinner"></div></div>';
    var status = await loadStatus();
    if (!status || !status.connected) { igConversations = []; renderInstagramConversations(); return; }
    try {
      var data = await invoke({ action: 'list' });
      igConversations = data.conversations || [];
      renderInstagramConversations();
      updateBadge(data.unread_total || 0);
    } catch (error) { list.innerHTML = '<div class="auth-error">⚠️ ' + esc(error.message || error) + '</div>'; }
  }

  function renderInstagramConversations() {
    var list = document.getElementById('igConversationList');
    if (!list) return;
    var query = String((document.getElementById('igSearch') || {}).value || '').toLowerCase();
    var rows = igConversations.filter(function (item) { return !query || [item.participant_username, item.participant_name, item.participant_id].join(' ').toLowerCase().indexOf(query) >= 0; });
    if (!rows.length) { list.innerHTML = '<div class="empty" style="padding:42px">📭 لا توجد محادثات Instagram بعد</div>'; return; }
    list.innerHTML = rows.map(function (item) {
      var name = item.participant_name || (item.participant_username ? '@' + item.participant_username : 'Instagram ' + String(item.participant_id || '').slice(-6));
      var avatar = item.participant_profile_picture_url ? '<img src="' + esc(item.participant_profile_picture_url) + '" alt="">' : esc(name.slice(0, 1));
      return '<div class="ig-conv ' + (igActiveConversation && igActiveConversation.id === item.id ? 'active' : '') + '" onclick="openInstagramConversation(\'' + esc(item.id) + '\')"><div class="ig-conv-top"><div class="ig-avatar">' + avatar + '</div><div class="ig-name">' + esc(name) + '</div>' + (item.unread_count ? '<span class="ig-unread">' + esc(item.unread_count) + '</span>' : '') + '</div><div class="ig-preview">' + esc(time(item.last_message_at)) + '</div></div>';
    }).join('');
  }

  async function openInstagramConversation(id) {
    try {
      var data = await invoke({ action: 'conversation', conversation_id: id });
      igActiveConversation = data.conversation;
      var local = igConversations.find(function (item) { return item.id === id; });
      if (local) local.unread_count = 0;
      renderInstagramConversations();
      var name = igActiveConversation.participant_name || (igActiveConversation.participant_username ? '@' + igActiveConversation.participant_username : 'Instagram ' + String(igActiveConversation.participant_id || '').slice(-6));
      document.getElementById('igChatHead').innerHTML = '📷 ' + esc(name) + (igActiveConversation.client_id ? ' <span class="badge b-em">عميل في CRM</span>' : '');
      document.getElementById('igCompose').style.display = 'flex';
      var messages = document.getElementById('igMessages');
      messages.innerHTML = (data.messages || []).map(function (message) { return '<div class="ig-bubble ' + (message.direction === 'outbound' ? 'out' : 'in') + '">' + esc(message.body || ('[' + message.message_type + ']')) + '<small>' + esc(time(message.message_timestamp)) + '</small></div>'; }).join('') || '<div class="empty">لا توجد رسائل محفوظة</div>';
      messages.scrollTop = messages.scrollHeight;
      updateBadge(igConversations.reduce(function (sum, item) { return sum + Number(item.unread_count || 0); }, 0));
    } catch (error) { showToast('⚠️ ' + (error.message || error), 'error'); }
  }

  async function sendInstagramMessage() {
    if (!igActiveConversation) return;
    var input = document.getElementById('igReply');
    var message = String(input.value || '').trim();
    if (!message) return;
    var button = document.getElementById('igSendBtn');
    button.disabled = true;
    try {
      await invoke({ action: 'send', conversation_id: igActiveConversation.id, body: message });
      input.value = '';
      await openInstagramConversation(igActiveConversation.id);
      await loadInstagramInbox(false);
    } catch (error) { showToast('⚠️ فشل الإرسال: ' + (error.message || error), 'error'); }
    finally { button.disabled = false; }
  }

  async function syncInstagramForCurrentProperty() {
    if (!window.viewingProperty) return;
    try {
      var query = await supa.from('property_marketing_events').select('id,url').eq('company_id', currentProfile.company_id).eq('property_id', window.viewingProperty.id).eq('channel', 'instagram').not('url', 'is', null).order('published_at', { ascending: false });
      if (query.error) throw query.error;
      if (!query.data || !query.data.length) throw new Error('أضف رابط منشور أو Reel للعقار أولاً');
      showToast('⏳ جاري تحليل ' + query.data.length + ' رابط Instagram للعقار...', 'info');
      var result = await invoke({ action: 'sync_property', property_id: window.viewingProperty.id });
      var views = Number((result.totals || {}).views || 0).toLocaleString('ar-OM');
      showToast('✅ تمت مزامنة ' + result.synced_count + ' من ' + result.link_count + ' رابط · إجمالي المشاهدات ' + views, result.failed_count ? 'info' : 'success');
      if (typeof loadPropertyPerformance === 'function') loadPropertyPerformance(window.viewingProperty.id);
      return result;
    } catch (error) { showToast('⚠️ تعذرت مزامنة Instagram: ' + (error.message || error), 'error'); }
  }

  async function maybeSyncInstagramProperty(propertyId, refreshPerformance) {
    if (!propertyId || !currentProfile || !currentProfile.company_id || window.__igAutoSyncing === propertyId) return;
    try {
      var status = await invoke({ action: 'status' });
      if (!status || !status.connected) return;
      var cutoff = Date.now() - 6 * 60 * 60 * 1000;
      var query = await supa.from('property_marketing_events').select('id,url,last_synced_at,sync_status').eq('company_id', currentProfile.company_id).eq('property_id', propertyId).eq('channel', 'instagram').not('url', 'is', null);
      if (query.error || !query.data || !query.data.length) return;
      var needsSync = query.data.some(function (item) { return item.sync_status !== 'synced' || !item.last_synced_at || new Date(item.last_synced_at).getTime() < cutoff; });
      if (!needsSync) return;
      window.__igAutoSyncing = propertyId;
      var result = await invoke({ action: 'sync_property', property_id: propertyId });
      if (result.synced_count && typeof refreshPerformance === 'function') await refreshPerformance(propertyId);
    } catch (_) { /* The existing property view keeps the last stored figures when Meta is unavailable. */ }
    finally { if (window.__igAutoSyncing === propertyId) window.__igAutoSyncing = null; }
  }

  function updateBadge(value) {
    var badge = document.getElementById('navInstagramCount');
    if (!badge) return;
    var count = Number(value || 0);
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.style.display = count ? '' : 'none';
  }

  function activate() {
    installUi();
    window.connectInstagram = connectInstagram;
    window.loadInstagramInbox = loadInstagramInbox;
    window.renderInstagramConversations = renderInstagramConversations;
    window.openInstagramConversation = openInstagramConversation;
    window.sendInstagramMessage = sendInstagramMessage;
    window.syncInstagramForCurrentProperty = syncInstagramForCurrentProperty;
    var originalPerformance = window.loadPropertyPerformance;
    if (typeof originalPerformance === 'function' && !originalPerformance.__instagramWrapped) {
      var performanceWrapped = async function (propertyId) {
        var result = await originalPerformance.apply(this, arguments);
        setTimeout(function () { maybeSyncInstagramProperty(propertyId, originalPerformance); }, 250);
        return result;
      };
      performanceWrapped.__instagramWrapped = true;
      window.loadPropertyPerformance = performanceWrapped;
    }
    var originalNavigate = window.navigate;
    if (typeof originalNavigate === 'function' && !originalNavigate.__instagramWrapped) {
      var wrapped = function (id, element) {
        var result = originalNavigate(id, element);
        if (id === 'instagram') loadInstagramInbox(true);
        if (id === 'settings') { var card = document.getElementById('instagramSettingsCard'); if (card) card.style.display = (typeof isOwner === 'function' && isOwner()) ? '' : 'none'; loadStatus(); }
        return result;
      };
      wrapped.__instagramWrapped = true;
      window.navigate = wrapped;
    }
    clearInterval(igRefreshTimer);
    igRefreshTimer = setInterval(function () { if (document.visibilityState === 'visible' && currentProfile && currentProfile.company_id) loadInstagramInbox(false); }, 45000);
    handleInstagramOAuthReturn();
    setTimeout(loadStatus, 1500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', activate);
  else activate();
})();
