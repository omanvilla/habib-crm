-- Rollback of SQL81: the staff home goes back to the old dashboard (crm-owner-home.js shows nothing without data).
DROP FUNCTION IF EXISTS public.crm_staff_home();
