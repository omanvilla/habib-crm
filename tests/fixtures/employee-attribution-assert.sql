DO $$
BEGIN
 IF (SELECT count(*) FROM crm_repair_private.property_attribution_audit)<>2 THEN RAISE EXCEPTION 'audit count';END IF;
 IF (SELECT count(*) FROM public.properties p JOIN crm_repair_private.branch_performance_owners o USING(company_id,branch_key) WHERE p.sourced_by=o.employee_id)<>2 THEN RAISE EXCEPTION 'backfill';END IF;
 IF (SELECT count(*) FROM public.employee_monthly_targets WHERE inventory_target=10)<>2 THEN RAISE EXCEPTION 'targets';END IF;
 IF EXISTS(SELECT 1 FROM public.properties p JOIN crm_repair_private.property_attribution_audit a ON p.id=a.property_id WHERE p.created_at IS DISTINCT FROM a.original_created_at OR p.updated_at IS DISTINCT FROM a.original_updated_at) THEN RAISE EXCEPTION 'dates changed';END IF;
 IF EXISTS(SELECT 1 FROM public.properties WHERE branch_key IS NULL AND sourced_by IS NOT NULL) THEN RAISE EXCEPTION 'unclassified assigned';END IF;
 IF has_function_privilege('authenticated','crm_repair_private.apply_property_branch_employee()','EXECUTE') OR has_table_privilege('authenticated','crm_repair_private.property_attribution_audit','SELECT') THEN RAISE EXCEPTION 'private permissions';END IF;
END $$;
INSERT INTO properties VALUES('00000000-0000-4000-8000-000000000104','00000000-0000-4000-8000-000000000001','barka',null,'2026-10-01','2026-10-01','available',false);
DO $$ BEGIN
IF (SELECT sourced_by FROM properties WHERE id='00000000-0000-4000-8000-000000000104') IS DISTINCT FROM '00000000-0000-4000-8000-000000000003'::uuid THEN RAISE EXCEPTION 'future insert';END IF;
END $$;
UPDATE properties SET branch_key='muscat' WHERE id='00000000-0000-4000-8000-000000000104';
DO $$ BEGIN
IF (SELECT sourced_by FROM properties WHERE id='00000000-0000-4000-8000-000000000104') IS DISTINCT FROM '00000000-0000-4000-8000-000000000002'::uuid THEN RAISE EXCEPTION 'branch update';END IF;
END $$;
SELECT 'PASS attribution, private audit, dates, targets, new-property insert and branch update' AS result;
