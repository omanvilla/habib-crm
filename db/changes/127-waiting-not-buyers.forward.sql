-- SQL127 (18 Nov 2026, Ahmed: «خلّ الشاشة تفلتر اللي يدورون شغل وفيزا تلقائياً»). «المشترين الواقفين» (SQL126) leaves out a
-- chat where, in the last 30 days, the person wrote about a job (وظيفة، CV، HR، «محتاجين موظفة»; not «شاغر»: a vacant house), a visa (also in
-- Urdu: ویزا، نوکری) or money help (دولار، تبرع، صدقة، زكاة، مساعدة مالية). Never for a client with a buyer request or a
-- viewing: on the live data that kept «سناء» (housing and property residency for her son) in the list. Checked on the 17 rows
-- of 18 Nov: 4 leave (job ×2 incl. HR, Urdu visa, a dollar), 13 stay. Only crm_home_attention changes (one condition added).
-- Rollback: 127-waiting-not-buyers.rollback.sql
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION crm_repair_private.asks_job_visa_or_money(p_conversation uuid, p_client uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select not exists (select 1 from public.client_requests q where q.client_id = p_client and q.request_type = 'buyer')
     and not exists (select 1 from public.viewings v where v.client_id = p_client)
     and exists (
       select 1 from public.whatsapp_messages m
        where m.conversation_id = p_conversation and m.direction = 'inbound' and m.message_timestamp > now() - interval '30 days'
          and coalesce(nullif(m.transcript, ''), m.body) ~* '(وظيف|توظيف|محتاجين\s*موظف|تحتاجون\s*موظف|موظف[هة]?\s*[؟?]|فرص[ةه]\s*عمل|[اأ]بغ[ىا]\s*شغل|[اأ]بي\s*شغل|[اأ]دور\s*(على\s*)?شغل|عندكم\s*شغل|السير[ةه]\s*الذاتي|سيرتي|\mcv\M|\mhr\M|\mjobs?\M|vacanc|resume|\mvisa|فيزا|فيز[هة]|تأشير|تاشير|ویزا|ویزہ|نوکری|ملازمت|دولار|تبرع|صدق[ةه]|زكا[ةه]|مساعد[ةه]\s*مالي)')
$function$;
REVOKE ALL ON FUNCTION crm_repair_private.asks_job_visa_or_money(uuid, uuid) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE d text; a text := 'AND NOT EXISTS (SELECT 1 FROM public.owner_leads ol WHERE ol.client_id = w.client_id AND ol.status IN (''open'', ''studied''))';
BEGIN
  d := pg_get_functiondef('public.crm_home_attention()'::regprocedure);
  IF (length(d) - length(replace(d, a, ''))) / length(a) <> 1 THEN RAISE EXCEPTION 'SQL127 refused: crm_home_attention changed'; END IF;
  d := replace(d, a, a || E'\n       AND NOT crm_repair_private.asks_job_visa_or_money(w.id, w.client_id)');
  EXECUTE d;
END $$;
