# CRM repair release — 2026-09-23

Reviewed SQL changes applied with Supabase migration tooling. These files are not a replayable empty-database bootstrap. Rehearsals ran in transactions followed by rollback.

Apply database security stages01–08, financial access views, Edge support, funnel functions and atomic conversation schema/counters in one transaction; run sequence backfill before cutover guards. Deploy matching Edge functions and frontend. Apply financial base-table lockdown only after the frontend reads through masked access views.

Counter guards allow old in-flight handlers to finish without overwriting the atomic counters. Outbound scheduled automation remains disabled. Bucket file limits are a separate Storage API configuration; policies alone do not enforce actual file size.

Rollback is coordinated: preserve new business rows, send receipts and operation journals; do not restore the old literal cron secret or enable outbound jobs. Original source/catalog and rollback scripts are retained in a private backup.
