-- Synthetic isolated PostgreSQL fixture. Core columns/checks and scoped policies captured 2026-10-02.
-- Unrelated automation, customer messaging and deal-generation triggers are intentionally absent.
DO $$BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL;END$$;
DO $$BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL;END$$;
CREATE SCHEMA auth; CREATE SCHEMA crm_repair_private;

CREATE TABLE companies(id uuid PRIMARY KEY);
CREATE TABLE profiles(id uuid PRIMARY KEY,company_id uuid,role text,is_active boolean);
CREATE TABLE company_lead_routes(company_id uuid,route_key text,assigned_to uuid,is_active boolean DEFAULT true,owner_only_inbox boolean DEFAULT false);
CREATE TABLE client_request_assignees(company_id uuid,request_id uuid,user_id uuid,branch_key text);
CREATE TABLE deals(id uuid PRIMARY KEY,company_id uuid,client_id uuid,property_id uuid);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.actor',true),'')::uuid$$;
CREATE FUNCTION my_company() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$SELECT p.company_id FROM public.profiles p WHERE p.id=auth.uid() AND p.is_active$$;
CREATE FUNCTION my_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$SELECT p.role FROM public.profiles p WHERE p.id=auth.uid() AND p.is_active$$;

CREATE TABLE clients(
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  assigned_to uuid,
  name text NOT NULL,
  phone text,
  email text,
  client_type text,
  source text,
  preferred_area text,
  property_type text,
  budget_min numeric(12,2),
  budget_max numeric(12,2),
  status text DEFAULT 'warm'::text,
  notes text,
  last_contact_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  is_buyer boolean DEFAULT false,
  is_seller boolean DEFAULT false,
  is_investor boolean DEFAULT false,
  importance integer,
  readiness integer,
  tags text[],
  archived boolean DEFAULT false,
  archived_at timestamp with time zone,
  archived_by uuid,
  pipeline_stage text DEFAULT 'new'::text,
  payment_method text,
  purchase_timing text,
  purpose text,
  nationality text,
  country text,
  wilayat text,
  lead_score integer DEFAULT 50,
  lead_temperature text DEFAULT 'warm'::text,
  next_followup date,
  lead_route text,
  inbound_number text,
  phone_normalized text,
  human_contact_at timestamp with time zone,
  followup_suppressed boolean NOT NULL DEFAULT false,
  followup_suppressed_reason text,
  followup_suppressed_at timestamp with time zone,
  followup_suppressed_by uuid,
  last_ai_profile jsonb,
  last_ai_profile_at timestamp with time zone,
  instagram_participant_id text
);

ALTER TABLE clients ADD CONSTRAINT clients_client_type_check CHECK ((client_type = ANY (ARRAY['buyer'::text, 'seller'::text, 'investor'::text, 'tenant'::text, 'landlord'::text, 'consultation'::text])));

ALTER TABLE clients ADD CONSTRAINT clients_pkey PRIMARY KEY (id);

ALTER TABLE clients ADD CONSTRAINT clients_status_check CHECK ((status = ANY (ARRAY['hot'::text, 'warm'::text, 'cold'::text, 'inactive'::text])));

ALTER TABLE clients ADD CONSTRAINT crm_clients_budget_valid CHECK ((((budget_min IS NULL) OR (budget_min >= (0)::numeric)) AND ((budget_max IS NULL) OR (budget_max >= (0)::numeric)) AND ((budget_min IS NULL) OR (budget_max IS NULL) OR (budget_min <= budget_max))));

CREATE TABLE properties(
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  added_by uuid,
  title text NOT NULL,
  type text,
  area text NOT NULL,
  price numeric(12,2) NOT NULL,
  bedrooms integer,
  bathrooms integer,
  land_size numeric(10,2),
  built_size numeric(10,2),
  status text DEFAULT 'available'::text,
  description text,
  images text[],
  views_count integer DEFAULT 0,
  inquiries_count integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  owner_client_id uuid,
  archived boolean DEFAULT false,
  archived_at timestamp with time zone,
  archived_by uuid,
  owner_id uuid,
  owner_net numeric(12,2),
  wilayat text,
  source_type text DEFAULT 'owner'::text,
  marketing_status text DEFAULT 'ready_to_advertise'::text,
  expected_commission numeric(12,2),
  property_code text,
  internal_name text,
  branch_key text,
  availability_checked_at timestamp with time zone,
  performance_tracking_started_at timestamp with time zone NOT NULL DEFAULT now(),
  photography_status text NOT NULL DEFAULT 'unknown'::text,
  photography_reason text,
  photography_required_at timestamp with time zone,
  photography_completed_at timestamp with time zone,
  marketing_review_status text NOT NULL DEFAULT 'healthy'::text,
  marketing_reviewed_at timestamp with time zone,
  marketing_review_note text,
  last_ai_recommendation jsonb,
  last_ai_recommendation_at timestamp with time zone,
  public_details text,
  map_url text,
  has_listing_agreement boolean NOT NULL DEFAULT false,
  agreement_start_date date,
  agreement_duration_months integer,
  agreement_end_date date,
  agreement_reminder_days integer,
  sourced_by uuid
);

ALTER TABLE properties ADD CONSTRAINT crm_properties_numbers_valid CHECK ((((price IS NULL) OR (price >= (0)::numeric)) AND ((owner_net IS NULL) OR (owner_net >= (0)::numeric)) AND ((land_size IS NULL) OR (land_size >= (0)::numeric)) AND ((built_size IS NULL) OR (built_size >= (0)::numeric)) AND ((bedrooms IS NULL) OR (bedrooms >= 0)) AND ((bathrooms IS NULL) OR (bathrooms >= 0))));

ALTER TABLE properties ADD CONSTRAINT properties_agreement_duration_months_check CHECK (((agreement_duration_months IS NULL) OR ((agreement_duration_months >= 1) AND (agreement_duration_months <= 60))));

ALTER TABLE properties ADD CONSTRAINT properties_agreement_reminder_days_check CHECK (((agreement_reminder_days IS NULL) OR ((agreement_reminder_days >= 1) AND (agreement_reminder_days <= 90))));

ALTER TABLE properties ADD CONSTRAINT properties_branch_key_check CHECK (((branch_key IS NULL) OR (branch_key = ANY (ARRAY['muscat'::text, 'barka'::text, 'investment'::text, 'general'::text]))));

ALTER TABLE properties ADD CONSTRAINT properties_marketing_review_status_chk CHECK ((marketing_review_status = ANY (ARRAY['healthy'::text, 'pending'::text, 'reviewing'::text, 'actioned'::text])));

ALTER TABLE properties ADD CONSTRAINT properties_photography_status_chk CHECK ((photography_status = ANY (ARRAY['unknown'::text, 'needs_initial'::text, 'scheduled'::text, 'completed'::text, 'needs_refresh'::text, 'not_required'::text])));

ALTER TABLE properties ADD CONSTRAINT properties_pkey PRIMARY KEY (id);

ALTER TABLE properties ADD CONSTRAINT properties_status_check CHECK ((status = ANY (ARRAY['available'::text, 'reserved'::text, 'deposit'::text, 'negotiating'::text, 'sold'::text, 'not_available'::text, 'withdrawn'::text])));

ALTER TABLE properties ADD CONSTRAINT properties_type_check CHECK ((type = ANY (ARRAY['villa'::text, 'house'::text, 'twin_villa'::text, 'townhouse'::text, 'apartment'::text, 'penthouse'::text, 'building'::text, 'residential_building'::text, 'commercial_building'::text, 'income_property'::text, 'land'::text, 'land_residential'::text, 'land_commercial'::text, 'land_mixed'::text, 'farm'::text, 'resthouse'::text, 'chalet'::text, 'office'::text, 'shop'::text, 'warehouse'::text])));

CREATE TABLE client_requests(
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  client_id uuid NOT NULL,
  request_type text NOT NULL,
  property_type text,
  property_types text[] NOT NULL DEFAULT '{}'::text[],
  preferred_area text,
  preferred_areas text[] NOT NULL DEFAULT '{}'::text[],
  wilayat text,
  budget_min numeric,
  budget_max numeric,
  payment_method text,
  purchase_timing text,
  purpose text,
  bedrooms_min integer,
  bathrooms_min integer,
  land_size_min numeric,
  land_size_max numeric,
  built_size_min numeric,
  built_size_max numeric,
  furnished boolean,
  status text NOT NULL DEFAULT 'active'::text,
  pipeline_stage text NOT NULL DEFAULT 'new'::text,
  priority smallint NOT NULL DEFAULT 2,
  next_followup date,
  followup_note text,
  last_contact_at timestamp with time zone,
  source text,
  source_detail text,
  assigned_to uuid,
  route_key text,
  inbound_number text,
  subject_property_id uuid,
  created_via text NOT NULL DEFAULT 'manual'::text,
  origin_whatsapp_message_id uuid,
  ai_confidence numeric,
  needs_human_review boolean NOT NULL DEFAULT false,
  ai_extracted jsonb,
  lead_score integer NOT NULL DEFAULT 20,
  lead_temperature text NOT NULL DEFAULT 'cold'::text,
  notes text,
  closed_reason text,
  closed_at timestamp with time zone,
  created_by uuid,
  updated_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  branch_key text,
  alternative_areas text[] NOT NULL DEFAULT '{}'::text[],
  financing_readiness text,
  must_haves text[] NOT NULL DEFAULT '{}'::text[],
  flexible_preferences text[] NOT NULL DEFAULT '{}'::text[],
  decision_maker_status text,
  search_status text NOT NULL DEFAULT 'unknown'::text,
  next_action text,
  is_first_request boolean,
  first_human_response_at timestamp with time zone,
  first_mutual_dialogue_at timestamp with time zone,
  requirements_completed_at timestamp with time zone,
  qualified_at timestamp with time zone,
  first_match_sent_at timestamp with time zone,
  first_appointment_booked_at timestamp with time zone,
  first_appointment_confirmed_at timestamp with time zone,
  first_attended_at timestamp with time zone,
  serious_interest_at timestamp with time zone,
  opportunity_opened_at timestamp with time zone,
  negotiation_started_at timestamp with time zone,
  deposit_paid_at timestamp with time zone,
  contract_completed_at timestamp with time zone,
  closed_won_at timestamp with time zone,
  last_mutual_contact_at timestamp with time zone,
  missing_required_fields text[] NOT NULL DEFAULT '{}'::text[],
  last_requirements_prompt_at timestamp with time zone,
  last_requirements_prompt_fields text[] NOT NULL DEFAULT '{}'::text[],
  requirements_prompt_count integer NOT NULL DEFAULT 0,
  manual_assigned_to uuid
);

ALTER TABLE client_requests ADD CONSTRAINT client_requests_ai_confidence_check CHECK (((ai_confidence IS NULL) OR ((ai_confidence >= (0)::numeric) AND (ai_confidence <= (1)::numeric))));

ALTER TABLE client_requests ADD CONSTRAINT client_requests_bathrooms_min_check CHECK (((bathrooms_min IS NULL) OR (bathrooms_min >= 0)));

ALTER TABLE client_requests ADD CONSTRAINT client_requests_bedrooms_min_check CHECK (((bedrooms_min IS NULL) OR (bedrooms_min >= 0)));

ALTER TABLE client_requests ADD CONSTRAINT client_requests_branch_key_check CHECK (((branch_key IS NULL) OR (branch_key = ANY (ARRAY['muscat'::text, 'barka'::text, 'investment'::text, 'general'::text]))));

ALTER TABLE client_requests ADD CONSTRAINT client_requests_budget_max_check CHECK (((budget_max IS NULL) OR (budget_max >= (0)::numeric)));

ALTER TABLE client_requests ADD CONSTRAINT client_requests_budget_min_check CHECK (((budget_min IS NULL) OR (budget_min >= (0)::numeric)));

ALTER TABLE client_requests ADD CONSTRAINT client_requests_budget_pair_check CHECK (((budget_min IS NULL) OR (budget_max IS NULL) OR (budget_min <= budget_max)));

ALTER TABLE client_requests ADD CONSTRAINT client_requests_built_size_max_check CHECK (((built_size_max IS NULL) OR (built_size_max >= (0)::numeric)));

ALTER TABLE client_requests ADD CONSTRAINT client_requests_built_size_min_check CHECK (((built_size_min IS NULL) OR (built_size_min >= (0)::numeric)));

ALTER TABLE client_requests ADD CONSTRAINT client_requests_built_size_pair_check CHECK (((built_size_min IS NULL) OR (built_size_max IS NULL) OR (built_size_min <= built_size_max)));

ALTER TABLE client_requests ADD CONSTRAINT client_requests_created_via_check CHECK ((created_via = ANY (ARRAY['manual'::text, 'website'::text, 'whatsapp'::text, 'legacy'::text, 'import'::text, 'ai'::text])));

ALTER TABLE client_requests ADD CONSTRAINT client_requests_decision_maker_status_check CHECK (((decision_maker_status IS NULL) OR (decision_maker_status = ANY (ARRAY['self'::text, 'joint_family'::text, 'not_decision_maker'::text, 'unknown'::text]))));

ALTER TABLE client_requests ADD CONSTRAINT client_requests_financing_readiness_check CHECK (((financing_readiness IS NULL) OR (financing_readiness = ANY (ARRAY['cash_confirmed'::text, 'preapproved'::text, 'in_progress'::text, 'not_started'::text, 'rejected'::text, 'unknown'::text]))));

ALTER TABLE client_requests ADD CONSTRAINT client_requests_land_size_max_check CHECK (((land_size_max IS NULL) OR (land_size_max >= (0)::numeric)));

ALTER TABLE client_requests ADD CONSTRAINT client_requests_land_size_min_check CHECK (((land_size_min IS NULL) OR (land_size_min >= (0)::numeric)));

ALTER TABLE client_requests ADD CONSTRAINT client_requests_land_size_pair_check CHECK (((land_size_min IS NULL) OR (land_size_max IS NULL) OR (land_size_min <= land_size_max)));

ALTER TABLE client_requests ADD CONSTRAINT client_requests_lead_score_check CHECK (((lead_score >= 0) AND (lead_score <= 100)));

ALTER TABLE client_requests ADD CONSTRAINT client_requests_lead_temperature_check CHECK ((lead_temperature = ANY (ARRAY['hot'::text, 'warm'::text, 'cold'::text])));

ALTER TABLE client_requests ADD CONSTRAINT client_requests_pkey PRIMARY KEY (id);

ALTER TABLE client_requests ADD CONSTRAINT client_requests_priority_check CHECK (((priority >= 1) AND (priority <= 3)));

ALTER TABLE client_requests ADD CONSTRAINT client_requests_request_type_check CHECK ((request_type = ANY (ARRAY['buyer'::text, 'seller'::text, 'tenant'::text, 'landlord'::text, 'consultation'::text, 'investor'::text])));

ALTER TABLE client_requests ADD CONSTRAINT client_requests_search_status_check CHECK ((search_status = ANY (ARRAY['active'::text, 'active_no_match'::text, 'waiting_new_property'::text, 'financing_in_progress'::text, 'not_ready'::text, 'deferred'::text, 'stopped'::text, 'bought_with_us'::text, 'bought_elsewhere'::text, 'no_response'::text, 'unknown'::text])));

ALTER TABLE client_requests ADD CONSTRAINT client_requests_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'won'::text, 'lost'::text, 'cancelled'::text, 'archived'::text])));

CREATE TABLE appointments(
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  client_id uuid NOT NULL,
  request_id uuid,
  branch_key text,
  agent_id uuid,
  booked_at timestamp with time zone NOT NULL DEFAULT now(),
  appointment_at timestamp with time zone NOT NULL,
  confirmed_at timestamp with time zone,
  attended_at timestamp with time zone,
  status text NOT NULL DEFAULT 'scheduled'::text,
  no_show_reason text,
  visit_notes text,
  result text,
  next_action text,
  next_followup date,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE appointments ADD CONSTRAINT appointments_branch_check CHECK (((branch_key IS NULL) OR (branch_key = ANY (ARRAY['muscat'::text, 'barka'::text, 'investment'::text, 'general'::text]))));

ALTER TABLE appointments ADD CONSTRAINT appointments_pkey PRIMARY KEY (id);

ALTER TABLE appointments ADD CONSTRAINT appointments_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'confirmed'::text, 'attended'::text, 'no_show'::text, 'cancelled'::text, 'rescheduled'::text])));

CREATE TABLE appointment_properties(
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  appointment_id uuid NOT NULL,
  property_id uuid NOT NULL,
  sequence_no integer NOT NULL DEFAULT 1,
  viewing_started_at timestamp with time zone,
  viewing_ended_at timestamp with time zone,
  viewing_result text,
  interest_level text,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE viewings(
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid,
  client_id uuid,
  property_id uuid,
  agent_id uuid,
  viewing_date date NOT NULL,
  viewing_time time without time zone,
  duration_minutes integer DEFAULT 60,
  location text,
  status text DEFAULT 'scheduled'::text,
  attendance text,
  client_feedback text,
  rejection_reason text,
  liked boolean,
  next_step text,
  followup_date date,
  notes text,
  archived boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  created_by uuid,
  request_id uuid,
  appointment_id uuid,
  pipeline_outcome text,
  outcome_note text,
  created_via text NOT NULL DEFAULT 'manual'::text,
  source_whatsapp_message_id uuid,
  auto_confidence numeric,
  row_version bigint NOT NULL DEFAULT 1,
  updated_at timestamp with time zone DEFAULT now()
);

ALTER TABLE viewings ADD CONSTRAINT crm_viewings_duration_valid CHECK (((duration_minutes IS NULL) OR ((duration_minutes >= 1) AND (duration_minutes <= 1440))));

ALTER TABLE viewings ADD CONSTRAINT crm_viewings_required_refs CHECK (((company_id IS NOT NULL) AND (client_id IS NOT NULL) AND (property_id IS NOT NULL)));

ALTER TABLE viewings ADD CONSTRAINT crm_viewings_status_valid CHECK (((status IS NOT NULL) AND (status = ANY (ARRAY['scheduled'::text, 'confirmed'::text, 'done'::text, 'cancelled'::text, 'no_show'::text, 'postponed'::text]))));

ALTER TABLE viewings ADD CONSTRAINT viewings_auto_confidence_chk CHECK (((auto_confidence IS NULL) OR ((auto_confidence >= (0)::numeric) AND (auto_confidence <= (1)::numeric))));

ALTER TABLE viewings ADD CONSTRAINT viewings_created_via_chk CHECK ((created_via = ANY (ARRAY['manual'::text, 'whatsapp_ai'::text, 'system'::text])));

ALTER TABLE viewings ADD CONSTRAINT viewings_pipeline_outcome_check CHECK (((pipeline_outcome IS NULL) OR (pipeline_outcome = ANY (ARRAY['followup'::text, 'negotiation'::text, 'lost'::text]))));

ALTER TABLE viewings ADD CONSTRAINT viewings_pkey PRIMARY KEY (id);

CREATE TABLE tasks(
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid,
  user_id uuid,
  client_id uuid,
  deal_id uuid,
  title text NOT NULL,
  notes text,
  due_date date,
  priority text DEFAULT 'medium'::text,
  done boolean DEFAULT false,
  completed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  request_id uuid,
  viewing_id uuid
);

ALTER TABLE tasks ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);

ALTER TABLE tasks ADD CONSTRAINT tasks_priority_check CHECK ((priority = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text])));

CREATE UNIQUE INDEX test_appointment_property_unique ON appointment_properties(company_id,appointment_id,property_id);

CREATE TABLE activities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,user_id uuid,client_id uuid,property_id uuid,request_id uuid,appointment_id uuid,type text,description text,activity_type text,activity_text text,channel text,direction text,actor_type text,after_data jsonb);
CREATE TABLE property_inquiries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,client_id uuid,property_id uuid,request_id uuid,assigned_to uuid,source text,source_detail text,status text,first_inquiry_at timestamptz,last_inquiry_at timestamptz,inquiry_count int,created_by uuid,has_inbound_inquiry boolean,viewing_booked boolean,viewing_completed boolean,match_status text,created_at timestamptz DEFAULT now(),updated_at timestamptz);
CREATE UNIQUE INDEX test_property_request_interest ON property_inquiries(company_id,request_id,property_id) WHERE request_id IS NOT NULL;
CREATE UNIQUE INDEX test_legacy_property_interest ON property_inquiries(company_id,client_id,property_id) WHERE request_id IS NULL;
CREATE TABLE crm_repair_private.viewing_save_operations(operation_key uuid,user_id uuid,company_id uuid,payload_hash text,viewing_id uuid,appointment_id uuid,followup_task_id uuid,warnings jsonb DEFAULT '[]',created_at timestamptz DEFAULT now(),PRIMARY KEY(user_id,operation_key));
CREATE UNIQUE INDEX crm_one_open_viewing_followup ON public.tasks(company_id,viewing_id) WHERE viewing_id IS NOT NULL AND done IS FALSE;

CREATE OR REPLACE FUNCTION crm_repair_private.staff_can_access_branch(p_company uuid, p_branch text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(
   select 1 from public.profiles p
   where p.id=(select auth.uid()) and p.company_id=p_company and p.is_active
     and (p.role in ('owner','manager','viewer')
       or (p.role='agent' and exists(
         select 1 from public.company_lead_routes r
         where r.company_id=p_company and r.assigned_to=p.id
           and r.route_key=p_branch and r.owner_only_inbox is false)))
 );
$function$
;

CREATE OR REPLACE FUNCTION crm_repair_private.can_access_client(p_company_id uuid, p_client_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.clients c ON c.company_id=p.company_id AND c.id=p_client_id
    WHERE p.id=(SELECT auth.uid()) AND p.is_active IS TRUE AND p.company_id=p_company_id
      AND (p.role IN ('owner','manager','viewer') OR (p.role='agent' AND
        ((coalesce(c.lead_route,'general')='general' OR crm_repair_private.staff_can_access_branch(p_company_id,c.lead_route)) AND (c.assigned_to=p.id OR EXISTS(SELECT 1 FROM public.client_requests r
          WHERE r.company_id=p.company_id AND r.client_id=c.id AND
            ((r.assigned_to=p.id AND r.status<>'archived') OR
              (r.status IN ('active','paused') AND EXISTS(
                SELECT 1 FROM public.client_request_assignees a
                WHERE a.company_id=p.company_id AND a.request_id=r.id AND a.user_id=p.id))))))))
  )
$function$
;

CREATE OR REPLACE FUNCTION crm_repair_private.can_access_request(p_company_id uuid, p_request_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    JOIN public.client_requests r ON r.company_id=p.company_id AND r.id=p_request_id
    WHERE p.id=(SELECT auth.uid()) AND p.is_active IS TRUE AND p.company_id=p_company_id
      AND (p.role IN ('owner','manager','viewer') OR (p.role='agent' AND
        ((coalesce(r.branch_key,r.route_key,'general')='general' OR crm_repair_private.staff_can_access_branch(p_company_id,coalesce(r.branch_key,r.route_key))) AND (r.assigned_to=p.id OR EXISTS(SELECT 1 FROM public.client_request_assignees a
          WHERE a.company_id=p.company_id AND a.request_id=r.id AND a.user_id=p.id)))))
  )
$function$
;

CREATE OR REPLACE FUNCTION crm_repair_private.link_viewing_interest()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_inquiry uuid; v_time timestamptz; v_branch text;
begin
 if new.archived is true or new.status='cancelled' then return new; end if;
 select p.branch_key into v_branch from public.properties p
  where p.id=new.property_id and p.company_id=new.company_id;
 if v_branch is null then return new; end if;
 if auth.uid() is not null and not crm_repair_private.staff_can_access_branch(new.company_id,v_branch) then
  raise exception using errcode='42501',message='viewing_property_branch_not_allowed';
 end if;
 v_time:=coalesce(new.created_at,now());
 select id into v_inquiry from public.property_inquiries
  where company_id=new.company_id and client_id=new.client_id and property_id=new.property_id
  order by created_at limit 1 for update;
 if v_inquiry is null then
  insert into public.property_inquiries(company_id,client_id,property_id,request_id,assigned_to,
   source,source_detail,status,first_inquiry_at,last_inquiry_at,inquiry_count,created_by,
   has_inbound_inquiry,viewing_booked,viewing_completed,match_status)
  values(new.company_id,new.client_id,new.property_id,new.request_id,new.agent_id,
   'other','زيارة مسجلة في CRM','viewing_scheduled',v_time,v_time,1,
   coalesce(new.created_by,new.agent_id),false,true,new.status='done','matched')
  on conflict do nothing;
 else
  update public.property_inquiries set viewing_booked=true,
   viewing_completed=(viewing_completed or new.status='done'),
   status=case when status in ('inquiry','followup','viewing_scheduled') and new.status='done' then 'viewed'
    when status in ('inquiry','followup') then 'viewing_scheduled' else status end,
   updated_at=now()
  where id=v_inquiry;
 end if;
 return new;
end $function$
;

CREATE OR REPLACE FUNCTION crm_repair_private.validate_viewing_refs_and_version()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP='UPDATE' AND coalesce(old.archived,false)=false AND new.archived IS TRUE
    AND new.status NOT IN('done','cancelled','no_show') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='viewing_cancel_or_complete_before_archive';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.clients c WHERE c.id=new.client_id AND c.company_id=new.company_id) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='viewing_client_company_mismatch';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.properties p WHERE p.id=new.property_id AND p.company_id=new.company_id) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='viewing_property_company_mismatch';
  END IF;
  IF new.agent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=new.agent_id AND p.company_id=new.company_id) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='viewing_agent_company_mismatch';
  END IF;
  IF new.request_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.client_requests r
    WHERE r.id=new.request_id AND r.company_id=new.company_id AND r.client_id=new.client_id) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='viewing_request_client_mismatch';
  END IF;
  IF new.appointment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.appointments a
    WHERE a.id=new.appointment_id AND a.company_id=new.company_id AND a.client_id=new.client_id
      AND (a.request_id IS NULL OR a.request_id IS NOT DISTINCT FROM new.request_id)) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='viewing_appointment_mismatch';
  END IF;
  IF TG_OP='UPDATE' THEN new.row_version:=old.row_version+1; END IF;
  new.updated_at:=now();
  RETURN new;
END;
$function$
;

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY clients_branch_boundary ON clients AS RESTRICTIVE FOR ALL TO authenticated USING (((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR (COALESCE(lead_route, 'general'::text) = 'general'::text) OR crm_repair_private.staff_can_access_branch(company_id, lead_route))) WITH CHECK (((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR (COALESCE(lead_route, 'general'::text) = 'general'::text) OR crm_repair_private.staff_can_access_branch(company_id, lead_route)));

CREATE POLICY clients_delete_admin ON clients AS PERMISSIVE FOR DELETE TO authenticated USING (((company_id = my_company()) AND (my_role() = ANY (ARRAY['owner'::text, 'manager'::text]))));

CREATE POLICY clients_insert_staff ON clients AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((my_role() = 'agent'::text) AND (assigned_to = auth.uid())))));

CREATE POLICY clients_select_by_role ON clients AS PERMISSIVE FOR SELECT TO authenticated USING (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR ((my_role() = 'agent'::text) AND (assigned_to = auth.uid())))));

CREATE POLICY clients_select_via_assigned_request ON clients AS PERMISSIVE FOR SELECT TO authenticated USING (((company_id = my_company()) AND (my_role() = 'agent'::text) AND (EXISTS ( SELECT 1
   FROM client_requests r
  WHERE ((r.client_id = clients.id) AND (r.company_id = my_company()) AND (r.assigned_to = auth.uid()) AND (r.status <> 'archived'::text))))));

CREATE POLICY clients_select_via_request_team ON clients AS PERMISSIVE FOR SELECT TO authenticated USING (((company_id = my_company()) AND (my_role() = 'agent'::text) AND (EXISTS ( SELECT 1
   FROM (client_requests r
     JOIN client_request_assignees a ON ((a.request_id = r.id)))
  WHERE ((r.client_id = clients.id) AND (r.company_id = my_company()) AND (r.status = ANY (ARRAY['active'::text, 'paused'::text])) AND (a.user_id = auth.uid()))))));

CREATE POLICY clients_update_allowed ON clients AS PERMISSIVE FOR UPDATE TO authenticated USING (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((my_role() = 'agent'::text) AND (assigned_to = auth.uid()))))) WITH CHECK (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((my_role() = 'agent'::text) AND (assigned_to = auth.uid())))));

CREATE POLICY clients_update_via_request_team ON clients AS PERMISSIVE FOR UPDATE TO authenticated USING (((company_id = my_company()) AND (my_role() = 'agent'::text) AND (EXISTS ( SELECT 1
   FROM (client_requests r
     JOIN client_request_assignees a ON ((a.request_id = r.id)))
  WHERE ((r.client_id = clients.id) AND (r.company_id = my_company()) AND (r.status = ANY (ARRAY['active'::text, 'paused'::text])) AND (a.user_id = auth.uid())))))) WITH CHECK ((company_id = my_company()));

ALTER TABLE properties ENABLE ROW LEVEL SECURITY;

CREATE POLICY properties_delete_admin ON properties AS PERMISSIVE FOR DELETE TO authenticated USING (((company_id = my_company()) AND (my_role() = ANY (ARRAY['owner'::text, 'manager'::text]))));

CREATE POLICY properties_insert_branch ON properties AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((company_id = my_company()) AND (my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'agent'::text])) AND crm_repair_private.staff_can_access_branch(company_id, branch_key)));

CREATE POLICY properties_select_branch ON properties AS PERMISSIVE FOR SELECT TO authenticated USING (((company_id = my_company()) AND crm_repair_private.staff_can_access_branch(company_id, branch_key)));

CREATE POLICY properties_update_branch ON properties AS PERMISSIVE FOR UPDATE TO authenticated USING (((company_id = my_company()) AND (my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'agent'::text])) AND crm_repair_private.staff_can_access_branch(company_id, branch_key))) WITH CHECK (((company_id = my_company()) AND crm_repair_private.staff_can_access_branch(company_id, branch_key)));

ALTER TABLE client_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY client_requests_delete_admin ON client_requests AS PERMISSIVE FOR DELETE TO authenticated USING (((company_id = my_company()) AND (my_role() = ANY (ARRAY['owner'::text, 'manager'::text]))));

CREATE POLICY client_requests_insert_staff ON client_requests AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((my_role() = 'agent'::text) AND (assigned_to = auth.uid())))));

CREATE POLICY client_requests_select_allowed ON client_requests AS PERMISSIVE FOR SELECT TO authenticated USING (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR ((my_role() = 'agent'::text) AND (assigned_to = auth.uid())))));

CREATE POLICY client_requests_select_via_team ON client_requests AS PERMISSIVE FOR SELECT TO authenticated USING (((company_id = my_company()) AND (my_role() = 'agent'::text) AND (EXISTS ( SELECT 1
   FROM client_request_assignees a
  WHERE ((a.request_id = client_requests.id) AND (a.company_id = my_company()) AND (a.user_id = auth.uid()))))));

CREATE POLICY client_requests_update_allowed ON client_requests AS PERMISSIVE FOR UPDATE TO authenticated USING (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((my_role() = 'agent'::text) AND (assigned_to = auth.uid()))))) WITH CHECK (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((my_role() = 'agent'::text) AND (assigned_to = auth.uid())))));

CREATE POLICY client_requests_update_via_team ON client_requests AS PERMISSIVE FOR UPDATE TO authenticated USING (((company_id = my_company()) AND (my_role() = 'agent'::text) AND (EXISTS ( SELECT 1
   FROM client_request_assignees a
  WHERE ((a.request_id = client_requests.id) AND (a.company_id = my_company()) AND (a.user_id = auth.uid())))))) WITH CHECK ((company_id = my_company()));

CREATE POLICY requests_branch_boundary ON client_requests AS RESTRICTIVE FOR ALL TO authenticated USING (((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR (COALESCE(branch_key, route_key, 'general'::text) = 'general'::text) OR crm_repair_private.staff_can_access_branch(company_id, COALESCE(branch_key, route_key)))) WITH CHECK (((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR (COALESCE(branch_key, route_key, 'general'::text) = 'general'::text) OR crm_repair_private.staff_can_access_branch(company_id, COALESCE(branch_key, route_key))));

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY appointments_delete_admin ON appointments AS PERMISSIVE FOR DELETE TO authenticated USING (((company_id = ( SELECT my_company() AS my_company)) AND (( SELECT my_role() AS my_role) = ANY (ARRAY['owner'::text, 'manager'::text]))));

CREATE POLICY appointments_insert_allowed ON appointments AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((company_id = ( SELECT my_company() AS my_company)) AND ((( SELECT my_role() AS my_role) = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((( SELECT my_role() AS my_role) = 'agent'::text) AND (agent_id = ( SELECT auth.uid() AS uid)) AND crm_repair_private.can_access_client(company_id, client_id)))));

CREATE POLICY appointments_related_branch_boundary ON appointments AS RESTRICTIVE FOR ALL TO authenticated USING (((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR (((client_id IS NULL) OR crm_repair_private.can_access_client(company_id, client_id)) AND ((request_id IS NULL) OR crm_repair_private.can_access_request(company_id, request_id)) AND ((COALESCE(branch_key, 'general'::text) = 'general'::text) OR crm_repair_private.staff_can_access_branch(company_id, branch_key))))) WITH CHECK (((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR (((client_id IS NULL) OR crm_repair_private.can_access_client(company_id, client_id)) AND ((request_id IS NULL) OR crm_repair_private.can_access_request(company_id, request_id)) AND ((COALESCE(branch_key, 'general'::text) = 'general'::text) OR crm_repair_private.staff_can_access_branch(company_id, branch_key)))));

CREATE POLICY appointments_select_allowed ON appointments AS PERMISSIVE FOR SELECT TO authenticated USING (((company_id = ( SELECT my_company() AS my_company)) AND ((( SELECT my_role() AS my_role) = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR ((( SELECT my_role() AS my_role) = 'agent'::text) AND crm_repair_private.can_access_client(company_id, client_id)))));

CREATE POLICY appointments_update_allowed ON appointments AS PERMISSIVE FOR UPDATE TO authenticated USING (((company_id = ( SELECT my_company() AS my_company)) AND ((( SELECT my_role() AS my_role) = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((( SELECT my_role() AS my_role) = 'agent'::text) AND (agent_id = ( SELECT auth.uid() AS uid)) AND crm_repair_private.can_access_client(company_id, client_id))))) WITH CHECK (((company_id = ( SELECT my_company() AS my_company)) AND ((( SELECT my_role() AS my_role) = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((( SELECT my_role() AS my_role) = 'agent'::text) AND (agent_id = ( SELECT auth.uid() AS uid)) AND crm_repair_private.can_access_client(company_id, client_id)))));

ALTER TABLE appointment_properties ENABLE ROW LEVEL SECURITY;

ALTER TABLE viewings ENABLE ROW LEVEL SECURITY;

CREATE POLICY viewings_delete_admin ON viewings AS PERMISSIVE FOR DELETE TO authenticated USING (((company_id = my_company()) AND (my_role() = ANY (ARRAY['owner'::text, 'manager'::text]))));

CREATE POLICY viewings_insert_staff ON viewings AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((company_id = ( SELECT my_company() AS my_company)) AND ((( SELECT my_role() AS my_role) = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((( SELECT my_role() AS my_role) = 'agent'::text) AND (agent_id = ( SELECT auth.uid() AS uid)) AND crm_repair_private.can_access_client(company_id, client_id)))));

CREATE POLICY viewings_related_branch_boundary ON viewings AS RESTRICTIVE FOR ALL TO authenticated USING (((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR (((client_id IS NULL) OR crm_repair_private.can_access_client(company_id, client_id)) AND ((request_id IS NULL) OR crm_repair_private.can_access_request(company_id, request_id)) AND ((property_id IS NULL) OR (EXISTS ( SELECT 1
   FROM properties p
  WHERE ((p.id = viewings.property_id) AND (p.company_id = viewings.company_id) AND crm_repair_private.staff_can_access_branch(p.company_id, p.branch_key)))))))) WITH CHECK (((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR (((client_id IS NULL) OR crm_repair_private.can_access_client(company_id, client_id)) AND ((request_id IS NULL) OR crm_repair_private.can_access_request(company_id, request_id)) AND ((property_id IS NULL) OR (EXISTS ( SELECT 1
   FROM properties p
  WHERE ((p.id = viewings.property_id) AND (p.company_id = viewings.company_id) AND crm_repair_private.staff_can_access_branch(p.company_id, p.branch_key))))))));

CREATE POLICY viewings_select_company ON viewings AS PERMISSIVE FOR SELECT TO authenticated USING (((company_id = ( SELECT my_company() AS my_company)) AND ((( SELECT my_role() AS my_role) = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR ((( SELECT my_role() AS my_role) = 'agent'::text) AND crm_repair_private.can_access_client(company_id, client_id)))));

CREATE POLICY viewings_update_staff ON viewings AS PERMISSIVE FOR UPDATE TO authenticated USING (((company_id = ( SELECT my_company() AS my_company)) AND ((( SELECT my_role() AS my_role) = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((( SELECT my_role() AS my_role) = 'agent'::text) AND (agent_id = ( SELECT auth.uid() AS uid)) AND crm_repair_private.can_access_client(company_id, client_id))))) WITH CHECK (((company_id = ( SELECT my_company() AS my_company)) AND ((( SELECT my_role() AS my_role) = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((( SELECT my_role() AS my_role) = 'agent'::text) AND (agent_id = ( SELECT auth.uid() AS uid)) AND crm_repair_private.can_access_client(company_id, client_id)))));

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY tasks_delete_allowed ON tasks AS PERMISSIVE FOR DELETE TO authenticated USING (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((my_role() = 'agent'::text) AND (user_id = auth.uid())))));

CREATE POLICY tasks_insert_allowed ON tasks AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((my_role() = 'agent'::text) AND (user_id = auth.uid())))));

CREATE POLICY tasks_related_branch_boundary ON tasks AS RESTRICTIVE FOR ALL TO authenticated USING (((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR (((client_id IS NULL) OR crm_repair_private.can_access_client(company_id, client_id)) AND ((request_id IS NULL) OR crm_repair_private.can_access_request(company_id, request_id)) AND ((deal_id IS NULL) OR (EXISTS ( SELECT 1
   FROM deals d
  WHERE ((d.id = tasks.deal_id) AND (d.company_id = tasks.company_id))))) AND ((viewing_id IS NULL) OR (EXISTS ( SELECT 1
   FROM viewings v
  WHERE ((v.id = tasks.viewing_id) AND (v.company_id = tasks.company_id)))))))) WITH CHECK (((my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR (((client_id IS NULL) OR crm_repair_private.can_access_client(company_id, client_id)) AND ((request_id IS NULL) OR crm_repair_private.can_access_request(company_id, request_id)) AND ((deal_id IS NULL) OR (EXISTS ( SELECT 1
   FROM deals d
  WHERE ((d.id = tasks.deal_id) AND (d.company_id = tasks.company_id))))) AND ((viewing_id IS NULL) OR (EXISTS ( SELECT 1
   FROM viewings v
  WHERE ((v.id = tasks.viewing_id) AND (v.company_id = tasks.company_id))))))));

CREATE POLICY tasks_select_allowed ON tasks AS PERMISSIVE FOR SELECT TO authenticated USING (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text])) OR (user_id = auth.uid()))));

CREATE POLICY tasks_update_allowed ON tasks AS PERMISSIVE FOR UPDATE TO authenticated USING (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((my_role() = 'agent'::text) AND (user_id = auth.uid()))))) WITH CHECK (((company_id = my_company()) AND ((my_role() = ANY (ARRAY['owner'::text, 'manager'::text])) OR ((my_role() = 'agent'::text) AND (user_id = auth.uid())))));

CREATE POLICY appointment_property_access ON appointment_properties FOR ALL TO authenticated USING(company_id=my_company()) WITH CHECK(company_id=my_company());
ALTER TABLE crm_repair_private.viewing_save_operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY save_operation ON crm_repair_private.viewing_save_operations FOR ALL TO authenticated USING(user_id=auth.uid() AND company_id=my_company()) WITH CHECK(user_id=auth.uid() AND company_id=my_company());
-- Fixture-only deterministic routing for explicit branch keys. Production uses
-- crm_set_request_geography + crm_sync_request_assignees, not replaced by SQL13.
CREATE FUNCTION test_route_request() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 SELECT assigned_to INTO new.assigned_to FROM public.company_lead_routes WHERE company_id=new.company_id AND route_key=new.branch_key AND is_active LIMIT 1;
 RETURN new;
END$$;
CREATE TRIGGER test_route_request BEFORE INSERT ON client_requests FOR EACH ROW EXECUTE FUNCTION test_route_request();
CREATE TRIGGER crm_validate_viewing_refs_and_version BEFORE INSERT OR UPDATE ON viewings FOR EACH ROW EXECUTE FUNCTION crm_repair_private.validate_viewing_refs_and_version();
CREATE TRIGGER crm_link_viewing_interest AFTER INSERT OR UPDATE ON viewings FOR EACH ROW EXECUTE FUNCTION crm_repair_private.link_viewing_interest();
GRANT USAGE ON SCHEMA public,auth,crm_repair_private TO authenticated;
GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT,INSERT ON crm_repair_private.viewing_save_operations TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth,public,crm_repair_private TO authenticated;
INSERT INTO companies VALUES('00000000-0000-4000-8000-000000000001');
INSERT INTO profiles VALUES
('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','agent',true),
('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','agent',true),
('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','owner',true);
INSERT INTO company_lead_routes(company_id,route_key,assigned_to) VALUES
('00000000-0000-4000-8000-000000000001','muscat','00000000-0000-4000-8000-000000000002'),
('00000000-0000-4000-8000-000000000001','barka','00000000-0000-4000-8000-000000000003');
INSERT INTO clients(id,company_id,name,phone,assigned_to,lead_route) VALUES
('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000001','TEST MUSCAT','+96890000001','00000000-0000-4000-8000-000000000002','muscat'),
('00000000-0000-4000-8000-000000000202','00000000-0000-4000-8000-000000000001','TEST BARKA','+96890000002','00000000-0000-4000-8000-000000000003','barka');
INSERT INTO properties(id,company_id,title,type,area,price,branch_key) VALUES
('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000001','TEST MUSCAT','villa','TEST MUSCAT AREA',100000,'muscat'),
('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000001','TEST BARKA','villa','TEST BARKA AREA',80000,'barka'),
('00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000001','TEST MUSCAT 2','villa','TEST MUSCAT AREA',90000,'muscat');
