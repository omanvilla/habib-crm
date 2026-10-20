-- ISOLATED SYNTHETIC DATABASE ONLY. The historical full-catalog fixture has a
-- pretend connected investment number; this task explicitly concerns an unbound
-- number. Adapt only that synthetic configuration before capturing preservation.
RESET ROLE;
SELECT set_config('test.actor',test_id(10)::text,false);
UPDATE company_lead_routes SET meta_phone_number_id=NULL,meta_waba_id=NULL,
 meta_login_configuration_id=NULL,whatsapp_number='+96890000909'
WHERE company_id=test_id(1) AND route_key='investment';
CREATE TABLE test_shared32(key text PRIMARY KEY,value jsonb);
GRANT ALL ON test_shared32 TO authenticated,service_role;
INSERT INTO test_shared32 VALUES('business_before',test_coherence28_business());
INSERT INTO test_shared32 SELECT 'profiles_before',jsonb_agg(to_jsonb(p) ORDER BY id) FROM profiles p;
INSERT INTO test_shared32 SELECT 'routes_before',jsonb_agg(to_jsonb(r) ORDER BY id) FROM company_lead_routes r;
INSERT INTO test_shared32 SELECT 'credentials_before',jsonb_agg(to_jsonb(r) ORDER BY company_id,route_key) FROM whatsapp_route_credentials r;
