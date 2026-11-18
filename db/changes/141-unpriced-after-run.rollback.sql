-- Rollback of SQL141: re-run the crm_price_study_unpriced_due block of 134-review-20261118.forward.sql, then:
DROP FUNCTION IF EXISTS crm_repair_private.price_study_first_run(timestamptz);
