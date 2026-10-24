import { createClient } from "npm:@supabase/supabase-js@2";
const SUPABASE_URL=Deno.env.get("SUPABASE_URL")??"";
const SUPABASE_ANON_KEY=Deno.env.get("SUPABASE_ANON_KEY")??"";
const SUPABASE_SERVICE_ROLE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const CRM_COMPANY_ID=Deno.env.get("CRM_COMPANY_ID")??"";
const META_APP_SECRET=Deno.env.get("META_APP_SECRET")??"";
const META_GRAPH_VERSION=Deno.env.get("META_GRAPH_VERSION")||"v25.0";
const META_APP_ID="1639659247753419";
const MUSCAT_WABA_ID="789597320251251";
const MUSCAT_PHONE_ID="813221921874080";
const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
function json(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{...corsHeaders,"content-type":"application/json; charset=utf-8"}})}
async function graph(token:string,path:string,method:"GET"|"POST"="GET"){const r=await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${path}`,{method,headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:method==="POST"?"{}":undefined});const p=await r.json().catch(()=>({}));return{ok:r.ok,status:r.status,data:p}}
function mm(x:any){return String(x?.data?.error?.error_user_msg||x?.data?.error?.message||`Meta HTTP ${x?.status||0}`)}
function bytesToB64(bytes:Uint8Array){let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s)}
async function encryptToken(token:string,companyId:string,routeKey:string){const seed=new TextEncoder().encode(`${META_APP_SECRET}|${companyId}|${routeKey}|habib-crm-whatsapp-v1`);const digest=await crypto.subtle.digest("SHA-256",seed);const key=await crypto.subtle.importKey("raw",digest,{name:"AES-GCM"},false,["encrypt"]);const iv=crypto.getRandomValues(new Uint8Array(12));const cipher=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,new TextEncoder().encode(token));return{token_ciphertext:bytesToB64(new Uint8Array(cipher)),token_iv:bytesToB64(iv)}}
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
 if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
 if(!SUPABASE_URL||!SUPABASE_ANON_KEY||!SUPABASE_SERVICE_ROLE_KEY||!META_APP_SECRET)return json({ok:false,error:"server_not_configured"},503);
 const authHeader=req.headers.get("authorization")||""; if(!authHeader.toLowerCase().startsWith("bearer "))return json({ok:false,error:"missing_auth"},401);
 const userClient=createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{global:{headers:{Authorization:authHeader}},auth:{persistSession:false,autoRefreshToken:false}});
 const admin=createClient(SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 try{
  const {data:ud,error:ue}=await userClient.auth.getUser(); const user=ud?.user; if(ue||!user)return json({ok:false,error:"invalid_auth"},401);
  const {data:profile,error:pe}=await admin.from("profiles").select("id,company_id,role,is_active").eq("id",user.id).single();
  if(pe||!profile||profile.is_active===false)return json({ok:false,error:"profile_not_authorized"},403);
  if(profile.role!=="owner")return json({ok:false,error:"owner_required"},403);
  if(CRM_COMPANY_ID&&profile.company_id!==CRM_COMPANY_ID)return json({ok:false,error:"wrong_company"},403);
  const body=await req.json().catch(()=>({})); const routeKey=String(body?.route_key||"muscat").trim(); const token=String(body?.system_access_token||"").trim();
  if(routeKey!=="muscat")return json({ok:false,error:"muscat_only"},400); if(!token)return json({ok:false,error:"system_access_token_required"},400);
  const appToken=`${META_APP_ID}|${META_APP_SECRET}`; const dbg=await graph(appToken,`debug_token?input_token=${encodeURIComponent(token)}`);
  if(!dbg.ok||dbg.data?.data?.is_valid!==true)return json({ok:false,error:"invalid_meta_token",message:mm(dbg)},400);
  const dd=dbg.data.data||{}; if(String(dd.app_id||"")!==META_APP_ID)return json({ok:false,error:"wrong_app_token"},400);
  if(String(dd.type||"").toUpperCase()!=="SYSTEM_USER")return json({ok:false,error:"not_system_user_token",message:"هذا ليس System User token."},400);
  const scopes=Array.isArray(dd.scopes)?dd.scopes:[]; const required=["business_management","whatsapp_business_management","whatsapp_business_messaging"]; const missing=required.filter(x=>!scopes.includes(x));
  if(missing.length)return json({ok:false,error:"missing_permissions",message:`Missing: ${missing.join(',')}`},400);
  const waba=await graph(token,`${MUSCAT_WABA_ID}?fields=id,name,owner_business_info`); if(!waba.ok)return json({ok:false,error:"system_user_has_no_waba_access",message:mm(waba)},400);
  const phone=await graph(token,`${MUSCAT_PHONE_ID}?fields=id,display_phone_number,verified_name,status,platform_type,account_mode`); if(!phone.ok)return json({ok:false,error:"system_user_has_no_phone_access",message:mm(phone)},400);
  const sub=await graph(token,`${MUSCAT_WABA_ID}/subscribed_apps`,"POST"); if(!sub.ok)return json({ok:false,error:"subscribe_failed",message:mm(sub)},400);
  const enc=await encryptToken(token,String(profile.company_id),routeKey); const exp=Number(dd.expires_at||0); const expiresAt=exp>0?new Date(exp*1000).toISOString():null; const now=new Date().toISOString();
  const up=await admin.from("whatsapp_route_credentials").upsert({company_id:profile.company_id,route_key:routeKey,token_ciphertext:enc.token_ciphertext,token_iv:enc.token_iv,token_type:"system_user",meta_system_user_id:String(dd.user_id||""),meta_app_id:META_APP_ID,expires_at:expiresAt,updated_at:now},{onConflict:"company_id,route_key"});
  if(up.error)return json({ok:false,error:"credential_store_failed",message:up.error.message},500);
  await admin.from("whatsapp_onboarding_events").insert({company_id:profile.company_id,route_key:routeKey,initiated_by:user.id,configuration_id:"system-user-production-token",waba_id:MUSCAT_WABA_ID,phone_number_id:MUSCAT_PHONE_ID,display_phone_number:"+96871770030",status:"completed",completed_at:now,details:{mode:"system_user_production_token",system_user_id:String(dd.user_id||""),token_type:String(dd.type||""),scopes,expires_at:expiresAt,phone_status:phone.data?.status||null,platform_type:phone.data?.platform_type||null,app_is_subscribed:sub.data?.success===true}});
  return json({ok:true,route_key:routeKey,token_type:"system_user",system_user_id:String(dd.user_id||""),expires_at:expiresAt,phone_status:phone.data?.status||null,waba_access:true,app_is_subscribed:sub.data?.success===true});
 }catch(e){return json({ok:false,error:"internal_error",message:String((e as any)?.message||e).slice(0,1000)},500)}
});