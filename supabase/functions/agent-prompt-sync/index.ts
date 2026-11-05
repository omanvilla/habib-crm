// Copies the reply agent's brain and investor knowledge from the repo (main branch) into
// whatsapp_agent_prompts, so a wording change is a git push + one call, not a redeploy.
// The repo brain is kept as 'brain_base'; 'brain' (what the agent reads) = brain_base + Ahmed's open CRM notes.
import { createClient } from "npm:@supabase/supabase-js@2";
const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false, autoRefreshToken: false } });
const REPO = "omanvilla/habib-crm";
const FILES: Record<string, string> = { brain_base: "supabase/functions/whatsapp-reply-agent/brain.ts", knowledge: "supabase/functions/whatsapp-reply-agent/knowledge.ts" };
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json; charset=utf-8" } });
Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false }, 405);
  const secret = req.headers.get("x-crm-agent") || "";
  const ok = secret ? await db.rpc("crm_reply_agent_secret_ok", { p_secret: secret }) : null;
  if (!ok || ok.error || ok.data !== true) return json({ ok: false, error: "not_authorized" }, 403);
  const c = await fetch(`https://api.github.com/repos/${REPO}/commits/main`, { headers: { Accept: "application/vnd.github+json", "User-Agent": "habib-crm-prompt-sync" } });
  const sha = (await c.json().catch(() => ({})))?.sha;
  if (!sha) return json({ ok: false, error: "no_commit" }, 502);
  const out: Record<string, number> = {};
  for (const [key, path] of Object.entries(FILES)) {
    const r = await fetch(`https://raw.githubusercontent.com/${REPO}/${sha}/${path}`);
    if (!r.ok) return json({ ok: false, error: `fetch_${key}_${r.status}` }, 502);
    const m = (await r.text()).match(/=\s*`([\s\S]*)`;?\s*$/);
    if (!m || m[1].length < 1000) return json({ ok: false, error: `parse_${key}` }, 422);
    const w = await db.from("whatsapp_agent_prompts").upsert({ key, content: m[1], source_sha: sha, updated_at: new Date().toISOString() });
    if (w.error) return json({ ok: false, error: w.error.message }, 500);
    out[key] = m[1].length;
  }
  const b = await db.from("whatsapp_agent_prompts").upsert({ key: "brain", content: (await db.from("whatsapp_agent_prompts").select("content").eq("key", "brain_base").single()).data?.content || "", source_sha: sha, updated_at: new Date().toISOString() });
  if (b.error) return json({ ok: false, error: b.error.message }, 500);
  const comp = await db.rpc("crm_compose_agent_brain");
  return json({ ok: true, sha, ...out, lessons_added: !comp.error });
});
