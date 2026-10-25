// Sends a photo, video, voice note/audio file or document — or a text that
// replies to a specific message — into the conversation open in the CRM inbox,
// from that conversation's own WhatsApp number. Same guards as whatsapp-send:
// caller RLS on the conversation, owner-only investment threads, the 24-hour
// customer-service window, and an idempotent operation journal so a retry never
// sends twice. Plain text without a reply keeps using whatsapp-send.
import { createClient } from "npm:@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRM_COMPANY_ID = Deno.env.get("CRM_COMPANY_ID") ?? "";
const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const META_GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") || "v25.0";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(data: any, status = 200) {
  if (data && data.ok === false) data = { sent: false, retry_safe: true, ...data };
  return new Response(JSON.stringify(data), { status, headers: { ...cors, "content-type": "application/json; charset=utf-8" } });
}
const short = (v: unknown, max = 1024) => { const s = String(v ?? "").trim(); return s.length > max ? s.slice(0, max) : s; };
const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
function b64ToBytes(s: string) { const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
async function decryptToken(ciphertext: string, iv: string, companyId: string, routeKey: string) {
  const seed = new TextEncoder().encode(`${META_APP_SECRET}|${companyId}|${routeKey}|habib-crm-whatsapp-v1`);
  const key = await crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", seed), { name: "AES-GCM" }, false, ["decrypt"]);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64ToBytes(iv) }, key, b64ToBytes(ciphertext)));
}
// WhatsApp Cloud API accepted types and size limits per message kind.
const KINDS: Record<string, { mime: RegExp; max: number; caption: boolean; label: string }> = {
  image: { mime: /^image\/(jpeg|png)$/, max: 5 * 1024 * 1024, caption: true, label: "صورة" },
  video: { mime: /^video\/(mp4|3gpp)$/, max: 16 * 1024 * 1024, caption: true, label: "فيديو" },
  audio: { mime: /^audio\/(ogg|mpeg|mp4|aac|amr)$/, max: 16 * 1024 * 1024, caption: false, label: "رسالة صوتية" },
  document: { mime: /^(application\/(pdf|msword|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)|vnd\.ms-excel|vnd\.ms-powerpoint)|text\/plain)$/, max: 16 * 1024 * 1024, caption: true, label: "ملف" },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return json({ ok: false, error: "missing_auth" }, 401);
  let accepted: any = null, claimed = false;
  try {
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } });
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: u } = await userClient.auth.getUser(); const user = u?.user;
    if (!user) return json({ ok: false, error: "invalid_auth" }, 401);
    const { data: profile } = await admin.from("profiles").select("id,company_id,role,is_active").eq("id", user.id).single();
    if (!profile || profile.is_active === false || !["owner", "manager", "agent"].includes(String(profile.role))) return json({ ok: false, error: "whatsapp_send_not_allowed" }, 403);
    if (CRM_COMPANY_ID && profile.company_id !== CRM_COMPANY_ID) return json({ ok: false, error: "wrong_company" }, 403);
    const companyId = profile.company_id;

    const body = await req.json().catch(() => null);
    const conversationId = String(body?.conversation_id || "").trim();
    const operationId = String(body?.operation_id || "").trim();
    const caption = short(body?.body, 1024);
    const replyTo = String(body?.reply_to || "").trim();
    const requestId = String(body?.request_id || "").trim();
    const media = body?.media && typeof body.media === "object" ? body.media : null;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) return json({ ok: false, error: "operation_id_required" }, 400);
    if (!/^[0-9a-f-]{36}$/i.test(conversationId)) return json({ ok: false, error: "conversation_required" }, 400);
    if (replyTo && !/^wamid\.[A-Za-z0-9+/=_-]{10,300}$/.test(replyTo)) return json({ ok: false, error: "invalid_reply_target" }, 400);
    let kind = "", mime = "", filename = "", bytes: Uint8Array | null = null;
    if (media) {
      kind = String(media.kind || ""); mime = String(media.mime || "").toLowerCase().split(";")[0].trim();
      filename = short(media.filename, 120).replace(/[\\/\u0000-\u001f]/g, "_") || "file";
      const spec = KINDS[kind];
      if (!spec || !spec.mime.test(mime)) return json({ ok: false, error: "unsupported_media_type", message: "صيغة الملف غير مدعومة في واتساب." }, 400);
      try { bytes = b64ToBytes(String(media.data || "")); } catch { return json({ ok: false, error: "invalid_media_data" }, 400); }
      if (!bytes.length) return json({ ok: false, error: "invalid_media_data" }, 400);
      if (bytes.length > spec.max) return json({ ok: false, error: "media_size_limit", message: `حجم ${spec.label} أكبر من المسموح في واتساب.` }, 413);
    } else if (!caption) return json({ ok: false, error: "message_required" }, 400);
    if (!media && !replyTo) return json({ ok: false, error: "use_whatsapp_send_for_plain_text" }, 400);

    // Caller RLS decides access to the conversation (branch separation); investment threads stay owner-only.
    const visible = await userClient.from("whatsapp_conversations").select("id,client_id,route_key,meta_phone_number_id,last_inbound_at")
      .eq("company_id", companyId).eq("id", conversationId).maybeSingle();
    if (visible.error) return json({ ok: false, error: "conversation_access_unavailable" }, 503);
    const conversation = visible.data;
    if (!conversation) return json({ ok: false, error: "conversation_not_authorized" }, 403);
    if (conversation.route_key === "investment" && profile.role !== "owner") return json({ ok: false, error: "conversation_not_authorized" }, 403);
    const { data: routes } = await admin.from("company_lead_routes").select("route_key,owner_only_inbox").eq("company_id", companyId);
    if (profile.role !== "owner" && (routes || []).some((r: any) => r.route_key === conversation.route_key && r.owner_only_inbox === true)) return json({ ok: false, error: "conversation_not_authorized" }, 403);
    if (!conversation.client_id) return json({ ok: false, error: "conversation_has_no_client" }, 409);
    const { data: client } = await admin.from("clients").select("id,phone,lead_route").eq("company_id", companyId).eq("id", conversation.client_id).maybeSingle();
    if (!client) return json({ ok: false, error: "client_not_found" }, 404);
    if (client.lead_route === "investment" && profile.role !== "owner") return json({ ok: false, error: "client_not_found" }, 404);
    const to = digits(client.phone);
    if (to.length < 7 || to.length > 15) return json({ ok: false, error: "invalid_client_phone" }, 400);
    const lastInbound = conversation.last_inbound_at ? Date.parse(conversation.last_inbound_at) : 0;
    if (!lastInbound || Date.now() - lastInbound >= 24 * 3600 * 1000)
      return json({ ok: false, error: "outside_customer_service_window", message: "آخر رسالة من العميل أقدم من 24 ساعة؛ واتساب لا يسمح بالرد الحر الآن. تابعه من تطبيق واتساب أو بقالب معتمد." }, 409);
    let resolvedRequestId: string | null = null;
    if (requestId) {
      const rr = await userClient.from("client_requests").select("id").eq("company_id", companyId).eq("client_id", client.id).eq("id", requestId).maybeSingle();
      if (rr.data) resolvedRequestId = rr.data.id;
    }
    if (replyTo) {
      const target = await userClient.from("whatsapp_messages").select("id").eq("company_id", companyId).eq("conversation_id", conversation.id).eq("whatsapp_message_id", replyTo).maybeSingle();
      if (!target.data) return json({ ok: false, error: "reply_target_not_in_conversation" }, 400);
    }

    const senderPhoneId = digits(conversation.meta_phone_number_id);
    if (!senderPhoneId) return json({ ok: false, error: "conversation_sender_missing" }, 409);
    const { data: routeData } = await admin.rpc("resolve_whatsapp_route", { p_company_id: companyId, p_meta_phone_number_id: senderPhoneId });
    const route = Array.isArray(routeData) ? routeData[0] : routeData;
    const transport = String(route?.route_key || "");
    if (!route?.whatsapp_number || !["muscat", "barka"].includes(transport)) return json({ ok: false, error: "sender_not_configured" }, 409);
    const tokens: Array<{ token: string; source: string }> = [];
    try {
      const cr = await admin.from("whatsapp_route_credentials").select("token_ciphertext,token_iv,token_type,expires_at").eq("company_id", companyId).eq("route_key", transport).maybeSingle();
      if (cr.data && (!cr.data.expires_at || Date.parse(cr.data.expires_at) > Date.now() + 60000))
        tokens.push({ token: await decryptToken(cr.data.token_ciphertext, cr.data.token_iv, String(companyId), transport), source: `route_${cr.data.token_type || "credential"}` });
    } catch (e) { console.error("[whatsapp-send-media] credential", String((e as any)?.message || e)); }
    if (WHATSAPP_ACCESS_TOKEN && !tokens.some((t) => t.token === WHATSAPP_ACCESS_TOKEN)) tokens.push({ token: WHATSAPP_ACCESS_TOKEN, source: "server_system_user" });
    if (!tokens.length) return json({ ok: false, error: "no_send_credential" }, 409);

    const mediaHash = bytes ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((x) => x.toString(16).padStart(2, "0")).join("") : "";
    const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({ c: conversation.id, caption, replyTo, kind, mime, mediaHash, senderPhoneId })))))
      .map((x) => x.toString(16).padStart(2, "0")).join("");
    const opFilter = { company_id: companyId, user_id: user.id, operation_key: operationId };
    const claim = await admin.from("whatsapp_send_operations").insert({ ...opFilter, client_id: client.id, conversation_id: conversation.id, crm_request_id: resolvedRequestId, payload_hash: fingerprint, status: "processing" });
    if (claim.error) {
      if (claim.error.code !== "23505") return json({ ok: false, error: "send_journal_unavailable", message: "تعذر تأمين سجل الإرسال ولم تُرسل الرسالة." }, 503);
      const existing = await admin.from("whatsapp_send_operations").select("payload_hash,status,result").eq("company_id", companyId).eq("user_id", user.id).eq("operation_key", operationId).maybeSingle();
      if (!existing.data || existing.data.payload_hash !== fingerprint) return json({ ok: false, error: "operation_conflict", sent: false, retry_safe: false }, 409);
      if (existing.data.result) return json({ ...existing.data.result, replayed: true });
      return json({ ok: false, error: "send_in_progress", sent: null, retry_safe: false, message: "محاولة الإرسال قيد المعالجة. لم نكرر الإرسال." });
    }
    claimed = true;
    const finish = async (status: string, result: any) => {
      const r = await admin.from("whatsapp_send_operations").update({ status, result, updated_at: new Date().toISOString() }).eq("company_id", companyId).eq("user_id", user.id).eq("operation_key", operationId);
      return !r.error;
    };

    let sent: any = null, source = "", mediaId = "", lastError: any = null;
    for (const t of tokens) {
      try {
        let payload: any = { messaging_product: "whatsapp", recipient_type: "individual", to };
        if (replyTo) payload.context = { message_id: replyTo };
        if (bytes) {
          // Upload is not a message; a rejected upload is safe to retry with another credential.
          const form = new FormData();
          form.append("messaging_product", "whatsapp"); form.append("type", mime);
          form.append("file", new Blob([bytes], { type: mime }), filename);
          const up = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${senderPhoneId}/media`, { method: "POST", headers: { Authorization: `Bearer ${t.token}` }, body: form, signal: AbortSignal.timeout(60000) });
          const upData = await up.json().catch(() => ({}));
          if (!up.ok || !upData?.id) { lastError = { status: up.status, code: upData?.error?.code, message: upData?.error?.error_user_msg || upData?.error?.message || `upload ${up.status}` }; if ([190, 10, 200].includes(Number(upData?.error?.code))) continue; break; }
          mediaId = String(upData.id);
          const obj: any = { id: mediaId };
          if (KINDS[kind].caption && caption) obj.caption = caption;
          if (kind === "document") obj.filename = filename;
          payload.type = kind; payload[kind] = obj;
        } else {
          payload.type = "text"; payload.text = { preview_url: false, body: caption };
        }
        let r: Response;
        try { r = await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${senderPhoneId}/messages`, { method: "POST", headers: { Authorization: `Bearer ${t.token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30000) }); }
        catch {
          const unknown = { ok: false, error: "send_status_unknown", sent: null, recorded: false, retry_safe: false, message: "انقطع الاتصال أثناء الإرسال وقد تكون الرسالة وصلت. افحص المحادثة ولا تعِد الإرسال." };
          await finish("unknown", unknown); return json(unknown);
        }
        const data = await r.json().catch(() => ({}));
        if (r.ok && data?.messages?.[0]?.id) { sent = data; source = t.source; break; }
        lastError = { status: r.status, code: data?.error?.code, message: data?.error?.error_user_msg || data?.error?.message || `Meta HTTP ${r.status}` };
        if (![190, 10, 200].includes(Number(data?.error?.code))) break;
      } catch (e) { lastError = { message: String((e as any)?.message || e) }; break; }
    }
    if (!sent) {
      const uncertain = Number(lastError?.status) >= 500 || Number(lastError?.status) === 408;
      const result = { ok: false, error: uncertain ? "send_status_unknown" : "meta_send_failed", sent: uncertain ? null : false, recorded: false, retry_safe: !uncertain, message: uncertain ? "حالة الإرسال غير مؤكدة. افحص المحادثة قبل أي محاولة جديدة." : (lastError?.message || "تعذر الإرسال") };
      await finish(uncertain ? "unknown" : "failed", result); return json(result);
    }
    const wamid = String(sent.messages[0].id), now = new Date().toISOString();
    accepted = { ok: true, sent: true, recorded: true, retry_safe: false, message_id: wamid, conversation_id: conversation.id, kind: kind || "text", media_id: mediaId || null, sent_at: now };
    const failures: string[] = [];
    const label = kind ? KINDS[kind].label : "رد";
    const ins = await admin.from("whatsapp_messages").insert({
      company_id: companyId, conversation_id: conversation.id, client_id: client.id, request_id: resolvedRequestId, sent_by_user_id: user.id,
      actor_type: "human", channel_source: "crm", whatsapp_message_id: wamid, direction: "outbound", message_type: kind || "text",
      sender_wa_id: senderPhoneId, recipient_wa_id: to, body: caption || (kind === "document" ? filename : null), media_id: mediaId || null,
      reply_to_message_id: replyTo || null, message_timestamp: now, delivery_status: "sent",
      raw_payload: { source: "crm_media_send", credential_source: source, sent_by: user.id, operation_id: operationId, transport_route_key: transport,
        media: kind ? { kind, mime_type: mime, filename, size: bytes?.length || 0, id: mediaId } : null, context: replyTo ? { id: replyTo } : null,
        ...(kind === "document" ? { document: { filename } } : {}), graph_response: sent },
    });
    if (ins.error && ins.error.code !== "23505") failures.push("message_history");
    const cu = await admin.from("clients").update({ last_contact_at: now }).eq("id", client.id).eq("company_id", companyId);
    if (cu.error) failures.push("client_contact_time");
    const text = `رسالة واتساب مرسلة من CRM (${label}): ${short(caption || filename, 900)}`;
    const act = await admin.from("activities").insert({ company_id: companyId, user_id: user.id, client_id: client.id, request_id: resolvedRequestId, type: "whatsapp", description: text, activity_type: "whatsapp", activity_text: text, channel: "whatsapp", direction: "outbound", actor_type: "human", occurred_at: now, outcome: "sent", after_data: { conversation_id: conversation.id, whatsapp_message_id: wamid, kind: kind || "text", operation_id: operationId } });
    if (act.error) failures.push("activity_history");
    const result = { ...accepted, recorded: failures.length === 0, recording_failures: failures, ...(failures.length ? { warning: "sent_but_not_recorded", message: "أُرسلت الرسالة لكن لم يكتمل حفظ سجلها. لا تعِد إرسالها." } : {}) };
    await finish("sent", result);
    return json(result);
  } catch (err) {
    console.error("[whatsapp-send-media]", String((err as any)?.message || err));
    if (accepted) return json({ ...accepted, recorded: false, warning: "sent_but_not_recorded", message: "أُرسلت الرسالة لكن تعذر إكمال سجلها. لا تعِد إرسالها." });
    if (claimed) return json({ ok: false, error: "send_status_unknown", sent: null, recorded: false, retry_safe: false, message: "تعذر تأكيد حالة المحاولة. افحص المحادثة قبل أي إرسال جديد." });
    return json({ ok: false, error: "internal_error" }, 500);
  }
});
