-- Run after the disposable fixture and SQL17; every identifier/number is synthetic.
CREATE FUNCTION test_request(n int,area text DEFAULT NULL,manual_user int DEFAULT NULL,property_id int DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid:=test_id(n+300);
BEGIN
 INSERT INTO client_requests(id,company_id,client_id,origin_whatsapp_message_id,inbound_number,
   preferred_area,manual_assigned_to,subject_property_id,missing_required_fields)
 VALUES(v_id,test_id(1),test_id(n),test_id(n+200),CASE WHEN n=103 THEN '+96890000001' ELSE '+96890000002' END,
   area,CASE WHEN manual_user IS NULL THEN NULL ELSE test_id(manual_user) END,
   CASE WHEN property_id IS NULL THEN NULL ELSE test_id(property_id) END,CASE WHEN area IS NULL THEN ARRAY['location'] ELSE '{}'::text[] END);
 RETURN v_id;
END $$;
SELECT test_request(101),test_request(102),test_request(103),test_request(104,'الخوض'),
 test_request(105,'مسقط بركاء'),test_request(106,'الخوض',4),test_request(107),test_request(108,NULL,NULL,900);
-- A conflicting stored number cannot replace verified origin-conversation evidence.
UPDATE client_requests SET inbound_number='+96890000001',route_key='general' WHERE id=test_id(402);
DO $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM client_requests WHERE id=test_id(401) AND route_key='barka' AND branch_key='barka' AND assigned_to=test_id(3)) THEN RAISE EXCEPTION 'Barka contact assigned to wrong branch';END IF;
 IF NOT EXISTS(SELECT 1 FROM clients WHERE id=test_id(101) AND lead_route='barka' AND assigned_to=test_id(3)) THEN RAISE EXCEPTION 'Barka client summary missing';END IF;
 IF NOT EXISTS(SELECT 1 FROM client_request_assignees WHERE request_id=test_id(401) AND user_id=test_id(3) AND branch_key='barka') THEN RAISE EXCEPTION 'Barka assignee missing';END IF;
 IF NOT EXISTS(SELECT 1 FROM client_requests WHERE id=test_id(402) AND branch_key='barka' AND assigned_to=test_id(3)) THEN RAISE EXCEPTION 'origin overridden by stale number';END IF;
 IF NOT EXISTS(SELECT 1 FROM client_requests WHERE id=test_id(403) AND route_key='muscat' AND branch_key='muscat' AND assigned_to=test_id(2)) THEN RAISE EXCEPTION 'verified Muscat route downgraded';END IF;
 IF NOT EXISTS(SELECT 1 FROM client_requests WHERE id=test_id(404) AND branch_key='muscat' AND assigned_to=test_id(2)) THEN RAISE EXCEPTION 'explicit request geography overwritten';END IF;
 IF NOT EXISTS(SELECT 1 FROM whatsapp_conversations WHERE id=test_id(204) AND route_key='barka' AND assigned_to=test_id(3)) THEN RAISE EXCEPTION 'request assignment moved physical inbox';END IF;
 IF NOT EXISTS(SELECT 1 FROM client_requests WHERE id=test_id(405) AND route_key='general' AND branch_key='general') OR (SELECT count(*) FROM client_request_assignees WHERE request_id=test_id(405))<>2 THEN RAISE EXCEPTION 'multi-branch request lost a branch';END IF;
 IF NOT EXISTS(SELECT 1 FROM client_requests WHERE id=test_id(406) AND branch_key='muscat' AND assigned_to=test_id(4) AND manual_assigned_to=test_id(4)) THEN RAISE EXCEPTION 'manual assignee overwritten';END IF;
 IF NOT EXISTS(SELECT 1 FROM whatsapp_conversations WHERE id=test_id(206) AND route_key='barka' AND assigned_to=test_id(3)) THEN RAISE EXCEPTION 'manual request moved physical inbox';END IF;
 IF NOT EXISTS(SELECT 1 FROM client_requests WHERE id=test_id(408) AND route_key='general' AND assigned_to=test_id(2) AND subject_property_id=test_id(900)) THEN RAISE EXCEPTION 'property-specific unknown request force-routed by inbox';END IF;
 IF EXISTS(SELECT 1 FROM whatsapp_conversations WHERE (id<>test_id(203) AND assigned_to<>test_id(3)) OR (id=test_id(203) AND assigned_to<>test_id(2))) THEN RAISE EXCEPTION 'physical inbox assignments changed';END IF;
END$$;
-- Closing a request does not leave a live assignee or rewrite the inbox.
UPDATE client_requests SET status='cancelled' WHERE id=test_id(407);
DO $$BEGIN
 IF EXISTS(SELECT 1 FROM client_request_assignees WHERE request_id=test_id(407)) THEN RAISE EXCEPTION 'cancelled request kept active assignee';END IF;
 IF NOT EXISTS(SELECT 1 FROM whatsapp_conversations WHERE id=test_id(207) AND assigned_to=test_id(3)) THEN RAISE EXCEPTION 'cancelled request moved inbox';END IF;
 -- Missing/foreign origin rows never permit trusting the supplied number instead.
 IF crm_repair_private.whatsapp_request_physical_branch(test_id(1),test_id(101),test_id(303),'+96890000002') IS NOT NULL THEN RAISE EXCEPTION 'foreign-client origin accepted';END IF;
 IF crm_repair_private.whatsapp_request_physical_branch(test_id(999),test_id(101),test_id(301),'+96890000002') IS NOT NULL THEN RAISE EXCEPTION 'foreign-company origin accepted';END IF;
 IF crm_repair_private.whatsapp_request_physical_branch(test_id(1),test_id(101),test_id(999),'+96890000002') IS NOT NULL THEN RAISE EXCEPTION 'missing origin accepted';END IF;
 IF crm_repair_private.whatsapp_request_physical_branch(test_id(1),test_id(101),NULL,'96890000002') IS DISTINCT FROM 'barka' THEN RAISE EXCEPTION 'normalized number fallback failed';END IF;
END$$;
-- No origin: unique company office number is sufficient; empty legacy/manual behavior stays unchanged.
INSERT INTO client_requests(id,company_id,client_id,inbound_number,missing_required_fields)
 VALUES(test_id(409),test_id(1),test_id(109),'96890000002',ARRAY['location']),
 (test_id(410),test_id(1),test_id(110),NULL,ARRAY['location']);
DO $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM client_requests WHERE id=test_id(409) AND route_key='barka' AND branch_key='barka' AND assigned_to=test_id(3)) THEN RAISE EXCEPTION 'number-only Barka request failed';END IF;
 IF NOT EXISTS(SELECT 1 FROM client_requests WHERE id=test_id(410) AND route_key='general' AND branch_key='general' AND assigned_to=test_id(2)) THEN RAISE EXCEPTION 'unrelated legacy fallback changed';END IF;
END$$;
-- Duplicate office number or outbound-only origin is not evidence of an inbound branch.
UPDATE company_lead_routes SET whatsapp_number='+96890000002' WHERE route_key='muscat';
UPDATE whatsapp_messages SET direction='outbound' WHERE id=test_id(311);
DO $$BEGIN
 IF crm_repair_private.whatsapp_request_physical_branch(test_id(1),test_id(101),NULL,'96890000002') IS NOT NULL THEN RAISE EXCEPTION 'ambiguous office number guessed';END IF;
 IF crm_repair_private.whatsapp_request_physical_branch(test_id(1),test_id(111),test_id(311),'+96890000002') IS NOT NULL THEN RAISE EXCEPTION 'outbound origin accepted';END IF;
END$$;
UPDATE company_lead_routes SET whatsapp_number='+96890000001' WHERE route_key='muscat';
-- Inactive routes are not assignment evidence.
UPDATE company_lead_routes SET is_active=false WHERE route_key='barka';
DO $$BEGIN
 IF crm_repair_private.whatsapp_request_physical_branch(test_id(1),test_id(101),test_id(301),'+96890000002') IS NOT NULL THEN RAISE EXCEPTION 'inactive route accepted';END IF;
END$$;
UPDATE company_lead_routes SET is_active=true WHERE route_key='barka';
-- Catalog rollback evidence and API surface remain private.
DO $$BEGIN
 IF (SELECT count(*) FROM crm_repair_private.whatsapp_branch_catalog_backup)<>4 THEN RAISE EXCEPTION 'catalog before-images incomplete';END IF;
 IF NOT EXISTS(SELECT 1 FROM crm_repair_private.whatsapp_branch_catalog_backup WHERE object_identity='crm_refresh_client_primary_assignment(uuid,uuid)' AND definition LIKE '%update public.whatsapp_conversations%') THEN RAISE EXCEPTION 'original inbox mutation absent from backup';END IF;
 IF has_function_privilege('authenticated','crm_repair_private.whatsapp_request_physical_branch(uuid,uuid,uuid,text)','EXECUTE')
 OR has_function_privilege('anon','crm_repair_private.whatsapp_request_physical_branch(uuid,uuid,uuid,text)','EXECUTE')
 OR has_function_privilege('authenticated','crm_refresh_client_primary_assignment(uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'private routing API exposed';END IF;
 IF has_table_privilege('authenticated','crm_repair_private.whatsapp_branch_repair_audit','SELECT') OR has_table_privilege('anon','crm_repair_private.whatsapp_branch_catalog_backup','SELECT') THEN RAISE EXCEPTION 'private repair evidence exposed';END IF;
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='crm_repair_private' AND c.relname IN('whatsapp_branch_repair_audit','whatsapp_branch_catalog_backup') AND c.relrowsecurity)<>2 THEN RAISE EXCEPTION 'backup RLS absent';END IF;
END$$;
SET ROLE authenticated;
SELECT set_config('test.actor','00000000-0000-4000-8000-000000000003',false);
DO $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM clients WHERE id=test_id(101)) OR NOT EXISTS(SELECT 1 FROM client_requests WHERE id=test_id(401)) THEN RAISE EXCEPTION 'Barka client/request unavailable after routing';END IF;
 IF EXISTS(SELECT 1 FROM clients WHERE id=test_id(103)) OR EXISTS(SELECT 1 FROM whatsapp_conversations WHERE id=test_id(203)) THEN RAISE EXCEPTION 'Barka read leaked Muscat';END IF;
 BEGIN PERFORM crm_repair_private.whatsapp_request_physical_branch(test_id(1),test_id(101),test_id(301),NULL);RAISE EXCEPTION 'authenticated helper unexpectedly callable';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END$$;
SELECT set_config('test.actor','00000000-0000-4000-8000-000000000002',false);
DO $$BEGIN
 IF EXISTS(SELECT 1 FROM clients WHERE id=test_id(101)) OR EXISTS(SELECT 1 FROM client_requests WHERE id=test_id(401)) OR EXISTS(SELECT 1 FROM whatsapp_conversations WHERE id=test_id(201)) THEN RAISE EXCEPTION 'Muscat read leaked Barka';END IF;
 IF NOT EXISTS(SELECT 1 FROM clients WHERE id=test_id(103)) THEN RAISE EXCEPTION 'Muscat client unavailable';END IF;
END$$;
SELECT set_config('test.actor','00000000-0000-4000-8000-000000000004',false);
DO $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM clients WHERE id=test_id(101)) OR NOT EXISTS(SELECT 1 FROM clients WHERE id=test_id(103)) THEN RAISE EXCEPTION 'owner lost regional clients';END IF;
END$$;
RESET ROLE;
SELECT 'WhatsApp branch fallback assertions passed' AS result;

-- Backfill is exercised only in this disposable database.
-- Seed one old bad Barka summary plus manual, foreign-geography, multi-inbox,
-- business-history, legacy, archived, wrong-origin and property-bound exclusions.
INSERT INTO clients(id,company_id,assigned_to,lead_route,source,phone,archived)
 SELECT test_id(n),test_id(1),test_id(2),'muscat','whatsapp','+9689'||lpad(n::text,7,'0'),n=128
 FROM generate_series(121,130)n;
INSERT INTO whatsapp_conversations(id,company_id,client_id,assigned_to,route_key)
 SELECT test_id(n+100),test_id(1),test_id(n),test_id(3),'barka' FROM generate_series(121,130)n;
INSERT INTO whatsapp_conversations(id,company_id,client_id,assigned_to,route_key)
 VALUES(test_id(924),test_id(1),test_id(124),test_id(2),'muscat');
INSERT INTO whatsapp_messages(id,company_id,client_id,conversation_id)
 SELECT test_id(n+200),test_id(1),test_id(n),test_id(n+100) FROM generate_series(121,130)n;
ALTER TABLE client_requests DISABLE TRIGGER USER;
INSERT INTO client_requests(id,company_id,client_id,assigned_to,route_key,branch_key,origin_whatsapp_message_id,
 inbound_number,preferred_area,manual_assigned_to,created_via,subject_property_id)
 SELECT test_id(n+300),test_id(1),test_id(n),test_id(2),'general','general',
  test_id(CASE WHEN n=129 THEN 321 ELSE n+200 END),'+96890000002',CASE WHEN n=123 THEN 'الخوض' END,
  CASE WHEN n=122 THEN test_id(4) END,CASE WHEN n=127 THEN 'legacy' ELSE 'whatsapp' END,
  CASE WHEN n=130 THEN test_id(900) END
 FROM generate_series(121,130)n;
ALTER TABLE client_requests ENABLE TRIGGER USER;
INSERT INTO client_request_assignees(request_id,company_id,user_id,branch_key)
 SELECT test_id(n+300),test_id(1),test_id(2),'muscat' FROM generate_series(121,130)n;
INSERT INTO viewings(client_id) VALUES(test_id(125));
INSERT INTO deals(client_id) VALUES(test_id(126));
CREATE TEMP TABLE test_backfill_exclusions AS
 SELECT 'client' kind,c.id,to_jsonb(c) data FROM clients c WHERE id BETWEEN test_id(122) AND test_id(130)
 UNION ALL SELECT 'request',r.id,to_jsonb(r) FROM client_requests r WHERE client_id BETWEEN test_id(122) AND test_id(130);
CREATE TEMP TABLE test_inbox_snapshot AS SELECT id,to_jsonb(w) data FROM whatsapp_conversations w;
BEGIN;
SELECT set_config('crm.repair_company_id','00000000-0000-4000-8000-000000000001',true);
\ir ../../db/changes/17-whatsapp-branch-fallback.backfill.sql
DO $$BEGIN
 IF (SELECT count(*) FROM wa_branch_repair_candidates)<>1 OR NOT EXISTS(SELECT 1 FROM wa_branch_repair_candidates WHERE client_id=test_id(121)) THEN RAISE EXCEPTION 'unsafe or incomplete backfill scope';END IF;
 IF NOT EXISTS(SELECT 1 FROM clients WHERE id=test_id(121) AND lead_route='barka' AND assigned_to=test_id(3)) THEN RAISE EXCEPTION 'backfill did not repair client';END IF;
 IF NOT EXISTS(SELECT 1 FROM client_requests WHERE id=test_id(421) AND branch_key='barka' AND assigned_to=test_id(3)) THEN RAISE EXCEPTION 'backfill did not repair request';END IF;
 IF EXISTS(SELECT 1 FROM client_request_assignees WHERE request_id=test_id(421) AND user_id<>test_id(3)) THEN RAISE EXCEPTION 'backfill retained wrong request assignee';END IF;
 IF EXISTS(SELECT 1 FROM test_backfill_exclusions b JOIN clients c ON b.kind='client' AND c.id=b.id WHERE b.data<>to_jsonb(c))
 OR EXISTS(SELECT 1 FROM test_backfill_exclusions b JOIN client_requests r ON b.kind='request' AND r.id=b.id WHERE b.data<>to_jsonb(r))
 THEN RAISE EXCEPTION 'backfill changed excluded work';END IF;
 IF EXISTS(SELECT 1 FROM test_inbox_snapshot b JOIN whatsapp_conversations w ON w.id=b.id WHERE b.data<>to_jsonb(w)) THEN RAISE EXCEPTION 'backfill changed physical inbox';END IF;
 IF (SELECT count(*) FROM crm_repair_private.whatsapp_branch_repair_audit)<>1 OR NOT EXISTS(
  SELECT 1 FROM crm_repair_private.whatsapp_branch_repair_audit WHERE client_id=test_id(121)
   AND before_data->'client'->>'lead_route'='muscat' AND after_data->'client'->>'lead_route'='barka'
 ) THEN RAISE EXCEPTION 'backfill private snapshots missing';END IF;
END$$;
COMMIT;
-- A second execution converges to zero changes and preserves the first before-image.
BEGIN;
SELECT set_config('crm.repair_company_id','00000000-0000-4000-8000-000000000001',true);
\ir ../../db/changes/17-whatsapp-branch-fallback.backfill.sql
DO $$BEGIN
 IF EXISTS(SELECT 1 FROM wa_branch_repair_candidates) OR (SELECT count(*) FROM crm_repair_private.whatsapp_branch_repair_audit)<>1 THEN RAISE EXCEPTION 'backfill not idempotent';END IF;
END$$;
COMMIT;
SELECT 'WhatsApp safe backfill and idempotency assertions passed' AS result;


