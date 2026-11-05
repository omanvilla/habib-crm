-- Rollback for SQL62. Publish the front end without the twin questions first.
-- Removes the extra publication rows. Inquiries already counted on a twin stay as history.
DROP FUNCTION IF EXISTS public.crm_instagram_link_twins(uuid, timestamptz, uuid[]);
DROP FUNCTION IF EXISTS public.crm_dismiss_twin_group(text);
DROP FUNCTION IF EXISTS public.crm_link_twin_group(uuid[]);
DROP FUNCTION IF EXISTS public.crm_property_twins();
DROP FUNCTION IF EXISTS crm_repair_private.add_video_twin(uuid, uuid);
DROP TRIGGER IF EXISTS crm_mirror_twin_attribution ON public.property_message_attributions;
DROP FUNCTION IF EXISTS crm_repair_private.mirror_twin_attribution();
DROP TRIGGER IF EXISTS zz_guard_video_one_property ON public.property_marketing_events;
DROP FUNCTION IF EXISTS crm_repair_private.guard_video_one_property();
UPDATE public.property_inquiries SET marketing_event_id = NULL WHERE marketing_event_id IN (SELECT id FROM public.property_marketing_events WHERE twin_of IS NOT NULL);
UPDATE public.property_message_attributions SET marketing_event_id = NULL WHERE marketing_event_id IN (SELECT id FROM public.property_marketing_events WHERE twin_of IS NOT NULL);
DELETE FROM public.property_marketing_events WHERE twin_of IS NOT NULL;
DROP INDEX IF EXISTS public.property_marketing_property_link_unique;
DROP INDEX IF EXISTS public.property_marketing_property_media_unique;
CREATE UNIQUE INDEX property_marketing_link_key_unique ON public.property_marketing_events (company_id, link_key) WHERE link_key IS NOT NULL;
CREATE UNIQUE INDEX property_marketing_instagram_media_unique ON public.property_marketing_events (company_id, instagram_media_id) WHERE instagram_media_id IS NOT NULL;
ALTER TABLE public.property_marketing_events DROP COLUMN IF EXISTS twin_of;
DROP TABLE IF EXISTS public.property_twin_dismissals;
