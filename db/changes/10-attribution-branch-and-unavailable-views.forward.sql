CREATE OR REPLACE FUNCTION public.resolve_unmatched_property_link(p_unmatched_id uuid, p_property_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE u public.unmatched_property_links%rowtype; v_company uuid:=public.my_company(); v_role text:=public.my_role();
 v_marketing uuid; v_existing uuid; v_linkkey text;
BEGIN
 IF v_company IS NULL OR v_role NOT IN ('owner','manager','agent') THEN RAISE EXCEPTION 'not_allowed'; END IF;
 SELECT * INTO u FROM public.unmatched_property_links WHERE id=p_unmatched_id AND company_id=v_company AND status='pending' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'pending_link_not_found'; END IF;
 -- Authorize the exact conversation, including owner-only channels. A resolution affects only this occurrence.
 IF NOT crm_repair_private.can_access_whatsapp_conversation(v_company,u.conversation_id) THEN RAISE EXCEPTION 'not_assigned'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.properties WHERE id=p_property_id AND company_id=v_company AND crm_repair_private.staff_can_access_branch(company_id,branch_key)) THEN RAISE EXCEPTION 'invalid_property'; END IF;
 v_linkkey:=public.normalize_property_marketing_link(u.raw_url);
 IF v_linkkey IS NOT NULL THEN
  SELECT id,property_id INTO v_marketing,v_existing FROM public.property_marketing_events WHERE company_id=v_company AND link_key=v_linkkey;
  IF v_existing IS NOT NULL AND v_existing<>p_property_id THEN RAISE EXCEPTION 'link_already_mapped_to_another_property'; END IF;
  IF v_marketing IS NULL THEN
   INSERT INTO public.property_marketing_events(company_id,property_id,channel,event_type,url,notes,created_by,auto_sync,sync_status)
   VALUES(v_company,p_property_id,coalesce(public.property_link_provider(u.raw_url),'other'),'publish',u.raw_url,'تم تأكيد الرابط بواسطة موظف',auth.uid(),false,'manual') RETURNING id INTO v_marketing;
  END IF;
 END IF;
 PERFORM public.record_property_link_inquiry_internal(v_company,u.client_id,p_property_id,v_marketing,u.whatsapp_message_id,u.raw_url,u.link_key,u.first_seen_at,true);
 PERFORM public.crm_finalize_property_message(u.whatsapp_message_id);
 UPDATE public.whatsapp_messages SET matched_property_id=p_property_id,matched_marketing_event_id=v_marketing,property_match_status='resolved_manual',property_link_key=u.link_key WHERE id=u.whatsapp_message_id AND company_id=v_company;
 UPDATE public.unmatched_property_links SET status='resolved',property_id=p_property_id,marketing_event_id=v_marketing,resolved_by=auth.uid(),resolved_at=now(),updated_at=now() WHERE id=u.id;
 RETURN jsonb_build_object('ok',true,'property_id',p_property_id,'marketing_event_id',v_marketing,'resolved_occurrences',1,'link_key',u.link_key);
END $function$;
CREATE OR REPLACE FUNCTION public.crm_employee_performance(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_company uuid:=public.my_company(); v_actor uuid:=auth.uid(); v_role text:=public.my_role();
 v_start timestamptz;v_end timestamptz;v_result jsonb;
begin
 if v_company is null or v_actor is null or v_role not in ('owner','manager','agent') then
  raise exception using errcode='42501',message='performance_not_allowed';
 end if;
 if p_from is null or p_to is null or p_to<=p_from or p_to>p_from+interval '367 days' then
  raise exception using errcode='22023',message='invalid_performance_period';
 end if;
 v_start:=p_from::timestamp at time zone 'Asia/Muscat';
 v_end:=p_to::timestamp at time zone 'Asia/Muscat';
 select coalesce(jsonb_agg(jsonb_build_object(
   'employee_id',e.id,'name',e.full_name,
   'active_inventory',coalesce(pr.active_inventory,0),
   'new_properties',coalesce(pr.new_properties,0),
   'inquiries',coalesce(i.inquiries,0),
   'inquiry_to_visit',coalesce(i.to_visit,0),
   'visits_booked',coalesce(v.booked,0),'visits_done',coalesce(v.done,0),
   'visit_to_sale',coalesce(v.to_sale,0),
   'sales',coalesce(d.sales,0),
   'company_commission',case when v_role='owner' then coalesce(d.company_commission,0) else null end,
   'activities',coalesce(a.activities,0),
   'outbound_messages',coalesce(w.outbound,0),
   'targets',coalesce(to_jsonb(t)-'company_id'-'employee_id'-'month_start'-'updated_at','{}'::jsonb)
 )),'[]'::jsonb) into v_result
 from public.profiles e
 left join public.employee_monthly_targets t on t.company_id=e.company_id and t.employee_id=e.id
   and t.month_start=date_trunc('month',p_from)::date
 left join lateral (
   select count(*) filter(where p.archived=false and p.status not in('sold','not_available')) active_inventory,
    count(*) filter(where p.created_at>=v_start and p.created_at<v_end and p.archived=false) new_properties
   from public.properties p where p.company_id=e.company_id and p.sourced_by=e.id and (v_role<>'agent' or crm_repair_private.staff_can_access_branch(p.company_id,p.branch_key))
 ) pr on true
 left join lateral (
   select count(*) inquiries,
    count(*) filter(where exists(select 1 from public.viewings vv
      where vv.company_id=pi.company_id and vv.client_id=pi.client_id and vv.property_id=pi.property_id
       and vv.archived=false and vv.status<>'cancelled' and vv.created_at>=pi.first_inquiry_at)) to_visit
   from public.property_inquiries pi
   where pi.company_id=e.company_id and pi.assigned_to=e.id
    and (v_role<>'agent' or (crm_repair_private.can_access_client(pi.company_id,pi.client_id) and exists(select 1 from public.properties pp where pp.id=pi.property_id and pp.company_id=pi.company_id and crm_repair_private.staff_can_access_branch(pp.company_id,pp.branch_key))))
    and pi.has_inbound_inquiry=true and pi.first_inquiry_at>=v_start and pi.first_inquiry_at<v_end
 ) i on true
 left join lateral (
   select count(*) filter(where vv.created_at>=v_start and vv.created_at<v_end and vv.status<>'cancelled') booked,
    count(*) filter(where vv.status='done' and vv.viewing_date>=p_from and vv.viewing_date<p_to) done,
    count(*) filter(where vv.status='done' and vv.viewing_date>=p_from and vv.viewing_date<p_to
      and exists(select 1 from public.deals dd where dd.company_id=vv.company_id and dd.agent_id=e.id
        and dd.client_id=vv.client_id and dd.property_id=vv.property_id
        and dd.stage in('closed','commission_collected') and dd.closed_at>=vv.viewing_date::timestamp at time zone 'Asia/Muscat')) to_sale
   from public.viewings vv where vv.company_id=e.company_id and vv.agent_id=e.id and vv.archived=false and (v_role<>'agent' or (crm_repair_private.can_access_client(vv.company_id,vv.client_id) and exists(select 1 from public.properties pp where pp.id=vv.property_id and pp.company_id=vv.company_id and crm_repair_private.staff_can_access_branch(pp.company_id,pp.branch_key))))
 ) v on true
 left join lateral (
   select count(*) sales,sum(coalesce(dd.company_commission,dd.company_share,0)) company_commission
   from public.deals dd where dd.company_id=e.company_id and dd.agent_id=e.id
     and (v_role<>'agent' or (crm_repair_private.can_access_client(dd.company_id,dd.client_id) and (dd.property_id is null or exists(select 1 from public.properties pp where pp.id=dd.property_id and pp.company_id=dd.company_id and crm_repair_private.staff_can_access_branch(pp.company_id,pp.branch_key)))))
     and dd.stage in('closed','commission_collected') and dd.closed_at>=v_start and dd.closed_at<v_end
 ) d on true
 left join lateral (
   select count(*) activities from public.activities aa where aa.company_id=e.company_id and aa.user_id=e.id
    and aa.created_at>=v_start and aa.created_at<v_end and (v_role<>'agent' or (aa.client_id is null or crm_repair_private.can_access_client(aa.company_id,aa.client_id))) and aa.actor_type = 'human' and coalesce(aa.channel,'') <> 'system'
 ) a on true
 left join lateral (
   select count(*) outbound from public.whatsapp_messages mm
   where mm.company_id=e.company_id and mm.sent_by_user_id=e.id and mm.direction='outbound' and mm.actor_type='human' and (v_role<>'agent' or crm_repair_private.can_access_whatsapp_conversation(mm.company_id,mm.conversation_id))
    and mm.message_timestamp>=v_start and mm.message_timestamp<v_end
 ) w on true
 where e.company_id=v_company and e.role='agent' and e.is_active
  and (v_role in('owner','manager') or e.id=v_actor);
 return jsonb_build_object('from',p_from,'to',p_to,'employees',v_result);
end $function$;
CREATE OR REPLACE VIEW public.property_instagram_analytics WITH (security_invoker=true) AS SELECT company_id,
    property_id,
    (count(*))::integer AS link_count,
    (count(*) FILTER (WHERE (sync_status = 'synced'::text)))::integer AS synced_link_count,
    (count(*) FILTER (WHERE (sync_status = 'error'::text)))::integer AS failed_link_count,
    sum(COALESCE(views, plays)) AS total_views,
    COALESCE(sum(COALESCE(plays, 0)), (0)::bigint) AS total_plays,
    COALESCE(sum(COALESCE(reach, 0)), (0)::bigint) AS total_reach,
    COALESCE(sum(COALESCE(likes, 0)), (0)::bigint) AS total_likes,
    COALESCE(sum(COALESCE(comments, 0)), (0)::bigint) AS total_comments,
    COALESCE(sum(COALESCE(shares, 0)), (0)::bigint) AS total_shares,
    COALESCE(sum(COALESCE(saves, 0)), (0)::bigint) AS total_saves,
    COALESCE(sum(COALESCE(total_interactions, 0)), (0)::bigint) AS total_interactions,
    (COALESCE(sum(COALESCE(watch_time_ms, (0)::bigint)), (0)::numeric))::bigint AS total_watch_time_ms,
    COALESCE(sum(COALESCE(replays, 0)), (0)::bigint) AS total_replays,
    max(last_synced_at) AS last_synced_at,
    jsonb_agg(jsonb_build_object('event_id', id, 'url', url, 'shortcode', link_key, 'media_id', instagram_media_id, 'published_at', published_at, 'views', COALESCE(views, plays), 'plays', plays, 'reach', reach, 'likes', likes, 'comments', comments, 'shares', shares, 'saves', saves, 'interactions', total_interactions, 'watch_time_ms', watch_time_ms, 'avg_watch_time_ms', avg_watch_time_ms, 'replays', replays, 'sync_status', sync_status, 'sync_error', sync_error, 'last_synced_at', last_synced_at) ORDER BY published_at DESC NULLS LAST, created_at DESC) AS links
   FROM property_marketing_events
  WHERE ((channel = 'instagram'::text) AND (url IS NOT NULL))
  GROUP BY company_id, property_id;
