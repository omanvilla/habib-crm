
ALTER TABLE companies ADD created_at timestamptz DEFAULT '2026-05-06T15:00:00Z';
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.actor',true),'')::uuid$$;
CREATE FUNCTION public.my_company() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT '00000000-0000-4000-8000-000000000001'::uuid$$;
CREATE FUNCTION public.my_role() RETURNS text LANGUAGE sql STABLE AS $$SELECT current_setting('test.role',true)$$;
CREATE TABLE clients(id uuid PRIMARY KEY,company_id uuid,lead_route text);
CREATE TABLE property_inquiries(id uuid,company_id uuid,client_id uuid,property_id uuid,assigned_to uuid,has_inbound_inquiry boolean,first_inquiry_at timestamptz);
CREATE TABLE viewings(id uuid,company_id uuid,client_id uuid,property_id uuid,agent_id uuid,created_at timestamptz,viewing_date date,status text,archived boolean);
CREATE TABLE deals(id uuid,company_id uuid,client_id uuid,property_id uuid,agent_id uuid,stage text,closed_at timestamptz,company_commission numeric,company_share numeric);
CREATE TABLE activities(id uuid,company_id uuid,client_id uuid,property_id uuid,user_id uuid,actor_type text,channel text,created_at timestamptz,occurred_at timestamptz);
CREATE TABLE whatsapp_conversations(id uuid,company_id uuid,route_key text,client_id uuid);
CREATE TABLE whatsapp_messages(id uuid,company_id uuid,conversation_id uuid,client_id uuid,sent_by_user_id uuid,direction text,actor_type text,message_timestamp timestamptz);
ALTER TABLE employee_monthly_targets ADD new_properties_target int,ADD inquiries_target int,ADD visits_target int,ADD sold_target int,ADD commission_target numeric;
CREATE FUNCTION crm_repair_private.staff_can_access_branch(c uuid,b text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM crm_repair_private.branch_performance_owners o WHERE o.company_id=c AND o.branch_key=b AND o.employee_id=auth.uid())
$$;
CREATE FUNCTION crm_repair_private.can_access_client(c uuid,cl uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM public.clients cc WHERE cc.company_id=c AND cc.id=cl AND crm_repair_private.staff_can_access_branch(c,cc.lead_route))
$$;
CREATE FUNCTION crm_repair_private.can_access_whatsapp_conversation(c uuid,w uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM public.whatsapp_conversations wc WHERE wc.company_id=c AND wc.id=w AND crm_repair_private.staff_can_access_branch(c,wc.route_key))
$$;
INSERT INTO clients VALUES
('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000001','muscat'),
('00000000-0000-4000-8000-000000000202','00000000-0000-4000-8000-000000000001','barka');
INSERT INTO deals VALUES
('00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000202','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000002','closed','2026-08-10',40,40),
('00000000-0000-4000-8000-000000000302','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000003','closed','2026-09-10',60,60),
('00000000-0000-4000-8000-000000000303','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000202','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000002','closed','2026-07-10',20,20);
INSERT INTO property_inquiries VALUES
('00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000202','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000002',true,'2026-08-10'),
('00000000-0000-4000-8000-000000000402','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000003',false,'2026-09-10');
INSERT INTO viewings VALUES
('00000000-0000-4000-8000-000000000501','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000202','00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000002','2026-08-10','2026-08-12','done',false);
