import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CRM_COMPANY_ID = Deno.env.get("CRM_COMPANY_ID") ?? "";
const META_APP_SECRET = Deno.env.get("META_APP_SECRET") ?? "";
const META_GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") || "v25.0";
const WHATSAPP_ACCESS_TOKEN = Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "";
const META_APP_ID = "1639659247753419";
const META_SYSTEM_USER_ID = "122107255011470763";
const DEFAULT_CONFIGURATION_ID = "1790225632111798";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers:{...corsHeaders,"content-type":"application/json; charset=utf-8"} }); }
function digits(v: unknown) { return String(v ?? "").replace(/\D/g, ""); }
function e164(v: unknown) { const d=digits(v); return d?`+${d}`:null; }
async function graphJson(url:string, token:string, init:RequestInit={}){
  const headers=new Headers(init.headers||{}); headers.set("Authorization",`Bearer ${token}`);
  if(!headers.has("Content-Type")&&init.method&&init.method!=="GET") headers.set("Content-Type","application/json");
  const r=await fetch(url,{...init,headers}); const p=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(p?.error?.error_user_msg||p?.error?.message||`Meta HTTP ${r.status}`); return p;
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:corsHeaders});
  if(req.method!=="POST") return json({ok:false,error:"method_not_allowed"},405);
  if(!SUPABASE_URL||!SUPABASE_ANON_KEY||!SUPABASE_SERVICE_ROLE_KEY||!META_APP_SECRET) return json({ok:false,error:"server_not_configured"},503);
  const authHeader=req.headers.get("authorization")||""; if(!authHeader.toLowerCase().startsWith("bearer ")) return json({ok:false,error:"missing_auth"},401);
  const userClient=createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{global:{headers:{Authorization:authHeader}},auth:{persistSession:false,autoRefreshToken:false}});
  const admin=createClient(SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  let eventId:string|null=null;
  try{
    const {data:ud,error:ue}=await userClient.auth.getUser(); const user=ud?.user; if(ue||!user) return json({ok:false,error:"invalid_auth"},401);
    const {data:profile,error:pe}=await admin.from("profiles").select("id,company_id,role,is_active,full_name").eq("id",user.id).single();
    if(pe||!profile||profile.is_active===false) return json({ok:false,error:"profile_not_authorized"},403);
    if(!['owner','manager'].includes(profile.role)) return json({ok:false,error:"owner_or_manager_required"},403);
    if(CRM_COMPANY_ID&&profile.company_id!==CRM_COMPANY_ID) return json({ok:false,error:"wrong_company"},403);

    const body=await req.json().catch(()=>({}));
    const code=String(body?.code||"").trim(); const routeKey=String(body?.route_key||"investment").trim();
    const sessionInfo=body?.session_info&&typeof body.session_info==='object'?body.session_info:{};
    if(!code) return json({ok:false,error:"code_required"},400);
    if(!['investment','muscat','barka'].includes(routeKey)) return json({ok:false,error:"invalid_route"},400);

    if(routeKey==="investment"&&(profile.role!=="owner"||profile.is_active!==true))return json({ok:false,error:"owner_required"},403);
    if(routeKey==="investment")return json({ok:false,error:"investment_uses_muscat",route_key:"investment",transport_route_key:"muscat",message:"استقبال المستثمرين يستخدم رقم مسقط. لا يوجد ربط مستقل لرقم المستثمر."},409);

    const {data:route,error:re}=await admin.from("company_lead_routes")
      .select("id,route_key,whatsapp_number,meta_phone_number_id,meta_waba_id,meta_login_configuration_id,is_active")
      .eq("company_id",profile.company_id).eq("route_key",routeKey).single();
    if(re||!route) return json({ok:false,error:"route_not_found"},404);
    const configId=String(body?.configuration_id||route.meta_login_configuration_id||DEFAULT_CONFIGURATION_ID);

    const ev=await admin.from("whatsapp_onboarding_events").insert({company_id:profile.company_id,route_key:routeKey,initiated_by:user.id,configuration_id:configId,status:'started',details:{mode:'embedded_signup_v5',session_info:sessionInfo}}).select("id").single();
    eventId=ev.data?.id||null;

    const qs=new URLSearchParams({client_id:META_APP_ID,client_secret:META_APP_SECRET,code});
    const tokenRes=await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token?${qs.toString()}`);
    const tokenPayload=await tokenRes.json().catch(()=>({}));
    if(!tokenRes.ok||!tokenPayload?.access_token) throw new Error(tokenPayload?.error?.message||"code_exchange_failed");
    const businessToken=String(tokenPayload.access_token);

    const appToken=`${META_APP_ID}|${META_APP_SECRET}`;
    const debug=await graphJson(`https://graph.facebook.com/${META_GRAPH_VERSION}/debug_token?input_token=${encodeURIComponent(businessToken)}`,appToken);
    const granular=Array.isArray(debug?.data?.granular_scopes)?debug.data.granular_scopes:[];
    const waScopes=granular.filter((x:any)=>['whatsapp_business_management','whatsapp_business_messaging'].includes(String(x?.scope||'')));
    const targetIds=[...new Set(waScopes.flatMap((x:any)=>Array.isArray(x?.target_ids)?x.target_ids:[]).map(String))];

    let wabaId=String(sessionInfo?.waba_id||sessionInfo?.wabaID||"").trim();
    const sessionPhoneId=String(sessionInfo?.phone_number_id||sessionInfo?.phoneNumberId||"").trim();
    if(!wabaId&&targetIds.length===1) wabaId=targetIds[0];
    if(!wabaId&&route.meta_waba_id) wabaId=String(route.meta_waba_id);
    if(!wabaId) throw new Error("Could not determine WABA ID from Embedded Signup completion");

    const phonePayload=await graphJson(`https://graph.facebook.com/${META_GRAPH_VERSION}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,platform_type,status,account_mode`,businessToken);
    const phones=Array.isArray(phonePayload?.data)?phonePayload.data:[]; if(!phones.length) throw new Error("No WhatsApp phone numbers were returned for the onboarded WABA");
    let phone:any=null;
    if(sessionPhoneId) phone=phones.find((p:any)=>String(p.id)===sessionPhoneId)||null;
    if(!phone&&route.whatsapp_number){const wanted=digits(route.whatsapp_number);phone=phones.find((p:any)=>digits(p.display_phone_number)===wanted)||null;}
    if(!phone&&phones.length===1) phone=phones[0];
    if(!phone) throw new Error("More than one phone number is available and the intended route number could not be matched");
    const phoneId=String(phone.id); const displayNumber=e164(phone.display_phone_number)||e164(route.whatsapp_number);

    const sub=await graphJson(`https://graph.facebook.com/${META_GRAPH_VERSION}/${wabaId}/subscribed_apps`,businessToken,{method:'POST',body:'{}'});
    if(sub?.success!==true) throw new Error("Meta did not confirm subscribed_apps");

    let systemTokenAccess=false,assignmentAttempted=false,assignmentSucceeded=false,assignmentError:null|string=null;
    if(WHATSAPP_ACCESS_TOKEN){
      try{await graphJson(`https://graph.facebook.com/${META_GRAPH_VERSION}/${wabaId}?fields=id,name`,WHATSAPP_ACCESS_TOKEN);systemTokenAccess=true;}
      catch{
        assignmentAttempted=true;
        try{
          const params=new URLSearchParams({user:META_SYSTEM_USER_ID,tasks:JSON.stringify(['MANAGE'])});
          const assigned=await graphJson(`https://graph.facebook.com/${META_GRAPH_VERSION}/${wabaId}/assigned_users?${params.toString()}`,businessToken,{method:'POST',body:'{}'});
          assignmentSucceeded=assigned?.success===true;
        }catch(e){assignmentError=String((e as any)?.message||e).slice(0,700);}
        if(assignmentSucceeded){try{await graphJson(`https://graph.facebook.com/${META_GRAPH_VERSION}/${wabaId}?fields=id,name`,WHATSAPP_ACCESS_TOKEN);systemTokenAccess=true;}catch{/* keep false */}}
      }
    }

    const now=new Date().toISOString();
    const {error:updateError}=await admin.from("company_lead_routes").update({meta_phone_number_id:phoneId,meta_waba_id:wabaId,meta_login_configuration_id:configId,whatsapp_number:displayNumber||route.whatsapp_number,is_active:true,updated_at:now}).eq("id",route.id).eq("company_id",profile.company_id);
    if(updateError) throw new Error(`route_update_failed: ${updateError.message}`);

    if(eventId) await admin.from("whatsapp_onboarding_events").update({waba_id:wabaId,phone_number_id:phoneId,display_phone_number:displayNumber,status:'completed',completed_at:now,details:{mode:'embedded_signup_v5',session_info:sessionInfo,debug_target_ids:targetIds,debug_scopes:waScopes.map((x:any)=>x.scope),verified_name:phone.verified_name||null,quality_rating:phone.quality_rating||null,platform_type:phone.platform_type||null,phone_status:phone.status||null,account_mode:phone.account_mode||null,subscribed_apps:true,system_token_waba_access:systemTokenAccess,assignment_attempted:assignmentAttempted,assignment_succeeded:assignmentSucceeded,assignment_error:assignmentError}}).eq("id",eventId);

    await admin.from("activities").insert({company_id:profile.company_id,user_id:user.id,activity_type:'whatsapp',activity_text:`تم ربط واتساب ${displayNumber||phoneId} بمسار ${routeKey} عبر Meta Embedded Signup`,actor_type:'human',channel:'whatsapp',direction:'internal',occurred_at:now});
    return json({ok:true,route_key:routeKey,waba_id:wabaId,phone_number_id:phoneId,display_phone_number:displayNumber,verified_name:phone.verified_name||null,subscribed_apps:true,system_token_waba_access:systemTokenAccess,assignment_attempted:assignmentAttempted,assignment_succeeded:assignmentSucceeded,assignment_error:assignmentError});
  }catch(err){
    const message=String((err as any)?.message||err).slice(0,1500); console.error('[whatsapp-embedded-signup]',message);
    if(eventId) await admin.from("whatsapp_onboarding_events").update({status:'failed',completed_at:new Date().toISOString(),details:{mode:'embedded_signup_v3',error:message}}).eq("id",eventId);
    return json({ok:false,error:'embedded_signup_failed',message},500);
  }
});
