# Codex handoff — 30 September 2026

Read `AGENTS.md` first. This dated snapshot records completed work and the next verification/repair backlog. Recheck the current repository and live services before making changes. The owner wants implementation to continue from the latest agreement, with a concise Arabic result, rather than repeated audit from scratch.

## Current deployment

- Repository `omanvilla/habib-crm`, `main` at `2be1fcfb413dc17f5110718007aded6507f9b199` when this snapshot was written. Public CRM: `https://omanvilla.github.io/habib-crm/`; live app meta version `20260930-operations-v6a` was verified in an owner browser session.
- Supabase project `dmsckqjkcnsfmnzfjczz`. Applied migrations: `crm_branch_boundary_and_local_read`, `crm_viewing_implies_property_interest`, `crm_scoped_financial_projection_views`, `crm_employee_period_performance`, `crm_employee_performance_financial_projection_guard`, `crm_performance_count_human_work_only`, and `crm_ai_verified_attribution_audit_method`.
- Deployed Edge Functions: `whatsapp-inbox` v11 and `whatsapp-webhook` v32. Frontend changes in `app-base-v15.html`, `crm-operations-v6.js`, `.css`, and `index.html`. See `docs/operations-review-20260930.md` for definitions and reversal notes.

## Verified behavior and numbers at handoff

- Rolled-back impersonation checks: Hadeel (Muscat) saw 10 Muscat properties and 189 Muscat conversations; Maram (Barka) saw 20 Barka properties and 196 Barka conversations; owner saw 31 properties and both routes. The finance-masked property projection was checked separately after fixing its branch leak. One old property without a reliable branch remains owner-visible only. A separate signed-in employee browser walkthrough is still needed.
- 26 non-cancelled historic visits had lacked client/property interest. The visit trigger backfilled them; the inquiry table went from 13 to 38 rows, including 26 visit-derived interests (`has_inbound_inquiry=false`) and eight records with proven inbound evidence. No eligible visit remained without interest at the check. New inbound attribution code is deployed but has not been verified against a fresh real incoming message.
- Owner team view shows period metrics and goal coverage. In the September live view Hadeel showed five proven inquiries, four booked visits, one completed visit, two recorded sales, and one human-documented activity; Maram showed three proven inquiries, one new listing, and zero recorded sales. These numbers are historical source-based snapshots, not necessarily complete credit for human work. Other targets remain unset; the displayed inventory goal is 10. Avoid presenting a partial goal percentage as an overall HR judgment.
- Browser owner walkthrough showed grouped active properties by Muscat/Barka and area, an owner Barka client filter, correctly ordered phone text in a client file, and a WhatsApp conversation whose unread marker disappeared after opening. The phone WhatsApp read state remains independent. The owner CSV logic was changed but a downloaded report has not been manually reconciled row by row.
- 49 existing automated tests passed on the deployed code path; frontend syntax checks passed. There were no customer sends during this audit. Browser console showed only an unrelated browser extension metadata error in the checked pages.
- Instagram section displayed 10 linked posts and 279,400 stored views, with metrics available on eight posts and 172 unmatched references pending review. Some stored metrics were stale as of 23 September. Insights was connected, but Instagram DM webhook/authorization remained disconnected. Do not claim the reel visibility and DM issue fully solved.
- Five scheduled automations were listed and all were disabled at inspection, including the hourly Meta follow-up. No active automation identifiable as the user's “working for two days” activity was found; do not assert its usage source or reactivate follow-up.

## Next work, prioritized

1. Verify the live branch boundary in actual separate Hadeel/Maram sessions, including customers, requests, property detail, WhatsApp inbox, exports, and reports. Fix any path or view that bypasses the route. Keep owner oversight. Check stale Barka conversations assigned to Hadeel without moving client records blindly.
2. Exercise visit creation/edit/cancellation safely and reconcile property interest, pipeline conversion, and owner CSV on a representative record. Check that outbound messages or visit-derived interests are not falsely counted as inbound inquiries.
3. Verify a new inbound listing mention end-to-end with safe controlled input when available, both a unique description without link and an ambiguous one. Inspect the staff review queue/notification. Do not send a customer-facing test message without specific authorization.
4. Review employee targets with Ahmed's actual business goals when supplied; make daily/weekly/monthly score understandable when only some targets are configured. Validate sales attribution and existing activity logs against evidence. Do not invent staff credit or commission.
5. Trace Instagram Insights sync and reel association on the two posts with unavailable views; distinguish permissions/API-unavailable metrics from stale sync, and make visibility clearer inside CRM. DM webhook/reauthorization is a distinct unresolved Meta account task that may need a secure account handoff.
6. Continue the broader CRM walkthrough by risk: property/client create and edit, tasks, deals, owner reports, marketing, archive/restoration, exports, error states, mobile layouts. Recommend removal only with evidence and owner-visible impact; preserve production records.

## Maintenance of this handoff

After a meaningful deployment, update this dated handoff or create a successor with actual versions, tests, and outstanding risks. Keep `AGENTS.md` to current product rules. If a newer user decision supersedes an old one, replace the old rule rather than stacking contradictory instructions.
