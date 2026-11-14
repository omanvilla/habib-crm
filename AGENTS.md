# Habib CRM — current working agreement

Owner: Ahmed Habib Al Balushi. Use Arabic for owner-facing summaries. Repository `omanvilla/habib-crm`; Supabase `dmsckqjkcnsfmnzfjczz`. Never commit credentials, customer records or private screenshots.

**New session? Read [docs/handoff-20261114.md](docs/handoff-20261114.md) first** (14 Nov 2026: where the work stands, what Ahmed decided about rules held by code, what is open), then [docs/handoff-20261111.md](docs/handoff-20261111.md) for the routine: how Ahmed works, the safe change/publish routine on this machine, live pins and what is still open (written 11 Nov 2026 at the end of a long session).

Before changes read this file, `docs/current-state.md`, and [the detailed operating rules](docs/operating-rules-v15-20261021.md). Those business, account, financial, attribution, privacy and interface rules remain binding; they were moved verbatim to keep this entry point short. The explicit new Instagram authorization below supplements them. Latest owner instructions always take precedence.

## Reply agent rules — 8 November 2026

Before changing anything that decides what the reply agent or the follow-ups say or when they speak (`whatsapp-reply-agent` code or `brain.ts`, follow-up functions, handoff triggers), read [docs/agent-rules.md](docs/agent-rules.md) and follow its change procedure: look for conflicting rules in that file, in `brain.ts` and in Ahmed's open CRM notes, and **ask Ahmed before changing** when anything conflicts. Record every decision there and run its scenarios plus a dry run of the last 20 chats before publishing.

## Continuity, authorization and preservation

Inspect actual main, review branches, pending edits, source, applied migrations/functions and published behavior. A branch is not a deployment. Ordinary implementation requests authorize meaningful tests and coordinated publication without repeated permission; respect audit-only/preview exceptions. Preserve other work and real history. No customer messages, social publishing, ads or paid upgrades merely because access exists. No fake production tokens, employee password changes, account reactivation or real customer test data. State exact verification limits and use reversible changes.

Muscat and Barka remain operational identities independent of employees. Branch and owner-private investment isolation applies throughout SQL/API/Storage, exports, selectors and cached UI. Investment uses the Muscat transport but remains owner-only, never inferred from geography or legacy labels. Hadeel remains retired; Barka's existing account remains; Muscat is owner-assigned pending the new branch-owned email. Preserve original authors, financial allocations and business dates.

## Newly approved Instagram discovery — 21 October 2026

Ahmed explicitly authorized automatic discovery of new Reels and review of the accessible existing feed. This is the separate native CRM job `habib_instagram_media_discovery` every five minutes. Keep the old WhatsApp follow-up cron disabled. Do not create duplicate ChatGPT tasks, recurring GitHub workflows or restart the retired investor-number onboarding.

Use only the existing encrypted account connection, a fixed provider host and Vault-protected scheduler authentication. No plaintext tokens in URLs/logs/frontend; never persist provider pagination.next because it can contain credentials. Use cursor pagination, atomic leases, bounded work and safe retry/backoff. Reconnection failures must alert the owner, not silently appear as an empty feed.

Save actual provider identity, permalink, caption and publication timestamp into the owner-only catalog. The current feature stores metadata/links, not MP4 backups. It matches caption evidence; it does not watch frames or transcribe audio. Do not claim otherwise. Existing marketing events remain authoritative and immutable to the importer. Reuse the company-wide canonical identity index; never duplicate or reassign an existing video just to make a save succeed.

A unique location plus sufficient exact specifications may link automatically. Price or location alone, contradictory facts, multiple identical inventory records, multi-unit offers and unknown content require owner review. Include archived inventory when deciding uniqueness. Explicit advice/general content is separate, but a person speaking is not proof of non-property content. Vague captions remain reviewable. Do not infer visual identity or fabricate a property.

Manual review is owner-only, optimistic-version checked and audited; it can link a pending/review item or mark non-property content. Do not automatically overwrite that decision. New unambiguous links go into the existing property marketing journal so normal inquiry reconciliation remains authoritative. Historical imports must not move current property monitoring dates backward. Owner alerts are persisted and deduplicated; no external customer message is sent.

The queue lives in **أداء العقارات > ربط المنشورات بالعقارات**, with status, counts, pagination and manual decisions. Keep ordinary performance below it, Marketing visible on property rows and IG direct messages removed. Tests must cover real database authorization separately from synthetic UI and actual provider execution.

## Identical properties and investment projects — 5 November 2026

Ahmed's instruction supersedes "never duplicate" above in one case only: a video may count for identical properties (same owner, land, built size, bedrooms and price) after he says yes. Each gets its own publication row with `twin_of`, and inquiries from the video count for each. Saving a link that belongs to another property is still refused. Nothing links to identical properties without his yes.

Videos can belong to an owner-only investment project. The scan links one only when the caption names exactly one project, not when it says near or opposite the place, and never over Ahmed's decision or a property link.

## Unchanged product guardrails

Keep stacked client/property lists, coherent Arabic typography and line icons, exact existing filters/export sources, secondary actions under More, four home shortcuts, six initially collapsed work categories, branch targets and period performance in Reports. Keep calendar. Do not redesign Deals or alter deal forms/workflow without an explicit new instruction. Preserve customer text/emoji; no broad DOM text rewriting.

Targets remain 10 current available non-archived properties per branch; independently two qualified weekly additions, ten distinct outcome-documented human follow-ups per day, five completed visits per week, and two paid bookings OR OMR4,000 expected office commission per month, with saved branch/month overrides. Paid-booking date determines achievement month; closing and receipts have independent dates. Preserve partial receipts, milli-OMR, staff shares and payout-after-company-collection. Never infer missing historical dates/evidence or count automation as human activity.

The detailed operating rules retain visit/client/request atomicity, duplicate phone handling, exact WhatsApp attribution, explicit private routing and session isolation requirements. A UI simplification cannot weaken validation or backend authorization. Update current-state and dated evidence after publication; distinguish source/unit checks, native SQL, synthetic browser, transaction-local live roles and actual authenticated/provider journeys.

## Client chronology and reply trial — 21 October 2026

Client lists default to newest **first recorded inbound contact** first, not next follow-up or most recent activity. Show full date and time in Asia/Muscat, Western digits. For manual/no-message records, label the creation timestamp explicitly as registration, never invent a first-contact time. Preserve filters, export order and the approved layout.

WhatsApp identity can use the exact saved publication/map or sufficient unique listing facts, including legible image evidence and an independently verified human response. A location request is recorded as visit **interest**, never as a scheduled/completed visit. Context-only follow-ups require an adjacent, recent, independently proven property; alternate/rejected/conflicting context stays for review. Do not rewrite historical customer classifications merely to clear an alert.

New automatic-reply wording starts in an owner-only, text-only dry-run workspace. No new customer sends, no new customer/appointment records, no expansion of the existing restricted test number and no reactivation of old follow-up automation. Trial content remains in memory and clears on close/session reset. The preview is deterministic drafting using the matching module, not a claim of a live WhatsApp AI conversation or image/video processing in the preview.
