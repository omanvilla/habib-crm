-- SQL115 (17 Nov 2026, Ahmed): automatic copy of deals from the CRM to two Google Sheets («تم البيع والدخل» tab 2026 and
-- «النظام المالي - أحمد» tab «العمولات»). The CRM is the source and is only READ: nothing here writes to deals, properties,
-- owners or clients. Only adds: three sheet_sync_* tables, one read function for the edge function, a lease, and a cron
-- that calls the sheet-sync edge function every 5 minutes while sheet_sync_config.mode is not 'off' (it starts 'off').
SET LOCAL lock_timeout = '10s';

-- one row per deal written to (or adopted from) the sheets; the row numbers are where that deal lives
CREATE TABLE IF NOT EXISTS public.sheet_sync_rows (
  deal_id uuid PRIMARY KEY REFERENCES public.deals(id) ON DELETE RESTRICT,
  sales_row integer,
  finance_row integer,
  last_hash text,
  last_synced_at timestamptz,
  status text NOT NULL DEFAULT 'synced' CHECK (status IN ('adopted', 'synced', 'error', 'skipped')),
  -- what the sheets held for this deal at the last sync (the state the next change is compared with)
  last_snapshot jsonb,
  -- a check before every write that the row is still this deal (owner phone in T, the text in C)
  sales_key text,
  finance_key text,
  sales_spreadsheet_id text,
  finance_spreadsheet_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sheet_sync_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id uuid NOT NULL,
  deal_id uuid,
  level text NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  action text NOT NULL,
  message text,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sheet_sync_log_created_idx ON public.sheet_sync_log (created_at DESC);

-- one row. mode: off (nothing runs), dry_run (reads and logs the intended writes), live (writes the sheets)
CREATE TABLE IF NOT EXISTS public.sheet_sync_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  mode text NOT NULL DEFAULT 'off' CHECK (mode IN ('off', 'dry_run', 'live')),
  sales_spreadsheet_id text,
  finance_spreadsheet_id text,
  finance_tab text NOT NULL DEFAULT 'العمولات',
  sales_tabs text[] NOT NULL DEFAULT ARRAY['2026'],
  -- deals sold from this day on get new rows; older ones are only adopted (never written as new rows)
  create_from date NOT NULL DEFAULT DATE '2026-11-18',
  -- a cancelled reservation: 'note_only' keeps K and P (the totals still count it) until Ahmed decides
  cancel_totals_mode text NOT NULL DEFAULT 'note_only' CHECK (cancel_totals_mode IN ('note_only', 'clear_k_p')),
  owner_user_id uuid,
  lease_until timestamptz,
  last_run_at timestamptz,
  last_cursor timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.sheet_sync_config (id, owner_user_id) VALUES (true, 'ec2aec23-f5c8-4b79-8cf8-7435c721f092')
ON CONFLICT (id) DO NOTHING;

-- only the edge function (service role) reads or writes these; no account in the app sees them
ALTER TABLE public.sheet_sync_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sheet_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sheet_sync_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sheet_sync_rows, public.sheet_sync_log, public.sheet_sync_config FROM PUBLIC, anon, authenticated;

-- the deals the sync looks at: sold (reserved, or received with no reservation) from p_from on, or already linked
CREATE OR REPLACE FUNCTION public.crm_sheet_sync_deals(p_from date)
RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $f$
  SELECT jsonb_build_object(
    'id', d.id, 'stage', d.stage, 'deal_value', d.deal_value, 'deposit_amount', d.deposit_amount,
    'bank_financing', d.bank_financing, 'commission_total', d.commission_total, 'company_share', d.company_share,
    'commission_status', d.commission_status, 'employee_commission_percent', d.employee_commission_percent,
    'reservation_confirmed_at', d.reservation_confirmed_at, 'reservation_cancelled_at', d.reservation_cancelled_at,
    'reservation_cancellation_reason', d.reservation_cancellation_reason, 'lost_at', d.lost_at,
    'lost_reason_note', d.lost_reason_note, 'commission_received_at', d.commission_received_at,
    'company_commission_received_amount', d.company_commission_received_amount, 'updated_at', d.updated_at,
    'property_type', p.type, 'area', p.area, 'wilayat', p.wilayat, 'price', p.price,
    'property_created_at', p.created_at, 'owner_name', o.name, 'owner_phone', o.phone,
    'buyer_name', c.name, 'buyer_phone', c.phone, 'agent_name', pr.full_name)
  FROM public.deals d
  LEFT JOIN public.properties p ON p.id = d.property_id
  LEFT JOIN public.owners o ON o.id = p.owner_id
  LEFT JOIN public.clients c ON c.id = d.client_id
  LEFT JOIN public.profiles pr ON pr.id = d.agent_id
  WHERE d.merged_into_deal_id IS NULL
    AND (coalesce(d.reservation_confirmed_at, d.commission_received_at) >= (p_from::timestamp AT TIME ZONE 'Asia/Muscat')
         OR EXISTS (SELECT 1 FROM public.sheet_sync_rows s WHERE s.deal_id = d.id))
$f$;
REVOKE ALL ON FUNCTION public.crm_sheet_sync_deals(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_sheet_sync_deals(date) TO service_role;

-- one run at a time: a 4 minute lease (a run that dies frees it by itself)
CREATE OR REPLACE FUNCTION public.crm_sheet_sync_lease(p_take boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $f$
DECLARE n integer;
BEGIN
  IF p_take THEN
    UPDATE public.sheet_sync_config SET lease_until = now() + interval '4 minutes'
     WHERE id AND (lease_until IS NULL OR lease_until < now());
  ELSE
    UPDATE public.sheet_sync_config SET lease_until = NULL, last_run_at = now() WHERE id;
  END IF;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 1;
END $f$;
REVOKE ALL ON FUNCTION public.crm_sheet_sync_lease(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_sheet_sync_lease(boolean) TO service_role;

CREATE OR REPLACE FUNCTION crm_repair_private.sheet_sync_call(p_body jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $f$
BEGIN
  PERFORM net.http_post(
    url := 'https://dmsckqjkcnsfmnzfjczz.supabase.co/functions/v1/sheet-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-crm-agent',
                 (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'crm_reply_agent')),
    body := p_body,
    timeout_milliseconds := 120000);
END $f$;
REVOKE ALL ON FUNCTION crm_repair_private.sheet_sync_call(jsonb) FROM PUBLIC, anon, authenticated;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sheet_sync_every_5_min') THEN PERFORM cron.unschedule('sheet_sync_every_5_min'); END IF;
END $$;
SELECT cron.schedule('sheet_sync_every_5_min', '*/5 * * * *', $job$
  select crm_repair_private.sheet_sync_call('{"action":"run"}'::jsonb)
   where exists (select 1 from public.sheet_sync_config where id and mode <> 'off');
$job$);
