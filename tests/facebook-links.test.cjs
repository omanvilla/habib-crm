'use strict';
// 11 Nov 2026 (Ahmed): Facebook links sent on WhatsApp are read like Instagram reels.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{stripTypeScriptTypes}=require('node:module');
const src=fs.readFileSync('supabase/functions/whatsapp-reply-agent/index.ts','utf8');
const sql=fs.readFileSync('db/changes/80-facebook-links.forward.sql','utf8');
// Load only the pure helpers (from the Facebook block to just before the schema).
const block=src.slice(src.indexOf('const FB_URL_RE'),src.indexOf('const NAME_NOT_GIVEN')).replace(/^export /mg,'');
const lib=new Function('URL','AbortSignal',stripTypeScriptTypes(block)+';return {facebookKeyOf,readFacebookLink,FB_URL_RE};')(URL,AbortSignal);

test('Facebook link keys match the SQL normaliser forms',()=>{
 const k=lib.facebookKeyOf;
 assert.equal(k('https://www.facebook.com/share/r/19jE2PvHVG/'),'facebook-share:19jE2PvHVG');
 assert.equal(k('https://www.facebook.com/share/v/19yBx89QWB/'),'facebook-share:19yBx89QWB');
 assert.equal(k('https://fb.watch/abC_12/'),'facebook-share:abC_12');
 assert.equal(k('https://www.facebook.com/reel/1397648985110896/?fs=e&rdid=x'),'facebook:1397648985110896');
 assert.equal(k('https://m.facebook.com/100083795340037/videos/some-slug/1397648985110896/'),'facebook:1397648985110896');
 assert.equal(k('https://www.facebook.com/watch/?v=123456'),'facebook:123456');
 assert.equal(k('https://www.facebook.com/Omanvilla/posts/pfbid02abc'),'facebook:pfbid02abc');
 assert.equal(k('https://www.facebook.com/permalink.php?story_fbid=987&id=1'),'facebook:987');
 assert.equal(k('https://www.instagram.com/reel/ABC/'),'');
 for(const re of ["facebook:'||m[1]","facebook-share:'||m[1]"])assert(sql.includes(re));
 assert.match(sql,/channel = ANY \(ARRAY\['instagram','facebook'/);
});
test('a share link is followed on Facebook hosts only and the post text is read',async()=>{
 const html='<link rel="canonical" href="https://www.facebook.com/100083795340037/videos/x/1397648985110896/"><meta property="og:description" content="&#x6a4;&#x64a;&#x644;&#x627; &#x644;&#x644;&#x628;&#x64a;&#x639; 450 &#x645;">';
 const calls=[];
 const fetcher=async(url)=>{calls.push(url);if(url.includes('/share/'))return {status:302,ok:false,headers:new Map([['location','https://www.facebook.com/reel/1397648985110896/?fs=e']])};
  return {status:200,ok:true,headers:new Map(),text:async()=>html};};
 const r=await lib.readFacebookLink('https://www.facebook.com/share/v/19yBx89QWB/',fetcher);
 assert.equal(r.resolved_key,'facebook:1397648985110896');assert.equal(r.page_id,'100083795340037');assert.match(r.caption,/ڤيلا للبيع 450/);
 assert.equal(calls.length,2);
 const evil=async()=>({status:302,ok:false,headers:new Map([['location','https://evil.example/steal']])});
 const r2=await lib.readFacebookLink('https://www.facebook.com/share/v/19yBx89QWB/',evil);
 assert.equal(r2,null,'a redirect off Facebook is never followed');
 assert.equal(await lib.readFacebookLink('https://evil.example/x',fetcher),null);
});
test('the agent labels Facebook links and never sends anything while reading them',()=>{
 assert(src.includes('منشور فيسبوك من صفحتنا'));assert(src.includes('عامله مثل الريل المو مسجل'));
 assert.match(src,/redirect: "manual"/);assert.match(src,/reads < 3/,'at most 3 reads per reply');
 assert.match(src,/facebook_link_cache/);assert.match(src,/if \(!inline\) await db\.from\("facebook_link_cache"\)/,"a dry run writes nothing");
});
