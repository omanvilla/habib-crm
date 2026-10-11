-- Restore catalog behavior only after reviewing the private row-repair audit.
-- Do not blindly restore old assignments over subsequent employee work.
-- Private before/after contact/request snapshots remain available for a scoped reversal.
DO $restore$
DECLARE saved record;
BEGIN
 IF (SELECT count(*) FROM crm_repair_private.whatsapp_branch_catalog_backup)<>4
 THEN RAISE EXCEPTION 'Expected four original routing function definitions';END IF;
 FOR saved IN SELECT definition FROM crm_repair_private.whatsapp_branch_catalog_backup ORDER BY object_identity LOOP
   EXECUTE saved.definition;
 END LOOP;
END
$restore$;
-- Keep audit tables and internal helper for evidence; no public access is granted.
