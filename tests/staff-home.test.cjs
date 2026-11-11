// Staff home (11 Nov 2026, Ahmed): staff get the same home page as the owner, without the owner-only parts.
const test=require('node:test');const assert=require('node:assert');const fs=require('fs');
const js=fs.readFileSync('crm-owner-home.js','utf8');
const sql=fs.readFileSync('db/changes/81-staff-home.forward.sql','utf8').replace(/\r\n/g,'\n');
const mirror=fs.readFileSync('supabase/migrations/20261111120000_staff_home_20261111.sql','utf8').replace(/\r\n/g,'\n');
const index=fs.readFileSync('index.html','utf8');

test('crm_staff_home runs with the caller\'s own row level security and never touches owner-only data',()=>{
 assert(sql.includes('STABLE SECURITY INVOKER'));
 assert(!/SECURITY DEFINER/.test(sql));
 assert(sql.includes("'owner_leads_new', 0")&&sql.includes("'problems', '[]'::jsonb")&&sql.includes("'agent_replies', NULL"));
 // SQL82 (Ahmed 11 Nov): owner offers open to staff, so their home counts new offers through the staff policy
 assert(fs.readFileSync('db/changes/82-staff-owner-leads-projects.forward.sql','utf8').includes("'owner_leads_new', (SELECT count(*) FROM public.owner_leads l WHERE l.company_id = v_company AND l.status = 'open'"));
 assert(!/owner_leads l|cron\.job|instagram_|whatsapp_reply_drafts|crm_paused_chats\(\)/.test(sql.split('AS $function$')[1]),'no owner-only table inside the body');
 assert(!/FROM public\.deals /.test(sql),'deals only through crm_deals_access (no money, no merged cards)');
 assert(sql.includes('FROM public.crm_deals_access d'));
 assert(sql.includes('REVOKE ALL ON FUNCTION public.crm_staff_home() FROM PUBLIC, anon;')&&sql.includes('GRANT EXECUTE ON FUNCTION public.crm_staff_home() TO authenticated;'));
 assert.equal(sql,mirror);
});
test('the home page draws for staff from crm_staff_home and keeps the owner-only parts out',()=>{
 assert(js.includes("['manager','agent','viewer'].includes(currentProfile.role)"));
 assert(js.includes('if(hasHome()&&!last)armGate();'),'no old-dashboard flash for staff either');
 assert(js.includes(":[supa.rpc('crm_staff_home'),0,null,canResume()?supa.rpc('crm_paused_chats'):null,fu]"),'staff read no approvals or twins; paused chats since R27');
 assert(js.includes("supa.rpc('crm_owner_home')"));
 assert(js.includes("(isOwner()?'<button type=\"button\" class=\"coh-more\" data-coh=\"nav\" data-nav=\"reports\">التقارير الكاملة</button>':'')"),'reports (money) stay owner-only');
 assert(js.includes('if(!owner){paused={items:[],total:0};autoNotes=[];}'),'a staff session never shows the owner\'s lists left in the tab');
 assert(/crm-owner-home\.js\?v=20261112-study1/.test(index));
});
test('a staff account is greeted by its own name; the branch stays under the name (Ahmed 11 Nov)',()=>{
 const base=fs.readFileSync('app-base-v15.html','utf8');
 assert(base.includes("const label=currentProfile.full_name||branchLabel||currentProfile.email;"));
 assert(base.includes("$('userRole').textContent=roleAr(currentProfile.role)+(branchLabel?' · '+branchLabel:'');"));
 assert(base.includes("$('welcomeName').textContent=(currentProfile.full_name||'').split(' ')[0]||branchLabel||'بك';"));
 assert(/app-base-v15\.html\?v=20261112-fix1/.test(index));
});
test('targets, performance, tasks and the responsible column name the person on the branch line (SQL83)',()=>{
 const base=fs.readFileSync('app-base-v15.html','utf8'),ops=fs.readFileSync('crm-operations-v6.js','utf8'),tasks=fs.readFileSync('crm-v18-task-priority-patch.js','utf8');
 const s83=fs.readFileSync('db/changes/83-branch-people.forward.sql','utf8');
 assert(s83.includes("r.route_key IN ('muscat','barka') AND r.owner_only_inbox IS FALSE")&&!/phone|email/.test(s83.split('AS $function$')[1]),'branch lines only, no contact details');
 assert(base.includes("supa.rpc('crm_branch_people')")&&base.includes('function updateUserUI(){if(!currentProfile)return;crmLoadBranchPeople();'));
 assert.equal((base.match(/escapeHtml\(crmRecordPersonLabel\(c\)\)/g)||[]).length,2);
 assert(ops.includes("const branchLabel=branch=>(window.crmBranchPeople&&window.crmBranchPeople[branch])||"));
 assert(tasks.includes('crmRecordPersonLabel(task)')&&tasks.includes('return crmBranchPersonName(branch);'));
 assert(tasks.includes('<th>المسؤول</th>'),'the task column says who is responsible');
 assert(/crm-v18-task-priority-patch\.js\?v=20261111-people2/.test(index)&&/crm-operations-v6\.js\?v=20261111-people1/.test(index));
});
test('member labels name the person on the branch line',()=>{const base=fs.readFileSync('app-base-v15.html','utf8');assert(base.includes("return branch?crmBranchPersonName(branch):'حساب فريق';"));});
test('staff follow everyone like the owner, never the owner line (SQL85)',()=>{
 const s85=fs.readFileSync('db/changes/85-staff-followups-all.forward.sql','utf8');
 assert(s85.includes("WHERE v_owner OR (public.my_role() IN ('manager','agent','viewer') AND i.route_key IS DISTINCT FROM 'owner')"));
 assert(s85.includes('CASE WHEN v_owner THEN i.owner_instruction END'),'the owner instructions stay his');
 assert(!s85.includes('staff_is_branch_member'));
 assert(/crm-followups-today\.js\?v=20261112-ab1/.test(index));
});
test('a follow-up naming a property that left the market goes back to review (SQL86)',()=>{
 const s=fs.readFileSync('db/changes/86-followups-reread-unavailable.forward.sql','utf8');
 assert(s.includes('AFTER UPDATE OF status, archived ON public.properties'));
 assert(s.includes("IF (old.status = 'available' AND coalesce(old.archived, false) = false)"));
 assert(s.includes('SET reviewed_at = NULL, owner_text = NULL')&&s.includes('AND q.reason IS NULL'),'owner-decided rows are left alone');
 assert(s.includes("RAISE WARNING 'SQL86 followups_reread"),'a failure never blocks the property save');
 assert(s.includes('SELECT DISTINCT ON (i.client_id) i.source, i.id, i.client_id, i.conversation_id,'));
});
test('each follow-up opens in the phone WhatsApp or inside the CRM',()=>{
 const f=fs.readFileSync('crm-followups-today.js','utf8');
 assert(f.includes('>فتح في واتساب الجوال</a>')&&f.includes('data-cfu="crm"')&&f.includes('>فتح في النظام</button>'));
 assert(f.includes("navigate('whatsapp',null);setTimeout(()=>openWhatsAppConversation(id),300)"));
 assert(!f.includes(String.fromCharCode(92)+'&'),'no escaped ampersand left in the code');
});
test('SQL86b matches the place word of the area, not the whole area text',()=>{
 const s=fs.readFileSync('db/changes/86b-followups-reread-area-words.sql','utf8');
 assert(s.includes("regexp_replace(regexp_replace(t, '^(و|ب)?ال', ''), '[ةه]$', '')"));
 assert(s.includes("'بركاء','مسقط'")&&s.includes("'جنوبي','شمالي'"));
 assert(s.includes('AND q.reason IS NULL'));
});
