-- applied 4 Nov 2026 (owner at computer)
alter table whatsapp_conversations add column if not exists agent_muted boolean not null default false, add column if not exists agent_muted_reason text;
alter table properties add column if not exists rental_terms text[];
alter table whatsapp_reply_variants add column if not exists status text not null default 'testing', add column if not exists min_sample int not null default 20, add column if not exists source text, add column if not exists rationale text;
alter table whatsapp_reply_rules add column if not exists experiment_note text;
-- views whatsapp_reply_variant_outcomes / whatsapp_reply_variant_results: per pinned reply and wording,
-- how many got it, replied within 3 days, booked a visit within 30 days, opened a deal within 90 days.
