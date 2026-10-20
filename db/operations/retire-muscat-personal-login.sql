-- Administrative script; run only after verifying the named target and owner.
-- Required session settings: crm.retirement.{company_id,target_user_id,owner_id,
-- retained_user_id,operation_key}. It has no callable privileged API or credentials.
-- No customer data or stored authors are reassigned/deleted. Auth sessions are
-- expired, not copied as credentials or restored by schema rollback.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $action$
DECLARE company_ constant uuid:=nullif(current_setting('crm.retirement.company_id',true),'')::uuid;
 target_ constant uuid:=nullif(current_setting('crm.retirement.target_user_id',true),'')::uuid;
 owner_ constant uuid:=nullif(current_setting('crm.retirement.owner_id',true),'')::uuid;
 retained_ constant uuid:=nullif(current_setting('crm.retirement.retained_user_id',true),'')::uuid;
 op_ constant text:=nullif(btrim(current_setting('crm.retirement.operation_key',true)),'');
 before_ jsonb;after_ jsonb;at_ timestamptz;changed_ integer;prior_ record;
BEGIN
 IF company_ IS NULL OR target_ IS NULL OR owner_ IS NULL OR retained_ IS NULL OR op_ IS NULL
  OR target_=owner_ OR target_=retained_ OR owner_=retained_ THEN RAISE EXCEPTION 'Retirement parameters are incomplete or invalid';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(op_,32));
 -- Lock the same rows for both first execution and replay. A previous audit key
 -- is an acknowledgment only of the exact identities and completed state below.
 PERFORM 1 FROM public.profiles WHERE id IN(target_,owner_,retained_) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.company_lead_routes WHERE company_id=company_ AND route_key IN('muscat','barka') ORDER BY route_key FOR UPDATE;
 PERFORM 1 FROM auth.users WHERE id=target_ FOR UPDATE;
 PERFORM 1 FROM auth.sessions WHERE user_id=target_ ORDER BY id FOR UPDATE;
 PERFORM 1 FROM auth.refresh_tokens WHERE user_id=target_::text ORDER BY id FOR UPDATE;
 SELECT * INTO prior_ FROM crm_repair_private.audit32_access_changes WHERE operation_key=op_ FOR UPDATE;
 IF FOUND THEN
  IF prior_.company_id IS DISTINCT FROM company_ OR prior_.target_user_id IS DISTINCT FROM target_
   OR prior_.actor_id IS DISTINCT FROM owner_
   OR prior_.before_data#>>'{retained_profile,id}' IS DISTINCT FROM retained_::text THEN
   RAISE EXCEPTION 'Retirement replay refused: operation key belongs to different identities';
  END IF;
  IF EXISTS(SELECT 1 FROM public.profiles WHERE id=target_ AND company_id=company_ AND is_active IS FALSE)
   AND EXISTS(SELECT 1 FROM public.profiles WHERE id=owner_ AND company_id=company_ AND role='owner' AND is_active IS TRUE)
   AND EXISTS(SELECT 1 FROM public.profiles WHERE id=retained_ AND company_id=company_ AND role='agent' AND is_active IS TRUE)
   AND EXISTS(SELECT 1 FROM auth.users WHERE id=target_ AND banned_until>now())
   AND EXISTS(SELECT 1 FROM public.company_lead_routes WHERE company_id=company_ AND route_key='muscat' AND assigned_to=owner_ AND is_active IS TRUE)
   AND EXISTS(SELECT 1 FROM public.company_lead_routes WHERE company_id=company_ AND route_key='barka' AND assigned_to=retained_ AND is_active IS TRUE)
   AND NOT EXISTS(SELECT 1 FROM auth.sessions WHERE user_id=target_ AND (not_after IS NULL OR not_after>now()))
   AND NOT EXISTS(SELECT 1 FROM auth.refresh_tokens WHERE user_id=target_::text AND revoked IS DISTINCT FROM true) THEN RETURN;
  END IF;
  RAISE EXCEPTION 'Retirement replay refused: account, route or session state was changed independently';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=owner_ AND company_id=company_ AND role='owner' AND is_active IS TRUE)
  OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=target_ AND company_id=company_ AND role='agent' AND is_active IS TRUE)
  OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=retained_ AND company_id=company_ AND role='agent' AND is_active IS TRUE)
  OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=target_ AND banned_until IS NULL)
  OR NOT EXISTS(SELECT 1 FROM public.company_lead_routes WHERE company_id=company_ AND route_key='muscat' AND assigned_to=target_ AND is_active IS TRUE)
  OR NOT EXISTS(SELECT 1 FROM public.company_lead_routes WHERE company_id=company_ AND route_key='barka' AND assigned_to=retained_ AND is_active IS TRUE) THEN
  RAISE EXCEPTION 'Retirement precondition changed: inspect target, owner and branch assignments';
 END IF;
 IF to_regprocedure('public.crm_branch_target_snapshot()') IS NULL
  OR NOT EXISTS(SELECT 1 FROM crm_repair_private.branch_monthly_targets WHERE company_id=company_ AND branch_key='muscat') THEN
  RAISE EXCEPTION 'Branch history and approved targets must be migrated before retirement';
 END IF;
 SELECT jsonb_build_object(
  'profile',(SELECT to_jsonb(p) FROM public.profiles p WHERE id=target_),
  'muscat_route',(SELECT to_jsonb(r) FROM public.company_lead_routes r WHERE company_id=company_ AND route_key='muscat'),
  'auth',(SELECT jsonb_build_object('id',id,'banned_until',banned_until,'updated_at',updated_at) FROM auth.users WHERE id=target_),
  'sessions',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'not_after',not_after,'updated_at',updated_at) ORDER BY id),'[]'::jsonb) FROM auth.sessions WHERE user_id=target_),
  'unrevoked_refresh_count',(SELECT count(*) FROM auth.refresh_tokens WHERE user_id=target_::text AND revoked IS DISTINCT FROM true),
  'retained_profile',(SELECT to_jsonb(p) FROM public.profiles p WHERE id=retained_),
  'barka_route',(SELECT to_jsonb(r) FROM public.company_lead_routes r WHERE company_id=company_ AND route_key='barka')
 ) INTO before_;
 at_:=clock_timestamp();
 UPDATE public.company_lead_routes SET assigned_to=owner_,updated_at=at_ WHERE company_id=company_ AND route_key='muscat';
 GET DIAGNOSTICS changed_=ROW_COUNT;IF changed_<>1 THEN RAISE EXCEPTION 'Expected one Muscat route';END IF;
 UPDATE public.profiles SET is_active=false,updated_at=at_ WHERE id=target_ AND company_id=company_;
 GET DIAGNOSTICS changed_=ROW_COUNT;IF changed_<>1 THEN RAISE EXCEPTION 'Expected one retired profile';END IF;
 UPDATE auth.users SET banned_until=at_+interval '100 years',updated_at=at_ WHERE id=target_;
 GET DIAGNOSTICS changed_=ROW_COUNT;IF changed_<>1 THEN RAISE EXCEPTION 'Expected one Auth account';END IF;
 UPDATE auth.sessions SET not_after=least(coalesce(not_after,at_),at_),updated_at=at_ WHERE user_id=target_;
 UPDATE auth.refresh_tokens SET revoked=true,updated_at=at_ WHERE user_id=target_::text AND revoked IS DISTINCT FROM true;
 IF EXISTS(SELECT 1 FROM auth.sessions WHERE user_id=target_ AND (not_after IS NULL OR not_after>at_))
  OR EXISTS(SELECT 1 FROM auth.refresh_tokens WHERE user_id=target_::text AND revoked IS DISTINCT FROM true) THEN
  RAISE EXCEPTION 'Retirement session revocation assertion failed';
 END IF;
 SELECT jsonb_build_object(
  'profile',(SELECT to_jsonb(p) FROM public.profiles p WHERE id=target_),
  'muscat_route',(SELECT to_jsonb(r) FROM public.company_lead_routes r WHERE company_id=company_ AND route_key='muscat'),
  'auth',(SELECT jsonb_build_object('id',id,'banned_until',banned_until,'updated_at',updated_at) FROM auth.users WHERE id=target_),
  'sessions',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'not_after',not_after,'updated_at',updated_at) ORDER BY id),'[]'::jsonb) FROM auth.sessions WHERE user_id=target_),
  'unrevoked_refresh_count',(SELECT count(*) FROM auth.refresh_tokens WHERE user_id=target_::text AND revoked IS DISTINCT FROM true),
  'retained_profile',(SELECT to_jsonb(p) FROM public.profiles p WHERE id=retained_),
  'barka_route',(SELECT to_jsonb(r) FROM public.company_lead_routes r WHERE company_id=company_ AND route_key='barka'),
  'execution_source','owner_requested_admin_sql','executed_db_role',current_user
 ) INTO after_;
 IF before_->'retained_profile' IS DISTINCT FROM after_->'retained_profile'
  OR before_->'barka_route' IS DISTINCT FROM after_->'barka_route'
  OR ((before_->'profile')-'is_active'-'updated_at') IS DISTINCT FROM ((after_->'profile')-'is_active'-'updated_at')
  OR ((before_->'muscat_route')-'assigned_to'-'updated_at') IS DISTINCT FROM ((after_->'muscat_route')-'assigned_to'-'updated_at') THEN
  RAISE EXCEPTION 'Retirement preservation assertion failed';
 END IF;
 INSERT INTO crm_repair_private.audit32_access_changes(operation_key,company_id,target_user_id,before_data,after_data,actor_id,reason,recorded_at)
 VALUES(op_,company_,target_,before_,after_,owner_,'Owner requested retirement of the personal Muscat login; owner handles the branch until a new branch-owned email is supplied.',at_);
END $action$;
COMMIT;
SELECT p.is_active AS retired_profile_active,u.banned_until>now() AS auth_banned,
 (SELECT count(*) FROM auth.sessions s WHERE s.user_id=p.id AND (s.not_after IS NULL OR s.not_after>now())) AS unexpired_sessions,
 (SELECT count(*) FROM auth.refresh_tokens t WHERE t.user_id=p.id::text AND t.revoked IS DISTINCT FROM true) AS unrevoked_refresh_tokens,
 (SELECT count(*) FROM crm_repair_private.audit32_access_changes WHERE operation_key=nullif(btrim(current_setting('crm.retirement.operation_key',true)),'')) AS audit_entries
FROM public.profiles p JOIN auth.users u ON u.id=p.id WHERE p.id=nullif(current_setting('crm.retirement.target_user_id',true),'')::uuid;
