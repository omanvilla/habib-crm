import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") || "gpt-5.6-luna";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "content-type": "application/json; charset=utf-8" },
  });
}

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    seriousness_score: { type: "integer", minimum: 0, maximum: 100 },
    seriousness_label: { type: "string", enum: ["serious", "promising", "uncertain", "low_intent"] },
    summary: { type: "string" },
    positive_signals: { type: "array", maxItems: 8, items: { type: "string" } },
    concerns: { type: "array", maxItems: 8, items: { type: "string" } },
    learned_preferences: { type: "array", maxItems: 10, items: { type: "string" } },
    avoid_features: { type: "array", maxItems: 10, items: { type: "string" } },
    recommended_properties: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          property_id: { type: "string" },
          reason: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["property_id", "reason", "confidence"],
      },
    },
    next_best_action: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: [
    "seriousness_score", "seriousness_label", "summary", "positive_signals", "concerns",
    "learned_preferences", "avoid_features", "recommended_properties", "next_best_action", "confidence",
  ],
};

// Owner-visible private evidence must not be copied to a shared AI cache.
// The database classifies actual rows and all indirect references centrally.
async function investmentSafeSharedEvidence(db: any, companyId: string, groups: Record<string, any[]>, privateTarget: boolean, parentClientId: string | null = null) {
  const role = await db.rpc("my_role");
  if (role.error || !role.data) throw new Error("privacy_evidence_unavailable");
  // Non-owner source queries already obey the restrictive database policies.
  if (role.data !== "owner" || privateTarget) return groups;
  const tables: Record<string, string> = {
    requests: "client_requests", inquiries: "property_inquiries", allRelations: "property_inquiries",
    viewings: "viewings", rejections: "property_rejection_reasons", deals: "deals",
    messages: "whatsapp_messages", properties: "properties", marketing: "property_marketing_events",
  };
  const refs: Array<{ table: string; id: string }> = [];
  for (const [group, rows] of Object.entries(groups)) for (const row of rows) {
    if (!tables[group] || !row.id) throw new Error("privacy_evidence_unavailable");
    refs.push({ table: tables[group], id: String(row.id) });
  }
  if (!refs.length) return groups;
  if (refs.length > 1000) throw new Error("privacy_evidence_limit");
  const result = await db.rpc("crm_shared_ai_evidence_mask", { p_rows: refs });
  if (result.error || !Array.isArray(result.data) || result.data.length !== refs.length || result.data.some((allowed: any) => typeof allowed !== "boolean")) throw new Error("privacy_evidence_unavailable");
  let index = 0;
  return Object.fromEntries(Object.entries(groups).map(([group, rows]) => [group, rows.filter(() => result.data[index++] === true)]));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return json({ ok: false, error: "server_not_configured" }, 503);
  if (!OPENAI_API_KEY) return json({ ok: false, error: "openai_not_configured" }, 503);

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json({ ok: false, error: "missing_auth" }, 401);

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser(authHeader.slice(7));
  if (userError || !userData?.user) return json({ ok: false, error: "invalid_auth" }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400); }
  const clientId = String(body?.client_id || "").trim();
  if (!clientId) return json({ ok: false, error: "client_id_required" }, 400);

  const clientR = await supabase.from("clients")
    .select("id,company_id,name,phone,client_type,lead_route,source,preferred_area,property_type,budget_min,budget_max,status,notes,is_buyer,is_seller,is_investor,importance,readiness,payment_method,purchase_timing,purpose,wilayat,lead_score,lead_temperature,created_at,human_contact_at,followup_suppressed")
    .eq("id", clientId).single();
  if (clientR.error || !clientR.data) return json({ ok: false, error: clientR.error?.message || "client_not_found" }, 404);
  const client = clientR.data;

  const [requestsR, inquiriesR, viewingsR, rejectionsR, dealsR, messagesR, propertiesR] = await Promise.all([
    supabase.from("client_requests")
      .select("id,request_type,property_type,property_types,preferred_area,preferred_areas,wilayat,budget_min,budget_max,payment_method,purchase_timing,purpose,bedrooms_min,bathrooms_min,land_size_min,land_size_max,built_size_min,built_size_max,status,pipeline_stage,lead_score,lead_temperature,search_status,must_haves,flexible_preferences,decision_maker_status,next_action,created_at,updated_at,first_human_response_at,first_mutual_dialogue_at,first_attended_at,serious_interest_at,negotiation_started_at,deposit_paid_at,closed_won_at,last_mutual_contact_at")
      .eq("client_id", clientId).order("created_at", { ascending: false }).limit(30),
    supabase.from("property_inquiries")
      .select("id,request_id,property_id,status,source,shown_by_agent,has_inbound_inquiry,viewing_booked,viewing_completed,post_visit_interest,outcome,rejection_reason,rejection_notes,match_notes,client_response,first_inquiry_at,last_inquiry_at,inquiry_count,property:properties(id,title,area,wilayat,price,bedrooms,bathrooms,land_size,built_size,description,public_details)")
      .eq("client_id", clientId).order("last_inquiry_at", { ascending: false }).limit(100),
    supabase.from("viewings")
      .select("id,request_id,property_id,viewing_date,status,attendance,client_feedback,rejection_reason,liked,next_step,followup_date,notes,pipeline_outcome,outcome_note,property:properties(id,title,area,wilayat,price,bedrooms,bathrooms,land_size,built_size,description,public_details)")
      .eq("client_id", clientId).eq("archived", false).order("viewing_date", { ascending: false }).limit(100),
    supabase.from("property_rejection_reasons")
      .select("id,request_id,property_id,phase,note,is_primary,created_at,reason:rejection_reasons(code,label_ar,category),property:properties(id,title,area,wilayat,price,bedrooms,bathrooms,land_size,built_size,description,public_details)")
      .eq("client_id", clientId).order("created_at", { ascending: false }).limit(150),
    supabase.from("deals")
      .select("id,request_id,property_id,stage,deal_value,deposit_amount,closing_probability,bank_financing,notes,lost_reason_note,lost_from_stage,lost_at,created_at,updated_at,property:properties(id,title,area,price)")
      .eq("client_id", clientId).order("created_at", { ascending: false }).limit(100),
    supabase.from("whatsapp_messages")
      .select("id,direction,actor_type,body,message_timestamp,matched_property_id,request_id,conversation_id")
      .eq("client_id", clientId).order("message_timestamp", { ascending: false }).limit(80),
    supabase.from("properties")
      .select("id,title,type,area,wilayat,price,bedrooms,bathrooms,land_size,built_size,status,description,public_details,property_code,internal_name,branch_key,owner_client_id")
      .eq("archived", false).neq("status", "sold").neq("status", "not_available").order("created_at", { ascending: false }).limit(150),
  ]);

  for (const r of [requestsR, inquiriesR, viewingsR, rejectionsR, dealsR, messagesR, propertiesR]) {
    if (r.error) return json({ ok: false, error: r.error.message }, 400);
  }

  let safeEvidence: Record<string, any[]>;
  try {
    safeEvidence = await investmentSafeSharedEvidence(supabase, client.company_id, {
      requests: requestsR.data || [], inquiries: inquiriesR.data || [], viewings: viewingsR.data || [],
      rejections: rejectionsR.data || [], deals: dealsR.data || [], messages: messagesR.data || [], properties: propertiesR.data || [],
    }, client.lead_route === "investment", clientId);
  } catch {
    return json({ ok: false, error: "privacy_evidence_unavailable", saved: false }, 503);
  }
  const { requests, inquiries, viewings, rejections, deals, messages, properties } = safeEvidence;

  const metrics = {
    requests_total: requests.length,
    active_requests: requests.filter((x:any) => x.status === "active").length,
    properties_shown: new Set(inquiries.filter((x:any) => x.shown_by_agent).map((x:any) => x.property_id)).size,
    completed_viewings: viewings.filter((x:any) => x.status === "done").length,
    no_shows: viewings.filter((x:any) => x.status === "no_show").length,
    rejected_properties: new Set(rejections.map((x:any) => x.property_id)).size,
    negotiation_journeys: deals.filter((x:any) => ["negotiation","deposit","awaiting_finance","finance_approved","awaiting_clearance","ownership_transfer","closed","commission_collected"].includes(x.stage)).length,
    lost_journeys: deals.filter((x:any) => x.stage === "lost").length,
    won_deals: deals.filter((x:any) => ["closed","commission_collected"].includes(x.stage)).length,
    inbound_whatsapp: messages.filter((x:any) => x.direction === "inbound").length,
    human_outbound_whatsapp: messages.filter((x:any) => x.direction === "outbound" && x.actor_type === "human").length,
  };

  const context = {
    client,
    metrics,
    requests,
    property_journey: inquiries.map((x:any) => ({
      request_id:x.request_id, status:x.status, shown_by_agent:x.shown_by_agent, has_inbound_inquiry:x.has_inbound_inquiry,
      viewing_booked:x.viewing_booked, viewing_completed:x.viewing_completed, post_visit_interest:x.post_visit_interest,
      outcome:x.outcome, rejection_reason:x.rejection_reason, rejection_notes:x.rejection_notes, client_response:x.client_response,
      property:x.property,
    })),
    viewings: viewings.map((x:any) => ({
      viewing_date:x.viewing_date,status:x.status,attendance:x.attendance,client_feedback:x.client_feedback,rejection_reason:x.rejection_reason,
      liked:x.liked,next_step:x.next_step,notes:x.notes,pipeline_outcome:x.pipeline_outcome,outcome_note:x.outcome_note,property:x.property,
    })),
    structured_rejections: rejections.map((x:any) => ({
      phase:x.phase,note:x.note,is_primary:x.is_primary,reason:Array.isArray(x.reason)?x.reason[0]:x.reason,property:x.property,
    })),
    deals,
    recent_messages: messages.slice(0,40).map((x:any) => ({direction:x.direction,actor_type:x.actor_type,body:x.body,message_timestamp:x.message_timestamp})),
    available_properties: properties,
  };

  const instructions = `You are a real-estate CRM analyst for Habib Sons Real Estate in Oman. Analyze ONE customer from CRM evidence only and return Arabic suitable for the office team.

GOALS:
1) Estimate purchase intent / seriousness without insulting or labeling the customer as a time-waster.
2) Learn stable preferences and repeated deal-breakers from their history.
3) Recommend available CRM properties only when the supplied data supports the match.
4) Give one operational next-best action.

STRICT RULES:
- Never state that a customer is "wasting time" as a fact. Use labels: serious, promising, uncertain, low_intent and explain evidence.
- Multiple property viewings alone are NOT evidence of low intent. A serious buyer may reasonably compare many properties.
- Strong positive evidence includes: clear requirements, consistent budget, two-way dialogue, attending viewings, asking specific questions, negotiation, financing readiness, deposit, decision-maker involvement.
- Concerns may include: repeated no-shows, long non-response, contradictory requirements, constantly changing constraints, many visits with no specific feedback, or no progression — but only if supported by data.
- Distinguish "property did not fit" from "customer is not serious".
- Learn exact repeated rejection reasons. Example: if a customer rejected a property because a downstairs bedroom lacks a bathroom, record that as an avoid/deal-breaker only if CRM notes explicitly say so.
- NEVER infer a property feature that is not present in property fields, description, or public_details.
- Recommended property_id MUST be copied exactly from available_properties. Do not invent IDs. If no strong match exists, return an empty recommended_properties array.
- Prefer active request requirements over obsolete historical requests.
- Price/budget matching should use CRM numbers; do not invent market values.
- Be concise and operational.
`;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      store: false,
      reasoning: { effort: "low" },
      instructions,
      input: JSON.stringify(context),
      text: { format: { type: "json_schema", name: "client_sales_insight", strict: true, schema } },
    }),
  });
  const payload = await response.json();
  if (!response.ok) return json({ ok: false, error: payload?.error?.message || `OpenAI ${response.status}` }, 502);
  const outputText = payload?.output_text || payload?.output?.flatMap((x:any)=>x?.content||[]).find((x:any)=>x?.type==="output_text")?.text;
  if (!outputText) return json({ ok: false, error: "no_ai_output" }, 502);

  let insight:any;
  try { insight = JSON.parse(outputText); } catch { return json({ ok: false, error: "invalid_ai_output" }, 502); }

  const allowed = new Set(properties.map((p:any) => String(p.id)));
  insight.recommended_properties = (Array.isArray(insight.recommended_properties) ? insight.recommended_properties : [])
    .filter((x:any) => allowed.has(String(x.property_id)))
    .slice(0, 8);

  const now = new Date().toISOString();
  const updateR = await supabase.from("clients").update({ last_ai_profile: insight, last_ai_profile_at: now }).eq("id", clientId);
  if (updateR.error) return json({ ok: false, error: updateR.error.message }, 400);

  return json({ ok: true, insight, metrics, analyzed_at: now });
});
