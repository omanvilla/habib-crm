BEGIN;
CREATE OR REPLACE FUNCTION public.crm_replace_rejection_reasons(
  p_inquiry_id uuid,p_reason_ids uuid[],p_primary_id uuid,p_phase text,p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE v_company uuid:=public.my_company(); v_user uuid:=auth.uid();
  v_inquiry public.property_inquiries%rowtype; v_ids uuid[]; v_primary uuid; v_count integer;
BEGIN
  IF v_user IS NULL OR v_company IS NULL OR public.my_role() NOT IN('owner','manager','agent') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not_allowed';
  END IF;
  SELECT * INTO v_inquiry FROM public.property_inquiries
    WHERE id=p_inquiry_id AND company_id=v_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='inquiry_not_found_or_not_allowed'; END IF;
  IF public.my_role()='agent' AND v_inquiry.assigned_to IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='inquiry_update_not_allowed';
  END IF;
  IF coalesce(p_phase,'unknown') NOT IN('pre_visit','post_visit','unknown') THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid_rejection_phase';
  END IF;
  SELECT coalesce(array_agg(DISTINCT x),'{}'::uuid[]) INTO v_ids FROM unnest(coalesce(p_reason_ids,'{}'::uuid[])) x WHERE x IS NOT NULL;
  IF cardinality(v_ids)>30 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='too_many_rejection_reasons'; END IF;
  IF p_primary_id IS NOT NULL AND NOT(p_primary_id=ANY(v_ids)) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='primary_reason_must_be_selected';
  END IF;
  SELECT count(*) INTO v_count FROM public.rejection_reasons r WHERE r.id=ANY(v_ids)
    AND r.is_active IS TRUE AND (r.company_id IS NULL OR r.company_id=v_company);
  IF v_count<>cardinality(v_ids) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='rejection_reason_not_allowed'; END IF;
  v_primary:=coalesce(p_primary_id,v_ids[1]);
  DELETE FROM public.property_rejection_reasons WHERE property_inquiry_id=p_inquiry_id AND company_id=v_company;
  INSERT INTO public.property_rejection_reasons(company_id,property_inquiry_id,client_id,request_id,
    property_id,reason_id,is_primary,phase,note,created_by)
  SELECT v_company,p_inquiry_id,v_inquiry.client_id,v_inquiry.request_id,v_inquiry.property_id,
    x,x=v_primary,coalesce(p_phase,'unknown'),nullif(btrim(p_note),''),v_user FROM unnest(v_ids) x;
  RETURN jsonb_build_object('ok',true,'count',cardinality(v_ids),'inquiry_id',p_inquiry_id);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_replace_rejection_reasons(uuid,uuid[],uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_replace_rejection_reasons(uuid,uuid[],uuid,text,text) TO authenticated;
COMMIT;
