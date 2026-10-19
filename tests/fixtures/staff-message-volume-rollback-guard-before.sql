-- Dedicated synthetic catalog: emulate an independently changed function.
ALTER FUNCTION public.crm_employee_performance(date,date) VOLATILE;
