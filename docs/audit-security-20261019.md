# Security and integration delta — 2026-10-19

Read-only follow-up to `comprehensive-audit-20261018.md`. Scope is deliberately a delta check; this report does not relabel the earlier synthetic or transaction-local role tests as real employee browser authentication. No customer rows were written, conversations opened, messages sent, passwords changed, tokens minted, or jobs enabled.

## Verified before release

At approximately 03:51 UTC (07:51 Asia/Muscat), the connected Supabase Management tools returned:

| Check | Observed result | Meaning |
|---|---|---|
| Applied migrations | Latest `20261018142647`, `reservation_period_performance_20261018` | SQL24 applied; SQL25 candidate not yet applied at this checkpoint. |
| Edge inventory | 17 functions, all ACTIVE | Main versions unchanged: webhook37, send15, inbox12, direct-bind11, embedded-signup6, property-ai4, client-ai2. Deployment presence/version is not proof of live message delivery. |
| Anonymous SECURITY DEFINER execute advisories | Six functions | Matches SQL25's planned trigger-only grant removal; see names below. |
| Signed-in SECURITY DEFINER execute advisories | 17 findings including those six | Callable privileged code needs its explicit authorization checks; the advisory alone does not establish a data leak. |
| SECURITY DEFINER view advisories | `crm_properties_access`, `crm_deals_access` | Existing deliberately scoped projections, previously tested to hide financial columns. No change to views was made by this pass. |
| RLS enabled without policies | 20 INFO findings | Primarily private audit/workflow tables plus service-only credential/webhook/runtime tables. Deny-all RLS is intentional; no new permissive policy was added. |
| Leaked-password protection | Disabled | Existing remaining Auth configuration warning. This pass has no Auth configuration mutation capability. |

The six trigger-only functions are `crm_set_request_geography`, `crm_sync_request_assignees`, `exclude_internal_numbers_from_followups`, `process_followup_reply_from_whatsapp`, `sync_followup_delivery_status`, and `sync_property_monitoring_from_marketing_event`. SQL25 is the prepared fix; the release owner must verify effective anonymous/authenticated ACLs after applying it. The pre-release observation is not a claim that the fix is already live.

No additional urgent security defect was established by this delta pass. A later batched catalog/documentation read was interrupted before results were returned; its proposed Storage, cron, Realtime, search-path and log checks are **not counted as completed**. The detailed 18 October evidence and its stated limitations remain the reference for those surfaces.

## Remaining direct-use limits

- Actual manager/employee browser authentication, token expiry/refresh, recovery email, real authenticated Storage upload/download and Realtime delivery remain unverified by this agent.
- Unchanged Edge versions do not establish fresh Meta intake, outbound delivery, token validity, OCR or provider retries. No sends were attempted.
- Follow-up post-release checks should read the six effective ACLs and the owner/Muscat/Barka/disabled target/performance scopes, without opening CRM threads or writing test business records.

## Advisor references

- [Anonymous callable SECURITY DEFINER functions](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)
- [Signed-in callable SECURITY DEFINER functions](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
- [SECURITY DEFINER views](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view)
- [RLS enabled without policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
- [Leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
