// 11 Nov 2026 (Ahmed): every chat opens two ways (phone WhatsApp, CRM chat); «تم» on a hot alert never comes back for the same kind.
const test=require('node:test');const assert=require('node:assert');const fs=require('fs');const vm=require('vm');
const wa=fs.readFileSync('crm-wa-buttons.js','utf8'),index=fs.readFileSync('index.html','utf8');
test('crmWaButtons gives «فتح في واتساب الجوال» and «فتح في النظام»',()=>{
 const ctx={window:{},navigator:{userAgent:'Windows'},document:{addEventListener(){},querySelector(){return null;}}};vm.createContext(ctx);vm.runInContext(wa,ctx);
 const h=ctx.window.crmWaButtons({phone:'96890000000',conversationId:'c1'});
 assert(h.includes('href="https://wa.me/96890000000"')&&h.includes('فتح في واتساب الجوال')&&h.includes('data-wa-crm="1"')&&h.includes('فتح في النظام'));
 const k=ctx.window.crmWaButtons({clientId:'x'});
 assert(k.includes('data-wa-phone="1"')&&k.includes('data-client="x"'),'no number at hand: looked up on tap');
 assert.equal(ctx.window.crmWaButtons({}),'');
 assert(index.includes('crm-wa-buttons.js?v=20261114-note1"><'+String.fromCharCode(92)+'/script>'),'loaded inside the boot script with an escaped closing tag');
});
// 12 Nov 2026 (Ahmed: «ما جاي مرتب»): one look for the two buttons everywhere, and nothing cut on the narrow deal cards
test('the two buttons carry their own look, not the page button classes',()=>{
 const ctx={window:{},navigator:{userAgent:'Windows'},document:{addEventListener(){},querySelector(){return null;}}};vm.createContext(ctx);vm.runInContext(wa,ctx);
 const css=fs.readFileSync('crm-wa-buttons.css','utf8');
 const h=ctx.window.crmWaButtons({phone:'96890000000',conversationId:'c1',cls:'btn-primary'});
 assert(h.includes('class="crm-wa-btn crm-wa-phone"')&&h.includes('class="crm-wa-btn crm-wa-crm"'));
 assert(!/btn-primary|btn-secondary/.test(h),'the page button classes are dropped');
 assert(ctx.window.crmWaButtons({clientId:'x',cls:'btn-secondary coh-go'}).includes('class="crm-wa-btn coh-go crm-wa-phone"'),'other classes stay');
 const s=ctx.window.crmWaButtons({clientId:'x',cls:'btn-secondary crm-wa-small'});
 assert(s.includes('class="crm-wa-btn crm-wa-sm crm-wa-phone"')&&s.includes('title="فتح في واتساب الجوال"')&&s.includes('>الجوال</button>'),'deal cards: short word, full words as the tooltip');
 assert(s.includes('title="فتح في النظام"')&&s.includes('>النظام</button>'));
 assert(css.includes('.crm-wa-btn{')&&css.includes('white-space:nowrap')&&css.includes('.crm-wa-phone{')&&css.includes('.crm-wa-crm{')&&css.includes('.crm-wa-sm{'));
 assert(css.includes('.crm-wa-deal{flex-wrap:wrap}'),'on a narrow deal card the second button goes under the first, never cut');
 assert(index.includes('<link rel="stylesheet" href="crm-wa-buttons.css?v=20261114-note1">'));
});
// 12 Nov 2026 (Ahmed: «نعم حوّلها»): the old single «واتساب» link in the visits and owners tables is the same pair
test('visits and owners tables: the two buttons; an owner chat is found by the number',()=>{
 const ctx={window:{},navigator:{userAgent:'Windows'},document:{addEventListener(){},querySelector(){return null;}}};vm.createContext(ctx);vm.runInContext(wa,ctx);
 const ui=fs.readFileSync('crm-simple-ui.js','utf8'),css=fs.readFileSync('crm-wa-buttons.css','utf8');
 assert(ui.includes("window.crmWaButtons({phone:phone,clientId:v.client_id,size:'sm'})"),'visits: by the client');
 assert(ui.includes("window.crmWaButtons({phone:wa,size:'sm'})"),'owners: by the number');
 const h=ctx.window.crmWaButtons({phone:'+968 9000 0000',size:'sm'});
 assert(h.includes('href="https://wa.me/96890000000"')&&h.includes('data-wa-crm="1" data-conv="" data-client="" data-phone="96890000000"'),'a number alone still gives the CRM button');
 assert(!ctx.window.crmWaButtons({phone:'96890000000',clientId:'x'}).includes('data-phone='),'with a client the chat is found by the client, as before');
 assert(wa.includes(".eq('customer_wa_id',d)")&&wa.includes("crm.dataset.phone||''"),'looked up when pressed, among the chats the account may see');
 assert(css.includes('.crm-grid .crm-grid-actions .crm-wa-btn{'),'inside a table row the pair looks like the row\'s other actions');
 // Ahmed, same day: «خلّ النص يظهر في جدول الزيارات بدل الأيقونات». The words always show; on a medium screen the icons go
 // and a very long client name is cut, so the fixed actions column does not cover the status column.
 assert(!css.includes('font-size:0'),'the words are never hidden');
 // then: «سوّ نفس الشي لجدول الملاك، نص بدون أيقونات»: no icons in any table row
 assert(css.includes('.crm-grid .crm-grid-actions .crm-wa-btn::before{display:none}')&&!css.includes('#page-viewings .crm-grid .crm-grid-actions'),'not the visits table only');
 assert(css.includes('#page-viewings .crm-grid td.crm-grid-client{max-width:124px;overflow:hidden;text-overflow:ellipsis}'));
 assert(ui.includes('<td class="crm-grid-client" title="'),'the full client name stays as the tooltip');
 assert(/crm-simple-ui\.js\?v=20261112-wa4/.test(index));
});
test('the same two buttons in the follow-ups, the chat header, the waiting list and the client file',()=>{
 const f=fs.readFileSync('crm-followups-today.js','utf8'),chat=fs.readFileSync('crm-whatsapp-chat.js','utf8'),ip=fs.readFileSync('crm-investment-projects.js','utf8'),base=fs.readFileSync('app-base-v15.html','utf8');
 assert(f.includes('class="crm-wa-btn crm-wa-phone crm-wa-main cfu-open"')&&f.includes('class="crm-wa-btn crm-wa-crm cfu-crm" data-cfu="crm"'));
 assert(chat.includes('<a class="crm-wa-btn crm-wa-phone" data-for="'));
 assert(ip.includes('<li class="ip-wait-row"><div class="ip-wait-info">')&&ip.includes('</div><div class="ip-wait-actions">'),'the name no longer breaks letter by letter beside the buttons');
 assert(base.includes("window.crmWaPhoneLink(c.phone_normalized||c.phone)")&&base.includes('<button type="button" class="crm-wa-btn crm-wa-crm" onclick="openClientWhatsAppHistory()">فتح في النظام</button>'),'client file: phone WhatsApp beside the CRM chat');
 assert(/crm-whatsapp-chat\.js\?v=20261114-ogg1/.test(index)&&/crm-followups-today\.js\?v=20261114-note1/.test(index));
});
test('the two buttons are used on every chat button',()=>{
 for(const f of ['crm-hot-alerts.js','crm-owner-home.js','crm-owner-leads.js','crm-reply-approvals.js','crm-investment-projects.js'])assert(fs.readFileSync(f,'utf8').includes('crmWaButtons'),f);
 assert.equal((fs.readFileSync('crm-reply-approvals.js','utf8').match(/waBtns\(/g)||[]).length,5,'the 5 approval cards');
 assert(fs.readFileSync('app-base-v15.html','utf8').includes("window.crmWaButtons({clientId:d.client_id,cls:'btn-secondary crm-wa-small'})"),'deal cards');
 assert(fs.readFileSync('crm-whatsapp-chat.js','utf8').includes('فتح في واتساب الجوال'),'inside the CRM chat');
});
test('«تم» closes everything of the client and stays closed for the same kind (SQL88)',()=>{
 const hot=fs.readFileSync('crm-hot-alerts.js','utf8'),sql=fs.readFileSync('db/changes/88-hot-alert-done-sticks.forward.sql','utf8');
 assert(sql.includes('owner_alert_done_reason = left(handoff_reason, 500)'));
 assert(hot.includes("eq('type','whatsapp_handoff').eq('client_id',n.client_id).eq('is_read',false)"),'all his notifications');
 assert(hot.includes("kindOf(w.owner_alert_done_reason)===kindOf(why)"),'a re-handoff of the same kind stays hidden');
 assert(hot.includes('kindOf(x.owner_alert_done_reason)===kindOf(n.title)'),'a new notification of the same kind stays hidden');
});
// 11 Nov 2026 (Ahmed): price study report to his WhatsApp from the branch number, one block per client with separators
test('price study report: details, number, owner offer, words, documents, separators; once per handoff (SQL89)',()=>{
 const f=fs.readFileSync('supabase/functions/whatsapp-owner-hot-alert/index.ts','utf8'),s=fs.readFileSync('db/changes/89-price-study-report.forward.sql','utf8');
 assert(f.includes('`📋 دراسة سعر ${tag} · ${branch}`')&&f.includes('✅ نهاية دراسة السعر ${tag}'),'header and end separators');
 assert(f.includes('`الرقم: ${phone}`')&&f.includes('`المحادثة: https://wa.me/${phone}`'));
 assert(f.includes('async function forwardMedia(')&&f.includes('`https://graph.facebook.com/${GRAPH}/${phoneId}/media`'),'documents sent again from the branch number');
 assert(f.includes('action_type", "owner_price_study"')&&f.includes('contains("payload", { handoff_at: at })'),'one report per handoff');
 assert(f.includes('const route = (routes.data || []).find((r: any) => r.route_key === conv.route_key);'),'the branch number of that chat');
 assert(s.includes("'action', 'price_study'")&&s.includes("coalesce(OLD.handoff_reason,'') !~ "),'only a new price study, not a rewording');
});
