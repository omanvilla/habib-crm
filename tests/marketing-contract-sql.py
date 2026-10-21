"""Emit an isolated regression using the exact recorded server normalizer/index.
No connection to a live project, business data, credentials or production DDL.
"""
from pathlib import Path
import re
source=(Path(__file__).resolve().parent/'fixtures/investment-owner-only.sql').read_text()
print('BEGIN;')
print('CREATE TABLE public.property_marketing_events(id uuid PRIMARY KEY, company_id uuid NOT NULL, property_id uuid NOT NULL, channel text, event_type text, url text, link_key text, link_provider text, views integer, published_at timestamptz);')
for name in ['normalize_property_marketing_link','property_link_provider','set_property_marketing_link_identity']:
    match=re.search(r'CREATE OR REPLACE FUNCTION public\.'+name+r'\(.*?\$function\$\s*;',source,re.S)
    assert match,name
    print(match.group(0))
index=re.search(r'^CREATE UNIQUE INDEX property_marketing_link_key_unique .*?;$',source,re.M)
assert index
print(index.group(0))
print('CREATE TRIGGER trg_property_marketing_link_identity BEFORE INSERT OR UPDATE OF url,link_key,link_provider ON public.property_marketing_events FOR EACH ROW EXECUTE FUNCTION public.set_property_marketing_link_identity();')
print(r"""
INSERT INTO property_marketing_events VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000101','instagram','publish','https://www.instagram.com/reel/SyntheticCase123/?utm_source=old',null,null,123,'2026-09-09T06:00:00Z');
DO $$DECLARE old_row jsonb; kind text; constraint_name text; BEGIN
 SELECT to_jsonb(m) INTO old_row FROM property_marketing_events m LIMIT 1;
 IF normalize_property_marketing_link('https://www.instagram.com/p/SyntheticCase123/') IS DISTINCT FROM 'instagram:SyntheticCase123' THEN RAISE EXCEPTION 'alias identity changed';END IF;
 FOREACH kind IN ARRAY ARRAY['publish','update','other'] LOOP
  BEGIN
   INSERT INTO property_marketing_events VALUES(gen_random_uuid(),'00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000102','other',kind,'https://www.instagram.com/p/SyntheticCase123/?different=tracking',null,null,null,'2026-10-20T06:43:00Z');
   RAISE EXCEPTION 'cross-property/channel/event duplicate wrongly accepted';
  EXCEPTION WHEN unique_violation THEN
   GET STACKED DIAGNOSTICS constraint_name=CONSTRAINT_NAME;
   IF constraint_name<>'property_marketing_link_key_unique' THEN RAISE;END IF;
  END;
 END LOOP;
 IF (SELECT to_jsonb(m) FROM property_marketing_events m LIMIT 1) IS DISTINCT FROM old_row THEN RAISE EXCEPTION 'old data changed';END IF;
 -- Shortcodes are case-sensitive and uniqueness is per-company.
 INSERT INTO property_marketing_events VALUES(gen_random_uuid(),'00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000101','instagram','publish','https://www.instagram.com/reel/syntheticCase123/',null,null,null,null);
 INSERT INTO property_marketing_events VALUES(gen_random_uuid(),'00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000102','instagram','publish','https://www.instagram.com/reel/SyntheticCase123/',null,null,null,null);
 IF (SELECT count(*) FROM property_marketing_events)<>3 THEN RAISE EXCEPTION 'unexpected count';END IF;
 IF normalize_property_marketing_link('https://youtu.be/CaseVideo123') IS DISTINCT FROM normalize_property_marketing_link('https://www.youtube.com/watch?v=CaseVideo123&utm_source=test') THEN RAISE EXCEPTION 'YouTube aliases disagree';END IF;
END$$;
SELECT 'PASS: original server key/index reject duplicate across properties and event types, preserve history, keep case and company boundaries' AS result;
ROLLBACK;
""")
