-- SQL56: two leftover review tables from 4 Nov sat in public without RLS, so any signed-in account could
-- read or change customer names and phones of both branches. Nothing reads them; keep the rows, out of reach.
ALTER TABLE public.review_batch4 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_redo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.review_batch4, public.review_redo FROM anon, authenticated, service_role;
ALTER TABLE public.review_batch4 SET SCHEMA crm_repair_private;
ALTER TABLE public.review_redo SET SCHEMA crm_repair_private;
