-- ISOLATED SYNTHETIC DATABASE ONLY. Run after the full fixture, SQL18 and core assertions.
-- Real invoker/definer RPCs execute as authenticated roles. Extra rows and the negative
-- control (removing private source rows) are confined to this rolled-back transaction.
BEGIN;
SET LOCAL session_replication_role=replica;
-- Deterministic business dates and attribution make exact metric assertions meaningful.
UPDATE companies SET created_at='2026-01-01' WHERE id=test_id(1);
UPDATE viewings SET created_at='2026-01-03';
UPDATE activities SET created_at='2026-01-04';
UPDATE deals SET created_at=coalesce(closed_at,'2026-01-04');
UPDATE properties SET created_at='2026-01-01';
UPDATE property_inquiries SET assigned_to=CASE WHEN property_id=test_id(301) THEN test_id(12) ELSE test_id(11) END;
-- Even a stale false inbox flag cannot expose the canonical investment route to managers.
UPDATE company_lead_routes SET owner_only_inbox=false WHERE id=test_id(22);
-- A normal Muscat property with a private investor owner is private through its FK.
INSERT INTO properties(id,company_id,title,branch_key,owner_client_id,sourced_by,added_by,area,price,status,created_at)
VALUES(test_id(303),test_id(1),'PRIVATE OWNER PROPERTY','muscat',test_id(102),test_id(11),test_id(11),'مسقط',100000,'available','2026-01-01');
-- An ordinary inquiry must not count an investor-only visit in its conversion numerator.
INSERT INTO client_requests(id,company_id,client_id,request_type,route_key,branch_key,assigned_to,created_at)
VALUES(test_id(208),test_id(1),test_id(103),'investor','investment','investment',test_id(11),'2026-01-01'),
(test_id(209),test_id(1),test_id(104),'investor','investment','investment',test_id(12),'2026-01-01');
INSERT INTO client_request_assignees(request_id,company_id,user_id,branch_key)
VALUES(test_id(208),test_id(1),test_id(11),'investment'),(test_id(209),test_id(1),test_id(12),'investment');
INSERT INTO property_inquiries(id,company_id,client_id,property_id,request_id,assigned_to,status,source,has_inbound_inquiry,first_inquiry_at,last_inquiry_at)
VALUES(test_id(1404),test_id(1),test_id(103),test_id(300),test_id(203),test_id(11),'inquiry','other',true,'2026-01-02','2026-01-02');
INSERT INTO viewings(id,company_id,client_id,property_id,agent_id,viewing_date,status,request_id,created_at)
VALUES(test_id(604),test_id(1),test_id(103),test_id(300),test_id(11),'2026-01-03','done',test_id(208),'2026-01-03'),
(test_id(605),test_id(1),test_id(104),test_id(301),test_id(12),'2026-01-03','done',test_id(204),'2026-01-03');
-- Conversely, a visible visit must not count an investor-only sale as its conversion.
INSERT INTO deals(id,company_id,client_id,property_id,agent_id,request_id,viewing_id,stage,closed_at,created_at,company_commission)
VALUES(test_id(804),test_id(1),test_id(104),test_id(301),test_id(12),test_id(209),test_id(605),'closed','2026-01-04','2026-01-04',999999);
INSERT INTO whatsapp_messages(id,company_id,conversation_id,client_id,request_id,whatsapp_message_id,direction,body,message_timestamp,actor_type,sent_by_user_id)
VALUES(test_id(505),test_id(1),test_id(403),NULL,NULL,'synthetic-rpc-private-outbound','outbound','PRIVATE RPC OUTBOUND','2026-01-04','human',test_id(12)),
(test_id(506),test_id(1),test_id(400),test_id(100),test_id(200),'synthetic-rpc-ordinary-outbound','outbound','Synthetic ordinary outbound','2026-01-04','human',test_id(11));
SET LOCAL session_replication_role=origin;

CREATE FUNCTION test_rpc_snapshot() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE kpi jsonb; result jsonb;
BEGIN
 IF public.my_role()='viewer' THEN
  BEGIN PERFORM crm_employee_performance(NULL,'2027-01-01'); RAISE EXCEPTION 'viewer KPI access unexpectedly expanded';
  EXCEPTION WHEN insufficient_privilege THEN kpi:='"denied"'::jsonb; END;
 ELSE
  kpi:=crm_employee_performance(NULL,'2027-01-01');
 END IF;
 SELECT jsonb_build_object(
  'kpi',kpi,
  'cohort',(SELECT jsonb_agg(to_jsonb(x) ORDER BY metric_order) FROM crm_funnel_cohort_metrics(test_id(2100)) x),
  'activity',(SELECT jsonb_agg(to_jsonb(x) ORDER BY metric_key) FROM crm_activity_metrics('2026-01-01','2026-01-31') x),
  'property_performance',(SELECT jsonb_agg(to_jsonb(x) ORDER BY property_id) FROM crm_property_performance(NULL,NULL,NULL) x),
  'property_funnel',crm_property_acquisition_funnel(NULL),
  'muscat360',crm_client_360(test_id(100)),
  'barka360',crm_client_360(test_id(101)),
  'mixed360',crm_client_360(test_id(106)),
  'legacy360',crm_client_360(test_id(103)),
  'private360',crm_client_360(test_id(102)),
  'deals',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]'::jsonb) FROM crm_deals_access x),
  'properties',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY id),'[]'::jsonb) FROM crm_properties_access x)
 ) INTO result;
 RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION test_rpc_snapshot() TO authenticated;
CREATE TEMP TABLE rpc_with_private(actor integer PRIMARY KEY,payload jsonb NOT NULL);
GRANT SELECT,INSERT ON rpc_with_private TO authenticated;
SET LOCAL ROLE authenticated;
DO $$DECLARE n integer; v jsonb; e jsonb; expected_requests integer;BEGIN
 FOREACH n IN ARRAY ARRAY[11,12,13,14] LOOP
  PERFORM set_config('test.actor',test_id(n)::text,true);
  v:=test_rpc_snapshot();
  INSERT INTO rpc_with_private VALUES(n,v);
  PERFORM test_assert(v::text NOT LIKE '%PRIVATE %','RPC/view sentinel leak for role '||n);
  PERFORM test_assert(NOT EXISTS(SELECT 1 FROM crm_properties_access WHERE id IN(test_id(302),test_id(303))),'property owner FK leaked through definer view');
  PERFORM test_assert(NOT EXISTS(SELECT 1 FROM crm_deals_access WHERE id IN(test_id(802),test_id(803),test_id(804))),'request-only private deal leaked through definer view');
  PERFORM test_assert((v->'mixed360'->'metrics'->>'requests_total')::int=0,'private request counted in ordinary parent 360');
  PERFORM test_assert((v->'mixed360'->'metrics'->>'closed_deals')::int=0,'private mixed-parent deal counted in 360');
  PERFORM test_assert(v->'mixed360'->'requests'='[]'::jsonb AND v->'mixed360'->'deals'='[]'::jsonb AND v->'mixed360'->'viewings'='[]'::jsonb AND v->'mixed360'->'appointments'='[]'::jsonb,'private mixed-parent arrays leaked');
  expected_requests:=CASE WHEN n IN(11,12) THEN 2 ELSE 4 END;
  PERFORM test_assert((SELECT metric_count FROM crm_funnel_cohort_metrics(test_id(2100)) WHERE metric_key='new_requests')=expected_requests,'private requests counted in funnel for role '||n);
  PERFORM test_assert((SELECT metric_count FROM crm_funnel_cohort_metrics(test_id(2100),'investment') WHERE metric_key='new_requests')=0,'explicit investment funnel filter bypass');
  PERFORM test_assert((SELECT metric_count FROM crm_activity_metrics('2026-01-01','2026-01-31') WHERE metric_key='qualified')=CASE WHEN n IN(11,12) THEN 1 ELSE 2 END,'private milestone counted in activity report');
  IF n<>14 THEN
   PERFORM test_assert((v->'kpi'->>'from')::date='2026-01-01','private 2020 sale leaked through KPI inception');
   PERFORM test_assert(jsonb_array_length(v->'kpi'->'employees')=CASE WHEN n=13 THEN 2 ELSE 1 END,'ordinary employee scope changed');
   FOR e IN SELECT value FROM jsonb_array_elements(v->'kpi'->'employees') LOOP
    PERFORM test_assert((e->>'sales')::int=1,'private deal counted in employee sales');
    PERFORM test_assert((e->>'active_inventory')::int=1,'private owner property counted in inventory');
    PERFORM test_assert((e->>'activities')::int=1,'private activity counted in KPI');
    PERFORM test_assert((e->>'visit_to_sale')::int=1,'nested private sale counted as visible visit conversion');
    PERFORM test_assert((e->>'inquiry_to_visit')::int=1,'nested private visit counted as visible inquiry conversion');
    IF e->>'employee_id'=test_id(11)::text THEN
     PERFORM test_assert((e->>'inquiries')::int=2 AND (e->>'visits_done')::int=1 AND (e->>'outbound_messages')::int=1,'Muscat ordinary KPI counts changed');
    ELSE
     PERFORM test_assert((e->>'inquiries')::int=1 AND (e->>'visits_done')::int=2 AND (e->>'outbound_messages')::int=0,'Barka ordinary KPI/private conversation counts changed');
    END IF;
    PERFORM test_assert(CASE WHEN n=13 THEN e->'company_commission'='null'::jsonb ELSE (e->>'company_commission')::numeric=1000 END,'ordinary commission mask changed/private finance leaked');
   END LOOP;
   PERFORM test_assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(crm_public_business_routes()) x WHERE x->>'route_key'='investment'),'stale owner_only flag exposed investment route');
  END IF;
 END LOOP;
 PERFORM set_config('test.actor',test_id(10)::text,true);
 v:=test_rpc_snapshot();
 INSERT INTO rpc_with_private VALUES(10,v);
 PERFORM test_assert((v->'kpi'->>'from')::date=CASE WHEN to_regclass('crm_repair_private.dashboard_performance_backup_20261015') IS NULL THEN '2020-01-04'::date ELSE '2026-01-01'::date END,'owner employee-report inception did not follow team/private scope');
 PERFORM test_assert((v->'mixed360'->'metrics'->>'requests_total')::int=1 AND (v->'mixed360'->'metrics'->>'closed_deals')::int=1,'owner mixed investment history missing');
 PERFORM test_assert((SELECT metric_count FROM crm_funnel_cohort_metrics(test_id(2100),'investment') WHERE metric_key='new_requests')=4,'owner investment funnel missing');
 PERFORM test_assert(EXISTS(SELECT 1 FROM crm_properties_access WHERE id=test_id(303)),'owner cannot view investor-owned property');
 PERFORM test_assert(EXISTS(SELECT 1 FROM jsonb_array_elements(crm_public_business_routes()) x WHERE x->>'route_key'='investment'),'owner investment route missing');
END $$;
RESET ROLE;
SELECT set_config('test.actor','',true);

-- Negative control: removing all known private input rows must leave every non-owner
-- result byte-for-byte identical, including counts, inception, nested arrays and views.
-- These are synthetic IDs only. Replication mode prevents test cleanup from changing
-- otherwise ordinary summaries through production triggers; transaction is rolled back.
SET LOCAL session_replication_role=replica;
DELETE FROM property_message_attributions WHERE id=test_id(2302);
DELETE FROM unmatched_property_links WHERE id=test_id(2262);
DELETE FROM property_inquiries WHERE id IN(test_id(1402),test_id(1403));
DELETE FROM appointment_properties WHERE id IN(test_id(1502),test_id(1503));
DELETE FROM client_request_events WHERE request_id IN(test_id(202),test_id(206),test_id(207),test_id(208),test_id(209),test_id(2501));
DELETE FROM deposits WHERE id IN(test_id(1602),test_id(1603));
DELETE FROM tasks WHERE id IN(test_id(902),test_id(903),test_id(904),test_id(905)) OR client_id=test_id(2500);
DELETE FROM activities WHERE id IN(test_id(1002),test_id(1003));
DELETE FROM deals WHERE id IN(test_id(802),test_id(803),test_id(804));
DELETE FROM viewings WHERE id IN(test_id(602),test_id(603),test_id(604));
DELETE FROM appointments WHERE id IN(test_id(702),test_id(703));
DELETE FROM whatsapp_messages WHERE id IN(test_id(502),test_id(503),test_id(504),test_id(505));
DELETE FROM whatsapp_conversations WHERE id IN(test_id(402),test_id(403),test_id(404));
DELETE FROM client_requests WHERE id IN(test_id(202),test_id(206),test_id(207),test_id(208),test_id(209),test_id(2501));
DELETE FROM clients WHERE id IN(test_id(102),test_id(2500));
DELETE FROM properties WHERE id IN(test_id(302),test_id(303));
SET LOCAL session_replication_role=origin;
SET LOCAL ROLE authenticated;
DO $$DECLARE n integer;v jsonb;BEGIN
 FOREACH n IN ARRAY ARRAY[11,12,13,14] LOOP
  PERFORM set_config('test.actor',test_id(n)::text,true);
  v:=test_rpc_snapshot();
  PERFORM test_assert(v IS NOT DISTINCT FROM (SELECT payload FROM rpc_with_private WHERE actor=n),'private source rows influenced non-owner RPC/view result for role '||n);
 END LOOP;
 PERFORM set_config('test.actor',test_id(10)::text,true);
 PERFORM test_assert(test_rpc_snapshot() IS DISTINCT FROM (SELECT payload FROM rpc_with_private WHERE actor=10),'owner negative-control source removal had no effect');
END $$;
RESET ROLE;
SELECT 'Investment RPC/view/KPI/funnel/client360/nested-conversion isolation and ordinary-result parity passed' AS result;
ROLLBACK;
