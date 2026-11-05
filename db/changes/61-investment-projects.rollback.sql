-- Rollback for SQL61. Publish the front end and deploy instagram-discovery without projects first.
DROP FUNCTION IF EXISTS public.crm_investment_projects();
DROP FUNCTION IF EXISTS public.crm_project_add_video(uuid, text);
DROP FUNCTION IF EXISTS public.crm_instagram_auto_link_project(uuid, timestamptz, uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.crm_instagram_link_project(uuid, timestamptz, uuid);
DROP FUNCTION IF EXISTS crm_repair_private.instagram_set_project(uuid, timestamptz, uuid, text, jsonb, uuid);
UPDATE public.instagram_media_catalog SET state = 'needs_review' WHERE state = 'project';
ALTER TABLE public.instagram_media_catalog DROP CONSTRAINT IF EXISTS instagram_media_catalog_state_check;
ALTER TABLE public.instagram_media_catalog ADD CONSTRAINT instagram_media_catalog_state_check
  CHECK (state = ANY (ARRAY['pending','linked','needs_review','non_property']));
ALTER TABLE public.instagram_media_catalog DROP COLUMN IF EXISTS project_id;
DROP TABLE IF EXISTS public.investment_projects;
