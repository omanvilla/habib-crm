// SQL153 (Ahmed 21 Nov 2026): the buyer's one-page file. Nothing private reaches the page.
const test=require('node:test'),assert=require('node:assert'),fs=require('fs');
const read=p=>fs.readFileSync(p,'utf8');
const fwd=read('db/changes/153-property-buyer-file.forward.sql'),page=read('property-file.html'),ui=read('crm-property-file.js');
test('the migration copy matches and nothing is dropped',()=>{
  assert.equal(fwd,read('supabase/migrations/20261121130000_property_buyer_file_20261121.sql'));
  assert(!/DROP\s+TABLE|DELETE\s+FROM|DROP\s+COLUMN/i.test(fwd));
});
test('the public function returns no owner data, no plot number, no map pin, no owner net or commission',()=>{
  const pub=fwd.slice(fwd.indexOf('FUNCTION public.crm_property_file_public'));
  for(const bad of ['owner_client_id','owner_id','owner_net','expected_commission','plot','map_url','lockbox','visit_instructions','internal_name'])
    assert(!pub.includes(bad),bad);
  assert(fwd.includes('GRANT EXECUTE ON FUNCTION public.crm_property_file_public(text) TO anon, authenticated;'));
  assert(fwd.includes("p_token !~ '^[0-9a-f]{32}$'"));
});
test('only the owner and staff of that branch make a link; the rates are set by the monthly study only',()=>{
  assert(fwd.includes("public.my_role() not in ('owner', 'manager', 'agent')"));
  assert(fwd.includes('crm_repair_private.staff_can_access_branch(p.company_id, p.branch_key)'));
  assert(fwd.includes('REVOKE ALL ON FUNCTION public.crm_build_cost_rates_set(text, numeric, date) FROM public, anon, authenticated;'));
  assert(fwd.includes("('اقتصادي', 180), ('متوسط', 235), ('فاخر', 360)"));
});
test('the page reads only the public function and says the cost is an estimate',()=>{
  assert(page.includes('/rest/v1/rpc/crm_property_file_public'));
  assert(!/from\(|\/rest\/v1\/properties/.test(page));
  assert(page.includes('رقم تقريبي للمقارنة، مب تقييم معتمد'));
  assert(page.includes('<meta name="robots" content="noindex, nofollow">'));
});
test('the CRM card is on the property page for the owner and staff',()=>{
  assert(ui.includes("supa.rpc('crm_property_file_link'"));
  assert(ui.includes("['owner','manager','agent'].includes(p.role)"));
  assert(read('index.html').includes('crm-property-file.js?v=20261121-file1'));
});
