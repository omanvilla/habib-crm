-- Real catalog/roles/marketing triggers, synthetic actors and provider records. No network.
INSERT INTO public.instagram_discovery_state(account_id,company_id,enabled,auto_link_enabled)
VALUES(test_id(1900),test_id(1),true,true);
CREATE FUNCTION test_ingest_media(n integer,caption text DEFAULT 'synthetic listing') RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE lease uuid;result uuid;
BEGIN
 SELECT lease_id INTO lease FROM public.instagram_discovery_state WHERE account_id=test_id(1900);
 PERFORM public.crm_instagram_ingest(test_id(1900),lease,jsonb_build_array(jsonb_build_object('id',n::text,'permalink','https://www.instagram.com/reel/SYNTHETIC'||n||'/','caption',caption,'media_type','VIDEO','media_product_type','REELS','timestamp','2026-09-01T08:30:00+0400')));
 SELECT id INTO result FROM public.instagram_media_catalog WHERE instagram_media_id=n::text;RETURN result;
END$$;
GRANT EXECUTE ON FUNCTION test_ingest_media(integer,text) TO service_role;
SET ROLE service_role;SELECT set_config('test.actor','',false);
SELECT test_assert(crm_instagram_job_auth(repeat('a',64)),'Vault secret validates only through service');
SELECT test_assert(NOT crm_instagram_job_auth(repeat('b',64)),'wrong secret rejected');
SELECT test_assert(crm_instagram_claim(test_id(1900))->>'lease_id' IS NOT NULL,'first lease acquired');
SELECT test_assert(crm_instagram_claim(test_id(1900)) IS NULL,'overlapping lease rejected');
SELECT test_ingest_media(91001);SELECT test_ingest_media(91001);
SELECT test_assert((SELECT count(*)=1 FROM instagram_media_catalog),'feed retry is idempotent');
SELECT test_assert((SELECT published_at='2026-09-01T04:30:00Z' FROM instagram_media_catalog),'provider timestamp exact');
SELECT crm_instagram_auto_decide(id,updated_at,'link',test_id(301),(SELECT updated_at FROM properties WHERE id=test_id(301)),'unique_specification_match','{}') FROM instagram_media_catalog WHERE instagram_media_id='91001';
SELECT test_assert((SELECT state='linked' AND property_id=test_id(301) FROM instagram_media_catalog WHERE instagram_media_id='91001'),'new marketing record linked');
SELECT test_assert((SELECT count(*)=1 AND bool_and(published_at='2026-09-01T04:30:00Z') AND bool_and(created_by IS NULL) FROM property_marketing_events WHERE link_key='instagram:SYNTHETIC91001'),'one automated event with actual publication time and no forged human');
SELECT crm_instagram_auto_decide(id,updated_at,'link',test_id(301),(SELECT updated_at FROM properties WHERE id=test_id(301)),'retry','{}') FROM instagram_media_catalog WHERE instagram_media_id='91001';
SELECT test_assert((SELECT count(*)=1 FROM property_marketing_events WHERE link_key='instagram:SYNTHETIC91001'),'decision retry does not duplicate');
SELECT test_ingest_media(91002);
SELECT crm_instagram_auto_decide(id,updated_at,'needs_review',NULL,NULL,'multiple_matches','{}') FROM instagram_media_catalog WHERE instagram_media_id='91002';
SELECT test_assert(crm_instagram_notify(test_id(1900))=1,'new review notification');
SELECT test_assert(crm_instagram_notify(test_id(1900))=0,'notification deduplicated');
SELECT test_assert((SELECT count(*)=1 FROM notifications WHERE type='instagram_discovery'),'one aggregated alert, not repeated');
RESET ROLE;
-- The original marketing rows remain exactly unchanged, including historical views/dates.
SELECT test_assert(NOT EXISTS(SELECT 1 FROM test_marketing_before b JOIN property_marketing_events e USING(id) WHERE b.row_data IS DISTINCT FROM to_jsonb(e)),'original marketing rows preserved');
-- Stale role, foreign-company and ordinary agent access must not bypass owner review.
SET ROLE authenticated;
SELECT set_config('test.actor',test_id(12)::text,false);
SELECT test_assert((SELECT count(*)=0 FROM instagram_media_catalog),'Barka cannot read owner queue');
SELECT test_assert((SELECT count(*)=0 FROM instagram_discovery_state),'Barka cannot read owner scheduler');
DO $$BEGIN
 BEGIN PERFORM crm_instagram_review(test_id(999),now(),'non_property');RAISE EXCEPTION 'should deny';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM crm_instagram_claim(test_id(1900));RAISE EXCEPTION 'should deny';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN INSERT INTO instagram_media_catalog(company_id) VALUES(test_id(1));RAISE EXCEPTION 'should deny';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END$$;
SELECT set_config('test.actor',test_id(16)::text,false);SELECT test_assert((SELECT count(*)=0 FROM instagram_media_catalog),'other company hidden');
SELECT set_config('test.actor',test_id(10)::text,false);
SELECT test_assert((SELECT count(*)=2 FROM instagram_media_catalog),'owner positive read');
SELECT crm_instagram_review(id,updated_at,'non_property') FROM instagram_media_catalog WHERE instagram_media_id='91002';
SELECT test_assert((SELECT state='non_property' AND reviewed_by=test_id(10) FROM instagram_media_catalog WHERE instagram_media_id='91002'),'owner reviewed content type');
DO $$DECLARE c instagram_media_catalog;BEGIN SELECT * INTO c FROM instagram_media_catalog WHERE instagram_media_id='91002';
 BEGIN PERFORM crm_instagram_review(c.id,c.updated_at-interval '1 second','link',test_id(301));RAISE EXCEPTION 'stale allowed';EXCEPTION WHEN serialization_failure THEN NULL;END;
END$$;
RESET ROLE;SELECT set_config('test.actor','',false);SET ROLE service_role;
SELECT test_ingest_media(91002,'changed caption does not override explicit owner');
SELECT crm_instagram_auto_decide(id,updated_at,'link',test_id(301),(SELECT updated_at FROM properties WHERE id=test_id(301)),'automation_retry','{}') FROM instagram_media_catalog WHERE instagram_media_id='91002';
SELECT test_assert((SELECT state='non_property' AND reviewed_by=test_id(10) FROM instagram_media_catalog WHERE instagram_media_id='91002'),'manual decision preserved against automation');
SELECT test_ingest_media(91003);
RESET ROLE;
UPDATE properties SET performance_tracking_started_at='2026-10-20T08:00:00Z' WHERE id=test_id(301);
SET ROLE service_role;
SELECT crm_instagram_auto_decide(id,updated_at,'link',test_id(301),(SELECT updated_at FROM properties WHERE id=test_id(301)),'historical_import','{}') FROM instagram_media_catalog WHERE instagram_media_id='91003';
SELECT test_assert((SELECT performance_tracking_started_at='2026-10-20T08:00:00Z' FROM properties WHERE id=test_id(301)),'old video never regresses current property tracking');
SELECT test_ingest_media(91004);
SELECT crm_instagram_auto_decide(id,updated_at,'link',test_id(302),(SELECT updated_at FROM properties WHERE id=test_id(302)),'private_property','{}') FROM instagram_media_catalog WHERE instagram_media_id='91004';
RESET ROLE;SET ROLE authenticated;SELECT set_config('test.actor',test_id(12)::text,false);
SELECT test_assert(NOT EXISTS(SELECT 1 FROM property_marketing_events WHERE link_key='instagram:SYNTHETIC91004'),'private linked event stays protected from branch');
RESET ROLE;
SELECT test_assert(NOT has_function_privilege('authenticated','crm_instagram_job_auth(text)','EXECUTE'),'caller cannot test/extract job secret');
SELECT test_assert(NOT has_function_privilege('authenticated','crm_repair_private.instagram_enqueue()','EXECUTE'),'caller cannot directly enqueue bypassing rate limit');
SELECT test_assert(NOT has_function_privilege('anon','crm_instagram_review(uuid,timestamptz,text,uuid)','EXECUTE'),'anonymous review blocked');
SELECT 'Instagram discovery SQL contracts, private isolation and historical preservation passed' AS result;
