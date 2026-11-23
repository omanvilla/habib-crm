-- SQL154 (23 Nov 2026, Ahmed: «ايوا سوي كل اللي قلت عليه», from the reply audit of 22 Nov, هيثم الحوسني 2a8827ed):
-- the group sentence of R38 always said «انحجزت وحدة منها والمتبقي …», also when that unit was sold (Radwan 69-1 is sold and
-- archived since 11 Nov). It now says «انباعت» for a sold unit and «انحجزت» for a reserved one. The same sentence feeds the reply
-- agent and the sold / reserved notices. Nothing else in the function changes: the live body is edited in place and every edit
-- is checked before it is applied. Rollback: 154-unit-sold-word.rollback.sql
DO $do$
DECLARE d text := pg_get_functiondef('crm_repair_private.unit_group_notice(uuid)'::regprocedure); n text;
BEGIN
  IF position('v_verb' IN d) > 0 THEN RAISE NOTICE 'already applied'; RETURN; END IF;
  n := replace(d, E'  v_identical boolean;\n', E'  v_identical boolean;\n  v_verb text;\n');
  n := replace(n, E'  IF NOT FOUND THEN RETURN NULL; END IF;\n', E'  IF NOT FOUND THEN RETURN NULL; END IF;\n  v_verb := CASE WHEN p.status = ''sold'' THEN ''انباعت'' ELSE ''انحجزت'' END;\n');
  n := replace(n, $q$'انحجزت وحدة ' || v_of$q$, $q$v_verb || ' وحدة ' || v_of$q$);
  n := replace(n, $q$'انحجزت ' || btrim(p.unit_label)$q$, $q$v_verb || ' ' || btrim(p.unit_label)$q$);
  IF (length(n) - length(replace(n, 'v_verb', ''))) / length('v_verb') <> 5 OR position($q$'انحجزت وحدة '$q$ IN n) > 0 THEN
    RAISE EXCEPTION 'unit_group_notice changed since: edits not applied';
  END IF;
  EXECUTE n;
END
$do$;
