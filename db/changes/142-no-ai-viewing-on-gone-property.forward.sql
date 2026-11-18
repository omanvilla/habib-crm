-- SQL142 (18 Nov 2026, audit of the replies sent in the last 24 hours, Ahmed: «إيوا ابدأ»).
-- What happened: M~ was told at 10:13 that «فيلا الرميس 59 هشام» was reserved, got the location of another villa and answered
-- «طيب»; the visit watcher (whatsapp-reply-agent watchVisit, which reads available AND reserved properties) saved a visit
-- for today 18:00 on the reserved villa, with a deal card in «viewing_scheduled».
-- Now: a visit the AI books from a chat (created_via = 'whatsapp_ai', scheduled or confirmed) on a property that is sold or
-- reserved is not saved at all. A visit the client says he already made (done) is still saved, and visits typed in by
-- the office are untouched. Fires before the other BEFORE INSERT triggers (name order), so no request or deal is linked.
-- Rollback: 142-no-ai-viewing-on-gone-property.rollback.sql
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION crm_repair_private.skip_ai_viewing_on_gone_property()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO ''
AS $function$
begin
  if new.created_via = 'whatsapp_ai' and coalesce(new.status, 'scheduled') in ('scheduled', 'confirmed')
     and exists (select 1 from public.properties p where p.id = new.property_id and p.status in ('sold', 'reserved')) then
    return null;
  end if;
  return new;
end
$function$;

DROP TRIGGER IF EXISTS crm_aa_skip_ai_viewing_on_gone_property ON public.viewings;
CREATE TRIGGER crm_aa_skip_ai_viewing_on_gone_property BEFORE INSERT ON public.viewings
  FOR EACH ROW EXECUTE FUNCTION crm_repair_private.skip_ai_viewing_on_gone_property();
