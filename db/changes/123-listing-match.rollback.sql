-- Rollback SQL123: the trigger fires on a status change only again, the siblings function goes, the test rows go back to pending.
SET LOCAL lock_timeout = '10s';
CREATE OR REPLACE FUNCTION public.crm_queue_property_outreach()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_action text;
begin
  if new.status in ('sold','reserved') and (tg_op = 'UPDATE' and old.status is distinct from new.status) then v_action := 'queue_sold';
  elsif new.status = 'available' and coalesce(new.archived,false) = false and (tg_op = 'INSERT' or old.status is distinct from new.status) then v_action := 'queue_listing';
  else return new; end if;
  perform net.http_post(
    url := 'https://dmsckqjkcnsfmnzfjczz.supabase.co/functions/v1/whatsapp-outreach',
    headers := jsonb_build_object('content-type','application/json','x-crm-agent',(select decrypted_secret from vault.decrypted_secrets where name='crm_reply_agent')),
    body := jsonb_build_object('action', v_action, 'property_id', new.id, 'dry_run', false));
  return new;
end $function$;
REVOKE EXECUTE ON FUNCTION public.crm_queue_property_outreach() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_queue_property_outreach ON public.properties;
CREATE TRIGGER trg_queue_property_outreach AFTER INSERT OR UPDATE OF status ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.crm_queue_property_outreach();
DROP FUNCTION IF EXISTS public.crm_unit_sibling_ids(uuid);
UPDATE public.whatsapp_outreach_queue SET status = 'pending', reason = NULL WHERE kind = 'new_listing' AND reason = 'stale_dry_run';
