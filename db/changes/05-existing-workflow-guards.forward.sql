BEGIN;
SET LOCAL lock_timeout='5s';
-- Update future events only. No historical associations or stages are backfilled.
CREATE OR REPLACE FUNCTION public.sync_viewing_to_crm()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
begin
  if coalesce(new.archived,false)=true or new.client_id is null or new.property_id is null then return new; end if;

  v_request_id:=new.request_id;
  if v_request_id is null then
    select count(distinct pi.request_id), min(pi.request_id::text)::uuid into v_candidate_count,v_request_id
    from public.property_inquiries pi
    where pi.company_id=new.company_id and pi.client_id=new.client_id
      and pi.property_id=new.property_id and pi.request_id is not null;
    if v_candidate_count>1 then
      raise exception using errcode='22023',message='viewing_request_ambiguous';
    end if;
  end if;
  if v_request_id is null then
    select count(*),min(cr.id::text)::uuid into v_candidate_count,v_request_id
    from public.client_requests cr
    where cr.company_id=new.company_id and cr.client_id=new.client_id and cr.status='active';
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
    and (v_request_id is null or pi.request_id=v_request_id or pi.request_id is null)
  order by case when pi.request_id=v_request_id then 0 else 1 end,pi.updated_at desc nulls last,pi.created_at desc
  limit 1;

  if v_inquiry_id is null then
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
      new.rejection_reason,coalesce(new.outcome_note,new.notes),now(),new.next_step,new.followup_date,false
    ) returning id into v_inquiry_id;
  else
    update public.property_inquiries set
      status=v_inquiry_status,
      assigned_to=coalesce(new.agent_id,assigned_to),
      request_id=coalesce(request_id,v_request_id),
      shown_by_agent=true,
      match_status='matched',
      viewing_booked=true,
      viewing_completed=(new.status='done'),
      post_visit_interest=new.client_feedback,
      outcome=case when v_target_stage='lost' then 'rejected' when v_target_stage='negotiation' then 'interested' else outcome end,
      rejection_reason=case when v_target_stage='lost' then new.rejection_reason else rejection_reason end,
      rejection_notes=case when v_target_stage='lost' then coalesce(new.outcome_note,new.notes,rejection_notes) else rejection_notes end,
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
    else 'no_clear_reason' end;
  select id into v_reason_id from public.rejection_reasons where code=v_reason_code and is_active=true limit 1;

  if v_target_stage='lost' and v_reason_id is not null then
    insert into public.property_rejection_reasons(
      company_id,property_inquiry_id,client_id,request_id,property_id,reason_id,is_primary,phase,note,created_by
    ) values (
      new.company_id,v_inquiry_id,new.client_id,v_request_id,new.property_id,v_reason_id,true,'post_visit',coalesce(new.outcome_note,new.notes,new.rejection_reason),new.created_by
    ) on conflict (company_id,property_inquiry_id,reason_id)
      do update set is_primary=true,phase='post_visit',note=excluded.note;
  end if;

  select d.id,d.stage into v_deal_id,v_current_stage
  from public.deals d
  where d.company_id=new.company_id and d.client_id=new.client_id and d.property_id=new.property_id
    and (v_request_id is null or d.request_id=v_request_id or d.request_id is null)
  order by case when d.stage in ('closed','commission_collected') then 2 when d.stage='lost' then 1 else 0 end,
           d.updated_at desc nulls last,d.created_at desc
  limit 1;
  select price into v_price from public.properties where id=new.property_id;

  if v_deal_id is null then
    insert into public.deals(
      company_id,client_id,property_id,agent_id,stage,deal_value,notes,request_id,viewing_id,
      lost_reason_id,lost_reason_note,lost_from_stage,lost_at
    ) values (
      new.company_id,new.client_id,new.property_id,new.agent_id,v_target_stage,v_price,
      'بطاقة Pipeline مرتبطة بزيارة CRM',v_request_id,new.id,
      case when v_target_stage='lost' then v_reason_id end,
      case when v_target_stage='lost' then coalesce(new.outcome_note,new.notes,new.rejection_reason) end,
      case when v_target_stage='lost' then 'visit' end,
      case when v_target_stage='lost' then now() end
    );
  else
    v_final:=v_current_stage in ('closed','commission_collected');
    if not v_final then
      if v_target_stage='lost' then
        update public.deals set
          stage='lost',viewing_id=new.id,request_id=coalesce(request_id,v_request_id),agent_id=coalesce(new.agent_id,agent_id),
          lost_reason_id=v_reason_id,lost_reason_note=coalesce(new.outcome_note,new.notes,new.rejection_reason),
          lost_from_stage=case when v_current_stage='lost' then coalesce(lost_from_stage,'visit') else v_current_stage end,
          lost_at=now(),closed_at=now(),updated_at=now()
        where id=v_deal_id;
      elsif v_current_stage='lost' then
        update public.deals set
          stage=v_target_stage,viewing_id=new.id,request_id=coalesce(request_id,v_request_id),agent_id=coalesce(new.agent_id,agent_id),
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
          request_id=coalesce(request_id,v_request_id),
          agent_id=coalesce(new.agent_id,agent_id),
          updated_at=now()
        where id=v_deal_id;
      end if;
    end if;
  end if;

  return new;
end;
$function$
;

-- Service queue honors the same suppression gate as the send path.
CREATE OR REPLACE FUNCTION public.crm_due_whatsapp_followups(p_limit integer DEFAULT 50)
 RETURNS TABLE(request_id uuid, company_id uuid, client_id uuid, client_name text, client_phone text, route_key text, assigned_to uuid, property_type text, preferred_area text, preferred_areas text[], wilayat text, conversation_id uuid, conversation_meta_phone_id text, last_inbound_at timestamp with time zone, last_outbound_at timestamp with time zone, last_followup_id uuid, last_followup_step text, last_followup_status text, last_followup_sent_at timestamp with time zone, due_step text, due_reason text, anchor_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
with base as (
  select r.id request_id,r.company_id,r.client_id,c.name client_name,c.phone client_phone,
         r.branch_key route_key,r.assigned_to,r.property_type,r.preferred_area,r.preferred_areas,r.wilayat,
         coalesce(r.last_contact_at,c.last_contact_at,r.updated_at,r.created_at) base_anchor,
         oi.consented_at,
         oo.request_id is not null as opted_out
  from public.client_requests r
  join public.clients c on c.id=r.client_id and c.company_id=r.company_id
  left join public.whatsapp_followup_optins oi on oi.client_id=r.client_id and oi.company_id=r.company_id and oi.revoked_at is null
  left join public.whatsapp_followup_optouts oo on oo.request_id=r.id and oo.company_id=r.company_id
  where coalesce(c.archived,false)=false and coalesce(c.followup_suppressed,false)=false
    and r.status='active' and r.branch_key in ('muscat','barka') and coalesce(c.phone,'')<>''
), enriched as (
  select b.*,
         cv.id conversation_id,cv.meta_phone_number_id conversation_meta_phone_id,
         msg.last_inbound_at,msg.last_outbound_at,
         fe.id last_followup_id,fe.step last_followup_step,fe.status last_followup_status,fe.sent_at last_followup_sent_at,fe.created_at last_followup_created_at,
         op.id optin_prompt_id,op.sent_at optin_prompt_sent_at,op.status optin_prompt_status,
         greatest(coalesce(msg.last_inbound_at,'epoch'::timestamptz),coalesce(msg.last_outbound_at,'epoch'::timestamptz),coalesce(b.base_anchor,'epoch'::timestamptz)) anchor_at
  from base b
  left join lateral (
    select wc.id,wc.meta_phone_number_id from public.whatsapp_conversations wc
    where wc.company_id=b.company_id and wc.client_id=b.client_id and wc.route_key=b.route_key
    order by wc.last_message_at desc nulls last,wc.updated_at desc limit 1
  ) cv on true
  left join lateral (
    select max(m.message_timestamp) filter(where m.direction='inbound') last_inbound_at,
           max(m.message_timestamp) filter(where m.direction='outbound') last_outbound_at
    from public.whatsapp_messages m
    join public.whatsapp_conversations wc2 on wc2.id=m.conversation_id
    where m.company_id=b.company_id and m.client_id=b.client_id and wc2.route_key=b.route_key
      and (m.request_id=b.request_id or m.request_id is null)
  ) msg on true
  left join lateral (
    select e.* from public.whatsapp_followup_events e where e.request_id=b.request_id and e.step in ('reminder_1','final_check','paused_no_response') order by e.created_at desc limit 1
  ) fe on true
  left join lateral (
    select e.* from public.whatsapp_followup_events e where e.company_id=b.company_id and e.client_id=b.client_id and e.step='opt_in_request' order by e.created_at desc limit 1
  ) op on true
), due0 as (
  select e.*,
         case
           when e.opted_out then null
           when e.consented_at is null and e.last_inbound_at is not null and e.last_inbound_at>=now()-interval '23 hours'
                and e.optin_prompt_id is null then 'opt_in_request'
           when e.consented_at is null then null
           when e.last_followup_status='template_pending' then e.last_followup_step
           when e.last_followup_status='failed' and e.last_followup_created_at<=now()-interval '24 hours' then e.last_followup_step
           when e.last_followup_step='reminder_1' and e.last_followup_status in ('sent','delivered','read') and e.last_followup_sent_at<=now()-interval '7 days' and (e.last_inbound_at is null or e.last_inbound_at<=e.last_followup_sent_at) then 'final_check'
           when e.last_followup_step='final_check' and e.last_followup_status in ('sent','delivered','read') and e.last_followup_sent_at<=now()-interval '7 days' and (e.last_inbound_at is null or e.last_inbound_at<=e.last_followup_sent_at) then 'paused_no_response'
           when e.last_followup_id is null and e.last_outbound_at is not null and (e.last_inbound_at is null or e.last_outbound_at>e.last_inbound_at) and e.last_outbound_at<=now()-interval '24 hours' then 'reminder_1'
           when e.last_followup_id is null and e.anchor_at<=now()-interval '30 days' then 'reminder_1'
           else null
         end due_step,
         case
           when e.consented_at is null and e.last_inbound_at is not null and e.last_inbound_at>=now()-interval '23 hours' then 'request_explicit_whatsapp_followup_consent'
           when e.last_followup_status='template_pending' then 'template_waiting_approval'
           when e.last_followup_status='failed' then 'retry_after_failure'
           when e.last_followup_step='reminder_1' then 'no_reply_after_first_followup'
           when e.last_followup_step='final_check' then 'no_reply_after_final_check'
           when e.last_followup_id is null and e.last_outbound_at is not null and (e.last_inbound_at is null or e.last_outbound_at>e.last_inbound_at) then 'no_reply_after_contact'
           when e.last_followup_id is null then 'stale_active_request' else null end due_reason
  from enriched e
), ranked as (
  select d.*,row_number() over(partition by d.client_id,d.route_key,d.due_step order by d.anchor_at desc,d.request_id) as same_client_rank
  from due0 d where d.due_step is not null
)
select request_id,company_id,client_id,client_name,client_phone,route_key,assigned_to,property_type,preferred_area,preferred_areas,wilayat,
       conversation_id,conversation_meta_phone_id,last_inbound_at,last_outbound_at,last_followup_id,last_followup_step,last_followup_status,last_followup_sent_at,due_step,due_reason,anchor_at
from ranked
where (due_step<>'opt_in_request' or same_client_rank=1)
  and not (due_step in ('reminder_1','final_check') and exists(
    select 1 from public.whatsapp_followup_events recent
    where recent.client_id=ranked.client_id and recent.route_key=ranked.route_key
      and recent.step in ('reminder_1','final_check') and recent.sent_at>=now()-interval '24 hours'
  ))
order by case due_step when 'opt_in_request' then 1 when 'paused_no_response' then 2 when 'final_check' then 3 else 4 end,anchor_at
limit greatest(1,least(coalesce(p_limit,50),100));
$function$
;
COMMIT;

