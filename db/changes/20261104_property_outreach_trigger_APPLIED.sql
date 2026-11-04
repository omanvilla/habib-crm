-- NOT APPLIED YET: needs Ahmed's approval at the computer (database trigger).
-- A property that becomes sold/reserved queues the "انحجزت" notice; a property that becomes available
-- queues the new-listing message to matching open requests. Rows only wait for approval, nothing is sent.
create or replace function public.crm_queue_property_outreach() returns trigger language plpgsql security definer set search_path = public as $$
declare v_action text;
begin
  if new.status in ('sold','reserved') and old.status is distinct from new.status then v_action := 'queue_sold';
  elsif new.status = 'available' and coalesce(new.archived,false) = false and (tg_op = 'INSERT' or old.status is distinct from new.status) then v_action := 'queue_listing';
  else return new; end if;
  perform net.http_post(
    url := 'https://dmsckqjkcnsfmnzfjczz.supabase.co/functions/v1/whatsapp-outreach',
    headers := jsonb_build_object('content-type','application/json','x-crm-agent',(select decrypted_secret from vault.decrypted_secrets where name='crm_reply_agent')),
    body := jsonb_build_object('action', v_action, 'property_id', new.id, 'dry_run', false));
  return new;
end $$;
create trigger trg_queue_property_outreach after insert or update of status on public.properties
  for each row execute function public.crm_queue_property_outreach();
