# Marketing link save: global identity conflicts

Status: release candidate. Based on main `0f614a5689387f8be538c653b7b35903c8f2a630`. Proposed frontend `20261021-marketing-v15`. Final CI and production verification are required before a deployment claim.

## Proven defect

An owner screenshot showed the generic unacknowledged-save message while adding an Instagram publication. Fresh production PostgreSQL logs returned repeated SQLSTATE23505 for `property_marketing_link_key_unique`. A scoped read confirmed that the submitted video already had an older marketing record. No production row was changed, reassigned or removed. Real identifiers, URLs, property names and metrics are intentionally omitted from this public report.

The original preflight checked only the current property, channel and publish event, comparing normalized URL strings. The real partial unique index is `(company_id, link_key)` for every nonnull key, independent of property, channel and event type. It also identifies p/reel aliases by the same case-sensitive shortcode. Recommending another update event for the same indexed URL was therefore incorrect.

## Targeted repair

The form calls the existing immutable `normalize_property_marketing_link` RPC as a read, then looks up the exact key under the caller's unchanged RLS. Its execute grant and protected property-view SELECT grant were checked directly. Same-property publication duplicates return a clear informational result without another insert or overwriting the old date/metrics. Other visible-property duplicates keep the form open and identify the property only through `crm_properties_access`. A hidden conflict remains generic and unnamed. Feedback is persistent next to the URL as well as a toast, inserted as text, and cleared on open/session reset.

A unique-conflict race is re-read by the same key. A lost insert acknowledgment still requires exact operation-ID/payload verification before reporting success. Permission and input failures have distinct messages; inputs are retained and double-click guards remain. No old record is moved or updated automatically. Duplicate metric-update attempts explicitly say the old metrics were not changed and keep the new input; this fix does not implement a general manual metric editor. Non-indexed providers retain the previous property-specific publication check.

The fix preserves the global unique index, RLS, all triggers, stored attribution and business dates. No new SQL migration, privilege grant, provider request, customer message or backend change is needed. Main interface design, list behavior, Deals and financial workflows are unchanged.

## Tests

Fifteen focused Node regressions pass locally: cross-property duplicates, aliases and old channel/type variants, same-property reuse, duplicate metric input, concurrent23505, hidden conflicts, exact lost-ack recovery, mismatch failure, new-link Muscat date/null views, lookup errors, permission failure, double clicks, stale session/property/role, non-indexed fallback and text-only rendering.

The synthetic SDK now models the observed normalizer and company-wide index, correcting the earlier UI fixture blind spot. Five focused browser scenarios and the eleven existing workspace scenario groups pass locally in offline Chromium with no external requests/page errors/production writes. These local results are separate from a real signed-in production journey. The release gate will run the actual index/server bootstrap and the unchanged existing design/security/Node suites, plus the original server normalizer/index on isolated PostgreSQL16.

No production test record is created. Publication evidence and remaining limitations will be appended after verification. Rollback is frontend-only; do not drop the unique index or rewrite historical marketing data.
