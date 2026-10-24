import "jsr:@supabase/functions-js/edge-runtime.d.ts";
Deno.serve(()=>new Response(JSON.stringify({ok:false,error:"disabled"}),{status:410,headers:{"content-type":"application/json"}}));
