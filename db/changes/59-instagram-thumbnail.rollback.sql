-- Rollback for SQL59. Deploy instagram-discovery v2 first, and restore crm_instagram_ingest from db/changes/33-instagram-discovery.forward.sql before the column goes.
ALTER TABLE public.instagram_media_catalog DROP COLUMN IF EXISTS thumbnail_url;
