-- Every owner who sent us his property's details (seller requests from WhatsApp and the old intake form)
-- is an owner lead, matched daily with active buyers. Price is optional: without it the match is by type and area.
alter table public.owner_leads add column if not exists source_request_id uuid unique references public.client_requests(id) on delete set null;
alter table public.owner_leads add column if not exists plot_no text;
alter table public.owner_leads alter column kind drop not null;

create or replace function public.crm_owner_kind(k text) returns text language sql immutable as $$
  select case when k is null or k='' then null
    when k like 'land%' or k='farm' then case when k='farm' then 'farm' else 'land' end
    when k in ('villa','house','twin_villa','townhouse') then 'villa'
    when k in ('building','residential_building') then 'building'
    when k in ('apartment','penthouse') then 'apartment'
    else k end $$;

-- prices typed in thousands ("129") are read as 129,000
create or replace function public.crm_money(v numeric) returns numeric language sql immutable as $$ select case when v is null or v<=0 then null when v<1000 then v*1000 else v end $$;

-- first meaningful word of an area ("خلف المدارس بالمريصي" -> "المدارس" is skipped too: we keep the last real place word)
create or replace function public.crm_area_token(a text) returns text language sql immutable as $$
  select w from (
    select w, ord from unnest(regexp_split_to_array(regexp_replace(coalesce(a,''),'[،,/()\-]',' ','g'),'\s+')) with ordinality t(w,ord)
    where length(w)>=3 and w not in ('حي','خلف','قرب','بالقرب','منطقة','شارع','جنب','بجانب','المرحلة','مرحلة','الحي','من','في','عند','على','المدارس','الحكومية','مخطط','جديد','الجديدة','الجديد')
      and w !~ '^[0-9٠-٩]+$'
    order by ord limit 1) x $$;

create or replace function public.crm_sync_owner_leads() returns integer language plpgsql security definer set search_path to 'public' as $f$
declare n int;
begin
  with src as (
    select r.id, r.company_id, r.client_id, r.property_type, coalesce(r.preferred_area, r.preferred_areas[1]) area, r.wilayat,
      crm_money(coalesce(r.budget_max, r.budget_min)) price, r.land_size_min, r.built_size_min, r.notes, r.created_at,
      (select w.id from whatsapp_conversations w where w.client_id=r.client_id order by w.last_message_at desc nulls last limit 1) conv,
      substring(coalesce(r.notes,'') from 'رقم القطعة: *([0-9٠-٩]+)') plot
    from client_requests r join clients c on c.id=r.client_id
    where r.request_type='seller' and r.status='active' and r.created_at>='2025-01-01'
      and (coalesce(r.property_type,'')<>'' or coalesce(r.preferred_area,r.wilayat) is not null)
      and not exists (select 1 from owner_leads o where o.client_id=r.client_id and o.source_request_id is null and o.kind is not distinct from crm_owner_kind(r.property_type))
      and not exists (select 1 from company_lead_routes x where regexp_replace(coalesce(x.whatsapp_number,''),'\D','','g')=regexp_replace(coalesce(c.phone_normalized,c.phone,''),'\D','','g') and coalesce(c.phone,'')<>'')
  ), up as (
    insert into owner_leads(company_id, client_id, conversation_id, kind, area, wilayat, price, land_size, built_size, notes, status, source_request_id, plot_no, created_at, updated_at)
    select company_id, client_id, conv, crm_owner_kind(property_type), area, wilayat, price, land_size_min, built_size_min, left(notes,1000), 'open', id, plot, created_at, now() from src
    on conflict (source_request_id) do update set kind=excluded.kind, area=excluded.area, wilayat=excluded.wilayat, price=coalesce(excluded.price, owner_leads.price),
      land_size=coalesce(excluded.land_size, owner_leads.land_size), built_size=coalesce(excluded.built_size, owner_leads.built_size),
      conversation_id=coalesce(owner_leads.conversation_id, excluded.conversation_id), plot_no=coalesce(excluded.plot_no, owner_leads.plot_no), updated_at=now()
    returning 1)
  select count(*) into n from up;
  -- an owner whose property we already list is not an "unlisted" offer
  update owner_leads l set status='listed', updated_at=now() where l.status in ('open','studied') and exists (
    select 1 from properties p join owners o on o.id=p.owner_id join clients c on c.id=l.client_id
    where p.status in ('available','reserved') and regexp_replace(coalesce(o.phone,''),'\D','','g')<>''
      and right(regexp_replace(o.phone,'\D','','g'),8)=right(regexp_replace(coalesce(c.phone_normalized,c.phone,''),'\D','','g'),8));
  -- sold or withdrawn seller requests close their lead
  update owner_leads l set status='closed', updated_at=now() from client_requests r where r.id=l.source_request_id and r.status<>'active' and l.status in ('open','studied');
  return n;
end $f$;

drop function if exists public.crm_match_owner_leads();
create or replace function public.crm_match_owner_leads(p_notify boolean default true) returns integer language plpgsql security definer set search_path to 'public' as $f$
declare n int := 0; l record; v_owner uuid; names text; cnt int; tok text;
begin
  perform crm_sync_owner_leads();
  for l in select * from owner_leads where status in ('open','studied') and kind is not null loop
    tok := crm_area_token(l.area);
    if tok is null and l.wilayat is null then continue; end if;
    with hits as (
      select q.id request_id, coalesce(c.name,'عميل') nm, crm_money(q.budget_max) budget_max
      from client_requests q left join clients c on c.id=q.client_id
      where q.company_id=l.company_id and q.status='active' and q.request_type='buyer'
        and q.updated_at > now() - interval '90 days' and q.client_id is distinct from l.client_id and crm_money(q.budget_max) is not null
        and (crm_owner_kind(q.property_type)=l.kind or exists (select 1 from unnest(coalesce(q.property_types,'{}')) t where crm_owner_kind(t)=l.kind))
        and (l.price is null or crm_money(q.budget_max) between l.price*0.85 and l.price*1.3)
        and (case when tok is not null then
               (q.preferred_area ilike '%'||tok||'%' or exists (select 1 from unnest(coalesce(q.preferred_areas,'{}')) a where a ilike '%'||tok||'%'))
             else (q.wilayat ilike '%'||l.wilayat||'%' and coalesce(q.preferred_area,'')='') end)
        and not exists (select 1 from owner_lead_matches m where m.lead_id=l.id and m.request_id=q.id)
    ), ins as (insert into owner_lead_matches(lead_id, request_id) select l.id, request_id from hits on conflict do nothing returning request_id)
    select count(*), string_agg(h.nm || coalesce(' ('||round(h.budget_max/1000)||' الف)',''), '، ') into cnt, names from hits h;
    if cnt > 0 then
      n := n + cnt;
      if p_notify then
        select id into v_owner from profiles where company_id=l.company_id and role='owner' and is_active limit 1;
        if v_owner is not null then
          insert into notifications(user_id, type, is_read, client_id, link, title, body)
          values (v_owner, 'owner_lead_match', false, l.client_id, 'owner-leads',
            'مشترين جاهزين لعرض مالك ('||cnt||'): '||coalesce(l.kind,'')||' '||coalesce(l.area,l.wilayat,'')||coalesce(' '||round(l.price/1000)||' الف',''), left(names,400));
        end if;
      end if;
    end if;
  end loop;
  return n;
end $f$;
grant execute on function public.crm_match_owner_leads(boolean) to service_role;
grant execute on function public.crm_sync_owner_leads() to service_role;
