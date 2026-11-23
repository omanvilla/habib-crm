-- Rollback of SQL154: «انحجزت» again for every unit of a group, sold or reserved.
DO $do$
DECLARE d text := pg_get_functiondef('crm_repair_private.unit_group_notice(uuid)'::regprocedure); n text;
BEGIN
  IF position('v_verb' IN d) = 0 THEN RAISE NOTICE 'not applied'; RETURN; END IF;
  n := replace(d, E'  v_verb text;\n', '');
  n := replace(n, E'  v_verb := CASE WHEN p.status = ''sold'' THEN ''انباعت'' ELSE ''انحجزت'' END;\n', '');
  n := replace(n, $q$v_verb || ' وحدة ' || v_of$q$, $q$'انحجزت وحدة ' || v_of$q$);
  n := replace(n, $q$v_verb || ' ' || btrim(p.unit_label)$q$, $q$'انحجزت ' || btrim(p.unit_label)$q$);
  IF position('v_verb' IN n) > 0 THEN RAISE EXCEPTION 'unit_group_notice changed since: rollback not applied'; END IF;
  EXECUTE n;
END
$do$;
