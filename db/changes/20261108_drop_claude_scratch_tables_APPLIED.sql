-- applied 8 Nov 2026 (Ahmed: «احذفهم»). Two scratch tables from the 6 Nov dry run had no RLS and were open to the anon key.
-- claude_dryrun_20261106 held only message ids; claude_voice_backup_20261106 held the earlier transcripts of 6 voice notes
-- whose newer transcripts are complete in whatsapp_messages.
drop table if exists public.claude_dryrun_20261106;
drop table if exists public.claude_voice_backup_20261106;
-- security advisor: fixed search_path on the new helper
alter function crm_repair_private.is_hard_handoff(text) set search_path = '';
