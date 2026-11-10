-- SQL76b (10 Nov 2026, Ahmed's instruction 3): a reason for each of the 18 archived properties, from evidence only,
-- then the two archived-row rules (a reason is required, never «available»), added NOT VALID and validated at once.
-- Release order (10 Nov 2026), each file as its own migration: 76 -> 77 -> 77b -> 76b (then 77c, 78). 76 does not add
-- the two rules, so until this file runs the 18 rows, still without a reason, are written as before.
-- Why after 77b: the status change of the 14 below fires 77's trigger crm_close_deals_on_property_unavailable, so
-- their open pre-reservation cards close as «العقار أصبح غير متاح» (12bc5654, 9457b323 with its two negotiation cards,
-- 473b069f, b58f9074, dd95be18, 26c1d6fe). Run between 77 and 77b, that would close cards 77b checks and merges (on
-- 473b069f and b58f9074) and stop 77b; run before 77, the cards on the 11 not_available rows would stay open (77b's
-- one-off pass covers sold/withdrawn only). So the backfill refuses until 77b has run (a merged card exists), unless
-- the release sets crm.sql76b_without_sql77b = 'yes' (SET LOCAL) on purpose. This file itself never writes a deal.
-- The work is one DO block: if anything in it fails, nothing of it stays.
-- * The 14 archived rows that still say «available» leave it (withdrawn or not_available). None goes to «sold»: none
--   of them has evidence of a sale, and the outreach trigger queues nothing for withdrawn/not_available.
-- * The 4 other archived rows keep their status (status is not in their UPDATE, so no status trigger fires) and get
--   a reason.
-- * archived_at and archived_by are kept, archive_source is 'backfill'. One history row each: occurred_at is the
--   original archived_at, actor is archived_by, status_before/status_after is the change made here.
-- * Then the counts are checked and both archived-row constraints are added and validated; any mismatch aborts
--   everything. A row that changed since the 10 Nov audit (or a new archived row) stops it until a person decides.
-- Evidence: docs/operations-review-20260927.md:11 (test record) and :12 (duplicate of 473b069f);
-- docs/current-state.md:36 (Sultan 1 sold elsewhere) and :468 (9 Nov: Falah's Khawd villas and the Al-Shaer villa);
-- Ahmed's notes 8e763406 / 84b308ac («خلصت مدة العقد»), 7e74650b (Khawd 120 (2)) and 5f02bd2f (Al-Shaer 2, his
-- decision); the 10 Nov archive audit for the rows with no reason anywhere.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $backfill$
DECLARE
  v_done integer;
  v_moved integer := 0;
  v_reasoned integer := 0;
  v_bad text;
BEGIN
  IF to_regclass('public.property_archive_events') IS NULL
     OR to_regclass('public.property_archive_reasons') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.properties'::regclass AND conname = 'properties_archive_source_chk') THEN
    RAISE EXCEPTION 'SQL76b refused: apply 76-property-archive.forward.sql first';
  END IF;

  DROP TABLE IF EXISTS pg_temp.sql76b_map;
  CREATE TEMP TABLE sql76b_map (
    property_id uuid PRIMARY KEY,
    status_before text NOT NULL,
    status_after text NOT NULL,
    reason text NOT NULL,
    note text,
    evidence jsonb NOT NULL
  ) ON COMMIT DROP;
  INSERT INTO pg_temp.sql76b_map (property_id, status_before, status_after, reason, note, evidence) VALUES
    -- Archived and still «available» (14).
    ('dd95be18-651e-42fe-a105-837cafdac6fb', 'available', 'not_available', 'test_record', NULL,
     '{"doc": "docs/operations-review-20260927.md:11"}'),
    ('cde048c6-9b2b-4643-aa80-48a3dc19c902', 'available', 'not_available', 'duplicate', 'نسخة مكررة من 473b069f',
     '{"doc": "docs/operations-review-20260927.md:12", "duplicate_of": "473b069f-e984-4cd9-a883-6c854009dc7c"}'),
    ('12bc5654-0366-44e2-83a7-f181bdb01215', 'available', 'withdrawn', 'contract_expired',
     'أحمد 9 نوفمبر: خلصت مدة العقد (نهاية العقد المسجلة في الـ CRM 2026-11-20)',
     '{"owner_note_ids": ["8e763406-22aa-43e1-9863-4a124b974ba4", "84b308ac-262e-4e6c-bfad-0668fa566ac5", "7e74650b-bda5-44f2-976f-42ca0d2dd8fe"], "doc": "docs/current-state.md:468"}'),
    ('9457b323-1e4f-4a08-92e8-43e2e15ed5f1', 'available', 'withdrawn', 'contract_expired',
     'أحمد 9 نوفمبر: خلصت مدة العقد (ما في عقد مسجل في الـ CRM)',
     '{"owner_note_ids": ["8e763406-22aa-43e1-9863-4a124b974ba4", "84b308ac-262e-4e6c-bfad-0668fa566ac5"], "doc": "docs/current-state.md:468"}'),
    ('473b069f-e984-4cd9-a883-6c854009dc7c', 'available', 'withdrawn', 'contract_expired',
     'أحمد 9 نوفمبر: خلصت مدة العقد (ما في عقد مسجل في الـ CRM)',
     '{"owner_note_ids": ["8e763406-22aa-43e1-9863-4a124b974ba4", "84b308ac-262e-4e6c-bfad-0668fa566ac5"], "doc": "docs/current-state.md:468"}'),
    ('26c1d6fe-7e04-4110-be31-4fcd9d3c9b6a', 'available', 'not_available', 'unrecorded',
     'غير متاح بقرار أحمد 9 نوفمبر، مو مباع',
     '{"owner_note_ids": ["5f02bd2f-9573-488b-946c-d4cd50af2e1d"], "doc": "docs/current-state.md:468"}'),
    ('efecf711-b07a-4886-b54d-17e7d2e2740c', 'available', 'not_available', 'unrecorded', NULL, '{"audit": "2026-11-10: no reason recorded anywhere"}'),
    ('fe4447be-2d7d-40f8-8333-e0bcb961112a', 'available', 'not_available', 'unrecorded', NULL, '{"audit": "2026-11-10: no reason recorded anywhere"}'),
    ('a70d1b5c-2feb-4e96-9b31-92369fb84c6f', 'available', 'not_available', 'unrecorded', NULL, '{"audit": "2026-11-10: no reason recorded anywhere"}'),
    ('4762184c-f46d-48c5-acf8-03de06bbd97f', 'available', 'not_available', 'unrecorded', NULL, '{"audit": "2026-11-10: no reason recorded anywhere"}'),
    ('f25ee48b-046b-4f3d-8bb2-55d97af33dd8', 'available', 'not_available', 'unrecorded', NULL, '{"audit": "2026-11-10: no reason recorded anywhere"}'),
    ('5993b611-f808-41ae-9286-73c00a5b1c96', 'available', 'not_available', 'unrecorded', NULL, '{"audit": "2026-11-10: no reason recorded anywhere"}'),
    ('1b2aed39-e91a-4337-9c0e-336a7fc662e9', 'available', 'not_available', 'unrecorded', NULL, '{"audit": "2026-11-10: no reason recorded anywhere"}'),
    ('b58f9074-3fd4-47e8-b31f-9ed9d829e863', 'available', 'not_available', 'unrecorded', NULL, '{"audit": "2026-11-10: no reason recorded anywhere"}'),
    -- Archived with another status: the status stays (4).
    ('666b4302-3740-4c9e-bc65-b92d5b71fdd4', 'sold', 'sold', 'sold_by_owner', NULL, '{"doc": "docs/current-state.md:36"}'),
    ('f99087b9-03a1-4245-a3bf-4c21f327f77f', 'reserved', 'reserved', 'unrecorded', NULL, '{"audit": "2026-11-10: no reason recorded anywhere"}'),
    ('e1c81d62-cd1a-49fa-ada2-7bdc27408530', 'withdrawn', 'withdrawn', 'unrecorded', NULL, '{"audit": "2026-11-10: no reason recorded anywhere"}'),
    ('40b767af-4b96-42e0-9d4e-5322f99f2022', 'withdrawn', 'withdrawn', 'unrecorded', NULL, '{"audit": "2026-11-10: no reason recorded anywhere"}');

  SELECT count(*) FILTER (WHERE p.archive_reason IS NOT NULL) INTO v_done
    FROM pg_temp.sql76b_map m JOIN public.properties p ON p.id = m.property_id;
  IF v_done = 18 THEN
    RAISE NOTICE 'SQL76b: the 18 archived properties already have a reason, nothing to backfill';
  ELSIF v_done > 0 THEN
    RAISE EXCEPTION 'SQL76b refused: % of the 18 archived properties already have a reason, check them first', v_done;
  ELSE
    -- Release order (header): 77b has run once a merged card exists. to_jsonb, so this also reads before 77 added the column.
    IF coalesce(current_setting('crm.sql76b_without_sql77b', true), '') <> 'yes'
       AND NOT EXISTS (SELECT 1 FROM public.deals d WHERE (to_jsonb(d) ->> 'merged_into_deal_id') IS NOT NULL) THEN
      RAISE EXCEPTION 'SQL76b refused: release order is 76 -> 77 -> 77b -> 76b and 77b has not run (no merged card); apply 77 and 77b first, or SET LOCAL crm.sql76b_without_sql77b = ''yes'' to backfill without them on purpose';
    END IF;

    SELECT string_agg(m.property_id::text, ', ' ORDER BY m.property_id) INTO v_bad
      FROM pg_temp.sql76b_map m LEFT JOIN public.properties p ON p.id = m.property_id
     WHERE p.id IS NULL OR NOT coalesce(p.archived, false) OR p.status IS DISTINCT FROM m.status_before;
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'SQL76b refused: these rows changed since the 10 Nov audit, decide them first: %', v_bad;
    END IF;

    -- The 14: the status leaves «available» in the same UPDATE that records the reason.
    WITH moved AS (
      UPDATE public.properties p
         SET status = m.status_after, archive_reason = m.reason, archive_note = m.note, archive_source = 'backfill',
             archive_evidence = m.evidence, updated_at = now()
        FROM pg_temp.sql76b_map m
       WHERE p.id = m.property_id AND m.status_after IS DISTINCT FROM m.status_before
         AND p.archived AND p.archive_reason IS NULL AND p.status = m.status_before
      RETURNING p.id, p.company_id, p.archived_at, p.archived_by, m.reason, m.note, m.evidence, m.status_before, m.status_after)
    INSERT INTO public.property_archive_events (company_id, property_id, action, reason, note, source, status_before, status_after,
                                                evidence, actor, occurred_at)
    SELECT moved.company_id, moved.id, 'archive', moved.reason, moved.note, 'backfill', moved.status_before, moved.status_after,
           moved.evidence, moved.archived_by, coalesce(moved.archived_at, now())
      FROM moved;
    GET DIAGNOSTICS v_moved = ROW_COUNT;
    IF v_moved <> 14 THEN
      RAISE EXCEPTION 'SQL76b: expected 14 archived rows moved off available, got %', v_moved;
    END IF;

    -- The 4: reason only, status untouched.
    WITH reasoned AS (
      UPDATE public.properties p
         SET archive_reason = m.reason, archive_note = m.note, archive_source = 'backfill', archive_evidence = m.evidence,
             updated_at = now()
        FROM pg_temp.sql76b_map m
       WHERE p.id = m.property_id AND m.status_after IS NOT DISTINCT FROM m.status_before
         AND p.archived AND p.archive_reason IS NULL AND p.status = m.status_before
      RETURNING p.id, p.company_id, p.archived_at, p.archived_by, p.status, m.reason, m.note, m.evidence)
    INSERT INTO public.property_archive_events (company_id, property_id, action, reason, note, source, status_before, status_after,
                                                evidence, actor, occurred_at)
    SELECT reasoned.company_id, reasoned.id, 'archive', reasoned.reason, reasoned.note, 'backfill', reasoned.status, reasoned.status,
           reasoned.evidence, reasoned.archived_by, coalesce(reasoned.archived_at, now())
      FROM reasoned;
    GET DIAGNOSTICS v_reasoned = ROW_COUNT;
    IF v_reasoned <> 4 THEN
      RAISE EXCEPTION 'SQL76b: expected 4 archived rows given a reason with their status kept, got %', v_reasoned;
    END IF;

    IF (SELECT count(*) FROM public.properties p JOIN pg_temp.sql76b_map m ON m.property_id = p.id
         WHERE p.archived AND p.archive_reason = m.reason AND p.status = m.status_after AND p.archive_source = 'backfill') <> 18
       OR (SELECT count(*) FROM public.property_archive_events e JOIN pg_temp.sql76b_map m ON m.property_id = e.property_id
            WHERE e.source = 'backfill' AND e.action = 'archive') <> 18 THEN
      RAISE EXCEPTION 'SQL76b: the 18 archived properties or their history rows do not match the mapping';
    END IF;
  END IF;

  -- No archived row may stay without a reason or «available», whoever archived it.
  SELECT string_agg(p.id::text, ', ' ORDER BY p.id) INTO v_bad
    FROM public.properties p
   WHERE coalesce(p.archived, false) AND (p.archive_reason IS NULL OR p.status IS NOT DISTINCT FROM 'available');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'SQL76b: archived rows still without a reason or still available (not in the 10 Nov audit, decide them first): %', v_bad;
  END IF;

  -- The two archived-row rules exist from here on: added NOT VALID, then validated at once. 76 does not add them, so the
  -- 18 rows could be written until now; a second run finds them and only validates.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.properties'::regclass AND conname = 'properties_archived_has_reason_chk') THEN
    ALTER TABLE public.properties ADD CONSTRAINT properties_archived_has_reason_chk
      CHECK (NOT coalesce(archived, false) OR archive_reason IS NOT NULL) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.properties'::regclass AND conname = 'properties_archived_not_available_chk') THEN
    ALTER TABLE public.properties ADD CONSTRAINT properties_archived_not_available_chk
      CHECK (NOT coalesce(archived, false) OR status IS DISTINCT FROM 'available') NOT VALID;
  END IF;
  ALTER TABLE public.properties VALIDATE CONSTRAINT properties_archived_has_reason_chk;
  ALTER TABLE public.properties VALIDATE CONSTRAINT properties_archived_not_available_chk;
  IF (SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.properties'::regclass AND convalidated
        AND conname IN ('properties_archived_has_reason_chk', 'properties_archived_not_available_chk')) <> 2 THEN
    RAISE EXCEPTION 'SQL76b: the archived-row constraints are not validated';
  END IF;

  RAISE NOTICE 'SQL76b: % rows moved off available, % rows given a reason only, both constraints added and validated', v_moved, v_reasoned;
END
$backfill$;
