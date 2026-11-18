-- Rollback of SQL137. Removes the policies and the helper only; the bucket and its files stay (no file is deleted).
-- Rows already pointing at property-keys paths would need their old public URL back (listed in the SQL137 report).
SET LOCAL lock_timeout = '10s';
DROP POLICY IF EXISTS crm_property_keys_select ON storage.objects;
DROP POLICY IF EXISTS crm_property_keys_insert ON storage.objects;
DROP POLICY IF EXISTS crm_property_keys_delete ON storage.objects;
DROP FUNCTION IF EXISTS crm_repair_private.can_access_property_key(text,text,text);
COMMENT ON COLUMN public.properties.lockbox_image_url IS NULL;
