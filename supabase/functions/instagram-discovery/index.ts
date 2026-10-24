// Server-owned feed ingestion. No messaging, publishing, ads or arbitrary fetch destinations.
import {matchMedia} from './matcher.mjs';
const BASE=Deno.env.get('SUPABASE_URL')||'';
const KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const APP_SECRET=Deno.env.get('META_APP_SECRET')||'';
const COMPANY=Deno.env.get('CRM_COMPANY_ID')||'';
const VERSION='instagram-discovery-v2';
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
class SafeError extends Error {constructor(public code:string){super(code);}}
async function db(path:string,method='GET',body?:unknown){
 const r=await fetch(BASE+'/rest/v1/'+path,{method,headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 const data=await r.json().catch(()=>null);if(!r.ok)throw new SafeError('db_'+String(data?.code||r.status));return data;
}
const rpc=(name:string,body:unknown)=>db('rpc/'+name,'POST',body);
async function all(path:string){const rows=[];for(let offset=0;;offset+=500){const batch=await db(path+'&limit=500&offset='+offset);if(!Array.isArray(batch))throw new SafeError('invalid_database_response');rows.push(...batch);if(batch.length<500)return rows;if(offset>50000)throw new SafeError('inventory_too_large');}}
async function tokenFor(a:any){
 const list=await db('instagram_account_credentials?select=token_ciphertext,token_iv&account_id=eq.'+a.id+'&company_id=eq.'+a.company_id);const c=list[0];if(!c)throw new SafeError('credential_missing');
 try{const bytes=(s:string)=>Uint8Array.from(atob(s),x=>x.charCodeAt(0));const seed=new TextEncoder().encode(`${APP_SECRET}|${a.company_id}|${a.id}|habib-crm-instagram-v1`);
 const key=await crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',seed),{name:'AES-GCM'},false,['decrypt']);return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(c.token_iv)},key,bytes(c.token_ciphertext)));}
 catch{throw new SafeError('credential_unreadable');}
}
async function page(a:any,token:string,after:string|null,limit:number){
 if(!/^\d+$/.test(a.instagram_user_id))throw new SafeError('invalid_account');
 const url=new URL('https://graph.facebook.com/v25.0/'+a.instagram_user_id+'/media');
 url.searchParams.set('fields','id,caption,permalink,media_type,media_product_type,timestamp,like_count,comments_count');url.searchParams.set('limit',String(limit));if(after)url.searchParams.set('after',after);
 const r=await fetch(url,{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(25000)});const data=await r.json().catch(()=>({}));
 if(!r.ok)throw new SafeError(data.error?.code===190?'meta_reconnect_required':r.status===429||[4,17,32,613].includes(data.error?.code)?'meta_rate_limited':'meta_'+String(data.error?.code||r.status));
 if(!Array.isArray(data.data))throw new SafeError('meta_invalid_response');
 // Never persist or follow paging.next: it can contain credentials. Rebuild the fixed-host URL.
 const hasMore=!!data.paging?.next,cursor=hasMore?String(data.paging?.cursors?.after||''):null;
 if(hasMore&&(!cursor||cursor.length>4000))throw new SafeError('meta_invalid_cursor');
 return {media:data.data.map((m:any)=>({id:m.id,caption:m.caption||'',permalink:m.permalink,media_type:m.media_type,media_product_type:m.media_product_type,timestamp:m.timestamp,like_count:m.like_count??null,comments_count:m.comments_count??null})),cursor,complete:!hasMore};
}
// Metric refresh for saved publications. The manual "sync" button was the only
// writer, so links saved later (catalog, staff) showed "metrics unavailable".
// A few links per run, each refreshed every 12 hours; values are only replaced
// when Meta returns views, so a temporary gap never erases earlier numbers.
const METRICS=['views','reach','likes','comments','shares','saved','total_interactions','ig_reels_avg_watch_time','ig_reels_video_view_total_time'];
const METRICS_PER_RUN=6,METRIC_AGE_MS=12*3600000;
async function graphGet(path:string,token:string){
 const url=new URL('https://graph.facebook.com/v25.0/'+path);
 const r=await fetch(url,{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(20000)});const data=await r.json().catch(()=>({}));
 if(!r.ok){const code=data.error?.code;throw new SafeError(code===190?'meta_reconnect_required':r.status===429||[4,17,32,613].includes(code)?'meta_rate_limited':'meta_metric_'+String(code||r.status));}
 return data;
}
const metricValue=(item:any)=>Number(item?.total_value?.value??item?.values?.[0]?.value??item?.value);
async function mediaInsights(mediaId:string,token:string){
 const metrics:Record<string,number>={};
 try{
  const data=await graphGet(mediaId+'/insights?metric='+METRICS.join(','),token);
  for(const item of Array.isArray(data.data)?data.data:[]){const v=metricValue(item);if(item?.name&&Number.isFinite(v))metrics[item.name]=v;}
 }catch(error){
  if(error instanceof SafeError&&['meta_reconnect_required','meta_rate_limited'].includes(error.code))throw error;
  // One unsupported metric fails the combined request; read them one by one.
  for(const name of METRICS){
   try{const data=await graphGet(mediaId+'/insights?metric='+name,token);const v=metricValue(data?.data?.[0]);if(Number.isFinite(v))metrics[name]=v;}
   catch(inner){if(inner instanceof SafeError&&['meta_reconnect_required','meta_rate_limited'].includes(inner.code))throw inner;}
  }
 }
 const media=await graphGet(mediaId+'?fields=like_count,comments_count',token).catch(()=>({}));
 if(Number.isFinite(Number(media.like_count)))metrics.likes=Number(media.like_count);
 if(Number.isFinite(Number(media.comments_count)))metrics.comments=Number(media.comments_count);
 if(!Number.isFinite(metrics.total_interactions)&&['likes','comments','shares','saved'].every(k=>Number.isFinite(metrics[k])))metrics.total_interactions=metrics.likes+metrics.comments+metrics.shares+metrics.saved;
 return metrics;
}
async function refreshMetrics(a:any,token:string,deadline:number){
 const before=new Date(Date.now()-METRIC_AGE_MS).toISOString();
 const due=await db('property_marketing_events?select=id,link_key,instagram_media_id&company_id=eq.'+a.company_id+'&channel=eq.instagram&link_key=like.instagram:*'
  +'&or=(last_synced_at.is.null,last_synced_at.lt."'+before+'")&order=last_synced_at.asc.nullsfirst,id&limit='+METRICS_PER_RUN);
 let synced=0,failed=0;
 for(const e of due){
  if(Date.now()>deadline)break;
  const now=new Date().toISOString(),where='property_marketing_events?id=eq.'+e.id+'&company_id=eq.'+a.company_id;
  let mediaId=/^\d{5,40}$/.test(String(e.instagram_media_id||''))?String(e.instagram_media_id):'';
  if(!mediaId){
   const found=await db('instagram_media_catalog?select=instagram_media_id&account_id=eq.'+a.id+'&link_key=eq.'+encodeURIComponent(e.link_key)+'&limit=1');
   mediaId=/^\d{5,40}$/.test(String(found?.[0]?.instagram_media_id||''))?String(found[0].instagram_media_id):'';
  }
  if(!mediaId){await db(where,'PATCH',{sync_status:'error',sync_error:'instagram_media_not_found_or_not_owned_by_omanvilla',last_synced_at:now});failed++;continue;}
  const m=await mediaInsights(mediaId,token);
  if(!Number.isFinite(m.views)){await db(where,'PATCH',{sync_status:'error',sync_error:'instagram_views_unavailable_previous_values_preserved',last_synced_at:now,instagram_media_id:mediaId});failed++;continue;}
  await db(where,'PATCH',{instagram_media_id:mediaId,auto_sync:true,sync_status:'synced',sync_error:null,last_synced_at:now,
   views:m.views,reach:m.reach??null,likes:m.likes??null,comments:m.comments??null,shares:m.shares??null,saves:m.saved??null,total_interactions:m.total_interactions??null,
   watch_time_ms:m.ig_reels_video_view_total_time??null,avg_watch_time_ms:m.ig_reels_avg_watch_time??null,insights_payload:{metrics:m,synced_at:now,source:VERSION}});
  synced++;
 }
 return {metrics_synced:synced,metrics_failed:failed};
}
async function runAccount(a:any,deadline:number){
 const state=await rpc('crm_instagram_claim',{p_account:a.id});if(!state)return {account_id:a.id,skipped:true};
 const lease=state.lease_id,where='instagram_discovery_state?account_id=eq.'+a.id+'&lease_id=eq.'+lease;
 const counts:Record<string,unknown>={fetched:0,linked:0,added:0,review:0,non_property:0};
 try{
  const token=await tokenFor(a);
  const latest=await page(a,token,null,25);await rpc('crm_instagram_ingest',{p_account:a.id,p_lease:lease,p_media:latest.media});counts.fetched+=latest.media.length;
  const staleFull=state.backfill_complete&&(!state.last_full_scan_at||Date.now()-Date.parse(state.last_full_scan_at)>86400000);
  if(!state.backfill_complete||staleFull){
   const history=await page(a,token,staleFull?null:state.backfill_cursor,100);
   await rpc('crm_instagram_ingest',{p_account:a.id,p_lease:lease,p_media:history.media});counts.fetched+=history.media.length;
   await db(where,'PATCH',{backfill_cursor:history.cursor,backfill_complete:history.complete,...(history.complete?{last_full_scan_at:new Date().toISOString()}:{}),updated_at:new Date().toISOString()});
  }
  if(state.auto_link_enabled){
   const inventory=await all('properties?select=id,title,area,price,land_size,built_size,bedrooms,bathrooms,type,branch_key,archived,updated_at&company_id=eq.'+a.company_id+'&order=id');
   const known=await all('property_marketing_events?select=id,property_id,link_key,instagram_media_id&company_id=eq.'+a.company_id+'&order=id');
   const pending=await db('instagram_media_catalog?select=*&account_id=eq.'+a.id+'&state=eq.pending&order=published_at.desc,id&limit=200');
   for(const media of pending){
    if(Date.now()>deadline)break;
    const result=matchMedia(media,inventory,known),p=inventory.find(x=>x.id===result.property_id);
    if(result.decision==='link'&&!p)result.decision='needs_review';
    try{
     const saved=await rpc('crm_instagram_auto_decide',{p_id:media.id,p_expected:media.updated_at,p_decision:result.decision,p_property:result.decision==='link'?result.property_id:null,p_property_version:p?.updated_at||null,p_reason:result.reason,p_evidence:result.evidence});
     if(saved.state==='linked'){counts.linked++;if(saved.new_marketing_event){counts.added++;known.push({id:saved.event_id,property_id:p.id,link_key:media.link_key,instagram_media_id:media.instagram_media_id});}
      if(p&&saved.property_updated_at)p.updated_at=saved.property_updated_at;
     }else if(saved.state==='needs_review')counts.review++;else if(saved.state==='non_property')counts.non_property++;
    }catch(error){
     if(error instanceof SafeError&&['db_40001','db_23505'].includes(error.code))continue;
     throw error;
    }
   }
   await rpc('crm_instagram_notify',{p_account:a.id});
  }
  let metrics={};
  try{metrics=await refreshMetrics(a,token,deadline);}
  catch(error){if(error instanceof SafeError&&['meta_reconnect_required','meta_rate_limited'].includes(error.code))throw error;metrics={metrics_error:error instanceof SafeError?error.code:'metrics_failed'};}
  Object.assign(counts,metrics);
  await db(where,'PATCH',{last_success_at:new Date().toISOString(),last_error_code:null,error_count:0,next_retry_at:null,lease_id:null,lease_until:null,updated_at:new Date().toISOString()});
  return {account_id:a.id,ok:true,...counts};
 }catch(error){
  const code=error instanceof SafeError?error.code:'network_or_runtime_error';
  const failures=Number(state.error_count||0)+1,waitMinutes=code==='meta_reconnect_required'?360:Math.min(360,5*2**Math.min(failures-1,6));
  await db(where,'PATCH',{last_error_code:code,error_count:failures,next_retry_at:new Date(Date.now()+waitMinutes*60000).toISOString(),lease_id:null,lease_until:null,updated_at:new Date().toISOString()}).catch(()=>{});
  if(state.last_error_code!==code){
   const owners=await db('profiles?select=id&company_id=eq.'+a.company_id+'&role=eq.owner&is_active=eq.true');
   await db('notifications','POST',owners.map((o:any)=>({user_id:o.id,title:'توقفت مزامنة منشورات Instagram مؤقتًا',body:code==='meta_reconnect_required'?'اتصال Instagram يحتاج إعادة الربط. الروابط المحفوظة لم تتغير.':'تعذر جلب المنشورات. ستتم إعادة المحاولة تلقائيًا؛ راجع حالة الربط في أداء العقارات.',type:'instagram_discovery',link:'instagram'}))).catch(()=>{});
  }
  return {account_id:a.id,ok:false,error:code,...counts};
 }
}
Deno.serve(async req=>{
 if(req.method!=='POST')return json({ok:false,error:'method_not_allowed'},405);
 const secret=req.headers.get('x-crm-cron')||'';if(secret.length!==64)return json({ok:false,error:'unauthorized'},401);
 try{
  if(!BASE||!KEY||!APP_SECRET)return json({ok:false,error:'server_not_configured'},503);
  if(await rpc('crm_instagram_job_auth',{p_secret:secret})!==true)return json({ok:false,error:'unauthorized'},401);
  const states=await db('instagram_discovery_state?select=account_id&enabled=eq.true'+(COMPANY?'&company_id=eq.'+COMPANY:''));
  const accounts=await db('instagram_accounts?select=id,company_id,instagram_user_id,instagram_username&connection_status=eq.connected'+(COMPANY?'&company_id=eq.'+COMPANY:''));
  const enabled=new Set(states.map((s:any)=>s.account_id)),deadline=Date.now()+100000,results=[];
  for(const a of accounts){if(enabled.has(a.id)&&Date.now()<deadline)results.push(await runAccount(a,deadline));}
  return json({ok:results.every((r:any)=>r.ok!==false),version:VERSION,results});
 }catch(error){return json({ok:false,error:error instanceof SafeError?error.code:'worker_failed'},500);}
});
