'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const ig=fs.readFileSync('crm-instagram-discovery.js','utf8'),home=fs.readFileSync('crm-owner-home.js','utf8');
const sql=fs.readFileSync('db/changes/62-video-on-twin-properties.forward.sql','utf8');

test('the card asks first and links to all only on a yes',()=>{
 assert(ig.includes("if(twinList&&!button.dataset.twinChoice){"));
 assert(ig.includes("const linkAll=twinList&&button.dataset.twinChoice==='all';"));
 assert(ig.includes('تربط الفيديو على الكل ؟'));
});
test('the home page offers yes and no, and no stops the question',()=>{
 assert(home.includes("crm_link_twin_group"));assert(home.includes("crm_dismiss_twin_group"));
 assert(home.includes('!g.dismissed'));
});
test('a link on another property is still refused unless it is an approved twin',()=>{
 assert(sql.includes("CONSTRAINT = 'property_marketing_link_key_unique'"));
 assert(sql.includes("IF auth.uid() IS NOT NULL AND public.my_role() IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'owner_required'"));
});
test('only identical properties can be grouped and only the owner can do it',()=>{
 assert.equal((sql.match(/count\(DISTINCT \(p\.owner_id, p\.land_size, p\.built_size, p\.bedrooms, p\.price\)\)/g)||[]).length,2);
 for(const fn of ['crm_property_twins','crm_link_twin_group','crm_dismiss_twin_group','crm_instagram_link_twins'])assert(sql.includes('REVOKE ALL ON FUNCTION public.'+fn),fn);
});
test('a client from the video counts for each identical property',()=>{
 assert(sql.includes('CREATE TRIGGER crm_mirror_twin_attribution AFTER INSERT ON public.property_message_attributions'));
});
