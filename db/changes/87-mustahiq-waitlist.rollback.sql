-- Rollback of SQL87: drops the «المستحقين» waiting list (its rows are lost; export them first if needed).
DROP TABLE IF EXISTS public.mustahiq_waitlist;
