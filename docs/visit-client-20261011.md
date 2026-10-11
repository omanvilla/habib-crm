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

Release status: prepared; record CI and Pages evidence after publication. Existing production release evidence remains in `release-20261003.md`.
