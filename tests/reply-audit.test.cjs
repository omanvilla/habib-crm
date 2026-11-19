'use strict';
// Reply audit twice a day (SQL144 + whatsapp-reply-audit, 19 Nov 2026).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const sql=fs.readFileSync('db/changes/144-reply-audit.forward.sql','utf8');
const fn=fs.readFileSync('supabase/functions/whatsapp-reply-audit/index.ts','utf8');
const rules=fs.readFileSync('supabase/functions/whatsapp-reply-audit/rules.ts','utf8');
const md=fs.readFileSync('docs/agent-rules.md','utf8');

test('runs at 07:30 and 14:30 Muscat every day of the week',()=>{
 assert(sql.includes("cron.schedule('reply_audit_morning', '30 3 * * *'"));
 assert(sql.includes("cron.schedule('reply_audit_afternoon', '30 10 * * *'"));
});
test('the Claude-chat functions run without a user session and no browser can call them',()=>{
 for(const f of ['crm_reply_audit_open()','crm_reply_audit_decide(uuid, integer, text, boolean)','crm_reply_audit_apply(uuid[], text, text, text, text)'])
  assert(sql.includes('public.'+f),f);
 assert(/REVOKE ALL ON FUNCTION public\.crm_reply_audit_health[\s\S]*crm_reply_audit_apply\(uuid\[\], text, text, text, text\) FROM PUBLIC, anon, authenticated;/.test(sql));
 assert(sql.includes("IF public.my_role() IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'owner_only'"),'the card is owner only');
 assert(sql.includes('REVOKE ALL ON public.whatsapp_reply_audit_runs, public.whatsapp_reply_audit_findings FROM PUBLIC, anon, authenticated;'));
});
test('at most 5 findings, grouped by type, critical first, then a repeat of a pinned rule',()=>{
 assert(fn.includes('MAX_FINDINGS = 5'));
 assert(fn.includes('Number(b.critical) - Number(a.critical) || Number(!!b.repeatRule) - Number(!!a.repeatRule)'));
});
test('critical = invented price or fact, sold property offered, serious buyer not handed over; it mutes the chat with the existing switch',()=>{
 for(const k of ['invented_info','sold_offered','serious_not_handed']) assert(new RegExp(k+': \\{ label: "[^"]+", critical: true \\}').test(fn),k);
 assert(fn.includes('agent_muted: true, agent_muted_reason: `فحص الردود:'));
 assert(fn.includes('action: "notify_owner"'));
 assert(fn.includes('p.certain === true'),'only a certain mistake mutes a chat');
});
test('open findings of earlier reports are not written again',()=>{
 assert(fn.includes('const fresh = problems.filter((p) => !openKey.has('));
 assert(fn.includes('باقي من قبل'));
});
test('the report is sent every run, also with nothing wrong',()=>{
 assert(fn.includes('"ما في أغلاط جديدة ✅"'));
 assert(fn.includes('const sentOk = await notifyOwner("muscat"'));
});
test('rules.ts is regenerated from docs/agent-rules.md (run build-rules.ps1 after changing the rules)',()=>{
 const current=md.split('\n## سيناريوهات')[0];
 const ids=[...current.matchAll(/^\| (R\d+) \|/gm),...current.matchAll(/^- \*\*(R\d+):\*\*/gm)].map(m=>m[1]);
 assert(ids.length>70);
 for(const r of ids) assert(new RegExp('^  "'+r+'[:،]','m').test(rules),r+' is missing from rules.ts');
});
test('a reply sent before its rule went live is not reported (RELEASES)',()=>{
 assert(fn.includes('{ at: "2026-11-18T11:37:00Z", rules: ["R112", "R113", "R114", "R115"] }'));
 assert(fn.includes('rs.every((r: string) => releasedAfter(r, d.created_at))'));
});
