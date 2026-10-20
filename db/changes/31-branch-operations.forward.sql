-- SQL31: branch-owned operations and goals, independent of login accounts.
-- Adds compatible branch RPCs; existing employee RPCs and business rows remain.
-- Reversible catalog change plus exact copies of approved saved branch goals.
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE TABLE IF NOT EXISTS crm_repair_private.audit31_catalog_backup(
 identity text PRIMARY KEY,kind text NOT NULL,definition text,enabled "char",
 applied_definition text,applied_acl aclitem[],applied_owner oid,original_acl aclitem[],original_owner oid,
 captured_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE crm_repair_private.audit31_catalog_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_repair_private.audit31_catalog_backup FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE crm_repair_private.audit31_catalog_backup ADD COLUMN IF NOT EXISTS original_acl aclitem[];
ALTER TABLE crm_repair_private.audit31_catalog_backup ADD COLUMN IF NOT EXISTS original_owner oid;
DO $guard$
DECLARE ident text;b record;p record;
BEGIN
 FOREACH ident IN ARRAY ARRAY[
  'crm_repair_private.branch_period_metrics(date,date)',
  'public.crm_branch_performance(date,date)',
  'public.crm_branch_target_snapshot()',
  'public.crm_branch_monthly_targets(date)',
  'public.crm_save_branch_monthly_targets(text,date,jsonb,timestamp with time zone)'
 ] LOOP
  SELECT pg_get_functiondef(oid) definition,proacl,proowner INTO p FROM pg_proc WHERE oid=to_regprocedure(ident);
  SELECT * INTO b FROM crm_repair_private.audit31_catalog_backup WHERE identity=ident;
  IF NOT FOUND THEN
   IF p.definition IS NOT NULL THEN RAISE EXCEPTION 'SQL31 refuses an existing unrelated function: %',ident;END IF;
   INSERT INTO crm_repair_private.audit31_catalog_backup(identity,kind) VALUES(ident,'function');
  ELSIF p.definition IS NOT NULL AND (p.definition IS DISTINCT FROM b.applied_definition
    OR p.proacl IS DISTINCT FROM b.applied_acl OR p.proowner IS DISTINCT FROM b.applied_owner) THEN
   RAISE EXCEPTION 'SQL31 apply refused: function or permissions changed: %',ident;
  END IF;
 END LOOP;
 SELECT pg_get_triggerdef(t.oid,true) definition,t.tgenabled INTO p FROM pg_trigger t
 WHERE t.tgrelid='public.properties'::regclass AND t.tgname='zzzz_property_branch_employee' AND NOT t.tgisinternal;
 IF NOT FOUND THEN RAISE EXCEPTION 'SQL31 requires the known property attribution predecessor';END IF;
 SELECT * INTO b FROM crm_repair_private.audit31_catalog_backup WHERE identity='public.properties.zzzz_property_branch_employee';
 IF NOT FOUND THEN
  INSERT INTO crm_repair_private.audit31_catalog_backup(identity,kind,definition,enabled)
  VALUES('public.properties.zzzz_property_branch_employee','trigger',p.definition,p.tgenabled);
 ELSIF p.definition IS DISTINCT FROM b.definition OR (p.tgenabled IS DISTINCT FROM b.enabled AND p.tgenabled<>'D') THEN
  RAISE EXCEPTION 'SQL31 apply refused: property attribution trigger changed';
 END IF;
END $guard$;

-- An owner/manager may finish an already-authorized historical visit without
-- assigning it to a new person merely because its original author was retired.
-- New visits and changed assignees still require an active eligible account;
-- agents still require their own current active identity. Preserve the exact
-- predecessor definition, owner and ACL, and refuse unrelated catalog drift.
DO $viewing_guard$
DECLARE ident constant text:='public.crm_save_viewing_atomic(jsonb,uuid)';p record;b record;patched text;
 old_guard constant text:='IF NOT EXISTS\(SELECT 1 FROM public\.profiles WHERE id=v_new.agent_id AND company_id=v_company AND is_active IS TRUE[[:space:]]+AND role IN\(''owner'',''manager'',''agent''\)\) OR \(v_role=''agent'' AND v_new.agent_id<>v_user\) THEN';
 new_guard constant text:='IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=v_new.agent_id AND company_id=v_company
    AND role IN(''owner'',''manager'',''agent'')
    AND (is_active IS TRUE OR (v_role IN(''owner'',''manager'') AND v_old.id IS NOT NULL
      AND v_new.agent_id IS NOT DISTINCT FROM v_old.agent_id)))
    OR (v_role=''agent'' AND v_new.agent_id<>v_user) THEN';
BEGIN
 SELECT pg_get_functiondef(oid) definition,proacl,proowner INTO p FROM pg_proc WHERE oid=to_regprocedure(ident);
 IF NOT FOUND THEN RAISE EXCEPTION 'SQL31 requires the known atomic-viewing predecessor';END IF;
 SELECT * INTO b FROM crm_repair_private.audit31_catalog_backup WHERE identity=ident;
 IF NOT FOUND THEN
  IF (SELECT count(*) FROM regexp_matches(p.definition,old_guard,'g'))<>1 THEN
   RAISE EXCEPTION 'SQL31 refuses unknown atomic-viewing authorization predecessor';
  END IF;
  INSERT INTO crm_repair_private.audit31_catalog_backup(identity,kind,definition,original_acl,original_owner)
  VALUES(ident,'existing_function',p.definition,p.proacl,p.proowner);
 ELSIF (p.definition IS DISTINCT FROM b.definition OR p.proacl IS DISTINCT FROM b.original_acl OR p.proowner IS DISTINCT FROM b.original_owner)
   AND (p.definition IS DISTINCT FROM b.applied_definition OR p.proacl IS DISTINCT FROM b.applied_acl OR p.proowner IS DISTINCT FROM b.applied_owner) THEN
  RAISE EXCEPTION 'SQL31 apply refused: function or permissions changed: %',ident;
 END IF;
 SELECT * INTO STRICT b FROM crm_repair_private.audit31_catalog_backup WHERE identity=ident;
 patched:=regexp_replace(b.definition,old_guard,new_guard);
 IF patched=b.definition THEN RAISE EXCEPTION 'SQL31 atomic-viewing predecessor predicate is missing';END IF;
 EXECUTE patched;
END $viewing_guard$;

CREATE TABLE IF NOT EXISTS crm_repair_private.branch_monthly_targets(
 company_id uuid NOT NULL REFERENCES public.companies(id),
 branch_key text NOT NULL CHECK(branch_key IN ('muscat','barka')),
 month_start date NOT NULL CHECK(month_start=date_trunc('month',month_start)::date),
 inventory_target integer NOT NULL DEFAULT 10 CHECK(inventory_target BETWEEN 0 AND 1000),
 weekly_new_properties_target integer DEFAULT 2 CHECK(weekly_new_properties_target BETWEEN 0 AND 1000),
 daily_followups_target integer DEFAULT 10 CHECK(daily_followups_target BETWEEN 0 AND 1000),
 weekly_viewings_target integer DEFAULT 5 CHECK(weekly_viewings_target BETWEEN 0 AND 1000),
 reservations_target integer DEFAULT 2 CHECK(reservations_target BETWEEN 0 AND 1000),
 booking_commission_target numeric(14,3) DEFAULT 4000 CHECK(booking_commission_target>=0 AND booking_commission_target NOT IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
 updated_at timestamptz NOT NULL DEFAULT now(),updated_by uuid REFERENCES public.profiles(id),
 PRIMARY KEY(company_id,branch_key,month_start)
);
CREATE TABLE IF NOT EXISTS crm_repair_private.branch_target_history(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 company_id uuid NOT NULL REFERENCES public.companies(id),branch_key text NOT NULL,month_start date NOT NULL,
 before_data jsonb,after_data jsonb NOT NULL,source text NOT NULL,
 source_employee_id uuid REFERENCES public.profiles(id),actor_id uuid REFERENCES public.profiles(id),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE crm_repair_private.branch_monthly_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_repair_private.branch_target_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_repair_private.branch_monthly_targets,crm_repair_private.branch_target_history FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON SEQUENCE crm_repair_private.branch_target_history_id_seq FROM PUBLIC,anon,authenticated,service_role;

-- Exact approved mapping, including inactive former accounts. Do not guess from
-- a display name, transfer business ownership, merge amounts or replace NULL/0.
-- ON CONFLICT preserves goals subsequently edited through the new branch API.
WITH imported AS (
 INSERT INTO crm_repair_private.branch_monthly_targets(company_id,branch_key,month_start,inventory_target,
  weekly_new_properties_target,daily_followups_target,weekly_viewings_target,reservations_target,booking_commission_target,updated_at)
 SELECT t.company_id,o.branch_key,t.month_start,t.inventory_target,t.weekly_new_properties_target,
  t.daily_followups_target,t.weekly_viewings_target,t.reservations_target,t.booking_commission_target,t.updated_at
 FROM public.employee_monthly_targets t JOIN crm_repair_private.branch_performance_owners o
  ON o.company_id=t.company_id AND o.employee_id=t.employee_id
 ON CONFLICT(company_id,branch_key,month_start) DO NOTHING RETURNING *
)
INSERT INTO crm_repair_private.branch_target_history(company_id,branch_key,month_start,after_data,source,source_employee_id)
SELECT t.company_id,t.branch_key,t.month_start,to_jsonb(t),'approved_employee_target_copy',o.employee_id
FROM imported t JOIN crm_repair_private.branch_performance_owners o USING(company_id,branch_key);

-- Branch totals now use the actual event branch. Keep original stored authors;
-- an unrelated property edit must no longer rewrite them to a named employee.
ALTER TABLE public.properties DISABLE TRIGGER zzzz_property_branch_employee;

CREATE OR REPLACE FUNCTION public.crm_branch_monthly_targets(p_month date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $function$
DECLARE c uuid:=public.my_company();r text:=public.my_role();u uuid:=auth.uid();result jsonb;
BEGIN
 IF c IS NULL OR u IS NULL OR r NOT IN ('owner','manager','agent') THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';END IF;
 IF p_month IS NULL OR p_month<>date_trunc('month',p_month)::date THEN RAISE EXCEPTION 'invalid_target_month' USING ERRCODE='22023';END IF;
 WITH branches AS (
  SELECT x.branch,x.label FROM (VALUES ('muscat','مسقط'),('barka','بركاء')) x(branch,label)
  WHERE r<>'agent' OR crm_repair_private.staff_can_access_branch(c,x.branch)
 ), goals AS (
  SELECT x.branch,x.label,t.updated_at,t.branch_key IS NOT NULL configured,
   CASE WHEN t.branch_key IS NULL THEN 10 ELSE t.inventory_target END inventory,
   CASE WHEN t.branch_key IS NULL THEN 2 ELSE t.weekly_new_properties_target END additions,
   CASE WHEN t.branch_key IS NULL THEN 10 ELSE t.daily_followups_target END followups,
   CASE WHEN t.branch_key IS NULL THEN 5 ELSE t.weekly_viewings_target END viewings,
   CASE WHEN t.branch_key IS NULL THEN 2 ELSE t.reservations_target END bookings,
   CASE WHEN t.branch_key IS NULL THEN 4000 ELSE t.booking_commission_target END commission
  FROM branches x LEFT JOIN crm_repair_private.branch_monthly_targets t
   ON t.company_id=c AND t.branch_key=x.branch AND t.month_start=p_month
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('id',branch,'branch',branch,'branch_key',branch,'name',label,
  'month_start',p_month,'updated_at',updated_at,'configured',configured,
  'goals',jsonb_build_object('inventory',inventory,'new_properties',additions,'followups',followups,'viewings',viewings,'bookings',bookings,'expected_commission',commission),
  'targets',jsonb_build_object('inventory_target',inventory,'weekly_new_properties_target',additions,'daily_followups_target',followups,'weekly_viewings_target',viewings,'reservations_target',bookings,'booking_commission_target',commission)
 ) ORDER BY branch),'[]'::jsonb) INTO result FROM goals;
 RETURN jsonb_build_object('scope','branch','month_start',p_month,'branches',result,'employees',result);
END $function$;

CREATE OR REPLACE FUNCTION public.crm_save_branch_monthly_targets(p_branch text,p_month date,p_targets jsonb,p_expected_updated_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $function$
DECLARE c uuid:=public.my_company();u uuid:=auth.uid();before_row crm_repair_private.branch_monthly_targets;
 after_row crm_repair_private.branch_monthly_targets;before_values jsonb;result jsonb;k text;n numeric;unchanged boolean:=false;
 keys text[]:=ARRAY['inventory_target','weekly_new_properties_target','daily_followups_target','weekly_viewings_target','reservations_target','booking_commission_target'];
BEGIN
 IF c IS NULL OR u IS NULL OR public.my_role() IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'owner_only' USING ERRCODE='42501';END IF;
 IF p_branch IS NULL OR p_branch NOT IN ('muscat','barka') OR p_month IS NULL OR p_month<>date_trunc('month',p_month)::date THEN
  RAISE EXCEPTION 'invalid_branch_target_period' USING ERRCODE='22023';END IF;
 IF jsonb_typeof(p_targets) IS DISTINCT FROM 'object' OR NOT p_targets ?& keys OR (SELECT count(*) FROM jsonb_object_keys(p_targets))<>6 THEN
  RAISE EXCEPTION 'invalid_branch_targets' USING ERRCODE='22023';END IF;
 FOREACH k IN ARRAY keys LOOP
  IF jsonb_typeof(p_targets->k) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'invalid_branch_target_value' USING ERRCODE='22023';END IF;
  n:=(p_targets->>k)::numeric;
  IF n<0 OR n IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
   OR (k<>'booking_commission_target' AND (n<>trunc(n) OR n>1000))
   OR (k='booking_commission_target' AND (n>=100000000000 OR n<>round(n,3))) THEN
   RAISE EXCEPTION 'invalid_branch_target_value' USING ERRCODE='22023';END IF;
 END LOOP;
 -- Lock the branch-period even for a first save, then check the observed version.
 -- Repeating the same values is a no-op and cannot create duplicate history.
 PERFORM pg_advisory_xact_lock(hashtextextended(c::text||':'||p_branch||':'||p_month::text,31));
 SELECT * INTO before_row FROM crm_repair_private.branch_monthly_targets
 WHERE company_id=c AND branch_key=p_branch AND month_start=p_month FOR UPDATE;
 IF FOUND THEN
  before_values:=to_jsonb(before_row)-'company_id'-'branch_key'-'month_start'-'updated_at'-'updated_by';
  unchanged:=before_values=p_targets;
  IF NOT unchanged AND before_row.updated_at IS DISTINCT FROM p_expected_updated_at THEN
   RAISE EXCEPTION 'branch_targets_changed_reload' USING ERRCODE='40001';END IF;
 ELSIF p_expected_updated_at IS NOT NULL THEN
  RAISE EXCEPTION 'branch_targets_changed_reload' USING ERRCODE='40001';
 END IF;
 IF NOT unchanged THEN
  INSERT INTO crm_repair_private.branch_monthly_targets(company_id,branch_key,month_start,inventory_target,
   weekly_new_properties_target,daily_followups_target,weekly_viewings_target,reservations_target,booking_commission_target,updated_by,updated_at)
  VALUES(c,p_branch,p_month,(p_targets->>'inventory_target')::numeric::int,(p_targets->>'weekly_new_properties_target')::numeric::int,
   (p_targets->>'daily_followups_target')::numeric::int,(p_targets->>'weekly_viewings_target')::numeric::int,(p_targets->>'reservations_target')::numeric::int,
   (p_targets->>'booking_commission_target')::numeric,u,clock_timestamp())
  ON CONFLICT(company_id,branch_key,month_start) DO UPDATE SET inventory_target=excluded.inventory_target,
   weekly_new_properties_target=excluded.weekly_new_properties_target,daily_followups_target=excluded.daily_followups_target,
   weekly_viewings_target=excluded.weekly_viewings_target,reservations_target=excluded.reservations_target,
   booking_commission_target=excluded.booking_commission_target,updated_by=excluded.updated_by,updated_at=excluded.updated_at
  RETURNING * INTO after_row;
  INSERT INTO crm_repair_private.branch_target_history(company_id,branch_key,month_start,before_data,after_data,source,actor_id)
  VALUES(c,p_branch,p_month,CASE WHEN before_row.company_id IS NOT NULL THEN to_jsonb(before_row) END,to_jsonb(after_row),'owner_branch_target_save',u);
 END IF;
 SELECT row INTO result FROM jsonb_array_elements(public.crm_branch_monthly_targets(p_month)->'branches') row WHERE row->>'branch_key'=p_branch;
 RETURN result||jsonb_build_object('scope','branch','month_start',p_month,'replayed',unchanged);
END $function$;


CREATE OR REPLACE FUNCTION crm_repair_private.branch_period_metrics(p_from date, p_to date)
 RETURNS TABLE(branch_key text, reservations bigint, active_reservations bigint, cancelled_reservations bigint, expected_commission numeric, unknown_expected_commission bigint, commission_collected numeric, receipt_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE c uuid:=public.my_company();u uuid:=auth.uid();r text:=public.my_role();start_at timestamptz:=p_from::timestamp AT TIME ZONE 'Asia/Muscat';end_at timestamptz:=p_to::timestamp AT TIME ZONE 'Asia/Muscat';
BEGIN
 IF c IS NULL OR u IS NULL OR r NOT IN('owner','manager','agent') OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=u AND company_id=c AND is_active) THEN RAISE EXCEPTION 'performance_not_allowed' USING ERRCODE='42501';END IF;
 IF p_from IS NULL OR p_to IS NULL OR p_to<=p_from THEN RAISE EXCEPTION 'invalid_performance_period' USING ERRCODE='22023';END IF;
 RETURN QUERY WITH allowed AS MATERIALIZED (
  SELECT d.*,coalesce(p.branch_key,cl.lead_route) report_branch
  FROM public.deals d LEFT JOIN public.properties p ON p.id=d.property_id AND p.company_id=d.company_id
  LEFT JOIN public.clients cl ON cl.id=d.client_id AND cl.company_id=d.company_id
  WHERE d.company_id=c AND coalesce(p.branch_key,cl.lead_route) IN ('muscat','barka') AND crm_repair_private.investment_row_allowed(d.company_id,to_jsonb(d))
   AND NOT crm_repair_private.investment_link_is_private(d.company_id,to_jsonb(d))
   AND (r<>'agent' OR (crm_repair_private.staff_can_access_branch(d.company_id,coalesce(p.branch_key,cl.lead_route)) AND (d.client_id IS NULL OR crm_repair_private.can_access_client(d.company_id,d.client_id)) AND (d.request_id IS NULL OR crm_repair_private.can_access_request(d.company_id,d.request_id))))
 ), credits AS (
  SELECT (d.report_branch) emp,
   1::bigint booked,(CASE WHEN d.reservation_cancelled_at IS NULL AND d.stage<>'lost' THEN 1 ELSE 0 END)::bigint active,
   (CASE WHEN d.reservation_cancelled_at IS NOT NULL OR d.stage='lost' THEN 1 ELSE 0 END)::bigint cancelled,
   coalesce(d.expected_company_commission_at_reservation,0) expected,
   (CASE WHEN d.expected_company_commission_at_reservation IS NULL THEN 1 ELSE 0 END)::bigint unknown_amount,0::numeric collected,0::bigint receipts
  FROM allowed d WHERE d.reservation_confirmed_at>=start_at AND d.reservation_confirmed_at<end_at AND nullif(btrim(d.reservation_evidence_note),'') IS NOT NULL AND d.deposit_amount>0
  UNION ALL
  SELECT (d.report_branch),0,0,0,0,0,x.amount,1
  FROM allowed d JOIN crm_repair_private.deal_commission_receipts x ON x.deal_id=d.id AND x.company_id=d.company_id WHERE x.received_on>=p_from AND x.received_on<p_to
  UNION ALL
  SELECT (d.report_branch),0,0,0,0,0,
   coalesce(d.company_commission_received_amount,crm_repair_private.recorded_company_commission((SELECT original FROM public.deals original WHERE original.id=d.id)),0),1
  FROM allowed d WHERE NOT EXISTS(SELECT 1 FROM crm_repair_private.deal_commission_receipts x WHERE x.deal_id=d.id)
   AND d.commission_received_at>=start_at AND d.commission_received_at<end_at
   AND (d.company_commission_received_amount IS NOT NULL OR d.commission_status='received' OR d.stage='commission_collected')
 ) SELECT emp,sum(booked)::bigint,sum(active)::bigint,sum(cancelled)::bigint,sum(expected),sum(unknown_amount)::bigint,sum(collected),sum(receipts)::bigint
 FROM credits GROUP BY emp;
END $function$;

CREATE OR REPLACE FUNCTION public.crm_branch_performance(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_company uuid:=public.my_company(); v_actor uuid:=auth.uid(); v_role text:=public.my_role();
 v_start timestamptz;v_end timestamptz;v_result jsonb;v_inception date;
begin
 if v_company is null or v_actor is null or v_role not in ('owner','manager','agent') then
  raise exception using errcode='42501',message='performance_not_allowed';
 end if;
 -- Company row creation is not the beginning of the historical business ledger.
 select least((c.created_at at time zone 'Asia/Muscat')::date,(
   select min((least(hd.closed_at,hd.reservation_confirmed_at) at time zone 'Asia/Muscat')::date)
   from public.deals hd where (crm_repair_private.investment_row_allowed(hd.company_id,to_jsonb(hd)) and not (v_role='owner' and crm_repair_private.investment_link_is_private(hd.company_id,to_jsonb(hd)))) and hd.company_id=c.id and (hd.stage in('closed','commission_collected') or (hd.reservation_confirmed_at is not null and nullif(btrim(hd.reservation_evidence_note),'') is not null and hd.deposit_amount>0))
    and (v_role<>'agent' or (crm_repair_private.can_access_client(hd.company_id,hd.client_id)
      and (hd.property_id is null or exists(select 1 from public.properties hp where (crm_repair_private.investment_row_allowed(hp.company_id,to_jsonb(hp)) and not (v_role='owner' and crm_repair_private.investment_link_is_private(hp.company_id,to_jsonb(hp)))) and hp.id=hd.property_id and hp.company_id=hd.company_id and crm_repair_private.staff_can_access_branch(hp.company_id,hp.branch_key)))))
 )) into v_inception from public.companies c where c.id=v_company;
 if p_from is null then p_from:=v_inception;end if;
 if p_from is null or p_to is null or p_to<=p_from then
  raise exception using errcode='22023',message='invalid_performance_period';
 end if;
 v_start:=p_from::timestamp at time zone 'Asia/Muscat';
 v_end:=p_to::timestamp at time zone 'Asia/Muscat';
 -- Materialize period messages and conversation authorization once, not once per
 -- employee/message. This preserves human attribution while bounding dashboard work.
 with outbound_candidates as materialized (
  select m.* from public.whatsapp_messages m
  where m.company_id=v_company and m.direction='outbound' and m.actor_type='human'
   and m.message_timestamp>=v_start and m.message_timestamp<v_end
 ), outbound_conversations as materialized (
  select wc.id,wc.company_id,wc.route_key,wc.client_id from public.whatsapp_conversations wc
  where wc.company_id=v_company and exists(select 1 from outbound_candidates m where m.conversation_id=wc.id)
   and crm_repair_private.investment_row_allowed(wc.company_id,to_jsonb(wc))
   and not (v_role='owner' and crm_repair_private.investment_link_is_private(wc.company_id,to_jsonb(wc)))
   and (v_role<>'agent' or crm_repair_private.can_access_whatsapp_conversation(wc.company_id,wc.id))
 ), outbound_credit as materialized (
  select mm.id,mm.company_id,mm.conversation_id,mm.client_id,mm.message_timestamp,mm.reply_to_message_id,
   mm.delivery_status,mm.channel_source,mm.raw_payload,wc.id authorized_conversation_id,wc.client_id conversation_client_id,
   (wc.route_key) employee_id
  from outbound_candidates mm left join outbound_conversations wc on wc.id=mm.conversation_id and wc.company_id=mm.company_id
  where crm_repair_private.investment_row_allowed(mm.company_id,to_jsonb(mm))
   and not (v_role='owner' and crm_repair_private.investment_link_is_private(mm.company_id,to_jsonb(mm)))
   and (v_role<>'agent' or wc.id is not null)
 ), outbound_counts as (select employee_id,count(*) outbound from outbound_credit group by employee_id),
 -- Successful staff messages are a separate, accurately named volume metric.
 -- Keep legacy outbound_messages unchanged for existing consumers.
 staff_messages as materialized (
  select m.id,m.company_id,m.conversation_id,coalesce(m.client_id,m.conversation_client_id) client_id,
   m.message_timestamp,m.reply_to_message_id,m.employee_id
  from outbound_credit m
  where m.authorized_conversation_id is not null
   and lower(coalesce(m.delivery_status,'')) in ('sent','delivered','read')
   and coalesce(m.channel_source,'') !~* '(autom|greeting|away|bot|crm_followup)'
   and coalesce(m.raw_payload->>'source','') !~* '(autom|(^|_)auto(_|$)|greeting|away|bot|followup_optin)'
   and lower(coalesce(m.raw_payload->>'automated','false')) not in ('true','1')
   and lower(coalesce(m.raw_payload->>'is_automated','false')) not in ('true','1')
   and lower(coalesce(m.raw_payload->>'actor_type','')) <> 'automated'
   and (m.client_id is null or m.client_id=m.conversation_client_id)
 ), staff_counts as (select employee_id,count(*) successful_staff_messages from staff_messages group by employee_id),
 -- Use each actual inbound timestamp, not property_inquiries.first_inquiry_at.
 -- Returning clients in this period count once, even across several properties,
 -- requests, messages or conversations. A manually created visit is not evidence.
 period_inbound as materialized (
  select m.* from public.whatsapp_messages m
  where m.company_id=v_company and m.direction='inbound'
   and m.message_timestamp>=v_start and m.message_timestamp<v_end
   and exists(select 1 from public.property_message_attributions a where a.company_id=m.company_id and a.message_id=m.id)
 ), inquiry_conversations as materialized (
  select wc.* from public.whatsapp_conversations wc
  where wc.company_id=v_company and exists(select 1 from period_inbound m where m.conversation_id=wc.id)
   and wc.route_key in ('muscat','barka')
   and crm_repair_private.investment_row_allowed(wc.company_id,to_jsonb(wc))
   and not (v_role='owner' and crm_repair_private.investment_link_is_private(wc.company_id,to_jsonb(wc)))
   and (v_role<>'agent' or crm_repair_private.can_access_whatsapp_conversation(wc.company_id,wc.id))
 ), inquiry_evidence as materialized (
  select distinct m.id message_id,m.company_id,a.property_id,m.whatsapp_message_id,m.client_id,m.conversation_id,m.message_timestamp,
   (wc.route_key) employee_id
  from period_inbound m
  join inquiry_conversations wc on wc.id=m.conversation_id and wc.company_id=m.company_id and wc.client_id=m.client_id
  join public.property_message_attributions a on a.company_id=m.company_id and a.message_id=m.id and a.client_id=m.client_id
  join public.clients c on c.id=m.client_id and c.company_id=m.company_id
  join public.properties p on p.id=a.property_id and p.company_id=a.company_id and p.branch_key=wc.route_key
  left join public.property_inquiries pi on pi.id=a.inquiry_id and pi.company_id=a.company_id and pi.client_id=a.client_id and pi.property_id=a.property_id
  where crm_repair_private.investment_row_allowed(a.company_id,to_jsonb(a))
   and not (v_role='owner' and crm_repair_private.investment_link_is_private(a.company_id,to_jsonb(a)))
   and crm_repair_private.investment_row_allowed(m.company_id,to_jsonb(m))
   and not (v_role='owner' and crm_repair_private.investment_link_is_private(m.company_id,to_jsonb(m)))
   and crm_repair_private.investment_row_allowed(c.company_id,to_jsonb(c))
   and not (v_role='owner' and crm_repair_private.investment_link_is_private(c.company_id,to_jsonb(c)))
   and crm_repair_private.investment_row_allowed(p.company_id,to_jsonb(p))
   and not (v_role='owner' and crm_repair_private.investment_link_is_private(p.company_id,to_jsonb(p)))
   and (pi.id is null or (crm_repair_private.investment_row_allowed(pi.company_id,to_jsonb(pi))
    and not (v_role='owner' and crm_repair_private.investment_link_is_private(pi.company_id,to_jsonb(pi)))))
   and (v_role<>'agent' or (crm_repair_private.can_access_client(c.company_id,c.id)
    and crm_repair_private.staff_can_access_branch(p.company_id,p.branch_key)))
 ), inquiry_client_counts as (
  select i.employee_id,count(distinct i.client_id) inquiry_clients,
   count(distinct (i.client_id,i.property_id)) inquiry_property_pairs,
   count(distinct (i.client_id,i.property_id)) filter(where exists(
    select 1 from public.viewings iv where iv.company_id=i.company_id and iv.client_id=i.client_id and iv.property_id=i.property_id
     and not coalesce(iv.archived,false) and iv.status<>'cancelled'
     and iv.viewing_date>=(i.message_timestamp at time zone 'Asia/Muscat')::date
     and crm_repair_private.investment_row_allowed(iv.company_id,to_jsonb(iv))
     and not crm_repair_private.investment_link_is_private(iv.company_id,to_jsonb(iv))
     and (v_role<>'agent' or crm_repair_private.can_access_client(iv.company_id,iv.client_id))
   )) inquiry_pair_to_visit,
   count(distinct i.client_id) filter(where exists(
    select 1 from staff_messages s where s.employee_id=i.employee_id and s.client_id=i.client_id
     and s.conversation_id=i.conversation_id and s.message_timestamp>=i.message_timestamp
     and (s.reply_to_message_id is null or s.reply_to_message_id=i.whatsapp_message_id or s.reply_to_message_id=i.message_id::text)
   )) replied_inquiry_clients
  from inquiry_evidence i group by i.employee_id
 )
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',e.id,'employee_id',e.id,'branch',e.id,'branch_key',e.id,'name',e.full_name,
   'active_inventory',coalesce(pr.active_inventory,0),
   'new_properties',coalesce(pr.new_properties,0),
   'inquiries',coalesce(i.inquiries,0),
   'inquiry_to_visit',coalesce(i.to_visit,0),
   'visits_booked',coalesce(v.booked,0),'visits_done',coalesce(v.done,0),
   'visit_cohort_total',coalesce(vc.total,0),'visit_cohort_done',coalesce(vc.done,0),
   'visit_cohort_pending',coalesce(vc.pending,0),'visit_cohort_cancelled',coalesce(vc.cancelled,0),
   'visit_to_sale',coalesce(d.with_visit,0),
   'sales',coalesce(d.sales,0),'sales_without_reservation',coalesce(d.without_reservation,0),
   'unknown_company_commission',coalesce(d.unknown_company_commission,0),
   'reservations',coalesce(b.reservations,0),'active_reservations',coalesce(b.active_reservations,0),'cancelled_reservations',coalesce(b.cancelled_reservations,0),
   'expected_commission',case when v_role='owner' or (v_role='agent' and crm_repair_private.staff_can_access_branch(e.company_id,e.id)) then coalesce(b.expected_commission,0) else null end,
   'unknown_expected_commission',coalesce(b.unknown_expected_commission,0),
   'commission_collected',case when v_role='owner' or (v_role='agent' and crm_repair_private.staff_can_access_branch(e.company_id,e.id)) then coalesce(b.commission_collected,0) else null end,'receipt_count',coalesce(b.receipt_count,0),
   'sales_goal_met',((CASE WHEN t.branch_key IS NULL THEN 2 ELSE t.reservations_target END)>0 AND coalesce(b.reservations,0)>=(CASE WHEN t.branch_key IS NULL THEN 2 ELSE t.reservations_target END) OR (CASE WHEN t.branch_key IS NULL THEN 4000 ELSE t.booking_commission_target END)>0 AND coalesce(b.expected_commission,0)>=(CASE WHEN t.branch_key IS NULL THEN 4000 ELSE t.booking_commission_target END)),
   'company_commission',case when v_role='owner' or (v_role='agent' and crm_repair_private.staff_can_access_branch(e.company_id,e.id)) then coalesce(d.company_commission,0) else null end,
   'activities',coalesce(a.activities,0),'followup_clients',coalesce(fc.clients,0),
   'outbound_messages',coalesce(w.outbound,0),
   'inquiry_clients',coalesce(ic.inquiry_clients,0),
   'inquiry_property_pairs',coalesce(ic.inquiry_property_pairs,0),'inquiry_pair_to_visit',coalesce(ic.inquiry_pair_to_visit,0),
   'replied_inquiry_clients',coalesce(ic.replied_inquiry_clients,0),
   'successful_staff_messages',coalesce(sc.successful_staff_messages,0),
   'targets',jsonb_build_object('inventory_target',10,'weekly_new_properties_target',2,'daily_followups_target',10,'weekly_viewings_target',5,'reservations_target',2,'booking_commission_target',4000)||coalesce(to_jsonb(t)-'company_id'-'branch_key'-'updated_by'-'month_start'-'updated_at','{}'::jsonb)
 ) ORDER BY e.id),'[]'::jsonb) into v_result
 from (SELECT v_company company_id,x.branch id,x.label full_name
   FROM (VALUES ('muscat','مسقط'),('barka','بركاء')) x(branch,label)) e
 left join crm_repair_private.branch_period_metrics(p_from,p_to) b on b.branch_key=e.id
 left join crm_repair_private.branch_monthly_targets t on t.company_id=e.company_id and t.branch_key=e.id
   and t.month_start=date_trunc('month',p_from)::date
 left join lateral (
   -- Standing stock belongs to today's branch route, without a creator/date/price
   -- gate. Period additions use the same qualification as the weekly goal; sale
   -- retains addition credit. Historical work attribution keeps its approved date.
   select count(DISTINCT p.id) filter(where p.status='available' and p.branch_key=e.id) active_inventory,
    count(DISTINCT p.id) filter(where p.price>0 and p.created_at>=v_start and p.created_at<v_end
      and (p.branch_key)=e.id) new_properties
   from public.properties p where p.company_id=e.company_id and p.branch_key in('muscat','barka')
    and not coalesce(p.archived,false) and crm_repair_private.investment_row_allowed(p.company_id,to_jsonb(p))
    and not crm_repair_private.investment_link_is_private(p.company_id,to_jsonb(p))
    and (v_role<>'agent' or crm_repair_private.staff_can_access_branch(p.company_id,p.branch_key))
 ) pr on true
 left join lateral (
   select count(*) inquiries,
    count(*) filter(where exists(select 1 from public.viewings vv
      where (crm_repair_private.investment_row_allowed(vv.company_id,to_jsonb(vv)) and not (v_role='owner' and crm_repair_private.investment_link_is_private(vv.company_id,to_jsonb(vv)))) and vv.company_id=pi.company_id and vv.client_id=pi.client_id and vv.property_id=pi.property_id
       and vv.archived=false and vv.status<>'cancelled' and vv.created_at>=pi.first_inquiry_at)) to_visit
   from public.property_inquiries pi
   where (crm_repair_private.investment_row_allowed(pi.company_id,to_jsonb(pi)) and not (v_role='owner' and crm_repair_private.investment_link_is_private(pi.company_id,to_jsonb(pi)))) and pi.company_id=e.company_id and ((select pp.branch_key from public.properties pp where (crm_repair_private.investment_row_allowed(pp.company_id,to_jsonb(pp)) and not (v_role='owner' and crm_repair_private.investment_link_is_private(pp.company_id,to_jsonb(pp)))) and pp.id=pi.property_id and pp.company_id=pi.company_id))=e.id
    and (v_role<>'agent' or (crm_repair_private.can_access_client(pi.company_id,pi.client_id) and exists(select 1 from public.properties pp where (crm_repair_private.investment_row_allowed(pp.company_id,to_jsonb(pp)) and not (v_role='owner' and crm_repair_private.investment_link_is_private(pp.company_id,to_jsonb(pp)))) and pp.id=pi.property_id and pp.company_id=pi.company_id and crm_repair_private.staff_can_access_branch(pp.company_id,pp.branch_key))))
    and pi.has_inbound_inquiry=true and pi.first_inquiry_at>=v_start and pi.first_inquiry_at<v_end
 ) i on true
 left join lateral (
   select count(*) filter(where vv.created_at>=v_start and vv.created_at<v_end and vv.status<>'cancelled') booked,
    count(*) filter(where vv.status='done' and vv.viewing_date>=p_from and vv.viewing_date<p_to) done
   from public.viewings vv where (crm_repair_private.investment_row_allowed(vv.company_id,to_jsonb(vv)) and not (v_role='owner' and crm_repair_private.investment_link_is_private(vv.company_id,to_jsonb(vv)))) and vv.company_id=e.company_id and ((select pp.branch_key from public.properties pp where (crm_repair_private.investment_row_allowed(pp.company_id,to_jsonb(pp)) and not (v_role='owner' and crm_repair_private.investment_link_is_private(pp.company_id,to_jsonb(pp)))) and pp.id=vv.property_id and pp.company_id=vv.company_id))=e.id and vv.archived=false and (v_role<>'agent' or (crm_repair_private.can_access_client(vv.company_id,vv.client_id) and exists(select 1 from public.properties pp where (crm_repair_private.investment_row_allowed(pp.company_id,to_jsonb(pp)) and not (v_role='owner' and crm_repair_private.investment_link_is_private(pp.company_id,to_jsonb(pp)))) and pp.id=vv.property_id and pp.company_id=vv.company_id and crm_repair_private.staff_can_access_branch(pp.company_id,pp.branch_key))))
 ) v on true
 left join lateral (
   -- All visible visit statuses share the same actual appointment-date cohort.
   -- Never subtract creation-date bookings from completed appointment dates.
   select count(DISTINCT vv.id) total,
    count(DISTINCT vv.id) filter(where vv.status='done') done,
    count(DISTINCT vv.id) filter(where vv.status='cancelled') cancelled,
    count(DISTINCT vv.id) filter(where vv.status IS DISTINCT FROM 'done' AND vv.status IS DISTINCT FROM 'cancelled') pending
   from public.viewings vv join public.properties pp on pp.id=vv.property_id and pp.company_id=vv.company_id
   where vv.company_id=e.company_id and not coalesce(vv.archived,false)
    and vv.viewing_date>=p_from and vv.viewing_date<p_to
    and (pp.branch_key)=e.id
    and crm_repair_private.investment_row_allowed(vv.company_id,to_jsonb(vv))
    and not crm_repair_private.investment_link_is_private(vv.company_id,to_jsonb(vv))
    and crm_repair_private.investment_row_allowed(pp.company_id,to_jsonb(pp))
    and not crm_repair_private.investment_link_is_private(pp.company_id,to_jsonb(pp))
    and (v_role<>'agent' or (crm_repair_private.can_access_client(vv.company_id,vv.client_id)
      and crm_repair_private.staff_can_access_branch(pp.company_id,pp.branch_key)))
 ) vc on true
 left join lateral (
   -- A sale belongs to its actual closing period. Count it once when a real
   -- completed visit for the same client/property occurred no later than closing,
   -- including visits from earlier periods. Unknown/historical visits stay unknown.
   select count(*) sales,
    count(*) filter(where exists(
      select 1 from public.viewings sv
      where sv.company_id=dd.company_id and sv.client_id=dd.client_id and sv.property_id=dd.property_id
       and sv.archived=false and sv.status='done'
       and sv.viewing_date<=(dd.closed_at at time zone 'Asia/Muscat')::date
       and (crm_repair_private.investment_row_allowed(sv.company_id,to_jsonb(sv)) and not (v_role='owner' and crm_repair_private.investment_link_is_private(sv.company_id,to_jsonb(sv))))
       and (v_role<>'agent' or (crm_repair_private.can_access_client(sv.company_id,sv.client_id)
        and exists(select 1 from public.properties sp where sp.id=sv.property_id and sp.company_id=sv.company_id
         and (crm_repair_private.investment_row_allowed(sp.company_id,to_jsonb(sp)) and not (v_role='owner' and crm_repair_private.investment_link_is_private(sp.company_id,to_jsonb(sp))))
         and crm_repair_private.staff_can_access_branch(sp.company_id,sp.branch_key))))
    )) with_visit,
    sum(crm_repair_private.recorded_company_commission(dd)) company_commission,
    count(*) filter(where crm_repair_private.recorded_company_commission(dd) IS NULL) unknown_company_commission,
    count(*) filter(where NOT coalesce(dd.reservation_confirmed_at IS NOT NULL
      AND nullif(btrim(dd.reservation_evidence_note),'') IS NOT NULL AND dd.deposit_amount>0,false)) without_reservation
   from public.deals dd where (crm_repair_private.investment_row_allowed(dd.company_id,to_jsonb(dd)) and not (v_role='owner' and crm_repair_private.investment_link_is_private(dd.company_id,to_jsonb(dd)))) and dd.company_id=e.company_id and (coalesce((select pp.branch_key from public.properties pp where (crm_repair_private.investment_row_allowed(pp.company_id,to_jsonb(pp)) and not (v_role='owner' and crm_repair_private.investment_link_is_private(pp.company_id,to_jsonb(pp)))) and pp.id=dd.property_id and pp.company_id=dd.company_id),(select cc.lead_route from public.clients cc where (crm_repair_private.investment_row_allowed(cc.company_id,to_jsonb(cc)) and not (v_role='owner' and crm_repair_private.investment_link_is_private(cc.company_id,to_jsonb(cc)))) and cc.id=dd.client_id and cc.company_id=dd.company_id)))=e.id
     and (v_role<>'agent' or (crm_repair_private.can_access_client(dd.company_id,dd.client_id) and (dd.property_id is null or exists(select 1 from public.properties pp where (crm_repair_private.investment_row_allowed(pp.company_id,to_jsonb(pp)) and not (v_role='owner' and crm_repair_private.investment_link_is_private(pp.company_id,to_jsonb(pp)))) and pp.id=dd.property_id and pp.company_id=dd.company_id and crm_repair_private.staff_can_access_branch(pp.company_id,pp.branch_key)))))
     and dd.stage in('closed','commission_collected') and dd.closed_at>=v_start and dd.closed_at<v_end
 ) d on true
 left join lateral (
   select count(*) activities from public.activities aa where (crm_repair_private.investment_row_allowed(aa.company_id,to_jsonb(aa)) and not (v_role='owner' and crm_repair_private.investment_link_is_private(aa.company_id,to_jsonb(aa)))) and aa.company_id=e.company_id and (coalesce((select pp.branch_key from public.properties pp where (crm_repair_private.investment_row_allowed(pp.company_id,to_jsonb(pp)) and not (v_role='owner' and crm_repair_private.investment_link_is_private(pp.company_id,to_jsonb(pp)))) and pp.id=aa.property_id and pp.company_id=aa.company_id),(select cc.lead_route from public.clients cc where (crm_repair_private.investment_row_allowed(cc.company_id,to_jsonb(cc)) and not (v_role='owner' and crm_repair_private.investment_link_is_private(cc.company_id,to_jsonb(cc)))) and cc.id=aa.client_id and cc.company_id=aa.company_id)))=e.id
    and aa.created_at>=v_start and aa.created_at<v_end and (v_role<>'agent' or (aa.client_id is null or crm_repair_private.can_access_client(aa.company_id,aa.client_id))) and aa.actor_type = 'human' and coalesce(aa.channel,'') <> 'system'
 ) a on true
 left join lateral (
   -- Same source and qualification as the daily employee goal, over this period.
   -- Multiple genuine contacts with one client count once; notes/automation and
   -- outcome-less records are not invented contact evidence.
   select count(DISTINCT aa.client_id) clients
   from public.activities aa join public.clients cl on cl.id=aa.client_id and cl.company_id=aa.company_id
   where aa.company_id=e.company_id and aa.actor_type='human'
    and nullif(btrim(aa.outcome),'') IS NOT NULL and aa.type in('call','followup','meeting','whatsapp','contact','email')
    and coalesce(aa.occurred_at,aa.created_at)>=v_start and coalesce(aa.occurred_at,aa.created_at)<v_end
    and (cl.lead_route)=e.id
    and crm_repair_private.investment_row_allowed(aa.company_id,to_jsonb(aa))
    and not crm_repair_private.investment_link_is_private(aa.company_id,to_jsonb(aa))
    and (v_role<>'agent' or crm_repair_private.can_access_client(cl.company_id,cl.id))
 ) fc on true
 left join outbound_counts w on w.employee_id=e.id
 left join inquiry_client_counts ic on ic.employee_id=e.id
 left join staff_counts sc on sc.employee_id=e.id
 where e.company_id=v_company
  and (v_role in('owner','manager') or crm_repair_private.staff_can_access_branch(e.company_id,e.id));
 return jsonb_build_object('scope','branch','from',p_from,'to',p_to,'branches',v_result,'employees',v_result);
end $function$;

CREATE OR REPLACE FUNCTION public.crm_branch_target_snapshot() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c uuid:=public.my_company();r text:=public.my_role();u uuid:=auth.uid();today date:=(now() AT TIME ZONE 'Asia/Muscat')::date;wk date;mo date;result jsonb;
BEGIN
 IF c IS NULL OR u IS NULL OR r NOT IN ('owner','manager','agent') THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE='42501';END IF;
 wk:=today-extract(dow FROM today)::int;mo:=date_trunc('month',today)::date;
 WITH employees AS (
  SELECT x.branch id,x.label full_name,x.branch
  FROM (VALUES ('muscat','مسقط'),('barka','بركاء')) x(branch,label)
  WHERE r<>'agent' OR crm_repair_private.staff_can_access_branch(c,x.branch)
 ), counts AS (
  SELECT e.*,t.branch_key target_id,t.updated_at,
  CASE WHEN t.branch_key IS NULL THEN 10 ELSE t.inventory_target END inventory_goal,
  CASE WHEN t.branch_key IS NULL THEN 2 ELSE t.weekly_new_properties_target END additions_goal,
  CASE WHEN t.branch_key IS NULL THEN 10 ELSE t.daily_followups_target END followups_goal,
  CASE WHEN t.branch_key IS NULL THEN 5 ELSE t.weekly_viewings_target END viewings_goal,
  CASE WHEN t.branch_key IS NULL THEN 2 ELSE t.reservations_target END bookings_goal,
  CASE WHEN t.branch_key IS NULL THEN 4000 ELSE t.booking_commission_target END commission_goal,
  jsonb_array_length(pr.inventory_property_ids) inventory,jsonb_array_length(pr.new_property_ids) additions,
  pr.inventory_property_ids,pr.new_property_ids,
  (SELECT count(DISTINCT a.client_id) FROM public.activities a JOIN public.clients cl ON cl.id=a.client_id AND cl.company_id=a.company_id
   WHERE a.company_id=c AND (cl.lead_route)=e.id
   AND cl.lead_route=e.branch AND a.actor_type='human' AND nullif(btrim(a.outcome),'') IS NOT NULL AND a.type IN ('call','followup','meeting','whatsapp','contact','email') AND (coalesce(a.occurred_at,a.created_at) AT TIME ZONE 'Asia/Muscat')::date=today
   AND NOT crm_repair_private.investment_link_is_private(c,to_jsonb(a))) followups,
  (SELECT count(DISTINCT v.id) FROM public.viewings v JOIN public.properties p ON p.id=v.property_id AND p.company_id=v.company_id
   WHERE v.company_id=c AND p.branch_key=e.branch AND (p.branch_key)=e.id AND v.status='done' AND NOT coalesce(v.archived,false) AND v.viewing_date BETWEEN wk AND today AND NOT crm_repair_private.investment_link_is_private(c,to_jsonb(v))) viewings,
  coalesce(b.reservations,0) bookings,coalesce(b.active_reservations,0) live_bookings,coalesce(b.cancelled_reservations,0) cancelled_bookings,
  coalesce(b.expected_commission,0) expected_commission,coalesce(b.commission_collected,0) collected_commission
  FROM employees e LEFT JOIN crm_repair_private.branch_monthly_targets t ON t.company_id=c AND t.branch_key=e.id AND t.month_start=mo
  LEFT JOIN LATERAL (
   SELECT coalesce(jsonb_agg(DISTINCT p.id ORDER BY p.id) FILTER(WHERE p.status='available'),'[]'::jsonb) inventory_property_ids,
    coalesce(jsonb_agg(DISTINCT p.id ORDER BY p.id) FILTER(WHERE p.price>0 AND (p.created_at AT TIME ZONE 'Asia/Muscat')::date BETWEEN wk AND today),'[]'::jsonb) new_property_ids
   FROM public.properties p
   WHERE p.company_id=c AND p.branch_key=e.branch AND NOT coalesce(p.archived,false)
    AND crm_repair_private.investment_row_allowed(p.company_id,to_jsonb(p))
    AND NOT crm_repair_private.investment_link_is_private(p.company_id,to_jsonb(p))
  ) pr ON true
  LEFT JOIN crm_repair_private.branch_period_metrics(mo,today+1) b ON b.branch_key=e.id
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'employee_id',id,'name',full_name,'branch',branch,'branch_key',branch,'updated_at',updated_at,'configured',target_id IS NOT NULL,'inventory',inventory,'new_properties',additions,'followups',followups,'viewings',viewings,
  'inventory_property_ids',inventory_property_ids,'new_property_ids',new_property_ids,
  'bookings',bookings,'live_bookings',live_bookings,'cancelled_bookings',cancelled_bookings,
  'expected_commission',CASE WHEN r='owner' OR (r='agent' AND crm_repair_private.staff_can_access_branch(c,branch)) THEN expected_commission END,'collected_commission',CASE WHEN r='owner' OR (r='agent' AND crm_repair_private.staff_can_access_branch(c,branch)) THEN collected_commission END,
  'goals',jsonb_build_object('inventory',inventory_goal,'new_properties',additions_goal,'followups',followups_goal,'viewings',viewings_goal,'bookings',bookings_goal,'expected_commission',commission_goal),
  'sales_goal_met',((bookings_goal>0 AND bookings>=bookings_goal) OR (commission_goal>0 AND expected_commission>=commission_goal))) ORDER BY branch),'[]'::jsonb) INTO result FROM counts;
 RETURN jsonb_build_object('scope','branch','today',today,'week_start',wk,'week_end',wk+6,'month_start',mo,'month_end',(mo+interval '1 month - 1 day')::date,'branches',result,'employees',result);
END $$;

REVOKE ALL ON FUNCTION crm_repair_private.branch_period_metrics(date,date) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.crm_branch_performance(date,date),public.crm_branch_target_snapshot(),public.crm_branch_monthly_targets(date),public.crm_save_branch_monthly_targets(text,date,jsonb,timestamptz) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.crm_branch_performance(date,date),public.crm_branch_target_snapshot(),public.crm_branch_monthly_targets(date),public.crm_save_branch_monthly_targets(text,date,jsonb,timestamptz) TO authenticated;
UPDATE crm_repair_private.audit31_catalog_backup b SET applied_definition=pg_get_functiondef(p.oid),applied_acl=p.proacl,applied_owner=p.proowner
FROM pg_proc p WHERE b.kind IN('function','existing_function') AND p.oid=to_regprocedure(b.identity);
NOTIFY pgrst,'reload schema';
