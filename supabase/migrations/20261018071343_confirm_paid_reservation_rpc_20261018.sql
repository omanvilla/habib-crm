-- Already deployed migration, recovered verbatim from migration history.
create or replace function public.crm_confirm_paid_reservation(p_deal_id uuid,p_payment_date date,p_amount numeric,p_expected_company_commission numeric default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.deals%rowtype; v_actor uuid:=auth.uid();v_company uuid:=public.my_company();v_role text:=public.my_role();v_at timestamptz;
begin
 if v_actor is null or v_company is null or v_role not in ('owner','manager','agent') or not crm_repair_private.can_access_deal_workflow(p_deal_id) then raise exception 'not_authorized' using errcode='42501';end if;
 if p_payment_date is null or p_payment_date>(now() at time zone 'Asia/Muscat')::date or p_amount is null or p_amount<=0 then raise exception 'actual_paid_deposit_date_and_amount_required' using errcode='22023';end if;
 if p_expected_company_commission is not null and p_expected_company_commission<0 then raise exception 'invalid_expected_commission' using errcode='22023';end if;
 if v_role<>'owner' and p_expected_company_commission is not null then raise exception 'owner_only_financial_fields' using errcode='42501';end if;
 select * into d from public.deals where id=p_deal_id and company_id=v_company for update;
 if not found then raise exception 'deal_not_found' using errcode='22023';end if;
 if d.reservation_confirmed_at is not null then
   if (d.reservation_confirmed_at at time zone 'Asia/Muscat')::date=p_payment_date and d.deposit_amount=p_amount then return jsonb_build_object('ok',true,'already_confirmed',true,'deal_id',d.id);end if;
   raise exception 'reservation_already_confirmed_do_not_overwrite' using errcode='22023';
 end if;
 if d.stage in ('lost','viewing_cancelled','viewing_no_show') then raise exception 'invalid_deal_stage_for_paid_deposit' using errcode='22023';end if;
 v_at:=(p_payment_date+time '12:00') at time zone 'Asia/Muscat';
 update public.deals set reservation_confirmed_at=v_at,reservation_evidence_note='paid_deposit_confirmed_in_crm',deposit_amount=p_amount,expected_company_commission_at_reservation=case when v_role='owner' then p_expected_company_commission else null end,stage='deposit',updated_at=now() where id=p_deal_id;
 return jsonb_build_object('ok',true,'deal_id',p_deal_id,'confirmed_on',p_payment_date);
end $$;
revoke all on function public.crm_confirm_paid_reservation(uuid,date,numeric,numeric) from public,anon;
grant execute on function public.crm_confirm_paid_reservation(uuid,date,numeric,numeric) to authenticated;

