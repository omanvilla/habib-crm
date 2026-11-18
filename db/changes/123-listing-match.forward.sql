-- SQL123 (18 Nov 2026, Ahmed: «نعم سوي اقتراحك»). The «نزل عندنا … ممكن يناسب طلبك» message (whatsapp-outreach queue_listing):
--   1. public.crm_unit_sibling_ids(property): the available units of the same group (SQL97 unit_siblings), for the outreach
--      function only (service role). A client already offered «69 -2» is not offered «69 -3» as news.
--   2. The property trigger also fires when the price of an available property drops by 2 percent or more: the same
--      queue_listing runs with price_drop=true, and reaches only clients the new price now fits (everyone offered this
--      property before is skipped). Rows still wait for Ahmed's approval, nothing is sent by itself.
--   3. The 21 test rows (dry_run) of 4 Nov still «pending» become skipped (reason stale_dry_run). Nothing is deleted.
-- The scoring and the limit of 20 per property are in supabase/functions/_shared/listing-match.mjs.
-- Rollback: 123-listing-match.rollback.sql
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.crm_unit_sibling_ids(p_property uuid)
 RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$ SELECT coalesce(array_agg(s.id), '{}'::uuid[]) FROM crm_repair_private.unit_siblings(p_property) s $function$;
REVOKE ALL ON FUNCTION public.crm_unit_sibling_ids(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_unit_sibling_ids(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.crm_queue_property_outreach()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_action text; v_drop boolean := false;
begin
  if new.status in ('sold','reserved') and (tg_op = 'UPDATE' and old.status is distinct from new.status) then v_action := 'queue_sold';
  elsif new.status = 'available' and coalesce(new.archived,false) = false and (tg_op = 'INSERT' or old.status is distinct from new.status) then v_action := 'queue_listing';
  elsif tg_op = 'UPDATE' and new.status = 'available' and coalesce(new.archived,false) = false and old.status = new.status
        and coalesce(old.price,0) > 0 and coalesce(new.price,0) > 0 and new.price <= old.price * 0.98 then
    v_action := 'queue_listing'; v_drop := true;
  else return new; end if;
  perform net.http_post(
    url := 'https://dmsckqjkcnsfmnzfjczz.supabase.co/functions/v1/whatsapp-outreach',
    headers := jsonb_build_object('content-type','application/json','x-crm-agent',(select decrypted_secret from vault.decrypted_secrets where name='crm_reply_agent')),
    body := jsonb_build_object('action', v_action, 'property_id', new.id, 'dry_run', false, 'price_drop', v_drop));
  return new;
end $function$;
REVOKE EXECUTE ON FUNCTION public.crm_queue_property_outreach() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_queue_property_outreach ON public.properties;
CREATE TRIGGER trg_queue_property_outreach AFTER INSERT OR UPDATE OF status, price ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.crm_queue_property_outreach();

UPDATE public.whatsapp_outreach_queue SET status = 'skipped', reason = 'stale_dry_run'
 WHERE kind = 'new_listing' AND dry_run = true AND status = 'pending' AND created_at < '2026-11-05';
