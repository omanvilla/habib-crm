-- Isolated adapters for managed Vault/network only. No network or real credentials.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE SCHEMA vault;
CREATE TABLE vault.decrypted_secrets(name text PRIMARY KEY,decrypted_secret text);
INSERT INTO vault.decrypted_secrets VALUES('crm_instagram_discovery_cron',repeat('a',64));
CREATE SCHEMA net;
CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE sql AS $$SELECT 1::bigint$$;
CREATE TABLE test_marketing_before AS SELECT id,to_jsonb(e) AS row_data FROM public.property_marketing_events e;
