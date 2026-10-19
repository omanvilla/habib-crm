-- Isolated synthetic catalog ONLY. Run after SQL27 has been applied twice.
RESET ROLE;
SELECT set_config('test.actor',test_id(10)::text,false);
SELECT test_reservation_assert(
 (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]'::jsonb) FROM properties p)
 =(SELECT value FROM test_inventory27 WHERE key='properties_before'),
 'inventory migration does not rewrite any existing property or verification timestamp');
SELECT test_reservation_assert(
 (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY employee_id,month_start),'[]'::jsonb) FROM employee_monthly_targets t)
 =(SELECT value FROM test_inventory27 WHERE key='targets_before'),
 'inventory migration preserves every saved employee goal');
SELECT test_reservation_assert(
 (SELECT to_jsonb(definition) FROM crm_repair_private.audit27_catalog_backup)
 =(SELECT value FROM test_inventory27 WHERE key='function_before'),
 'repeat application retains the exact predecessor function backup');
SELECT test_reservation_assert(NOT EXISTS(
 SELECT 1 FROM jsonb_array_elements(crm_employee_target_snapshot()->'employees') current_row
 FULL JOIN jsonb_array_elements((SELECT value->'employees' FROM test_inventory27 WHERE key='snapshot_before')) prior_row
 ON current_row->>'id'=prior_row->>'id'
 WHERE current_row-ARRAY['inventory','new_properties','inventory_property_ids','new_property_ids'] IS DISTINCT FROM prior_row-ARRAY['inventory','new_properties','inventory_property_ids','new_property_ids']),
 'the four other target metrics, saved goals and employee visibility are unchanged');
INSERT INTO test_inventory27 VALUES('baseline',crm_employee_target_snapshot());

-- Ordinary save leaves availability_checked_at NULL. Older and zero-price
-- available listings still belong to standing inventory, with no weekly credit.
INSERT INTO properties(id,company_id,added_by,title,type,area,price,branch_key,status,archived,created_at)
VALUES
 (test_id(9701),test_id(1),test_id(10),'Synthetic old zero-price Muscat','villa','Synthetic Muscat',0,'muscat','available',false,now()-interval '2 years'),
 (test_id(9702),test_id(1),test_id(10),'Synthetic old Barka','villa','Synthetic Barka',80000,'barka','available',false,now()-interval '2 years'),
 (test_id(9703),test_id(1),test_id(10),'Synthetic new Muscat','villa','Synthetic Muscat',80000,'muscat','available',false,now()),
 (test_id(9704),test_id(1),test_id(10),'Synthetic new Barka','villa','Synthetic Barka',80000,'barka','available',false,now()),
 (test_id(9705),test_id(1),test_id(10),'Synthetic archived available','villa','Synthetic Muscat',80000,'muscat','available',true,now());
-- None of these current non-available states belongs to standing inventory.
INSERT INTO properties(id,company_id,added_by,title,type,area,price,branch_key,status,created_at)
SELECT test_id(9710+n),test_id(1),test_id(10),'Synthetic excluded status '||state,'villa','Synthetic Muscat',80000,'muscat',state,now()-interval '2 years'
FROM (VALUES(0,'reserved'),(1,'deposit'),(2,'negotiating'),(3,'sold'),(4,'not_available'),(5,'withdrawn')) states(n,state);
INSERT INTO properties(id,company_id,added_by,title,type,area,price,branch_key,status,created_at,owner_client_id)
VALUES
 (test_id(9721),test_id(1),test_id(10),'Synthetic general branch','villa','Synthetic general',80000,'general','available',now(),NULL),
 (test_id(9722),test_id(1),test_id(10),'Synthetic private investment branch','villa','Synthetic investment',80000,'investment','available',now(),NULL),
 (test_id(9723),test_id(1),test_id(10),'Synthetic private investor linked ordinary branch','villa','Synthetic Muscat',80000,'muscat','available',now(),test_id(102)),
 (test_id(9724),test_id(1),test_id(10),'Synthetic new zero-price Muscat','villa','Synthetic Muscat',0,'muscat','available',now(),NULL);
SELECT set_config('test.actor',test_id(16)::text,false);
INSERT INTO properties(id,company_id,added_by,title,type,area,price,branch_key,status,created_at)
VALUES(test_id(9720),test_id(2),test_id(16),'Synthetic other company','villa','Synthetic Muscat',80000,'muscat','available',now());
SELECT set_config('test.actor',test_id(10)::text,false);
-- The Oman week begins Sunday at 00:00 (Saturday 20:00 UTC). Inventory has no
-- creation-date gate; additions exclude the previous second and the next day.
INSERT INTO properties(id,company_id,added_by,title,type,area,price,branch_key,status,created_at)
SELECT test_id(n),test_id(1),test_id(10),label,'villa','Synthetic Muscat',80000,'muscat','available',created
FROM test_inventory27 b CROSS JOIN LATERAL (VALUES
 (9725,'Synthetic before Oman week',((b.value->>'week_start')::date::timestamp AT TIME ZONE 'Asia/Muscat')-interval '1 microsecond'),
 (9726,'Synthetic Oman week boundary',(b.value->>'week_start')::date::timestamp AT TIME ZONE 'Asia/Muscat'),
 (9727,'Synthetic next Oman day',(((b.value->>'today')::date+1)::timestamp AT TIME ZONE 'Asia/Muscat'))
) cases(n,label,created) WHERE b.key='baseline';
SELECT test_reservation_assert(NOT EXISTS(SELECT 1 FROM properties WHERE id BETWEEN test_id(9701) AND test_id(9727) AND availability_checked_at IS NOT NULL),
 'synthetic ordinary saves never fabricate availability verification dates');
SET ROLE authenticated;
INSERT INTO test_inventory27 VALUES('owner_after',crm_employee_target_snapshot());
SELECT test_reservation_assert(NOT EXISTS(
 SELECT 1 FROM jsonb_array_elements((SELECT value->'employees' FROM test_inventory27 WHERE key='owner_after'))m
 WHERE (m->>'inventory')::int<>jsonb_array_length(m->'inventory_property_ids')
 OR (m->>'new_properties')::int<>jsonb_array_length(m->'new_property_ids')
 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(m->'inventory_property_ids') id GROUP BY id HAVING count(*)>1)
 OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(m->'new_property_ids') id GROUP BY id HAVING count(*)>1)),
 'both drilldown arrays have exactly their displayed count with unique IDs');
SELECT test_reservation_assert((SELECT
 m->'inventory_property_ids' @> to_jsonb(ARRAY[test_id(9701),test_id(9703),test_id(9724),test_id(9725),test_id(9726),test_id(9727)])
 AND m->'new_property_ids' @> to_jsonb(ARRAY[test_id(9703),test_id(9726)])
 AND NOT (m->'new_property_ids' ?| ARRAY[test_id(9701)::text,test_id(9724)::text,test_id(9725)::text,test_id(9727)::text])
 FROM jsonb_array_elements((SELECT value->'employees' FROM test_inventory27 WHERE key='owner_after'))m
 WHERE m->>'id'=test_id(11)::text),
 'Muscat drilldown IDs distinguish old/zero-price current inventory from Oman-week additions');
SELECT test_reservation_assert(NOT EXISTS(
 SELECT 1 FROM jsonb_array_elements((SELECT value->'employees' FROM test_inventory27 WHERE key='owner_after'))m
 CROSS JOIN LATERAL jsonb_array_elements_text((m->'inventory_property_ids')||(m->'new_property_ids')) ids(id)
 WHERE id::uuid IN(test_id(9705),test_id(9720),test_id(9721),test_id(9722),test_id(9723))
 OR (m->>'id'=test_id(11)::text AND id::uuid IN(test_id(9702),test_id(9704)))
 OR (m->>'id'=test_id(12)::text AND id::uuid IN(test_id(9701),test_id(9703),test_id(9724),test_id(9725),test_id(9726),test_id(9727)))),
 'owner drilldowns exclude archived, opposite-branch, general, other-company and private-investment linked IDs');
SELECT test_reservation_assert((SELECT
 (m->>'inventory')::int=(b->>'inventory')::int+6 AND (m->>'new_properties')::int=(b->>'new_properties')::int+2
 FROM jsonb_array_elements((SELECT value->'employees' FROM test_inventory27 WHERE key='owner_after')) m,
 jsonb_array_elements((SELECT value->'employees' FROM test_inventory27 WHERE key='baseline')) b
 WHERE m->>'id'=test_id(11)::text AND b->>'id'=m->>'id'),
 'Muscat standing inventory counts six unique available rows independent of date/price/verification; only two qualify this week');
SELECT test_reservation_assert((SELECT
 (m->>'inventory')::int=(b->>'inventory')::int+2 AND (m->>'new_properties')::int=(b->>'new_properties')::int+1
 FROM jsonb_array_elements((SELECT value->'employees' FROM test_inventory27 WHERE key='owner_after')) m,
 jsonb_array_elements((SELECT value->'employees' FROM test_inventory27 WHERE key='baseline')) b
 WHERE m->>'id'=test_id(12)::text AND b->>'id'=m->>'id'),
 'Barka has its own old/new properties without Muscat, general, private or other-company inflation');

SELECT set_config('test.actor',test_id(11)::text,false);
SELECT test_reservation_assert((SELECT jsonb_array_length(crm_employee_target_snapshot()->'employees')=1
 AND crm_employee_target_snapshot()->'employees'->0=(SELECT m FROM jsonb_array_elements(value->'employees')m WHERE m->>'id'=test_id(11)::text)
 FROM test_inventory27 WHERE key='owner_after'),
 'Muscat employee receives exactly her owner-visible target row and no Barka data');
SELECT set_config('test.actor',test_id(12)::text,false);
SELECT test_reservation_assert((SELECT jsonb_array_length(crm_employee_target_snapshot()->'employees')=1
 AND crm_employee_target_snapshot()->'employees'->0=(SELECT m FROM jsonb_array_elements(value->'employees')m WHERE m->>'id'=test_id(12)::text)
 FROM test_inventory27 WHERE key='owner_after'),
 'Barka employee receives exactly her owner-visible target row and no Muscat data');
SELECT set_config('test.actor',test_id(10)::text,false);
UPDATE properties SET status='sold' WHERE id=test_id(9703);
SELECT test_reservation_assert((SELECT
 (m->>'inventory')::int=(b->>'inventory')::int-1 AND m->'new_properties'=b->'new_properties'
 FROM jsonb_array_elements(crm_employee_target_snapshot()->'employees')m,
 jsonb_array_elements((SELECT value->'employees' FROM test_inventory27 WHERE key='owner_after'))b
 WHERE m->>'id'=test_id(11)::text AND b->>'id'=m->>'id'),
 'sale removes current availability but retains the same weekly addition credit');
SELECT test_reservation_assert((SELECT NOT (m->'inventory_property_ids' ? test_id(9703)::text)
 AND m->'new_property_ids' ? test_id(9703)::text
 FROM jsonb_array_elements(crm_employee_target_snapshot()->'employees')m WHERE m->>'id'=test_id(11)::text),
 'a sold listing remains only in its weekly additions drilldown');
UPDATE properties SET archived=true WHERE id=test_id(9703);
SELECT test_reservation_assert((SELECT
 (m->>'inventory')::int=(b->>'inventory')::int-1 AND (m->>'new_properties')::int=(b->>'new_properties')::int-1
 FROM jsonb_array_elements(crm_employee_target_snapshot()->'employees')m,
 jsonb_array_elements((SELECT value->'employees' FROM test_inventory27 WHERE key='owner_after'))b
 WHERE m->>'id'=test_id(11)::text AND b->>'id'=m->>'id'),
 'archiving excludes the listing from weekly additions without subtracting inventory twice');
UPDATE properties SET archived=false,status='available' WHERE id=test_id(9703);
SELECT test_reservation_assert(crm_employee_target_snapshot()=(SELECT value FROM test_inventory27 WHERE key='owner_after'),
 'restoring availability/archival state returns the same counts without duplicate credit');
UPDATE employee_monthly_targets SET inventory_target=0,weekly_new_properties_target=0
 WHERE company_id=test_id(1) AND employee_id=test_id(11) AND month_start=date_trunc('month',now() AT TIME ZONE 'Asia/Muscat')::date;
SELECT test_reservation_assert((SELECT (m#>>'{goals,inventory}')::int=0 AND (m#>>'{goals,new_properties}')::int=0
 FROM jsonb_array_elements(crm_employee_target_snapshot()->'employees')m WHERE m->>'id'=test_id(11)::text),
 'explicit zero inventory and weekly goals remain paused, not replaced by defaults');
DO $$ BEGIN
 BEGIN PERFORM * FROM crm_repair_private.audit27_catalog_backup; RAISE EXCEPTION 'private catalog backup became readable';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
SELECT set_config('test.actor',test_id(15)::text,false);
DO $$ BEGIN
 BEGIN PERFORM crm_employee_target_snapshot(); RAISE EXCEPTION 'inactive actor accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
SELECT set_config('test.actor',test_id(14)::text,false);
DO $$ BEGIN
 BEGIN PERFORM crm_employee_target_snapshot(); RAISE EXCEPTION 'viewer accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
SELECT set_config('test.actor',test_id(10)::text,false);
INSERT INTO test_inventory27 SELECT 'properties_after',coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]'::jsonb) FROM properties p;
INSERT INTO test_inventory27 SELECT 'targets_after',coalesce(jsonb_agg(to_jsonb(t) ORDER BY employee_id,month_start),'[]'::jsonb) FROM employee_monthly_targets t;
SELECT 'inventory goal source acceptance passed' result;
