# Client first-contact order and guarded WhatsApp context — v17

Candidate implementation; publication evidence will be added after validation. Runtime `20261021-client-v17`, based on `ccd8d19d24ff22be32f43f64b0be015f831569ab`. This is the owner's narrow client-list change plus the first staged WhatsApp reply trial, not a redesign or live auto-reply rollout.

## Client list

The original client reader enriches its already-authorized rows with a bounded400-ID SECURITY INVOKER RPC. It reads the earliest actual inbound WhatsApp/Instagram timestamp under caller RLS. It does not select private message bodies, infer missing timestamps or update client rows. No-message records explicitly show registration with unknown first contact. Sorting is descending actual first-contact, otherwise explicitly labelled creation date, with stable ID ties. The existing filtered/exported rows remain the source of truth. Time is shown in Asia/Muscat, Western numerals,24-hour clock. A failed or partial chronology response is an error, never a fabricated all-zero/time fallback.

## Existing live understanding extended

The same shared service already used by WhatsApp webhook and CRM sends gains Omani location-request phrases, exact saved Google-map identities (including precise native GPS), exact public listing text and uniquely matching land/build dimensions. Conflicting dimensions/prices, duplicate locations or unknown references are not guessed. Unknown links do not become a100%-certain match. Images still use the original readable-ad evidence pipeline, not visual resemblance or video/audio interpretation.

Unquoted short follow-ups can use the immediately preceding24-hour property context only after an independent server check. For prior incoming messages there must be exactly one proven attribution; for staff replies the old inquiry's evidence must actually include that human message. Outgoing promotions are not customer interest. The unchanged attribution transaction continues to enforce current company/branch/private boundaries, identity preservation and retries. Location interest is a separate idempotent request event with the original time; it creates no visit/appointment and does not advance a visit stage. No bulk historical reprocessing occurs.

SQL34 backs up the original candidate-reader definition with a drift guard, adds the read-only chronology RPC, adds public listing/map fields to the service-only candidate reader and adds two service-only guarded context/event routines. No stored financial amount, authorship or original customer timestamp is rewritten. Rollback restores the previous frontend and shared service first, then the original function and removes only the added API functions; legitimate historical events are retained.

## Reply trial

Owner WhatsApp page has one **تجربة الردود** button. The modal is a local-memory text simulator against the owner's permitted public listing fields. It never calls a send API, writes a client/request/visit, stores drafts, requests an LLM or downloads media. The planner keeps unspecified greetings unknown, asks for the ad when needed, then one missing area/budget/type field at a time. Staff response can supply a property context only after an ask. It offers saved available data, not owner notes/net values. Suggested options are not automatically recorded customer inquiries. Requests for a human, unavailability and missing maps are explicit. It identifies itself honestly as a virtual assistant when asked.

The existing restricted WhatsApp test configuration remains unchanged. No new live reply scenario or scheduled customer follow-up is enabled. This is the first safe wording/context trial; actual WhatsApp trial delivery remains distinct and unverified. Closing the modal, changing branch and resetting the session discard its memory.

## Verification boundary

Tests distinguish pure timestamp/planner/matcher functions, shared-service requests, full-bootstrap synthetic browser and real isolated PostgreSQL policies/atomicity. Production access is read-only except authorized schema/function deployments. No customer test message or fake auth token is permitted. Deployment, live role reads and observed provider behavior will be documented separately. Physical devices, fresh real signed-in trial use and actual external replies are not inferred from synthetic tests.
