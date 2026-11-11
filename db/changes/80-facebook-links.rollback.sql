-- Rollback of SQL80. Move or delete any 'facebook' journal rows / inquiries first, or the checks cannot be restored.
ALTER TABLE public.property_marketing_events DROP CONSTRAINT IF EXISTS property_marketing_events_channel_check;
ALTER TABLE public.property_marketing_events ADD CONSTRAINT property_marketing_events_channel_check
  CHECK (channel = ANY (ARRAY['instagram','oman_reel','youtube','signboard','referral','other']));
ALTER TABLE public.property_inquiries DROP CONSTRAINT IF EXISTS property_inquiries_source_check;
ALTER TABLE public.property_inquiries ADD CONSTRAINT property_inquiries_source_check
  CHECK (source = ANY (ARRAY['whatsapp','instagram','oman_reel','youtube','signboard','referral','website','other']));
CREATE OR REPLACE FUNCTION public.normalize_property_marketing_link(p_url text)
 RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE u text:=trim(coalesce(p_url,'')); m text[];
BEGIN
 u:=regexp_replace(replace(u,'&amp;','&'),'[\]\)\}>,.;!؟،]+$','','g');
 m:=regexp_match(u,'^(?:https?://)?(?:www\.)?(?:instagram\.com|instagr\.am)/(?:reel|reels|p|tv)/([A-Za-z0-9_-]+)(?:[/\?#]|$)','i');
 IF m IS NOT NULL THEN RETURN 'instagram:'||m[1]; END IF;
 m:=regexp_match(u,'^(?:https?://)?(?:www\.)?instagram\.com/share/(?:reel|p)/([A-Za-z0-9_-]+)(?:[/\?#]|$)','i');
 IF m IS NOT NULL THEN RETURN 'instagram-share:'||m[1]; END IF;
 m:=regexp_match(u,'^(?:https?://)?(?:www\.)?youtu\.be/([A-Za-z0-9_-]+)(?:[/\?#]|$)','i');
 IF m IS NOT NULL THEN RETURN 'youtube:'||m[1]; END IF;
 m:=regexp_match(u,'^(?:https?://)?(?:www\.)?youtube\.com/shorts/([A-Za-z0-9_-]+)(?:[/\?#]|$)','i');
 IF m IS NOT NULL THEN RETURN 'youtube:'||m[1]; END IF;
 m:=regexp_match(u,'^(?:https?://)?(?:www\.)?youtube\.com/watch\?[^#]*\mv=([A-Za-z0-9_-]+)','i');
 IF m IS NOT NULL THEN RETURN 'youtube:'||m[1]; END IF;
 RETURN NULL;
END $function$;
CREATE OR REPLACE FUNCTION public.property_link_provider(p_url text)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT CASE WHEN public.normalize_property_marketing_link(p_url) LIKE 'instagram%' THEN 'instagram'
 WHEN public.normalize_property_marketing_link(p_url) LIKE 'youtube:%' THEN 'youtube' ELSE NULL END
$function$;
DROP TABLE IF EXISTS public.facebook_link_cache;
