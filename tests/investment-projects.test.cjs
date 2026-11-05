'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const js=fs.readFileSync('crm-investment-projects.js','utf8'),index=fs.readFileSync('index.html','utf8'),ig=fs.readFileSync('crm-instagram-discovery.js','utf8');
const sql=fs.readFileSync('db/changes/61-investment-projects.forward.sql','utf8');

test('the page loads and is owner only on the screen and in the database',()=>{
 assert.match(index,/crm-investment-projects\.js\?v=/);
 assert(js.includes("if(id==='projects'&&!isOwnerNow())"));
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
