-- Rollback of SQL77. Restores verbatim the live bodies of 10 Nov 2026 (pg_get_functiondef md5:
-- sync_viewing_to_crm 65058710025e84c947232e9193d20742, link_viewing_interest 970a3c95b5cce287a32e906e141e2e85,
-- crm_close_stale_visit_deals e6e7a9aa16b417267dfb54f54a101553; crm_deals_access viewdef d477af648361686b9a0e02fcd2a10c19
-- with search_path public, 4bfa98cd3258c1a95b6d2990cf9300d4 fully qualified as written below), takes the SQL77
-- condition out of crm_repair_private.save_deal_workflow (back to md5 55bb1b1683b9d95f75302712b3e52406, checked),
-- removes the closing trigger and the merge/closing helpers, then 77c's two indexes and the merged_into_deal_id/merged_at
-- columns. Data stays as it is: cards closed by the automation stay lost (their note starts with «تلقائي:»), owner
-- review tasks and notifications written by the automation stay (Ahmed may still be working on them), merged
-- duplicates become ordinary lost cards whose notes say «[دمج] ...», and crm_repair_private.deal_merge_audit and
-- crm_repair_private.deals_cleanup_20261110 keep their snapshots (a merge can be undone from keep_before/drop_before).
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

DO $$
BEGIN
  IF position('merged_into_deal_id' IN pg_get_functiondef('public.sync_viewing_to_crm()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'SQL77 rollback refused: public.sync_viewing_to_crm is not the SQL77 version';
  END IF;
END $$;

DROP TRIGGER IF EXISTS crm_close_deals_on_property_unavailable ON public.properties;

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

  select pi.id into v_inquiry_id
  from public.property_inquiries pi
  where pi.company_id=new.company_id and pi.client_id=new.client_id and pi.property_id=new.property_id
    and pi.request_id IS NOT DISTINCT FROM v_request_id
  order by case when pi.request_id=v_request_id then 0 else 1 end,pi.updated_at desc nulls last,pi.created_at desc
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
   and d.client_id=ctx.client_id and d.property_id=ctx.property_id
  where ctx.transaction_id=txid_current() and ctx.user_id=auth.uid()
   and ctx.company_id=new.company_id and ctx.client_id=new.client_id and ctx.property_id=new.property_id;
  v_workflow_context:=v_deal_id is not null;
  if not v_workflow_context then
  select d.id,d.stage into v_deal_id,v_current_stage
  from public.deals d
  where d.company_id=new.company_id and d.client_id=new.client_id and d.property_id=new.property_id
    and d.request_id IS NOT DISTINCT FROM v_request_id
  order by case when d.stage in ('closed','commission_collected') then 2 when d.stage='lost' then 1 else 0 end,
           d.updated_at desc nulls last,d.created_at desc
  limit 1;
  end if;
  select price into v_price from public.properties where id=new.property_id;

  if v_deal_id is null then
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
  else
    v_final:=v_current_stage in ('closed','commission_collected');
    if not v_final then
      if v_target_stage='lost' then
        update public.deals set
          stage='lost',viewing_id=new.id,request_id=case when v_workflow_context then v_request_id else coalesce(request_id,v_request_id) end,agent_id=coalesce(new.agent_id,agent_id),
          lost_reason_id=v_reason_id,lost_reason_note=nullif(btrim(new.outcome_note),''),
          lost_from_stage=case when v_current_stage='lost' then coalesce(lost_from_stage,'visit') else v_current_stage end,
          lost_at=now(),closed_at=now(),updated_at=now()
        where id=v_deal_id;
      elsif v_current_stage='lost' then
        update public.deals set
          stage=v_target_stage,viewing_id=new.id,request_id=case when v_workflow_context then v_request_id else coalesce(request_id,v_request_id) end,agent_id=coalesce(new.agent_id,agent_id),
          lost_reason_id=null,lost_reason_note=null,lost_from_stage=null,lost_at=null,closed_at=null,updated_at=now()
        where id=v_deal_id;
      else
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
          request_id=case when v_workflow_context then v_request_id else coalesce(request_id,v_request_id) end,
          agent_id=coalesce(new.agent_id,agent_id),
          updated_at=now()
        where id=v_deal_id;
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
 select id into v_inquiry from public.property_inquiries
  where company_id=new.company_id and client_id=new.client_id and property_id=new.property_id
    and request_id IS NOT DISTINCT FROM new.request_id
  order by created_at limit 1 for update;
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
   updated_at=now()
  where id=v_inquiry;
 end if;
 return new;
end $function$;

CREATE OR REPLACE FUNCTION public.crm_close_stale_visit_deals(p_days integer DEFAULT 90)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n int := 0; rid uuid;
begin
  select id into rid from public.rejection_reasons where code='no_response_after_visit' limit 1;
  with stale as (
    select d.id, d.stage from public.deals d
      left join public.viewings v on v.id = d.viewing_id
     where d.stage in ('viewing_scheduled','visit','viewing_postponed','viewing_cancelled','viewing_no_show')
       and greatest(
             coalesce(v.viewing_date, d.created_at::date),
             d.created_at::date,
             coalesce((select max(m.message_timestamp)::date from public.whatsapp_messages m where m.client_id = d.client_id and m.direction='inbound'), d.created_at::date)
           ) < (now() at time zone 'Asia/Muscat')::date - p_days
  ), upd as (
    update public.deals d set stage='lost', lost_from_stage=s.stage, lost_at=now(), lost_reason_id=rid,
           lost_reason_note='تلقائي: الصفقة واقفة على الزيارة أكثر من 3 أشهر بدون تواصل أو تقدم', updated_at=now()
      from stale s where d.id=s.id returning d.id)
  select count(*) into n from upd;
  return n;
end $function$;

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
          WHERE p.id = t.property_id AND p.company_id = t.company_id AND crm_repair_private.investment_row_allowed(p.company_id, to_jsonb(p.*)) AND crm_repair_private.staff_can_access_branch(p.company_id, p.branch_key)))) AND ((public.my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR public.my_role() = 'agent'::text AND agent_id = auth.uid()) AND ((public.my_role() = ANY (ARRAY['owner'::text, 'manager'::text, 'viewer'::text])) OR (client_id IS NULL OR crm_repair_private.can_access_client(company_id, client_id)) AND (request_id IS NULL OR crm_repair_private.can_access_request(company_id, request_id)));

-- The deal form: remove the SQL77 condition in place and check the result is the 10 Nov 2026 body again.
DO $unpatch$
DECLARE
  v_def text := pg_get_functiondef('crm_repair_private.save_deal_workflow(jsonb,uuid)'::regprocedure);
  v_old constant text := 'WHERE company_id=c AND viewing_id=vid AND merged_into_deal_id IS NULL ORDER BY created_at,id LIMIT 1 FOR UPDATE';
  v_new constant text := 'WHERE company_id=c AND viewing_id=vid ORDER BY created_at,id LIMIT 1 FOR UPDATE';
BEGIN
  IF md5(v_def) = '55bb1b1683b9d95f75302712b3e52406' THEN
    RETURN;
  END IF;
  IF md5(v_def) <> '095a28bf2f8d6617a8b05e9a23bf99ac' THEN
    RAISE EXCEPTION 'SQL77 rollback refused: crm_repair_private.save_deal_workflow changed after SQL77 (md5 %)', md5(v_def);
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
  IF md5(pg_get_functiondef('crm_repair_private.save_deal_workflow(jsonb,uuid)'::regprocedure)) <> '55bb1b1683b9d95f75302712b3e52406' THEN
    RAISE EXCEPTION 'SQL77 rollback: save_deal_workflow is not back to the 10 Nov 2026 body';
  END IF;
END
$unpatch$;

DROP FUNCTION IF EXISTS crm_repair_private.close_deals_on_unavailable_properties(boolean);
DROP FUNCTION IF EXISTS crm_repair_private.close_deals_on_property_unavailable();
DROP FUNCTION IF EXISTS crm_repair_private.close_deals_for_property(uuid,text,date,boolean);
DROP FUNCTION IF EXISTS crm_repair_private.close_deal_property_unavailable(uuid,text,date,boolean);
DROP FUNCTION IF EXISTS crm_repair_private.property_unavailable_note(text,boolean,text,boolean,date,date);
DROP FUNCTION IF EXISTS crm_repair_private.merge_duplicate_deal(uuid,uuid,boolean,text);

DROP INDEX IF EXISTS public.deals_one_open_card_per_client_property;
DROP INDEX IF EXISTS public.deals_one_open_card_per_viewing;
DROP INDEX IF EXISTS public.deals_merged_into_idx;
ALTER TABLE public.deals DROP CONSTRAINT IF EXISTS deals_merged_card_stays_lost;
ALTER TABLE public.deals DROP COLUMN IF EXISTS merged_at, DROP COLUMN IF EXISTS merged_into_deal_id;
NOTIFY pgrst, 'reload schema';
