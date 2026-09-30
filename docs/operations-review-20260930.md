# CRM operations review — 2026-09-30

## Changes

- Supabase migrations `crm_branch_boundary_and_local_read`, `crm_viewing_implies_property_interest`, `crm_scoped_financial_projection_views`, `crm_employee_period_performance`, `crm_employee_performance_financial_projection_guard`, `crm_performance_count_human_work_only`, and `crm_ai_verified_attribution_audit_method` are applied in project `dmsckqjkcnsfmnzfjczz`.
- Property rows with identifiable wilayat were assigned to Muscat or Barka. One archived/unclear property remains unclassified and owner-visible. RLS and the finance-masked property view now filter by the employee's assigned route. Client and request access is bounded by branch in addition to existing assignment. WhatsApp conversation access follows the physical route, even when stale `assigned_to` points to another employee. Managers and owner retain their existing oversight roles.
- Viewings imply a property interest without asserting an inbound WhatsApp inquiry. Historical non-cancelled visits missing a property interest were backfilled. New visits link interests in the same database transaction. `has_inbound_inquiry=false` distinguishes these records.
- CRM read position is advanced on opening a conversation after messages load. The phone application's read state is independent. The `whatsapp-inbox` Edge Function version 11 uses the access-checked `crm_mark_whatsapp_read` RPC.
- The `whatsapp-webhook` Edge Function version 32 asks AI to identify a specific listing only when the message needs it. It records an automatic match only with high confidence and a corroborating exact code, full title, or unique area and price. Ambiguous specific-listing references enter the existing staff review queue. This does not send a client reply and does not relax outbound test restrictions. It affects new incoming messages; historic ambiguous references stay in the queue.
- The owner team page shows daily, Sunday-to-Saturday weekly, and monthly staff measures. The score is the average of configured positive targets, capped at 100% per measure, and displays target coverage. It is not a bonus formula. Historical unsourced listings remain unattributed. The owner can enter inquiry and completed-visit targets in addition to existing goals.
- Properties are grouped by Muscat/Barka and area with newest listings first; owner clients can be filtered by route. Phone display uses a left-to-right isolated number. The owner CSV distinguishes proven inbound inquiries from visits and uses visit rows for scheduled/completed counts. Instagram performance remains in the Instagram section; unavailable metrics are not treated as zero.

## Verification and limits

- RLS impersonation in rolled-back transactions: Hadeel saw 10 Muscat properties and 189 Muscat conversations; Maram saw 20 Barka properties and 196 Barka conversations; owner saw all 31 properties and all routes. The masked property view was separately checked after its correction.
- Property inquiries increased from 13 to 38. Of these, 26 represent historic visit-derived interests; no non-cancelled visit remains without a client/property interest. Eight have proven inbound evidence.
- The period RPC returned two employees for owner and only Hadeel for Hadeel, with company commission hidden from employee output. The old activity log attributed thousands of machine-generated notes to an employee; the metric now counts only `actor_type=human` outside the system channel.
- 49 existing automated tests pass. Live browser role testing with a separate employee session and a new incoming WhatsApp message remains necessary to verify those end-to-end paths. No customer message was sent.
- Instagram performance showed 10 linked posts, 279,400 stored views, and 172 references pending human review when checked. The stored measurements have different last-sync times, and private-message Webhook ingestion is still disconnected; this review did not claim to complete that separate Meta login workflow.

## Reversal

- Revert the v6 static commit and redeploy prior `whatsapp-inbox` version 10 and `whatsapp-webhook` version 31 for application behavior.
- Supabase migrations are retained in database history. Before reversing branch policies, account for the seven classified property rows, CRM read positions, and 25 added visit-derived interests. Avoid deleting those interests or changing true inbound evidence as a blanket rollback.
