'use strict';
// Ahmed 12 Nov 2026 (R38, R39): a unit sold or booked out of a group of similar units, and follow-ups that follow where
// each client stands. Source checks; the live behaviour was run on the database in rolled-back transactions (docs/current-state.md).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const read=f=>fs.readFileSync(f,'utf8');
const sql=read('db/changes/97-unit-groups.forward.sql'),rb=read('db/changes/97-unit-groups.rollback.sql');
const out=read('supabase/functions/whatsapp-outreach/index.ts'),sold=read('supabase/functions/whatsapp-sold-notify/index.ts');
const fu=read('supabase/functions/whatsapp-visit-followup-auto/index.ts'),agent=read('supabase/functions/whatsapp-reply-agent/index.ts');
const base=read('app-base-v15.html'),index=read('index.html'),approvals=read('crm-reply-approvals.js');

test('SQL97 is applied from one file: the migration copy is byte-identical',()=>{
  assert.equal(read('supabase/migrations/20261112160000_unit_groups_20261112.sql'),sql);
  assert(sql.startsWith('-- SQL97 ('));
});
test('a group is the same owner, branch, area, kind and purpose with near specifications, available and not archived',()=>{
  const s=sql.slice(sql.indexOf('FUNCTION crm_repair_private.unit_siblings('),sql.indexOf('FUNCTION crm_repair_private.unit_group_notice('));
  for(const need of ['s.owner_id IS NOT NULL AND s.owner_id = p.owner_id',"coalesce(s.branch_key, '') = coalesce(p.branch_key, '')",
    'unit_type_family(s.type) = crm_repair_private.unit_type_family(p.type)','unit_area_key(s.area) = crm_repair_private.unit_area_key(p.area)',
    'unit_near(s.price, p.price)','unit_near(s.land_size, p.land_size)','unit_near(s.built_size, p.built_size)','abs(s.bedrooms - p.bedrooms) <= 1',
    "s.status = 'available' AND coalesce(s.archived, false) = false"])assert(s.includes(need),need);
  assert(sql.includes('abs(a - b) <= 0.10 * greatest(a, b)'),'within 10 percent');
  assert(sql.includes("IN ('villa', 'twin_villa', 'house', 'townhouse') THEN 'home'"),'villa and house are one kind for a buyer');
});
test('the sentence: identical units by their number, differing units by what distinguishes them, nothing when no unit is left',()=>{
  assert(sql.includes("v_line := 'انحجزت وحدة ' || v_of || ' والمتبقي ' || v_rest;"));
  assert(sql.includes("'انحجزت ' || btrim(p.unit_label) || ' و' || v_rest || ' لين الحين '"));
  assert(sql.includes("IF v_n = 0 THEN RETURN NULL; END IF;"));
  assert(sql.includes("'الاولى','الثانية','الثالثة'"));
  // a bare price at the end of a title is not a unit number
  assert(sql.includes("'[-–]\\s*([0-9]{1,2})\\s*$'"));
  for(const f of ['public.crm_unit_group_notice(uuid)','public.crm_unit_groups(uuid)']){
    assert(sql.includes('REVOKE ALL ON FUNCTION '+f+' FROM PUBLIC, anon, authenticated;'),f+' is closed to the browser');
    assert(sql.includes('GRANT EXECUTE ON FUNCTION '+f+' TO service_role;'));
  }
});
test('what was open on the unit moves to the remaining unit before the SQL77 trigger closes the rest',()=>{
  const m=sql.slice(sql.indexOf('FUNCTION crm_repair_private.move_to_remaining_unit('),sql.indexOf('FUNCTION crm_repair_private.move_to_remaining_unit_on_change('));
  assert(m.includes("UPDATE public.client_requests r SET subject_property_id = t.id"));
  assert(m.includes("v.status IN ('scheduled', 'confirmed', 'postponed')"),'a done visit is never moved');
  assert(m.includes("x.stage IN ('new', 'viewing_scheduled', 'viewing_no_show', 'viewing_cancelled', 'viewing_postponed', 'visit')"),'only cards still at the visit');
  assert(!/x\.stage IN \([^)]*'negotiation'/.test(m.slice(m.indexOf('FOR d IN'))),'a negotiation is Ahmed\'s and stays');
  assert(m.includes('x.reservation_confirmed_at IS NULL AND coalesce(x.deposit_amount, 0) = 0'));
  assert(m.includes("coalesce(x.entry_mode, '') <> 'historical'"));
  assert(m.includes('NOT (x.client_id = ANY (v_buyers))')&&m.includes('NOT (r.client_id = ANY (v_buyers))'),'the buyer keeps everything on the unit');
  assert(m.includes("o.stage NOT IN ('lost', 'closed', 'commission_collected')"),'one open card per client and property (SQL77c)');
  assert(m.includes("'reason', 'unit_group_remaining'"),'each moved card has its line in the activity log');
  assert(sql.includes('CREATE TRIGGER crm_a_move_to_remaining_unit AFTER UPDATE OF status, archived ON public.properties'));
  assert(sql.includes("WHEN (new.status IN ('sold', 'reserved') AND old.status IS DISTINCT FROM new.status)"));
  assert('crm_a_move_to_remaining_unit'<'crm_close_deals_on_property_unavailable','it fires first');
  assert(sql.includes("RAISE WARNING 'SQL97 move_to_remaining_unit % failed: %'"),'never fails the property save');
});
test('the CRM reads and saves the unit name; the rollback keeps names that were typed',()=>{
  assert(sql.includes('ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS unit_label text;'));
  assert(sql.includes('GRANT SELECT, INSERT, UPDATE (unit_label) ON public.properties TO authenticated;'));
  assert(sql.includes("md5(v_def) <> 'e7530d4663dcda5d66d5b18a71c526da' AND position('unit_label' IN v_def) = 0"));
  assert(/t\.relisted_at,\n    t\.unit_label\n   FROM public\.properties t/.test(sql));
  const prefix='const CRM_DATA_COLUMNS = ',start=base.indexOf(prefix);
  const columns=JSON.parse(base.slice(start+prefix.length,base.lastIndexOf(';',base.indexOf('function crmDataFrom(',start))));
  assert(columns.properties.all.includes('unit_label')&&columns.properties.safe.includes('unit_label'));
  assert(base.match(/"table":"properties","primary_key":\["id"\],"columns":"([^"]+)"/)[1].split(',').includes('unit_label'));
  assert(base.includes('id="pUnitLabel" maxlength="60"'));
  assert(base.includes("unit_label:$('pUnitLabel')?$('pUnitLabel').value.trim()||null:null,"));
  assert(base.includes("if($('pUnitLabel'))$('pUnitLabel').value=p.unit_label||'';"));
  assert(index.includes('app-base-v15.html?v=20261112-unit1'));
  assert(rb.indexOf('DROP VIEW IF EXISTS public.crm_properties_access;')<rb.indexOf('DROP COLUMN IF EXISTS unit_label'));
  assert(rb.includes("IF NOT EXISTS (SELECT 1 FROM public.properties WHERE nullif(btrim(coalesce(unit_label, '')), '') IS NOT NULL) THEN"));
  assert(rb.includes('DROP TRIGGER IF EXISTS crm_a_move_to_remaining_unit ON public.properties;'));
});
test('R38: the sold notice says a unit is left when one is, in both senders; the old wording stays when none is',()=>{
  for(const [name,src] of [['outreach',out],['sold-notify',sold]]){
    assert(src.includes('db.rpc("crm_unit_group_notice", { p_property: prop.id })'),name);
    assert(src.includes('"تحب تشوفها ؟"'),name);
    assert(src.includes('"تحب تشوف خيارات ثانية ؟"'),name+' keeps the wording for a property with no unit left');
    assert(src.includes('${unit.line}`'),name+' uses the sentence of SQL97, not its own');
    assert(src.includes('String(unit.remaining_text)]'),name);
  }
  assert(out.includes('template_name: "property_unit_booked_ar_v1"')&&sold.includes('const UNIT_TEMPLATE = "property_unit_booked_ar_v1";'));
  assert(out.includes('body: "بخصوص {{1}} اللي سألت عنها في {{2}}\\nانحجزت وحدة منها والمتبقي {{3}}\\nتحب تشوفها ؟"'));
  assert(out.includes('body: "بخصوص موعد زيارتك {{1}}\\nتحب نحدد لك موعد ثاني ؟"'));
  assert(out.includes('body: "بخصوص طلبك {{1}}\\nعندنا {{2}} تحب ارسلك تفاصيله ؟"'));
  // the house style of the templates: no comma, no full stop, a space before the question mark
  for(const m of out.matchAll(/body: "([^"]+)"/g)){assert(!/[،,.!]/.test(m[1]),m[1]);assert(!/[^ ]؟/.test(m[1]),m[1]);}
});
test('R1/R3: nothing is prepared for a negotiation chat, nothing is sent to a held chat',()=>{
  assert(out.includes('return h.error ? true : ["negotiation", "muted"].includes(String(h.data || ""));'));
  assert(out.includes('if (!conv || await held(conv.id)) continue;'));
  assert(out.includes('skip: "chat_held"'));
  assert(out.includes('const hold = await db.rpc("crm_chat_hold", { p_conversation: r.conversation_id });'),'the send still refuses every hold');
  assert(sold.includes('else if (await held(conv.id, true)) reason = "owner_chat";'));
  assert(sold.includes('if (await held(r.conversation_id)) continue;'),'the old sender had no hold check');
  assert(sold.includes('.eq("kind", "property_sold").limit(20)'),'and it sent every approved row of any kind');
  assert(fu.includes('async function negotiationHold(')&&fu.includes('await notInNegotiation(fAll.data || [], REVIEWS_PER_RUN, out)'));
  assert(fu.includes('if (await chatHeld(conv.id)) return "held_owner_chat";'),'unchanged at the send');
});
test('R39: the review reads the client\'s visits, cards and requests and the whole chat, and says where he stands',()=>{
  assert(fu.includes('async function clientFile(companyId: string, clientId: string)'));
  for(const t of ['db.from("viewings").select("viewing_date,status,liked,client_feedback,rejection_reason','db.from("deals").select("stage,lost_from_stage,lost_reason_note','db.from("client_requests").select("property_type,property_types,preferred_area'])assert(fu.includes(t),t);
  assert(fu.includes('newestPart(await chatOf(item.conversation_id, 120), 30000)'));
  assert(fu.includes('ملف العميل من النظام'));
  assert(fu.includes('enum: ["asked_no_visit", "booked_no_show", "visited_not_asked", "visited_no_answer", "visited_liked", "visited_no_fit", "budget_lower", "other_area", "negotiating", "not_buyer", "unclear"]'));
  assert(fu.includes('client_stage: stage'));
  assert(fu.includes('وضع العميل (R39، أحمد 12 نوفمبر)'));
  assert(fu.includes('واللي جاوب على سؤال ما ينعاد عليه'));
  // a client who gave his opinion never gets the fixed step-1 opinion template by itself
  assert(fu.includes('["visited_liked", "visited_no_fit"].includes(String(out.stage))) out.auto_ok = false;'));
  // the rules decided before stay
  for(const kept of ['سكوته جواب','لا تعد بصور أبداً','ممنوع: الفواصل والنقاط وعلامات التعجب','R35، أحمد 12 نوفمبر','عميل زار البيت ولما سألناه ما أعطى جواب واضح: skip'])assert(fu.includes(kept),kept);
});
test('R39: outside the 24 hours the template follows the stage, only an approved one, and an offer is a listed property',()=>{
  const s=fu.slice(fu.indexOf('async function stageTemplate('),fu.indexOf('async function applyDecision('));
  assert(s.includes('if (x.kind && x.kind !== "request_followup") return null;'));
  assert(s.includes('if (x.template_name && !STAGE_TEMPLATES.includes(String(x.template_name))) return null;'),'never the financing follow-up or a test wording (R36)');
  assert(s.includes('db.rpc("crm_visit_followup_template", { p_step: 1, p_route: x.route_key })'));
  assert(s.includes('template_name: "visit_missed_rebook_ar_v1"')&&s.includes('template_name: "request_offer_match_ar_v1"'));
  assert((s.match(/await approved\(/g)||[]).length>=3,'each stage template only when Meta approved it on that number');
  assert(fu.includes('if (l.text === available) out.offer_label = l.labels[out.offer_no - 1] || "";'),'the offer comes from the list the review read');
  assert(fu.includes('const usable = new Set((reg.data || []).filter((t: any) => String(t.status).toUpperCase() === "APPROVED" && String(t.category).toUpperCase() === "UTILITY")'),'by itself only UTILITY, as before');
  assert(fu.includes('.eq("template_name", "request_followup_ar_v2")'),'today\'s template is still the default');
});
test('R39: a message prepared for everyone is read per client; its wording stays and it is never sent by the review',()=>{
  assert(fu.includes('.in("kind", ["request_followup", "property_sold", "new_listing"])'));
  const a=fu.slice(fu.indexOf('async function applyDecision('),fu.indexOf('let availableCache'));
  assert(a.includes('const mass = kind === "request" && ["property_sold", "new_listing"].includes(String(x.kind));'));
  assert(a.includes('update({ review_reason: reason, auto_ok: false, ...extra })'),'kept: only the reason and the stage are written');
  assert(a.includes('x.request_id && !mass'));
  const w=fu.slice(fu.indexOf('async function sendInWindow('),fu.indexOf('async function sendQueueText('));
  assert(w.includes('.eq("kind", "request_followup")')&&!w.includes('property_sold'));
  assert(approvals.includes("'<p class=\"rp-summary\">وضع العميل: '+esc(o.review_reason)+'</p>'"));
});
test('R38 in the review and in the agent: the same sentence from SQL97',()=>{
  assert(fu.includes('db.rpc("crm_unit_groups", { p_company: companyId })'));
  assert(fu.includes('وحدات انحجزت ولها وحدة متاحة من نفس المجموعة (R38)'));
  assert(agent.includes('{هذا العقار وحدة من مجموعة وحدات متشابهة'));
  assert(agent.includes('remainingIds.has(id)'));
});
