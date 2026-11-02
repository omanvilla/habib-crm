'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const js=fs.readFileSync('crm-reply-approvals.js','utf8'),fn=fs.readFileSync('supabase/functions/whatsapp-reply-send/index.ts','utf8');
const sql=fs.readFileSync('db/changes/51-reply-approval.forward.sql','utf8'),index=fs.readFileSync('index.html','utf8');

test('loader includes the approval screen',()=>{assert.match(index,/crm-reply-approvals\.js\?v=/);assert.match(index,/crm-reply-approvals\.css\?v=/);});

test('approval screen is owner-only and never writes drafts directly',()=>{
  assert.match(js,/if\(id==='replies'&&!isOwnerNow\(\)\)/);
  assert.match(js,/supa\.functions\.invoke\('whatsapp-reply-send',\{body:\{draft_id:id,messages\}\}\)/);
  assert.match(js,/supa\.rpc\('crm_reply_draft_reject'/);assert.match(js,/supa\.rpc\('crm_reply_rule_save'/);
  assert(!/from\('whatsapp_reply_drafts'\)\.(update|insert|delete)/.test(js));
});

test('each reply line can be deleted before approval',()=>{
  assert.match(js,/data-rp="del-line"/);assert.match(js,/a==='del-line'\)b\.closest\('\.rp-line'\)\.remove\(\)/);
  assert.match(js,/insertAdjacentHTML\('beforebegin',lineHtml\(''\)\)/);
});

test('customer text is escaped and trial drafts cannot be sent',()=>{
  for(const f of ['esc(name)','esc(phone)','esc(a.crm_note)','esc(t)','esc(String(text)'])assert(js.includes(f),f);
  assert.match(js,/\(trial\|\|!ok24\?' disabled':''\)/);
});

test('send function checks owner, pending claim, 24h window and company numbers',()=>{
  assert.match(fn,/prof\.data\.role !== "owner"/);
  assert.match(fn,/update\(\{ status: "sending" \}\)\.eq\("id", draftId\)\.eq\("status", "pending"\)/);
  assert.match(fn,/Date\.now\(\) - lastIn > WINDOW_MS\) return json\(\{ ok: false, error: "outside_24h" \}/);
  assert.match(fn,/companyNumbers\.includes\(to\)\) return json\(\{ ok: false, error: "company_number" \}/);
  assert.match(fn,/analysis\?\.dry_run === true\) return json\(\{ ok: false, error: "dry_run_draft" \}/);
});

test('SQL51: superseding never blocks message intake and RPCs are owner-only',()=>{
  assert.match(sql,/EXCEPTION WHEN others THEN\s+RAISE WARNING 'supersede_reply_drafts: %'/);
  assert.match(sql,/'superseded'\]\)\)/);
  assert.equal((sql.match(/IF public\.my_role\(\) IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'owner_only'/g)||[]).length,3);
  assert.match(sql,/coalesce\(d\.analysis->>'dry_run', ''\) <> 'true'/);
});

test('pinned matches are marked, investors get alternatives, auto-send is owner-only and off by default',()=>{
  const agent=fs.readFileSync('supabase/functions/whatsapp-reply-agent/index.ts','utf8');
  const sql52=fs.readFileSync('db/changes/52-reply-auto-send.forward.sql','utf8');
  assert.match(js,/a\.matched_rule_id\?'<span class="rp-chip pinned">مطابق لرد مثبت<\/span>'/);
  assert.match(js,/supa\.rpc\('crm_reply_auto_send_set',\{p_categories:cats\}\)/);
  assert.match(agent,/out\.matched_rule_id = rule\?\.id \|\| null/);
  assert.match(agent,/\["none", "handoff"\]\.includes\(out\.action\) && \(rt\.auto_send_categories \|\| \[\]\)\.includes\(out\.category\)/);
  assert.match(agent,/if \(dry \|\| \(rt\.reply_agent_mode === "approval" && !autoSend\)\)/);
  assert.match(sql52,/auto_send_categories text\[\] NOT NULL DEFAULT '\{\}'/);
  assert.equal((sql52.match(/IF public\.my_role\(\) IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'owner_only'/g)||[]).length,2);
});
