'use strict';
// SQL78 (10 Nov 2026): database support for the reply agent upgrade (agent memory and seriousness on the conversation,
// behaviour tiers on the real deal stages, «اجتماع» hot alert, thinking_followup queue kind and its approval guard).
// Source checks only; the exact forward and rollback files ran on the live database inside rolled-back transactions.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const lf=s=>s.replace(/\r\n/g,'\n');
const fwd=lf(fs.readFileSync('db/changes/78-agent-support.forward.sql','utf8'));
const rb=lf(fs.readFileSync('db/changes/78-agent-support.rollback.sql','utf8'));
const md5=s=>crypto.createHash('md5').update(s,'utf8').digest('hex');
const code=s=>s.split('\n').filter(l=>!/^\s*--/.test(l)).join('\n');
const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
// each CREATE OR REPLACE FUNCTION block as pg_get_functiondef prints it: ends with "$function$\n", no semicolon
function blocks(sql){const out={};const re=/^CREATE OR REPLACE FUNCTION ([^\s(]+)\([\s\S]*?^end \$function\$;$/gm;let m;while((m=re.exec(sql)))out[m[1]]=m[0].slice(0,-1)+'\n';return out;}
const F=blocks(fwd),R=blocks(rb);
const REFRESH='public.crm_refresh_client_behavior',HOT='crm_repair_private.owner_hot_alert';
const SIG={[REFRESH]:'public.crm_refresh_client_behavior(uuid)',[HOT]:'crm_repair_private.owner_hot_alert()'};
// md5(pg_get_functiondef(...)) live on 10 Nov 2026 before SQL78
const LIVE={[REFRESH]:'5e75e426362dad11b6b319320c5fb3a1',[HOT]:'53ff3d16e1e61319a2964318f4283c18'};
// md5 of the forward bodies as tested live (same md5 read back from pg_get_functiondef after the forward)
const TESTED={[REFRESH]:'3318ddeaac44685dcfbbbb69bb41d5ae',[HOT]:'e25b8da4a5beb3c5589c6851dfe9d52a'};
const linesOnlyIn=(a,b)=>{const keep=new Set(b.split('\n'));return a.split('\n').filter(l=>!keep.has(l));};

test('the rollback holds the two functions exactly as they were live, and the forward replaces the same two',()=>{
 assert.deepEqual(Object.keys(R).sort(),Object.keys(LIVE).sort());
 assert.deepEqual(Object.keys(F).sort(),Object.keys(LIVE).sort());
 for(const k of Object.keys(LIVE))assert.equal(md5(R[k]),LIVE[k],k+' in the rollback is no longer the live copy');
 for(const k of Object.keys(TESTED))assert.equal(md5(F[k]),TESTED[k],k+' changed after the live test: re-run it in a rolled-back transaction and update TESTED and both md5 guards');
 for(const b of [...Object.values(F),...Object.values(R)]){assert(b.includes('\n SECURITY DEFINER\n'));assert(/\n SET search_path TO '(public)?'\n/.test(b));}
 assert(/^SET LOCAL lock_timeout = '5s';$/m.test(fwd)&&/^SET LOCAL lock_timeout = '5s';$/m.test(rb));
});

test('forward and rollback refuse to overwrite a function that changed since its copy was taken',()=>{
 for(const [sql,name] of [[fwd,'forward'],[rb,'rollback']]){
  const c=code(sql);
  const guardAt=c.indexOf('DO $$');
  const firstChange=Math.min(...['CREATE OR REPLACE FUNCTION','ALTER TABLE'].map(s=>c.indexOf(s)).filter(i=>i>=0));
  assert(guardAt>=0&&guardAt<firstChange,name+': the md5 guard runs before any change');
  const guard=c.slice(guardAt,c.indexOf('END $$;',guardAt)+'END $$;'.length);
  for(const k of Object.keys(LIVE)){
   const m=guard.match(new RegExp("v_md5 := md5\\(pg_get_functiondef\\('"+esc(SIG[k])+"'::regprocedure\\)\\);\\n  IF v_md5 NOT IN \\('([0-9a-f]{32})', '([0-9a-f]{32})'\\) THEN\\n    RAISE EXCEPTION 'SQL78 (rollback )?refused: "+esc(k)+" changed"));
   assert(m,name+': no md5 guard for '+k);
   // the 10 Nov live body or the SQL78 body, nothing else (a re-run of either file still works)
   assert.deepEqual([m[1],m[2]].sort(),[LIVE[k],TESTED[k]].sort(),name+': '+k);
  }
  assert.equal((guard.match(/RAISE EXCEPTION 'SQL78 (rollback )?refused: /g)||[]).length,2);
 }
});

test('the conversation keeps the agent note and judgement; branch accounts see them only through the existing RLS',()=>{
 for(const c of ['agent_note text','agent_seriousness text','agent_seriousness_reason text','agent_profile_at timestamptz'])assert(fwd.includes('ADD COLUMN IF NOT EXISTS '+c),c);
 const vals=fwd.match(/CHECK \(agent_seriousness IN \(([^)]*)\)\)/);
 assert(vals&&fwd.includes('ADD CONSTRAINT whatsapp_conversations_agent_seriousness_check'));
 assert.deepEqual([...vals[1].matchAll(/'([^']+)'/g)].map(x=>x[1]),['strong','possible','weak','unknown']);
 // table-level privileges + RLS already cover new columns: no column grant, no policy or RLS change
 assert(!/\b(GRANT|REVOKE)\b/i.test(code(fwd)));
 assert(!/\bPOLICY\b|ROW LEVEL SECURITY/i.test(code(fwd)));
});

test('the rollback copies the agent\'s notes and judgements to an owner-only backup before the columns go',()=>{
 const c=code(rb);
 // the restored functions never read the new columns
 for(const b of Object.values(R))assert(!/agent_(note|seriousness|profile_at)/.test(b));
 const at=s=>{const i=c.indexOf(s);assert(i>=0,'missing: '+s);return i;};
 // only while the columns are still there, so the rollback can run twice
 const only=at("AND attname = 'agent_note' AND NOT attisdropped) THEN");
 const create=at('CREATE TABLE IF NOT EXISTS crm_repair_private.agent_note_backup_78 (');
 const rls=at('ALTER TABLE crm_repair_private.agent_note_backup_78 ENABLE ROW LEVEL SECURITY;');
 const revoke=at('REVOKE ALL ON crm_repair_private.agent_note_backup_78 FROM PUBLIC, anon, authenticated, service_role;');
 const copy=at('INSERT INTO crm_repair_private.agent_note_backup_78 (conversation_id, agent_note, agent_seriousness, agent_seriousness_reason, agent_profile_at)\n    SELECT id, agent_note, agent_seriousness, agent_seriousness_reason, agent_profile_at\n      FROM public.whatsapp_conversations\n     WHERE agent_note IS NOT NULL OR agent_seriousness IS NOT NULL;');
 const dropCheck=at('ALTER TABLE public.whatsapp_conversations DROP CONSTRAINT IF EXISTS whatsapp_conversations_agent_seriousness_check;');
 const drop=at('DROP COLUMN IF EXISTS agent_note,');
 assert(only<create&&create<rls&&rls<revoke&&revoke<copy&&copy<dropCheck&&dropCheck<drop,'the copy is made before the constraint and the columns go');
 assert(!/\b(DROP|TRUNCATE|DELETE)\b[^;]*agent_note_backup_78/i.test(c),'the backup is appended to, never emptied');
 for(const col of ['agent_note','agent_seriousness','agent_seriousness_reason','agent_profile_at'])assert(c.includes('DROP COLUMN IF EXISTS '+col+(col==='agent_profile_at'?';':',')),col);
 assert(drop>c.lastIndexOf('end $function$;'));
});

test('the seriousness values are the ones the reply agent schema returns',t=>{
 const agent=fs.readFileSync('supabase/functions/whatsapp-reply-agent/index.ts','utf8');
 const m=agent.match(/seriousness:\s*\{\s*type:\s*"string",\s*enum:\s*\[([^\]]*)\]/);
 if(!m){t.skip('the reply agent schema has no seriousness enum yet');return;}
 assert.deepEqual([...m[1].matchAll(/"([^"]+)"/g)].map(x=>x[1]).sort(),['possible','strong','unknown','weak']);
});

test('SQL78 leaves the behaviour text and the brain composition as they are live (10 Nov review)',()=>{
 // the agent reads its own judgement of this chat in «ملف العميل»; how Ahmed's notes rank against the rules is his call
 for(const s of [code(fwd),code(rb)])assert(!/crm_client_behavior_text|compose_agent_brain|rebuild_agent_lessons|whatsapp_agent_prompts|crm_owner_notes/.test(s));
 assert(fwd.includes('-- Left out after the 10 Nov review: compose_agent_brain'));
});

test('behaviour tiers use the real deal stages, count distinct properties for the wanderer and keep Ahmed\'s lock',()=>{
 const f=F[REFRESH],r=R[REFRESH];
 const fixture=fs.readFileSync('tests/fixtures/deal-workflow.sql','utf8').match(/deals_stage_check CHECK \(\(stage = ANY \(ARRAY\[([^\]]*)\]/);
 const allowed=new Set([...fixture[1].matchAll(/'([a-z_]+)'::text/g)].map(x=>x[1]));
 assert(allowed.has('awaiting_finance')&&allowed.has('closed')&&allowed.size===15);
 const lists=[...f.matchAll(/stage in \(([^)]*)\)/g)].map(m=>[...m[1].matchAll(/'([a-z_]+)'/g)].map(x=>x[1]));
 assert.deepEqual(lists,[['closed','commission_collected'],['negotiation','deposit','awaiting_finance','finance_approved','awaiting_clearance','ownership_transfer']]);
 lists.flat().forEach(s=>assert(allowed.has(s),s+' is not a deal stage'));
 assert(!/'(won|closed_won|sold|reservation|contract)'/.test(f));
 // a deposit on any deal still counts, as live (a lost deal's deposit too: not part of the request)
 const dep='  select count(*) deals_n, coalesce(bool_or(coalesce(deposit_amount,0) > 0),false) has_deposit,';
 assert(r.includes(dep)&&f.includes(dep));
 assert(!/'lost'/.test(f));
 assert(f.includes('elsif v.props_visited >= 3 or m.props_asked >= 5 or (span_days > 45 and m.inbound >= 15 and v.done_n = 0) then tier := \'wanderer\''));
 assert(!f.includes('v.done_n >= 3'));
 assert(f.includes('from public.viewings where client_id = p_client and coalesce(archived,false)=false;'),'archived visits stay out');
 assert(f.includes('where b.client_id = p_client and b.tier_locked;')&&f.includes("'locked', true); end if;"),'a locked tier is returned unchanged');
 // nothing else changed: only the two stage lines and the wanderer line of the live body are replaced
 const gone=linesOnlyIn(r,f);
 assert.equal(gone.length,3);
 assert(gone.every(l=>/stage in \(|v\.done_n >= 3 or m\.props_asked/.test(l)));
 const added=linesOnlyIn(f,r);
 assert.equal(added.length,5);
 assert(added.every(l=>/^  -- SQL78: |stage in \(|v\.props_visited >= 3 or m\.props_asked/.test(l)));
});

test('a booked meeting («اجتماع:», R19) is posted to the hot alert like a serious buyer and stays a soft handoff',()=>{
 assert(F[HOT].includes(String.raw`~ '^\s*(مشتري جاد|تفاوض|اجتماع)\s*:'`));
 assert(R[HOT].includes(String.raw`~ '^\s*(مشتري جاد|تفاوض)\s*:'`));
 assert.equal(F[HOT].replace('|تفاوض|اجتماع)','|تفاوض)'),R[HOT],'only the reason pattern changes');
 const rx=new RegExp(F[HOT].match(/~ '([^']+)'/)[1]);
 for(const s of ['اجتماع: أحمد مكتب الموالح 2026-11-12 10:00 مدينة السلطان هيثم',' اجتماع : عميل','مشتري جاد: عميل','تفاوض: عميل'])assert(rx.test(s),s);
 for(const s of ['دراسة سعر: عميل','طلب اتصال: عميل','عميل اجتماع: بعدين'])assert(!rx.test(s),s);
 // the hard handoff (R1/R3 hold) is not touched: a meeting does not silence the agent
 assert(!fwd.includes('is_hard_handoff'));
 const hold=fs.readFileSync('db/changes/20261110_live_chat_hold_RECORD.sql','utf8');
 assert(hold.includes(String.raw`~ '^\s*(تفاوض|مشتري جاد|دراسة سعر)\s*:'`)&&!hold.includes('اجتماع'));
});

test('whatsapp-owner-hot-alert accepts what the trigger posts (until then it skips a meeting as not_hot)',t=>{
 const fn=lf(fs.readFileSync('supabase/functions/whatsapp-owner-hot-alert/index.ts','utf8'));
 const m=fn.match(/^const HOT = \/(.+)\/;$/m);
 assert(m,'the HOT pattern of whatsapp-owner-hot-alert was not found');
 if(!m[1].includes('اجتماع')){t.skip('whatsapp-owner-hot-alert still answers skipped:not_hot for «اجتماع:»: no WhatsApp meeting alert until it is changed and re-pinned');return;}
 const edge=new RegExp(m[1]),trig=new RegExp(F[HOT].match(/~ '([^']+)'/)[1]);
 for(const s of ['اجتماع: عميل مكتب الموالح 2026-11-12 10:00',' اجتماع : عميل','مشتري جاد: عميل','تفاوض: عميل','دراسة سعر: عميل','طلب اتصال: عميل','عميل اجتماع: بعدين'])assert.equal(edge.test(s),trig.test(s),s);
});

test('thinking_followup (R21): nothing limits the queue kind, an R21 row can never be approved, the request flow reads request_followup only',()=>{
 const c=code(fwd);
 assert(c.includes("WHERE c.conrelid = 'public.whatsapp_outreach_queue'::regclass AND c.contype = 'c' AND a.attname = 'kind'\n                AND c.conname <> 'whatsapp_outreach_queue_thinking_never_approved') THEN"));
 assert(c.includes("RAISE EXCEPTION 'SQL78: a CHECK constraint limits whatsapp_outreach_queue.kind; add thinking_followup to it first';"));
 // a pending R21 row left by a run that died: approving it on «ردود انتظر موافقتك» fails instead of whatsapp-outreach sending it late
 assert(c.includes('ALTER TABLE public.whatsapp_outreach_queue DROP CONSTRAINT IF EXISTS whatsapp_outreach_queue_thinking_never_approved;'));
 assert(c.includes("ALTER TABLE public.whatsapp_outreach_queue ADD CONSTRAINT whatsapp_outreach_queue_thinking_never_approved\n  CHECK (kind <> 'thinking_followup' OR status <> 'approved');"));
 assert(code(rb).includes('ALTER TABLE public.whatsapp_outreach_queue DROP CONSTRAINT IF EXISTS whatsapp_outreach_queue_thinking_never_approved;'));
 assert(!/crm_followups_today/.test(c),'the daily list is not changed here');
 // the daily list as it is live (SQL72) reads the queue twice, both times for request_followup rows only
 const today=fs.readFileSync('db/changes/72-followup-owner-instruction.forward.sql','utf8');
 assert.equal((today.match(/FROM public\.whatsapp_outreach_queue q/g)||[]).length,2);
 assert.equal((today.match(/AND q\.kind = 'request_followup'/g)||[]).length,2);
 // removed-stays-removed and «sent by a person» only touch request_followup rows
 assert(fs.readFileSync('db/changes/67-followup-removed-stay-removed.forward.sql','utf8').includes("IF NEW.kind <> 'request_followup' OR NEW.reason IS NOT NULL THEN RETURN NEW; END IF;"));
 assert(fs.readFileSync('db/changes/64-daily-followups-list.forward.sql','utf8').includes("AND kind = 'request_followup'"));
});

test('no customer phone numbers or credentials in the migration',()=>{
 for(const s of [fwd,rb]){
  assert(!/(?<![\d_])(?:968)?[79]\d{7}(?![\d_])/.test(s));
  assert(!/eyJ[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9]{10,}/.test(s));
 }
});
