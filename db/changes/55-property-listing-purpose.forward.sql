-- SQL55: each property says whether it is for sale or for rent, so the WhatsApp reply agent can
-- answer rental questions from what is in the CRM right now instead of a fixed reply.
-- Existing properties are all sales; the default keeps them that way.
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS listing_purpose text NOT NULL DEFAULT 'sale';
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_listing_purpose_chk;
ALTER TABLE public.properties ADD CONSTRAINT properties_listing_purpose_chk CHECK (listing_purpose IN ('sale', 'rent'));
-- Properties are read through column-level SELECT grants, so the new column needs its own.
GRANT SELECT (listing_purpose) ON public.properties TO authenticated;
