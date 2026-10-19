-- Isolated catalog only: emulate an independent later definition change.
ALTER FUNCTION public.crm_employee_performance(date,date) VOLATILE;
