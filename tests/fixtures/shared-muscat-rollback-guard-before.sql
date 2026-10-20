-- An independent privilege edit must not be silently erased by apply/rollback.
RESET ROLE;
GRANT EXECUTE ON FUNCTION public.crm_resolve_whatsapp_business_route(uuid,text,text,uuid) TO anon;
