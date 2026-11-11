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
 assert(index.includes('crm-wa-buttons.js?v=20261111-wa1"><'+String.fromCharCode(92)+'/script>'),'loaded inside the boot script with an escaped closing tag');
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
 assert(s.includes("'action', 'price_study'")&&s.includes("coalesce(OLD.handoff_reason,'') !~ '^\s*دراسة\s*سعر'"));
});
