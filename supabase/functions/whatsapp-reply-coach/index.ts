// Reply experiments coach (4 Nov 2026). Ahmed's rule: a pinned reply is never final. Each wording is tried on
// about 20 people and judged by what happened after: did they answer, book a visit, open a deal. Weekly:
//  - wordings with enough uses get a verdict (winner = used 8 times in 10 by the reply agent, retired = off)
//  - a wording that is not working gets a new one proposed by the model acting as a senior Omani real estate
//    consultant who read the conversations; proposals wait (active=false, status=proposed) for Ahmed
//  - a short report of the week goes to whatsapp_reply_coach_reports and a CRM notification
// Nothing changes what customers receive until Ahmed approves a proposal (owner JWT: {decide:{id,decision}}).
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false, autoRefreshToken: false } });
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const MODEL = Deno.env.get("REPLY_COACH_MODEL") || Deno.env.get("REPLY_AGENT_MODEL") || Deno.env.get("OPENAI_MODEL") || "gpt-5.6-luna";
const ORIGINS = ["https://omanvilla.github.io"];
const short = (v: unknown, n = 600) => { const s = String(v ?? "").trim(); return s.length > n ? s.slice(0, n) + "…" : s; };

const schema = {
  type: "object", additionalProperties: false,
  properties: {
    verdicts: { type: "array", items: { type: "object", additionalProperties: false,
      properties: { label: { type: "string" }, verdict: { type: "string", enum: ["keep_testing", "winner", "retire"] }, why: { type: "string" } },
      required: ["label", "verdict", "why"] } },
    new_reply: { type: ["string", "null"] },
    rationale: { type: "string" },
  },
  required: ["verdicts", "new_reply", "rationale"],
};

async function ai(instructions: string, input: string, sch: any, name: string) {
  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST", headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, store: false, reasoning: { effort: "medium" }, instructions, input, text: { format: { type: "json_schema", name, strict: true, schema: sch } } }),
  });
  const p = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(p?.error?.message || `openai_${r.status}`);
  return JSON.parse(p.output_text || p.output?.flatMap((x: any) => x?.content || []).find((x: any) => x?.type === "output_text")?.text || "{}");
}

// what the customer wrote after our reply, so the coach sees why it worked or not
async function afterMessages(conversationId: string, at: string) {
  const m = await db.from("whatsapp_messages").select("direction,body,transcript,message_type").eq("conversation_id", conversationId)
    .gte("message_timestamp", new Date(new Date(at).getTime() - 30 * 60000).toISOString()).order("message_timestamp").limit(10);
  return (m.data || []).map((x: any) => `${x.direction === "inbound" ? "العميل" : "المكتب"}: ${short(x.transcript || x.body || `[${x.message_type}]`, 200)}`).join("\n");
}

async function coach(companyId: string) {
  const end = new Date(), start = new Date(Date.now() - 7 * 86400000);
  const [res, rules, prompt] = await Promise.all([
    db.from("whatsapp_reply_variant_results").select("*").eq("company_id", companyId),
    db.from("whatsapp_reply_rules").select("id,situation,approved_reply,experiment_note").eq("company_id", companyId).eq("active", true),
    db.from("whatsapp_agent_prompts").select("content").eq("key", "brain").maybeSingle(),
  ]);
  // the office writing style is the first part of the brain prompt
  const brain = String(prompt.data?.content || "");
  const style = brain.slice(0, Math.max(0, brain.indexOf("# أول شي")) || 4000);
  const rows = res.data || [];
  let proposals = 0;
  const decisions: any[] = [];
  for (const rule of rules.data || []) {
    const vs = rows.filter((r: any) => r.rule_id === rule.id);
    const total = vs.reduce((a: number, v: any) => a + Number(v.uses || 0), 0);
    const ready = vs.filter((v: any) => Number(v.uses) >= Number(v.min_sample || 20));
    if (!ready.length) continue; // not enough people yet: keep testing quietly
    const pending = await db.from("whatsapp_reply_variants").select("id").eq("rule_id", rule.id).eq("status", "proposed").limit(1);
    const outs = await db.from("whatsapp_reply_variant_outcomes").select("conversation_id,sent_at,variant_label,replied,visited").eq("rule_id", rule.id).order("sent_at", { ascending: false }).limit(12);
    const samples: string[] = [];
    for (const o of (outs.data || []).slice(0, 8)) samples.push(`[الصياغة ${o.variant_label} | رد: ${o.replied ? "نعم" : "لا"} | زيارة: ${o.visited ? "نعم" : "لا"}]\n${await afterMessages(o.conversation_id, o.sent_at)}`);
    const input = [
      `الموقف: ${rule.situation}`, rule.experiment_note ? `ملاحظة المدير: ${rule.experiment_note}` : "",
      `عدد مرات الاستخدام الكلي: ${total}`,
      "الصياغات ونتائجها:",
      ...vs.map((v: any) => `- ${v.variant_label} (${v.variant_status}) استخدام ${v.uses} | ردوا ${v.replied} (${v.reply_pct ?? 0}%) | زيارات ${v.visits} (${v.visit_pct ?? 0}%) | صفقات ${v.deals}\n  النص: ${short(v.reply, 400)}`),
      "", "عينة من المحادثات بعد الرد:", ...samples,
      pending.data?.length ? "\nفي صياغة مقترحة تنتظر موافقة المدير، لا تقترح ثانية (new_reply=null)." : "",
    ].join("\n");
    const out = await ai(
      `انت مستشار عقاري خبير في عمان وتفهم الناس وطريقة الرد عليهم في الواتساب. تراجع تجربة ردود مكتب وساطة عقارية.
الهدف من الرد: العميل يرد ويتقدم لزيارة ثم شراء. قيّم كل صياغة بالأرقام (الزيارات أهم من الردود، والصفقات أهم من الكل) وبالمحادثات.
- winner بس إذا الصياغة استخدمت على الأقل الحد الأدنى وأرقامها واضح أحسن من الباقي. retire إذا واضح أضعف. غير كذا keep_testing.
- لا تغير صياغة ناجحة وتخرب الموضوع: إذا في winner قوي لا تقترح بديل إلا إذا في سبب واضح.
- إذا الصياغات ما نجحت: حلل ليش (من كلام العملاء) واقترح صياغة وحدة جديدة في new_reply. لازم تكون بنفس طريقة كتابة المكتب بالضبط (تحت)، بدون معلومة جديدة ما هي مكتوبة، وبدون وعود. كل رسالة في سطر.
- rationale: سطرين أو ثلاثة بالعربي البسيط لأحمد: وش لاحظت وليش.
طريقة كتابة المكتب:
${style}`, input, schema, "reply_coach");
    for (const v of out.verdicts || []) {
      const real = vs.find((x: any) => x.variant_label === v.label);
      if (!real || Number(real.uses) < Number(real.min_sample || 20)) continue;
      decisions.push({ rule: rule.situation, label: v.label, verdict: v.verdict, why: v.why });
      if (v.label === "A") { await db.from("whatsapp_reply_rules").update({ experiment_note: `تقييم ${end.toISOString().slice(0, 10)}: ${v.verdict} ${short(v.why, 200)}` }).eq("id", rule.id); continue; }
      if (v.verdict === "winner") await db.from("whatsapp_reply_variants").update({ status: "winner", rationale: short(v.why, 500) }).eq("rule_id", rule.id).eq("label", v.label);
      if (v.verdict === "retire") await db.from("whatsapp_reply_variants").update({ status: "retired", active: false, rationale: short(v.why, 500) }).eq("rule_id", rule.id).eq("label", v.label);
    }
    if (out.new_reply && !pending.data?.length) {
      const all = await db.from("whatsapp_reply_variants").select("label").eq("rule_id", rule.id);
      const used = new Set(["A", ...(all.data || []).map((x: any) => x.label)]);
      let label = "B"; for (const c of "BCDEFGHIJKLMNOPQRSTUVWXYZ") if (!used.has(c)) { label = c; break; }
      const ins = await db.from("whatsapp_reply_variants").insert({ company_id: companyId, rule_id: rule.id, label, reply: String(out.new_reply).trim(), active: false, status: "proposed", source: "coach", rationale: short(out.rationale, 800) });
      if (!ins.error) proposals++;
    }
  }
  // the whole week, pinned or not: how many replies went out, how many answered, visits and deals after them
  const wk = await db.from("whatsapp_reply_drafts").select("id,client_id,conversation_id,sent_at,analysis").eq("company_id", companyId).eq("status", "sent").gte("sent_at", start.toISOString());
  const byCat: Record<string, { sent: number; replied: number; visits: number }> = {};
  for (const d of wk.data || []) {
    const cat = d.analysis?.category || "unclear";
    byCat[cat] ||= { sent: 0, replied: 0, visits: 0 };
    byCat[cat].sent++;
    const rp = await db.from("whatsapp_messages").select("id").eq("conversation_id", d.conversation_id).eq("direction", "inbound").gt("message_timestamp", d.sent_at).limit(1);
    if ((rp.data || []).length) byCat[cat].replied++;
    const vv = await db.from("viewings").select("id").eq("client_id", d.client_id).gt("created_at", d.sent_at).limit(1);
    if ((vv.data || []).length) byCat[cat].visits++;
  }
  const names: Record<string, string> = { buyer: "مشتري", tenant: "مستأجر", investor: "مستثمر", seller: "مالك", general: "عام", broker: "وسيط", active_deal: "صفقة", unclear: "غير واضح" };
  const lines = Object.entries(byCat).map(([k, v]) => `${names[k] || k}: ${v.sent} رد، رجعوا ${v.replied}، زيارات ${v.visits}`);
  const summary = [
    `الأسبوع: ${lines.length ? lines.join(" | ") : "ما انرسل شي"}`,
    decisions.length ? `تقييم الردود: ${decisions.map((d) => `${short(d.rule, 40)} (${d.label}): ${d.verdict}`).join(" | ")}` : "الردود المثبتة لين الحين ما وصلت 20 استخدام، التجربة مكملة",
    proposals ? `في ${proposals} صياغة جديدة تنتظر موافقتك في شاشة الموافقة` : "",
  ].filter(Boolean).join("\n");
  await db.from("whatsapp_reply_coach_reports").insert({ company_id: companyId, period_start: start.toISOString(), period_end: end.toISOString(), stats: { byCat, decisions }, summary, proposals });
  const o = await db.from("profiles").select("id").eq("company_id", companyId).eq("role", "owner").eq("is_active", true).limit(1).maybeSingle();
  if (o.data?.id) await db.from("notifications").insert({ user_id: o.data.id, type: "reply_coach", is_read: false, link: "replies", title: proposals ? `تجارب الردود: ${proposals} صياغة جديدة تنتظرك` : "تقرير تجارب الردود الأسبوعي", body: short(summary, 400) });
  return { proposals, decisions: decisions.length, summary };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const headers = { "Access-Control-Allow-Origin": ORIGINS.includes(origin) ? origin : ORIGINS[0], "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin", "content-type": "application/json; charset=utf-8" };
  const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers });
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ ok: false }, 405);
  const body = await req.json().catch(() => ({}));
  try {
    const secret = req.headers.get("x-crm-agent") || "";
    const ok = secret ? await db.rpc("crm_reply_agent_secret_ok", { p_secret: secret }) : null;
    if (ok && !ok.error && ok.data === true) {
      const companies = await db.from("whatsapp_automation_runtime").select("company_id");
      const out: any[] = [];
      for (const c of companies.data || []) out.push(await coach(c.company_id));
      return json({ ok: true, out });
    }
    // owner: list proposals with the week's report, or approve / reject one
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const u = jwt ? await db.auth.getUser(jwt) : null;
    const prof = u?.data?.user ? await db.from("profiles").select("id,company_id,role,is_active").eq("id", u.data.user.id).maybeSingle() : null;
    if (!prof?.data || prof.data.role !== "owner" || prof.data.is_active === false) return json({ ok: false, error: "owner_only" }, 403);
    const cid = prof.data.company_id;
    if (body?.decide?.id) {
      const approve = body.decide.decision === "approve";
      const text = typeof body.decide.reply === "string" && body.decide.reply.trim() ? body.decide.reply.trim() : null;
      const patch: any = approve ? { status: "testing", active: true, created_by: prof.data.id, updated_at: new Date().toISOString() } : { status: "rejected", active: false, updated_at: new Date().toISOString() };
      if (approve && text) patch.reply = text;
      const r = await db.from("whatsapp_reply_variants").update(patch).eq("id", String(body.decide.id)).eq("company_id", cid).eq("status", "proposed").select("id");
      return json({ ok: !r.error && !!(r.data || []).length, error: r.error?.message });
    }
    const [props, rep, res] = await Promise.all([
      db.from("whatsapp_reply_variants").select("id,rule_id,label,reply,rationale,created_at").eq("company_id", cid).eq("status", "proposed").order("created_at", { ascending: false }),
      db.from("whatsapp_reply_coach_reports").select("summary,created_at").eq("company_id", cid).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      db.from("whatsapp_reply_variant_results").select("rule_id,situation,variant_label,reply,variant_status,uses,replied,visits,deals,reply_pct,visit_pct").eq("company_id", cid).order("uses", { ascending: false }).limit(40),
    ]);
    const ruleIds = [...new Set((props.data || []).map((p: any) => p.rule_id))];
    const rules = ruleIds.length ? await db.from("whatsapp_reply_rules").select("id,situation,approved_reply").in("id", ruleIds) : { data: [] };
    return json({ ok: true, proposals: (props.data || []).map((p: any) => ({ ...p, rule: ((rules as any).data || []).find((r: any) => r.id === p.rule_id) || null })), report: rep.data || null, results: res.data || [] });
  } catch (e) { return json({ ok: false, error: String((e as any)?.message || e) }, 500); }
});
