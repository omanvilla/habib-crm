-- Rollback for SQL53. Drafts keep their variant_label in analysis; the agent ignores missing variants.
DROP FUNCTION IF EXISTS public.crm_reply_variant_stats(integer);
DROP FUNCTION IF EXISTS public.crm_reply_variant_save(uuid, text, text, boolean);
DROP TABLE IF EXISTS public.whatsapp_reply_variants;
