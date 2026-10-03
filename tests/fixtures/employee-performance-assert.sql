
SELECT set_config('test.actor','00000000-0000-4000-8000-000000000003',false);
SELECT set_config('test.role','agent',false);
SET ROLE authenticated;
DO $$ DECLARE result jsonb; e jsonb; BEGIN
 result:=public.crm_employee_performance(NULL,'2026-10-02');
 IF result->>'from'<>'2026-05-06' THEN RAISE EXCEPTION 'inception';END IF;
 IF jsonb_array_length(result->'employees')<>1 THEN RAISE EXCEPTION 'other employee leaked';END IF;
 e:=result->'employees'->0;
 IF e->>'employee_id'<>'00000000-0000-4000-8000-000000000003' OR (e->>'sales')::int<>1 OR (e->>'company_commission')::numeric<>40 THEN RAISE EXCEPTION 'own commission/branch credit %',e;END IF;
 IF (e->>'inquiries')::int<>1 OR (e->>'visits_done')::int<>1 THEN RAISE EXCEPTION 'branch attribution';END IF;
END $$;
RESET ROLE;
SELECT set_config('test.actor','00000000-0000-4000-8000-000000000002',false);
SET ROLE authenticated;
DO $$ DECLARE e jsonb; BEGIN
 e:=public.crm_employee_performance(NULL,'2026-10-02')->'employees'->0;
 IF (e->>'company_commission')::numeric<>60 OR (e->>'sales')::int<>1 OR (e->>'inquiries')::int<>0 THEN RAISE EXCEPTION 'Muscat own scope %',e;END IF;
END $$;
RESET ROLE;
SELECT set_config('test.role','owner',false);
DO $$ DECLARE r jsonb;e jsonb;BEGIN
 r:=public.crm_employee_performance(NULL,'2026-10-02');
 IF jsonb_array_length(r->'employees')<>2 THEN RAISE EXCEPTION 'owner employees';END IF;
 SELECT value INTO e FROM jsonb_array_elements(r->'employees') WHERE value->>'employee_id'='00000000-0000-4000-8000-000000000002';
 IF (e->>'company_commission')::numeric<>80 THEN RAISE EXCEPTION 'pre-August original attribution';END IF;
 IF EXISTS(SELECT 1 FROM deals WHERE id='00000000-0000-4000-8000-000000000301' AND agent_id<>'00000000-0000-4000-8000-000000000002') THEN RAISE EXCEPTION 'source actor rewritten';END IF;
END $$;
SELECT set_config('test.role','viewer',false);
SET ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.crm_employee_performance(NULL,'2026-10-02');RAISE EXCEPTION 'viewer unexpectedly allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
SELECT 'PASS lifetime, August cutoff, preserved actors, own commission and denied viewer (synthetic DB policies)' AS result;

-- Historical imports predate the technical company record without fake visits.
INSERT INTO deals VALUES
('00000000-0000-4000-8000-000000000304','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000202','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000003','commission_collected','2020-04-05',11,11),
('00000000-0000-4000-8000-000000000305','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000002','closed','2022-07-08',13,13);
SELECT set_config('test.role','owner',false);
DO $$DECLARE r jsonb;BEGIN
 r:=public.crm_employee_performance(NULL,'2026-10-02');
 IF r->>'from'<>'2020-04-05' THEN RAISE EXCEPTION 'historical lifetime clipped to company technical creation';END IF;
 IF (SELECT sum((x->>'sales')::int) FROM jsonb_array_elements(r->'employees') x)<>5 THEN RAISE EXCEPTION 'historical sales missing';END IF;
END$$;
SELECT set_config('test.actor','00000000-0000-4000-8000-000000000002',false);
SELECT set_config('test.role','agent',false);
SET ROLE authenticated;
DO $$DECLARE r jsonb;BEGIN
 r:=public.crm_employee_performance(NULL,'2026-10-02');
 IF r->>'from'<>'2022-07-08' OR (r->'employees'->0->>'sales')::int<>2 THEN RAISE EXCEPTION 'staff historical scope';END IF;
END$$;
RESET ROLE;
SELECT 'PASS historical 2020/2022 sales included without creating visits or leaking other-branch history' AS result;
