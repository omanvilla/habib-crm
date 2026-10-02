\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('test.actor','00000000-0000-4000-8000-000000000004',false);
INSERT INTO rejection_reasons(id,company_id,code,label_ar) VALUES
 ('00000000-0000-4000-8000-000000000501','00000000-0000-4000-8000-000000000001','price_value_mismatch','TEST PRICE'),
 ('00000000-0000-4000-8000-000000000502','00000000-0000-4000-8000-000000000001','location','TEST LOCATION'),
 ('00000000-0000-4000-8000-000000000503',NULL,'TEST_GLOBAL','TEST GLOBAL');
INSERT INTO client_requests(id,company_id,client_id,assigned_to,request_type,status,branch_key,route_key) VALUES
 ('00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000002','buyer','active','muscat','muscat'),
 ('00000000-0000-4000-8000-000000000302','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000002','buyer','active','muscat','muscat');

-- Two independent requests for the same property must retain independent primary reasons.
INSERT INTO deals(id,company_id,client_id,property_id,agent_id,stage,request_id,lost_reason_id,lost_reason_note,notes) VALUES
 ('00000000-0000-4000-8000-000000000911','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000002','lost','00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000501','original customer words','internal system note'),
 ('00000000-0000-4000-8000-000000000912','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000002','lost','00000000-0000-4000-8000-000000000302','00000000-0000-4000-8000-000000000501','independent request words',NULL);
DO $$BEGIN
 IF (SELECT count(*) FROM property_inquiries WHERE request_id IN('00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000302'))<>2 THEN RAISE EXCEPTION 'independent inquiry missing'; END IF;
 IF EXISTS(SELECT 1 FROM property_inquiries WHERE request_id='00000000-0000-4000-8000-000000000301' AND (has_inbound_inquiry OR viewing_booked OR viewing_completed)) THEN RAISE EXCEPTION 'direct loss fabricated inbound/visit'; END IF;
END $$;
UPDATE deals SET lost_reason_id='00000000-0000-4000-8000-000000000502',lost_reason_note=NULL WHERE id='00000000-0000-4000-8000-000000000911';
DO $$BEGIN
 IF (SELECT count(*) FROM property_rejection_reasons WHERE request_id='00000000-0000-4000-8000-000000000301' AND is_primary)<>1 THEN RAISE EXCEPTION 'one primary violated'; END IF;
 IF NOT EXISTS(SELECT 1 FROM property_rejection_reasons WHERE request_id='00000000-0000-4000-8000-000000000301' AND reason_id='00000000-0000-4000-8000-000000000501' AND NOT is_primary AND note='original customer words') THEN RAISE EXCEPTION 'history lost'; END IF;
 IF NOT EXISTS(SELECT 1 FROM property_rejection_reasons WHERE request_id='00000000-0000-4000-8000-000000000301' AND reason_id='00000000-0000-4000-8000-000000000502' AND is_primary AND note IS NULL) THEN RAISE EXCEPTION 'blank words fabricated'; END IF;
 IF NOT EXISTS(SELECT 1 FROM property_rejection_reasons WHERE request_id='00000000-0000-4000-8000-000000000302' AND is_primary AND note='independent request words') THEN RAISE EXCEPTION 'independent reason changed'; END IF;
 IF (SELECT rejection_notes FROM property_inquiries WHERE request_id='00000000-0000-4000-8000-000000000301') IS NOT NULL THEN RAISE EXCEPTION 'inquiry words not cleared'; END IF;
 IF (SELECT count(*) FROM deal_stage_history WHERE deal_id='00000000-0000-4000-8000-000000000911')<>1 THEN RAISE EXCEPTION 'reason edit created fictitious stage transition'; END IF;
 IF NOT EXISTS(SELECT 1 FROM crm_repair_private.rejection_change_audit WHERE source_table='deals' AND source_id='00000000-0000-4000-8000-000000000911' AND before_data->>'note'='original customer words' AND after_data->>'note' IS NULL) THEN RAISE EXCEPTION 'reason edit audit missing'; END IF;
END $$;

-- A retained inactive reason permits correcting the customer's words; selecting it anew does not.
UPDATE rejection_reasons SET is_active=false WHERE id='00000000-0000-4000-8000-000000000502';
UPDATE deals SET lost_reason_note='corrected words' WHERE id='00000000-0000-4000-8000-000000000911';
DO $$BEGIN
 BEGIN
  UPDATE deals SET lost_reason_id='00000000-0000-4000-8000-000000000502' WHERE id='00000000-0000-4000-8000-000000000912';
  RAISE EXCEPTION 'new inactive reason accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
UPDATE deals SET lost_reason_id='00000000-0000-4000-8000-000000000503' WHERE id='00000000-0000-4000-8000-000000000911';
UPDATE rejection_reasons SET is_active=true WHERE id='00000000-0000-4000-8000-000000000502';

-- Actual completed visit trigger: operational notes must never become customer quotations.
INSERT INTO viewings(id,company_id,client_id,property_id,request_id,agent_id,created_by,viewing_date,status,pipeline_outcome,rejection_reason,outcome_note,notes)
VALUES('00000000-0000-4000-8000-000000000701','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000004','2026-09-10','done','lost','price',NULL,'internal operational note');
DO $$BEGIN
 IF EXISTS(SELECT 1 FROM deals WHERE request_id='00000000-0000-4000-8000-000000000301' AND stage='lost' AND lost_reason_note IS NOT NULL) THEN RAISE EXCEPTION 'viewing invented customer words'; END IF;
 IF (SELECT count(*) FROM property_rejection_reasons WHERE request_id='00000000-0000-4000-8000-000000000301' AND is_primary)<>1 THEN RAISE EXCEPTION 'viewing double primary'; END IF;
 IF EXISTS(SELECT 1 FROM property_inquiries WHERE request_id='00000000-0000-4000-8000-000000000302' AND viewing_completed) THEN RAISE EXCEPTION 'viewing contaminated independent request'; END IF;
 IF EXISTS(SELECT 1 FROM deals WHERE id='00000000-0000-4000-8000-000000000901' AND lost_reason_id IS NOT NULL) THEN RAISE EXCEPTION 'legacy reason guessed'; END IF;
END $$;
UPDATE viewings SET rejection_reason='location',outcome_note='genuine customer words' WHERE id='00000000-0000-4000-8000-000000000701';
DO $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM property_rejection_reasons WHERE request_id='00000000-0000-4000-8000-000000000301' AND is_primary AND reason_id='00000000-0000-4000-8000-000000000502' AND note='genuine customer words') THEN RAISE EXCEPTION 'viewing reason not propagated'; END IF;
END $$;

-- The explicit general-dislike selection stays documented; historic rows are excluded from current report totals.
UPDATE viewings SET rejection_reason='not_interested',outcome_note=NULL WHERE id='00000000-0000-4000-8000-000000000701';
DO $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM property_rejection_reasons pr JOIN rejection_reasons r ON r.id=pr.reason_id
  WHERE pr.request_id='00000000-0000-4000-8000-000000000301' AND pr.is_primary AND r.code='not_interested' AND pr.note IS NULL) THEN
  RAISE EXCEPTION 'explicit general dislike was lost'; END IF;
 IF (SELECT count(*) FROM property_rejection_reasons WHERE is_primary)<>2 THEN RAISE EXCEPTION 'current report should count exactly two request journeys'; END IF;
 IF (SELECT count(*) FROM property_rejection_reasons)<=2 THEN RAISE EXCEPTION 'historical reasons should remain outside current count'; END IF;
END $$;
DO $$DECLARE q uuid; BEGIN
 SELECT id INTO q FROM property_inquiries WHERE request_id='00000000-0000-4000-8000-000000000301';
 PERFORM crm_replace_rejection_reasons(q,ARRAY['00000000-0000-4000-8000-000000000502'::uuid],'00000000-0000-4000-8000-000000000502','post_visit',NULL);
 IF (SELECT count(*) FROM property_rejection_reasons WHERE request_id='00000000-0000-4000-8000-000000000301' AND is_primary)<>1 THEN RAISE EXCEPTION 'RPC did not retain one primary'; END IF;
 BEGIN
  PERFORM crm_replace_rejection_reasons(q,ARRAY['00000000-0000-4000-8000-000000000501'::uuid,'00000000-0000-4000-8000-000000000502'::uuid],NULL,'post_visit',NULL);
  RAISE EXCEPTION 'multiple selection accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;

-- Branch and company mismatch writes roll back all downstream report changes.
SELECT set_config('test.actor','00000000-0000-4000-8000-000000000003',false);
DO $$BEGIN
 BEGIN
  UPDATE deals SET lost_reason_note='cross branch forbidden' WHERE id='00000000-0000-4000-8000-000000000911';
  RAISE EXCEPTION 'cross branch rejection accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF EXISTS(SELECT 1 FROM property_rejection_reasons WHERE note='cross branch forbidden') THEN RAISE EXCEPTION 'forbidden change not rolled back'; END IF;
END $$;
SELECT set_config('test.actor','00000000-0000-4000-8000-000000000004',false);
SET ROLE authenticated;
DO $$BEGIN
 BEGIN
  PERFORM 1 FROM crm_repair_private.rejection_change_audit;
  RAISE EXCEPTION 'private audit readable';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'rejection consistency: all assertions passed' AS result;

ROLLBACK;
