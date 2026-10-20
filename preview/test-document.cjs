'use strict';
const fs=require('node:fs'),path=require('node:path');const root=path.resolve(__dirname,'..');const offline=process.env.CRM_TEST_OFFLINE==='1';
async function load(page,role){
 if(!offline){await page.goto('http://127.0.0.1:4214/after/'+role+'/');return;}
 // Local sandbox has no loopback browser permission. Execute the same sources
 // as an offline document with in-memory synthetic storage; CI uses actual index/server bootstrap.
 const index=fs.readFileSync(path.join(root,'index.html'),'utf8');let html=fs.readFileSync(path.join(root,'app-base-v15.html'),'utf8');
 let fixture=fs.readFileSync(path.join(root,'preview/fixture-sdk.js'),'utf8').replace(/const actor=.*?;/,"const actor='"+role+"';");
 const storage=`for(const key of ['sessionStorage','localStorage']){const data=new Map();Object.defineProperty(window,key,{value:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k),clear:()=>data.clear()},configurable:true});}if(!crypto.randomUUID)crypto.randomUUID=()=> '10000000-0000-4000-8000-'+String(Math.floor(Math.random()*1e12)).padStart(12,'0');`;
 const inline=src=>'<script>'+src.replace(/<\/script/gi,'<\\/script')+'</script>';
 html=html.replace(/<script[^>]+src="https:\/\/[^\"]+"[^>]*><\/script>/g,inline(storage+fixture)).replace(/<link[^>]+href="https:\/\/[^\"]+"[^>]*>/g,'');
 const css=[...index.matchAll(/href="([^"?]+\.css)/g)].map(m=>'<style>'+fs.readFileSync(path.join(root,m[1]),'utf8')+'</style>').join('');
 const scripts=[...index.matchAll(/<script src="([^"?]+\.js)/g)].map(m=>inline(fs.readFileSync(path.join(root,m[1]),'utf8'))).join('');
 html=html.replace('<head>',"<head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'\">").replace('</head>',css+'</head>').replace('</body>',scripts+'</body>');await page.setContent(html);
}

module.exports=load;
