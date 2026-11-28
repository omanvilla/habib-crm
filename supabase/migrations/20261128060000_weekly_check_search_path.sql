-- SQL168 (weekly check 28 Nov 2026): advisor «function_search_path_mutable» on crm_repair_private.saved_answer_noise.
-- The function only uses built-ins (btrim, length, regexp_replace, ~), which live in pg_catalog and are always found,
-- so an empty search_path changes nothing in its result. Undo: ALTER FUNCTION ... RESET search_path;
ALTER FUNCTION crm_repair_private.saved_answer_noise(text) SET search_path = '';
