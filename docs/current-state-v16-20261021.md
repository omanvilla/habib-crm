# Habib CRM — current state

Updated 2026-10-21. Read `AGENTS.md` and the detailed operating rules it references. Previous v15 publication, v14 audits, financial definitions, accounts and unresolved limitations remain in [the v15 archive](current-state-v15-20261021.md).

## Deployed: native Instagram publication discovery

Runtime **`20261021-instagram-v16`**, validated frontend commit **`4bbe7a71b70dd1e95367a9d8a85053c71d79b313`**, is deployed from main. [CI39563716563](https://github.com/omanvilla/habib-crm/actions/runs/39563716563) passed the UI/security gate and real PostgreSQL acceptance. [Pages39564209437](https://github.com/omanvilla/habib-crm/actions/runs/39564209437) succeeded. [Independent public verification39564712357](https://github.com/omanvilla/habib-crm/actions/runs/39564712357) found all **26 runtime files byte-identical** at07:49:36UTC and a clean unauthenticated startup. Later documentation/migration-alias commits do not change runtime bytes.

SQL33 **`20261021074249`**, `instagram_discovery_20261021`, is applied. `db/changes/33-instagram-discovery.forward.sql` and its ledger-named Supabase migration file contain the same tested SQL. Edge **`instagram-discovery` version2** is active; runtime code label `instagram-discovery-v1`. Version1 of that Edge was a temporary authenticated read-only capability probe and was replaced before scheduling. No other Edge function was redeployed.

Native cron **job2**, `habib_instagram_media_discovery`, runs **`*/5 * * * *`** and enqueues the worker through a Vault-protected header. The old customer WhatsApp follow-up job1 remains disabled. The first scheduled tick at **07:50:00UTC / 11:50 Muscat** succeeded; its worker response was200 with successful provider reads, zero new duplicates and completion at07:50:03UTC. This is actual scheduled provider execution, not a promise of a ChatGPT background task.

### Result of the initial archive pass

The connected provider exposed **396 posts**, from **2022-09-17** through **2026-10-20**; its pagination ended and the backfill-complete flag is true. There are no pending unprocessed items at the verified snapshot:

- **20 linked videos:**12 already linked and preserved, plus **8 new marketing links** across4 existing properties.
- **69 separate non-target posts:**65 non-video posts and4 captions clearly indicating advice/general content.
- **307 require owner review:**224 unclear-content captions,47 without a matched existing property,19 conflicting specifications,7 insufficient specifications,6 multi-unit offers,3 multiple matching inventory records and1 mixed advice/offer.

This is not307 proven missing current listings. **221** of these review items predate2026, and **157** have sold/rented wording without enough current identifying detail. No guessed links or guessed properties were created. This pass read captions/metadata, not every video's visual/audio content.

All **15 marketing records that existed before the import** retained their full-row fingerprint; the8 additional links are legitimate user-authorized writes. Old dates, views, sync settings and associations were not reassigned. Existing reconciliation triggers remain active for proven linked inquiries. No customer messages, financial records or employee account changes were made.

### Runtime behavior

The worker gets newest25 posts each check and uses100-row cursor pages for initial/daily full-feed rescans. It uses server-owned credentials, fixed provider URLs, four-minute atomic leases, a100-second work budget and backoff/reconnect alerts. It stores actual publication dates; no artificial noon/date is invented. Caption matching is deterministic and conservative, with evidence recorded per decision. No visual analysis, transcription or MP4 storage is implemented or claimed.

Owner-only `instagram_media_catalog` and `instagram_discovery_state` expose SELECT only. Private audit stores before/after evidence. Service-only authenticated functions handle ingestion/decisions, and owner-only version-checked RPCs handle manual review and bounded scan requests. Existing video identities are reused rather than moved. Historical imports cannot regress property tracking dates: SQL33 backs up and narrowly replaces the existing monitoring trigger function.

The owner's **أداء العقارات** page now has **ربط المنشورات بالعقارات**: active/error/last-success status; review/linked/other/pending filters;20-row pagination; safe publication links; actual captions; property selection or non-property decision. The home page has an owner warning when needed, and persisted alerts are included in the existing notification bell refresh. These are CRM alerts, not WhatsApp/email/push messages. Other roles do not query the owner catalog. Normal property-performance functionality remains below the queue, and property Marketing stays visible.

### Verification

Full Node suite: **413 passed, two PostgreSQL-context skips**, security28 passed. Sixteen new caption-matching tests cover exact specs, Arabic/Persian digits, area/price-only refusal, conflicting rooms/dimensions, north/south, duplicate archived/current candidates, multi-unit content, advice, unknown captions, identity aliases and data-as-text. Real PostgreSQL tests cover leases, idempotent provider ingestion, real timestamp, original marketing preservation, deduplicated owner notification, owner review, stale versions, foreign/branch denial, no direct writes, preserved manual decisions, private linked events and historical-date protection. The native SQL fixture includes the existing investment rules; only Vault/network are isolated adapters.

Four real-index/bootstrap synthetic browser suites passed31 grouped scenarios: discovery5, marketing5, workspace11, design10. Downloaded reports show zero external requests, page errors and production test writes. One earlier UI gate exposed stale branch options after reset; the actual application reset was fixed and the original assertion retained, with an added delayed-clear check. New UI responses are invalidated by a reset epoch. A separate offline cold390px startup inspected target element bounds without clipping; this is not physical-phone evidence.

Live transaction-local owner reads returned396 catalog rows and its alerts; Barka returned zero catalog/state/owner-alert rows. Authenticated users have no direct catalog INSERT or worker execution, and anon has no SELECT. An actual unauthenticated request to the Edge returned401. These SQL role reads are not fresh password/browser sign-in sessions. Post-DDL advisors show the prior protected-view/password warnings, plus the intended owner-guarded review/scan RPC notices and private deny-all audit tables; they are documented, not suppressed.

Artifacts: CI12329335533, public12328699040. Public-check-only branch `codex/instagram-public-verification-20261021` at `02840bf8264cc9acaf2cbb84b1573d2aa327eb81`; it is one-time, not a recurring monitor. See [release and recovery](instagram-discovery-20261021.md).

## Preserved rules and remaining limits

Muscat/Barka remain independent of employee names; Hadeel remains retired; Muscat awaits the new branch email. Investor data remains owner-only, using Muscat transport. Deals, approved financial goals, dates, shares and current interface remain unchanged. No Instagram DM or customer automation was reactivated.

This rollout verifies actual API archive reads,8 actual links and a scheduled no-duplicate tick. It does not establish a newly published future Reel arriving after this response, fresh authenticated manual browser review, physical-device behavior, MP4 backups or automatic YouTube/Oman Reel ingestion. IG views are not inferred from likes and still depend on existing metric sync and permissions. Other Instagram accounts are not connected by assumption. Prior Auth lifecycle, Storage/Realtime, backup restoration, old-data and leaked-password-protection limitations remain.
