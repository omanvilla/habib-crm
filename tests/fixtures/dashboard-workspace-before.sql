-- Isolated synthetic full-catalog fixture only, after SQL18 and before SQL19.
CREATE TABLE test_dashboard_queue_before(actor uuid PRIMARY KEY,rows jsonb);
GRANT SELECT,INSERT ON test_dashboard_queue_before TO authenticated;
SET ROLE authenticated;
SELECT set_config('test.actor',test_id(10)::text,false);
INSERT INTO test_dashboard_queue_before SELECT auth.uid(),coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.client_id),'[]') FROM crm_client_contact_queue(2000) q;
SELECT set_config('test.actor',test_id(11)::text,false);
INSERT INTO test_dashboard_queue_before SELECT auth.uid(),coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.client_id),'[]') FROM crm_client_contact_queue(2000) q;
SELECT set_config('test.actor',test_id(12)::text,false);
INSERT INTO test_dashboard_queue_before SELECT auth.uid(),coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.client_id),'[]') FROM crm_client_contact_queue(2000) q;
SELECT set_config('test.actor',test_id(13)::text,false);
INSERT INTO test_dashboard_queue_before SELECT auth.uid(),coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.client_id),'[]') FROM crm_client_contact_queue(2000) q;
SELECT set_config('test.actor',test_id(14)::text,false);
INSERT INTO test_dashboard_queue_before SELECT auth.uid(),coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.client_id),'[]') FROM crm_client_contact_queue(2000) q;
SELECT set_config('test.actor',test_id(15)::text,false);
INSERT INTO test_dashboard_queue_before SELECT auth.uid(),coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.client_id),'[]') FROM crm_client_contact_queue(2000) q;
SELECT set_config('test.actor',test_id(16)::text,false);
INSERT INTO test_dashboard_queue_before SELECT auth.uid(),coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.client_id),'[]') FROM crm_client_contact_queue(2000) q;
RESET ROLE;
