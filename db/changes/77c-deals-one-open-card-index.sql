-- SQL77c (10 Nov 2026, Ahmed's instruction 1): the hard guards behind «one client + one property = ONE deal». Apply as
-- its own migration (its own transaction) AFTER 77b (and after 76b in the 10 Nov release order): the merges must leave no
-- client with two open cards on one property and no visit with two open cards, and the deferred deposit trigger
-- (crm_require_deposit_reservation) blocks CREATE INDEX in a transaction that already updated deals (55006).
--  * deals_one_open_card_per_client_property: from now on a second open, unmerged card of the same client on the same
--    property fails loudly (23505) whatever path tries it (the deal form's «new deal» without a visit, a manual reopen
--    of a lost card, two visit saves racing), instead of splitting the visit results over two cards. 77's
--    sync_viewing_to_crm never tries: its step 2 takes the client's open card whatever its request. Lost and completed
--    cards are history and stay outside the rule (a returning client after a lost card starts a new journey).
--  * deals_one_open_card_per_viewing: one visit = one open card.
-- Rollback: 77-deals-one-card.rollback.sql drops both indexes with the merged_into_deal_id column.
SET LOCAL lock_timeout = '10s';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.deals
              WHERE client_id IS NOT NULL AND property_id IS NOT NULL AND merged_into_deal_id IS NULL
                AND stage NOT IN ('lost','closed','commission_collected')
              GROUP BY company_id, client_id, property_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'SQL77c refused: a client still has two open cards on one property; apply 77b first';
  END IF;
  IF EXISTS (SELECT 1 FROM public.deals
              WHERE viewing_id IS NOT NULL AND merged_into_deal_id IS NULL AND stage NOT IN ('lost','closed','commission_collected')
              GROUP BY viewing_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'SQL77c refused: a visit still has two open cards; apply 77b first';
  END IF;
END $$;
CREATE UNIQUE INDEX deals_one_open_card_per_client_property ON public.deals(company_id, client_id, property_id) WHERE merged_into_deal_id IS NULL AND stage NOT IN ('lost','closed','commission_collected');
CREATE UNIQUE INDEX deals_one_open_card_per_viewing ON public.deals(viewing_id) WHERE viewing_id IS NOT NULL AND merged_into_deal_id IS NULL AND stage NOT IN ('lost','closed','commission_collected');
