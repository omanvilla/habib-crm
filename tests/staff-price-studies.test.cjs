'use strict';
// R59 (14 Nov 2026, Ahmed: «دراسة سعر جاهزة ودراسة سعر ملاك ينتظرون تسعيرك… اريد الموظفين ايضا يقدروا يشوفوا… يشوفوا
// ويرسلوا من ارقام الافرع… يبين مال مسقط وحده ومال بركة وحده»). He chose: staff approve and send, and see every number.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const read=f=>fs.readFileSync(f,'utf8').replace(/\r\n/g,'\n');
const ui=read('crm-price-studies.js'),home=read('crm-owner-home.js'),index=read('index.html');
const sql=read('db/changes/104-staff-price-studies.forward.sql'),rb=read('db/changes/104-staff-price-studies.rollback.sql');
const code=s=>s.split('\n').filter(l=>!l.startsWith('--')).join('\n');

test('the studies screen is the owner\'s and the staff\'s: same list, same numbers, same buttons',()=>{
  assert(ui.includes("const canSee=()=>typeof currentProfile!=='undefined'&&currentProfile&&['owner','manager','agent'].includes(currentProfile.role);"));
  assert(!/isOwner/.test(ui),'nothing on the screen is behind the owner role any more');
  assert(ui.includes("window.crmPriceStudiesCount=()=>canSee()?waiting().length:0;"),'the home tile counts for staff');
  assert(ui.includes("cell('صافي المالك',i.owner_net,true)+cell('العمولة',i.commission,true)")&&ui.includes('data-path="\'+esc(i.internal_report_path||\'\')+\'">التقرير الداخلي PDF</button>'),'every number and both reports');
  assert(!ui.includes('يشوفه الموظف')&&!ui.includes('يشوفها الموظف'),'no line says staff cannot see it');
  assert(ui.includes('داخلي للمكتب، ما يوصل للمالك'),'still never sent to the owner of the property');
  assert(home.includes("const ps=(owner||canResume())&&typeof window.crmPriceStudiesRefresh==='function'?"),'read for staff with the rest of the home');
  assert(home.includes("canResume()?supa.rpc('crm_paused_chats'):null,fu].concat(ps));"));
});

test('each branch on its own: tabs الكل / بركاء / مسقط in the ready studies and in the owners waiting for a price',()=>{
  assert(ui.includes("[['all','الكل',data.items.length],['barka','بركاء',n('barka')],['muscat','مسقط',n('muscat')]]"));
  assert(ui.includes("data.items.filter(i=>branch==='all'||i.route_key===branch).map(card)")&&ui.includes("else if(act==='tab'){branch=b.dataset.v||'all';redraw(true);}"));
  assert(home.includes("[['all','الكل',items.length],['barka','بركاء',n('barka')],['muscat','مسقط',n('muscat')]]"));
  assert(home.includes("pausedRows(items.filter(i=>pricingBranch==='all'||i.route_key===pricingBranch),true)")&&home.includes("else if(act==='prbranch'){pricingBranch=b.dataset.v||'all';drawSheet();}"));
  assert(ui.includes("esc(ROUTE[i.route_key]||'')"),'the branch is written on every card');
});

test('staff send the price from the branch number too; a price-study chat is still not handed back to the agent by staff',()=>{
  assert(home.includes(`+(pricing&&canResume()?'<button type="button" class="btn-primary coh-go" data-coh="pprice"`)&&home.includes("+(pricing&&canResume()?priceForm(i):'')"));
  assert(home.includes("crmSendWhatsApp({client_id:it.client_id,conversation_id:id,body})"),'through the chat\'s own send: the number the owner wrote to');
  assert(home.includes("(pricing||!canResume()||(!isOwner()&&isStudyChat(i))?''"),'R26 / R27: «كمّل يا عقل» on a price study stays Ahmed\'s');
  const fn=read('supabase/functions/price-study/index.ts');
  assert(fn.includes('approved_by: s.decided_by'),'the sent message keeps who approved it');
});

test('SQL104: only the first line of the three functions changes, guarded by their md5; staff read the bucket and the inspections',()=>{
  assert.equal(sql,read('supabase/migrations/20261114170000_staff_price_studies_20261114.sql'));
  assert(sql.startsWith('-- SQL104 ('));
  const oldLine="if public.my_role() is distinct from 'owner' then raise exception 'owner_only' using errcode = '42501'; end if;";
  const newLine="if public.my_role() is null or public.my_role() not in ('owner', 'manager', 'agent') then raise exception 'owner_only' using errcode = '42501'; end if;";
  for(const s of [sql,rb])assert(s.includes('$o$'+oldLine+'$o$')&&s.includes('$n$'+newLine+'$n$'));
  // the line being replaced is the one SQL94 and SQL96 wrote
  assert(read('db/changes/94-price-study-auto.forward.sql').includes(oldLine)&&read('db/changes/96-price-study-inspection.forward.sql').includes(oldLine));
  for(const f of ["('public.crm_price_studies_pending()', '4619089f9e847ea17da42467205823d4')","('public.crm_price_study_decide(uuid, boolean, text, text)', 'a5344ec6f3f5715954af8fbb709575cb')","('public.crm_price_study_inspection_save(uuid, text, date, text[])', '9349ff1e93f19b9d8b414ca019320a7b')"])assert(sql.includes(f),f);
  assert(sql.includes("IF md5(v_def) <> f.was THEN")&&sql.includes("RAISE EXCEPTION 'SQL104 refused: % changed since 14 Nov 2026 (md5 %)'"));
  assert(sql.includes('v_new := replace(v_def, c_old, c_new);')&&sql.includes('EXECUTE v_new;'));
  assert.equal((code(sql).match(/CREATE POLICY/g)||[]).length,4);
  assert.equal((code(sql).match(/IN \('owner', 'manager', 'agent'\)/g)||[]).length,4,'every new policy names the three roles; a viewer gets nothing');
  assert(sql.includes("USING (company_id = (SELECT public.my_company()) AND (SELECT public.my_role()) IN ('owner', 'manager', 'agent'))"),'inspections: own company only');
  assert(sql.includes("WITH CHECK (bucket_id = 'price-studies' AND (storage.foldername(name))[1] = 'inspections'"),'staff upload only under inspections/');
  assert(!/owner_price_studies\b(?!_)|owner_price_study_docs|FOR UPDATE|FOR ALL|DELETE FROM|UPDATE public|whatsapp_/.test(code(sql)),'the study tables stay the owner\'s to read directly; no row changes; nothing is sent');
  assert.equal((code(rb).match(/\(SELECT public\.my_role\(\)\) = 'owner'/g)||[]).length,4,'the rollback puts the four owner-only policies back');
  assert(rb.includes('IF position(c_new IN v_def) > 0 THEN EXECUTE replace(v_def, c_new, c_old); END IF;'));
});

test('R59 is written down, and R37 says what it changed',()=>{
  const rules=read('docs/agent-rules.md');
  assert(/\| R59 \| \*\*دراسات السعر للموظف/.test(rules));
  assert(rules.includes('(تعدلت بـ R59، 14 نوفمبر'));
  assert(index.includes('crm-price-studies.js?v=20261114-ps1')&&index.includes('crm-owner-home.js?v=20261114-boot1'));
});
