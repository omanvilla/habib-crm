-- Already deployed migration, recovered verbatim from migration history.
alter function public.crm_employee_target_snapshot() security definer;
comment on function public.crm_employee_target_snapshot() is 'SECURITY DEFINER because authenticated cannot SELECT deals; scope employees to actor and non-investment branches explicitly, without broad table grants.';


