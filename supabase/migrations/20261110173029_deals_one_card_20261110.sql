-- SQL77 (10 Nov 2026, Ahmed's instructions 1 and 2): one client + one property = one deal card, and the cards on a
-- property that left the market close by themselves (the system closes them, not a person).
--  * deals.merged_into_deal_id / merged_at: a duplicate card merged into the card that stays. A merged card is lost
--    with no loss reason, hidden from crm_deals_access, and no trigger ever picks or reopens it
--    (crm_repair_private.merge_duplicate_deal, snapshots in crm_repair_private.deal_merge_audit).
--  * sync_viewing_to_crm finds the card of a visit in 3 steps: the card linked to this visit; the client's OPEN card on
--    this property whatever its request (the exact request first, then the oldest); a lost or completed card of the
--    exact request (the SQL15 rule). Step 2 replaces SQL15's per-request isolation (Ahmed 10 Nov: one client + one
--    property = ONE deal): a late, replaced or new request (crm_save_viewing_atomic creates one whenever the card's
--    request does not strictly match the visit) no longer inserts a second card. The card adopts the visit's request
--    only when its own is unknown or no longer active/paused; a card of another active or paused request keeps its
--    request and its agent, and the visit result still moves it. It never creates a card, and never reopens a lost one,
--    on a property that is sold/withdrawn or archived (contract B: «غير متاح حالياً» without archiving is still on the
--    list and its visits move the card as usual); an open card there closes as «العقار أصبح غير متاح». An edit that does
--    not change the visit result never reopens a lost card, a lost card is never reopened while the client has another
--    open card on that property, and a visit edit that keeps a card lost keeps its recorded reason, note and loss date
--    unless the visit gives new ones. The deal form (workflow context) keeps its old behaviour: the form's own save
--    decides the stage. 77c then makes «one open card per client+property» a unique rule.
--  * link_viewing_interest adopts the interest row saved before the request was known (same rule for property_inquiries).
--  * crm_close_deals_on_property_unavailable (properties): status becomes sold/withdrawn, the property is archived, or an
--    archived one becomes not_available -> its open pre-reservation cards close (reason property_unavailable, note
--    «تلقائي: ...», activities row actor_type system). Duplicate records are skipped. One owner notification per
--    property names the clients whose cards closed and those left open, and every card left open (booking, deposit, the
--    buyer's own card...) becomes an owner task in Ahmed's daily work (high priority, due today, linked to the card).
--  * crm_close_stale_visit_deals: reason looked up per company and active; merged cards skipped; a card that absorbed a
--    merged duplicate is as recent as that duplicate (the merge never makes a journey look older than it was).
--  * crm_repair_private.save_deal_workflow (the deal form) never picks a merged card for a visit (one condition added,
--    applied in place on the md5-checked live body).
-- Apply as its own migration. Rollback: 77-deals-one-card.rollback.sql (the replaced live bodies are saved there verbatim).
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

-- Refuse when a replaced object changed since the 10 Nov 2026 audit: the rollback file restores those exact bodies.
DO $$
DECLARE v_path text := current_setting('search_path'); v_def text;
BEGIN
  v_def := pg_get_functiondef('public.sync_viewing_to_crm()'::regprocedure);
  IF md5(v_def) <> '65058710025e84c947232e9193d20742' AND position('merged_into_deal_id' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SQL77 refused: public.sync_viewing_to_crm changed since 10 Nov 2026 (md5 %)', md5(v_def);
  END IF;
  v_def := pg_get_functiondef('crm_repair_private.link_viewing_interest()'::regprocedure);
  IF md5(v_def) <> '970a3c95b5cce287a32e906e141e2e85' AND position('SQL77' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SQL77 refused: crm_repair_private.link_viewing_interest changed since 10 Nov 2026 (md5 %)', md5(v_def);
  END IF;
  v_def := pg_get_functiondef('public.crm_close_stale_visit_deals(integer)'::regprocedure);
  IF md5(v_def) <> 'e6e7a9aa16b417267dfb54f54a101553' AND position('merged_into_deal_id' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SQL77 refused: public.crm_close_stale_visit_deals changed since 10 Nov 2026 (md5 %)', md5(v_def);
  END IF;
  -- 55bb1b16... = live body of 10 Nov 2026; 095a28bf... = the same body with the SQL77 condition (section 7).
  v_def := pg_get_functiondef('crm_repair_private.save_deal_workflow(jsonb,uuid)'::regprocedure);
  IF md5(v_def) NOT IN ('55bb1b1683b9d95f75302712b3e52406', '095a28bf2f8d6617a8b05e9a23bf99ac') THEN
    RAISE EXCEPTION 'SQL77 refused: crm_repair_private.save_deal_workflow changed since 10 Nov 2026 (md5 %)', md5(v_def);
  END IF;
  PERFORM set_config('search_path', 'public', true);
  v_def := pg_get_viewdef('public.crm_deals_access'::regclass, true);
  PERFORM set_config('search_path', v_path, true);
  IF md5(v_def) <> 'd477af648361686b9a0e02fcd2a10c19' AND position('merged_into_deal_id' IN v_def) = 0 THEN
    RAISE EXCEPTION 'SQL77 refused: public.crm_deals_access changed since 10 Nov 2026 (md5 %)', md5(v_def);
  END IF;
END $$;

-- 1. Merged duplicate cards -------------------------------------------------------------------------------------------
-- ON DELETE SET NULL: deleting the card that stayed (an owner decision) never fails because of a merged duplicate; that
-- duplicate then shows again as an ordinary lost card whose note says it was merged.
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS merged_into_deal_id uuid REFERENCES public.deals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS merged_at timestamptz;
COMMENT ON COLUMN public.deals.merged_into_deal_id IS 'SQL77: this card was a duplicate of the same client+property and was merged into that card. Merged cards are lost, hidden from crm_deals_access and never picked or reopened by a trigger.';
COMMENT ON COLUMN public.deals.merged_at IS 'SQL77: when the duplicate card was merged.';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.deals'::regclass AND conname = 'deals_merged_card_stays_lost') THEN
    ALTER TABLE public.deals ADD CONSTRAINT deals_merged_card_stays_lost
      CHECK (merged_into_deal_id IS NULL OR (stage = 'lost' AND merged_at IS NOT NULL AND merged_into_deal_id <> id));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS deals_merged_into_idx ON public.deals(merged_into_deal_id) WHERE merged_into_deal_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS crm_repair_private.deal_merge_audit(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  keep_deal_id uuid NOT NULL,
  drop_deal_id uuid NOT NULL,
  take_over boolean NOT NULL,
  reason text NOT NULL,
  keep_before jsonb NOT NULL,
  drop_before jsonb NOT NULL,
  keep_after jsonb,
  drop_after jsonb,
  repointed jsonb NOT NULL DEFAULT '{}'::jsonb,
  merged_by uuid,
  merged_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE crm_repair_private.deal_merge_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE crm_repair_private.deal_merge_audit FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE crm_repair_private.deal_merge_audit IS 'SQL77: full snapshots of both cards before and after every merge (restore from keep_before/drop_before).';

CREATE OR REPLACE FUNCTION crm_repair_private.merge_duplicate_deal(p_keep uuid, p_drop uuid, p_take_over boolean, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
-- SQL77: one client + one property = one card. The duplicate (p_drop) becomes lost with NO loss reason (it is not the
-- client's rejection), is marked merged into p_keep and disappears from crm_deals_access. With p_take_over the kept
-- card takes the duplicate's stage, visit and request; otherwise it keeps its own stage and visit and only adopts the
-- duplicate's request when its own request is unknown or no longer active (open kept cards only). An open kept card
-- with no agent or value takes the duplicate's; a lost or completed kept card is never re-attributed. Tasks, activities
-- and automation events move to the kept card; stage history, milestone events and save operations stay with the card
-- they describe. Both cards are locked; every condition is re-checked here. The caller checks the expected versions.
declare
  k public.deals%rowtype;
  d public.deals%rowtype;
  v_take_over boolean := coalesce(p_take_over, false);
  v_keep_open boolean;
  v_keep_request_status text;
  v_drop_request_status text;
  v_stage text;
  v_viewing uuid;
  v_request uuid;
  n_tasks integer := 0;
  n_activities integer := 0;
  n_events integer := 0;
  v_audit uuid;
begin
  if p_keep is null or p_drop is null or p_keep = p_drop then
    raise exception using errcode = '22023', message = 'merge_needs_two_different_cards';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception using errcode = '22023', message = 'merge_reason_required';
  end if;
  perform 1 from public.deals where id in (p_keep, p_drop) order by id for update;
  select * into k from public.deals where id = p_keep;
  if not found then raise exception using errcode = 'P0002', message = 'merge_keep_card_missing'; end if;
  select * into d from public.deals where id = p_drop;
  if not found then raise exception using errcode = 'P0002', message = 'merge_duplicate_card_missing'; end if;
  if k.company_id <> d.company_id or k.client_id is null or k.property_id is null
     or k.client_id is distinct from d.client_id or k.property_id is distinct from d.property_id then
    raise exception using errcode = '22023', message = 'merge_cards_not_same_client_property';
  end if;
  if k.merged_into_deal_id is not null or d.merged_into_deal_id is not null then
    raise exception using errcode = '22023', message = 'merge_card_already_merged';
  end if;
  if d.stage not in ('new','viewing_scheduled','viewing_no_show','viewing_cancelled','viewing_postponed','visit','negotiation') then
    raise exception using errcode = '22023', message = 'merge_duplicate_not_open_before_reservation';
  end if;
  if d.reservation_confirmed_at is not null or d.reservation_cancelled_at is not null
     or nullif(btrim(coalesce(d.reservation_evidence_note, '')), '') is not null or d.reservation_reference is not null
     or coalesce(d.deposit_amount, 0) <> 0 or d.expected_company_commission_at_reservation is not null
     or d.commission_entitled_at is not null or coalesce(d.company_commission_received_amount, 0) <> 0
     or d.commission_total is not null or d.company_commission is not null or d.agent_commission is not null
     or d.company_share is not null or d.agent_share is not null or d.broker_commission is not null
     or d.commission_received_at is not null or d.employee_commission_percent is not null
     or exists (select 1 from public.deposits x where x.deal_id = d.id)
     or exists (select 1 from crm_repair_private.deal_commission_receipts x where x.deal_id = d.id) then
    raise exception using errcode = '22023', message = 'merge_duplicate_has_money_or_booking';
  end if;
  if v_take_over and k.stage not in ('new','viewing_scheduled','viewing_no_show','viewing_cancelled','viewing_postponed','visit','negotiation') then
    raise exception using errcode = '22023', message = 'merge_take_over_needs_open_kept_card';
  end if;
  v_keep_open := k.stage not in ('lost','closed','commission_collected');

  select r.status into v_keep_request_status from public.client_requests r where r.id = k.request_id and r.company_id = k.company_id;
  select r.status into v_drop_request_status from public.client_requests r where r.id = d.request_id and r.company_id = d.company_id;
  if v_take_over then
    v_stage := d.stage;
    v_viewing := coalesce(d.viewing_id, k.viewing_id);
    v_request := coalesce(d.request_id, k.request_id);
  else
    v_stage := k.stage;
    v_viewing := coalesce(k.viewing_id, d.viewing_id);
    v_request := case
      when v_keep_open
       and (k.request_id is null or coalesce(v_keep_request_status, '') not in ('active','paused'))
       and d.request_id is not null and coalesce(v_drop_request_status, '') in ('active','paused')
      then d.request_id else k.request_id end;
  end if;

  -- 1. the duplicate first, so the kept card can take its visit without two open cards on one visit
  update public.deals set
    stage = 'lost', lost_from_stage = d.stage, lost_at = now(),
    merged_into_deal_id = k.id, merged_at = now(),
    notes = concat_ws(E'\n', nullif(btrim(notes), ''), '[دمج] بطاقة مكررة دُمجت في ' || k.id::text || '؛ مو رفض من العميل'),
    updated_at = now()
  where id = d.id;

  -- 2. the kept card (no write at all when nothing changes)
  if v_stage is distinct from k.stage or v_viewing is distinct from k.viewing_id or v_request is distinct from k.request_id
     or (v_keep_open and ((k.agent_id is null and d.agent_id is not null) or (k.deal_value is null and d.deal_value is not null))) then
    update public.deals set
      stage = v_stage, viewing_id = v_viewing, request_id = v_request,
      agent_id = case when v_keep_open then coalesce(agent_id, d.agent_id) else agent_id end,
      deal_value = case when v_keep_open then coalesce(deal_value, d.deal_value) else deal_value end,
      updated_at = now()
    where id = k.id;
  end if;

  -- 3. what belongs to the journey moves to the kept card
  update public.tasks set deal_id = k.id where deal_id = d.id;
  get diagnostics n_tasks = row_count;
  update public.activities set deal_id = k.id where deal_id = d.id;
  get diagnostics n_activities = row_count;
  update public.whatsapp_automation_events set deal_id = k.id where deal_id = d.id;
  get diagnostics n_events = row_count;

  -- 4. audit with full snapshots
  insert into crm_repair_private.deal_merge_audit(company_id, keep_deal_id, drop_deal_id, take_over, reason,
    keep_before, drop_before, keep_after, drop_after, repointed, merged_by)
  values (k.company_id, k.id, d.id, v_take_over, btrim(p_reason), to_jsonb(k), to_jsonb(d),
    (select to_jsonb(x) from public.deals x where x.id = k.id), (select to_jsonb(x) from public.deals x where x.id = d.id),
    jsonb_build_object('tasks', n_tasks, 'activities', n_activities, 'automation_events', n_events), auth.uid())
  returning id into v_audit;

  return jsonb_build_object('ok', true, 'audit_id', v_audit, 'keep', k.id, 'drop', d.id, 'take_over', v_take_over,
    'keep_stage', v_stage, 'keep_viewing', v_viewing, 'keep_request', v_request, 'drop_stage_before', d.stage,
    'repointed', jsonb_build_object('tasks', n_tasks, 'activities', n_activities, 'automation_events', n_events));
end
$function$;

-- 2. Closing the cards of a property that left the market --------------------------------------------------------------
CREATE OR REPLACE FUNCTION crm_repair_private.property_unavailable_note(p_status text, p_archived boolean, p_archive_reason text, p_sold_by_us boolean, p_sale_date date, p_event_date date)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  -- SQL77: the loss note of an automatic closure (starts with «تلقائي:»). Dates are Western digits; a date nobody
  -- recorded is left out rather than guessed.
  select 'تلقائي: ' || case
    when p_status = 'sold' and (coalesce(p_sold_by_us, false) or p_archive_reason = 'sold_by_us') then
      'العقار انباع عن طريقنا لعميل ثاني' || coalesce(' (تاريخ البيع ' || to_char(coalesce(p_sale_date, p_event_date), 'YYYY-MM-DD') || ')', '')
    when p_status = 'sold' then
      'العقار انباع عن طريق غيرنا' || coalesce(' (تسجّل مباع ' || to_char(p_event_date, 'YYYY-MM-DD') || ')', '')
    when p_archive_reason = 'contract_expired' then
      'انتهى عقد تسويق العقار وراح للأرشيف' || coalesce(' (' || to_char(p_event_date, 'YYYY-MM-DD') || ')', '')
    when p_status = 'withdrawn' or p_archive_reason = 'owner_withdrew' then
      'المالك سحب العقار من السوق' || coalesce(' (' || to_char(p_event_date, 'YYYY-MM-DD') || ')', '')
    when p_archive_reason = 'rented' then
      'العقار انأجر وما عاد متاح للبيع' || coalesce(' (' || to_char(p_event_date, 'YYYY-MM-DD') || ')', '')
    else
      'العقار ما عاد متاح' || coalesce(' (' || to_char(p_event_date, 'YYYY-MM-DD') || ')', '')
  end || '، فانقفلت الصفقة'
$function$;

CREATE OR REPLACE FUNCTION crm_repair_private.close_deal_property_unavailable(p_deal uuid, p_source text, p_event_date date DEFAULT NULL, p_apply boolean DEFAULT true)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
-- SQL77 (Ahmed 10 Nov 2026): a card on a property that left the market closes by itself. Returns 'closed'
-- ('would_close' when p_apply is false) or why it was left open. Only open pre-reservation cards close: never a card
-- with a booking, deposit or receipt, a historical entry, a merged card, the buyer's own card, or any card while
-- another card holds a live reservation and nothing was sold through us (closing would flip the property to reserved).
-- The system closes it, not a person: the caller's login is cleared for the write (deal_stage_history.changed_by is
-- NULL, branch-scoped rejection checks cannot fail the save that triggered it) and restored right after.
declare
  d public.deals%rowtype;
  v_status text;
  v_archived boolean;
  v_archive_reason text;
  v_buyer_id uuid;
  v_buyer_closed timestamptz;
  v_rid uuid;
  v_note text;
  v_out text;
  v_claims text := current_setting('request.jwt.claims', true);
  v_sub text := current_setting('request.jwt.claim.sub', true);
begin
  if p_apply then
    select * into d from public.deals where id = p_deal for update;
  else
    select * into d from public.deals where id = p_deal;
  end if;
  if not found then return 'missing'; end if;
  if d.merged_into_deal_id is not null then return 'merged'; end if;
  if d.stage not in ('new','viewing_scheduled','viewing_no_show','viewing_cancelled','viewing_postponed','visit','negotiation') then return 'stage'; end if;
  if d.entry_mode = 'historical' then return 'historical'; end if;
  if d.reservation_confirmed_at is not null or coalesce(d.deposit_amount, 0) <> 0 then return 'reservation'; end if;
  if exists (select 1 from public.deposits x where x.deal_id = d.id and coalesce(x.status, 'active') not in ('cancelled','refunded','forfeited')) then return 'deposit'; end if;
  select p.status, coalesce(p.archived, false), to_jsonb(p) ->> 'archive_reason'
    into v_status, v_archived, v_archive_reason
    from public.properties p where p.id = d.property_id and p.company_id = d.company_id;
  if not found then return 'no_property'; end if;
  -- contract B: sold or withdrawn, or archived (whatever its status); «غير متاح حالياً» alone is still on the list
  if not (coalesce(v_status in ('sold','withdrawn'), false) or v_archived) then return 'available'; end if;
  if coalesce(v_archive_reason, '') = 'duplicate' then return 'duplicate'; end if;
  -- A negotiation is an active deal (Ahmed 10 Nov: a property with a working deal is not archived on its own). Only a
  -- sale closes it automatically; when the property was withdrawn or archived it stays open and becomes his review task.
  if d.stage = 'negotiation' and coalesce(v_status, '') <> 'sold' then return 'active_negotiation'; end if;
  -- the buyer's own other cards are never closed by this rule (the owner gets them in the notification)
  if exists (select 1 from public.deals b
              where b.company_id = d.company_id and b.property_id = d.property_id and b.client_id = d.client_id
                and b.id <> d.id and b.merged_into_deal_id is null and b.stage in ('closed','commission_collected')) then
    return 'buyer';
  end if;
  select b.id, b.closed_at into v_buyer_id, v_buyer_closed
    from public.deals b
   where b.company_id = d.company_id and b.property_id = d.property_id and b.merged_into_deal_id is null
     and b.stage in ('closed','commission_collected')
   order by b.closed_at desc nulls last, b.updated_at desc nulls last
   limit 1;
  if v_buyer_id is null and exists (select 1 from public.deals x where x.company_id = d.company_id and x.property_id = d.property_id
       and x.merged_into_deal_id is null
       and x.stage in ('deposit','awaiting_finance','finance_approved','awaiting_clearance','ownership_transfer')) then
    return 'reservation_on_property';
  end if;
  select r.id into v_rid from public.rejection_reasons r
   where r.company_id = d.company_id and r.code = 'property_unavailable' and r.is_active is true
   limit 1;
  if v_rid is null then return 'no_reason'; end if;
  if not p_apply then return 'would_close'; end if;

  v_note := crm_repair_private.property_unavailable_note(v_status, v_archived, v_archive_reason, v_buyer_id is not null,
              (v_buyer_closed at time zone 'Asia/Muscat')::date, p_event_date);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    update public.deals set
      stage = 'lost', lost_from_stage = d.stage, lost_at = now(),
      lost_reason_id = v_rid, lost_reason_note = v_note, updated_at = now()
    where id = d.id and stage = d.stage and merged_into_deal_id is null;
    if not found then
      v_out := 'changed';
    else
      insert into public.activities(company_id, user_id, client_id, deal_id, property_id, request_id, type, activity_type,
        channel, direction, actor_type, description, occurred_at, before_data, after_data)
      values (d.company_id, null, d.client_id, d.id, d.property_id, d.request_id, 'system', 'system',
        'system', 'internal', 'system', '[تلقائي] ' || v_note, now(),
        jsonb_build_object('stage', d.stage),
        jsonb_build_object('stage', 'lost', 'reason', 'property_unavailable', 'property_status', v_status,
          'archived', v_archived, 'archive_reason', v_archive_reason, 'buyer_deal_id', v_buyer_id, 'source', p_source));
      v_out := 'closed';
    end if;
  exception when others then
    v_out := 'error:' || sqlstate;
    raise warning 'SQL77 close_deal_property_unavailable % left open: % %', d.id, sqlstate, sqlerrm;
  end;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  return v_out;
end
$function$;

CREATE OR REPLACE FUNCTION crm_repair_private.close_deals_for_property(p_property uuid, p_source text, p_event_date date, p_apply boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
-- SQL77: every open card of one property goes through close_deal_property_unavailable (each in its own
-- sub-transaction, so the property save never fails). Then Ahmed is told where he looks: one owner notification per
-- property names the clients whose cards closed and those whose cards were left open (owner-only, so names are fine),
-- and every card left open is an owner task in his daily work (crm_dashboard_work lists open tasks, high priority and
-- due today first): high priority, due today, linked to the card, its client and request (branch and investment privacy
-- follow the card), never a second one while the first is still open.
declare
  p record;
  r record;
  x jsonb;
  v_owner uuid;
  v_res text;
  v_why text;
  v_closed jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
  v_review jsonb := '[]'::jsonb;
  v_closed_names text[] := '{}';
  v_lines text[] := '{}';
  v_state text;
  v_label text;
  v_body text;
  v_tasks integer := 0;
  v_today date := (now() at time zone 'Asia/Muscat')::date;
  v_claims text := current_setting('request.jwt.claims', true);
  v_sub text := current_setting('request.jwt.claim.sub', true);
begin
  select pr.id, pr.company_id, pr.title, pr.status, coalesce(pr.archived, false) as archived,
         to_jsonb(pr) ->> 'archive_reason' as archive_reason
    into p from public.properties pr where pr.id = p_property;
  if not found then return jsonb_build_object('property_id', p_property, 'missing', true); end if;
  for r in
    select d.id, d.stage, d.client_id, d.request_id, coalesce(nullif(btrim(c.name), ''), 'عميل') as client_name
      from public.deals d
      left join public.clients c on c.id = d.client_id and c.company_id = d.company_id
     where d.company_id = p.company_id and d.property_id = p.id and d.merged_into_deal_id is null
       and d.stage not in ('lost','closed','commission_collected')
     order by d.created_at, d.id
  loop
    v_res := crm_repair_private.close_deal_property_unavailable(r.id, p_source, p_event_date, p_apply);
    if v_res in ('closed','would_close') then
      v_closed := v_closed || jsonb_build_array(jsonb_build_object('deal_id', r.id, 'stage', r.stage));
      v_closed_names := v_closed_names || r.client_name;
    else
      v_why := case
        when v_res = 'reservation' then 'عليها حجز مدفوع'
        when v_res = 'deposit' then 'عليها عربون'
        when v_res = 'historical' then 'صفقة تاريخية'
        when v_res = 'buyer' then 'بطاقة المشتري نفسه'
        when v_res = 'reservation_on_property' then 'على العقار حجز قائم'
        when v_res = 'active_negotiation' then 'في تفاوض والعقار انسحب أو انأرشف بدون بيع'
        when v_res = 'stage' then 'في مرحلة الحجز أو التمويل'
        when v_res = 'no_reason' then 'سبب «العقار أصبح غير متاح» موقوف'
        when v_res = 'changed' then 'تغيرت أثناء الإغلاق'
        when v_res like 'error:%' then 'تعذر الإغلاق ' || substr(v_res, 7)
        else v_res end;
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('deal_id', r.id, 'stage', r.stage, 'why', v_res));
      v_review := v_review || jsonb_build_array(jsonb_build_object('deal_id', r.id, 'client_id', r.client_id,
        'request_id', r.request_id, 'client_name', r.client_name, 'why', v_why));
      v_lines := v_lines || (r.client_name || ' (' || v_why || ')');
    end if;
  end loop;

  if p_apply and (jsonb_array_length(v_closed) > 0 or jsonb_array_length(v_skipped) > 0) then
    v_state := case when p.status = 'sold' then 'انباع'
                    when p.status = 'withdrawn' then 'انسحب من السوق'
                    when p.archived then 'انتقل للأرشيف'
                    else 'ما عاد متاح' end;
    v_label := coalesce(nullif(btrim(p.title), ''), 'عقار');
    v_body := v_label || ' — ' || v_state
      || case when jsonb_array_length(v_closed) > 0
              then '. انقفلت تلقائياً ' || jsonb_array_length(v_closed) || ' (السبب: العقار أصبح غير متاح): '
                   || array_to_string(v_closed_names, '، ')
              else '. ما انقفلت أي صفقة تلقائياً' end
      || case when jsonb_array_length(v_skipped) > 0
              then '. ما انقفلت ' || jsonb_array_length(v_skipped) || ' وتحتاج مراجعتك (انضافت لمهامك اليوم): '
                   || array_to_string(v_lines, '، ')
              else '' end;
    perform set_config('request.jwt.claims', '', true);
    perform set_config('request.jwt.claim.sub', '', true);
    begin
      v_owner := crm_repair_private.investment_owner(p.company_id);
      if v_owner is not null then
        insert into public.notifications(user_id, type, is_read, link, title, body)
        values (v_owner, 'deal_auto_closed', false, 'deals', 'انقفلت صفقات عقار ما عاد متاح', left(v_body, 1500));
      end if;
    exception when others then
      raise warning 'SQL77 owner notification for property % failed: %', p.id, sqlerrm;
    end;
    -- every card left open is Ahmed's decision: one task in his daily work, not a second one while the first is open
    if v_owner is not null then
      for x in select e.value from jsonb_array_elements(v_review) e loop
        begin
          if not exists (select 1 from public.tasks t
                          where t.company_id = p.company_id and t.deal_id = (x ->> 'deal_id')::uuid
                            and not coalesce(t.done, false) and t.title like 'راجع صفقة %') then
            insert into public.tasks(company_id, user_id, client_id, deal_id, request_id, title, notes, due_date, priority, done)
            values (p.company_id, v_owner, (x ->> 'client_id')::uuid, (x ->> 'deal_id')::uuid, (x ->> 'request_id')::uuid,
              left('راجع صفقة ' || (x ->> 'client_name') || ': ' || v_label || ' ' || v_state
                   || ' والبطاقة ما انقفلت تلقائياً (' || (x ->> 'why') || ')', 200),
              left('تلقائي ' || to_char(v_today, 'YYYY-MM-DD') || ': العقار ' || v_state
                   || ' فانقفلت صفقاته المفتوحة قبل الحجز، وهذي البطاقة بقيت مفتوحة لأن ' || (x ->> 'why')
                   || '. القرار لك: تكملها أو تقفلها بسببها.', 1000),
              v_today, 'high', false);
            v_tasks := v_tasks + 1;
          end if;
        exception when others then
          raise warning 'SQL77 review task for deal % failed: %', x ->> 'deal_id', sqlerrm;
        end;
      end loop;
    end if;
    perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  end if;

  return jsonb_build_object('property_id', p.id, 'status', p.status, 'archived', p.archived,
    'archive_reason', p.archive_reason, 'closed', v_closed, 'skipped', v_skipped, 'review_tasks', v_tasks);
end
$function$;

CREATE OR REPLACE FUNCTION crm_repair_private.close_deals_on_property_unavailable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
-- SQL77: AFTER UPDATE OF status, archived ON properties (see the trigger's WHEN). A record archived as a duplicate
-- («سجل مكرر») keeps its cards: they belong to the real listing. Nothing here may fail the property save.
begin
  if coalesce(to_jsonb(new) ->> 'archive_reason', '') = 'duplicate' then return null; end if;
  begin
    perform crm_repair_private.close_deals_for_property(new.id, 'property_change', (now() at time zone 'Asia/Muscat')::date, true);
  exception when others then
    raise warning 'SQL77 close_deals_on_property_unavailable % failed: %', new.id, sqlerrm;
  end;
  return null;
end
$function$;

CREATE OR REPLACE FUNCTION crm_repair_private.close_deals_on_unavailable_properties(p_apply boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
-- SQL77 one-off helper: the same rule for every property that is sold or withdrawn now. p_apply=false is a dry run
-- (nothing written, nothing locked beyond reads).
declare
  p record;
  v_one jsonb;
  v_items jsonb := '[]'::jsonb;
  v_closed integer := 0;
  v_skipped integer := 0;
  v_tasks integer := 0;
begin
  for p in
    select pr.id from public.properties pr
     where pr.status in ('sold','withdrawn')
       and coalesce(to_jsonb(pr) ->> 'archive_reason', '') <> 'duplicate'
       and exists (select 1 from public.deals d where d.property_id = pr.id and d.company_id = pr.company_id
                     and d.merged_into_deal_id is null and d.stage not in ('lost','closed','commission_collected'))
     order by pr.id
  loop
    v_one := crm_repair_private.close_deals_for_property(p.id, 'backfill_20261110', null, coalesce(p_apply, false));
    v_closed := v_closed + jsonb_array_length(v_one -> 'closed');
    v_skipped := v_skipped + jsonb_array_length(v_one -> 'skipped');
    v_tasks := v_tasks + coalesce((v_one ->> 'review_tasks')::integer, 0);
    v_items := v_items || jsonb_build_array(v_one);
  end loop;
  return jsonb_build_object('apply', coalesce(p_apply, false), 'properties', jsonb_array_length(v_items),
    'closed', v_closed, 'skipped', v_skipped, 'review_tasks', v_tasks, 'items', v_items);
end
$function$;

-- 3. The visit -> card trigger (live body of 10 Nov 2026 with the SQL77 changes marked) ------------------------------
CREATE OR REPLACE FUNCTION public.sync_viewing_to_crm()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_request_id uuid;
  v_inquiry_id uuid;
  v_deal_id uuid;
  v_current_stage text;
  v_target_stage text;
  v_price numeric;
  v_reason_code text;
  v_reason_id uuid;
  v_inquiry_status text;
  v_final boolean;
  v_candidate_count integer;
  v_workflow_context boolean:=false;
  -- SQL77
  v_adopt_request boolean:=false;
  v_other_journey boolean:=false;
  v_prop_status text;
  v_prop_archived boolean:=false;
  v_prop_archive_reason text;
  v_unavailable boolean:=false;
  v_result_changed boolean:=true;
  v_closed_now boolean:=false;
begin
  if coalesce(new.archived,false)=true or new.client_id is null or new.property_id is null then return new; end if;

  v_request_id:=new.request_id;
  if v_request_id is null then
    select count(distinct pi.request_id), min(pi.request_id::text)::uuid into v_candidate_count,v_request_id
    from public.property_inquiries pi
    where pi.company_id=new.company_id and pi.client_id=new.client_id
      and pi.property_id=new.property_id and pi.request_id is not null
      AND EXISTS(SELECT 1 FROM public.client_requests rr JOIN public.clients cc ON cc.id=new.client_id AND cc.company_id=new.company_id WHERE rr.id=pi.request_id AND rr.company_id=new.company_id AND (coalesce(rr.route_key,'')='investment' OR coalesce(rr.branch_key,'')='investment')=coalesce(cc.lead_route='investment',false));
    if v_candidate_count>1 then
      raise exception using errcode='22023',message='viewing_request_ambiguous';
    end if;
  end if;
  if v_request_id is null then
    select count(*),min(cr.id::text)::uuid into v_candidate_count,v_request_id
    from public.client_requests cr
    where cr.company_id=new.company_id and cr.client_id=new.client_id and cr.status='active'
      AND (coalesce(cr.route_key,'')='investment' OR coalesce(cr.branch_key,'')='investment')=EXISTS(SELECT 1 FROM public.clients cc WHERE cc.id=new.client_id AND cc.company_id=new.company_id AND cc.lead_route='investment');
    if v_candidate_count>1 then
      raise exception using errcode='22023',message='viewing_request_ambiguous';
    end if;
  end if;
  if new.request_id is null and v_request_id is not null then
    update public.viewings set request_id=v_request_id where id=new.id and request_id is null;
  end if;

  if new.status='done' then
    if new.pipeline_outcome='lost' or (new.pipeline_outcome is null and new.client_feedback='disliked') then
      v_target_stage:='lost'; v_inquiry_status:='not_suitable';
    elsif new.pipeline_outcome='negotiation' or (new.pipeline_outcome is null and new.client_feedback='wants_negotiate') then
      v_target_stage:='negotiation'; v_inquiry_status:='negotiation';
    else
      v_target_stage:='visit'; v_inquiry_status:='viewed';
    end if;
  elsif new.status='postponed' then
    v_target_stage:='viewing_postponed'; v_inquiry_status:='followup';
  elsif new.status='no_show' then
    v_target_stage:='viewing_no_show'; v_inquiry_status:='followup';
  elsif new.status='cancelled' then
    v_target_stage:='viewing_cancelled'; v_inquiry_status:='followup';
  else
    v_target_stage:='viewing_scheduled'; v_inquiry_status:='viewing_scheduled';
  end if;

  -- SQL77: an interest saved before the request was known (request_id NULL) is the same journey. The exact request
  -- row always wins; the NULL row adopts the request only when no row for it exists, so both unique indexes hold.
  select pi.id into v_inquiry_id
  from public.property_inquiries pi
  where pi.company_id=new.company_id and pi.client_id=new.client_id and pi.property_id=new.property_id
    and (pi.request_id IS NOT DISTINCT FROM v_request_id or (v_request_id is not null and pi.request_id is null))
  order by case when pi.request_id IS NOT DISTINCT FROM v_request_id then 0 else 1 end,pi.updated_at desc nulls last,pi.created_at desc
  limit 1;

  if v_inquiry_id is null and new.status<>'cancelled' then
    insert into public.property_inquiries(
      company_id,client_id,property_id,assigned_to,source,source_detail,status,
      first_inquiry_at,last_inquiry_at,inquiry_count,created_by,request_id,
      shown_by_agent,match_status,viewing_booked,viewing_completed,post_visit_interest,outcome,
      rejection_reason,rejection_notes,last_contact_at,followup_note,next_followup,has_inbound_inquiry
    ) values (
      new.company_id,new.client_id,new.property_id,new.agent_id,'other','زيارة/معاينة مسجلة في CRM',v_inquiry_status,
      coalesce(new.created_at,now()),now(),1,new.created_by,v_request_id,
      true,'matched',true,(new.status='done'),new.client_feedback,
      case when v_target_stage='lost' then 'rejected' when v_target_stage='negotiation' then 'interested' else null end,
      new.rejection_reason,nullif(btrim(new.outcome_note),''),now(),new.next_step,new.followup_date,false
    ) returning id into v_inquiry_id;
  elsif v_inquiry_id is not null then
    update public.property_inquiries set
      status=v_inquiry_status,
      assigned_to=coalesce(new.agent_id,assigned_to),
      request_id=case when v_workflow_context then v_request_id else coalesce(request_id,v_request_id) end,
      shown_by_agent=true,
      match_status='matched',
      viewing_booked=true,
      viewing_completed=exists(select 1 from public.viewings vx where vx.company_id=new.company_id and vx.client_id=new.client_id and vx.property_id=new.property_id and vx.archived=false and vx.status='done' and vx.request_id IS NOT DISTINCT FROM v_request_id),
      post_visit_interest=new.client_feedback,
      outcome=case when v_target_stage='lost' then 'rejected' when v_target_stage='negotiation' then 'interested' else outcome end,
      rejection_reason=case when v_target_stage='lost' then new.rejection_reason else rejection_reason end,
      rejection_notes=case when v_target_stage='lost' then nullif(btrim(new.outcome_note),'') else rejection_notes end,
      last_contact_at=now(),
      followup_note=coalesce(new.next_step,followup_note),
      next_followup=coalesce(new.followup_date,next_followup),
      updated_at=now()
    where id=v_inquiry_id;
  end if;

  v_reason_code:=case coalesce(new.rejection_reason,'')
    when 'price' then 'price_value_mismatch'
    when 'location' then 'location'
    when 'area' then 'built_size'
    when 'room_layout' then 'layout'
    when 'design' then 'layout'
    when 'finishing' then 'finishing'
    when 'parking' then 'yard_parking'
    when 'financing' then 'finance_not_ready'
    when 'found_other' then 'chose_other_property'
    when 'no_response' then 'no_response_after_visit'
    when 'not_serious' then 'client_not_ready'
    when 'not_interested' then 'not_interested'
    when 'other' then 'no_clear_reason'
    when 'no_clear_reason' then 'no_clear_reason'
    else null end;
  select id into v_reason_id from public.rejection_reasons where code=v_reason_code and company_id=new.company_id and is_active=true;

  if v_target_stage='lost' and v_reason_id is not null then
    perform crm_repair_private.set_primary_rejection(
      new.company_id,new.client_id,new.property_id,v_request_id,v_inquiry_id,
      v_reason_id,new.outcome_note,'post_visit',new.created_by);
  end if;

  -- Only the already-authorized atomic deal save can populate this private transaction context.
  -- It preserves an existing card's identity while a new real visit resolves its previously missing request.
  select d.id,d.stage into v_deal_id,v_current_stage
  from crm_repair_private.deal_workflow_context ctx
  join public.deals d on d.id=ctx.deal_id and d.company_id=ctx.company_id
   and d.client_id=ctx.client_id and d.property_id=ctx.property_id and d.merged_into_deal_id is null
  where ctx.transaction_id=txid_current() and ctx.user_id=auth.uid()
   and ctx.company_id=new.company_id and ctx.client_id=new.client_id and ctx.property_id=new.property_id;
  v_workflow_context:=v_deal_id is not null;
  if not v_workflow_context then
    -- SQL77 step 1: one visit = one card. The card already linked to this visit (open first, then the oldest).
    select d.id,d.stage into v_deal_id,v_current_stage
    from public.deals d
    where d.company_id=new.company_id and d.client_id=new.client_id and d.property_id=new.property_id
      and d.viewing_id=new.id and d.merged_into_deal_id is null
    order by case when d.stage in ('closed','commission_collected') then 2 when d.stage='lost' then 1 else 0 end,
             d.created_at,d.id
    limit 1;
    -- SQL77 step 2 (Ahmed 10 Nov 2026: one client + one property = ONE deal; this replaces SQL15's per-request
    -- isolation): the client's open card on this property, whatever its request (the exact request first, then the
    -- oldest). A late, replaced or newly created request never inserts a second card.
    if v_deal_id is null then
      select d.id,d.stage into v_deal_id,v_current_stage
      from public.deals d
      where d.company_id=new.company_id and d.client_id=new.client_id and d.property_id=new.property_id
        and d.merged_into_deal_id is null
        and d.stage not in ('lost','closed','commission_collected')
      order by case when d.request_id IS NOT DISTINCT FROM v_request_id then 0 else 1 end,d.created_at,d.id
      limit 1;
    end if;
    -- step 3 (SQL15 rule): a lost or completed card of the exact request journey (a lost one reopens below only when
    -- allowed). Open cards were all taken by step 2.
    if v_deal_id is null then
      select d.id,d.stage into v_deal_id,v_current_stage
      from public.deals d
      where d.company_id=new.company_id and d.client_id=new.client_id and d.property_id=new.property_id
        and d.request_id IS NOT DISTINCT FROM v_request_id and d.merged_into_deal_id is null
      order by case when d.stage in ('closed','commission_collected') then 2 when d.stage='lost' then 1 else 0 end,
               d.updated_at desc nulls last,d.created_at desc
      limit 1;
    end if;
    -- SQL77: whichever step found it, an open card adopts the visit's request only when its own is unknown or no longer
    -- active/paused; a card of another active or paused request keeps its request and its agent (the visit result
    -- still moves it), on this visit and on every later edit of it.
    if v_deal_id is not null then
      select v_current_stage not in ('lost','closed','commission_collected') and v_request_id is not null
               and d.request_id is distinct from v_request_id
               and (d.request_id is null or r.id is null or r.status not in ('active','paused')),
             d.request_id is distinct from v_request_id and r.status in ('active','paused')
        into v_adopt_request,v_other_journey
      from public.deals d
      left join public.client_requests r on r.id=d.request_id and r.company_id=d.company_id
      where d.id=v_deal_id;
      v_adopt_request:=coalesce(v_adopt_request,false);
      v_other_journey:=coalesce(v_other_journey,false);
    end if;
  end if;

  -- SQL77 (contract B): a property that is sold or withdrawn, or archived, gets no new card and its lost cards stay lost.
  -- «غير متاح حالياً» (not_available) without archiving is still on the list: its visits move the card as usual.
  select p.price,p.status,coalesce(p.archived,false),case when p.archived then to_jsonb(p)->>'archive_reason' end
    into v_price,v_prop_status,v_prop_archived,v_prop_archive_reason
  from public.properties p where p.id=new.property_id;
  v_unavailable:=coalesce(v_prop_status in ('sold','withdrawn'),false) or coalesce(v_prop_archived,false);
  -- SQL77: only a new visit or a changed result may reopen a lost card; a note or follow-up edit never does.
  if tg_op='UPDATE' then
    v_result_changed:=old.status is distinct from new.status
      or old.client_feedback is distinct from new.client_feedback
      or old.pipeline_outcome is distinct from new.pipeline_outcome
      or old.rejection_reason is distinct from new.rejection_reason
      or old.archived is distinct from new.archived;
  end if;

  if v_deal_id is null then
    if not v_unavailable then
    insert into public.deals(
      company_id,client_id,property_id,agent_id,stage,deal_value,notes,request_id,viewing_id,
      lost_reason_id,lost_reason_note,lost_from_stage,lost_at
    ) values (
      new.company_id,new.client_id,new.property_id,new.agent_id,v_target_stage,v_price,
      'بطاقة Pipeline مرتبطة بزيارة CRM',v_request_id,new.id,
      case when v_target_stage='lost' then v_reason_id end,
      case when v_target_stage='lost' then nullif(btrim(new.outcome_note),'') end,
      case when v_target_stage='lost' then 'visit' end,
      case when v_target_stage='lost' then now() end
    );
    end if;
  else
    v_final:=v_current_stage in ('closed','commission_collected');
    if not v_final then
      if v_target_stage='lost' then
        -- SQL77: a card that is already lost keeps its recorded reason, note and loss dates unless the visit gives new ones;
        -- a card of another active journey keeps its agent.
        update public.deals set
          stage='lost',viewing_id=new.id,request_id=case when v_workflow_context or v_adopt_request then v_request_id else coalesce(request_id,v_request_id) end,agent_id=case when v_other_journey then coalesce(agent_id,new.agent_id) else coalesce(new.agent_id,agent_id) end,
          lost_reason_id=case when v_current_stage='lost' and v_reason_id is null then lost_reason_id else v_reason_id end,
          lost_reason_note=case when v_current_stage='lost' and nullif(btrim(new.outcome_note),'') is null then lost_reason_note else nullif(btrim(new.outcome_note),'') end,
          lost_from_stage=case when v_current_stage='lost' then coalesce(lost_from_stage,'visit') else v_current_stage end,
          lost_at=case when v_current_stage='lost' then coalesce(lost_at,now()) else now() end,
          closed_at=case when v_current_stage='lost' then coalesce(closed_at,now()) else now() end,
          updated_at=now()
        where id=v_deal_id;
      elsif v_current_stage='lost' then
        -- SQL77: never on a property off the market, never on a note/follow-up edit, never while the client has
        -- another open card on this property (one client + one property = one card). The deal form decides itself.
        if v_workflow_context or (not v_unavailable and v_result_changed and not exists(
             select 1 from public.deals o
             where o.company_id=new.company_id and o.client_id=new.client_id and o.property_id=new.property_id
               and o.id<>v_deal_id and o.merged_into_deal_id is null
               and o.stage not in ('lost','closed','commission_collected'))) then
        update public.deals set
          stage=v_target_stage,viewing_id=new.id,request_id=case when v_workflow_context or v_adopt_request then v_request_id else coalesce(request_id,v_request_id) end,agent_id=case when v_other_journey then coalesce(agent_id,new.agent_id) else coalesce(new.agent_id,agent_id) end,
          lost_reason_id=null,lost_reason_note=null,lost_from_stage=null,lost_at=null,closed_at=null,updated_at=now()
        where id=v_deal_id;
        end if;
      else
        -- SQL77: the property left the market: an eligible open card closes as «العقار أصبح غير متاح» instead
        -- (not inside the deal form's own save, which sets the stage itself right after this trigger).
        if v_unavailable and not v_workflow_context and coalesce(v_prop_archive_reason,'')<>'duplicate' then
          v_closed_now:=crm_repair_private.close_deal_property_unavailable(v_deal_id,'visit_update',null,true)='closed';
        end if;
        if not v_closed_now then
        update public.deals set
          stage=case
            when v_target_stage='negotiation' then 'negotiation'
            when v_target_stage='visit' and v_current_stage in ('new','viewing_scheduled','viewing_no_show','viewing_cancelled','viewing_postponed','visit') then 'visit'
            when v_target_stage='viewing_postponed' and v_current_stage in ('new','viewing_scheduled','viewing_no_show','viewing_cancelled','viewing_postponed') then 'viewing_postponed'
            when v_target_stage='viewing_no_show' and v_current_stage in ('new','viewing_scheduled','viewing_no_show','viewing_cancelled','viewing_postponed') then 'viewing_no_show'
            when v_target_stage='viewing_cancelled' and v_current_stage in ('new','viewing_scheduled','viewing_no_show','viewing_cancelled','viewing_postponed') then 'viewing_cancelled'
            when v_target_stage='viewing_scheduled' and v_current_stage in ('new','viewing_scheduled','viewing_no_show','viewing_cancelled','viewing_postponed') then 'viewing_scheduled'
            else v_current_stage end,
          viewing_id=new.id,
          request_id=case when v_workflow_context or v_adopt_request then v_request_id else coalesce(request_id,v_request_id) end,
          agent_id=case when v_other_journey then coalesce(agent_id,new.agent_id) else coalesce(new.agent_id,agent_id) end,
          updated_at=now()
        where id=v_deal_id;
        end if;
      end if;
    end if;
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION crm_repair_private.link_viewing_interest()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_inquiry uuid; v_time timestamptz; v_branch text;
begin
 if new.archived is true or new.status='cancelled' then return new; end if;
 select p.branch_key into v_branch from public.properties p
  where p.id=new.property_id and p.company_id=new.company_id;
 if v_branch is null then return new; end if;
 if auth.uid() is not null and not crm_repair_private.staff_can_access_branch(new.company_id,v_branch) then
  raise exception using errcode='42501',message='viewing_property_branch_not_allowed';
 end if;
 v_time:=coalesce(new.created_at,now());
 -- SQL77: an interest saved before the request was known (request_id NULL) is the same journey. The exact request
 -- row always wins; the NULL row adopts the request only when no row for it exists, so both unique indexes hold.
 select id into v_inquiry from public.property_inquiries
  where company_id=new.company_id and client_id=new.client_id and property_id=new.property_id
    and (request_id IS NOT DISTINCT FROM new.request_id or (new.request_id is not null and request_id is null))
  order by case when request_id IS NOT DISTINCT FROM new.request_id then 0 else 1 end,created_at limit 1 for update;
 if v_inquiry is null then
  insert into public.property_inquiries(company_id,client_id,property_id,request_id,assigned_to,
   source,source_detail,status,first_inquiry_at,last_inquiry_at,inquiry_count,created_by,
   has_inbound_inquiry,viewing_booked,viewing_completed,match_status)
  values(new.company_id,new.client_id,new.property_id,new.request_id,new.agent_id,
   'other','زيارة مسجلة في CRM','viewing_scheduled',v_time,v_time,1,
   coalesce(new.created_by,new.agent_id),false,true,new.status='done','matched')
  on conflict do nothing;
 else
  update public.property_inquiries set viewing_booked=true,
   viewing_completed=(viewing_completed or new.status='done'),
   status=case when status in ('inquiry','followup','viewing_scheduled') and new.status='done' then 'viewed'
    when status in ('inquiry','followup') then 'viewing_scheduled' else status end,
   request_id=coalesce(request_id,new.request_id),
   updated_at=now()
  where id=v_inquiry;
 end if;
 return new;
end $function$;

-- 4. The 90-day job: reason of the deal's own company and active; merged cards are never touched ------------------------
CREATE OR REPLACE FUNCTION public.crm_close_stale_visit_deals(p_days integer DEFAULT 90)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n int := 0;
begin
  -- SQL77: the reason is looked up per deal company and must be active (no reason, no closing); merged duplicate
  -- cards are skipped; a card that absorbed a merged duplicate is as recent as the newest card merged into it.
  with stale as (
    select d.id, d.stage, rr.id as rid from public.deals d
      join public.rejection_reasons rr on rr.company_id = d.company_id and rr.code = 'no_response_after_visit' and rr.is_active is true
      left join public.viewings v on v.id = d.viewing_id
     where d.stage in ('viewing_scheduled','visit','viewing_postponed','viewing_cancelled','viewing_no_show')
       and d.merged_into_deal_id is null
       and greatest(
             coalesce(v.viewing_date, d.created_at::date),
             d.created_at::date,
             coalesce((select max(md.created_at)::date from public.deals md where md.merged_into_deal_id = d.id), d.created_at::date),
             coalesce((select max(m.message_timestamp)::date from public.whatsapp_messages m where m.client_id = d.client_id and m.direction='inbound'), d.created_at::date)
           ) < (now() at time zone 'Asia/Muscat')::date - p_days
  ), upd as (
    update public.deals d set stage='lost', lost_from_stage=s.stage, lost_at=now(), lost_reason_id=s.rid,
           lost_reason_note='تلقائي: الصفقة واقفة على الزيارة أكثر من 3 أشهر بدون تواصل أو تقدم', updated_at=now()
      from stale s where d.id=s.id and d.merged_into_deal_id is null returning d.id)
  select count(*) into n from upd;
  return n;
end $function$;

-- 5. Merged cards leave the masked deals view (definition otherwise identical to the live one of 10 Nov 2026) -----------
CREATE OR REPLACE VIEW public.crm_deals_access WITH (security_barrier=true) AS
 SELECT id,
    company_id,
    client_id,
    property_id,
    agent_id,
    stage,
    deal_value,
    deposit_amount,
    closing_probability,
    expected_close_date,
    bank_financing,
    notes,
    closed_at,
        CASE
            WHEN public.my_role() = 'owner'::text THEN company_commission
            ELSE NULL::numeric
        END AS company_commission,
        CASE
            WHEN public.my_role() = 'owner'::text THEN agent_commission
            ELSE NULL::numeric
        END AS agent_commission,
    created_at,
    updated_at,
        CASE
            WHEN public.my_role() = 'owner'::text THEN commission_total
            ELSE NULL::numeric
        END AS commission_total,
        CASE
            WHEN public.my_role() = 'owner'::text THEN company_share
            ELSE NULL::numeric
        END AS company_share,
        CASE
            WHEN public.my_role() = 'owner'::text THEN agent_share
            ELSE NULL::numeric
        END AS agent_share,
        CASE
            WHEN public.my_role() = 'owner'::text THEN commission_status
            ELSE NULL::text
        END AS commission_status,
    broker_id,
        CASE
            WHEN public.my_role() = 'owner'::text THEN broker_commission
            ELSE NULL::numeric
        END AS broker_commission,
    request_id,
    viewing_id,
    lost_reason_id,
    lost_reason_note,
    lost_from_stage,
    lost_at,
    entry_mode,
        CASE
            WHEN public.my_role() = 'owner'::text THEN commission_received_at
            ELSE NULL::timestamp with time zone
        END AS commission_received_at,
        CASE
            WHEN public.my_role() = 'owner'::text THEN employee_commission_percent
            ELSE NULL::numeric
        END AS employee_commission_percent,
    reservation_confirmed_at,
    reservation_cancelled_at
   FROM public.deals t
  WHERE company_id = public.my_company() AND crm_repair_private.investment_row_allowed(company_id, to_jsonb(t.*)) AND (property_id IS NULL OR (EXISTS ( SELECT 1
           FROM public.properties p
          WHERE p.id = t.property_id AND p.company_id = t.company_id AND crm_repair_private.investment_row_allowed(p.company_id, to_jsonb(p.*)) AND crm_repair_private.staff_can_access_branch(p.company_id, p.branch_key)))) AND ((public.my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR public.my_role() = 'agent'::text AND agent_id = auth.uid()) AND ((public.my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR (client_id IS NULL OR crm_repair_private.can_access_client(company_id, client_id)) AND (request_id IS NULL OR crm_repair_private.can_access_request(company_id, request_id))) AND t.merged_into_deal_id IS NULL;

-- 6. The trigger (fires before trg_queue_property_outreach: name order) -------------------------------------------------
DROP TRIGGER IF EXISTS crm_close_deals_on_property_unavailable ON public.properties;
CREATE TRIGGER crm_close_deals_on_property_unavailable
  AFTER UPDATE OF status, archived ON public.properties
  FOR EACH ROW
  WHEN ((new.status IN ('sold','withdrawn') AND old.status IS DISTINCT FROM new.status)
     OR (coalesce(new.archived, false) AND NOT coalesce(old.archived, false))
     OR (coalesce(new.archived, false) AND new.status = 'not_available' AND old.status IS DISTINCT FROM new.status))
  EXECUTE FUNCTION crm_repair_private.close_deals_on_property_unavailable();

-- 7. The deal form (crm_save_deal_workflow) reuses the oldest card of a chosen visit: never a merged one ---------------
-- One condition is added to the live body of 10 Nov 2026 (md5 55bb1b16...), in place, so nothing else in the 17 kB
-- function can drift: «... WHERE company_id=c AND viewing_id=vid AND merged_into_deal_id IS NULL ORDER BY created_at,id
-- LIMIT 1 FOR UPDATE». The result must be md5 095a28bf...; the rollback removes the condition the same way.
DO $patch$
DECLARE
  v_def text := pg_get_functiondef('crm_repair_private.save_deal_workflow(jsonb,uuid)'::regprocedure);
  v_old constant text := 'WHERE company_id=c AND viewing_id=vid ORDER BY created_at,id LIMIT 1 FOR UPDATE';
  v_new constant text := 'WHERE company_id=c AND viewing_id=vid AND merged_into_deal_id IS NULL ORDER BY created_at,id LIMIT 1 FOR UPDATE';
BEGIN
  IF md5(v_def) = '095a28bf2f8d6617a8b05e9a23bf99ac' THEN
    RETURN;
  END IF;
  IF md5(v_def) <> '55bb1b1683b9d95f75302712b3e52406' OR length(v_def) - length(replace(v_def, v_old, '')) <> length(v_old) THEN
    RAISE EXCEPTION 'SQL77 refused: crm_repair_private.save_deal_workflow is not the 10 Nov 2026 body (md5 %)', md5(v_def);
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
  IF md5(pg_get_functiondef('crm_repair_private.save_deal_workflow(jsonb,uuid)'::regprocedure)) <> '095a28bf2f8d6617a8b05e9a23bf99ac' THEN
    RAISE EXCEPTION 'SQL77: the save_deal_workflow condition did not apply as expected';
  END IF;
END
$patch$;

-- 8. Private helpers: nobody but the owner role of the database calls them directly ------------------------------------
REVOKE ALL ON FUNCTION crm_repair_private.merge_duplicate_deal(uuid,uuid,boolean,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION crm_repair_private.property_unavailable_note(text,boolean,text,boolean,date,date) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION crm_repair_private.close_deal_property_unavailable(uuid,text,date,boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION crm_repair_private.close_deals_for_property(uuid,text,date,boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION crm_repair_private.close_deals_on_property_unavailable() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION crm_repair_private.close_deals_on_unavailable_properties(boolean) FROM PUBLIC, anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
