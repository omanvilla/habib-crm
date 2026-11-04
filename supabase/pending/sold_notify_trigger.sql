-- NOT APPLIED YET: needs Ahmed's approval at the computer.
-- When a property becomes sold/reserved, fill the "انحجزت" outreach queue (rows wait for approval).
create or replace function public.crm_queue_sold_notice() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('sold','reserved') and old.status is distinct from new.status then
    perform net.http_post(
      url := 'https://dmsckqjkcnsfmnzfjczz.supabase.co/functions/v1/whatsapp-sold-notify',
      headers := jsonb_build_object('content-type','application/json','x-crm-agent',(select decrypted_secret from vault.decrypted_secrets where name='crm_reply_agent')),
      body := jsonb_build_object('property_id', new.id, 'dry_run', false));
  end if;
  return new;
end $$;
create trigger trg_queue_sold_notice after update of status on public.properties
  for each row execute function public.crm_queue_sold_notice();
