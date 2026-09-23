BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.viewings ADD COLUMN row_version bigint NOT NULL DEFAULT 1;
ALTER TABLE public.viewings ADD COLUMN updated_at timestamptz;
ALTER TABLE public.viewings ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.tasks ADD COLUMN viewing_id uuid REFERENCES public.viewings(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX crm_one_open_viewing_followup ON public.tasks(company_id,viewing_id)
  WHERE viewing_id IS NOT NULL AND done IS FALSE;

CREATE TABLE crm_repair_private.viewing_save_operations (
  operation_key uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(id),
  company_id uuid NOT NULL REFERENCES public.companies(id),
  payload_hash text NOT NULL,
  viewing_id uuid REFERENCES public.viewings(id) ON DELETE SET NULL,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE SET NULL,
  followup_task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,operation_key)
);
CREATE INDEX crm_tasks_viewing_fk_idx ON public.tasks(viewing_id) WHERE viewing_id IS NOT NULL;
CREATE INDEX viewing_save_operations_company_fk_idx ON crm_repair_private.viewing_save_operations(company_id);
CREATE INDEX viewing_save_operations_viewing_fk_idx ON crm_repair_private.viewing_save_operations(viewing_id) WHERE viewing_id IS NOT NULL;
CREATE INDEX viewing_save_operations_appointment_fk_idx ON crm_repair_private.viewing_save_operations(appointment_id) WHERE appointment_id IS NOT NULL;
CREATE INDEX viewing_save_operations_task_fk_idx ON crm_repair_private.viewing_save_operations(followup_task_id) WHERE followup_task_id IS NOT NULL;
ALTER TABLE crm_repair_private.viewing_save_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_repair_private.viewing_save_operations FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT ON crm_repair_private.viewing_save_operations TO authenticated;
GRANT ALL ON crm_repair_private.viewing_save_operations TO service_role;
CREATE POLICY viewing_save_operations_read ON crm_repair_private.viewing_save_operations
FOR SELECT TO authenticated USING (user_id=(SELECT auth.uid()) AND company_id=(SELECT public.my_company()));
CREATE POLICY viewing_save_operations_insert ON crm_repair_private.viewing_save_operations
FOR INSERT TO authenticated WITH CHECK (user_id=(SELECT auth.uid()) AND company_id=(SELECT public.my_company())
  AND (SELECT public.my_role()) IN('owner','manager','agent'));

CREATE OR REPLACE FUNCTION crm_repair_private.validate_viewing_refs_and_version()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
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
$$;
REVOKE ALL ON FUNCTION crm_repair_private.validate_viewing_refs_and_version() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER crm_validate_viewing_refs_and_version BEFORE INSERT OR UPDATE ON public.viewings
  FOR EACH ROW EXECUTE FUNCTION crm_repair_private.validate_viewing_refs_and_version();

CREATE OR REPLACE FUNCTION public.crm_save_viewing_atomic(p_payload jsonb,p_idempotency_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_company uuid:=public.my_company(); v_user uuid:=auth.uid(); v_role text:=public.my_role();
  v_old public.viewings%rowtype; v_new public.viewings%rowtype; v_saved public.viewings%rowtype;
  v_op crm_repair_private.viewing_save_operations%rowtype;
  v_hash text; v_id uuid; v_task uuid; v_appointment uuid; v_appointment_at timestamptz;
  v_appointment_status text; v_request_branch text; v_warnings jsonb:='[]'::jsonb;
  v_existing_time timestamptz; v_property_title text; v_expected bigint;
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
  v_new:=jsonb_populate_record(v_old,p_payload-'expected_version');
  v_new.id:=coalesce(v_id,gen_random_uuid()); v_new.company_id:=v_company;
  v_new.agent_id:=coalesce(v_new.agent_id,v_user);
  v_new.created_by:=coalesce(v_old.created_by,v_user);
  v_new.created_at:=coalesce(v_old.created_at,now());
  v_new.created_via:=coalesce(v_old.created_via,'manual');
  v_new.status:=coalesce(v_new.status,'scheduled');
  v_new.duration_minutes:=coalesce(v_new.duration_minutes,60);
  v_new.archived:=coalesce(v_old.archived,false);
  IF v_new.client_id IS NULL OR v_new.property_id IS NULL OR v_new.request_id IS NULL OR v_new.viewing_date IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='viewing_client_property_request_date_required';
  END IF;
  IF v_id IS NULL AND v_new.viewing_time IS NULL THEN
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
  IF v_new.status='done' AND v_new.pipeline_outcome IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='viewing_outcome_required';
  END IF;
  IF v_new.status='done' AND v_new.pipeline_outcome='lost' AND
    (nullif(btrim(v_new.rejection_reason),'') IS NULL OR
      coalesce(nullif(btrim(v_new.outcome_note),''),nullif(btrim(v_new.notes),'')) IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='viewing_rejection_reason_and_note_required';
  END IF;
  IF NOT crm_repair_private.can_access_client(v_company,v_new.client_id)
    OR NOT crm_repair_private.can_access_request(v_company,v_new.request_id) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='viewing_client_or_request_not_allowed';
  END IF;
  SELECT branch_key INTO v_request_branch FROM public.client_requests
    WHERE id=v_new.request_id AND company_id=v_company AND client_id=v_new.client_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='viewing_request_client_mismatch'; END IF;
  SELECT title INTO v_property_title FROM public.properties WHERE id=v_new.property_id AND company_id=v_company;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='viewing_property_not_allowed'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=v_new.agent_id AND company_id=v_company AND is_active IS TRUE
    AND role IN('owner','manager','agent')) OR (v_role='agent' AND v_new.agent_id<>v_user) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='viewing_agent_not_allowed';
  END IF;

  -- Each manual visit has one appointment. Do not edit an appointment shared with other visits.
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
$$;
REVOKE ALL ON FUNCTION public.crm_save_viewing_atomic(jsonb,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_save_viewing_atomic(jsonb,uuid) TO authenticated;
COMMIT;
