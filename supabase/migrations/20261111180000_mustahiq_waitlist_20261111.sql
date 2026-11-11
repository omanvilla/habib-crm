-- SQL87 (11 Nov 2026, Ahmed): the «المستحقين» sales of Sultan Haitham City are stopped (first phase sold out). Clients who ask
-- go on a waiting list so they can be messaged as soon as new units open. The reply agent adds them (R31, mustahiq_waitlist);
-- the list shows on «المشاريع الاستثمارية» for the owner and staff, who can mark a client as told («تم التواصل»).
-- The owner's private line never lands here (reply agent check). Rollback: 87-mustahiq-waitlist.rollback.sql
SET LOCAL lock_timeout = '10s';

CREATE TABLE IF NOT EXISTS public.mustahiq_waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.whatsapp_conversations(id) ON DELETE SET NULL,
  route_key text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_asked_at timestamptz NOT NULL DEFAULT now(),
  contacted_at timestamptz,
  contacted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  UNIQUE (company_id, client_id)
);
CREATE INDEX IF NOT EXISTS mustahiq_waitlist_open_idx ON public.mustahiq_waitlist(company_id, contacted_at, last_asked_at DESC);

ALTER TABLE public.mustahiq_waitlist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mustahiq_waitlist_read ON public.mustahiq_waitlist;
CREATE POLICY mustahiq_waitlist_read ON public.mustahiq_waitlist FOR SELECT TO authenticated
  USING (company_id = (SELECT public.my_company()) AND (SELECT public.my_role()) IN ('owner','manager','agent','viewer')
         AND route_key IS DISTINCT FROM 'owner');
DROP POLICY IF EXISTS mustahiq_waitlist_update ON public.mustahiq_waitlist;
CREATE POLICY mustahiq_waitlist_update ON public.mustahiq_waitlist FOR UPDATE TO authenticated
  USING (company_id = (SELECT public.my_company()) AND (SELECT public.my_role()) IN ('owner','manager','agent') AND route_key IS DISTINCT FROM 'owner')
  WITH CHECK (company_id = (SELECT public.my_company()) AND (SELECT public.my_role()) IN ('owner','manager','agent') AND route_key IS DISTINCT FROM 'owner');

REVOKE ALL ON public.mustahiq_waitlist FROM anon;
GRANT SELECT, UPDATE (contacted_at, contacted_by) ON public.mustahiq_waitlist TO authenticated;

-- clients who already asked about «المستحقين» on the Muscat or Barka line (5 on 11 Nov 2026) start on the list
INSERT INTO public.mustahiq_waitlist (company_id, client_id, conversation_id, route_key, note, created_at, last_asked_at)
SELECT DISTINCT ON (m.company_id, m.client_id) m.company_id, m.client_id, m.conversation_id, c.route_key,
       left(coalesce(m.transcript, m.body), 300), min(m.message_timestamp) OVER (PARTITION BY m.company_id, m.client_id), m.message_timestamp
  FROM public.whatsapp_messages m JOIN public.whatsapp_conversations c ON c.id = m.conversation_id
 WHERE m.direction = 'inbound' AND m.client_id IS NOT NULL AND c.route_key IN ('muscat', 'barka')
   AND coalesce(m.transcript, m.body, '') ~ 'مستحق'
 ORDER BY m.company_id, m.client_id, m.message_timestamp DESC
ON CONFLICT (company_id, client_id) DO NOTHING;
