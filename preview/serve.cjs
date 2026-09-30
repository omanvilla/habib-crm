'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),baseline='e9bd1d54e0781cd9445c9d7ad5ac2f004749e961';
const files=new Set(['index.html','app-base-v15.html','modern-v17.css','modern-v17.js','crm-operations-v6.css','crm-operations-v6.js','crm-v17-patch.js','whatsapp-direct-bind-ui.js','crm-v18-routing-patch.js','crm-v18-request-integrity-patch.js','crm-v18-client-info-patch.js','crm-v18-property-monitoring-patch.js','crm-v18-task-priority-patch.js','instagram-crm.js','crm-funnel.js']);
function content(file,before){return before?cp.execFileSync('git',['show',baseline+':'+file],{cwd:root,encoding:'utf8',maxBuffer:4*1024*1024}):fs.readFileSync(path.join(root,file),'utf8');}
const csp="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self'; frame-src 'none'; form-action 'self'; base-uri 'self'; object-src 'none';";
const server=http.createServer((req,res)=>{
 res.setHeader('Content-Security-Policy',csp);res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end('Preview server has no write/API/automation endpoints');return;}
 const url=new URL(req.url,'http://127.0.0.1'),parts=url.pathname.split('/').filter(Boolean);
 if(url.pathname==='/'){res.writeHead(302,{Location:'/after/owner/'});res.end();return;}
 if(url.pathname==='/preview/fixture-sdk.js'){res.setHeader('Content-Type','text/javascript;charset=utf-8');res.end(fs.readFileSync(path.join(root,'preview/fixture-sdk.js')));return;}
 if(parts.length<2||!['before','after'].includes(parts[0])||!['owner','muscat','barka','manager','viewer'].includes(parts[1])){res.writeHead(404);res.end();return;}
 const file=parts[2]||'index.html';
 if(parts.length>3||!files.has(file)){res.writeHead(404);res.end();return;}
 try{
  let body=content(file,parts[0]==='before');
  if(file==='app-base-v15.html'){
   body=body.replace(/<script[^>]+src="https:\/\/[^"]+"[^>]*><\/script>/g,'<script src="/preview/fixture-sdk.js"></script>');
   body=body.replace(/<link[^>]+href="https:\/\/[^"]+"[^>]*>/g,'');
   if(!body.includes('/preview/fixture-sdk.js'))throw Error('fixture SDK injection missing');
  }
  res.setHeader('Content-Type',file.endsWith('.html')?'text/html;charset=utf-8':file.endsWith('.css')?'text/css;charset=utf-8':'text/javascript;charset=utf-8');res.end(body);
 }catch{res.writeHead(500);res.end('Preview asset failed to load');}
});
if(require.main===module){server.listen(Number(process.env.CRM_PREVIEW_PORT||4173),'127.0.0.1',()=>console.log('Synthetic CRM preview: http://127.0.0.1:4173/after/owner/')); }
module.exports=server;
