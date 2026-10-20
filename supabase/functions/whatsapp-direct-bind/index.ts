import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")??"";
const SUPABASE_ANON_KEY=Deno.env.get("SUPABASE_ANON_KEY")??"";
const SUPABASE_SERVICE_ROLE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const CRM_COMPANY_ID=Deno.env.get("CRM_COMPANY_ID")??"";
const META_APP_SECRET=Deno.env.get("META_APP_SECRET")??"";
const META_GRAPH_VERSION=Deno.env.get("META_GRAPH_VERSION")||"v25.0";
const META_APP_ID="1639659247753419";
const META_SYSTEM_USER_ID="122107255011470763";
const BUSINESS_ID="750449796120947";

const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
function json(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{...corsHeaders,"content-type":"application/json; charset=utf-8"}})}
function digits(v:unknown){return String(v??"").replace(/\D/g,"")}
function bytesToB64(bytes:Uint8Array){let s="";for(const b of bytes)s+=String.fromCharCode(b);return btoa(s)}
function b64ToBytes(v:string){const s=atob(v);const a=new Uint8Array(s.length);for(let i=0;i<s.length;i++)a[i]=s.charCodeAt(i);return a}
async function graph(token:string,path:string,method:"GET"|"POST"="GET"){const r=await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/${path}`,{method,headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:method==="POST"?"{}":undefined});const p=await r.json().catch(()=>({}));return{ok:r.ok,status:r.status,data:p}}
function metaMessage(x:any){return String(x?.data?.error?.error_user_msg||x?.data?.error?.message||`Meta HTTP ${x?.status||0}`)}
async function cryptoKey(companyId:string,routeKey:string,usage:KeyUsage[]){const seed=new TextEncoder().encode(`${META_APP_SECRET}|${companyId}|${routeKey}|habib-crm-whatsapp-v1`);const digest=await crypto.subtle.digest("SHA-256",seed);return crypto.subtle.importKey("raw",digest,{name:"AES-GCM"},false,usage)}
async function encryptToken(token:string,companyId:string,routeKey:string){const key=await cryptoKey(companyId,routeKey,["encrypt"]);const iv=crypto.getRandomValues(new Uint8Array(12));const cipher=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,new TextEncoder().encode(token));return{token_ciphertext:bytesToB64(new Uint8Array(cipher)),token_iv:bytesToB64(iv)}}
async function decryptToken(ciphertext:string,iv:string,companyId:string,routeKey:string){const key=await cryptoKey(companyId,routeKey,["decrypt"]);const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:b64ToBytes(iv)},key,b64ToBytes(ciphertext));return new TextDecoder().decode(plain)}
async function exchangeLongLivedToken(shortToken:string){try{const qs=new URLSearchParams({grant_type:"fb_exchange_token",client_id:META_APP_ID,client_secret:META_APP_SECRET,fb_exchange_token:shortToken});const r=await fetch(`https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token?${qs.toString()}`);const p=await r.json().catch(()=>({}));if(r.ok&&p?.access_token)return{token:String(p.access_token),expires_in:Number(p.expires_in||0),exchanged:true}}catch{}return{token:shortToken,expires_in:0,exchanged:false}}
async function discoverPhone(token:string,wantedNumber:string,preferredWabaId:string|null){const ids:string[]=[];if(preferredWabaId)ids.push(preferredWabaId);for(const path of [`${BUSINESS_ID}/owned_whatsapp_business_accounts?fields=id,name&limit=100`,`${BUSINESS_ID}/client_whatsapp_business_accounts?fields=id,name&limit=100`]){const r=await graph(token,path);if(r.ok&&Array.isArray(r.data?.data))for(const x of r.data.data){const id=String(x?.id||"");if(id&&!ids.includes(id))ids.push(id)}}const wanted=digits(wantedNumber);const seen:any[]=[];for(const wabaId of ids){const pr=await graph(token,`${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,platform_type,status,account_mode&limit=100`);if(!pr.ok){seen.push({waba_id:wabaId,error:metaMessage(pr)});continue}for(const p of (Array.isArray(pr.data?.data)?pr.data.data:[])){seen.push({waba_id:wabaId,phone_id:String(p?.id||""),display_phone_number:p?.display_phone_number||null,status:p?.status||null});if(digits(p?.display_phone_number)===wanted)return{wabaId,phone:p,seen}}}return{wabaId:null,phone:null,seen}}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
  if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
  if(!SUPABASE_URL||!SUPABASE_ANON_KEY||!SUPABASE_SERVICE_ROLE_KEY||!META_APP_SECRET)return json({ok:false,error:"server_not_configured"},503);
  const authHeader=req.headers.get("authorization")||"";if(!authHeader.toLowerCase().startsWith("bearer "))return json({ok:false,error:"missing_auth"},401);
  const userClient=createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{global:{headers:{Authorization:authHeader}},auth:{persistSession:false,autoRefreshToken:false}});
  const admin=createClient(SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  let eventId:string|null=null;let routeKey="";
  try{
    const {data:ud,error:ue}=await userClient.auth.getUser();const user=ud?.user;if(ue||!user)return json({ok:false,error:"invalid_auth"},401);
    const {data:profile,error:pe}=await admin.from("profiles").select("id,company_id,role,is_active").eq("id",user.id).single();
    if(pe||!profile||profile.is_active===false)return json({ok:false,error:"profile_not_authorized"},403);
    if(!["owner","manager"].includes(String(profile.role)))return json({ok:false,error:"owner_or_manager_required"},403);
    if(CRM_COMPANY_ID&&profile.company_id!==CRM_COMPANY_ID)return json({ok:false,error:"wrong_company"},403);

    const body=await req.json().catch(()=>({}));routeKey=String(body?.route_key||"").trim();if(!["muscat","barka","investment"].includes(routeKey))return json({ok:false,error:"invalid_route"},400);
    if(routeKey==="investment"&&(profile.role!=="owner"||profile.is_active!==true))return json({ok:false,error:"owner_required"},403);
    if(routeKey==="investment")return json({ok:false,error:"investment_uses_muscat",route_key:"investment",transport_route_key:"muscat",message:"استقبال المستثمرين يستخدم رقم مسقط. لا يوجد ربط مستقل لرقم المستثمر."},409);
    const suppliedUserToken=String(body?.user_access_token||"").trim();
    const {data:route,error:re}=await admin.from("company_lead_routes").select("id,route_key,whatsapp_number,meta_waba_id,meta_phone_number_id").eq("company_id",profile.company_id).eq("route_key",routeKey).single();
    if(re||!route)return json({ok:false,error:"route_not_found"},404);if(!route.whatsapp_number)return json({ok:false,error:"route_phone_missing"},400);

    const ev=await admin.from("whatsapp_onboarding_events").insert({company_id:profile.company_id,route_key:routeKey,initiated_by:user.id,configuration_id:"direct-bind-v10",status:"started",details:{mode:suppliedUserToken?"direct_bind_user_token_v10":"direct_bind_existing_system_user_v10",route_phone:route.whatsapp_number}}).select("id").single();eventId=ev.data?.id||null;

    let muscatSystemToken:string|null=null;
    const mc=await admin.from("whatsapp_route_credentials").select("token_ciphertext,token_iv,token_type,meta_system_user_id,meta_app_id,expires_at").eq("company_id",profile.company_id).eq("route_key","muscat").maybeSingle();
    if(mc.data?.token_type==="system_user"&&mc.data?.token_ciphertext&&mc.data?.token_iv){try{muscatSystemToken=await decryptToken(mc.data.token_ciphertext,mc.data.token_iv,String(profile.company_id),"muscat")}catch{}}

    let discoveryToken=suppliedUserToken||muscatSystemToken||"";
    if(!discoveryToken)throw new Error("NO_DISCOVERY_TOKEN_AVAILABLE");

    let scopes:string[]=[];
    if(suppliedUserToken){const appToken=`${META_APP_ID}|${META_APP_SECRET}`;const debug=await graph(appToken,`debug_token?input_token=${encodeURIComponent(suppliedUserToken)}`);if(!debug.ok||debug.data?.data?.is_valid!==true)throw new Error(`META_LOGIN_TOKEN_INVALID: ${metaMessage(debug)}`);if(String(debug.data?.data?.app_id||"")!==META_APP_ID)throw new Error("META_LOGIN_TOKEN_WRONG_APP");scopes=Array.isArray(debug.data?.data?.scopes)?debug.data.data.scopes:[];const required=["business_management","whatsapp_business_management","whatsapp_business_messaging"];const missing=required.filter(x=>!scopes.includes(x));if(missing.length)throw new Error(`META_PERMISSIONS_MISSING: ${missing.join(',')}`)}

    let found=await discoverPhone(discoveryToken,String(route.whatsapp_number),route.meta_waba_id?String(route.meta_waba_id):null);
    if((!found.wabaId||!found.phone)&&suppliedUserToken&&muscatSystemToken){const fallback=await discoverPhone(muscatSystemToken,String(route.whatsapp_number),route.meta_waba_id?String(route.meta_waba_id):null);if(fallback.wabaId&&fallback.phone){found=fallback;discoveryToken=muscatSystemToken}}
    if(!found.wabaId||!found.phone)throw new Error(`ROUTE_PHONE_NOT_FOUND_IN_BUSINESS_ASSETS: ${JSON.stringify(found.seen.slice(0,30))}`);
    const wabaId=String(found.wabaId),phoneId=String(found.phone.id),displayNumber=String(found.phone.display_phone_number||route.whatsapp_number);

    let assignmentAttempted=false,assignmentSucceeded=false,assignmentError:string|null=null;
    let permanentTokenWorks=false;
    if(muscatSystemToken){const w=await graph(muscatSystemToken,`${wabaId}?fields=id,name`);const p=await graph(muscatSystemToken,`${phoneId}?fields=id,display_phone_number,status`);permanentTokenWorks=w.ok&&p.ok}

    if(!permanentTokenWorks&&suppliedUserToken){assignmentAttempted=true;const tasks=encodeURIComponent(JSON.stringify(["MANAGE"]));const ar=await graph(suppliedUserToken,`${wabaId}/assigned_users?user=${META_SYSTEM_USER_ID}&tasks=${tasks}`,"POST");assignmentSucceeded=ar.ok&&ar.data?.success!==false;if(!assignmentSucceeded)assignmentError=metaMessage(ar);if(assignmentSucceeded&&muscatSystemToken){const w=await graph(muscatSystemToken,`${wabaId}?fields=id,name`);const p=await graph(muscatSystemToken,`${phoneId}?fields=id,display_phone_number,status`);permanentTokenWorks=w.ok&&p.ok}}
    else if(permanentTokenWorks)assignmentSucceeded=true;

    const subscribeToken=suppliedUserToken||muscatSystemToken||discoveryToken;const subscribe=await graph(subscribeToken,`${wabaId}/subscribed_apps`,"POST");if(!subscribe.ok)throw new Error(`SUBSCRIBE_APP: ${metaMessage(subscribe)}`);

    let credentialType:string|null=null,credentialFromMuscat=false,expiresAt:string|null=null;
    if(permanentTokenWorks&&muscatSystemToken){const enc=await encryptToken(muscatSystemToken,String(profile.company_id),routeKey);const up=await admin.from("whatsapp_route_credentials").upsert({company_id:profile.company_id,route_key:routeKey,token_ciphertext:enc.token_ciphertext,token_iv:enc.token_iv,token_type:"system_user",meta_system_user_id:META_SYSTEM_USER_ID,meta_app_id:META_APP_ID,expires_at:null,updated_at:new Date().toISOString()},{onConflict:"company_id,route_key"});if(up.error)throw new Error(`credential_store_failed: ${up.error.message}`);credentialType="system_user";credentialFromMuscat=true}
    else if(suppliedUserToken){const ll=await exchangeLongLivedToken(suppliedUserToken);const appToken=`${META_APP_ID}|${META_APP_SECRET}`;const dbg=await graph(appToken,`debug_token?input_token=${encodeURIComponent(ll.token)}`);if(dbg.ok){const exp=Number(dbg.data?.data?.expires_at||0);if(exp>0)expiresAt=new Date(exp*1000).toISOString()}const enc=await encryptToken(ll.token,String(profile.company_id),routeKey);const up=await admin.from("whatsapp_route_credentials").upsert({company_id:profile.company_id,route_key:routeKey,token_ciphertext:enc.token_ciphertext,token_iv:enc.token_iv,token_type:ll.exchanged?"long_lived_user":"user",meta_system_user_id:null,meta_app_id:META_APP_ID,expires_at:expiresAt,updated_at:new Date().toISOString()},{onConflict:"company_id,route_key"});if(up.error)throw new Error(`credential_store_failed: ${up.error.message}`);credentialType=ll.exchanged?"long_lived_user":"user"}
    else throw new Error(`SYSTEM_USER_NOT_ASSIGNED_TO_WABA:${wabaId}:${phoneId}`);

    const now=new Date().toISOString();const {error:upErr}=await admin.from("company_lead_routes").update({whatsapp_number:`+${digits(displayNumber)}`,meta_phone_number_id:phoneId,meta_waba_id:wabaId,is_active:true,updated_at:now}).eq("id",route.id).eq("company_id",profile.company_id);if(upErr)throw new Error(`route_update_failed: ${upErr.message}`);
    const details={mode:suppliedUserToken?"direct_bind_user_token_v10":"direct_bind_existing_system_user_v10",scopes,waba_id:wabaId,phone_number_id:phoneId,display_phone_number:displayNumber,verified_name:found.phone?.verified_name||null,phone_status:found.phone?.status||null,platform_type:found.phone?.platform_type||null,account_mode:found.phone?.account_mode||null,assignment_attempted:assignmentAttempted,assignment_succeeded:assignmentSucceeded,assignment_error:assignmentError,credential_type:credentialType,credential_from_muscat_system_user:credentialFromMuscat,credential_expires_at:expiresAt};
    if(eventId)await admin.from("whatsapp_onboarding_events").update({waba_id:wabaId,phone_number_id:phoneId,display_phone_number:`+${digits(displayNumber)}`,status:"completed",completed_at:now,details}).eq("id",eventId);
    return json({ok:true,route_key:routeKey,waba_id:wabaId,phone_number_id:phoneId,display_phone_number:`+${digits(displayNumber)}`,credential_type:credentialType,credential_from_muscat_system_user:credentialFromMuscat,assignment_succeeded:assignmentSucceeded});
  }catch(err){const message=String((err as any)?.message||err).slice(0,4000);if(eventId)await admin.from("whatsapp_onboarding_events").update({status:"failed",completed_at:new Date().toISOString(),details:{mode:"direct_bind_v10",route_key:routeKey,error:message}}).eq("id",eventId);return json({ok:false,error:"direct_bind_failed",message},502)}
});
