-- Additive media discovery. Scheduling is enabled separately only after deployment verification.
BEGIN;
CREATE TABLE public.instagram_discovery_state (
 account_id uuid PRIMARY KEY REFERENCES public.instagram_accounts(id),
 company_id uuid NOT NULL REFERENCES public.companies(id),
 enabled boolean NOT NULL DEFAULT false,
 auto_link_enabled boolean NOT NULL DEFAULT false,
 backfill_cursor text,
 backfill_complete boolean NOT NULL DEFAULT false,
 last_full_scan_at timestamptz,
 last_started_at timestamptz,
 last_success_at timestamptz,
 last_error_code text,
 error_count integer NOT NULL DEFAULT 0,
 next_retry_at timestamptz,
 lease_id uuid, lease_until timestamptz,
 last_requested_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.instagram_media_catalog (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES public.companies(id),
 account_id uuid NOT NULL REFERENCES public.instagram_accounts(id),
 instagram_media_id text NOT NULL,
 permalink text NOT NULL,
 link_key text NOT NULL,
 caption text NOT NULL DEFAULT '',
 media_type text NOT NULL,
 media_product_type text,
 published_at timestamptz NOT NULL,
 likes bigint, comments bigint,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','linked','needs_review','non_property')),
 reason_code text NOT NULL DEFAULT 'new_media',
 property_id uuid REFERENCES public.properties(id),
 marketing_event_id uuid REFERENCES public.property_marketing_events(id),
 evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
 reviewed_by uuid REFERENCES public.profiles(id), reviewed_at timestamptz,
 notified_at timestamptz,
 discovered_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(company_id,instagram_media_id), UNIQUE(company_id,link_key)
);
CREATE INDEX instagram_catalog_review_idx ON public.instagram_media_catalog(company_id,state,published_at DESC,id);
CREATE TABLE crm_repair_private.instagram_discovery_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 catalog_id uuid NOT NULL,
 company_id uuid NOT NULL,
 actor_id uuid,
 action text NOT NULL,
 before_data jsonb, after_data jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.instagram_discovery_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instagram_media_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_repair_private.instagram_discovery_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.instagram_discovery_state,public.instagram_media_catalog FROM anon,authenticated;
GRANT SELECT ON public.instagram_discovery_state,public.instagram_media_catalog TO authenticated;
GRANT ALL ON public.instagram_discovery_state,public.instagram_media_catalog TO service_role;
REVOKE ALL ON crm_repair_private.instagram_discovery_audit FROM PUBLIC,anon,authenticated;
CREATE POLICY instagram_discovery_owner_read ON public.instagram_discovery_state FOR SELECT TO authenticated
 USING(company_id=public.my_company() AND public.my_role()='owner');
CREATE POLICY instagram_catalog_owner_read ON public.instagram_media_catalog FOR SELECT TO authenticated
 USING(company_id=public.my_company() AND public.my_role()='owner');

CREATE FUNCTION public.crm_instagram_job_auth(p_secret text) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT current_setting('role',true)='service_role' AND length(p_secret)=64 AND EXISTS(
 SELECT 1 FROM vault.decrypted_secrets WHERE name='crm_instagram_discovery_cron'
 AND extensions.digest(decrypted_secret,'sha256')=extensions.digest(p_secret,'sha256'));
$$;
REVOKE ALL ON FUNCTION public.crm_instagram_job_auth(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_instagram_job_auth(text) TO service_role;

CREATE FUNCTION public.crm_instagram_claim(p_account uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.instagram_discovery_state;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'service_required' USING ERRCODE='42501';END IF;
 UPDATE public.instagram_discovery_state SET lease_id=gen_random_uuid(),lease_until=now()+interval '4 minutes',last_started_at=now(),updated_at=now()
 WHERE account_id=p_account AND enabled AND coalesce(lease_until,'-infinity')<now() AND coalesce(next_retry_at,'-infinity')<=now()
 RETURNING * INTO s;
 RETURN CASE WHEN s.account_id IS NULL THEN NULL ELSE to_jsonb(s) END;
END$$;
REVOKE ALL ON FUNCTION public.crm_instagram_claim(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_instagram_claim(uuid) TO service_role;

CREATE FUNCTION public.crm_instagram_ingest(p_account uuid,p_lease uuid,p_media jsonb) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.instagram_accounts; m jsonb;k text;n integer:=0;
BEGIN
 IF current_setting('role',true)<>'service_role' OR NOT EXISTS(SELECT 1 FROM public.instagram_discovery_state WHERE account_id=p_account AND lease_id=p_lease AND lease_until>now()) THEN RAISE EXCEPTION 'valid_lease_required' USING ERRCODE='42501';END IF;
 SELECT * INTO STRICT a FROM public.instagram_accounts WHERE id=p_account;
 IF jsonb_typeof(p_media)<>'array' OR jsonb_array_length(p_media)>100 THEN RAISE EXCEPTION 'invalid_batch';END IF;
 FOR m IN SELECT * FROM jsonb_array_elements(p_media) LOOP
  k:=public.normalize_property_marketing_link(m->>'permalink');
  IF k IS NULL OR k NOT LIKE 'instagram:%' OR coalesce(m->>'id','')!~'^[0-9]+$' OR nullif(m->>'timestamp','') IS NULL THEN RAISE EXCEPTION 'invalid_media_identity';END IF;
  INSERT INTO public.instagram_media_catalog(company_id,account_id,instagram_media_id,permalink,link_key,caption,media_type,media_product_type,published_at,likes,comments)
  VALUES(a.company_id,a.id,m->>'id',m->>'permalink',k,left(coalesce(m->>'caption',''),12000),m->>'media_type',m->>'media_product_type',(m->>'timestamp')::timestamptz,nullif(m->>'like_count','')::bigint,nullif(m->>'comments_count','')::bigint)
  ON CONFLICT(company_id,instagram_media_id) DO UPDATE SET caption=excluded.caption,permalink=excluded.permalink,published_at=excluded.published_at,likes=excluded.likes,comments=excluded.comments,
   state=CASE WHEN instagram_media_catalog.state IN('non_property','needs_review') AND instagram_media_catalog.reviewed_at IS NULL AND instagram_media_catalog.caption IS DISTINCT FROM excluded.caption THEN 'pending' ELSE instagram_media_catalog.state END,
   updated_at=now()
  WHERE instagram_media_catalog.account_id=excluded.account_id AND instagram_media_catalog.link_key=excluded.link_key AND
  (instagram_media_catalog.caption IS DISTINCT FROM excluded.caption OR instagram_media_catalog.published_at IS DISTINCT FROM excluded.published_at OR instagram_media_catalog.likes IS DISTINCT FROM excluded.likes OR instagram_media_catalog.comments IS DISTINCT FROM excluded.comments);
  n:=n+1;
 END LOOP;
 RETURN n;
END$$;
REVOKE ALL ON FUNCTION public.crm_instagram_ingest(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_instagram_ingest(uuid,uuid,jsonb) TO service_role;

-- Capture the exact function before narrowly fixing historical import's date regression.
CREATE TABLE crm_repair_private.instagram33_catalog_backup AS
 SELECT 'monitoring'::text AS name,pg_get_functiondef('public.sync_property_monitoring_from_marketing_event()'::regprocedure) AS definition;
ALTER TABLE crm_repair_private.instagram33_catalog_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm_repair_private.instagram33_catalog_backup FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.sync_property_monitoring_from_marketing_event() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','pg_temp' AS $$
DECLARE v_at timestamptz:=coalesce(new.published_at,new.created_at,now());
 v_is_instagram boolean:=(new.channel='instagram' OR new.link_provider='instagram' OR public.normalize_property_marketing_link(new.url) LIKE 'instagram:%' OR public.normalize_property_marketing_link(new.url) LIKE 'instagram-share:%');
BEGIN
 IF new.event_type='publish' THEN
  UPDATE public.properties p SET performance_tracking_started_at=v_at,marketing_status='advertised',marketing_review_status='healthy',marketing_reviewed_at=NULL,marketing_review_note=NULL,
   photography_status=CASE WHEN v_is_instagram THEN 'completed' ELSE p.photography_status END,
   photography_reason=CASE WHEN v_is_instagram THEN 'instagram_published' ELSE p.photography_reason END,
   photography_completed_at=CASE WHEN v_is_instagram THEN v_at ELSE p.photography_completed_at END,
   photography_required_at=CASE WHEN v_is_instagram THEN NULL ELSE p.photography_required_at END,updated_at=now()
  WHERE p.id=new.property_id AND p.company_id=new.company_id
   AND (p.performance_tracking_started_at IS NULL OR v_at>p.performance_tracking_started_at);
 END IF;
 RETURN new;
END$$;

CREATE FUNCTION crm_repair_private.instagram_decide(p_id uuid,p_expected timestamptz,p_decision text,p_property uuid,p_property_version timestamptz,p_reason text,p_evidence jsonb,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.instagram_media_catalog; p public.properties; e public.property_marketing_events;
 before_row jsonb; property_before jsonb; fresh boolean:=false;
BEGIN
 SELECT * INTO STRICT c FROM public.instagram_media_catalog WHERE id=p_id FOR UPDATE;
 IF c.updated_at IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'stale_media' USING ERRCODE='40001';END IF;
 IF p_decision NOT IN('link','needs_review','non_property') THEN RAISE EXCEPTION 'invalid_decision';END IF;
 IF p_actor IS NULL THEN
  IF c.reviewed_at IS NOT NULL OR c.state='linked' THEN RETURN jsonb_build_object('state',c.state,'preserved',true);END IF;
  IF p_decision='link' AND NOT EXISTS(SELECT 1 FROM public.instagram_discovery_state WHERE account_id=c.account_id AND auto_link_enabled) THEN RETURN jsonb_build_object('state','pending','preview',true);END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor AND company_id=c.company_id AND role='owner' AND is_active) THEN RAISE EXCEPTION 'owner_required' USING ERRCODE='42501';END IF;
  IF c.state='linked' AND (p_decision<>'link' OR c.property_id IS DISTINCT FROM p_property) THEN RAISE EXCEPTION 'existing_link_requires_separate_review';END IF;
 END IF;
 before_row:=to_jsonb(c);
 IF p_decision='link' THEN
  SELECT * INTO STRICT p FROM public.properties WHERE id=p_property AND company_id=c.company_id FOR UPDATE;
  IF p_actor IS NULL AND p.updated_at IS DISTINCT FROM p_property_version THEN RAISE EXCEPTION 'stale_property' USING ERRCODE='40001';END IF;
  property_before:=to_jsonb(p);
  SELECT * INTO e FROM public.property_marketing_events WHERE company_id=c.company_id AND (link_key=c.link_key OR instagram_media_id=c.instagram_media_id) ORDER BY created_at LIMIT 1;
  IF EXISTS(SELECT 1 FROM public.property_marketing_events WHERE company_id=c.company_id AND (link_key=c.link_key OR instagram_media_id=c.instagram_media_id) AND property_id IS DISTINCT FROM p.id) THEN RAISE EXCEPTION 'existing_link_conflict' USING ERRCODE='23505';END IF;
  IF e.id IS NULL THEN
   BEGIN
    INSERT INTO public.property_marketing_events(company_id,property_id,channel,event_type,published_at,url,created_by,instagram_media_id,auto_sync,sync_status,likes,comments,notes)
    VALUES(c.company_id,p.id,'instagram','publish',c.published_at,c.permalink,p_actor,c.instagram_media_id,true,'pending',c.likes,c.comments,
     CASE WHEN p_actor IS NULL THEN 'ربط تلقائي من Instagram؛ مصدر التحقق محفوظ في سجل الاستيراد.' ELSE 'ربط يدوي معتمد من قائمة مراجعة Instagram.' END)
    RETURNING * INTO e;fresh:=true;
   EXCEPTION WHEN unique_violation THEN
    SELECT * INTO e FROM public.property_marketing_events WHERE company_id=c.company_id AND (link_key=c.link_key OR instagram_media_id=c.instagram_media_id) ORDER BY created_at LIMIT 1;
    IF e.id IS NULL OR EXISTS(SELECT 1 FROM public.property_marketing_events WHERE company_id=c.company_id AND (link_key=c.link_key OR instagram_media_id=c.instagram_media_id) AND property_id IS DISTINCT FROM p.id) THEN RAISE EXCEPTION 'existing_link_conflict' USING ERRCODE='23505';END IF;
   END;
  END IF;
  -- Existing dates, metrics, owners and history are never rewritten by the importer.
  UPDATE public.instagram_media_catalog SET state='linked',property_id=p.id,marketing_event_id=e.id,reason_code=p_reason,evidence=p_evidence,
   reviewed_by=p_actor,reviewed_at=CASE WHEN p_actor IS NOT NULL THEN now() ELSE NULL END,updated_at=now() WHERE id=c.id RETURNING * INTO c;
 ELSE
  UPDATE public.instagram_media_catalog SET state=p_decision,reason_code=p_reason,evidence=p_evidence,reviewed_by=p_actor,
   reviewed_at=CASE WHEN p_actor IS NOT NULL THEN now() ELSE NULL END,updated_at=now() WHERE id=c.id RETURNING * INTO c;
 END IF;
 INSERT INTO crm_repair_private.instagram_discovery_audit(catalog_id,company_id,actor_id,action,before_data,after_data)
 VALUES(c.id,c.company_id,p_actor,p_decision,jsonb_build_object('catalog',before_row,'property',property_before),jsonb_build_object('catalog',to_jsonb(c),'new_marketing_event',fresh,'event_id',e.id));
 RETURN jsonb_build_object('state',c.state,'new_marketing_event',fresh,'event_id',e.id,'property_updated_at',(SELECT updated_at FROM public.properties WHERE id=c.property_id));
END$$;
REVOKE ALL ON FUNCTION crm_repair_private.instagram_decide(uuid,timestamptz,text,uuid,timestamptz,text,jsonb,uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.crm_instagram_auto_decide(p_id uuid,p_expected timestamptz,p_decision text,p_property uuid,p_property_version timestamptz,p_reason text,p_evidence jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'service_required' USING ERRCODE='42501';END IF;
 RETURN crm_repair_private.instagram_decide(p_id,p_expected,p_decision,p_property,p_property_version,p_reason,p_evidence,NULL);
END$$;
REVOKE ALL ON FUNCTION public.crm_instagram_auto_decide(uuid,timestamptz,text,uuid,timestamptz,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_instagram_auto_decide(uuid,timestamptz,text,uuid,timestamptz,text,jsonb) TO service_role;
CREATE FUNCTION public.crm_instagram_review(p_id uuid,p_expected timestamptz,p_decision text,p_property uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF public.my_role() IS DISTINCT FROM 'owner' OR NOT EXISTS(SELECT 1 FROM public.instagram_media_catalog WHERE id=p_id AND company_id=public.my_company()) THEN RAISE EXCEPTION 'owner_required' USING ERRCODE='42501';END IF;
 RETURN crm_repair_private.instagram_decide(p_id,p_expected,p_decision,p_property,NULL,'owner_review','{"source":"crm_review"}'::jsonb,auth.uid());
END$$;
REVOKE ALL ON FUNCTION public.crm_instagram_review(uuid,timestamptz,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_instagram_review(uuid,timestamptz,text,uuid) TO authenticated;

CREATE FUNCTION public.crm_instagram_notify(p_account uuid) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n integer; company uuid; actor record;
BEGIN
 IF current_setting('role',true)<>'service_role' THEN RAISE EXCEPTION 'service_required' USING ERRCODE='42501';END IF;
 SELECT company_id INTO STRICT company FROM public.instagram_discovery_state WHERE account_id=p_account FOR UPDATE;
 WITH marked AS (UPDATE public.instagram_media_catalog SET notified_at=now() WHERE account_id=p_account AND state='needs_review' AND notified_at IS NULL RETURNING id) SELECT count(*) INTO n FROM marked;
 IF n>0 THEN
 FOR actor IN SELECT id FROM public.profiles WHERE company_id=company AND role='owner' AND is_active LOOP
 INSERT INTO public.notifications(user_id,title,body,type,link)
 VALUES(actor.id,'منشورات Instagram تحتاج مراجعتك',n||' منشورات لا يمكن ربطها بعقار واحد بثقة. افتح أداء العقارات لمراجعتها.','instagram_discovery','instagram');
 END LOOP;
 END IF;
 RETURN n;
END$$;
REVOKE ALL ON FUNCTION public.crm_instagram_notify(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.crm_instagram_notify(uuid) TO service_role;

CREATE FUNCTION crm_repair_private.instagram_enqueue() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE request_id bigint; secret text;
BEGIN
 SELECT decrypted_secret INTO STRICT secret FROM vault.decrypted_secrets WHERE name='crm_instagram_discovery_cron';
 SELECT net.http_post(url:='https://dmsckqjkcnsfmnzfjczz.supabase.co/functions/v1/instagram-discovery',headers:=jsonb_build_object('Content-Type','application/json','x-crm-cron',secret),body:='{}'::jsonb,timeout_milliseconds:=180000) INTO request_id;
 RETURN request_id;
END$$;
REVOKE ALL ON FUNCTION crm_repair_private.instagram_enqueue() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.crm_request_instagram_scan() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE company uuid:=public.my_company();
BEGIN
 IF public.my_role() IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'owner_required' USING ERRCODE='42501';END IF;
 UPDATE public.instagram_discovery_state SET last_requested_at=now(),next_retry_at=NULL WHERE company_id=company AND enabled AND coalesce(last_requested_at,'-infinity')<now()-interval '60 seconds';
 IF NOT FOUND THEN RETURN '{"queued":false,"reason":"recent_request_or_disabled"}'::jsonb;END IF;
 PERFORM crm_repair_private.instagram_enqueue();RETURN '{"queued":true}'::jsonb;
END$$;
REVOKE ALL ON FUNCTION public.crm_request_instagram_scan() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.crm_request_instagram_scan() TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
