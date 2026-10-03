-- Owner-approved branch attribution and active inventory goal: 2026-10-01.
-- No deletion, date rewrite, deal/commission reassignment or automation.
CREATE TABLE IF NOT EXISTS crm_repair_private.branch_performance_owners (
 company_id uuid NOT NULL REFERENCES public.companies(id),
 branch_key text NOT NULL CHECK (branch_key IN ('muscat','barka')),
 employee_id uuid NOT NULL REFERENCES public.profiles(id),
 effective_from date NOT NULL,
 PRIMARY KEY(company_id,branch_key)
);
CREATE TABLE IF NOT EXISTS crm_repair_private.property_attribution_audit (
 change_key text NOT NULL,
 property_id uuid NOT NULL,
 company_id uuid NOT NULL,
 previous_sourced_by uuid,
 new_sourced_by uuid NOT NULL,
 original_created_at timestamptz,
 original_updated_at timestamptz,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(change_key,property_id)
);
ALTER TABLE crm_repair_private.branch_performance_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_repair_private.property_attribution_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_repair_private.branch_performance_owners,crm_repair_private.property_attribution_audit FROM PUBLIC,anon,authenticated;
DO $$
DECLARE company uuid; h uuid; m uuid;
BEGIN
 IF (SELECT count(*) FROM public.profiles WHERE is_active AND role='agent' AND lower(trim(full_name))='hadeel')<>1
 OR (SELECT count(*) FROM public.profiles WHERE is_active AND role='agent' AND lower(trim(full_name))='maram')<>1
 THEN RAISE EXCEPTION 'Unique active Hadeel and Maram required'; END IF;
 SELECT company_id,id INTO company,h FROM public.profiles WHERE is_active AND role='agent' AND lower(trim(full_name))='hadeel';
 SELECT id INTO m FROM public.profiles WHERE is_active AND role='agent' AND lower(trim(full_name))='maram' AND company_id=company;
 IF m IS NULL THEN RAISE EXCEPTION 'Employees must share company';END IF;
 INSERT INTO crm_repair_private.branch_performance_owners(company_id,branch_key,employee_id,effective_from)
 VALUES(company,'muscat',h,'2026-08-01'),(company,'barka',m,'2026-08-01')
 ON CONFLICT(company_id,branch_key) DO UPDATE SET employee_id=excluded.employee_id,effective_from=excluded.effective_from;
 INSERT INTO crm_repair_private.property_attribution_audit(change_key,property_id,company_id,previous_sourced_by,new_sourced_by,original_created_at,original_updated_at)
 SELECT 'owner_branch_attribution_20261001',p.id,p.company_id,p.sourced_by,o.employee_id,p.created_at,p.updated_at
 FROM public.properties p JOIN crm_repair_private.branch_performance_owners o USING(company_id,branch_key)
 WHERE p.sourced_by IS DISTINCT FROM o.employee_id ON CONFLICT DO NOTHING;
 UPDATE public.properties p SET sourced_by=o.employee_id
 FROM crm_repair_private.branch_performance_owners o
 WHERE p.company_id=o.company_id AND p.branch_key=o.branch_key AND p.sourced_by IS DISTINCT FROM o.employee_id;
 INSERT INTO public.employee_monthly_targets(company_id,employee_id,month_start,inventory_target)
 VALUES(company,h,'2026-10-01',10),(company,m,'2026-10-01',10)
 ON CONFLICT(company_id,employee_id,month_start) DO UPDATE SET inventory_target=10,updated_at=now();
END $$;
CREATE OR REPLACE FUNCTION crm_repair_private.apply_property_branch_employee()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE employee uuid;
BEGIN
 SELECT o.employee_id INTO employee FROM crm_repair_private.branch_performance_owners o
 JOIN public.profiles e ON e.id=o.employee_id AND e.company_id=o.company_id AND e.role='agent' AND e.is_active
 WHERE o.company_id=NEW.company_id AND o.branch_key=NEW.branch_key;
 IF employee IS NOT NULL THEN NEW.sourced_by:=employee;END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_repair_private.apply_property_branch_employee() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS zzzz_property_branch_employee ON public.properties;
CREATE TRIGGER zzzz_property_branch_employee BEFORE INSERT OR UPDATE ON public.properties
 FOR EACH ROW EXECUTE FUNCTION crm_repair_private.apply_property_branch_employee();
