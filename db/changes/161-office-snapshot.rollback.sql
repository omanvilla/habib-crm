-- Rollback of SQL161: the office page then shows «تعذر تحميل المكتب».
DROP FUNCTION IF EXISTS public.crm_office_snapshot();
