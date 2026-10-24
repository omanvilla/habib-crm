-- SQL44: partner Instagram accounts (e.g. @omanvilla1, the Muscat account that
-- publishes collab posts with @omanvilla). The scheduled worker looks up saved
-- links that are not @omanvilla's own posts in these accounts through Meta
-- business discovery (likes/comments only), or reads full insights when the
-- partner account is itself connected. Owner-only, like the Instagram catalog.

CREATE TABLE IF NOT EXISTS public.instagram_partner_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  username text NOT NULL CHECK (username ~ '^[a-z0-9._]{1,30}$'),
  added_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, username)
);
ALTER TABLE public.instagram_partner_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.instagram_partner_accounts FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON public.instagram_partner_accounts TO authenticated;
GRANT ALL ON public.instagram_partner_accounts TO service_role;

DROP POLICY IF EXISTS instagram_partner_owner_read ON public.instagram_partner_accounts;
CREATE POLICY instagram_partner_owner_read ON public.instagram_partner_accounts FOR SELECT TO authenticated
  USING (company_id = (SELECT public.my_company()) AND (SELECT public.my_role()) = 'owner');
DROP POLICY IF EXISTS instagram_partner_owner_insert ON public.instagram_partner_accounts;
CREATE POLICY instagram_partner_owner_insert ON public.instagram_partner_accounts FOR INSERT TO authenticated
  WITH CHECK (company_id = (SELECT public.my_company()) AND (SELECT public.my_role()) = 'owner');
DROP POLICY IF EXISTS instagram_partner_owner_delete ON public.instagram_partner_accounts;
CREATE POLICY instagram_partner_owner_delete ON public.instagram_partner_accounts FOR DELETE TO authenticated
  USING (company_id = (SELECT public.my_company()) AND (SELECT public.my_role()) = 'owner');

-- Seed the Muscat account named by the owner on 2026-10-24.
INSERT INTO public.instagram_partner_accounts(company_id, username, added_by)
SELECT a.company_id, 'omanvilla1', NULL FROM public.instagram_accounts a WHERE a.instagram_user_id='17841444560608289'
ON CONFLICT (company_id, username) DO NOTHING;

-- Links that only failed because they belong to a partner account become due again.
UPDATE public.property_marketing_events SET last_synced_at=NULL
 WHERE channel='instagram' AND sync_status='error' AND sync_error='instagram_media_not_found_or_not_owned_by_omanvilla';
