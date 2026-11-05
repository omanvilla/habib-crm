-- SQL59: keep the cover image link of each Instagram video for the review cards. Instagram's links expire, so each
-- scan refreshes them for the newest videos; a new link alone does not change updated_at, which review depends on.
ALTER TABLE public.instagram_media_catalog ADD COLUMN IF NOT EXISTS thumbnail_url text;

CREATE OR REPLACE FUNCTION public.crm_instagram_ingest(p_account uuid, p_lease uuid, p_media jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE a public.instagram_accounts; m jsonb;k text;n integer:=0;
BEGIN
 IF current_setting('role',true)<>'service_role' OR NOT EXISTS(SELECT 1 FROM public.instagram_discovery_state WHERE account_id=p_account AND lease_id=p_lease AND lease_until>now()) THEN RAISE EXCEPTION 'valid_lease_required' USING ERRCODE='42501';END IF;
 SELECT * INTO STRICT a FROM public.instagram_accounts WHERE id=p_account;
 IF jsonb_typeof(p_media)<>'array' OR jsonb_array_length(p_media)>100 THEN RAISE EXCEPTION 'invalid_batch';END IF;
 FOR m IN SELECT * FROM jsonb_array_elements(p_media) LOOP
  k:=public.normalize_property_marketing_link(m->>'permalink');
  IF k IS NULL OR k NOT LIKE 'instagram:%' OR coalesce(m->>'id','')!~'^[0-9]+$' OR nullif(m->>'timestamp','') IS NULL THEN RAISE EXCEPTION 'invalid_media_identity';END IF;
  INSERT INTO public.instagram_media_catalog(company_id,account_id,instagram_media_id,permalink,link_key,caption,media_type,media_product_type,published_at,likes,comments,thumbnail_url)
  VALUES(a.company_id,a.id,m->>'id',m->>'permalink',k,left(coalesce(m->>'caption',''),12000),m->>'media_type',m->>'media_product_type',(m->>'timestamp')::timestamptz,nullif(m->>'like_count','')::bigint,nullif(m->>'comments_count','')::bigint,nullif(m->>'thumbnail_url',''))
  ON CONFLICT(company_id,instagram_media_id) DO UPDATE SET caption=excluded.caption,permalink=excluded.permalink,published_at=excluded.published_at,likes=excluded.likes,comments=excluded.comments,
   thumbnail_url=coalesce(excluded.thumbnail_url,instagram_media_catalog.thumbnail_url),
   state=CASE WHEN instagram_media_catalog.state IN('non_property','needs_review') AND instagram_media_catalog.reviewed_at IS NULL AND instagram_media_catalog.caption IS DISTINCT FROM excluded.caption THEN 'pending' ELSE instagram_media_catalog.state END,
   updated_at=CASE WHEN instagram_media_catalog.caption IS DISTINCT FROM excluded.caption OR instagram_media_catalog.published_at IS DISTINCT FROM excluded.published_at OR instagram_media_catalog.likes IS DISTINCT FROM excluded.likes OR instagram_media_catalog.comments IS DISTINCT FROM excluded.comments THEN now() ELSE instagram_media_catalog.updated_at END
  WHERE instagram_media_catalog.account_id=excluded.account_id AND instagram_media_catalog.link_key=excluded.link_key AND
  (instagram_media_catalog.caption IS DISTINCT FROM excluded.caption OR instagram_media_catalog.published_at IS DISTINCT FROM excluded.published_at OR instagram_media_catalog.likes IS DISTINCT FROM excluded.likes OR instagram_media_catalog.comments IS DISTINCT FROM excluded.comments OR instagram_media_catalog.thumbnail_url IS DISTINCT FROM excluded.thumbnail_url);
  n:=n+1;
 END LOOP;
 RETURN n;
END$function$;
