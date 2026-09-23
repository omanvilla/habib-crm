BEGIN;
SET LOCAL lock_timeout='5s';
-- Requires stage 01 (private schema and active-account identity helpers).
-- Public delivery is retained for marketing photos; anonymous object listing is not needed.
DROP POLICY "Authenticated delete property images" ON storage.objects;
DROP POLICY "Authenticated upload property images" ON storage.objects;
DROP POLICY "Public read property images" ON storage.objects;
-- A new property's image draft is uploaded before the property row is saved.
-- The narrow definer helper only distinguishes an unused UUID from a hidden existing
-- property. It never grants access to an existing property or returns its attributes.
CREATE FUNCTION crm_repair_private.property_image_draft_target_available(p_property_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles p
   WHERE p.id=(SELECT auth.uid()) AND p.is_active IS TRUE
     AND p.company_id IS NOT NULL AND p.role IN('owner','manager','agent'))
   AND p_property_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   AND NOT EXISTS(SELECT 1 FROM public.properties p WHERE p.id::text=p_property_id);
$$;
REVOKE ALL ON FUNCTION crm_repair_private.property_image_draft_target_available(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION crm_repair_private.property_image_draft_target_available(text) TO authenticated;
CREATE FUNCTION crm_repair_private.can_access_property_image(p_name text,p_owner_id text,p_operation text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $$
 SELECT COALESCE(public.my_company() IS NOT NULL
   AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid())
     AND p.is_active IS TRUE AND p.company_id=public.my_company()
     AND p.role IN('owner','manager','agent','viewer'))
   AND p_operation IN('select','insert','delete')
   AND split_part(p_name,'/',1)=public.my_company()::text
   AND p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|gif)$'
   AND (p_operation='select' OR public.my_role() IN('owner','manager','agent'))
   -- Storage supplies owner_id from the JWT, never from user-defined metadata.
   AND (p_operation<>'insert' OR p_owner_id=(SELECT auth.uid())::text)
   AND (
     -- This SELECT is invoker-scoped: a hidden existing property is never a draft.
     -- Current properties UPDATE roles are owner/manager/agent within the same company.
     EXISTS(SELECT 1 FROM public.properties p WHERE p.id::text=split_part(p_name,'/',2)
       AND p.company_id=public.my_company()
       AND (p_operation<>'insert' OR p.archived IS NOT TRUE))
     OR (p_owner_id=(SELECT auth.uid())::text
       AND crm_repair_private.property_image_draft_target_available(split_part(p_name,'/',2)))
   ),false);
$$;
REVOKE ALL ON FUNCTION crm_repair_private.can_access_property_image(text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION crm_repair_private.can_access_property_image(text,text,text) TO authenticated;
CREATE POLICY crm_property_images_select ON storage.objects FOR SELECT TO authenticated
 USING(bucket_id='property-images' AND crm_repair_private.can_access_property_image(name,owner_id,'select'));
CREATE POLICY crm_property_images_insert ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(bucket_id='property-images' AND crm_repair_private.can_access_property_image(name,owner_id,'insert'));
CREATE POLICY crm_property_images_delete ON storage.objects FOR DELETE TO authenticated
 USING(bucket_id='property-images' AND crm_repair_private.can_access_property_image(name,owner_id,'delete'));
-- Deliberately no UPDATE/upsert policy: filenames are immutable UUIDs; changes upload a new photo.
COMMIT;
