DO $$BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL;END$$;
DO $$BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL;END$$;
CREATE SCHEMA crm_repair_private;
CREATE TABLE public.companies(id uuid PRIMARY KEY);
CREATE TABLE public.profiles(id uuid PRIMARY KEY,company_id uuid REFERENCES companies(id),full_name text,role text,is_active boolean);
CREATE TABLE public.properties(id uuid PRIMARY KEY,company_id uuid,branch_key text,sourced_by uuid,created_at timestamptz,updated_at timestamptz,status text,archived boolean);
CREATE TABLE public.employee_monthly_targets(company_id uuid,employee_id uuid,month_start date,inventory_target integer NOT NULL DEFAULT 10,updated_at timestamptz DEFAULT now(),PRIMARY KEY(company_id,employee_id,month_start));
INSERT INTO companies VALUES('00000000-0000-4000-8000-000000000001');
INSERT INTO profiles VALUES
('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','hadeel','agent',true),
('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','Maram','agent',true),
('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','Maram','agent',false);
INSERT INTO properties VALUES
('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000001','muscat',null,'2026-05-10','2026-05-11','available',false),
('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000001','barka','00000000-0000-4000-8000-000000000004','2026-06-10','2026-06-11','available',false),
('00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000001',null,null,'2026-07-10','2026-07-11','sold',true);
