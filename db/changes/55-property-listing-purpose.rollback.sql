-- Rollback for SQL55. The CRM and the reply agent treat a missing value as a sale.
REVOKE SELECT (listing_purpose) ON public.properties FROM authenticated;
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_listing_purpose_chk;
ALTER TABLE public.properties DROP COLUMN IF EXISTS listing_purpose;
