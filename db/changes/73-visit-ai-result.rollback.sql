-- Rollback of SQL73. Results the AI saved stay (they are real visit results); they carry an «[الذكاء الاصطناعي]» line in notes.
ALTER TABLE public.viewings DROP COLUMN IF EXISTS ai_checked_at;
