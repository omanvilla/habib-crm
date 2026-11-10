-- SQL77b (10 Nov 2026, one-off data for Ahmed's instructions 1 and 2). Apply once, as its own migration, AFTER
-- 77-deals-one-card.forward.sql and BEFORE 77c. It runs as the database owner: auth.uid() is NULL, so every stage
-- change is recorded as automation (deal_stage_history.changed_by NULL), never as a person.
--  1. Merge the duplicate cards (one client + one property = one card). The duplicate becomes lost with NO loss reason
--     and is hidden as merged (snapshots in crm_repair_private.deal_merge_audit).
--  2. Archive the AI's duplicate «done» visits of one real visit (same client, property and date: the earliest stays).
--     The cards pointing at an archived duplicate move to the visit that stays; its notes keep the duplicate's text.
--  3. Close the cards still open on sold/withdrawn properties through the same automation as the new trigger
--     (reason property_unavailable, note «تلقائي: ...», activities row actor_type system, an owner notification naming
--     the clients; a card the rule leaves open becomes an owner task: none on 10 Nov, the dry run left 0 open).
-- Every id was checked against the 10 Nov audit; anything that moved since stops the whole migration. Before-images
-- of every changed viewing, card, interest and rejection row go to crm_repair_private.deals_cleanup_20261110.
-- No customer is messaged: no property status changes here (checked at the end), so trg_queue_property_outreach never
-- runs, and no pg_net request may be queued by this transaction (checked at the end).
-- Order with SQL76b: if 76b ran first, the 3 Falah villas it moves to withdrawn (12bc5654, 9457b323, 473b069f, Ahmed 9
-- Nov «خلصت مدة العقد وقفها في CRM») are sold/withdrawn here too, so their open cards close in step 3 as well (8 cards
-- on 10 Nov, 2 of them in negotiation); they are listed as extras. Archived not_available rows are not in this pass.
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '180s';

DO $$
BEGIN
  IF to_regprocedure('crm_repair_private.merge_duplicate_deal(uuid,uuid,boolean,text)') IS NULL
     OR to_regprocedure('crm_repair_private.close_deals_on_unavailable_properties(boolean)') IS NULL
     OR position('merged_into_deal_id' IN pg_get_functiondef('public.sync_viewing_to_crm()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'SQL77b refused: apply 77-deals-one-card.forward.sql first';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS crm_repair_private.deals_cleanup_20261110(
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  step text NOT NULL,
  table_name text NOT NULL,
  row_id uuid NOT NULL,
  before_row jsonb NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE crm_repair_private.deals_cleanup_20261110 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE crm_repair_private.deals_cleanup_20261110 FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE crm_repair_private.deals_cleanup_20261110 IS 'SQL77b: before-images of every viewing, deal, interest and rejection row changed by the 10 Nov 2026 cleanup.';

-- Baselines for the final checks: the last pg_net request id, every property's status/archived, the buyer deal of
-- Khoudh 120 (722aa5fc, must stay byte-identical).
CREATE TEMP TABLE c77b_counts(k text PRIMARY KEY, n bigint, snapshot jsonb) ON COMMIT DROP;
DO $$
DECLARE v bigint;
BEGIN
  IF to_regclass('net.http_request_queue') IS NOT NULL THEN
    EXECUTE 'SELECT coalesce(max(id), 0) FROM net.http_request_queue' INTO v;
    INSERT INTO c77b_counts VALUES ('net_max_id', v, NULL);
  END IF;
  INSERT INTO c77b_counts VALUES ('property_states', NULL,
    (SELECT jsonb_object_agg(p.id::text, coalesce(p.status, '') || '|' || coalesce(p.archived, false)::text) FROM public.properties p));
  INSERT INTO c77b_counts VALUES ('buyer_722aa5fc', NULL,
    (SELECT to_jsonb(d) FROM public.deals d WHERE d.id = '722aa5fc-6789-48dd-a3b0-680fad279208'));
  IF (SELECT snapshot->>'stage' FROM c77b_counts WHERE k = 'buyer_722aa5fc') IS DISTINCT FROM 'commission_collected' THEN
    RAISE EXCEPTION 'SQL77b refused: buyer deal 722aa5fc of Khoudh 120 is not commission_collected any more';
  END IF;
END $$;

-- 0. Optimistic check: every card of the merges is still exactly as the audit saw it.
CREATE TEMP TABLE c77b_merges(ord int PRIMARY KEY, keep_id uuid NOT NULL, drop_id uuid NOT NULL, take_over boolean NOT NULL,
  property_id uuid NOT NULL, keep_stage text NOT NULL, keep_updated timestamptz NOT NULL, drop_stage text NOT NULL,
  drop_updated timestamptz NOT NULL, label text NOT NULL) ON COMMIT DROP;
INSERT INTO c77b_merges VALUES
 -- pair 1 Hail South 130: the kept card keeps its own visit fa343edd and adopts the active request f1e899b0
 (1,'589feb47-db47-400f-952b-ed769e4473af','0607f87e-0008-410a-9563-a4f06469503c',false,'b0c33c1c-bcaf-45b9-a769-ad49a3faaba5',
  'visit','2026-11-07 13:33:45.286478+00','visit','2026-11-07 13:37:42.07525+00','pair 1 (request cancelled and replaced)'),
 (2,'04ae2c63-9422-444d-871a-5a6b85d2a62a','0d9d3458-5255-4ae0-95b4-7d54aa8dc3b4',true,'473b069f-e984-4cd9-a883-6c854009dc7c',
  'viewing_scheduled','2026-09-16 09:08:03.694816+00','visit','2026-11-05 08:04:07.729008+00','pair 2 (5 Nov repair batch)'),
 -- pair 3 is on the SOLD Sultan 1: merged first, then step 3 closes the kept card
 (3,'7a10308f-370f-4aa3-96cf-bf9b1d2961dd','df608450-b9e1-46a1-acc9-1edd6dc4c7df',true,'666b4302-3740-4c9e-bc65-b92d5b71fdd4',
  'viewing_scheduled','2026-11-05 06:18:10.421418+00','viewing_no_show','2026-11-06 11:30:32.823103+00','pair 3 (visit saved before the first request)'),
 (4,'b3aee65a-6bc0-40c0-96d6-2b4120358d7d','97687bce-d18e-4254-a08f-5ce75f82dab8',true,'7dcf14b8-1481-4b9d-bae6-c9bd375bce79',
  'viewing_scheduled','2026-11-07 08:44:23.350283+00','visit','2026-11-08 05:00:13.398353+00','pair 4 (visit recorded before the request)'),
 (5,'81c87556-8924-47e8-954f-ef0b7156358a','59ad628e-2372-44e8-afd4-616c857c8629',true,'0105b114-b1ae-4aaa-ab08-16cc8a5e80df',
  'viewing_postponed','2026-09-13 13:46:58.11404+00','visit','2026-11-05 08:04:07.729008+00','pair 5 (5 Nov repair batch)'),
 -- the client's real result card (lost, disliked) stays; the stale open card of the same visit is merged into it
 (6,'44e9916f-9c2d-4cb9-b35b-baaa9ccbe74a','a0f7f0ac-3555-4aa5-b30a-006b333af8dc',false,'43455d79-be84-45a3-8114-ddfb06972988',
  'lost','2026-11-05 06:23:57.702246+00','viewing_scheduled','2026-11-04 11:04:54.370042+00','extra pair (lost result card stays)'),
 -- the legacy lost card stays; the open card the 5 Nov batch added on the same visit is merged into it
 (7,'007b1e4f-3c84-4d82-a81e-f88b8cc1edd1','daeff763-2d9a-4f68-b2c9-3547b771b76d',false,'b58f9074-3fd4-47e8-b31f-9ed9d829e863',
  'lost','2026-09-14 12:46:06.441+00','visit','2026-11-05 08:04:07.729008+00','extra pair (legacy lost card stays)');

DO $$
DECLARE m record;
BEGIN
  -- lock the 14 cards first, so nothing can move them between this check and the merge
  PERFORM 1 FROM public.deals d
    WHERE d.id IN (SELECT keep_id FROM c77b_merges UNION SELECT drop_id FROM c77b_merges)
    ORDER BY d.id FOR UPDATE;
  FOR m IN SELECT * FROM c77b_merges ORDER BY ord LOOP
    IF NOT EXISTS (SELECT 1 FROM public.deals d WHERE d.id = m.keep_id AND d.property_id = m.property_id
                   AND d.stage = m.keep_stage AND d.updated_at = m.keep_updated AND d.merged_into_deal_id IS NULL) THEN
      RAISE EXCEPTION 'SQL77b refused: card % changed since the 10 Nov audit (expected % at %)', m.keep_id, m.keep_stage, m.keep_updated;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.deals d WHERE d.id = m.drop_id AND d.property_id = m.property_id
                   AND d.stage = m.drop_stage AND d.updated_at = m.drop_updated AND d.merged_into_deal_id IS NULL) THEN
      RAISE EXCEPTION 'SQL77b refused: card % changed since the 10 Nov audit (expected % at %)', m.drop_id, m.drop_stage, m.drop_updated;
    END IF;
  END LOOP;
END $$;

-- The cards that must end closed on sold properties (13 incl. the kept card of pair 3): present, open, property sold.
CREATE TEMP TABLE c77b_expected_close(deal_id uuid PRIMARY KEY, property_id uuid NOT NULL) ON COMMIT DROP;
INSERT INTO c77b_expected_close VALUES
 ('12a3ad83-4c3e-4018-b729-9f4f23e84044','bf69eca0-56fb-47c8-8784-75a802ca59e6'),  -- Khoudh 120, negotiation
 ('6ab03d65-e9da-404d-aedf-b137140cbb3a','bf69eca0-56fb-47c8-8784-75a802ca59e6'),  -- Khoudh 120
 ('7dabfce3-c13d-4073-9bfe-7f9b366c795d','bf69eca0-56fb-47c8-8784-75a802ca59e6'),  -- Khoudh 120
 ('233732d2-2b03-47a4-89c7-cd3e3fe1dc31','666b4302-3740-4c9e-bc65-b92d5b71fdd4'),  -- Rumais 59 Sultan 1
 ('7a10308f-370f-4aa3-96cf-bf9b1d2961dd','666b4302-3740-4c9e-bc65-b92d5b71fdd4'),  -- Sultan 1, kept card of pair 3
 ('e53c71e1-1ccf-46b9-9776-248e74afa90f','666b4302-3740-4c9e-bc65-b92d5b71fdd4'),
 ('db119bbe-8dca-4533-a8ad-2b19f1e5a31d','666b4302-3740-4c9e-bc65-b92d5b71fdd4'),
 ('2e164119-3cd9-43b1-b03e-f71e8b970c5a','666b4302-3740-4c9e-bc65-b92d5b71fdd4'),
 ('3e3c78bc-f264-4386-a6fd-044eb1b9842c','666b4302-3740-4c9e-bc65-b92d5b71fdd4'),
 ('2071daed-4958-4bc0-8078-a72425ef2b4f','eb460979-70c9-4fe8-83f7-e6fc31a87cc4'),  -- Sultan 2
 ('12088094-be81-4a22-b260-3830084b2dac','53c879f0-f7da-4584-a948-3e6bf5e19fbb'),
 ('9fa91880-8feb-443b-bf32-4b050aa7cdac','3cfa692a-0913-4c9f-a834-ff0d10d4ed59'),
 ('6d74ef25-72d3-48e2-99b0-0c23ac0aa9d4','3cfa692a-0913-4c9f-a834-ff0d10d4ed59');
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT e.*, d.stage, d.merged_into_deal_id, p.status
             FROM c77b_expected_close e
             LEFT JOIN public.deals d ON d.id = e.deal_id AND d.property_id = e.property_id
             LEFT JOIN public.properties p ON p.id = e.property_id LOOP
    IF r.stage IS NULL OR r.stage IN ('lost','closed','commission_collected') OR r.merged_into_deal_id IS NOT NULL OR r.status IS DISTINCT FROM 'sold' THEN
      RAISE EXCEPTION 'SQL77b refused: card % is not an open card on a sold property any more (stage %, property %)', r.deal_id, r.stage, r.status;
    END IF;
  END LOOP;
END $$;

-- 1. Merges ---------------------------------------------------------------------------------------------------------
DO $$
DECLARE m record;
BEGIN
  FOR m IN SELECT * FROM c77b_merges ORDER BY ord LOOP
    PERFORM crm_repair_private.merge_duplicate_deal(m.keep_id, m.drop_id, m.take_over,
      'SQL77b 2026-11-10 (Ahmed: عميل واحد + عقار واحد = صفقة واحدة): ' || m.label);
  END LOOP;
END $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
     ('589feb47-db47-400f-952b-ed769e4473af'::uuid,'visit','fa343edd-7aac-4077-a1c3-0dfbe35a2180'::uuid,'f1e899b0-da4d-46e3-b998-610bc3bf136b'::uuid),
     ('04ae2c63-9422-444d-871a-5a6b85d2a62a','visit','7793b0af-7011-4b9c-8754-69ad304f1901','1b014410-684b-4295-be28-e2428db20b3c'),
     ('7a10308f-370f-4aa3-96cf-bf9b1d2961dd','viewing_no_show','9ce95fe8-0c47-48f0-b7ed-aa6afec30b5d','253f1e3c-ae73-4d29-a45c-acc0fc4f4c1d'),
     ('b3aee65a-6bc0-40c0-96d6-2b4120358d7d','visit','d3de6963-a803-4c24-9936-091ad85e61ca','c44a5306-7d68-49b3-a615-8c242991689f'),
     ('81c87556-8924-47e8-954f-ef0b7156358a','visit','b5aa353d-26c4-461d-9d4f-2f2793349dcb','ae7a955f-b7d1-48b8-b264-5cb475ceb9a8'),
     ('44e9916f-9c2d-4cb9-b35b-baaa9ccbe74a','lost','3d741dc4-5378-4a10-b6e6-393c0dcb8fa9','f2115e3e-476b-4ec2-865d-b77f0e38832d'),
     ('007b1e4f-3c84-4d82-a81e-f88b8cc1edd1','lost','1efcae9a-f2c6-434a-86ab-1664bd1a523e',NULL)
   ) AS x(id, stage, viewing_id, request_id) LOOP
    IF NOT EXISTS (SELECT 1 FROM public.deals d WHERE d.id = r.id AND d.stage = r.stage AND d.viewing_id = r.viewing_id
                   AND d.request_id IS NOT DISTINCT FROM r.request_id AND d.merged_into_deal_id IS NULL) THEN
      RAISE EXCEPTION 'SQL77b: kept card % is not % / % / % after the merge', r.id, r.stage, r.viewing_id, r.request_id;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.deals d JOIN c77b_merges m ON m.drop_id = d.id
       WHERE d.stage = 'lost' AND d.merged_into_deal_id = m.keep_id AND d.merged_at IS NOT NULL
         AND d.lost_reason_id IS NULL AND d.lost_reason_note IS NULL AND d.lost_from_stage = m.drop_stage) <> 7 THEN
    RAISE EXCEPTION 'SQL77b: the 7 duplicates are not all merged as lost without a loss reason';
  END IF;
END $$;

-- 2. The AI's duplicate «done» visits of one real visit (pair 1: d2daddde and c2f1fbc7, fa343edd stays) ----------------
CREATE TEMP TABLE c77b_dup_visits ON COMMIT DROP AS
SELECT x.id AS dup_id, x.keep_id
  FROM (SELECT v.id,
               first_value(v.id) OVER w AS keep_id,
               row_number() OVER w AS rn
          FROM public.viewings v
         WHERE v.created_via = 'whatsapp_ai' AND v.status = 'done' AND coalesce(v.archived, false) = false
           AND v.client_id IS NOT NULL AND v.property_id IS NOT NULL AND v.viewing_date IS NOT NULL
        WINDOW w AS (PARTITION BY v.company_id, v.client_id, v.property_id, v.viewing_date ORDER BY v.created_at, v.id)) x
 WHERE x.rn > 1;
DO $$
BEGIN
  IF (SELECT count(*) FROM c77b_dup_visits WHERE keep_id = 'fa343edd-7aac-4077-a1c3-0dfbe35a2180'
        AND dup_id IN ('d2daddde-6345-4ac7-9f58-c2abd782c8f2','c2f1fbc7-b228-4546-9d52-9a09d09cfac5')) <> 2 THEN
    RAISE EXCEPTION 'SQL77b refused: pair 1 visits d2daddde/c2f1fbc7 are not duplicates of fa343edd any more';
  END IF;
  -- 10 Nov audit: 5 duplicates in 4 groups; besides pair 1: c3320167-ed96-4e0e-8d89-b0dfef81a504 -> 096ff9d8-1e7a-42ac-af5d-3d635447e30c,
  -- 0cfda818-602c-4518-bfaf-198626266f65 -> 2813ecf2-fcb6-405f-b55a-d19a35fdac6c, 79988059-1fb9-4032-be66-4a7984f368a5 ->
  -- eab1a40e-bb39-4554-8eee-b3362023ba46. Their cards (b8733c07, f1699fde, 5ba1d7ec) had moved to the duplicate and go back.
  RAISE NOTICE 'SQL77b duplicate AI done visits to archive: %', (SELECT count(*) FROM c77b_dup_visits);
END $$;

INSERT INTO crm_repair_private.deals_cleanup_20261110(step, table_name, row_id, before_row)
SELECT 'archive_duplicate_visit', 'viewings', v.id, to_jsonb(v)
  FROM public.viewings v
 WHERE v.id IN (SELECT dup_id FROM c77b_dup_visits UNION SELECT keep_id FROM c77b_dup_visits);
INSERT INTO crm_repair_private.deals_cleanup_20261110(step, table_name, row_id, before_row)
SELECT 'repoint_card_to_kept_visit', 'deals', d.id, to_jsonb(d)
  FROM public.deals d JOIN c77b_dup_visits x ON x.dup_id = d.viewing_id
 WHERE d.merged_into_deal_id IS NULL;

-- the cards on a duplicate move to the visit that stays (never a second open card on that visit)
UPDATE public.deals d SET viewing_id = x.keep_id, updated_at = now()
  FROM c77b_dup_visits x
 WHERE d.viewing_id = x.dup_id AND d.merged_into_deal_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.deals o WHERE o.viewing_id = x.keep_id AND o.id <> d.id AND o.merged_into_deal_id IS NULL
                     AND o.stage NOT IN ('lost','closed','commission_collected'));
-- the visit that stays keeps what the duplicates said
UPDATE public.viewings k
   SET notes = concat_ws(E'\n', nullif(btrim(k.notes), ''), '[من زيارة مكررة انأرشفت 2026-11-10] ' || x.dup_notes)
  FROM (SELECT dv.keep_id, string_agg(btrim(v.notes), ' | ' ORDER BY v.created_at, v.id) AS dup_notes
          FROM c77b_dup_visits dv JOIN public.viewings v ON v.id = dv.dup_id
         WHERE nullif(btrim(v.notes), '') IS NOT NULL
         GROUP BY dv.keep_id) x
 WHERE k.id = x.keep_id;
UPDATE public.viewings v
   SET archived = true,
       notes = concat_ws(E'\n', nullif(btrim(v.notes), ''), '[مكررة] نفس الزيارة ' || x.keep_id::text || '؛ انأرشفت 2026-11-10')
  FROM c77b_dup_visits x
 WHERE v.id = x.dup_id AND coalesce(v.archived, false) = false;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.deals d JOIN c77b_dup_visits x ON x.dup_id = d.viewing_id WHERE d.merged_into_deal_id IS NULL) THEN
    RAISE EXCEPTION 'SQL77b: a live card still points at an archived duplicate visit';
  END IF;
  IF EXISTS (SELECT 1 FROM public.viewings v WHERE v.created_via = 'whatsapp_ai' AND v.status = 'done' AND coalesce(v.archived, false) = false
              GROUP BY v.company_id, v.client_id, v.property_id, v.viewing_date HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'SQL77b: duplicate AI done visits remain';
  END IF;
END $$;

-- 3. Close the cards on sold/withdrawn properties through the automation ----------------------------------------------
CREATE TEMP TABLE c77b_close_plan ON COMMIT DROP AS
SELECT (c->>'deal_id')::uuid AS deal_id, (it->>'property_id')::uuid AS property_id
  FROM jsonb_array_elements(crm_repair_private.close_deals_on_unavailable_properties(false)->'items') it,
       jsonb_array_elements(it->'closed') c;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM c77b_expected_close e WHERE NOT EXISTS (SELECT 1 FROM c77b_close_plan c WHERE c.deal_id = e.deal_id)) THEN
    RAISE EXCEPTION 'SQL77b refused: the closing rule would not close every expected card on the sold properties';
  END IF;
  -- 10 Nov: exactly the 13 expected cards (21 when 76b ran first: + the 8 on the 3 Falah villas). Any other extra is a
  -- property that became sold/withdrawn since; Ahmed's rule closes those too, and they are listed here.
  RAISE NOTICE 'SQL77b cards to close: % (expected 13, or 21 after 76b); extra: %', (SELECT count(*) FROM c77b_close_plan),
    (SELECT coalesce(string_agg(c.deal_id::text || ' (property ' || c.property_id::text || ')', ', ' ORDER BY c.property_id, c.deal_id), 'none')
       FROM c77b_close_plan c WHERE NOT EXISTS (SELECT 1 FROM c77b_expected_close e WHERE e.deal_id = c.deal_id));
END $$;

INSERT INTO crm_repair_private.deals_cleanup_20261110(step, table_name, row_id, before_row)
SELECT 'close_unavailable', 'deals', d.id, to_jsonb(d)
  FROM public.deals d WHERE d.id IN (SELECT deal_id FROM c77b_close_plan);
INSERT INTO crm_repair_private.deals_cleanup_20261110(step, table_name, row_id, before_row)
SELECT 'close_unavailable', 'property_inquiries', pi.id, to_jsonb(pi)
  FROM public.property_inquiries pi
 WHERE EXISTS (SELECT 1 FROM public.deals d JOIN c77b_close_plan c ON c.deal_id = d.id
                WHERE pi.company_id = d.company_id AND pi.client_id = d.client_id AND pi.property_id = d.property_id);
INSERT INTO crm_repair_private.deals_cleanup_20261110(step, table_name, row_id, before_row)
SELECT 'close_unavailable', 'property_rejection_reasons', rr.id, to_jsonb(rr)
  FROM public.property_rejection_reasons rr
 WHERE EXISTS (SELECT 1 FROM public.deals d JOIN c77b_close_plan c ON c.deal_id = d.id
                WHERE rr.company_id = d.company_id AND rr.client_id = d.client_id AND rr.property_id = d.property_id);

CREATE TEMP TABLE c77b_close_result ON COMMIT DROP AS
SELECT crm_repair_private.close_deals_on_unavailable_properties(true) AS r;

-- 4. Final checks ----------------------------------------------------------------------------------------------------
DO $$
DECLARE v bigint; v_base bigint; v_reason uuid;
BEGIN
  SELECT r.id INTO v_reason FROM public.rejection_reasons r
   WHERE r.company_id = '39384059-ac7e-44a7-858a-dc25fcbb7043' AND r.code = 'property_unavailable' AND r.is_active;
  IF EXISTS (SELECT 1 FROM c77b_close_plan c JOIN public.deals d ON d.id = c.deal_id
              WHERE d.stage <> 'lost' OR d.lost_reason_id IS DISTINCT FROM v_reason OR d.lost_reason_note NOT LIKE 'تلقائي:%') THEN
    RAISE EXCEPTION 'SQL77b: a planned card did not close as property_unavailable';
  END IF;
  IF (SELECT (r->>'closed')::int FROM c77b_close_result) <> (SELECT count(*) FROM c77b_close_plan) THEN
    RAISE EXCEPTION 'SQL77b: closed % cards, planned %', (SELECT r->>'closed' FROM c77b_close_result), (SELECT count(*) FROM c77b_close_plan);
  END IF;
  IF (SELECT count(*) FROM public.activities a JOIN c77b_close_plan c ON c.deal_id = a.deal_id
       WHERE a.actor_type = 'system' AND a.description LIKE '[تلقائي] %') < (SELECT count(*) FROM c77b_close_plan) THEN
    RAISE EXCEPTION 'SQL77b: an automatic closure has no system activity row';
  END IF;
  IF (crm_repair_private.close_deals_on_unavailable_properties(false)->>'closed')::int <> 0 THEN
    RAISE EXCEPTION 'SQL77b: an eligible open card is still open on a sold/withdrawn property';
  END IF;
  IF EXISTS (SELECT 1 FROM public.deals WHERE merged_into_deal_id IS NULL AND stage NOT IN ('lost','closed','commission_collected')
              GROUP BY company_id, client_id, property_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'SQL77b: a client still has two open cards on one property';
  END IF;
  IF EXISTS (SELECT 1 FROM public.deals WHERE viewing_id IS NOT NULL AND merged_into_deal_id IS NULL
              AND stage NOT IN ('lost','closed','commission_collected') GROUP BY viewing_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'SQL77b: a visit still has two open cards';
  END IF;
  IF (SELECT to_jsonb(d) FROM public.deals d WHERE d.id = '722aa5fc-6789-48dd-a3b0-680fad279208')
     IS DISTINCT FROM (SELECT snapshot FROM c77b_counts WHERE k = 'buyer_722aa5fc') THEN
    RAISE EXCEPTION 'SQL77b: the buyer deal 722aa5fc changed';
  END IF;
  -- no property changed status or archive state, so the outreach trigger (sold/reserved/available) never ran
  IF (SELECT jsonb_object_agg(p.id::text, coalesce(p.status, '') || '|' || coalesce(p.archived, false)::text) FROM public.properties p)
     IS DISTINCT FROM (SELECT snapshot FROM c77b_counts WHERE k = 'property_states') THEN
    RAISE EXCEPTION 'SQL77b: a property status or archive state changed';
  END IF;
  IF to_regclass('net.http_request_queue') IS NOT NULL THEN
    SELECT n INTO v_base FROM c77b_counts WHERE k = 'net_max_id';
    EXECUTE 'SELECT count(*) FROM net.http_request_queue WHERE id > $1' INTO v USING coalesce(v_base, 0);
    IF v > 0 THEN
      RAISE EXCEPTION 'SQL77b: % HTTP request(s) were queued', v;
    END IF;
  END IF;
  RAISE NOTICE 'SQL77b done: 7 merges, % duplicate visits archived, % cards closed (result %)',
    (SELECT count(*) FROM c77b_dup_visits), (SELECT count(*) FROM c77b_close_plan),
    (SELECT r - 'items' FROM c77b_close_result);
END $$;
