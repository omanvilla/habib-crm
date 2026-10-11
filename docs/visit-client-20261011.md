# New Visit client picker — October 11, 2026

Ahmed requested inline client creation from New Visit and all accessible clients loaded automatically instead of a first batch of 50.

## Implementation

- The New Visit form offers `+ عميل جديد`, name and country/phone inputs, and `إضافة العميل واختياره`. This explicitly saves the contact and selects it without resetting property, appointment, attendance, follow-up or notes. Visit save remains separate and uses the existing atomic request/interest workflow.
- Reuse an accessible client with the same normalized phone. Use stable save IDs, block overlapping saves, recover a committed contact after a lost response, and discard stale responses after form/account changes. Hidden or ambiguous collisions give a generic error; no privileged lookup.
- Load every accessible unarchived client automatically through the existing paged reader. The user no longer has to load more clients manually. Search remains available; incomplete reads expose retry rather than claiming all clients loaded.
- Ordinary authenticated Supabase client queries retain existing access controls. Live read-only inspection confirmed the insert/select policies, phone normalization and duplicate trigger contract. No production contact or visit was created for tests. No schema migration is required.
- Bootstrap cache version: `20261011-visit-client-v13`.

## Verification and release

Focused tests cover complete loading beyond 500, failed later pages, stale account responses, inline save/reuse/retry and preserved form values. Synthetic browser checks cover owner, Muscat and Barka with more than 50 client options and inline contact creation followed by visit submission. These are synthetic tests, not actual employee login evidence.

Release status: deployed October 11. Runtime commit `72553a7ac8128e99d41d86301840bdde3f19ae04` was fast-forwarded to `main` after all four jobs passed in [CI run 38122533133](https://github.com/omanvilla/habib-crm/actions/runs/38122533133). Local Node tests: 113 passed, 2 skipped because they require the isolated SQL context; the dedicated CI SQL jobs passed. Local security harness: 26 passed. Synthetic browser checks passed for owner, Muscat and Barka, including Arabic-digit duplicate matching. A first browser attempt correctly rejected an invalid synthetic phone; only the test phone was corrected, with production validation unchanged.

[Pages run 38122660005](https://github.com/omanvilla/habib-crm/actions/runs/38122660005) succeeded. Public HTTP 200 responses matched the candidate source bytes exactly:

| Asset | Bytes | SHA-256 |
|---|---:|---|
| `index.html` | 3244 | `c2e7e2587319ec75d443e4449e98badc3e22e97d37be6bb00d4c50f2bdf4ac4a` |
| `app-base-v15.html` | 738600 | `7635d0de113411943d8c6755b945298e85513ba62e9386f194f683a3d5c56a50` |
| `crm-visit-client.js` | 6723 | `bc57baf7058e1af2eda827074c1a0041b7f9dee16ca7c078ed69af6228d60959` |

Previous production release evidence remains in `release-20261003.md`. Ahmed's live review is pending; silence is not acceptance.
