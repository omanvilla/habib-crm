-- Rollback of SQL94 (automatic price studies). Stops everything that acts on its own (triggers, functions, the switch) and
-- keeps what was recorded: the two tables stay if they hold rows, and the files in the private bucket are not touched.
-- Redeploy nothing: the edge function price-study answers «forbidden» to nobody but these functions, so it simply goes idle.
SET LOCAL lock_timeout = '10s';

DROP TRIGGER IF EXISTS crm_price_study_on_message ON public.whatsapp_messages;
DROP TRIGGER IF EXISTS crm_price_study_on_handoff ON public.whatsapp_conversations;
DROP FUNCTION IF EXISTS crm_repair_private.price_study_on_message();
DROP FUNCTION IF EXISTS crm_repair_private.price_study_on_handoff();

DROP FUNCTION IF EXISTS public.crm_price_study_decide(uuid, boolean, text, text);
DROP FUNCTION IF EXISTS public.crm_price_studies_pending();
DROP FUNCTION IF EXISTS public.crm_price_study_status(uuid);
DROP FUNCTION IF EXISTS public.crm_price_study_submit(uuid, numeric, numeric, numeric, numeric, numeric, text, text, text);
DROP FUNCTION IF EXISTS public.crm_price_study_chat(uuid);
DROP FUNCTION IF EXISTS public.crm_price_study_documents(uuid);
DROP FUNCTION IF EXISTS public.crm_price_study_queue();
DROP FUNCTION IF EXISTS crm_repair_private.price_study_conversation(uuid);
DROP FUNCTION IF EXISTS crm_repair_private.price_study_kind(text, numeric);
DROP FUNCTION IF EXISTS crm_repair_private.price_study_call(jsonb, integer);

DROP POLICY IF EXISTS crm_price_studies_owner_read ON storage.objects;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.owner_price_study_docs) THEN DROP TABLE public.owner_price_study_docs;
  ELSE RAISE NOTICE 'owner_price_study_docs kept: it holds saved documents'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.owner_price_studies) THEN DROP TABLE public.owner_price_studies;
  ELSE RAISE NOTICE 'owner_price_studies kept: it holds studies'; END IF;
END $$;

ALTER TABLE public.whatsapp_automation_runtime DROP CONSTRAINT IF EXISTS runtime_price_study_send_mode_chk;
ALTER TABLE public.whatsapp_automation_runtime DROP COLUMN IF EXISTS price_study_send_mode;
