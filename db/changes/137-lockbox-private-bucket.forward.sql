-- SQL137 (18 Nov 2026, Ahmed's decision review [75], docs/مراجعة-القرارات-20261118.md, approved «نعم موافق»).
-- Key-box photos (properties.lockbox_image_url) leave the PUBLIC bucket «property-images»: anybody with the link could
-- open them. They now live in the private bucket «property-keys» under <company>/<property>/<uuid>.<ext>, and the
-- column holds that path (no URL). The CRM shows them through a short signed URL; the WhatsApp send functions sign a
-- 10-minute URL at send time. Only an ACTIVE owner/manager/agent of the same company reads, adds or removes them
-- (no «viewer», no other company, no inactive account). Old values that are still a public https URL keep working
-- until they are copied (edge function crm-lockbox-move). The old public files are NOT deleted here (Ahmed's yes needed).
-- Rollback: 137-lockbox-private-bucket.rollback.sql
SET LOCAL lock_timeout = '10s';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('property-keys', 'property-keys', false, 5242880, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

CREATE OR REPLACE FUNCTION crm_repair_private.can_access_property_key(p_name text, p_owner_id text, p_operation text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 SELECT COALESCE(public.my_company() IS NOT NULL
   AND public.my_role() IN ('owner','manager','agent')          -- my_role() is NULL for an inactive profile
   AND p_operation IN ('select','insert','delete')
   AND split_part(p_name,'/',1) = public.my_company()::text
   AND p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$'
   AND (p_operation <> 'insert' OR p_owner_id = (SELECT auth.uid())::text)
   -- invoker-scoped: the property must be one this account can see in its own company (not archived for a new photo)
   AND EXISTS (SELECT 1 FROM public.properties p WHERE p.id::text = split_part(p_name,'/',2)
     AND p.company_id = public.my_company() AND (p_operation <> 'insert' OR p.archived IS NOT TRUE)), false);
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.can_access_property_key(text,text,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION crm_repair_private.can_access_property_key(text,text,text) TO authenticated;

DROP POLICY IF EXISTS crm_property_keys_select ON storage.objects;
CREATE POLICY crm_property_keys_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'property-keys' AND crm_repair_private.can_access_property_key(name, owner_id, 'select'));
DROP POLICY IF EXISTS crm_property_keys_insert ON storage.objects;
CREATE POLICY crm_property_keys_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'property-keys' AND crm_repair_private.can_access_property_key(name, owner_id, 'insert'));
DROP POLICY IF EXISTS crm_property_keys_delete ON storage.objects;
CREATE POLICY crm_property_keys_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'property-keys' AND crm_repair_private.can_access_property_key(name, owner_id, 'delete'));

COMMENT ON COLUMN public.properties.lockbox_image_url IS
  'SQL137: path of the key-box photo in the private bucket property-keys (<company>/<property>/<uuid>.<ext>). Shown and sent only through short signed URLs. A value starting with https:// is an old public URL not yet copied.';
