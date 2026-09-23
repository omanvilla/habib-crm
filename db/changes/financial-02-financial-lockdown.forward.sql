REVOKE SELECT ON public.properties FROM PUBLIC,anon,authenticated;
GRANT SELECT ("id","company_id","added_by","title","type","area","price","bedrooms","bathrooms","land_size","built_size","status","description","images","views_count","inquiries_count","created_at","updated_at","owner_client_id","archived","archived_at","archived_by","owner_id","wilayat","source_type","marketing_status","property_code","internal_name","branch_key","availability_checked_at","performance_tracking_started_at","photography_status","photography_reason","photography_required_at","photography_completed_at","marketing_review_status","marketing_reviewed_at","marketing_review_note","last_ai_recommendation","last_ai_recommendation_at","public_details","map_url","has_listing_agreement","agreement_start_date","agreement_duration_months","agreement_end_date","agreement_reminder_days") ON public.properties TO authenticated;
CREATE OR REPLACE FUNCTION crm_repair_private.guard_properties_financial_fields() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $body$
BEGIN
 IF current_user IN ('authenticated','anon') AND COALESCE(public.my_role(),'') <> 'owner' THEN
  IF (TG_OP='INSERT' AND ((NEW."owner_net" IS NOT NULL) OR (NEW."expected_commission" IS NOT NULL))) OR (TG_OP='UPDATE' AND ((NEW."owner_net" IS DISTINCT FROM OLD."owner_net") OR (NEW."expected_commission" IS DISTINCT FROM OLD."expected_commission"))) THEN
   RAISE EXCEPTION 'المعلومات المالية متاحة لصاحب الشركة فقط' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END;
$body$;
REVOKE ALL ON FUNCTION crm_repair_private.guard_properties_financial_fields() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER crm_guard_properties_financial_fields BEFORE INSERT OR UPDATE ON public.properties
FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_properties_financial_fields();

REVOKE SELECT ON public.deals FROM PUBLIC,anon,authenticated;
GRANT SELECT ("id","company_id","client_id","property_id","agent_id","stage","deal_value","deposit_amount","closing_probability","expected_close_date","bank_financing","notes","closed_at","created_at","updated_at","broker_id","request_id","viewing_id","lost_reason_id","lost_reason_note","lost_from_stage","lost_at") ON public.deals TO authenticated;
CREATE OR REPLACE FUNCTION crm_repair_private.guard_deals_financial_fields() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $body$
BEGIN
 IF current_user IN ('authenticated','anon') AND COALESCE(public.my_role(),'') <> 'owner' THEN
  IF (TG_OP='INSERT' AND NEW.stage='commission_collected') OR (TG_OP='UPDATE' AND NEW.stage IS DISTINCT FROM OLD.stage AND (NEW.stage='commission_collected' OR OLD.stage='commission_collected')) THEN
   RAISE EXCEPTION 'تأكيد تحصيل العمولة أو تغييره متاح لصاحب الشركة فقط' USING ERRCODE='42501';
  END IF;
  IF (TG_OP='INSERT' AND ((NEW."company_commission" IS NOT NULL) OR (NEW."agent_commission" IS NOT NULL) OR (NEW."commission_total" IS NOT NULL) OR (NEW."company_share" IS NOT NULL) OR (NEW."agent_share" IS NOT NULL) OR (NEW."commission_status" IS NOT NULL AND NEW."commission_status" <> 'pending') OR (NEW."broker_commission" IS NOT NULL))) OR (TG_OP='UPDATE' AND ((NEW."company_commission" IS DISTINCT FROM OLD."company_commission") OR (NEW."agent_commission" IS DISTINCT FROM OLD."agent_commission") OR (NEW."commission_total" IS DISTINCT FROM OLD."commission_total") OR (NEW."company_share" IS DISTINCT FROM OLD."company_share") OR (NEW."agent_share" IS DISTINCT FROM OLD."agent_share") OR (NEW."commission_status" IS DISTINCT FROM OLD."commission_status") OR (NEW."broker_commission" IS DISTINCT FROM OLD."broker_commission"))) THEN
   RAISE EXCEPTION 'المعلومات المالية متاحة لصاحب الشركة فقط' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END;
$body$;
REVOKE ALL ON FUNCTION crm_repair_private.guard_deals_financial_fields() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER crm_guard_deals_financial_fields BEFORE INSERT OR UPDATE ON public.deals
FOR EACH ROW EXECUTE FUNCTION crm_repair_private.guard_deals_financial_fields();

NOTIFY pgrst, 'reload schema';
