-- Rollback for SQL59. Deploy the instagram-discovery from before PR #38 first (no thumbnail_url field), and restore crm_instagram_ingest from db/changes/33-instagram-discovery.forward.sql before the column goes.
ALTER TABLE public.instagram_media_catalog DROP COLUMN IF EXISTS thumbnail_url;
