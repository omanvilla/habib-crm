-- PREPARED REVIEW CHANGE ONLY. Based on live function captured 2026-10-02.
-- No data rewrite; existing locations survive omitted form fields through jsonb_populate_record.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.crm_save_viewing_atomic(p_payload jsonb, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_company uuid:=public.my_company(); v_user uuid:=auth.uid(); v_role text:=public.my_role();
  v_old public.viewings%rowtype; v_new public.viewings%rowtype; v_saved public.viewings%rowtype;
  v_op crm_repair_private.viewing_save_operations%rowtype;
  v_hash text; v_id uuid; v_task uuid; v_appointment uuid; v_appointment_at timestamptz;
  v_appointment_status text; v_request_branch text; v_warnings jsonb:='[]'::jsonb;
  v_existing_time timestamptz; v_property_title text; v_expected bigint;
  v_property_branch text; v_property_type text; v_property_area text; v_property_wilayat text;
  v_request_type text; v_request_subject uuid; v_request_status text; v_request_count integer;
  v_property_price numeric; v_property_bedrooms integer; v_property_bathrooms integer;
  v_property_land numeric; v_property_built numeric; v_date_only_completed boolean:=false;
BEGIN
  IF v_user IS NULL OR v_company IS NULL OR v_role NOT IN('owner','manager','agent') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not_allowed';
  END IF;
  IF p_idempotency_key IS NULL OR p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='viewing_payload_and_operation_key_required';
  END IF;
  IF p_payload ? 'company_id' AND (p_payload->>'company_id')::uuid IS DISTINCT FROM v_company THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='company_mismatch';
  END IF;
  v_hash:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(v_user::text||':'||p_idempotency_key::text,0));
  SELECT * INTO v_op FROM crm_repair_private.viewing_save_operations
    WHERE user_id=v_user AND operation_key=p_idempotency_key;
  IF FOUND THEN
    IF v_op.payload_hash<>v_hash THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='idempotency_key_reused_with_different_payload'; END IF;
    SELECT * INTO v_saved FROM public.viewings WHERE id=v_op.viewing_id AND company_id=v_company;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='saved_viewing_no_longer_available'; END IF;
    RETURN jsonb_build_object('ok',true,'viewing_id',v_saved.id,'appointment_id',v_op.appointment_id,
      'followup_task_id',v_op.followup_task_id,'viewing',to_jsonb(v_saved),'warnings',v_op.warnings,'replayed',true);
  END IF;

  v_id:=nullif(p_payload->>'id','')::uuid;
  IF v_id IS NOT NULL THEN
    SELECT * INTO v_old FROM public.viewings WHERE id=v_id AND company_id=v_company FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='viewing_not_found_or_not_allowed'; END IF;
    IF v_old.archived IS TRUE THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='archived_viewing_restore_before_edit';
    END IF;
    v_expected:=nullif(p_payload->>'expected_version','')::bigint;
    IF v_expected IS NULL OR v_expected<>v_old.row_version THEN
      RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='viewing_changed_reload_before_saving';
    END IF;
  END IF;
  v_new:=jsonb_populate_record(v_old,p_payload-'expected_version'-'request_type'-'time_unknown');
  v_new.id:=coalesce(v_id,gen_random_uuid()); v_new.company_id:=v_company;
  v_new.agent_id:=coalesce(v_new.agent_id,v_user);
  v_new.created_by:=coalesce(v_old.created_by,v_user);
  v_new.created_at:=coalesce(v_old.created_at,now());
  v_new.created_via:=coalesce(v_old.created_via,'manual');
  v_new.status:=coalesce(v_new.status,'scheduled');
  v_new.duration_minutes:=coalesce(v_new.duration_minutes,60);
  v_new.archived:=coalesce(v_old.archived,false);
  IF v_new.client_id IS NULL OR v_new.property_id IS NULL OR v_new.viewing_date IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='viewing_client_property_date_required';
  END IF;
  v_date_only_completed:=v_new.status='done' AND v_new.viewing_time IS NULL AND coalesce((p_payload->>'time_unknown')::boolean,false) AND v_old.appointment_id IS NULL AND v_old.viewing_time IS NULL;
  IF v_id IS NULL AND v_new.viewing_time IS NULL AND NOT v_date_only_completed THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='viewing_time_required';
  END IF;
  IF v_id IS NOT NULL AND (v_new.client_id IS DISTINCT FROM v_old.client_id
    OR v_new.property_id IS DISTINCT FROM v_old.property_id
    OR (v_old.request_id IS NOT NULL AND v_new.request_id IS DISTINCT FROM v_old.request_id)) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='viewing_identity_change_requires_new_record';
  END IF;
  IF v_new.status NOT IN('scheduled','confirmed','done','cancelled','no_show','postponed') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_viewing_status';
  END IF;
  IF v_new.status='done' AND v_new.pipeline_outcome IS NULL AND NOT v_date_only_completed THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='viewing_outcome_required';
  END IF;
  IF v_new.status='done' AND v_new.pipeline_outcome='lost' AND
    nullif(btrim(v_new.rejection_reason),'') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='viewing_rejection_reason_required';
  END IF;
  IF NOT crm_repair_private.can_access_client(v_company,v_new.client_id) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='viewing_client_not_allowed';
  END IF;
  -- Read only non-financial property fields; invoker RLS remains authoritative.
  SELECT title,coalesce(branch_key,'general'),type,area,wilayat,price,bedrooms,bathrooms,land_size,built_size
    INTO v_property_title,v_property_branch,v_property_type,v_property_area,v_property_wilayat,v_property_price,v_property_bedrooms,v_property_bathrooms,v_property_land,v_property_built
    FROM public.properties WHERE id=v_new.property_id AND company_id=v_company;
  IF NOT FOUND OR NOT crm_repair_private.staff_can_access_branch(v_company,v_property_branch) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='viewing_property_not_allowed';
  END IF;
  v_request_type:=coalesce(nullif(p_payload->>'request_type',''),'buyer');
  IF v_request_type NOT IN ('buyer','tenant','investor') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='viewing_invalid_request_type';
  END IF;
  IF v_new.request_id IS NULL THEN
    -- Client row serialization also coordinates with inbound property-request creation.
    -- Advisory lock covers two different operation keys or employees visiting the same listing.
    PERFORM 1 FROM public.clients WHERE id=v_new.client_id AND company_id=v_company FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='viewing_client_not_allowed'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('viewing-request:'||v_company::text||':'||v_new.client_id::text||':'||v_new.property_id::text||':'||v_request_type,0));
    SELECT r.id INTO v_new.request_id FROM public.client_requests r
      WHERE r.company_id=v_company AND r.client_id=v_new.client_id
        AND r.subject_property_id=v_new.property_id AND r.status IN ('active','paused')
        AND r.request_type=v_request_type AND coalesce(r.branch_key,r.route_key,'general')=v_property_branch
        AND crm_repair_private.can_access_request(v_company,r.id)
      ORDER BY (r.status='active') DESC,r.created_at,r.id LIMIT 1;
    IF v_new.request_id IS NULL THEN
      -- A single compatible general request may serve the visit, without altering its scope.
      -- Multiple candidates remain independent: create an exact property request instead of guessing.
      SELECT count(*),(array_agg(r.id ORDER BY r.created_at,r.id))[1] INTO v_request_count,v_new.request_id
      FROM public.client_requests r
      WHERE r.company_id=v_company AND r.client_id=v_new.client_id
        AND r.subject_property_id IS NULL AND r.status IN ('active','paused')
        AND r.request_type=v_request_type AND coalesce(r.branch_key,r.route_key,'general')=v_property_branch
        AND (coalesce(cardinality(r.property_types),0)=0 AND (r.property_type IS NULL OR r.property_type=v_property_type)
          OR v_property_type=ANY(r.property_types))
        AND (coalesce(cardinality(r.preferred_areas),0)=0 AND (r.preferred_area IS NULL OR r.preferred_area=v_property_area)
          OR v_property_area=ANY(r.preferred_areas))
        AND (r.wilayat IS NULL OR r.wilayat=v_property_wilayat)
        AND (r.budget_min IS NULL OR v_property_price>=r.budget_min)
        AND (r.budget_max IS NULL OR v_property_price<=r.budget_max)
        AND (r.bedrooms_min IS NULL OR v_property_bedrooms>=r.bedrooms_min)
        AND (r.bathrooms_min IS NULL OR v_property_bathrooms>=r.bathrooms_min)
        AND (r.land_size_min IS NULL OR v_property_land>=r.land_size_min)
        AND (r.land_size_max IS NULL OR v_property_land<=r.land_size_max)
        AND (r.built_size_min IS NULL OR v_property_built>=r.built_size_min)
        AND (r.built_size_max IS NULL OR v_property_built<=r.built_size_max)
        AND r.furnished IS NULL -- listing schema has no furnishing evidence
        AND crm_repair_private.can_access_request(v_company,r.id);
      IF v_request_count<>1 THEN v_new.request_id:=NULL; END IF;
    END IF;
    IF v_new.request_id IS NULL THEN
      INSERT INTO public.client_requests(company_id,client_id,request_type,subject_property_id,
        branch_key,route_key,assigned_to,property_type,property_types,preferred_area,preferred_areas,wilayat,
        status,pipeline_stage,created_via,source,source_detail,created_by,updated_by)
      VALUES(v_company,v_new.client_id,v_request_type,v_new.property_id,v_property_branch,v_property_branch,
        v_new.agent_id,v_property_type,CASE WHEN v_property_type IS NULL THEN '{}'::text[] ELSE ARRAY[v_property_type] END,
        v_property_area,CASE WHEN v_property_area IS NULL THEN '{}'::text[] ELSE ARRAY[v_property_area] END,v_property_wilayat,
        'active','new','manual','viewing','طلب مرتبط بالعقار أنشئ أثناء تسجيل الزيارة',v_user,v_user)
      RETURNING id INTO v_new.request_id;
    END IF;
  END IF;
  IF NOT crm_repair_private.can_access_request(v_company,v_new.request_id) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='viewing_request_not_allowed';
  END IF;
  SELECT coalesce(branch_key,route_key,'general'),request_type,subject_property_id,status
    INTO v_request_branch,v_request_type,v_request_subject,v_request_status
    FROM public.client_requests WHERE id=v_new.request_id AND company_id=v_company AND client_id=v_new.client_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='viewing_request_client_mismatch'; END IF;
  -- Old visits keep their existing journey. New links must fit this property, branch and purpose.
  IF v_old.request_id IS NULL AND (v_request_branch<>v_property_branch
    OR v_request_subject IS NOT NULL AND v_request_subject<>v_new.property_id
    OR v_request_type<>coalesce(nullif(p_payload->>'request_type',''),'buyer')
    OR v_request_status NOT IN ('active','paused')) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='viewing_request_property_or_type_mismatch';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=v_new.agent_id AND company_id=v_company AND is_active IS TRUE
    AND role IN('owner','manager','agent')) OR (v_role='agent' AND v_new.agent_id<>v_user) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='viewing_agent_not_allowed';
  END IF;

  -- A genuinely completed, date-only visit may have no appointment or invented time.
  -- Known appointment times still follow normal edit validation and remain protected.
  IF NOT v_date_only_completed THEN
  -- Each timed manual visit has one appointment. Do not edit a shared appointment.
  v_appointment:=v_old.appointment_id;
  IF v_appointment IS NOT NULL THEN
    SELECT appointment_at INTO v_existing_time FROM public.appointments
      WHERE id=v_appointment AND company_id=v_company AND client_id=v_new.client_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='viewing_appointment_not_allowed'; END IF;
    IF EXISTS(SELECT 1 FROM public.viewings WHERE appointment_id=v_appointment AND id<>v_new.id) THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='shared_appointment_requires_separate_review';
    END IF;
  END IF;
  IF v_new.viewing_time IS NULL THEN
    IF v_id IS NULL OR v_old.viewing_time IS NOT NULL OR v_new.viewing_date<>v_old.viewing_date THEN
      RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='viewing_time_required';
    END IF;
    v_appointment_at:=v_existing_time;
  ELSE
    v_appointment_at:=(v_new.viewing_date+v_new.viewing_time) AT TIME ZONE 'Asia/Muscat';
  END IF;
  IF v_appointment_at IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='viewing_time_required'; END IF;
  v_appointment_status:=CASE v_new.status WHEN 'done' THEN 'attended' WHEN 'postponed' THEN 'rescheduled' ELSE v_new.status END;
  IF v_appointment IS NULL THEN
    INSERT INTO public.appointments(company_id,client_id,request_id,branch_key,agent_id,appointment_at,status,
      confirmed_at,attended_at,visit_notes,result,next_action,next_followup,created_by)
    VALUES(v_company,v_new.client_id,v_new.request_id,v_request_branch,v_new.agent_id,v_appointment_at,v_appointment_status,
      CASE WHEN v_new.status IN('confirmed','done') THEN v_appointment_at END,
      CASE WHEN v_new.status='done' THEN v_appointment_at END,v_new.notes,v_new.pipeline_outcome,v_new.next_step,v_new.followup_date,v_user)
    RETURNING id INTO v_appointment;
  ELSE
    UPDATE public.appointments SET request_id=v_new.request_id,branch_key=v_request_branch,agent_id=v_new.agent_id,
      appointment_at=v_appointment_at,status=v_appointment_status,
      confirmed_at=CASE WHEN v_new.status IN('confirmed','done') THEN coalesce(confirmed_at,v_appointment_at) ELSE confirmed_at END,
      attended_at=CASE WHEN v_new.status='done' THEN coalesce(attended_at,v_appointment_at) ELSE attended_at END,
      visit_notes=v_new.notes,result=v_new.pipeline_outcome,next_action=v_new.next_step,next_followup=v_new.followup_date,updated_at=now()
    WHERE id=v_appointment AND company_id=v_company;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='appointment_update_not_allowed'; END IF;
  END IF;
  INSERT INTO public.appointment_properties(company_id,appointment_id,property_id)
    VALUES(v_company,v_appointment,v_new.property_id)
    ON CONFLICT(company_id,appointment_id,property_id) DO NOTHING;
  END IF; -- timed visit appointment
  v_new.appointment_id:=v_appointment;
  IF v_id IS NULL THEN
    INSERT INTO public.viewings(id,company_id,client_id,property_id,agent_id,request_id,appointment_id,viewing_date,
      viewing_time,duration_minutes,location,status,attendance,client_feedback,rejection_reason,pipeline_outcome,
      outcome_note,next_step,followup_date,notes,archived,created_by,created_via)
    VALUES(v_new.id,v_company,v_new.client_id,v_new.property_id,v_new.agent_id,v_new.request_id,v_appointment,
      v_new.viewing_date,v_new.viewing_time,v_new.duration_minutes,v_new.location,v_new.status,v_new.attendance,
      v_new.client_feedback,v_new.rejection_reason,v_new.pipeline_outcome,v_new.outcome_note,v_new.next_step,
      v_new.followup_date,v_new.notes,false,v_user,'manual');
  ELSE
    UPDATE public.viewings SET agent_id=v_new.agent_id,request_id=v_new.request_id,appointment_id=v_appointment,
      viewing_date=v_new.viewing_date,viewing_time=v_new.viewing_time,duration_minutes=v_new.duration_minutes,
      location=v_new.location,status=v_new.status,attendance=v_new.attendance,client_feedback=v_new.client_feedback,
      rejection_reason=v_new.rejection_reason,pipeline_outcome=v_new.pipeline_outcome,outcome_note=v_new.outcome_note,
      next_step=v_new.next_step,followup_date=v_new.followup_date,notes=v_new.notes
    WHERE id=v_new.id AND company_id=v_company AND row_version=v_expected;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='viewing_changed_or_update_not_allowed'; END IF;
  END IF;

  SELECT id INTO v_task FROM public.tasks WHERE company_id=v_company AND viewing_id=v_new.id AND done IS FALSE FOR UPDATE;
  IF v_new.followup_date IS NOT NULL THEN
    IF v_task IS NULL THEN
      INSERT INTO public.tasks(company_id,user_id,client_id,request_id,viewing_id,title,notes,due_date,priority,done)
      VALUES(v_company,v_new.agent_id,v_new.client_id,v_new.request_id,v_new.id,
        'متابعة نتيجة الزيارة: '||coalesce(v_property_title,'العقار'),v_new.next_step,v_new.followup_date,'high',false)
      RETURNING id INTO v_task;
    ELSE
      UPDATE public.tasks SET user_id=v_new.agent_id,request_id=v_new.request_id,due_date=v_new.followup_date,
        notes=v_new.next_step,priority='high' WHERE id=v_task;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='followup_task_update_not_allowed'; END IF;
    END IF;
  ELSIF v_task IS NOT NULL THEN
    v_warnings:=jsonb_build_array('existing_followup_task_retained');
  END IF;
  INSERT INTO public.activities(company_id,user_id,client_id,property_id,request_id,appointment_id,
    type,description,activity_type,activity_text,channel,direction,actor_type,after_data)
  VALUES(v_company,v_user,v_new.client_id,v_new.property_id,v_new.request_id,v_appointment,
    'system','حفظ زيارة','system','حفظ زيارة','system','internal','human',
    jsonb_build_object('entity_type','viewing','entity_id',v_new.id,'operation_key',p_idempotency_key));
  SELECT * INTO v_saved FROM public.viewings WHERE id=v_new.id AND company_id=v_company;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='saved_viewing_not_readable'; END IF;
  INSERT INTO crm_repair_private.viewing_save_operations(operation_key,user_id,company_id,payload_hash,
    viewing_id,appointment_id,followup_task_id,warnings)
  VALUES(p_idempotency_key,v_user,v_company,v_hash,v_saved.id,v_appointment,v_task,v_warnings);
  RETURN jsonb_build_object('ok',true,'viewing_id',v_saved.id,'appointment_id',v_appointment,
    'followup_task_id',v_task,'viewing',to_jsonb(v_saved),'warnings',v_warnings,'replayed',false);
END;
$function$;

REVOKE ALL ON FUNCTION public.crm_save_viewing_atomic(jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_save_viewing_atomic(jsonb,uuid) TO authenticated;
-- A visit is evidence only for its own request; keep other journeys independent.
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
    and request_id IS NOT DISTINCT FROM new.request_id
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
REVOKE ALL ON FUNCTION crm_repair_private.link_viewing_interest() FROM PUBLIC,anon,authenticated;
COMMIT;
