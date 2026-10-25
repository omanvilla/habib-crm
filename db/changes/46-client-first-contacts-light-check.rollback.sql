-- Rollback for SQL46: re-run db/changes/45-client-first-contacts-index-order.forward.sql, then:
DROP FUNCTION IF EXISTS crm_repair_private.client_first_whatsapp_inbound(uuid[]);
