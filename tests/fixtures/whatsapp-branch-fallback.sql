-- Disposable synthetic routing fixture; never execute against production.
-- The actual geographic inference/phone functions and original triggers were captured 2026-10-11.
-- No customer data, messaging, automation, or production identifiers are included.
DO $$BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL;END$$;
DO $$BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL;END$$;
DO $$BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL;END$$;
CREATE SCHEMA auth;CREATE SCHEMA crm_repair_private;
CREATE TABLE profiles(id uuid PRIMARY KEY,company_id uuid NOT NULL,role text NOT NULL,is_active boolean NOT NULL DEFAULT true);
CREATE TABLE clients(id uuid PRIMARY KEY,company_id uuid NOT NULL,assigned_to uuid,lead_route text,created_at timestamptz DEFAULT now(),name text DEFAULT 'TEST CLIENT',phone text,source text DEFAULT 'other',archived boolean DEFAULT false);
CREATE TABLE company_lead_routes(company_id uuid NOT NULL,route_key text NOT NULL,assigned_to uuid,whatsapp_number text,is_active boolean DEFAULT true,PRIMARY KEY(company_id,route_key));
CREATE TABLE whatsapp_conversations(id uuid PRIMARY KEY,company_id uuid NOT NULL,client_id uuid NOT NULL,assigned_to uuid,route_key text,updated_at timestamptz DEFAULT now());
CREATE TABLE whatsapp_messages(id uuid PRIMARY KEY,company_id uuid NOT NULL,client_id uuid NOT NULL,conversation_id uuid NOT NULL,direction text NOT NULL DEFAULT 'inbound');
CREATE TABLE client_requests(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid NOT NULL,client_id uuid NOT NULL,assigned_to uuid,
 route_key text,branch_key text,wilayat text,preferred_area text,preferred_areas text[],alternative_areas text[],
 status text DEFAULT 'active',manual_assigned_to uuid,subject_property_id uuid,origin_whatsapp_message_id uuid,inbound_number text,
 missing_required_fields text[] DEFAULT '{}',request_type text DEFAULT 'buyer',created_via text DEFAULT 'whatsapp',updated_at timestamptz DEFAULT now()
);
CREATE TABLE viewings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),client_id uuid);
CREATE TABLE deals(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),client_id uuid);
CREATE TABLE client_request_assignees(
 request_id uuid NOT NULL REFERENCES client_requests(id),company_id uuid NOT NULL,user_id uuid NOT NULL,branch_key text,
 PRIMARY KEY(request_id,user_id)
);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('test.actor',true),'')::uuid$$;
CREATE FUNCTION my_role() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$SELECT p.role FROM public.profiles p WHERE p.id=auth.uid()$$;
CREATE FUNCTION my_company() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$SELECT p.company_id FROM public.profiles p WHERE p.id=auth.uid()$$;
CREATE FUNCTION test_id(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
CREATE OR REPLACE FUNCTION public.normalize_crm_phone(p_phone text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE v_input text; v_digits text;
BEGIN
  IF p_phone IS NULL OR btrim(p_phone)='' THEN RETURN NULL; END IF;
  v_input:=translate(btrim(p_phone),'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789');
  v_input:=regexp_replace(v_input,'[[:space:]().-]','','g');
  IF v_input !~ '^\+?[0-9]+$' THEN RETURN NULL; END IF;
  v_digits:=ltrim(v_input,'+');
  IF v_digits LIKE '00%' THEN v_digits:=substr(v_digits,3); END IF;
  IF length(v_digits)=8 THEN v_digits:='968'||v_digits; END IF;
  IF length(v_digits)<7 OR length(v_digits)>15 OR v_digits !~ '^[1-9][0-9]+$' THEN RETURN NULL; END IF;
  IF v_digits LIKE '968%' AND length(v_digits)<>11 THEN RETURN NULL; END IF;
  RETURN '+'||v_digits;
END;
$function$;

CREATE OR REPLACE FUNCTION public.crm_infer_request_branches(p_route_key text, p_branch_key text, p_wilayat text, p_preferred_area text, p_preferred_areas text[], p_alternative_areas text[])
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  area_text text := lower(concat_ws(' ',coalesce(p_preferred_area,''),array_to_string(coalesce(p_preferred_areas,'{}'::text[]),' '),array_to_string(coalesce(p_alternative_areas,'{}'::text[]),' ')));
  wilayat_text text := lower(coalesce(p_wilayat,''));
  t text;
  has_barka boolean := false;
  has_muscat boolean := false;
begin
  if coalesce(p_route_key,'')='investment' or coalesce(p_branch_key,'')='investment' then
    return array['investment']::text[];
  end if;

  -- Remove relational phrases that mention Muscat as a landmark/proximity rather than a desired market.
  area_text := regexp_replace(area_text,'بنك[[:space:]]*مسقط',' ','g');
  area_text := regexp_replace(area_text,'(بالقرب[[:space:]]+من|قريب[هة]?[[:space:]]+من|قريب[هة]?[[:space:]]+)(مدينة[[:space:]]+)?مسقط',' ','g');
  area_text := regexp_replace(area_text,'منطق[هة][[:space:]]+قريب[هة][[:space:]]+من[[:space:]]+مسقط',' ','g');

  -- Preferred/alternative areas are the strongest signal. Only fall back to legacy wilayat when they do not identify either office market.
  t := area_text;

  has_barka := t ~ '(بركاء|بركا|حي[[:space:]]*عاصم|الهرم|الرميس|رميس|المنومة|المنومه|الشخاخيط|الفليج|الصومحان|صومحان|السوادي|السويادي|السودي|الحرادي|السلاحة|السلاحه|العقدة|العقده|القعدة|القعده|المريصي|المريسي|أبو[[:space:]]*النخيل|ابو[[:space:]]*النخيل|البلة|البله|العامرة)';
  has_muscat := t ~ '(مسقط|muscat|السيب|seeb|الخوض|المعبيل[هة]|المعبيبه|mabaela|maabela|الموالح|الحيل|بوشر|boushar|bawshar|القرم|الانصب|الأنصب|العذيبة|العذيبه|غلا|مدينة[[:space:]]*السلطان[[:space:]]*هيثم|وادي[[:space:]]*زها|العامرات|الجفنين|المسفاة|المسفاه|مرتفعات[[:space:]]*المطار|الموج|الغبرة|الغبره|الخوير|روي|مطرح|muttrah|يتي|قنتب|مدينة[[:space:]]*السلطان[[:space:]]*قابوس|الوطية|الوطيه|دارسيت|سداب|حرامل|البستان|الجصة|الجصه|ينكت|الخيران|السيفة|السيفه|مرتفعات[[:space:]]*مدينة[[:space:]]*الإعلام|مرتفعات[[:space:]]*مدينة[[:space:]]*الاعلام|الصاروج|العوابي|وادي[[:space:]]*الكبير|قريات|quriyat)';

  if not has_barka and not has_muscat then
    t := wilayat_text;
    has_barka := t ~ '(بركاء|بركا|حي[[:space:]]*عاصم|الهرم|الرميس|رميس|المنومة|المنومه|الشخاخيط|الفليج|الصومحان|صومحان|السوادي|السويادي|السودي|الحرادي|السلاحة|السلاحه|العقدة|العقده|القعدة|القعده|المريصي|المريسي|أبو[[:space:]]*النخيل|ابو[[:space:]]*النخيل|البلة|البله|العامرة)';
    has_muscat := t ~ '(مسقط|muscat|السيب|seeb|الخوض|المعبيل[هة]|المعبيبه|mabaela|maabela|الموالح|الحيل|بوشر|boushar|bawshar|القرم|الانصب|الأنصب|العذيبة|العذيبه|غلا|مدينة[[:space:]]*السلطان[[:space:]]*هيثم|وادي[[:space:]]*زها|العامرات|الجفنين|المسفاة|المسفاه|مرتفعات[[:space:]]*المطار|الموج|الغبرة|الغبره|الخوير|روي|مطرح|muttrah|يتي|قنتب|مدينة[[:space:]]*السلطان[[:space:]]*قابوس|الوطية|الوطيه|دارسيت|سداب|حرامل|البستان|الجصة|الجصه|ينكت|الخيران|السيفة|السيفه|مرتفعات[[:space:]]*مدينة[[:space:]]*الإعلام|مرتفعات[[:space:]]*مدينة[[:space:]]*الاعلام|الصاروج|العوابي|وادي[[:space:]]*الكبير|قريات|quriyat)';
  end if;

  if has_barka and has_muscat then return array['muscat','barka']::text[]; end if;
  if has_barka then return array['barka']::text[]; end if;
  if has_muscat then return array['muscat']::text[]; end if;
  return '{}'::text[];
end;
$function$;

CREATE OR REPLACE FUNCTION public.crm_refresh_client_primary_assignment(p_company_id uuid, p_client_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  users uuid[];
  branches text[];
  primary_user uuid;
  primary_route text;
begin
  select array_agg(distinct a.user_id), array_agg(distinct a.branch_key)
    into users,branches
  from public.client_request_assignees a
  join public.client_requests r on r.id=a.request_id
  where a.company_id=p_company_id and r.client_id=p_client_id and r.status in ('active','paused');

  if coalesce(array_length(users,1),0)=0 then return; end if;

  if array_length(users,1)=1 then
    primary_user:=users[1];
    if 'investment'=any(branches) and coalesce(array_length(branches,1),0)=1 then primary_route:='investment';
    elsif 'barka'=any(branches) and not ('muscat'=any(branches)) then primary_route:='barka';
    elsif 'muscat'=any(branches) and not ('barka'=any(branches)) then primary_route:='muscat';
    else primary_route:='general'; end if;
  else
    select c.assigned_to into primary_user from public.clients c where c.id=p_client_id and c.company_id=p_company_id;
    if primary_user is null or not (primary_user=any(users)) then
      select r.assigned_to into primary_user from public.company_lead_routes r where r.company_id=p_company_id and r.route_key='muscat' and r.is_active=true limit 1;
      if primary_user is null or not (primary_user=any(users)) then primary_user:=users[1]; end if;
    end if;
    primary_route:='general';
  end if;

  update public.clients
     set assigned_to=primary_user,
         lead_route=primary_route
   where id=p_client_id and company_id=p_company_id
     and (assigned_to is distinct from primary_user or lead_route is distinct from primary_route);

  if array_length(users,1)=1 then
    update public.whatsapp_conversations
       set assigned_to=primary_user, updated_at=now()
     where company_id=p_company_id and client_id=p_client_id and assigned_to is distinct from primary_user;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.crm_set_request_geography()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  branches text[];
  logical_route text;
  primary_route text;
  primary_user uuid;
begin
  branches := public.crm_infer_request_branches(new.route_key,new.branch_key,new.wilayat,new.preferred_area,new.preferred_areas,new.alternative_areas);

  if array_length(branches,1) is null then
    logical_route := 'general';
    primary_route := 'muscat';
  elsif array_length(branches,1)=1 then
    logical_route := branches[1];
    primary_route := branches[1];
  else
    logical_route := 'general';
    primary_route := 'muscat';
  end if;

  select r.assigned_to into primary_user
  from public.company_lead_routes r
  where r.company_id=new.company_id and r.route_key=primary_route and r.is_active=true
  limit 1;

  new.branch_key := logical_route;
  new.route_key := logical_route;
  IF new.manual_assigned_to IS NOT NULL THEN
    IF NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=new.manual_assigned_to
      AND p.company_id=new.company_id AND p.is_active IS TRUE AND p.role IN('owner','manager','agent')) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='manual_assignee_not_active_in_company';
    END IF;
    new.assigned_to:=new.manual_assigned_to;
  ELSIF primary_user IS NOT NULL THEN new.assigned_to:=primary_user;
  END IF;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.crm_sync_request_assignees()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  branches text[];
  b text;
  uid uuid;
begin
  delete from public.client_request_assignees where request_id=new.id;

  if new.status in ('active','paused') then
    IF new.manual_assigned_to IS NOT NULL THEN
      insert into public.client_request_assignees(request_id,company_id,user_id,branch_key)
      values(new.id,new.company_id,new.manual_assigned_to,coalesce(new.branch_key,'general'))
      on conflict do nothing;
      perform public.crm_refresh_client_primary_assignment(new.company_id,new.client_id);
      return new;
    END IF;
    branches := public.crm_infer_request_branches(new.route_key,new.branch_key,new.wilayat,new.preferred_area,new.preferred_areas,new.alternative_areas);
    if array_length(branches,1) is null then branches:=array['muscat']::text[]; end if;

    foreach b in array branches loop
      select r.assigned_to into uid
      from public.company_lead_routes r
      where r.company_id=new.company_id and r.route_key=b and r.is_active=true
      limit 1;
      if uid is not null then
        insert into public.client_request_assignees(request_id,company_id,user_id,branch_key)
        values(new.id,new.company_id,uid,b)
        on conflict do nothing;
      end if;
    end loop;
  end if;

  perform public.crm_refresh_client_primary_assignment(new.company_id,new.client_id);
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.normalize_request_branch_when_location_missing()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.route_key is distinct from 'investment'
     and 'location'=any(coalesce(new.missing_required_fields,'{}'::text[]))
     and new.branch_key='muscat' then
    new.branch_key:='general';
  end if;
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION crm_refresh_client_primary_assignment(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION crm_refresh_client_primary_assignment(uuid,uuid) TO service_role;
CREATE TRIGGER trg_assign_request_geography BEFORE INSERT OR UPDATE OF route_key,branch_key,wilayat,preferred_area,preferred_areas,alternative_areas,status,manual_assigned_to ON client_requests FOR EACH ROW EXECUTE FUNCTION crm_set_request_geography();
CREATE TRIGGER trg_normalize_request_branch_when_location_missing BEFORE INSERT OR UPDATE OF branch_key,missing_required_fields ON client_requests FOR EACH ROW EXECUTE FUNCTION normalize_request_branch_when_location_missing();
CREATE TRIGGER trg_sync_request_assignees AFTER INSERT OR UPDATE OF route_key,branch_key,wilayat,preferred_area,preferred_areas,alternative_areas,status,assigned_to,manual_assigned_to ON client_requests FOR EACH ROW EXECUTE FUNCTION crm_sync_request_assignees();
INSERT INTO profiles VALUES(test_id(2),test_id(1),'agent',true),(test_id(3),test_id(1),'agent',true),(test_id(4),test_id(1),'owner',true);
INSERT INTO company_lead_routes(company_id,route_key,assigned_to,whatsapp_number) VALUES
 (test_id(1),'muscat',test_id(2),'+96890000001'),(test_id(1),'barka',test_id(3),'+96890000002'),(test_id(1),'investment',test_id(4),'+96890000003');
INSERT INTO clients(id,company_id,assigned_to,lead_route) SELECT test_id(n),test_id(1),test_id(2),'muscat' FROM generate_series(101,115)n;
INSERT INTO whatsapp_conversations(id,company_id,client_id,assigned_to,route_key)
 SELECT test_id(n+100),test_id(1),test_id(n),test_id(CASE WHEN n=103 THEN 2 ELSE 3 END),CASE WHEN n=103 THEN 'muscat' ELSE 'barka' END
 FROM generate_series(101,115)n;
INSERT INTO whatsapp_messages(id,company_id,client_id,conversation_id)
 SELECT test_id(n+200),test_id(1),test_id(n),test_id(n+100) FROM generate_series(101,115)n;
-- Deliberately constrained synthetic staff reads: owner all; staff only own branch/assignment.
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;ALTER TABLE client_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_conversations ENABLE ROW LEVEL SECURITY;ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY scoped_clients ON clients FOR SELECT TO authenticated USING(company_id=my_company() AND (my_role()='owner' OR (assigned_to=auth.uid() AND EXISTS(SELECT 1 FROM company_lead_routes lr WHERE lr.company_id=clients.company_id AND lr.route_key=clients.lead_route AND lr.assigned_to=auth.uid()))));
CREATE POLICY scoped_requests ON client_requests FOR SELECT TO authenticated USING(company_id=my_company() AND (my_role()='owner' OR (assigned_to=auth.uid() AND (branch_key='general' OR EXISTS(SELECT 1 FROM company_lead_routes lr WHERE lr.company_id=client_requests.company_id AND lr.route_key=client_requests.branch_key AND lr.assigned_to=auth.uid())))));
CREATE POLICY scoped_conversations ON whatsapp_conversations FOR SELECT TO authenticated USING(company_id=my_company() AND (my_role()='owner' OR EXISTS(SELECT 1 FROM company_lead_routes lr WHERE lr.company_id=whatsapp_conversations.company_id AND lr.route_key=whatsapp_conversations.route_key AND lr.assigned_to=auth.uid())));
CREATE POLICY scoped_messages ON whatsapp_messages FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM whatsapp_conversations w WHERE w.id=whatsapp_messages.conversation_id AND w.company_id=whatsapp_messages.company_id));
GRANT USAGE ON SCHEMA public,auth,crm_repair_private TO authenticated,anon,service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON FUNCTION test_id(int),auth.uid(),my_company(),my_role() TO authenticated;

