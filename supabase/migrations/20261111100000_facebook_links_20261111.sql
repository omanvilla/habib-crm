-- SQL80 (11 Nov 2026, Ahmed): Facebook is a marketing channel. Properties are posted on the Facebook page and
-- customers send Facebook links (mostly «facebook.com/share/r|v/...» share links) to the WhatsApp numbers.
--  * A Facebook video/reel/post link on a property (journal channel 'facebook') gets link_key 'facebook:<id>',
--    so a customer link to the same video matches it like an Instagram reel.
--  * Share links (facebook.com/share/..., fb.watch/...) normalise to 'facebook-share:<code>'; the reply agent opens
--    them (fixed hosts only) to learn the real video id and the post text, cached in facebook_link_cache.
-- No messaging, publishing or Graph permission change.

ALTER TABLE public.property_marketing_events DROP CONSTRAINT IF EXISTS property_marketing_events_channel_check;
ALTER TABLE public.property_marketing_events ADD CONSTRAINT property_marketing_events_channel_check
  CHECK (channel = ANY (ARRAY['instagram','facebook','oman_reel','youtube','signboard','referral','other']));
ALTER TABLE public.property_inquiries DROP CONSTRAINT IF EXISTS property_inquiries_source_check;
ALTER TABLE public.property_inquiries ADD CONSTRAINT property_inquiries_source_check
  CHECK (source = ANY (ARRAY['whatsapp','instagram','facebook','oman_reel','youtube','signboard','referral','website','other']));

CREATE OR REPLACE FUNCTION public.normalize_property_marketing_link(p_url text)
 RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE u text:=trim(coalesce(p_url,'')); m text[];
BEGIN
 u:=regexp_replace(replace(u,'&amp;','&'),'[\]\)\}>,.;!؟،]+$','','g');
 -- Host is insensitive, shortcodes and video IDs are case sensitive.
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
 -- SQL80: Facebook. Video and reel ids first (the same video is reached by /reel/, /videos/ and watch?v=).
 m:=regexp_match(u,'^(?:https?://)?(?:www\.|m\.|web\.|business\.)?(?:facebook|fb)\.com/reel/([0-9]+)(?:[/\?#]|$)','i');
 IF m IS NOT NULL THEN RETURN 'facebook:'||m[1]; END IF;
 m:=regexp_match(u,'^(?:https?://)?(?:www\.|m\.|web\.|business\.)?(?:facebook|fb)\.com/[^/?#]+/videos/(?:[^/?#]+/)?([0-9]+)(?:[/\?#]|$)','i');
 IF m IS NOT NULL THEN RETURN 'facebook:'||m[1]; END IF;
 m:=regexp_match(u,'^(?:https?://)?(?:www\.|m\.|web\.|business\.)?(?:facebook|fb)\.com/watch/?\?[^#]*\mv=([0-9]+)','i');
 IF m IS NOT NULL THEN RETURN 'facebook:'||m[1]; END IF;
 m:=regexp_match(u,'^(?:https?://)?(?:www\.|m\.|web\.|business\.)?(?:facebook|fb)\.com/[^/?#]+/posts/([A-Za-z0-9]+)(?:[/\?#]|$)','i');
 IF m IS NOT NULL THEN RETURN 'facebook:'||m[1]; END IF;
 m:=regexp_match(u,'^(?:https?://)?(?:www\.|m\.|web\.|business\.)?(?:facebook|fb)\.com/(?:permalink|story)\.php\?[^#]*\mstory_fbid=([A-Za-z0-9]+)','i');
 IF m IS NOT NULL THEN RETURN 'facebook:'||m[1]; END IF;
 m:=regexp_match(u,'^(?:https?://)?(?:www\.|m\.|web\.|business\.)?(?:facebook|fb)\.com/share/(?:[a-z]/)?([A-Za-z0-9_-]+)(?:[/\?#]|$)','i');
 IF m IS NOT NULL THEN RETURN 'facebook-share:'||m[1]; END IF;
 m:=regexp_match(u,'^(?:https?://)?(?:www\.)?fb\.watch/([A-Za-z0-9_-]+)(?:[/\?#]|$)','i');
 IF m IS NOT NULL THEN RETURN 'facebook-share:'||m[1]; END IF;
 RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.property_link_provider(p_url text)
 RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT CASE WHEN public.normalize_property_marketing_link(p_url) LIKE 'instagram%' THEN 'instagram'
             WHEN public.normalize_property_marketing_link(p_url) LIKE 'youtube:%' THEN 'youtube'
             WHEN public.normalize_property_marketing_link(p_url) LIKE 'facebook%' THEN 'facebook' ELSE NULL END
$function$;

-- What a Facebook link turned out to be (service role only: the reply agent writes and reads it).
CREATE TABLE IF NOT EXISTS public.facebook_link_cache(
  link_key text PRIMARY KEY,               -- facebook-share:<code> or facebook:<id> as sent
  resolved_key text,                       -- facebook:<video or post id>
  page_id text,                            -- numeric id of the page or profile that posted it
  caption text,                            -- public post text (og:description), at most 2000 characters
  status text NOT NULL DEFAULT 'resolved' CHECK (status IN ('resolved','unreadable')),
  fetched_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.facebook_link_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.facebook_link_cache FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.facebook_link_cache TO service_role;
