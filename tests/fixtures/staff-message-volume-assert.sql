-- After SQL30 apply/reapply in the dedicated synthetic database.
RESET ROLE;
SELECT set_config('test.actor',test_id(10)::text,false);
SELECT test_reservation_assert(test_staff_volume30_business()=(SELECT value FROM test_staff_volume30 WHERE key='business_before'),
 'SQL30 and reapplication preserve every client, request, message and other business row');
SELECT test_reservation_assert(test_staff_volume30_security()=(SELECT value FROM test_staff_volume30 WHERE key='security_before'),
 'SQL30 changes no RLS policy, grants, other helper function, view or table security');
SELECT test_reservation_assert((SELECT jsonb_build_object('acl',proacl,'owner',proowner) FROM pg_proc WHERE oid='public.crm_employee_performance(date,date)'::regprocedure)
 =(SELECT value FROM test_staff_volume30 WHERE key='function_metadata_before'),
 'SQL30 preserves report ownership and execute grants');
SELECT test_reservation_assert((SELECT to_jsonb(definition)=(SELECT value FROM test_staff_volume30 WHERE key='function_before') FROM crm_repair_private.audit30_catalog_backup),
 'SQL30 repeated application preserves its exact original catalog backup');
SELECT test_reservation_assert(NOT has_table_privilege('authenticated','crm_repair_private.audit30_catalog_backup','SELECT')
 AND NOT has_table_privilege('anon','crm_repair_private.audit30_catalog_backup','SELECT'),
 'SQL30 catalog backup is inaccessible to application roles');
SET ROLE authenticated;
DO $$ DECLARE n integer;current_result jsonb;previous_result jsonb;baseline jsonb;e jsonb;previous_e jsonb;owner_result jsonb;
BEGIN
 SELECT value INTO owner_result FROM test_staff_volume30 WHERE key='before_10';
 FOREACH n IN ARRAY ARRAY[10,11,12,13] LOOP
  PERFORM set_config('test.actor',test_id(n)::text,false);
  current_result:=crm_employee_performance('2026-10-01','2026-11-01');
  SELECT value INTO previous_result FROM test_staff_volume30 WHERE key='before_'||n;
  SELECT value INTO baseline FROM test_staff_volume30 WHERE key='baseline_'||n;
  INSERT INTO test_staff_volume30 VALUES('after_'||n,current_result);
  PERFORM test_reservation_assert(test_staff_volume30_visibility()
   =(SELECT value FROM test_staff_volume30 WHERE key='visibility_before_'||n),
   'SQL30 preserves the exact visible clients, requests, conversations, messages, inquiries and attributions for '||n);
  IF n IN (10,13) THEN
   PERFORM test_reservation_assert(current_result=previous_result,'SQL30 preserves the complete owner/manager report for role '||n);
  ELSE
   PERFORM test_reservation_assert(jsonb_array_length(current_result->'employees')=1,'SQL30 exposes only the current employee row');
   e:=test_staff_volume30_metric(current_result,test_id(n));
   previous_e:=test_staff_volume30_metric(previous_result,test_id(n));
   PERFORM test_reservation_assert(e-'successful_staff_messages'=previous_e-'successful_staff_messages',
    'SQL30 changes only raw volume: inquiries, replies, targets and every other employee metric remain unchanged for '||n);
   PERFORM test_reservation_assert((e->>'successful_staff_messages')::int
    =(test_staff_volume30_metric(baseline,test_id(n))->>'successful_staff_messages')::int+CASE n WHEN 11 THEN 2 ELSE 3 END,
    'SQL30 counts exactly authorized successful manual messages, excluding failed/queued/automated/private/mismatched rows for '||n);
   PERFORM test_reservation_assert(e->'successful_staff_messages'=test_staff_volume30_metric(owner_result,test_id(n))->'successful_staff_messages',
    'SQL30 owner and self agree on the same authorized line message volume for '||n);
  END IF;
 END LOOP;
END $$;
SELECT set_config('test.actor',test_id(11)::text,false);
SELECT test_reservation_assert(EXISTS(SELECT 1 FROM whatsapp_messages WHERE id=test_id(30020))
 AND EXISTS(SELECT 1 FROM whatsapp_conversations WHERE id=test_id(30010)),
 'Muscat still reads its own-line message despite stale Barka conversation assignee');
SELECT test_reservation_assert(NOT EXISTS(SELECT 1 FROM clients WHERE id IN(test_id(30001),test_id(30002)))
 AND NOT EXISTS(SELECT 1 FROM property_inquiries WHERE id=test_id(30080)),
 'Raw message credit never exposes the opposite-primary/general client or this inquiry assigned to the other employee');
SELECT test_reservation_assert(NOT EXISTS(SELECT 1 FROM whatsapp_messages WHERE id IN(test_id(30021),test_id(30022),test_id(30024)))
 AND NOT EXISTS(SELECT 1 FROM whatsapp_conversations WHERE id IN(test_id(30011),test_id(30012),test_id(30016))),
 'Muscat cannot read the opposite line even when its primary client belongs to Muscat');
SELECT test_reservation_assert(NOT EXISTS(SELECT 1 FROM whatsapp_messages WHERE id IN(test_id(30033),test_id(30034),test_id(30035)))
 AND NOT EXISTS(SELECT 1 FROM client_requests WHERE id=test_id(30070))
 AND NOT EXISTS(SELECT 1 FROM whatsapp_conversations WHERE id IN(test_id(30014),test_id(30015))),
 'Private request on an ordinary line, investment line on an ordinary parent, and investor-linked ordinary line remain inaccessible');
SELECT set_config('test.actor',test_id(12)::text,false);
SELECT test_reservation_assert((SELECT count(*)=2 FROM whatsapp_messages WHERE id IN(test_id(30021),test_id(30022)))
 AND NOT EXISTS(SELECT 1 FROM clients WHERE id IN(test_id(30000),test_id(30002))),
 'Barka credits already-readable messages without exposing Muscat-primary or unassigned general client rows');
SELECT test_reservation_assert(NOT EXISTS(SELECT 1 FROM whatsapp_messages WHERE id=test_id(30020))
 AND NOT EXISTS(SELECT 1 FROM property_inquiries WHERE id=test_id(30080)),
 'Barka keeps the other-line message and other-branch property inquiry inaccessible');
SELECT set_config('test.actor',test_id(14)::text,false);
DO $$ BEGIN
 BEGIN PERFORM crm_employee_performance('2026-10-01','2026-11-01');RAISE EXCEPTION 'viewer unexpectedly allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
SELECT set_config('test.actor',test_id(15)::text,false);
DO $$ BEGIN
 BEGIN PERFORM crm_employee_performance('2026-10-01','2026-11-01');RAISE EXCEPTION 'inactive unexpectedly allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
SELECT set_config('test.actor',test_id(10)::text,false);
-- Negative control: removing only private message fixtures cannot alter any
-- team's result. The source fixture and all historical rows survive rollback.
BEGIN;
SET LOCAL session_replication_role=replica;
DELETE FROM whatsapp_messages WHERE id IN(test_id(30033),test_id(30034),test_id(30035));
SET LOCAL session_replication_role=origin;
SET LOCAL ROLE authenticated;
DO $$ DECLARE n integer;BEGIN
 FOREACH n IN ARRAY ARRAY[10,11,12,13] LOOP
  PERFORM set_config('test.actor',test_id(n)::text,true);
  PERFORM test_reservation_assert(crm_employee_performance('2026-10-01','2026-11-01')
   =(SELECT value FROM test_staff_volume30 WHERE key='after_'||n),'Removing private message evidence changes no team metric for role '||n);
 END LOOP;
END $$;
ROLLBACK;
RESET ROLE;
SELECT set_config('test.actor',test_id(10)::text,false);
SELECT test_reservation_assert(test_staff_volume30_business()=(SELECT value FROM test_staff_volume30 WHERE key='business_before'),
 'SQL30 read/negative-control tests leave the full synthetic business fingerprint intact');
SELECT 'SQL30 staff message scope acceptance passed' result;
