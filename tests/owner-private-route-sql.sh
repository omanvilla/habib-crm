#!/usr/bin/env bash
# SQL68 acceptance on a throwaway Postgres 16 (synthetic catalog, TEST rows only).
# Needs PGHOST/PGPORT/PGUSER for a disposable server; never point it at Supabase.
set -euo pipefail
cd "$(dirname "$0")/.."
DB=crm_owner_route_test
dropdb --if-exists "$DB"
createdb "$DB"
run() { psql -X -q -1 -d "$DB" -v ON_ERROR_STOP=1 -f "$1"; }
run tests/fixtures/owner-private-route-before.sql
run db/changes/68-owner-private-route.forward.sql
run db/changes/68-owner-private-route.forward.sql   # re-apply is safe
run tests/fixtures/owner-private-route-assert.sql
# Rollback must refuse while owner-line data exists.
if psql -X -q -1 -d "$DB" -v ON_ERROR_STOP=1 -f db/changes/68-owner-private-route.rollback.sql 2>"${TMPDIR:-/tmp}/sql68-rollback.err"; then
  echo "rollback should have refused"; exit 1
fi
grep -q "SQL68 rollback refused" "${TMPDIR:-/tmp}/sql68-rollback.err"
psql -X -q -d "$DB" -v ON_ERROR_STOP=1 -c "
  DELETE FROM public.activities WHERE activity_text LIKE 'TEST owner%';
  DELETE FROM public.whatsapp_messages m USING public.whatsapp_conversations c WHERE c.id=m.conversation_id AND c.route_key='owner';
  DELETE FROM public.whatsapp_conversations WHERE route_key='owner';
  DELETE FROM public.whatsapp_onboarding_events WHERE route_key='owner';
  UPDATE public.company_lead_routes SET is_active=false, meta_phone_number_id=NULL, meta_waba_id=NULL WHERE route_key='owner';"
run db/changes/68-owner-private-route.rollback.sql
run tests/fixtures/owner-private-route-rollback-assert.sql
dropdb "$DB"
echo "SQL68 synthetic acceptance passed"
