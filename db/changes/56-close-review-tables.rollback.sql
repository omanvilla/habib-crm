-- Rollback for SQL56: back to public, still with RLS on and no grants. The open access is not restored on purpose.
ALTER TABLE crm_repair_private.review_batch4 SET SCHEMA public;
ALTER TABLE crm_repair_private.review_redo SET SCHEMA public;
