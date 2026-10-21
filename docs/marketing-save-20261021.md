# Marketing link save: global identity conflicts

Status: **deployed and verified within the scope below**, 2026-10-21. Frontend `20261021-marketing-v15`, validated/published commit `a4ff233a632aa6529212ecfb6e6990f5c5368e7e`; baseline `0f614a5689387f8be538c653b7b35903c8f2a630`. Runtime introduced in `fec6380254a020c82574f3db12a4193919418f37` and unchanged by the subsequent test-wait correction.

## Proven defect

An owner screenshot showed the generic unacknowledged-save message while adding an Instagram publication. Fresh production PostgreSQL logs returned repeated SQLSTATE23505 for `property_marketing_link_key_unique`. A scoped read confirmed the submitted video already had an older marketing record. No production row was changed, reassigned or removed. Real identifiers, URLs, property names and metrics are intentionally omitted from this public report.

The old preflight checked only the current property, channel and publish event, comparing normalized URL strings. The actual partial unique index is `(company_id, link_key)` for every nonnull key, independent of property/channel/event type. It identifies p/reel aliases by the same case-sensitive shortcode. Recommending another update event with the same indexed URL was therefore incorrect. The fix preserves the existing constraint rather than weakening it or duplicating attribution.

## Repair

- The form calls the existing immutable `normalize_property_marketing_link` RPC as a GET read, then looks up the exact key under unchanged caller RLS. Its authenticated execute grant and protected property-view SELECT grant were checked directly.
- Same-property publication duplicates clearly report that the link already exists, without a second insert or changed date/metrics. Different visible-property duplicates keep the form open and identify the property only through `crm_properties_access`. A hidden conflict stays generic and unnamed; privileged error details are not displayed.
- Feedback persists beside the URL and in a toast, as text rather than HTML. Open/reset removes old feedback. User inputs are preserved on failures, while stale session/property/permission results are ignored.
- A unique-conflict race is re-read by the same server identity. A lost acknowledgment still requires exact operation-ID/payload verification before success. Double-click guards and retry keys remain. Permission and validation failures are differentiated from uncertain network errors.
- No old event is moved, updated or deleted automatically. Duplicate manual metric-update attempts explicitly say the old metrics were not changed and retain the new input. This repair is not a general manual metric editor. Other providers with no database key retain the prior property-specific publication check.

The unique index, RLS, triggers, stored authorship, dates and financial/Deals behavior remain unchanged. Only the saver and release cache version affect production runtime. The CI byte guard confirms base HTML, dedicated Deals and all database/Supabase sources are unchanged. No migration, Edge deployment, provider action, external customer message or production test data was needed.

## Verification

[Final CI39555333020](https://github.com/omanvilla/habib-crm/actions/runs/39555333020) passed both jobs on the published commit:

| Check | Result and boundary |
|---|---|
| Full Node suite/security | Passed, including 15 new focused marketing regressions. Existing PostgreSQL-context Node skips are not misreported as Node execution. |
| Focused regressions | Same/other-property duplicates, p/reel alias, old channel/type variants, immutable history, retained duplicate-update input, concurrent23505, hidden record protection, lost-ack verification/mismatch, new-link date/null views, failure retention, double click, stale context, null-key fallback and text-only title rendering passed. |
| Original SQL identity/index | Exact existing normalizer functions/index extracted from the source fixture executed in isolated PostgreSQL16. Duplicate inserts across property/channel/event types fail against the correct index; original row, shortcode case and company boundary are preserved; YouTube aliases agree. Minimal isolated table, not a fresh real-user RLS journey. |
| Actual index/browser bootstrap | Five focused marketing groups plus eleven workspace and ten design groups passed with synthetic owner/Barka/viewer context where applicable; all three reports contain zero page errors, external requests and production writes. |
| Production record read | Exactly one matching older record remained. Its inspected identity, property association, publication/creation dates, views and sync settings matched the initial read. No production write was performed. |

The synthetic SDK now models the actual company-wide identity index; the earlier UI-only fixture had missed this contract. Local offline-document tests are distinct from CI's actual index/server bootstrap. Initial CI failed in a test predicate that referenced `currentProfile` before asynchronous bootstrap created it; guarding existence fixed the test without changing application bytes or weakening assertions. Final CI artifact `marketing-save-verification`, ID `12325846308`, retains the three reports and synthetic screenshots. These are not real customer screenshots.

## Publication

[Pages39555585249](https://github.com/omanvilla/habib-crm/actions/runs/39555585249) successfully published the validated commit after an expected-head fast-forward. [Public verification39555753561](https://github.com/omanvilla/habib-crm/actions/runs/39555753561) independently fetched the actual production root and all linked runtime assets at **2026-10-21 06:29:53 UTC**: **24 HTTP200 responses, all SHA256-identical**, exact version `20261021-marketing-v15`.

A fresh empty production Chromium session loaded the visible sign-in form, new-version saver/script and unchanged retired-DM/template absence. It observed zero page errors, failed requests or business API attempts. No credentials, login, customer data read/write or messages were used. Artifact `marketing-v15-public-verification`, ID `12325616633`, retains hashes and startup evidence. The verification branch `codex/marketing-public-verification-20261021` is one-time/read-only, not a recurring monitor.

## Limits and recovery

No new authenticated production save or physical-device test was performed; the form writes were tested with isolated synthetic data. Existing provider metrics/OAuth, Storage/Realtime, auth-lifecycle and physical-restore limits remain. A duplicate already linked to another property requires an explicit decision about the correct attribution; this release does not guess or transfer it. Rollback is the prior v14 frontend; no database rollback or data cleanup is needed.
