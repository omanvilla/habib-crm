'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const js=fs.readFileSync('crm-investment-projects.js','utf8'),index=fs.readFileSync('index.html','utf8'),ig=fs.readFileSync('crm-instagram-discovery.js','utf8');
const sql=fs.readFileSync('db/changes/61-investment-projects.forward.sql','utf8');

// 11 Nov 2026 (Ahmed, SQL82): staff see the page and edit projects; linking a video stays owner-only
test('the page loads for owner and staff; video linking stays owner-only',()=>{
 assert.match(index,/crm-investment-projects\.js\?v=20261111-staff1/);
 assert(js.includes("if(id==='projects'&&!canSee())"));
 assert(js.includes("(isOwnerNow()?'<div class=\"ip-add\">"),'adding a video: owner only');
 assert(js.includes("(isOwnerNow()?'<button type=\"button\" class=\"btn-secondary ip-remove\""),'removing a video: owner only');
 const s82=fs.readFileSync('db/changes/82-staff-owner-leads-projects.forward.sql','utf8');
 assert(s82.includes('CREATE POLICY investment_projects_staff_read')&&s82.includes("NOT crm_repair_private.owner_line_is_private(company_id, to_jsonb(owner_leads.*))"));
 assert(!/crm_project_add_video|crm_instagram_link_project/.test(s82),'video functions keep their owner check');
 assert(sql.includes('ALTER TABLE public.investment_projects ENABLE ROW LEVEL SECURITY'));
 for(const fn of ['crm_investment_projects','crm_project_add_video','crm_instagram_link_project'])assert(sql.includes('REVOKE ALL ON FUNCTION public.'+fn),fn);
});
test('the three projects and their developers are added',()=>{
 for(const [name,dev] of [['مدينة السلطان هيثم','الأهلي صبور'],['اليزن','VA Group'],['عايدة','دار جلوبال']])assert(sql.includes("('"+name+"', '"+dev+"'"),name);
});
test('the scan never overrides Ahmed or a video already linked to a property',()=>{
 assert(sql.includes("IF p_actor IS NULL AND (c.reviewed_at IS NOT NULL OR c.state = 'linked') THEN RETURN"));
});
test('cards offer projects and a similar name no longer suggests the wrong property',()=>{
 assert(ig.includes("crm_instagram_link_project"));
 assert(ig.includes('!words.every(w=>t.includes(w))'));
});
