'use strict';
// SQL101 / R52 (Ahmed 14 Nov 2026): electricity and water on a property and on an owner offer
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const read=(p)=>fs.readFileSync(p,'utf8');
const sql=read('db/changes/101-property-utilities.forward.sql'),rb=read('db/changes/101-property-utilities.rollback.sql');
const agent=read('supabase/functions/whatsapp-reply-agent/index.ts'),brain=read('supabase/functions/whatsapp-reply-agent/brain.ts'),base=read('app-base-v15.html');
test('SQL101 only adds: two columns on two tables, their checks, grants and the view columns at the end',()=>{
  assert.equal(sql,read('supabase/migrations/20261114120000_property_utilities_20261114.sql'),'the migration is the forward file byte for byte');
  for(const t of ['properties','owner_leads'])for(const c of ['electricity_connected','water_connected'])
    assert(sql.includes(`ALTER TABLE public.${t} ADD COLUMN IF NOT EXISTS ${c} text;`)&&rb.includes(`ALTER TABLE public.${t} DROP COLUMN IF EXISTS ${c};`),t+'.'+c);
  assert(sql.includes("CHECK (electricity_connected IS NULL OR electricity_connected IN ('yes','no'))")&&sql.includes("CHECK (water_connected IS NULL OR water_connected IN ('yes','no'))"));
  assert(sql.includes('GRANT SELECT, INSERT, UPDATE (electricity_connected, water_connected) ON public.properties TO authenticated;'));
  assert(sql.includes("md5(v_def) <> '8af5dc12ea68b09627921796dbc7b091' AND position('electricity_connected' IN v_def) = 0"),'refused when the live view is not the SQL98 body');
  assert(sql.includes('    t.price_negotiable,\n    t.electricity_connected,\n    t.water_connected\n   FROM public.properties t'));
  assert(!/\b(DROP TABLE|DELETE FROM|TRUNCATE|CREATE TRIGGER|cron\.)/i.test(sql));
  assert(rb.includes('    t.unit_label,\n    t.price_negotiable\n   FROM public.properties t')&&rb.includes('GRANT SELECT ON public.crm_properties_access TO authenticated, service_role;'));
});
test('the property form saves and reopens the two fields, and the column lists carry them',()=>{
  assert(base.includes('id="pElectricity"')&&base.includes('id="pWater"'));
  assert(base.includes("electricity_connected:$('pElectricity')?($('pElectricity').value||null):null,water_connected:$('pWater')?($('pWater').value||null):null,"));
  assert(base.includes("$('pElectricity').value=p.electricity_connected||'';")&&base.includes("$('pWater').value=p.water_connected||'';"));
  assert(base.includes("'pUnitLabel','pPriceNego','pElectricity','pWater']"),'a new property starts with both empty');
  assert.equal(base.split('"price_negotiable", "electricity_connected", "water_connected"]').length-1,2,'all and safe lists');
  assert.match(read('index.html'),/app-base-v15\.html\?v=20261114-util1/);
});
test('the agent tells a buyer only what is recorded, and keeps the owner\'s answer',()=>{
  const src=agent.slice(agent.indexOf('  const util = `'),agent.indexOf('\n',agent.indexOf('  const util = `')));
  const util=(p)=>new Function('p',src+';return util;')(p);
  assert.equal(util({electricity_connected:'yes',water_connected:'no'}),' | الكهرباء: موصلة | الماء: غير موصل');
  assert.equal(util({electricity_connected:null,water_connected:null}),'','nothing is said when nothing is recorded (R41 answers then)');
  assert(agent.includes('${terms}${rented}${nego}${util} | الزيارة:'));
  assert(agent.includes('electricity: { type: ["string", "null"], enum: ["yes", "no", null] }, water: { type: ["string", "null"], enum: ["yes", "no", null] },'));
  assert(agent.includes('"visit_method", "visit_instructions", "electricity", "water"]'));
  assert(agent.includes('if (["yes", "no"].includes(o.electricity)) row.electricity_connected = o.electricity;'));
  assert(agent.includes('.is("electricity_connected", null)')&&agent.includes('.is("water_connected", null)'),'never over what the office wrote');
  assert(brain.includes('"والكهرباء والماء موصلين ؟"')&&brain.includes('owner_offer.electricity و water'));
  assert(brain.includes('إذا مكتوب في بيانات العقار إنها موصلة أو لا، جاوب منه'));
});
