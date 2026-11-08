-- 8 Nov 2026 (Ahmed): WhatsApp alert when a new property is registered with missing details, and when a new land study
-- (owner lead of kind land) arrives so it goes to the Tuesday pricing day. Sent by whatsapp-owner-hot-alert action notify_owner.
-- Properties created before 8 Nov 2026 are history and never alerted (rule: pre-2025 = historical record; backlog is a list only).
create table if not exists public.crm_property_alerts(
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  kind text not null,
  ref_id uuid not null,
  sent_at timestamptz not null default now(),
  unique(kind, ref_id));
alter table public.crm_property_alerts enable row level security;

create or replace function public.crm_property_missing(p_id uuid)
returns text[] language sql stable as $$
  select array_remove(array[
    case when coalesce(p.price,0)=0 then 'السعر' end,
    case when coalesce(p.map_url,'')='' then 'اللوكيشن' end,
    case when coalesce(p.land_size,0)=0 then 'مساحة الأرض' end,
    case when p.type<>'land' and coalesce(p.built_size,0)=0 then 'مساحة البناء' end,
    case when p.type<>'land' and coalesce(p.bedrooms,0)=0 then 'الغرف' end,
    case when p.type<>'land' and coalesce(p.bathrooms,0)=0 then 'الحمامات' end,
    case when coalesce(p.owner_net,0)=0 then 'صافي المالك' end,
    case when p.owner_client_id is null and p.owner_id is null then 'المالك' end
  ], null) from public.properties p where p.id=p_id $$;

create or replace function public.crm_properties_missing_details()
returns table(id uuid, title text, area text, type text, branch_key text, created_at timestamptz, missing text[])
language sql stable security definer set search_path=public as $$
  select p.id,p.title,p.area,p.type,p.branch_key,p.created_at,public.crm_property_missing(p.id)
  from public.properties p
  where p.status='available' and coalesce(p.archived,false)=false and p.created_at>='2025-01-01'
    and cardinality(public.crm_property_missing(p.id))>0
  order by p.created_at desc $$;
revoke all on function public.crm_properties_missing_details() from public, anon;
grant execute on function public.crm_properties_missing_details() to authenticated;

create or replace function crm_repair_private.property_alerts_run()
returns void language plpgsql security definer set search_path=public as $$
declare r record; msg text; sec text;
begin
  sec:=(select decrypted_secret from vault.decrypted_secrets where name='crm_reply_agent');
  for r in select p.id,p.company_id,p.title,p.area,p.type,coalesce(p.branch_key,'muscat') bk,public.crm_property_missing(p.id) miss
           from public.properties p
           where p.created_at>='2026-11-08 20:00+04' and p.created_at<now()-interval '20 minutes'
             and p.status='available' and coalesce(p.archived,false)=false
             and cardinality(public.crm_property_missing(p.id))>0
             and not exists(select 1 from public.crm_property_alerts a where a.kind='missing' and a.ref_id=p.id) loop
    msg:='⚠️ عقار جديد ناقص تفاصيل'||E'\n'||coalesce(r.title,r.area,'عقار')||E'\n'||'الناقص: '||array_to_string(r.miss,' · ');
    perform net.http_post(url:='https://dmsckqjkcnsfmnzfjczz.supabase.co/functions/v1/whatsapp-owner-hot-alert',
      headers:=jsonb_build_object('Content-Type','application/json','x-crm-agent',sec),
      body:=jsonb_build_object('action','notify_owner','company_id',r.company_id,'route_key',case when r.bk='barka' then 'barka' else 'muscat' end,'text',msg,'event_key','missing:'||r.id),
      timeout_milliseconds:=30000);
    insert into public.crm_property_alerts(company_id,kind,ref_id) values(r.company_id,'missing',r.id) on conflict do nothing;
  end loop;
  for r in select l.id,l.company_id,l.area,l.wilayat,l.land_size,l.price
           from public.owner_leads l
           where l.kind='land' and l.status in ('open','studied') and l.created_at>='2026-11-08 20:00+04'
             and not exists(select 1 from public.crm_property_alerts a where a.kind='land_study' and a.ref_id=l.id) loop
    msg:='📐 دراسة أرض جديدة انضافت ليوم التسعير (الثلاثاء)'||E'\n'||coalesce(r.area,'')||' '||coalesce(r.wilayat,'')||case when r.land_size is not null then ' · '||r.land_size||' م²' else '' end||case when r.price is not null then ' · السعر في باله '||r.price else '' end;
    perform net.http_post(url:='https://dmsckqjkcnsfmnzfjczz.supabase.co/functions/v1/whatsapp-owner-hot-alert',
      headers:=jsonb_build_object('Content-Type','application/json','x-crm-agent',sec),
      body:=jsonb_build_object('action','notify_owner','company_id',r.company_id,'route_key','muscat','text',msg,'event_key','land_study:'||r.id),
      timeout_milliseconds:=30000);
    insert into public.crm_property_alerts(company_id,kind,ref_id) values(r.company_id,'land_study',r.id) on conflict do nothing;
  end loop;
exception when others then null;
end $$;

select cron.schedule('crm_property_alerts_run','*/10 * * * *','select crm_repair_private.property_alerts_run()');
