-- Isolated full-catalog fixture only. Run dashboard-performance-before.sql before SQL20.
-- All new records below are synthetic and confined to rolled-back transactions.
DO $$DECLARE saved record;actual jsonb;BEGIN
 FOR saved IN SELECT * FROM test_dashboard_performance_rows LOOP
  EXECUTE format('SELECT to_jsonb(x) FROM public.%I x WHERE id=$1',saved.table_name) INTO actual USING saved.id;
  PERFORM test_assert(actual IS NOT DISTINCT FROM saved.row_data,'SQL20 changed business row: '||saved.table_name);
 END LOOP;
 PERFORM test_assert((SELECT proacl::text IS NOT DISTINCT FROM b.acl AND proowner=b.owner_id FROM pg_proc p CROSS JOIN test_dashboard_performance_catalog b WHERE p.oid='public.crm_employee_performance(date,date)'::regprocedure),'KPI function ownership/ACL changed');
 PERFORM test_assert(NOT has_table_privilege('authenticated','crm_repair_private.dashboard_performance_backup_20261015','SELECT'),'catalog backup exposed');
END$$;
SET ROLE authenticated;
DO $$DECLARE n integer;before_json jsonb;after_json jsonb;before_metrics jsonb;after_metrics jsonb;BEGIN
 FOREACH n IN ARRAY ARRAY[11,12,13] LOOP
  PERFORM set_config('test.actor',test_id(n)::text,false);
  SELECT payload INTO before_json FROM test_dashboard_performance_before WHERE actor=n;
  after_json:=crm_employee_performance(NULL,'2027-01-01');
  SELECT jsonb_agg(value-'visit_to_sale' ORDER BY value->>'employee_id') INTO before_metrics FROM jsonb_array_elements(before_json->'employees');
  SELECT jsonb_agg(value-'visit_to_sale' ORDER BY value->>'employee_id') INTO after_metrics FROM jsonb_array_elements(after_json->'employees');
  PERFORM test_assert(before_json-'employees'=after_json-'employees' AND before_metrics=after_metrics,'ordinary branch/commission/other metric regression for role '||n);
 END LOOP;
 PERFORM set_config('test.actor',test_id(14)::text,false);
 BEGIN PERFORM crm_employee_performance(NULL,'2027-01-01');RAISE EXCEPTION 'viewer KPI access expanded';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END$$;
RESET ROLE;
SELECT set_config('test.actor','',false);

BEGIN;
SET LOCAL session_replication_role=replica;
INSERT INTO clients(id,company_id,assigned_to,name,client_type,lead_route)
SELECT test_id(n),test_id(1),test_id(11),'Synthetic conversion case '||n,'buyer','muscat' FROM generate_series(5000,5008)n;
INSERT INTO deals(id,company_id,client_id,property_id,agent_id,stage,closed_at,company_commission,company_share)
SELECT test_id(5100+n),test_id(1),test_id(5000+n),test_id(300),test_id(11),'closed',('2026-10-03'::date+n)::timestamp at time zone 'Asia/Muscat',100,100 FROM generate_series(0,5)n;
INSERT INTO deals(id,company_id,client_id,property_id,agent_id,stage,closed_at,company_commission,company_share)
VALUES(test_id(5106),test_id(1),test_id(5006),test_id(300),test_id(11),'closed','2026-10-31 20:00+00',100,100),
(test_id(5107),test_id(1),test_id(5007),test_id(300),test_id(11),'closed','2026-09-30 20:15+00',100,100),
(test_id(5108),test_id(1),test_id(5008),test_id(300),test_id(11),'closed','2026-10-10 00:00+00',100,100);
INSERT INTO client_requests(id,company_id,client_id,request_type,route_key,branch_key,assigned_to)
VALUES(test_id(5308),test_id(1),test_id(5008),'investor','investment','investment',test_id(10));
INSERT INTO viewings(id,company_id,client_id,property_id,agent_id,viewing_date,status,archived,request_id)
VALUES(test_id(5200),test_id(1),test_id(5000),test_id(300),test_id(11),'2026-08-25','done',false,NULL),
(test_id(5201),test_id(1),test_id(5000),test_id(300),test_id(11),'2026-09-20','done',false,NULL),
(test_id(5202),test_id(1),test_id(5002),test_id(300),test_id(11),'2026-09-20','scheduled',false,NULL),
(test_id(5203),test_id(1),test_id(5003),test_id(300),test_id(11),'2026-09-20','cancelled',false,NULL),
(test_id(5204),test_id(1),test_id(5004),test_id(300),test_id(11),'2026-09-20','done',true,NULL),
(test_id(5205),test_id(1),test_id(5005),test_id(300),test_id(11),'2026-10-09','done',false,NULL),
(test_id(5206),test_id(1),test_id(5006),test_id(300),test_id(11),'2026-09-20','done',false,NULL),
(test_id(5207),test_id(1),test_id(5007),test_id(300),test_id(11),'2026-09-30','done',false,NULL),
(test_id(5208),test_id(1),test_id(5008),test_id(300),test_id(11),'2026-09-20','done',false,test_id(5308));
-- Private request on a normal client/property must not enter owner TEAM metrics.
INSERT INTO deals(id,company_id,client_id,property_id,agent_id,request_id,stage,closed_at,company_commission,company_share)
VALUES(test_id(5110),test_id(1),test_id(5008),test_id(300),test_id(11),test_id(5308),'closed','2026-10-10',999999,999999);
SET LOCAL session_replication_role=origin;
SET LOCAL ROLE authenticated;
DO $$DECLARE n integer;e jsonb;BEGIN
 FOREACH n IN ARRAY ARRAY[10,11,13] LOOP
  PERFORM set_config('test.actor',test_id(n)::text,true);
  SELECT value INTO e FROM jsonb_array_elements(crm_employee_performance('2026-10-01','2026-11-01')->'employees') WHERE value->>'employee_id'=test_id(11)::text;
  PERFORM test_assert((e->>'sales')::int=8,'period sales changed/missed Oman boundary/private sale included for role '||n);
  PERFORM test_assert((e->>'visit_to_sale')::int=2,'prior-period, duplicate, unknown, future, cancelled, private or archived visit conversion wrong for role '||n);
  PERFORM test_assert(CASE WHEN n=13 THEN e->'company_commission'='null'::jsonb ELSE (e->>'company_commission')::numeric=800 END,'company commission amount/mask/private separation changed');
  SELECT value INTO e FROM jsonb_array_elements(crm_employee_performance('2026-10-01','2026-10-02')->'employees') WHERE value->>'employee_id'=test_id(11)::text;
  PERFORM test_assert((e->>'sales')::int=1 AND (e->>'visit_to_sale')::int=1,'Oman local first-day inclusion wrong');
  SELECT value INTO e FROM jsonb_array_elements(crm_employee_performance('2026-10-03','2026-10-04')->'employees') WHERE value->>'employee_id'=test_id(11)::text;
  PERFORM test_assert((e->>'sales')::int=1 AND (e->>'visit_to_sale')::int=1,'August completed visit did not count for October sale');
 END LOOP;
 PERFORM set_config('test.actor',test_id(12)::text,true);
 e:=crm_employee_performance('2026-10-01','2026-11-01')->'employees'->0;
 PERFORM test_assert((e->>'sales')::int=0 AND (e->>'visit_to_sale')::int=0,'Muscat work leaked to Barka');
END$$;
RESET ROLE;
ROLLBACK;

-- Negative control: remove all private evidence (synthetic rows only), and every
-- team metric, including owner, must remain byte-identical. No inference from labels.
BEGIN;
CREATE TEMP TABLE metric_private_rows(table_name text,id uuid);
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['clients','client_requests','properties','deals','viewings','property_inquiries','activities','whatsapp_messages','whatsapp_conversations'] LOOP
  EXECUTE format('INSERT INTO metric_private_rows SELECT %L,id FROM public.%I x WHERE crm_repair_private.investment_link_is_private(x.company_id,to_jsonb(x))',t,t);
 END LOOP;
END$$;
CREATE TEMP TABLE metric_with_private(actor integer,payload jsonb);
GRANT SELECT,INSERT ON metric_with_private TO authenticated;
SET LOCAL ROLE authenticated;
DO $$DECLARE n integer;BEGIN
 FOREACH n IN ARRAY ARRAY[10,11,12,13] LOOP
  PERFORM set_config('test.actor',test_id(n)::text,true);
  INSERT INTO metric_with_private VALUES(n,crm_employee_performance(NULL,'2027-01-01'));
 END LOOP;
END$$;
RESET ROLE;
SET LOCAL session_replication_role=replica;
DO $$DECLARE t text;BEGIN
 FOR t IN SELECT DISTINCT table_name FROM metric_private_rows LOOP
  EXECUTE format('DELETE FROM public.%I WHERE id IN(SELECT id FROM metric_private_rows WHERE table_name=$1)',t) USING t;
 END LOOP;
END$$;
SET LOCAL session_replication_role=origin;
SET LOCAL ROLE authenticated;
DO $$DECLARE n integer;BEGIN
 FOREACH n IN ARRAY ARRAY[10,11,12,13] LOOP
  PERFORM set_config('test.actor',test_id(n)::text,true);
  PERFORM test_assert(crm_employee_performance(NULL,'2027-01-01')=(SELECT payload FROM metric_with_private WHERE actor=n),'private work altered TEAM metrics for role '||n);
 END LOOP;
END$$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS sale-period conversions, prior visits, actual evidence, Oman dates, team/private separation, preserved finance/records/ACL' AS result;
