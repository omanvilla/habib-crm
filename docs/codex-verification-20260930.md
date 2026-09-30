# Codex verification follow-up — 2026-09-30

Read `AGENTS.md` and the original `docs/codex-handoff-20260930.md` first. This follows the existing implementation; it does not replace the product agreement.

## Baseline and actual access

- Baseline `main`: `cde52b91a625b1f71b4da9ae1e04e85ab8185767`, documentation child of `2be1fcf`.
- GitHub Pages workflow `36681733364` completed successfully for that baseline. Bootstrap asset version was `20260930-operations-v6a`.
- Supabase `dmsckqjkcnsfmnzfjczz` was ACTIVE_HEALTHY. Live webhook v32 matched the repository file byte-for-byte; inbox remained v11.
- Available tools: GitHub reads/writes and Supabase management/SQL. No shell, browser, arbitrary HTTP client, actual employee browser sessions, Meta UI, or runtime for the full existing Node suite was available.
- Ahmed explicitly offered permission to sign in as employees. Authorization is granted; lack of a browser tool is the remaining technical blocker. Never request passwords in chat. Employee JWT identities were simulated with transaction-local claims and authenticated database role; these are not actual signed-in browser sessions.

## Implemented and deployed

- `crm_related_branch_boundary_and_cancelled_interest_guard` (20260930071704):
  - Branch-aware private client/request authorization and restrictive policies on visits, deals, appointments, activities, and tasks. The masked deal projection also checks related client/request access.
  - Fixed proven exposure: Hadeel could read three visits for hidden Barka properties; Hadeel/Maram could read 37/364 activities whose clients were hidden by RLS.
  - Fresh cancelled visits no longer create property interests through either the visit sync or appointment-property trigger. Existing history is preserved. A later scheduled visit does not clear completion evidence from another completed visit for the same client/property/request.
- `crm_attribution_branch_guard_and_unavailable_reel_views` (20260930072238):
  - Manual unmatched-message resolution verifies the selected property's branch even inside its security-definer RPC.
  - Employee performance source records are constrained to the employee's accessible branch. Staff outbound count requires a recorded human sender. Owner historical attribution remains visible for review; records are not reassigned.
  - Instagram analytic view returns NULL for unavailable views, including each link, rather than fabricating zero.
- `whatsapp-webhook` v33 ACTIVE: deployed source re-fetched and matched exactly.
  - Corroboration uses full tokens and unique codes/titles; longer codes/prices and duplicate titles cannot corroborate by substring.
  - Arabic grouped prices can corroborate a unique area/price description without a link.
  - An attribution-processing failure queues staff review and an alert; failures to persist that review propagate for retry.
  - No outbound behavior or follow-up scheduling was enabled.
- Frontend bootstrap `20260930-operations-v6b`: UTC calendar arithmetic over the Oman-local date, correct actual month length for target scaling, owner CSV fallback from views to plays, and cancelled-only visits excluded from inferred-interest reporting. GitHub Pages deployment confirmation is tracked in the final repository workflow result.

## Direct verification

- Post-repair authenticated-role checks:
  - Hadeel: 10 Muscat properties, 189 Muscat conversations, six visible visits; zero visible visits with hidden properties and zero activities with hidden clients.
  - Maram: 20 Barka properties, 196 Barka conversations, 23 visible visits; both leak counts zero.
  - Owner: all 31 properties, 32 visits, 43 deals and all 386 conversations including the general route.
  - The 24 Barka conversations with stale assignment to Hadeel remain visible by physical route to Maram and hidden from Hadeel. No client/assignment migration was performed.
  - Financial projections still mask staff-only output; foreign-branch CRM mark-read rejects with `conversation_not_found`.
- Rolled-back synthetic tests:
  - Fresh cancelled visit: zero interests after fix (one before fix), cancellation pipeline record retained.
  - Atomic employee visit creation, idempotent replay, completion, cancellation, one inferred interest, stale-version rejection, and foreign property denial passed.
  - Pending no-link text resolution, foreign-property denial, proven inbound attribution audit, replay deduplication, outbound-message rejection, and no fake marketing URL passed.
  - After tests: 31 properties, 32 visits, 38 interests; zero synthetic clients remain.
- Five new JavaScript regression tests passed in the available JavaScript execution environment with module/file adapters: Oman boundaries including midnight and leap February, correct month target divisor, token/duplicate/Arabic-price corroboration, unique and ambiguous mocked attribution paths, and review write failure propagation. Tests saved in `tests/operations-continuity.test.cjs` for native Node execution later.
- Actual owner export function generated reconciled CSV rows from a representative production database fixture: zero inbound clients, two booked visits, two completed, zero cancelled. This exercised the row-generation logic, not a browser file download.
- Frontend modified script syntax compiled successfully. Supabase compiled and activated deployed TypeScript. The old 49-test result remains historical; the full existing suite was not rerun here.

## Performance evidence and limits

- Owner's historic Hadeel September totals include two closed sales and five inquiries from source assignments. Staff branch-scoped output now shows zero sales and three inquiries. Do not interpret the difference as lost records: old sales/inquiry assignments span branches and need source review before changing credit.
- Maram's stored attribution still gives one sourced active/new property and no recorded sale. Do not infer the author of old activity or phone-app outbound echoes from branch.
- No monthly target rows were present in returned employee data. Inventory default remains 10 per current agreement. Business goals still require Ahmed's actual input.
- Weekly periods crossing two months still use the targets for the starting month in the RPC; review allocation across monthly goal changes before using configured targets for HR judgment.

## Instagram findings

- Ten linked records; eight have stored views totaling 279,400, last successful sync 23 September.
- One unmeasured link has manual status and has never synced. Another has a 29 September failure `instagram_media_not_found_or_not_owned_by_omanvilla`.
- No fresh Graph API sync was executed: an authenticated CRM session/API invocation path was unavailable. The latter error does not alone prove a permissions problem or that the reel is deleted.
- Existing performance UI already explains partial metric coverage. The analytic view now also preserves unavailability.
- Instagram DM webhook/reauthorization remains separate and unverified.

## Remaining work in order

1. In a browser-enabled session, sign in separately as Hadeel, Maram, and owner; verify property/client/request details, inbox, exports/reports, mobile view, logout/account-switch cache isolation, and error states. Current general/unclassified client/request access still follows prior assignment and team rules; investigate branch evidence before changing or moving real records.
2. Verify a newly received WhatsApp message through signed Meta webhook → real AI → persisted attribution/review alert. Current validation combines mocked AI execution and rolled-back database operations; it does not prove the external end-to-end delivery.
3. Download and manually reconcile owner CSV in a browser; add representative cancellation/inbound/repeated-visit cases to the walkthrough.
4. Review historical cross-branch employee attribution and agree positive business targets; resolve cross-month weekly target allocation without inventing credit.
5. Refresh eight stale Instagram metrics and diagnose the two unmeasured reels using an authenticated owner session. Complete secure Meta handoff only if an actual permission challenge is observed.
6. Broader create/edit, deals, tasks, archive/restore, exports and mobile workflows remain partly untested.
7. Security advisor follow-up: the two deliberately finance-masked definer views still trigger the generic [view lint](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view); keep explicit authorization tests. Existing trigger-only RPC grants and Auth password-protection settings need a separate focused review. No blanket privilege changes were made.

## Reversal

Restore the previous webhook v32 source and previous static script/bootstrap if needed. Database changes add policies and replace function/view definitions without deleting production rows. Reversal must selectively restore the original definitions/policies from the baseline and live definitions captured during audit; do not delete interests or move branch records as a blanket rollback.
