BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION crm_repair_private.sync_property_status_internal(p_property_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_company uuid; v_current text; v_status text;
BEGIN
  SELECT company_id,status INTO v_company,v_current FROM public.properties WHERE id=p_property_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF EXISTS(SELECT 1 FROM public.deals WHERE company_id=v_company AND property_id=p_property_id
    AND stage IN('closed','commission_collected')) THEN v_status:='sold';
  ELSIF EXISTS(SELECT 1 FROM public.deals WHERE company_id=v_company AND property_id=p_property_id
    AND stage IN('deposit','awaiting_finance','finance_approved','awaiting_clearance','ownership_transfer')) THEN v_status:='reserved';
  ELSE
    -- Never release a manually blocked/sold/reserved listing merely because another deal is lost.
    -- A manual release remains an explicit property edit after checking all active deals.
    v_status:=v_current;
  END IF;
  IF v_status IS DISTINCT FROM v_current THEN
    UPDATE public.properties SET status=v_status,updated_at=now() WHERE id=p_property_id;
  END IF;
  RETURN v_status;
END;
$$;
REVOKE ALL ON FUNCTION crm_repair_private.sync_property_status_internal(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION crm_repair_private.sync_property_status_checked(p_property_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_company uuid:=public.my_company(); v_status text;
BEGIN
  IF auth.uid() IS NULL OR v_company IS NULL OR public.my_role() NOT IN('owner','manager','agent')
    OR NOT EXISTS(SELECT 1 FROM public.properties WHERE id=p_property_id AND company_id=v_company) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='property_not_allowed';
  END IF;
  v_status:=crm_repair_private.sync_property_status_internal(p_property_id);
  RETURN jsonb_build_object('ok',true,'property_id',p_property_id,'status',v_status);
END;
$$;
REVOKE ALL ON FUNCTION crm_repair_private.sync_property_status_checked(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION crm_repair_private.sync_property_status_checked(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.crm_sync_property_status(p_property_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $$ SELECT crm_repair_private.sync_property_status_checked(p_property_id) $$;
REVOKE ALL ON FUNCTION public.crm_sync_property_status(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_sync_property_status(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION crm_repair_private.guard_property_deal_state()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF new.status IS DISTINCT FROM old.status AND new.status<>'sold' AND
    EXISTS(SELECT 1 FROM public.deals d WHERE d.property_id=new.id AND d.company_id=new.company_id
      AND d.stage IN('closed','commission_collected')) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='property_has_completed_deal';
  END IF;
  IF new.status='available' AND EXISTS(SELECT 1 FROM public.deals d
    WHERE d.property_id=new.id AND d.company_id=new.company_id
      AND d.stage IN('deposit','awaiting_finance','finance_approved','awaiting_clearance','ownership_transfer')) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='property_has_active_reservation';
  END IF;
  RETURN new;
END;
$$;
REVOKE ALL ON FUNCTION crm_repair_private.guard_property_deal_state() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER crm_guard_property_deal_state BEFORE UPDATE OF status ON public.properties
  FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_property_deal_state();

CREATE OR REPLACE FUNCTION crm_repair_private.sync_property_after_deal_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF old.property_id IS NOT NULL THEN PERFORM crm_repair_private.sync_property_status_internal(old.property_id); END IF;
    RETURN old;
  END IF;
  IF new.property_id IS NOT NULL THEN PERFORM crm_repair_private.sync_property_status_internal(new.property_id); END IF;
  IF TG_OP='UPDATE' AND old.property_id IS DISTINCT FROM new.property_id AND old.property_id IS NOT NULL THEN
    PERFORM crm_repair_private.sync_property_status_internal(old.property_id);
  END IF;
  RETURN new;
END;
$$;
REVOKE ALL ON FUNCTION crm_repair_private.sync_property_after_deal_change() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER crm_sync_property_after_deal_change AFTER INSERT OR DELETE OR UPDATE OF stage,property_id ON public.deals
  FOR EACH ROW EXECUTE FUNCTION crm_repair_private.sync_property_after_deal_change();

CREATE OR REPLACE FUNCTION public.crm_delete_deal_atomic(p_deal_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE v_company uuid:=public.my_company(); v_property uuid; v_stage text; v_status text;
BEGIN
  IF auth.uid() IS NULL OR v_company IS NULL OR public.my_role() NOT IN('owner','manager') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not_allowed';
  END IF;
  SELECT property_id,stage INTO v_property,v_stage FROM public.deals WHERE id=p_deal_id AND company_id=v_company FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='deal_not_found_or_not_allowed'; END IF;
  IF v_stage IN('closed','commission_collected') THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='completed_deal_requires_explicit_reversal';
  END IF;
  IF EXISTS(SELECT 1 FROM public.deposits WHERE deal_id=p_deal_id AND company_id=v_company) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='deal_has_deposits_cannot_delete';
  END IF;
  DELETE FROM public.deals WHERE id=p_deal_id AND company_id=v_company;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='deal_delete_not_allowed'; END IF;
  SELECT status INTO v_status FROM public.properties WHERE id=v_property AND company_id=v_company;
  RETURN jsonb_build_object('ok',true,'deal_id',p_deal_id,'property_id',v_property,'property_status',v_status);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_delete_deal_atomic(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_delete_deal_atomic(uuid) TO authenticated;
COMMIT;
