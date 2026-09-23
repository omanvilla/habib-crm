-- No data backfill. Existing nonblank invalid phones are not silently rewritten.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE OR REPLACE FUNCTION public.normalize_crm_phone(p_phone text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = ''
AS $$
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
$$;
CREATE OR REPLACE FUNCTION public.set_client_phone_normalized()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  new.phone_normalized:=public.normalize_crm_phone(new.phone);
  IF coalesce(btrim(new.phone),'')<>'' AND new.phone_normalized IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='phone_invalid';
  END IF;
  RETURN new;
END;
$$;

ALTER TABLE public.clients ADD CONSTRAINT crm_clients_budget_valid
  CHECK ((budget_min IS NULL OR budget_min>=0) AND (budget_max IS NULL OR budget_max>=0)
    AND (budget_min IS NULL OR budget_max IS NULL OR budget_min<=budget_max)) NOT VALID;
ALTER TABLE public.properties ADD CONSTRAINT crm_properties_numbers_valid
  CHECK ((price IS NULL OR price>=0) AND (owner_net IS NULL OR owner_net>=0)
    AND (land_size IS NULL OR land_size>=0) AND (built_size IS NULL OR built_size>=0)
    AND (bedrooms IS NULL OR bedrooms>=0) AND (bathrooms IS NULL OR bathrooms>=0)) NOT VALID;
ALTER TABLE public.viewings ADD CONSTRAINT crm_viewings_status_valid
  CHECK (status IS NOT NULL AND status IN('scheduled','confirmed','done','cancelled','no_show','postponed')) NOT VALID;
ALTER TABLE public.viewings ADD CONSTRAINT crm_viewings_duration_valid
  CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 1440) NOT VALID;
ALTER TABLE public.viewings ADD CONSTRAINT crm_viewings_required_refs
  CHECK (company_id IS NOT NULL AND client_id IS NOT NULL AND property_id IS NOT NULL) NOT VALID;

-- Abort the whole stage if a concurrent/legacy row violates the proposed rules.
ALTER TABLE public.clients VALIDATE CONSTRAINT crm_clients_budget_valid;
ALTER TABLE public.properties VALIDATE CONSTRAINT crm_properties_numbers_valid;
ALTER TABLE public.viewings VALIDATE CONSTRAINT crm_viewings_status_valid;
ALTER TABLE public.viewings VALIDATE CONSTRAINT crm_viewings_duration_valid;
ALTER TABLE public.viewings VALIDATE CONSTRAINT crm_viewings_required_refs;

CREATE OR REPLACE FUNCTION crm_repair_private.stamp_first_client_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  -- Serialize first-request decisions for this one client, including server ingestion.
  PERFORM 1 FROM public.clients c WHERE c.id=new.client_id AND c.company_id=new.company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='request_client_company_mismatch'; END IF;
  new.is_first_request:=NOT EXISTS(SELECT 1 FROM public.client_requests r
    WHERE r.client_id=new.client_id AND r.company_id=new.company_id);
  RETURN new;
END;
$$;
REVOKE ALL ON FUNCTION crm_repair_private.stamp_first_client_request() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER crm_stamp_first_client_request BEFORE INSERT ON public.client_requests
  FOR EACH ROW EXECUTE FUNCTION crm_repair_private.stamp_first_client_request();
COMMIT;
