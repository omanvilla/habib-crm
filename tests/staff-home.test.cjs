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
 assert(js.includes(":[supa.rpc('crm_staff_home'),0,null,null,fu]"),'staff read no approvals, twins or paused chats');
 assert(js.includes("supa.rpc('crm_owner_home')"));
 assert(js.includes("(isOwner()?'<button type=\"button\" class=\"coh-more\" data-coh=\"nav\" data-nav=\"reports\">التقارير الكاملة</button>':'')"),'reports (money) stay owner-only');
 assert(js.includes('if(!owner){paused={items:[],total:0};autoNotes=[];}'),'a staff session never shows the owner\'s lists left in the tab');
 assert(/crm-owner-home\.js\?v=20261111-staff1/.test(index));
});
