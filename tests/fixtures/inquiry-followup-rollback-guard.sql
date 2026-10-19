CREATE OR REPLACE FUNCTION public.crm_save_inquiry_followup(p_payload jsonb,p_idempotency_key uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$ BEGIN RETURN jsonb_build_object('synthetic_later_version',true); END $$;
