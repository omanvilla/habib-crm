-- Run ONLY after investment-owner-only.sql and SQL18 on an isolated database.
-- Uses real table policies, trigger paths and RPCs with synthetic role claims.
BEGIN;
CREATE FUNCTION test_assert_ordinary_unchanged() RETURNS void LANGUAGE plpgsql AS $$
DECLARE b record;actual jsonb;
BEGIN
 FOR b IN SELECT * FROM test_ordinary_before LOOP
  EXECUTE format('SELECT to_jsonb(x) FROM public.%I x WHERE id=$1',b.table_name) INTO actual USING b.row_id;
  PERFORM test_assert(actual IS NOT DISTINCT FROM b.row_data,'ordinary row changed: '||b.table_name||'/'||b.row_id);
 END LOOP;
END$$;
SELECT test_assert_ordinary_unchanged();
-- Seed deliberately stale notification recipients with explicit private context;
-- the restrictive policy must protect them even when an old recipient rule allows it.
SET session_replication_role=replica;
INSERT INTO notifications(id,user_id,title,body,client_id,request_id)
VALUES(test_id(1202),test_id(11),'PRIVATE INVESTOR SENTINEL','Private notification',test_id(102),NULL),
(test_id(1203),test_id(11),'PRIVATE REQUEST ONLY','Private notification',NULL,test_id(206)),
(test_id(1204),test_id(13),'PRIVATE MANAGER NOTIFICATION','Private notification',test_id(102),NULL),
(test_id(1205),test_id(10),'PRIVATE OWNER NOTIFICATION','Private notification',test_id(102),NULL);
SET session_replication_role=origin;

CREATE FUNCTION test_private_surfaces_hidden() RETURNS void LANGUAGE plpgsql AS $$
DECLARE t text; n bigint; result jsonb;
BEGIN
 PERFORM test_assert(NOT EXISTS(SELECT 1 FROM clients WHERE id IN(test_id(102),test_id(105),test_id(2500))),'private client list/detail/selector leak');
 PERFORM test_assert(NOT EXISTS(SELECT 1 FROM clients WHERE phone_normalized='+96891100102' OR name ILIKE '%PRIVATE INVESTOR%'),'private phone/autocomplete search leak');
 PERFORM test_assert(NOT EXISTS(SELECT 1 FROM client_requests WHERE id IN(test_id(202),test_id(205),test_id(206),test_id(207),test_id(2501))),'private request leak including ordinary parent');
 PERFORM test_assert(NOT EXISTS(SELECT 1 FROM client_request_assignees WHERE request_id IN(test_id(202),test_id(206),test_id(207),test_id(2501))),'request assignee leak');
 PERFORM test_assert(NOT EXISTS(SELECT 1 FROM whatsapp_conversations WHERE id IN(test_id(402),test_id(403),test_id(404))),'private physical or linked WhatsApp inbox leak');
 PERFORM test_assert(NOT EXISTS(SELECT 1 FROM whatsapp_messages WHERE id IN(test_id(502),test_id(503),test_id(504))),'private WhatsApp message leak');
 PERFORM test_assert(NOT EXISTS(SELECT 1 FROM whatsapp_message_requests WHERE message_id IN(test_id(502),test_id(504))),'WhatsApp request link leak');
 PERFORM test_assert(NOT EXISTS(SELECT 1 FROM viewings WHERE id IN(test_id(602),test_id(603))),'private viewing leak');
 PERFORM test_assert(NOT EXISTS(SELECT 1 FROM appointments WHERE id IN(test_id(702),test_id(703))),'private appointment leak');
 PERFORM test_assert(NOT EXISTS(SELECT 1 FROM appointment_properties WHERE id IN(test_id(1502),test_id(1503))),'private appointment-property leak');
 PERFORM test_assert(NOT EXISTS(SELECT 1 FROM deals WHERE id IN(test_id(802),test_id(803))),'private direct deal leak');
 PERFORM test_assert(NOT EXISTS(SELECT 1 FROM crm_deals_access WHERE id IN(test_id(802),test_id(803))),'private deal view leak');
 PERFORM test_assert(NOT EXISTS(SELECT 1 FROM crm_properties_access WHERE id=test_id(302)),'private property view leak');
 PERFORM test_assert(NOT EXISTS(SELECT 1 FROM tasks WHERE id IN(test_id(902),test_id(903),test_id(904),test_id(905))),'private task/transitive-only link leak');
 PERFORM test_assert(NOT EXISTS(SELECT 1 FROM activities WHERE id IN(test_id(1002),test_id(1003))),'private activity/appointment-only link leak');
 PERFORM test_assert(NOT EXISTS(SELECT 1 FROM events WHERE id=test_id(1102)),'private calendar event leak');
 PERFORM test_assert(NOT EXISTS(SELECT 1 FROM notifications WHERE id IN(test_id(1202),test_id(1203),test_id(1204),test_id(1205))),'private notification leak');
 PERFORM test_assert(NOT EXISTS(SELECT 1 FROM client_request_events WHERE id IN(test_id(1302),test_id(1303))),'private request milestone leak');
 PERFORM test_assert(NOT EXISTS(SELECT 1 FROM property_inquiries WHERE id IN(test_id(1402),test_id(1403))),'private inquiry leak');
 PERFORM test_assert(NOT EXISTS(SELECT 1 FROM deposits WHERE id IN(test_id(1602),test_id(1603))),'private deposit/direct-deal link leak');
 PERFORM test_assert(NOT EXISTS(SELECT 1 FROM deal_stage_history WHERE id IN(test_id(1702),test_id(1703))),'private deal history leak');
 PERFORM test_assert(NOT EXISTS(SELECT 1 FROM whatsapp_followup_optins WHERE client_id=test_id(102)),'private followup consent leak');
 PERFORM test_assert(NOT EXISTS(SELECT 1 FROM whatsapp_followup_optouts WHERE request_id=test_id(202)),'private followup optout leak');
 PERFORM test_assert(NOT EXISTS(SELECT 1 FROM whatsapp_followup_events WHERE id=test_id(1802)),'private followup event leak');
 PERFORM test_assert(NOT EXISTS(SELECT 1 FROM instagram_conversations WHERE id=test_id(1902)),'private linked Instagram conversation leak');
 PERFORM test_assert(NOT EXISTS(SELECT 1 FROM instagram_messages WHERE id=test_id(2002)),'private linked Instagram message leak');
 -- These surfaces include API-revoked backend tables as well as RLS-readable tables.
 FOR t IN SELECT unnest(ARRAY['property_rejection_reasons','property_marketing_events','property_action_reviews','measurement_targets','whatsapp_onboarding_events','whatsapp_automation_events','unmatched_property_links','whatsapp_route_credentials','instagram_outbound_operations','whatsapp_template_registry','whatsapp_send_operations','property_message_attributions']) LOOP
  BEGIN
   EXECUTE format('SELECT count(*) FROM public.%I',t) INTO n;
   PERFORM test_assert(n=0,'private auxiliary surface leak: '||t);
  EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 END LOOP;
 PERFORM test_assert(NOT EXISTS(SELECT 1 FROM company_lead_routes WHERE route_key='investment'),'investment route catalog leak');
 BEGIN
  result:=crm_public_business_routes();
  PERFORM test_assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(result) r WHERE r->>'route_key'='investment'),'investment route RPC leak');
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'not_allowed' THEN RAISE;END IF;END;
 result:=crm_client_360(test_id(102));
 PERFORM test_assert(result->'client' IS NULL OR result->'client'='null'::jsonb,'private client360 RPC leak');
 PERFORM test_assert(NOT coalesce(result::text,'') LIKE '%PRIVATE INVESTOR%','private client360 nested leak');
 PERFORM test_assert(NOT EXISTS(SELECT 1 FROM crm_whatsapp_latest_messages(ARRAY[test_id(402),test_id(403),test_id(404)])),'private latest messages RPC leak');
 PERFORM test_assert(NOT crm_repair_private.can_access_client(test_id(1),test_id(102)),'private client helper leak');
 PERFORM test_assert(NOT crm_repair_private.can_access_request(test_id(1),test_id(206)),'private request helper leak');
 PERFORM test_assert(NOT crm_repair_private.can_access_whatsapp_conversation(test_id(1),test_id(403)),'misrouted private conversation helper leak');
 PERFORM test_assert(NOT crm_repair_private.staff_can_access_branch(test_id(1),'investment'),'investment branch helper leak');
 BEGIN PERFORM crm_get_deal_workflow(test_id(802)); RAISE EXCEPTION 'private deal workflow RPC unexpectedly succeeded';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM crm_mark_whatsapp_read(test_id(402),test_id(502)); RAISE EXCEPTION 'private WhatsApp read RPC unexpectedly succeeded';EXCEPTION WHEN insufficient_privilege THEN NULL; WHEN raise_exception THEN IF SQLERRM NOT IN('not_allowed','conversation_not_found') THEN RAISE;END IF;END;
 BEGIN PERFORM crm_mark_instagram_read(test_id(1902),test_id(2002)); RAISE EXCEPTION 'private Instagram read RPC unexpectedly succeeded';EXCEPTION WHEN insufficient_privilege THEN NULL; WHEN raise_exception THEN IF SQLERRM NOT IN('not_allowed','conversation_not_found') THEN RAISE;END IF;END;
 BEGIN INSERT INTO tasks(company_id,user_id,client_id,title) VALUES(test_id(1),auth.uid(),test_id(102),'Denied private task'); RAISE EXCEPTION 'private linked task insert unexpectedly succeeded';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN INSERT INTO clients(company_id,assigned_to,name,client_type,lead_route) VALUES(test_id(1),auth.uid(),'Denied canonical investor','investor','investment'); RAISE EXCEPTION 'private client insert unexpectedly succeeded';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN INSERT INTO clients(company_id,name,phone,client_type,lead_route,assigned_to) VALUES(test_id(1),'Private duplicate attempt','+96891100102','buyer','muscat',auth.uid()); RAISE EXCEPTION 'hidden investor phone duplicated';EXCEPTION WHEN unique_violation OR insufficient_privilege THEN NULL;END;
 BEGIN INSERT INTO client_requests(company_id,client_id,request_type,route_key,branch_key,assigned_to) VALUES(test_id(1),test_id(100),'investor','investment','investment',auth.uid()); RAISE EXCEPTION 'private request insert unexpectedly succeeded';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 UPDATE clients SET name='Tamper' WHERE id=test_id(102); GET DIAGNOSTICS n=ROW_COUNT;PERFORM test_assert(n=0,'private direct client update succeeded');
 DELETE FROM tasks WHERE id=test_id(902); GET DIAGNOSTICS n=ROW_COUNT;PERFORM test_assert(n=0,'private direct task delete succeeded');
END $$;

-- Actual owner insert uses all production triggers, not seeded bypasses.
SET ROLE authenticated;
SELECT set_config('test.actor',test_id(10)::text,false);
INSERT INTO clients(id,company_id,assigned_to,name,phone,client_type,is_investor)
VALUES(test_id(2500),test_id(1),test_id(11),'Synthetic new investor','٩١١٠٢٥٠٠','investor',true);
SELECT test_assert(EXISTS(SELECT 1 FROM clients WHERE id=test_id(2500) AND lead_route='investment' AND assigned_to=test_id(10) AND phone_normalized='+96891102500'),'owner manual investor not canonical/owner assigned');
-- Optional qualification fields stay optional; geography cannot override investment.
INSERT INTO client_requests(id,company_id,client_id,request_type,assigned_to,preferred_area,created_by)
VALUES(test_id(2501),test_id(1),test_id(2500),'investor',test_id(11),'بركاء مسقط',test_id(10));
SELECT test_assert(EXISTS(SELECT 1 FROM client_requests WHERE id=test_id(2501) AND request_type='investor' AND route_key='investment' AND branch_key='investment' AND assigned_to=test_id(10)),'investment request rerouted by geography');
SELECT test_assert(EXISTS(SELECT 1 FROM client_request_assignees WHERE request_id=test_id(2501) AND user_id=test_id(10) AND branch_key='investment') AND NOT EXISTS(SELECT 1 FROM client_request_assignees WHERE request_id=test_id(2501) AND user_id<>test_id(10)),'investment request assigned to employee');
SELECT test_assert(EXISTS(SELECT 1 FROM client_requests WHERE id=test_id(2501) AND first_human_response_at IS NULL AND qualified_at IS NULL AND first_appointment_booked_at IS NULL AND first_attended_at IS NULL AND first_match_sent_at IS NULL AND serious_interest_at IS NULL AND negotiation_started_at IS NULL AND deposit_paid_at IS NULL AND contract_completed_at IS NULL AND closed_won_at IS NULL),'investor creation fabricated milestones');
UPDATE client_requests SET budget_min=100000,budget_max=200000,payment_method='cash',financing_readiness='cash_confirmed',purchase_timing='within_3_months',purpose='investment',preferred_areas=ARRAY['مسقط'],next_action='Synthetic owner call',next_followup='2026-10-20',priority=1,decision_maker_status='self',search_status='no_response' WHERE id=test_id(2501);
SELECT test_assert(EXISTS(SELECT 1 FROM client_requests WHERE id=test_id(2501) AND budget_min=100000 AND next_action='Synthetic owner call' AND status='active' AND closed_at IS NULL AND route_key='investment'),'owner request edit failed or no response treated as loss');
DO $$BEGIN
 BEGIN INSERT INTO clients(company_id,name,phone,client_type,lead_route) VALUES(test_id(1),'Duplicate investor','+96891102500','investor','investment');RAISE EXCEPTION 'duplicate phone unexpectedly inserted';EXCEPTION WHEN unique_violation THEN NULL;END;
END$$;
SELECT test_assert((SELECT count(*) FROM clients WHERE phone_normalized='+96891102500')=1,'duplicate guard changed');
SELECT test_assert((crm_client_360(test_id(2500))->'client'->>'id')=test_id(2500)::text,'owner client360 unavailable');
INSERT INTO tasks(company_id,user_id,client_id,request_id,title) VALUES(test_id(1),test_id(10),test_id(2500),test_id(2501),'Synthetic owner follow-up');
SELECT test_assert(EXISTS(SELECT 1 FROM tasks WHERE client_id=test_id(2500) AND user_id=test_id(10)),'owner investor followup unavailable');
-- All stages use existing request timestamps and the existing client360 response.
UPDATE client_requests SET first_human_response_at='2026-10-15 08:01+00',requirements_completed_at='2026-10-15 08:02+00',qualified_at='2026-10-15 08:03+00',first_appointment_booked_at='2026-10-15 08:04+00',first_attended_at='2026-10-15 08:05+00',first_match_sent_at='2026-10-15 08:06+00',serious_interest_at='2026-10-15 08:07+00',negotiation_started_at='2026-10-15 08:08+00',deposit_paid_at='2026-10-15 08:09+00',contract_completed_at='2026-10-15 08:10+00',closed_won_at='2026-10-15 08:11+00' WHERE id=test_id(2501);
SELECT test_assert((SELECT count(*) FROM client_request_events WHERE request_id=test_id(2501) AND event_type IN('human_responded','requirements_completed','qualified','appointment_booked','attended','match_sent','serious_interest','negotiation_started','deposit_paid','contract_completed','closed_won'))=11,'existing investment milestone event history incomplete');
SELECT test_assert(EXISTS(SELECT 1 FROM jsonb_array_elements(crm_client_360(test_id(2500))->'requests') r WHERE r->>'id'=test_id(2501)::text AND (r->>'closed_won_at')::timestamptz='2026-10-15 08:11+00'::timestamptz AND (r->>'budget_min')::numeric=100000),'owner profile omits qualification/milestone data');
UPDATE company_lead_routes SET owner_only_inbox=false,assigned_to=test_id(11) WHERE id=test_id(22);
SELECT test_assert(EXISTS(SELECT 1 FROM company_lead_routes WHERE id=test_id(22) AND owner_only_inbox IS TRUE AND assigned_to=test_id(10)),'investment route config permitted employee assignment');
-- Explicit ordinary-route choice is allowed; legacy investors are not bulk converted.
INSERT INTO clients(id,company_id,name,client_type,lead_route,assigned_to) VALUES(test_id(2510),test_id(1),'Explicit owner Muscat investor','investor','muscat',test_id(11));
SELECT test_assert(EXISTS(SELECT 1 FROM clients WHERE id=test_id(2510) AND lead_route='muscat' AND assigned_to=test_id(11)),'owner explicit branch was overridden');

SELECT set_config('test.actor',test_id(11)::text,false);
SELECT test_private_surfaces_hidden();
SELECT test_assert(EXISTS(SELECT 1 FROM clients WHERE id=test_id(100)) AND EXISTS(SELECT 1 FROM clients WHERE id=test_id(103)) AND EXISTS(SELECT 1 FROM clients WHERE id=test_id(106)),'Muscat ordinary/legacy clients changed');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM clients WHERE id IN(test_id(101),test_id(104))),'Muscat gained Barka access');
SELECT test_assert(EXISTS(SELECT 1 FROM whatsapp_conversations WHERE id=test_id(400)) AND NOT EXISTS(SELECT 1 FROM whatsapp_conversations WHERE id=test_id(401)),'Muscat ordinary inbox boundary changed');
SELECT test_assert(EXISTS(SELECT 1 FROM notifications WHERE id=test_id(1200)),'ordinary staff notification hidden');
-- Staff's existing ordinary investor flags keep their current office semantics.
INSERT INTO clients(id,company_id,name,client_type,is_investor,lead_route,assigned_to) VALUES(test_id(2511),test_id(1),'Synthetic ordinary staff investor flag','investor',true,'muscat',test_id(11));
SELECT test_assert(EXISTS(SELECT 1 FROM clients WHERE id=test_id(2511) AND lead_route='muscat' AND assigned_to=test_id(11)),'staff ordinary investor flag was silently converted');
SELECT set_config('test.actor',test_id(12)::text,false);
SELECT test_private_surfaces_hidden();
SELECT test_assert(EXISTS(SELECT 1 FROM clients WHERE id=test_id(101)) AND EXISTS(SELECT 1 FROM clients WHERE id=test_id(104)),'Barka ordinary/legacy clients changed');
SELECT test_assert(NOT EXISTS(SELECT 1 FROM clients WHERE id IN(test_id(100),test_id(103))),'Barka gained Muscat access');
SELECT test_assert(EXISTS(SELECT 1 FROM whatsapp_conversations WHERE id=test_id(401)) AND NOT EXISTS(SELECT 1 FROM whatsapp_conversations WHERE id=test_id(400)),'Barka ordinary inbox boundary changed');
SELECT set_config('test.actor',test_id(13)::text,false);
SELECT test_private_surfaces_hidden();
SELECT set_config('test.actor',test_id(14)::text,false);
SELECT test_private_surfaces_hidden();
SELECT set_config('test.actor',test_id(15)::text,false);
SELECT test_private_surfaces_hidden();
SELECT set_config('test.actor',test_id(16)::text,false);
-- Foreign owner may see their own company's investment client, never company one.
SELECT test_assert(NOT EXISTS(SELECT 1 FROM clients WHERE id=test_id(102)),'cross-company investor leak');
SELECT test_assert(NOT crm_repair_private.investment_row_allowed(test_id(1),jsonb_build_object('lead_route','investment')),'foreign owner passed investment helper');
SELECT set_config('test.actor',test_id(10)::text,false);
SELECT test_assert(EXISTS(SELECT 1 FROM clients WHERE id=test_id(102)) AND EXISTS(SELECT 1 FROM client_requests WHERE id=test_id(206)),'owner lost private access');
SELECT test_assert(EXISTS(SELECT 1 FROM notifications WHERE id=test_id(1205)),'owner notification inaccessible');
SELECT test_assert(EXISTS(SELECT 1 FROM viewings WHERE id=test_id(602)) AND EXISTS(SELECT 1 FROM appointments WHERE id=test_id(702)) AND EXISTS(SELECT 1 FROM crm_deals_access WHERE id=test_id(802)),'owner related data inaccessible');
RESET ROLE;
SELECT set_config('test.actor','',false);
SELECT test_assert_ordinary_unchanged();
SET ROLE authenticated;
DO $$DECLARE n int; BEGIN
 FOR n IN 10..16 LOOP
  PERFORM set_config('test.actor',test_id(n)::text,false);
  PERFORM test_assert(test_ordinary_visibility()=(SELECT visibility FROM test_ordinary_visibility_before WHERE actor=auth.uid()),'ordinary surface visibility changed for role '||n);
 END LOOP;
END$$;
RESET ROLE;
SELECT set_config('test.actor','',false);
SELECT 'Investment owner-only role/table/linked-data/creation assertions passed' AS result;
COMMIT;

-- Shared AI summaries are stored on ordinary client/property records. Owner-only
-- evidence classification must exclude canonical/transitive private rows even for owner.
BEGIN;
SET session_replication_role=replica;
INSERT INTO property_inquiries(id,company_id,client_id,property_id,source_whatsapp_message_id,status)
VALUES(test_id(4000),test_id(1),test_id(100),test_id(301),test_id(504),'inquiry');
INSERT INTO viewings(id,company_id,client_id,property_id,agent_id,viewing_date,status,source_whatsapp_message_id)
VALUES(test_id(4001),test_id(1),test_id(100),test_id(300),test_id(11),'2026-01-06','done',test_id(504));
SET session_replication_role=origin;
SET ROLE authenticated;
SELECT set_config('test.actor',test_id(10)::text,false);
SELECT test_assert(crm_shared_ai_evidence_mask(jsonb_build_array(
 jsonb_build_object('table','clients','id',test_id(100)),
 jsonb_build_object('table','clients','id',test_id(102)),
 jsonb_build_object('table','client_requests','id',test_id(206)),
 jsonb_build_object('table','property_inquiries','id',test_id(4000)),
 jsonb_build_object('table','viewings','id',test_id(4001)),
 jsonb_build_object('table','clients','id',test_id(105)),
 jsonb_build_object('table','clients','id',test_id(99999)),
 jsonb_build_object('table','properties','id',test_id(300))
))=ARRAY[true,false,false,false,false,false,false,true],'shared AI evidence mask leaked private/foreign/missing evidence or rejected public evidence');
SELECT test_assert(crm_shared_ai_evidence_mask('[]')='{}'::boolean[],'empty evidence input incorrect');
SELECT test_assert(crm_repair_private.shared_ai_evidence_mask(jsonb_build_array(jsonb_build_object('table','clients','id',test_id(100)),jsonb_build_object('table','clients','id',test_id(102))))=ARRAY[true,false],'checked private helper owner result incorrect');
DO $$DECLARE rows jsonb;BEGIN
 SELECT jsonb_agg(jsonb_build_object('table','clients','id',test_id(100))) INTO rows FROM generate_series(1,1000);
 PERFORM test_assert(cardinality(crm_shared_ai_evidence_mask(rows))=1000,'valid 1000-row evidence bound rejected');
 BEGIN PERFORM crm_shared_ai_evidence_mask(rows||jsonb_build_array(jsonb_build_object('table','clients','id',test_id(100))));RAISE EXCEPTION 'over-bound evidence input succeeded';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM crm_shared_ai_evidence_mask(jsonb_build_array(jsonb_build_object('table','clients','id',repeat('x',262145))));RAISE EXCEPTION 'over-byte-bound evidence input succeeded';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM crm_shared_ai_evidence_mask('{"table":"clients"}');RAISE EXCEPTION 'non-array evidence input succeeded';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM crm_shared_ai_evidence_mask(jsonb_build_array(jsonb_build_object('table','clients;DROP TABLE clients;--','id',test_id(100))));RAISE EXCEPTION 'table injection succeeded';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM crm_shared_ai_evidence_mask(jsonb_build_array(jsonb_build_object('table','clients','id','not-a-uuid')));RAISE EXCEPTION 'invalid evidence ID succeeded';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM crm_shared_ai_evidence_mask(jsonb_build_array(jsonb_build_object('table','clients','id',test_id(102),'lead_route','muscat')));RAISE EXCEPTION 'forged evidence fields accepted';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
END$$;
DO $$DECLARE n int;BEGIN
 FOR n IN 11..15 LOOP
  PERFORM set_config('test.actor',test_id(n)::text,false);
  BEGIN PERFORM crm_shared_ai_evidence_mask(jsonb_build_array(jsonb_build_object('table','clients','id',test_id(100))));RAISE EXCEPTION 'nonowner could classify owner evidence';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
  BEGIN PERFORM crm_repair_private.shared_ai_evidence_mask(jsonb_build_array(jsonb_build_object('table','clients','id',test_id(100))));RAISE EXCEPTION 'nonowner bypassed wrapper via private helper';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 END LOOP;
 PERFORM set_config('test.actor',test_id(16)::text,false);
 PERFORM test_assert(crm_shared_ai_evidence_mask(jsonb_build_array(jsonb_build_object('table','clients','id',test_id(100))))=ARRAY[false],'foreign owner classified another company row');
END$$;
RESET ROLE;
SELECT test_assert(NOT has_function_privilege('anon','public.crm_shared_ai_evidence_mask(jsonb)','EXECUTE') AND NOT has_function_privilege('service_role','public.crm_shared_ai_evidence_mask(jsonb)','EXECUTE'),'shared evidence RPC has accidental backend/public grants');
SELECT test_assert(NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.crm_shared_ai_evidence_mask(jsonb)'::regprocedure) AND (SELECT prosecdef FROM pg_proc WHERE oid='crm_repair_private.shared_ai_evidence_mask(jsonb)'::regprocedure),'public evidence RPC must be invoker with checked private definer');
SELECT test_assert(NOT has_function_privilege('anon','crm_repair_private.shared_ai_evidence_mask(jsonb)','EXECUTE') AND NOT has_function_privilege('service_role','crm_repair_private.shared_ai_evidence_mask(jsonb)','EXECUTE'),'private checked helper has accidental backend/public grants');
SELECT test_assert(NOT has_function_privilege('authenticated','crm_repair_private.investment_link_is_private(uuid,jsonb,text[])','EXECUTE') AND NOT has_table_privilege('authenticated','crm_repair_private.investment_catalog_backup','SELECT'),'private traversal/backup exposed');
ROLLBACK;
SELECT test_assert_ordinary_unchanged();
SELECT 'Shared AI evidence owner-only, transitive privacy and bounded-input assertions passed' AS result;
