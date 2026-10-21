# Instagram discovery and property linking — v16

Status: deployed and active,2026-10-21. Frontend `20261021-instagram-v16`, validated commit `4bbe7a71b70dd1e95367a9d8a85053c71d79b313`. SQL33 migration `20261021074249`; Edge `instagram-discovery` version2. Business authorization: the owner requested automatic new-Reel linking, a retrospective accessible-feed review, separate general content and alerts for uncertain listings. No real URLs, property names, customer identifiers or credentials are included in this public report.

## What is active

The CRM's native job `habib_instagram_media_discovery` runs every5minutes. It uses the existing connected account and encrypted credential, not a ChatGPT reminder. A Vault secret protects worker requests; the worker compares it through a service-only RPC. No token is exposed in frontend code, logs, provider URLs or saved pagination.next. Provider pagination uses a reconstructed fixed-host URL plus cursor. The old WhatsApp follow-up job remains disabled.

The scheduled check reads recent posts automatically, with bounded cursor backfill/daily rescans, lease protection, retries and error/reconnection notifications. Publication identity, caption, actual timestamp, permalink and available likes/comments enter an owner-only catalog. It does not save an MP4 file or claim to analyze the actual video/audio. Reels with clear evidence go into the existing property marketing journal; ordinary metrics remain separate from likes and unknown views are not zero.

Matching requires one property with sufficient exact caption specifications and meaningful location. Price/location alone do not qualify. Contradictory specifications, duplicate matching inventory records, several advertised units, missing property records and ambiguous content remain for review. Archived inventory is included in ambiguity checks. Existing video identities preserve their current association and historical marketing fields. Clear advice content is separate, while merely appearing on camera is not treated as proof of advice.

Manual review lives in **أداء العقارات > ربط المنشورات بالعقارات**. Only the owner can read the queue, approve a chosen property or mark a video as non-property content. The database checks owner/company and the exact observed record version; stale edits fail rather than overwrite. Explicit owner decisions are preserved against automation. Alerts are persisted in the owner notification bell and summarized on the dashboard, not sent externally. Uncertain items are not announced as failed saves or silently discarded.

## Actual archive result

All provider pagination pages available to this account completed. The catalog holds **396 posts** spanning2022-09-17 through2026-10-20:

| State | Count |
|---|---:|
| Previously linked video identities preserved |12|
| Newly linked video identities |8|
| Linked total |20|
| Clear advice/general-video captions |4|
| Non-video posts kept separate |65|
| Needs owner review |307|
| Unprocessed pending |0|

The307 review cases consist of224 vague captions,47 with no matched property,19 conflicting stored specifications,7 insufficient facts,6 multi-unit ads,3 several matching properties and1 mixed advice/offer.221 are before2026;157 of the vague-caption review items contain sold/rented wording without enough identity. Thus the large review count is mainly historical/uncertain content, not307 missed clear current ads. No claim that every uncertain video was visually watched is made.

The eight new links concern four existing properties. All15 pre-import marketing rows retained the exact aggregate full-row fingerprint from the07:41:32UTC cutoff. Actual publication dates were used for new events. Existing dates, measurements and links were not moved or guessed. Linking uses the normal identity/reconciliation triggers, so proven pending inquiries can use their original evidence. This is authorized production import, not production test data.

## Database and privacy

New public tables are RLS-protected with same-company owner SELECT only; no authenticated INSERT/UPDATE. Worker write RPCs are service-only. Review and scan RPCs enforce active owner identity/company and optimistic version/rate limits respectively. Private audit and monitoring-function backup have deny-all client access. Marketing identity and uniqueness indexes were not weakened.

The private decision transaction locks the catalog and property, checks inventory version, preserves existing associations, inserts at most one new event and records before/after evidence. Auto events have no fabricated human actor. A manual link records the real owner's user ID. Provider retries and unique conflicts are idempotent. The existing monitoring trigger was backed up and narrowed to avoid older imported posts moving newer current monitoring timestamps backward.

Actual transaction-local role checks after import: owner saw396 rows and its state/alerts; Barka saw zero catalog, state or owner-alert rows. Authenticated users cannot invoke the worker decision or directly write the catalog; anon cannot read it. A real unauthenticated Edge POST returned401. Role-claim SQL checks are separate from actual password/browser sessions.

Post-DDL advisors retained two protected-definer-view findings and disabled leaked-password protection. The new owner-gated review/scan RPCs add two expected privileged-function notices, and private audit/backup tables add deny-all RLS information notices. [Privileged-function guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable). [Password-protection guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). No finding was suppressed and no broader grants were added to make a UI test pass.

## Tests and publication

[CI39563716563](https://github.com/omanvilla/habib-crm/actions/runs/39563716563) passed. Node413passed/two PostgreSQL-context skips; security28passed. Sixteen new matching tests cover exact and conflicting specifications, numeric formats, north/south, duplicate current/archived records, multi-unit ads, vague/advice content, existing canonical identities and hostile text. Native PostgreSQL acceptance covers real catalog/RLS, lease/idempotence, timestamps, preserved history, owner-only decisions, stale versions, private event visibility and monotonic tracking dates. Vault/network stubs are isolated and cannot send real requests.

Actual index/server bootstrap with synthetic fixtures passed31 browser groups: discovery5, marketing5, workspace11, design10. Artifact12329335533 was downloaded and inspected: all four reports have zero page errors, external requests or production writes. The initial gate's reset-option failure was repaired in application code; no assertion was removed. A separate local cold390px check found no target element outside the viewport; no physical phone is claimed. Real notification and property-review UI interactions were tested synthetically, not by changing employee passwords or inventing production tokens.

[Pages39564209437](https://github.com/omanvilla/habib-crm/actions/runs/39564209437) deployed the validated runtime. [Read-only public verification39564712357](https://github.com/omanvilla/habib-crm/actions/runs/39564712357) at07:49:36UTC proved26HTTP200 assets identical to source and clean empty-browser startup, with the owner section mounted but hidden before login. Public artifact12328699040 was inspected. The public-check branch is one-time; it is not another scheduler.

The native cron's first real scheduled tick at **07:50:00UTC /11:50 Muscat** succeeded. Its Edge response200 confirmed actual provider reads with25fetched, zero added/linked/reviewed duplicates, and completion07:50:03UTC. This separately proves scheduled execution after the initial real import; enqueue success alone was not treated as end-to-end success. Only the Instagram job is enabled.

## Recovery and limits

To pause this feature, disable its state flags and unschedule only `habib_instagram_media_discovery`; `db/changes/33-instagram-discovery.pause.sql` contains the data-preserving operational stop. Restore the v15 frontend bootstrap only if required. Do not delete catalogs, audit rows, legitimate linked events or restore older customer data as a blanket rollback. Any mistaken association requires a separately reviewed correction with the recorded before/after audit. The original monitoring-function definition is in `crm_repair_private.instagram33_catalog_backup`; review later changes before restoring it.

No new client/deal/account/financial edits, outbound messages, ads or social publishing occurred. Existing customer follow-ups stay disabled. This implementation is for the already connected account; it does not automatically connect other accounts. Captions/metadata are analyzed, not frames/audio. Actual MP4 backup, Stories, inaccessible/deleted/provider-hidden posts and future publication delivery beyond the observed scheduled tick are not claimed. Fresh authenticated manual production review, physical hardware, other-provider analytics, prior Auth/Storage/Realtime/physical-restore limits remain unverified rather than assumed.
