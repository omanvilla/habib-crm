'use strict';
// Reply agent upgrade (Ahmed 10 Nov 2026, contract C): what is sent is what the draft records, R16 inside the R2 guard,
// owner_with_ahmed after a hand-back, the client profile and agent memory, seriousness and meetings, one done visit,
// call promises (R12) and a dry run that can never send. String checks plus small pure parts evaluated from the source.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const agent=fs.readFileSync('supabase/functions/whatsapp-reply-agent/index.ts','utf8').replace(/\r\n/g,'\n');
const at=(s)=>{const i=agent.indexOf(s);assert(i>=0,'missing: '+s);return i;};
const pick=(start,end)=>{const a=at(start);const b=agent.indexOf(end,a);assert(b>a,'no end for: '+start);return agent.slice(a,b+end.length);};
const re=(name)=>{const m=agent.match(new RegExp('const '+name+' = (\\/.+\\/[a-z]*);'));assert(m,'missing regex '+name);return new Function('return '+m[1])();};
const fn=(start,sig,plain)=>new Function('return '+pick(start,';\n').replace(start,'').replace(sig,plain).replace(/;\n$/,''))();
const short=fn('const short = ','(v: unknown, n = 1500)','(v, n = 1500)');

test('1: the send list is rebuilt from the final reply, after the R9 redirect and arabicOnly',()=>{
 const redirect=at('if (redirectToMuscat) {');
 const arabic=at('out.reply_messages = (out.reply_messages || []).map((r: string) => arabicOnly(r));');
 const synced=at('Object.assign(analysis, { reply_messages: out.reply_messages, action: out.action, category: out.category });');
 const rebuild=at('const outgoingParts: any[] = [...out.reply_messages.map(');
 const send=at('const wamid = await metaSend(tokens, phoneId, to, outgoing[i]);');
 assert(redirect<arabic&&arabic<synced&&synced<rebuild&&rebuild<send,'redirect, then arabicOnly, then the draft record and the send list, then the send');
 // whatsapp-reply-send adds the location from analysis.action when a held draft is approved
 assert(synced<at('if (dry || holdForOwner || (rt.reply_agent_mode === "approval" && !autoSend))'),'a held draft records the final action');
 assert(!/outgoing\.push|outgoing = /.test(agent),'nothing else builds or changes the send list');
 assert(agent.includes('...(redirectToMuscat ? [] : actionMsgs)'),'location / lockbox / owner number follow the text, not after a redirect');
 assert(agent.includes('preview_url: !ruleAuto && /https?:\\/\\//.test(t)'),'pinned replies keep no link preview');
 // the redirect goes out once per chat, counted from its own line, and like any free text only inside the 24 hour window
 assert(agent.includes('const redirectSent = lineOut.length > 0;'));
 assert(!agent.includes('/رقم مسقط\\s*71770030/.test(String(h.body || ""))'),'a request or listing redirect does not count as the investment or owner line');
 assert(!agent.includes('out.reply_messages = redirectSent ? [] : ['),'the code never blanks a reply because the Muscat number went out before');
 assert(at('if (!review && !dry && (out.reply_messages || []).length) {')>rebuild,'the 24 hour check reads the final reply');
 assert(!agent.includes('!review && !dry && !redirectToMuscat'),'the redirect is not left out of the 24 hour rule any more');
 // only a project reel among the messages being answered makes the client an investor (an old reel no longer redirects a Barka question)
 assert(agent.includes('if (history.slice(burstFrom).some((h: any) => h.direction === "inbound" && reels[reelKeyOf(h)]?.project)) { out.category = "investor";'));
 assert(!agent.includes('if (Object.values(reels).some((x: any) => x.project)) out.category = "investor";'));
 // the pinned reply and the promise filter only change the reply, the send list follows it
 assert(agent.includes('if (ruleAuto) out.reply_messages = String(pickedVariant[rule.id].reply)'));
 assert(at('const send_preview = outgoing.map(')>rebuild,'an inline dry run shows the real send list');
});

test('1: arabicOnly cleans type codes in Arabic text and leaves links and English replies alone',()=>{
 const src=[pick('const TYPE_AR','\n'),pick('function arabicOnly','\n}\n'),pick('function arabicWords','\n}\n')].join('\n')
  .replace(': Record<string, string>','').replace(/\(s: string\): string/g,'(s)');
 const {arabicOnly}=new Function(src+';return {arabicOnly};')();
 assert.equal(arabicOnly('عندنا twin_villa في الشخاخيط'),'عندنا فيلا في الشخاخيط');
 assert.equal(arabicOnly('الفيديو https://www.instagram.com/reel/C-land-villa/ تفضل'),'الفيديو https://www.instagram.com/reel/C-land-villa/ تفضل');
 assert.equal(arabicOnly('Better to see the apartment first'),'Better to see the apartment first');
});

test('1: the R9 redirect goes once per chat, keeps a silent R23 handoff and never leaves the client in a silent dead end',async()=>{
 const block=agent.slice(at('    const MUSCAT_AREAS = '),at('    // R48 (Ahmed 14 Nov 2026): a listed property'))
  .replace(/\(out as any\)/g,'out').replace(/\((\w+): (?:string|any)\)/g,'($1)');
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const redirect=new AsyncFunction('out','conv','history','analysis','msg','HARD_HANDOFF','mentionsProject','burstFrom',block+'\nreturn {out,analysis,redirectToMuscat};');
 const INV='الاستثمار والمشاريع تتابعها معنا على رقم مسقط 71770030 واتساب',OWN='عقارك تتابعه معنا على رقم مسقط 71770030 واتساب',BARKA='هذا الرقم خاص لعقارات بركاء';
 const hoursAgo=(h)=>new Date(Date.now()-h*3600*1000).toISOString();
 const sent=(body,ts=hoursAgo(3))=>({direction:'outbound',body,message_timestamp:ts});
 const run=async(o,{route='barka',hist=[],said='كم السعر',project=false}={})=>{
  const history=[...hist,{direction:'inbound',body:said,message_timestamp:hoursAgo(0)}];
  let burstFrom=0;history.forEach((h,i)=>{if(h.direction==='outbound')burstFrom=i+1;});
  const out={category:'investor',action:'none',handoff_reason:null,owner_offer:null,reply_messages:[],intent:'x',...o};
  return redirect(out,{route_key:route},history,{},{company_id:'c'},re('HARD_HANDOFF'),async()=>project,burstFrom);
 };
 // the brain's request or listing lines are not the investment line: the first investment question still gets it (8 of 11 live chats)
 let r=await run({reply_messages:['وعليكم السلام ورحمة الله وبركاته','الاستوديو من 57 الف']},{hist:[sent('طلبك تتابعه معنا على رقم مسقط 71770030 واتساب'),sent('هذا العقار تتابعه معنا على رقم مسقط 71770030 واتساب')]});
 assert.deepEqual(r.out.reply_messages,['وعليكم السلام ورحمة الله وبركاته',INV,BARKA]);assert.equal(r.out.action,'none');assert.equal(r.redirectToMuscat,true);
 // R23: a call request or a serious buyer the model handed over in silence stays a silent handoff, with no redirect over it
 r=await run({action:'handoff',handoff_reason:'طلب اتصال: يبي أحد يتصل فيه'});
 assert.deepEqual(r.out.reply_messages,[]);assert.equal(r.out.action,'handoff');assert.equal(r.out.handoff_reason,'طلب اتصال: يبي أحد يتصل فيه');assert.equal(r.analysis.redirect_kept_handoff,true);
 r=await run({action:'handoff',handoff_reason:'مشتري جاد: زار ويبي آخر سعر'},{hist:[sent(INV)]});
 assert.deepEqual(r.out.reply_messages,[]);assert.equal(r.out.action,'handoff');
 // after the line went out: the model's own reply goes, «تمام» gets nothing, an unanswered question gets the line once in 15 minutes
 r=await run({reply_messages:['تقدر تكلمنا على رقم مسقط 71770030 وهناك نعطيك كل التفاصيل']},{hist:[sent(INV),sent(BARKA)]});
 assert.deepEqual(r.out.reply_messages,['تقدر تكلمنا على رقم مسقط 71770030 وهناك نعطيك كل التفاصيل']);assert.equal(r.out.action,'none');assert.equal(r.analysis.redirect_already_sent,true);
 r=await run({},{hist:[sent(INV)],said:'تمام'});
 assert.deepEqual(r.out.reply_messages,[]);assert.equal(r.out.action,'none');
 r=await run({},{hist:[sent(INV)],said:'طيب كم سعر الاستوديو ؟'});
 assert.deepEqual(r.out.reply_messages,[INV]);
 r=await run({},{hist:[sent(INV,hoursAgo(0.05))],said:'طيب كم سعر الاستوديو ؟'});
 assert.deepEqual(r.out.reply_messages,[],'never the same line twice within 15 minutes (R14)');
 // never a figure or a project on the Barka number (R9)
 r=await run({reply_messages:['الاستوديو يبدأ من 57 الف']},{hist:[sent(INV)]});
 assert.deepEqual(r.out.reply_messages,[INV]);
 r=await run({reply_messages:['المشروع فيه شقق وتاون هاوس']},{hist:[sent(INV)],project:true});
 assert.deepEqual(r.out.reply_messages,[INV]);
 // after the line a soft handoff the model chose stays (Ahmed is told); the first redirect closes the topic here
 r=await run({reply_messages:['اكتب لي طلبك اذا ما عليك امر'],action:'handoff',handoff_reason:'مو واضح: صورة ما انفهمت'},{hist:[sent(INV)]});
 assert.equal(r.out.action,'handoff');assert.deepEqual(r.out.reply_messages,['اكتب لي طلبك اذا ما عليك امر']);
 r=await run({reply_messages:['ارسل لي رابط الفيديو'],action:'handoff',handoff_reason:'ما عرفنا العقار: x'});
 assert.deepEqual(r.out.reply_messages,[INV,BARKA]);assert.equal(r.out.action,'none');
 // the owner of a Muscat-area property gets the owner line; the investment line sent earlier does not count for it
 r=await run({category:'seller',owner_offer:{area:'الخوض',wilayat:null},reply_messages:['ارسل الكروكي']},{hist:[sent(INV)]});
 assert.deepEqual(r.out.reply_messages,[OWN,BARKA]);
 // the Muscat number and a Barka buyer are never redirected
 r=await run({reply_messages:['الاسعار تختلف حسب الوحدة والمساحة والمرحلة']},{route:'muscat'});
 assert.equal(r.redirectToMuscat,false);assert.deepEqual(r.out.reply_messages,['الاسعار تختلف حسب الوحدة والمساحة والمرحلة']);
 r=await run({category:'buyer',reply_messages:['متوفره']});
 assert.equal(r.redirectToMuscat,false);assert.deepEqual(r.out.reply_messages,['متوفره']);
});

test('R48: a property of the other branch is not served on this number, the customer gets the branch line once',()=>{
 const block=agent.slice(at('    const branchOf = '),at('    // no English type codes reach the customer')).replace(/\((\w+): (?:string|any)\)/g,'($1)');
 const guard=new Function('out','conv','history','analysis','prop','HARD_HANDOFF','redirectToMuscat','actionMsgs',block+'\nreturn {out,analysis,actionMsgs};');
 const BARKA='هذا العقار تتابعه معنا على رقم بركاء 92344273 واتساب',MUSCAT='هذا العقار تتابعه معنا على رقم مسقط 71770030 واتساب';
 const hoursAgo=(h)=>new Date(Date.now()-h*3600*1000).toISOString();
 const sent=(body,ts=hoursAgo(3))=>({direction:'outbound',body,message_timestamp:ts});
 const run=(o,{route='muscat',branch='barka',hist=[],redirect=false,msgs=[]}={})=>
  guard({action:'none',handoff_reason:null,viewing_date:null,viewing_time:null,reply_messages:[],...o},{route_key:route},[...hist,{direction:'inbound',body:'x',message_timestamp:hoursAgo(0)}],{},branch===null?null:{id:'p',branch_key:branch},re('HARD_HANDOFF'),redirect,msgs);
 // the chat of 12 Nov (42b53d11): a pinned «برسلك الموقع» on the Muscat number for the Somhan villa, then the location and a visit
 let r=run({reply_messages:['ان شاء الله برسلك الموقع','متى يناسبك تزور ؟','اسمك الكريم ؟']});
 assert.deepEqual(r.out.reply_messages,[BARKA]);assert.equal(r.out.action,'none');assert.equal(r.analysis.branch_redirect,'barka');
 r=run({reply_messages:['البيت مفتوح تقدر تشوفه'],action:'send_location',viewing_date:'2026-11-13',viewing_time:'09:00'},{msgs:[{type:'text'}]});
 assert.deepEqual(r.out.reply_messages,[BARKA]);assert.equal(r.out.action,'none');assert.equal(r.out.viewing_date,null);assert.equal(r.actionMsgs.length,0,'no location after the line');
 // the ad (with the greeting on its first line) and the video are not sent here
 r=run({reply_messages:['وعليكم السلام ورحمة الله وبركاته\nللبيع توين فيلا في الرميس بركاء\n'+'تفاصيل '.repeat(60),'متى يناسبك تزور ؟']});
 assert.deepEqual(r.out.reply_messages,['وعليكم السلام ورحمة الله وبركاته',BARKA]);
 r=run({reply_messages:['وعليكم السلام ورحمة الله وبركاته','https://www.instagram.com/reel/abc/','اسمك الكريم ؟']});
 assert.deepEqual(r.out.reply_messages,['وعليكم السلام ورحمة الله وبركاته',BARKA]);
 // the other way round: a Muscat property on the Barka number
 r=run({reply_messages:['متى يناسبك تزور ؟']},{route:'barka',branch:'muscat'});
 assert.deepEqual(r.out.reply_messages,[MUSCAT]);
 // a short answer stays and the line follows it; what the brain already wrote with the number is left alone
 r=run({reply_messages:['لا الفيلا وسطية مو كورنر']});
 assert.deepEqual(r.out.reply_messages,['لا الفيلا وسطية مو كورنر',BARKA]);
 r=run({reply_messages:['لا الفيلا وسطية مو كورنر',BARKA]});
 assert.deepEqual(r.out.reply_messages,['لا الفيلا وسطية مو كورنر',BARKA]);assert.equal(r.analysis.branch_redirect,undefined);
 // once per chat: after the line a short answer goes alone, serving gets the line again, never twice within 15 minutes, «تمام» gets nothing
 r=run({reply_messages:['المساحة 400 متر']},{hist:[sent(BARKA)]});
 assert.deepEqual(r.out.reply_messages,['المساحة 400 متر']);
 r=run({reply_messages:['متى يناسبك تزور ؟']},{hist:[sent(BARKA)]});
 assert.deepEqual(r.out.reply_messages,[BARKA]);assert.equal(r.analysis.branch_line_already_sent,true);
 r=run({reply_messages:['متى يناسبك تزور ؟']},{hist:[sent(BARKA,hoursAgo(0.05))]});
 assert.deepEqual(r.out.reply_messages,[]);
 r=run({},{hist:[sent(BARKA)]});
 assert.deepEqual(r.out.reply_messages,[]);
 // R22: the offer of a property of the other branch is a question and stays; R23: a strong handoff stays
 r=run({reply_messages:['اذا تقبل بركاء عندنا فيلا في الرميس بـ 59 الف','تحب ارسلك تفاصيلها ؟']});
 assert.deepEqual(r.out.reply_messages,['اذا تقبل بركاء عندنا فيلا في الرميس بـ 59 الف','تحب ارسلك تفاصيلها ؟']);
 r=run({reply_messages:['اللوكيشن اللي ارسلناه للفيلا المتوفرة'],action:'handoff',handoff_reason:'سؤال ما عندي جوابه: أي فيلا'});
 assert.equal(r.out.action,'handoff');assert.deepEqual(r.out.reply_messages,['اللوكيشن اللي ارسلناه للفيلا المتوفرة']);
 // the same branch, no property, a property with no branch, and a chat the R9 redirect already took: untouched
 for(const o of [{branch:'muscat'},{branch:null},{branch:'investment'},{redirect:true}]){
  r=run({reply_messages:['متى يناسبك تزور ؟'],action:'send_location'},{...o,msgs:[{type:'text'}]});
  assert.deepEqual(r.out.reply_messages,['متى يناسبك تزور ؟']);assert.equal(r.out.action,'send_location');assert.equal(r.actionMsgs.length,1);
 }
});

test('14 Nov guards: rules that were words only are held by code (R16, R24, R34, R44, R9 on the Barka number)',async()=>{
 const block=agent.slice(at('    const SEE_FIRST = '),at('    // ---- 14 Nov 2026, batch 2 ----'))
  .replace(/\((\w+): (?:string|any)\)/g,'($1)').replace(/new Set<string>/g,'new Set').replace('const named: boolean[]','const named');
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const guards=new AsyncFunction('out','texts','history','visitedIds','SAID_VISITED','r16Seen','prop','short','goneRows','reels','linkedSold','linkedAvailable','groupTalk','SOLD_RE','conv','msg','mentionsProject',block+'\nreturn {out,texts};');
 const PROJECT=/مدينة السلطان هيثم|عايدة|اليزن/;
 const run=(texts,o={})=>guards({action:'none',handoff_reason:null,category:'buyer',property_id:null,intent:'x',...(o.out||{})},texts,
  o.history||[{direction:'inbound',body:o.said||'كم آخر سعر'}],new Set(o.visited||[]),re('SAID_VISITED'),async()=>o.r16||null,o.prop||null,(s)=>String(s),
  o.gone||[],{},!!o.linkedSold,!!o.linkedAvailable,false,/ابتاع|انباع|انحجز|تم البيع|مباع/,{route_key:o.route||'barka'},{company_id:'c'},async(_c,t)=>PROJECT.test(t.join(' ')));
 const SEE=['شوف العقار أول واذا ناسبك نتكلم في السعر','متى يناسبك تزور ؟'];
 // R16: said he saw it (R44's «مشيت شفته» too), a recorded visit, or the location went out: never «شوف العقار أول»
 let r=await run([...SEE],{said:'أنا مشيت شفته كم آخر سعر'});
 assert.deepEqual(r.texts,[]);assert.equal(r.out.action,'handoff');assert.match(r.out.handoff_reason,/^مشتري جاد:/);
 r=await run([...SEE],{out:{property_id:'p1'},visited:['p1']});
 assert.deepEqual(r.texts,[]);assert.match(r.out.handoff_reason,/^مشتري جاد:/);
 r=await run(['السعر 59 الف',...SEE],{r16:'انرسل له اللوكيشن',prop:{price_negotiable:'fixed'}});
 assert.deepEqual(r.texts,['السعر 59 الف']);assert.equal(r.out.action,'none','a fixed price keeps the answer and is not handed over');
 // before a visit the line stays, and so does the pair the R2 code itself wrote
 r=await run([...SEE]);assert.deepEqual(r.texts,SEE);assert.equal(r.out.action,'none');
 r=await run([...SEE],{out:{visit_first:true},said:'زرت البيت'});assert.deepEqual(r.texts,SEE);
 // R24: withdrawn is «ما متوفره», a property the owner sold is still «انباع»
 const hist=[{direction:'inbound',body:'متوفره ؟',matched_property_id:'g1'}];
 r=await run(['للاسف انباع'],{history:hist,gone:[{id:'g1',archive_reason:'owner_withdrew'}]});
 assert.deepEqual(r.texts,['حالياً ما متوفره']);
 r=await run(['للاسف انباع'],{history:hist,gone:[{id:'g1',archive_reason:'sold_by_owner'}]});
 assert.deepEqual(r.texts,['للاسف انباع']);
 // R34: no photo promise or offer; asking the customer for a picture of the ad is not one
 r=await run(['تمام برسل لك الصور']);assert.deepEqual(r.texts,['السموحة ما عندنا صور','عندنا الفيديو بس']);
 r=await run(['البيت 4 غرف','أرسل لك الصور ؟']);assert.deepEqual(r.texts,['البيت 4 غرف']);
 r=await run(['ارسل صورة الإعلان اذا ما عليك امر']);assert.deepEqual(r.texts,['ارسل صورة الإعلان اذا ما عليك امر']);
 // R44
 r=await run(['البيت لك ولا تعرضه ؟','ارسل الكروكي']);assert.deepEqual(r.texts,['ارسل الكروكي']);
 r=await run(['عندنا في حي عاصم فيلا بـ 59 الف']);assert.deepEqual(r.texts,['عندنا في الرميس فيلا بـ 59 الف']);
 // R9: no project on the Barka number; the ad's «قريب من مدينة السلطان هيثم» is a place, and the Muscat number is free
 r=await run(['بـ 30 الف ما عندنا شي جاهز','بس في مدينة السلطان هيثم عرض بدون دفعة مقدمة']);
 assert.deepEqual(r.texts,['بـ 30 الف ما عندنا شي جاهز']);
 r=await run(['في مدينة السلطان هيثم عرض بدون دفعة مقدمة']);
 assert.deepEqual(r.texts,[]);assert.equal(r.out.action,'handoff');assert.match(r.out.handoff_reason,/R9/);
 r=await run(['توين فيلا في الشخاخيط في موقع قريب من مسقط ومدينة السلطان هيثم']);
 assert.equal(r.texts.length,1);
 r=await run(['في مدينة السلطان هيثم عرض بدون دفعة مقدمة'],{route:'muscat'});assert.equal(r.texts.length,1);
});
test('14 Nov guards, batch 2: price talk before a visit, location before a time, meeting time, project figures',async()=>{
 const block=agent.slice(at('    // ---- 14 Nov 2026, batch 2 ----'),at('    // ---- 14 Nov 2026, batch 3 ----'))
  .replace(/\((\w+): (?:string|any|number)\)/g,'($1)').replace(/\((\w+): any, (\w+): number\)/g,'($1, $2)').replace('const bad: boolean[]','const bad');
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const guards=new AsyncFunction('out','texts','history','visitedIds','SAID_VISITED','SEE_FIRST','r16Seen','prop','visits','conv','msg','mentionsProject',block+'\nreturn {out,texts};');
 const PROJECT=/مدينة السلطان هيثم|عايدة|اليزن/,SEE_FIRST=/شوف[يوا]{0,2}\s*(العقار|البيت|الفيلا|الشقة|المكان)\s*(أول|اول)/;
 const run=(texts,o={})=>guards({action:'none',handoff_reason:null,category:'buyer',property_id:null,viewing_date:null,viewing_time:null,...(o.out||{})},texts,
  o.history||[{direction:'outbound',body:'وعليكم السلام'},{direction:'inbound',body:o.said||'كم السعر'}],new Set(o.visited||[]),re('SAID_VISITED'),SEE_FIRST,async()=>o.r16||null,
  o.prop||null,o.visits||[],{route_key:o.route||'barka'},{company_id:'c'},async(_c,t)=>PROJECT.test(t.join(' ')));
 const SEE='شوف العقار أول واذا ناسبك نتكلم في السعر',ASK='متى يناسبك تزور ؟';
 // R2 / R42 before a visit: the price stays, «ثابت» goes; a discount question gets the two lines
 let r=await run(['السعر 59 الف وهو ثابت','ان شاء الله برسلك الموقع',ASK]);
 assert.deepEqual(r.texts,['السعر 59 الف','ان شاء الله برسلك الموقع',ASK]);assert.equal(r.out.guard_price_before_visit,true);
 r=await run(['السعر قابل للتفاوض بشي بسيط'],{said:'كم آخر سعر ؟'});
 assert.deepEqual(r.texts,[SEE,ASK]);
 // after a visit, or a negotiation the model handed over, nothing is touched
 r=await run(['بالنسبة للسعر نعم ثابت'],{said:'زرت البيت كم آخر سعر'});assert.deepEqual(r.texts,['بالنسبة للسعر نعم ثابت']);
 r=await run(['بالنسبة للسعر نعم ثابت'],{r16:'انرسل له اللوكيشن'});assert.deepEqual(r.texts,['بالنسبة للسعر نعم ثابت']);
 r=await run(['السعر قابل للتفاوض'],{out:{action:'handoff',handoff_reason:'تفاوض: x'}});assert.deepEqual(r.texts,['السعر قابل للتفاوض']);
 r=await run(['السعر 59 الف',ASK]);assert.deepEqual(r.texts,['السعر 59 الف',ASK]);assert.equal(r.out.guard_price_before_visit,undefined);
 // R11: no location before the client said when; a day, an hour, «الحين» or a booked visit is enough
 r=await run(['البيت مفتوح تقدر تشوفه'],{out:{action:'send_location'},said:'ارسل اللوكيشن لو سمحت'});
 assert.equal(r.out.action,'none');assert.deepEqual(r.texts,['ان شاء الله برسلك الموقع',ASK]);
 for(const o of [{said:'بجي بكره الصبح'},{said:'انا طالع الحين'},{out:{action:'send_location',viewing_date:'2026-11-15'}},{visits:[{property_id:'p',status:'scheduled'}]}]){
  r=await run(['البيت مفتوح تقدر تشوفه'],{said:'ارسل اللوكيشن',...o,out:{action:'send_location',...(o.out||{})}});
  assert.equal(r.out.action,'send_location');assert.deepEqual(r.texts,['البيت مفتوح تقدر تشوفه']);
 }
 // R45: the invitation ends with «يناسبك ؟», no day or hour is asked and nothing is confirmed
 r=await run(['الافضل نرتب لك اجتماع مع المطور في مكتبهم','أي يوم يناسبك ؟'],{route:'muscat',out:{category:'investor'}});
 assert.deepEqual(r.texts,['الافضل نرتب لك اجتماع مع المطور في مكتبهم','يناسبك ؟']);
 r=await run(['تمام نشوفك في المكتب بكره'],{route:'muscat'});assert.deepEqual(r.texts,[]);
 r=await run([ASK]);assert.deepEqual(r.texts,[ASK],'the property visit question is not a meeting');
 // R18: only Ahmed's figures about a project on the Muscat number
 const FIX='الاسعار تختلف حسب الوحدة والمساحة والمرحلة';
 r=await run(['التاون هاوس في مدينة السلطان هيثم يبدأ من 85 الف'],{route:'muscat',out:{category:'investor'}});
 assert.deepEqual(r.texts,[FIX]);assert.equal(r.out.guard_project_figure,true);
 r=await run(['الاستوديو في الآيكونيك تاور من 57 الف بنظام فندقي','في مدينة السلطان هيثم عرض بدون دفعة مقدمة لين 30 نوفمبر','في مدينة السلطان هيثم الشراء بـ ٥٠ الف وفوق يعطي إقامة'],{route:'muscat',out:{category:'investor'}});
 assert.equal(r.texts.length,3);assert.equal(r.out.guard_project_figure,undefined);
 r=await run(['عندنا شقة في الخوض بـ 45 الف'],{route:'muscat'});assert.deepEqual(r.texts,['عندنا شقة في الخوض بـ 45 الف'],'a listed property is not a project');
 r=await run(['فيلا في المعبيلة قريب من مدينة السلطان هيثم بـ 85 الف'],{route:'muscat'});assert.equal(r.texts[0].includes('85'),true);
});
test('14 Nov decisions: «حصلت» after «لين الحين تبحث ؟» closes the request with no reply; thanks, «المالك» and the allowed promises are written once',()=>{
 const block=agent.slice(at('    let lastOutBody = "";'),at('    // the ad text goes once per conversation'));
 const run=(said,last='بخصوص طلبك فيلا في الرميس\nلين الحين تبحث ؟',o={})=>{
  const out={action:'none',...o};
  const r=new Function('out','texts','history','burstSaid',block+'\nreturn {out,texts};')(out,['مبروك الله يبارك لك 🌷'],[{direction:'outbound',body:last},{direction:'inbound',body:said}],said);
  return r;
 };
 for(const said of ['حصلت','خلاص حصلت بيت','اشتريت الحمدلله','لقيت واحد','حصل']){const r=run(said);assert.deepEqual(r.texts,[],said);assert.equal(r.out.search_stopped,true,said);}
 for(const said of ['ما حصلت شي','لسا ما لقيت','اي ابحث','حصلت شي جديد ؟']){const r=run(said);assert.equal(r.out.search_stopped,undefined,said);assert.equal(r.texts.length,1,said);}
 assert.equal(run('حصلت','متى يناسبك تزور ؟').out.search_stopped,undefined,'only after our search question');
 assert.match(agent,/status: "cancelled", closed_reason: "العميل قال إنه حصل عقار ووقف البحث \(قفله العقل\)"/);
 assert.match(agent,/if \(!out\.search_stopped && rq && \(/);
 const brain=fs.readFileSync('supabase/functions/whatsapp-reply-agent/brain.ts','utf8');
 assert(!brain.includes('إذا قال حصل: "مبروك'));
 assert(!brain.includes('كلام الختام والشكر ما نرد عليه أبداً'));assert(brain.includes('الرد "العفو" بس، بدون سؤال جديد ولا عرض ولا ضغط'));
 assert(!brain.includes('لا تكتب "المالكة" ولا "المالك"'));assert(brain.includes('الكلمتين مسموحات'));
 assert(brain.includes('هذي الامور الافضل تطلع عليها بنفسك لما تزور المنطقة'));
 assert(brain.includes('المسموح بس (أحمد 14 نوفمبر) جملتين ثابتات'));
});
test('14 Nov guards, batch 3: call request (R12), owner declines (R10 / R20), a pinned reply never over a guarded reply',()=>{
 const block=agent.slice(at('    // ---- 14 Nov 2026, batch 3 ----'),at('    // Ahmed 14 Nov: «حصلت» / «اشتريت» after our'))
  .replace(/\((\w+): (?:string|any|RegExp)\)/g,'($1)');
 const run=(said,o={})=>{
  const out={action:'none',handoff_reason:null,category:'buyer',intent:'x',crm_note:'',...(o.out||{})};
  const history=[...(o.before||[]),...[].concat(said).map((b)=>({direction:'inbound',body:b}))];
  return new Function('out','texts','history','burstSaid','ignored','HARD_HANDOFF','DECLINE_RE','short','review',block+'\nreturn {out,texts};')
   (out,o.texts||['تمام'],history,[].concat(said).join(' '),false,re('HARD_HANDOFF'),re('DECLINE_RE'),(s)=>String(s),false);
 };
 // R12
 for(const said of ['ممكن تتصل علي','اتصل علي لو سمحت','ممكن رقمك','متى تتصلون','ابي احد يتصل','احسن اتصل']){
  const r=run(said);assert.deepEqual(r.texts,[],said);assert.equal(r.out.action,'handoff',said);assert.match(r.out.handoff_reason,/^طلب اتصال:/,said);}
 let r=run('حاولت اتصل فيك وما رديت');assert.deepEqual(r.texts,['تمام'],'the allowed sentence stays with the brain');
 r=run('اتصلت على المالك امس');assert.equal(r.out.guard_call_request,undefined);
 r=run('كلمني عن البيت');assert.equal(r.out.guard_call_request,undefined,'«كلمني عن» is not a call request');
 r=run('اتصل علي',{out:{action:'handoff',handoff_reason:'تفاوض: يبي آخر سعر'}});assert.equal(r.out.handoff_reason,'تفاوض: يبي آخر سعر');
 // R10 / R20: only the owner's own clear words
 const S={out:{category:'seller'},texts:['ارسل الكروكي اذا ما عليك امر']};
 r=run('البيت مال ورثة',S);assert.deepEqual(r.texts,['نعتذر منك احنا ما نستلم عقارات الورثة','الله يسعدك 🌷']);assert.equal(r.out.guard_owner_decline,'heirs');
 r=run('البيت مرهون للبنك',S);assert.deepEqual(r.texts,['نعتذر منك احنا ما نستلم عقارات مرهونة او مسكونة','الله يسعدك 🌷']);
 r=run('احنا ساكنين فيه بس ممكن تنسيق للزيارة',S);assert.equal(r.out.guard_owner_decline,'mortgaged_or_occupied');
 for(const said of ['لا ما فيه رهن والبيت فاضي','مو مرهون','بدون رهن','البيت مو مال ورثة','ما في رهن'])
  {r=run(said,S);assert.equal(r.out.guard_owner_decline,undefined,said);assert.deepEqual(r.texts,S.texts,said);}
 r=run('البيت مرهون',{...S,before:[{direction:'outbound',actor_type:'human',body:'متفقين مع صاحبه'}]});
 assert.equal(r.out.guard_owner_decline,undefined,'a chat the office wrote in is left alone (the property Ahmed brought)');
 r=run('البيت مرهون',{out:{category:'buyer'},texts:['تمام']});assert.equal(r.out.guard_owner_decline,undefined,'a buyer talking about his own mortgage is not an owner');
 r=run('البيت مرهون',{...S,texts:['نعتذر منك احنا ما نستلم عقارات مرهونة او مسكونة']});assert.equal(r.out.guard_owner_decline,undefined,'already declined by the model');
 // R23 is only measured
 r=run('طيب',{out:{action:'handoff',handoff_reason:'يبي يعرف موعد التسليم'},texts:[]});assert.equal(r.out.soft_handoff_no_reply,true);
 // the pinned reply
 assert.match(agent,/if \(ruleAuto && \(out\.search_stopped \|\| Object\.keys\(out\)\.some\(\(k\) => k\.startsWith\("guard_"\)\)\)\) ruleAuto = false;/);
});
test('R54: the whole reply goes as one text message (every bubble counts against Meta\'s 1,000 free a month)',()=>{
 const src=agent.slice(at('    const textParts = outgoingParts.filter('),at('    const projectNamed = await mentionsProject(msg.company_id, out.reply_messages);'))
  .replace(/\((\w+): (?:string|any)\)/g,'($1)').replace('const outgoing: any[]','const outgoing');
 const merge=(parts)=>new Function('outgoingParts',src+'\nreturn outgoing;')(parts);
 const T=(body,preview=false)=>({type:'text',text:{preview_url:preview,body}});
 let o=merge([T('وعليكم السلام ورحمة الله وبركاته'),T('السعر 59 الف'),T('متى يناسبك تزور ؟')]);
 assert.equal(o.length,1);assert.equal(o[0].text.body,'وعليكم السلام ورحمة الله وبركاته\n\nالسعر 59 الف\n\nمتى يناسبك تزور ؟');assert.equal(o[0].text.preview_url,false);
 // the location link joins the same message and keeps its preview; the lockbox photo stays a message of its own, after the text
 o=merge([T('البيت مفتوح تقدر تشوفه'),T('https://maps.google.com/?q=1,2',true),{type:'image',image:{link:'x'}}]);
 assert.equal(o.length,2);assert.equal(o[0].text.body,'البيت مفتوح تقدر تشوفه\n\nhttps://maps.google.com/?q=1,2');assert.equal(o[0].text.preview_url,true);assert.equal(o[1].type,'image');
 assert.deepEqual(merge([]),[],'nothing to say stays nothing');
 assert.equal(merge([T('العفو')])[0].text.body,'العفو');
 // the owner's number is still hidden in a dry-run answer, and a line sent inside an earlier single message still counts as sent (R14)
 assert(agent.includes('String(m.text.body).split("\\n\\n").map((p: string) => (/^\\d{8,}$/.test(p) ? "[رقم صاحب العقار]" : p)).join("\\n\\n")'));
 assert(agent.includes('[r.body, ...String(r.body || "").split(/\\n\\s*\\n/)]'));
 assert(agent.includes('...(redirectToMuscat ? [] : actionMsgs)];\n    // R54'),'the parts are still built from the final reply first');
});
test('R48: the visit watcher books no new visit from the other branch number, and book_viewing counts as serving',()=>{
 assert.match(agent,/select\("id,type,area,price,bedrooms,land_size,listing_purpose,branch_key"\)/);
 assert.match(agent,/cv\.data!\.route_key !== prop\.branch_key\) return \{ \.\.\.out, applied: false, why: "other_branch" \}/);
 assert.match(agent,/\["send_location", "send_lockbox", "send_owner_number", "book_viewing"\]\.includes\(out\.action\)/);
});

test('2: the R2 guard honours R16 (after-visit question, passed visit time, location or owner number sent)',()=>{
 const AFTER=re('AFTER_VISIT_Q'),NOT=re('NOT_A_VISIT_Q');
 for(const t of ['السلام عليكم كيف لقيت فيلا الرميس ؟','السلام عليكم بخصوص فيلا الرميس قدرت تشوفها ؟','السلام عليكم بخصوص زيارة المنزل في الحيل الجنوبية قدرتي تشوفينه ؟','بخصوص الزيارة قدرت تشوف العقار ؟ كيف لقيته ؟','السلام عليكم شفت فيلا الرميس بعد الصلاة وكيف لقيتها ؟'])
  assert(AFTER.test(t)&&!NOT.test(t),t);
 assert(NOT.test('قدرت تشوف الفيديو ؟'),'a question about the video is not the after-visit question');
 assert(!AFTER.test('متى يناسبك تزور ؟'));
 const lam=pick('const visitPassed = ',';\n').replace('const visitPassed = ','').replace('(v: any)','(v)').replace(/;\n$/,'');
 const passed=new Function('dayM','hmM','return '+lam)('2026-11-10','14:00');
 assert.equal(passed({status:'scheduled',viewing_date:'2026-11-09',viewing_time:null}),true,'yesterday');
 assert.equal(passed({status:'scheduled',viewing_date:'2026-11-10',viewing_time:'11:43:00'}),true,'today, hour passed');
 assert.equal(passed({status:'confirmed',viewing_date:'2026-11-10',viewing_time:'16:00:00'}),false,'today, hour not yet');
 assert.equal(passed({status:'scheduled',viewing_date:'2026-11-10',viewing_time:null}),false,'today with no hour');
 assert.equal(passed({status:'postponed',viewing_date:'2026-11-01',viewing_time:null}),false,'a postponed visit is not seen');
 const guard=agent.slice(at('const r16Seen = async'),at('// the ad text goes once per conversation'));
 assert(guard.includes('AFTER_VISIT_Q.test(lastBody) && !NOT_A_VISIT_Q.test(lastBody)'));
 assert(guard.includes('visitPassed(v)'));
 assert(guard.includes('b.includes(p.map_url)'));
 assert(guard.includes('.from("owners").select("phone").in("id", ownerIds)'));
 assert(guard.includes('const r16 = visitedThis || saidVisited ? null : await r16Seen(out.property_id || null);'));
 assert(guard.includes('if (!visitedThis && !saidVisited && !r16) {'));
 assert(guard.includes('"شوف العقار أول واذا ناسبك نتكلم في السعر"'),'R2 still books the visit when nothing says he saw it');
 // crm_note is the agent's memory now: the R2 marker goes on top of the running note instead of replacing it
 assert(guard.includes('out.crm_note = short(`مهتم بالسعر قبل الزيارة: ${out.handoff_reason}${out.crm_note ?'));
 assert(agent.includes('viewing_time,status,properties(type,area,wilayat,price,listing_purpose)'));
});

test('3: owner_with_ahmed only after a typed office message since the hand-back (72 h) or an open price study; declines always go out',()=>{
 assert(agent.includes('const backAt = Math.max(conv.agent_returned_at ? new Date(conv.agent_returned_at).getTime() : 0, Date.now() - 72 * 3600 * 1000);'));
 assert(agent.includes('h.actor_type === "human" && new Date(h.message_timestamp).getTime() > backAt'));
 assert(agent.includes('const priceStudyOpen = !!conv.human_handoff_required && /^\\s*دراسة سعر\\s*:/.test(String(conv.handoff_reason || ""));'));
 assert(agent.includes('const ownerWithAhmed = out.category === "seller" && !declining && (ahmedTyped || priceStudyOpen);'));
 assert(!agent.includes('(priorR.data || []).some((d: any) => /^دراسة سعر/'),'an old price study no longer silences the chat for good');
 const DECLINE=re('DECLINE_RE');
 for(const t of ['نعتذر منك احنا ما نستلم عقارات الورثة','نعتذر منك احنا ما نستلم عقارات مرهونة او مسكونة','المعذره منك ما نستلم عقار مسكون','السموحة منك ما نقدر نستلم بيت مرهون','نعتذر منك البيت مسكون وما نقدر'])assert(DECLINE.test(t),t);
 for(const t of ['كم السعر اللي في بالك ؟','نعتذر منك على التأخير','ارسل الكروكي والملكية'])assert(!DECLINE.test(t),t);
});

test('4: the model sees the client profile, its own memory, properties no longer available and neutral visit labels',()=>{
 for(const s of ['"ملف العميل:"','"عقارات ما عادت متوفرة (مو مباعة):"','ملاحظات العقل السابقة عن العميل','conv.agent_note || conv.ai_summary','- الطلب المفتوح: ','- من بطاقة العميل: ','- صفقاته المفتوحة: ','- تقييمك السابق لجديته: ','هذا العقار ما عاد متوفر (مو مباع)'])
  assert(agent.includes(s),s);
 assert(!agent.includes('ملخص سابق للعميل'),'the webhook one-message summary line gave way to the profile');
 assert(!agent.includes('properties(title'),'visits never carry the office title (owner names)');
 assert(agent.includes('${neutralLabel(v.properties)}'));
 const src=[pick('const TYPE_AR','\n'),pick('const typeAr','\n'),pick('function neutralLabel','\n}\n')].join('\n')
  .replace(': Record<string, string>','').replace('(t: unknown)','(t)').replace('(p: any)','(p)');
 assert(!/p\.title|p\.internal_name/.test(pick('function neutralLabel','\n}\n')));
 const {neutralLabel}=new Function(src+';return {neutralLabel};')();
 assert.equal(neutralLabel({type:'villa',area:'الرميس',price:59000,title:'فيلا الرميس 59 سلطان'}),'فيلا للبيع | الرميس | 59,000 ريال');
 assert.equal(neutralLabel(null),'عقار');
 // contract A: archived, not sold, last 150 days, never duplicates or test records
 assert(agent.includes('.eq("archived", true).in("status", ["withdrawn", "not_available"])'));
 assert(agent.includes('.gte("archived_at", since)'));
 assert(agent.includes('!["duplicate", "test_record"].includes(String(p.archive_reason || ""))'));
 assert(agent.includes('contract_expired: "انتهى عقد التسويق"')&&agent.includes('owner_withdrew: "المالك سحب العقار"'));
 // contract B: merged cards never show
 assert(agent.includes('!d.merged_into_deal_id'));
});

test('4: the profile keeps branch and investment isolation, and never says "nothing" when it could not read',()=>{
 const invReq=fn('const invReq = ','(r: any)','(r)');
 const hide=new Function('allReqs','conv','invReq','hiddenReqIds',pick('for (const r of allReqs) if (invReq(r)',';\n')+'return hiddenReqIds;');
 const pickReqs=new Function('allReqs','hiddenReqIds','conv','invReq',pick('const reqs = allReqs.filter(','.slice(0, 2);').replace('const reqs = ','return ').replace(/\(r: any\)/g,'(r)'));
 const run=(all,route)=>{const conv={route_key:route};const h=hide(all,conv,invReq,new Set());return {hidden:[...h],shown:pickReqs(all,h,conv,invReq).map((r)=>r.id)};};
 const all=[{id:'g',status:'active',route_key:'general',branch_key:'general'},{id:'m',status:'active',route_key:'muscat',branch_key:'muscat'},
  {id:'x',status:'cancelled',route_key:'barka',branch_key:'barka'},{id:'b',status:'active',route_key:'barka',branch_key:'barka'},{id:'i',status:'active',route_key:'investment',branch_key:'investment'}];
 // a branch-free request (311 live 'general' ones) shows on both numbers; the other number's request does not
 assert.deepEqual(run(all,'barka'),{hidden:['i'],shown:['g','b']});
 assert.deepEqual(run(all,'muscat'),{hidden:[],shown:['g','m']});
 // an investment request only ever reaches the Muscat number
 assert.deepEqual(run([all[4],all[3]],'muscat').shown,['i']);
 assert.deepEqual(run([all[4],all[3]],'barka'),{hidden:['i'],shown:['b']});
 const openDeals=new Function('deals','hiddenReqIds','conv','reqsRead',pick('const openDeals = ','"investment")));').replace('const openDeals = ','return ').replace('((dr.data || []) as any[])','deals').replace('(d: any)','(d)')+';');
 const deals=[{id:1,request_id:'b',properties:{branch_key:'barka'}},{id:2,request_id:'i',properties:{branch_key:'muscat'}},{id:3,request_id:null,properties:{branch_key:'barka'}},{id:4,request_id:'b',merged_into_deal_id:9,properties:{branch_key:'barka'}}];
 assert.deepEqual(openDeals(deals,new Set(['i']),{route_key:'barka'},true).map((d)=>d.id),[1,3],'the deal on an investment request stays off Barka; a merged card never shows');
 assert.deepEqual(openDeals(deals,new Set(),{route_key:'barka'},false).map((d)=>d.id),[3],'off Muscat, a deal on a request we could not read stays out');
 assert.deepEqual(openDeals(deals,new Set(),{route_key:'muscat'},true).map((d)=>d.id),[1,2,3]);
 // a failed read throws inside the try, so neither "no request" nor "no deals" is written
 const reqTry=agent.slice(at('if (reqR.error) throw new Error(reqR.error.message);'),at('const card = ['));
 assert(reqTry.indexOf('reqsRead = true;')>0&&reqTry.indexOf('"- الطلب المفتوح: ما في طلب مسجل"')>reqTry.indexOf('reqsRead = true;'));
 assert(at('if (dr.error) throw new Error(dr.error.message);')<at('"- صفقاته المفتوحة: ما في"'));
});

test('5: the schema adds seriousness, seriousness_reason, meeting and book_meeting, all required (strict)',()=>{
 const src=pick('const schema = {','\n};');
 const schema=new Function(src.replace('const schema =','return'))();
 const strict=(s,path)=>{
  if(s.anyOf){s.anyOf.forEach((x,i)=>strict(x,path+'|'+i));return;}
  if(s.type==='object'){assert.equal(s.additionalProperties,false,path);assert.deepEqual([...s.required].sort(),Object.keys(s.properties).sort(),path);for(const [k,v] of Object.entries(s.properties))strict(v,path+'.'+k);}
  if(s.items)strict(s.items,path+'[]');
 };
 strict(schema,'schema');
 assert.deepEqual(schema.properties.seriousness.enum,['strong','possible','weak','unknown']);
 assert.equal(schema.properties.seriousness_reason.type,'string');
 const meeting=schema.properties.meeting.anyOf.find((x)=>x.type==='object');
 assert.deepEqual(meeting.properties.place.enum,['office','online','developer','dar_global','project_tbd']);
 assert.deepEqual(meeting.properties.date.type,['string','null']);
 assert.deepEqual(meeting.properties.time.type,['string','null']);
 assert(schema.properties.action.enum.includes('book_meeting'));
 assert(agent.includes('"client_name_stated", "name_declined", "mustahiq_waitlist"]'),'the required list still ends the same way (R31 added the waiting list flag)');
});

test('5: memory and seriousness are saved on live runs only, and an empty note never wipes the memory',()=>{
 const mem=agent.slice(at("// the agent's own memory (contract C"),at('const backAt'));
 assert(mem.includes('if (!review) {'));
 assert(mem.includes('if ("agent_note" in conv && String(out.crm_note || "").trim()) mem.agent_note = short(out.crm_note, 1500);'));
 for(const s of ['mem.agent_seriousness = ','mem.agent_seriousness_reason = ','mem.agent_profile_at = '])assert(mem.includes(s),s);
 assert(mem.includes('if ("agent_seriousness" in conv)')&&mem.includes('if ("agent_profile_at" in conv)'),'only columns that exist are written');
 assert(at("// the agent's own memory (contract C")>at('status: "rewritten"'),'a rewrite never saves memory');
});

test('5 + R45: any meeting request is a silent «اجتماع:» handoff with whatever day and hour the client said, one alert and one task',()=>{
 const block=agent.slice(at('const MEETING_PLACE'),at('    // the agent may only touch properties that are really available')).replace(': Record<string, string>','');
 const run=(o,conv={})=>new Function('out','conv','client','dayM','short',block+'\nreturn out;')(o,conv,{name:'أبو سالم'},'2026-11-10',short);
 let o=run({action:'book_meeting',meeting:{place:'office',date:'2026-11-12',time:'9:30'},handoff_reason:'اجتماع: يبي جدول الدفع في مدينة السلطان هيثم',intent:'x',reply_messages:['تمام وصلت']});
 assert.equal(o.action,'book_meeting');
 assert.equal(o.meeting.time,'09:30');
 assert.equal(o.handoff_reason,'اجتماع: أبو سالم مكتب الموالح 2026-11-12 09:30 يبي جدول الدفع في مدينة السلطان هيثم (ينتظر تأكيدك)');
 assert.deepEqual(o.reply_messages,[],'R45: the agent says nothing, Ahmed answers');
 o=run({action:'book_meeting',meeting:{place:'developer',date:'2026-11-10',time:'17:00'},handoff_reason:'اجتماع: x',intent:'x',reply_messages:['تمام نشوفك اليوم']});
 assert.equal(o.action,'book_meeting');assert.deepEqual(o.reply_messages,[]);assert(o.handoff_reason.includes('2026-11-10 17:00'),'today too: Ahmed decides');
 o=run({action:'book_meeting',meeting:{place:'online',date:'2026-11-12',time:null},handoff_reason:'اجتماع: x',intent:'x'});
 assert.equal(o.action,'book_meeting');assert.equal(o.handoff_reason,'اجتماع: أبو سالم اونلاين 2026-11-12 x (ينتظر تأكيدك)');
 o=run({action:'book_meeting',meeting:{place:'office',date:'2026-11-09',time:'10:00'},handoff_reason:null,intent:'x'});
 assert.equal(o.meeting.date,null,'a day already gone is dropped');assert(o.handoff_reason.startsWith('اجتماع: أبو سالم مكتب الموالح 10:00'));
 o=run({action:'handoff',meeting:null,handoff_reason:'اجتماع: مستثمر مهتم',intent:'x',reply_messages:['متى يناسبك ؟']});
 assert.equal(o.action,'book_meeting');assert.equal(o.handoff_reason,'اجتماع: أبو سالم بدون موعد مستثمر مهتم (ينتظر تأكيدك)');assert.deepEqual(o.reply_messages,[]);
 o=run({action:'handoff',meeting:null,handoff_reason:'طلب موعد: بكره الساعة 10 يبي يمر المكتب',intent:'x',reply_messages:['تمام وصلت']});
 assert.equal(o.handoff_reason,'اجتماع: أبو سالم بدون موعد بكره الساعة 10 يبي يمر المكتب (ينتظر تأكيدك)','an office visit request is the same silent meeting handoff');
 assert(re('HARD_HANDOFF').test(o.handoff_reason),'R45: a meeting request silences the agent');
 // after the send: soft handoff, Ahmed alerted once with a task on the meeting day
 assert(agent.includes('const meetingBooked = out.action === "book_meeting" && /^\\s*اجتماع\\s*:/.test(String(out.handoff_reason || ""));'));
 assert(agent.includes('if (out.action === "handoff" || meetingBooked) Object.assign(convPatch, { human_handoff_required: true'));
 const mt=agent.slice(at('if (meetingBooked && !out.meeting_already_booked) {'),at('const flags: any = {};'));
 assert(mt.includes('await notifyHandoff(msg.company_id, conv, client, out.handoff_reason, true);'),'the meeting alert goes to the owner himself');
 // R30: the task is to confirm the slot, due today, with the meeting day in its title
 assert(mt.includes('due_date: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Muscat" }).format(new Date()), priority: "high"')&&mt.includes('أكد الموعد مع العميل أو اقترح وقت ثاني'));
 assert(at('if (meetingBooked && !out.meeting_already_booked) {')>at('const wamid = await metaSend'),'the meeting is handed over after the reply went out');
 assert(agent.includes('/^اجتماع/.test(reason) ? "📅 اجتماع"'));
});

test('5: handoff alerts reach an active account: the assignee while active, else the owner; a booked meeting always the owner',async()=>{
 const src=pick('async function notifyHandoff(','\n}\n').replace(/: (?:string|any)(?=[,)])/g,'').replace(/\(e as any\)/g,'e');
 // 10 Nov live: Barka chats sit with the Barka agent, 352 chats with a retired account, the rest with the owner
 const profiles=[{id:'owner',company_id:'c',role:'owner',is_active:true},{id:'barka',company_id:'c',role:'agent',is_active:true},{id:'retired',company_id:'c',role:'agent',is_active:false}];
 const send=async(assigned,reason,toOwner)=>{
  const rows=[];
  const db={from:(table)=>{const f={};const q={select:()=>q,eq:(k,v)=>{f[k]=v;return q;},limit:()=>q,
   maybeSingle:async()=>({data:profiles.find((p)=>Object.entries(f).every(([k,v])=>p[k]===v))||null,error:null}),
   insert:async(row)=>{rows.push({table,...row});return {error:null};}};return q;}};
  const notify=new Function('db','short','return '+src)(db,short);
  await notify('c',{assigned_to:assigned,customer_name:'عميل'},{id:'cl',name:'أبو سالم'},reason,toOwner);
  return rows;
 };
 const to=async(...a)=>(await send(...a)).map((r)=>r.table+':'+r.user_id);
 assert.deepEqual(await to('barka','طلب اتصال: يبي اتصال'),['notifications:barka'],'an active assignee keeps his alerts');
 assert.deepEqual(await to('retired','طلب اتصال: يبي اتصال'),['notifications:owner'],'a retired account never swallows an alert');
 assert.deepEqual(await to(null,'مو واضح: صورة'),['notifications:owner']);
 const meeting=await send('barka','اجتماع: أبو سالم مكتب الموالح 2026-11-12 10:00 جدول الدفع',true);
 assert.deepEqual(meeting.map((r)=>r.user_id),['owner'],'a booked meeting goes to Ahmed himself, never to a branch agent');
 assert(meeting[0].title.startsWith('📅 اجتماع: أبو سالم'));
 assert.deepEqual(await to('retired','اجتماع: x',true),['notifications:owner']);
});

test('5: an open soft handoff, a booked «اجتماع:» meeting included, never steers the agent to silence by itself (R23)',()=>{
 const line=agent.slice(at('`موضوع محول لأحمد ولسا ما خلص'),at('"العقارات المتاحة الآن'));
 assert(!line.includes('reply_messages=[] و action=handoff'),'a question about the open topic is not answered with silence');
 assert(line.includes('وهذا التحويل ما يسكّتك (R23): رد على رسالة العميل عادي'));
 assert(line.includes('إذا الموضوع "اجتماع:" فالموعد محجوز: أكد له اليوم والساعة إذا سأل'));
 assert(line.includes('وإذا غيّر الموعد book_meeting بالموعد الجديد'));
 assert(line.includes('action=handoff بس إذا طلب شي جديد لازم أحمد يسويه'));
 // silence only for the R23 cases, or urging what only Ahmed can give once it was answered (brain «السكوت والتحويل»)
 assert(line.includes('تسكت (reply_messages=[] و action=none) بس في حالات R23، أو إذا يستعجل أو يعيد طلب ما يقدر عليه غير أحمد'));
 assert(line.includes('وانت رديت عليه فيه قبل'));
 assert(agent.indexOf('...(conv.human_handoff_required && !hardHandoff ? [`موضوع محول لأحمد ولسا ما خلص')>0,'shown for soft handoffs only');
});

test('6: a repeated "done" with no open visit does not insert a second done viewing within 14 days',()=>{
 const fn6=agent.slice(at('async function watchVisit('),at('Deno.serve('));
 const done=fn6.slice(fn6.indexOf('} else if (out.event === "done") {'),fn6.indexOf('} else if (out.event === "cancelled") {'));
 assert(done.includes('if (open) w = await db.from("viewings").update({ status: "done" }).eq("id", open.id);'),'an open visit is still closed as done');
 assert(done.includes('.eq("archived", false).eq("status", "done").gte("viewing_date", since14)'));
 assert(done.includes('14 * 86400000'));
 assert(done.indexOf('why: "already_recorded"')>0&&done.indexOf('why: "already_recorded"')<done.indexOf('.insert('),'checked before the insert');
});

test('7: first-person call promises are never sent, the R12 sentence is',()=>{
 const P=re('PROMISE_RE'),C=re('CALL_PROMISE_RE');
 for(const t of ['تمام بتصل عليك ان شاء الله','تمام بتصل عليك باكر الصبح ان شاء الله','ايوا لكن خلاص بكلمك ف وقت ثاني','ان شاء الله اتصل عليك العصر','بتصل فيك بعد شوي','بتواصل معك بالاتصال']){assert(P.test(t),t);assert(C.test(t),t);}
 for(const t of ['حاليا الاستاذ احمد مشغول ان شاء الله اول ما يفضى يتصل فيك بس خبرنا وش الموضوع ونقدر نساعدك هنا في الواتساب','اول ما يتوفر بتواصل معك','تمام اول ما تتوفر بتواصل معك','اتصلت عليك وما رديت'])assert(!P.test(t),t);
 for(const t of ['بشوف وارد عليك','بتأكد من صاحب العقار وارد عليك','برجع لك بعدين'])assert(P.test(t),t);
 // the call promise taken out reaches Ahmed as a call request
 assert(agent.includes('const callPromised = texts.some((t) => CALL_PROMISE_RE.test(t));'));
 assert(agent.includes('`طلب اتصال: ${short(out.intent || out.crm_note, 280)}`'));
 assert(at('const callPromised')<at('texts = texts.filter((t) => !PROMISE_RE.test(t));'));
});

test('8: the dry-run copy never sends; an inline dry run claims no draft, writes nothing and answers in the response',()=>{
 assert(agent.includes('forcedDry = new URL(req.url).pathname.includes("reply-agent-dryrun")'));
 assert(agent.includes('let dry = body?.dry_run === true || body?.inline === true || forcedDry;'),'inline alone is a dry run too');
 assert(agent.includes('dry = forcedDry || d.data.analysis?.dry_run === true;'));
 assert(agent.includes('const review = dry || !!redo;'),'a dry run is a review: no send and no CRM write');
 assert(agent.includes('const inline = !redo && dry && body?.inline === true;'));
 assert(agent.includes('else if (!inline) {\n    const claim = await db.from("whatsapp_reply_drafts").insert('),'no draft claim, so a message with a real draft works');
 assert(agent.includes('if (!redo && !inline) await db.from("whatsapp_reply_drafts").update({ status, error: why })'));
 assert(agent.includes('if (!redo && !inline) await db.from("whatsapp_reply_drafts").update({ status: "failed", error: why })'));
 assert(agent.includes('inline ? undefined : (b, m) => db.storage.from("whatsapp-voice")'),'no audio copy');
 assert(agent.includes('if (!inline) await saveVoice('),'no transcript saved');
 assert(agent.includes('if (inline) {\n        // crm_client_behavior_text recomputes'),'the behaviour row is read, not recomputed');
 const ret=agent.slice(at('if (inline) {\n      const send_preview'),at('if (dry || holdForOwner || (rt.reply_agent_mode === "approval" && !autoSend))'));
 for(const k of ['reply_messages','action','handoff_reason','category','seriousness','seriousness_reason','meeting','crm_note'])assert(new RegExp('\\b'+k+':').test(ret),k);
 assert(ret.includes('send_preview, analysis })'));
 assert(ret.includes('forced_dry: forcedDry'),'after a deploy, an inline call shows whether the dry-run copy recognised itself');
 assert(ret.includes('"[رقم صاحب العقار]"'),'the owner number never comes back in the response');
 assert(at('if (inline) {\n      const send_preview')<at('const wamid = await metaSend'));
 // a candidate commit is tried with its own brain and knowledge (R18's figures live in knowledge.ts)
 const sha=agent.slice(at('if (dry && /^[0-9a-f]{40}$/.test(String(body?.brain_sha || ""))) {'),at('if (BRAIN.length < 2000) return fail("prompt_missing", "failed");'));
 assert(sha.includes('${body.brain_sha}/supabase/functions/whatsapp-reply-agent/knowledge.ts'));
 assert(sha.includes('if (mk && mk[1].length > 1000) INVESTOR_KNOWLEDGE = mk[1];'));
});

// Dry run of 10 Nov 2026 (39 real chats): four misses fixed in code before publishing.
test('R17: a residency answer that opens with a denial is replaced by the two fixed residency lines',()=>{
 const NEG=re('NEG_RESIDENCY_RE');
 for(const s of ['ما في قيمة عقار تضمن إقامة دائمة بشكل تلقائي','ما في عقار يضمن للمشتري إقامة دائمة','ما في إقامة','لا يوجد عقار يضمن الإقامة'])assert(NEG.test(s),s);
 for(const s of ['ما عندنا شقق للإقامة الفندقية','الشراء بـ 50 الف وفوق يعطي إقامة للمشتري وعائلته','ما متوفر حالياً'])assert(!NEG.test(s),s);
 assert(agent.includes('const badResidency = (t: string) => NEG_RESIDENCY_RE.test(t) || promisesResidency(t);'));
 assert(agent.includes('texts.flatMap((t) => (badResidency(t) ? fixed : [t]))'));
 assert(agent.includes('في مدينة السلطان هيثم الشراء بـ 50 الف وفوق يعطي إقامة للمشتري وعائلته وتتجدد كل سنتين حسب الأنظمة'));
});
test('R17: a line that promises residency is dropped, or replaced when no 50,000 fact is left',()=>{
 const W=re('RESIDENCY_WORD_RE'),P=re('RESIDENCY_PROMISE_RE'),J=re('RESIDENCY_WORK_RE');
 const promises=(t)=>W.test(t)&&P.test(t)&&!J.test(t);
 for(const s of ['الإقامة الدائمة ما لها سعر محدد ومضمونة بمجرد شراء العقار','بمجرد ما تشتري تاخذ الاقامة','الإقامة مضمونة 100%','تحصل على إقامة تلقائياً'])assert(promises(s),s);
 for(const s of ['في مدينة السلطان هيثم الشراء بـ 50 الف وفوق يعطي إقامة للمشتري وعائلته وتتجدد كل سنتين حسب الأنظمة','والإقامة الذهبية من 200 الف وتتجدد كل 10 سنوات','إقامة مالك العقار ما تعطي حق العمل تلقائياً','السعر مضمون لين نهاية الشهر'])assert(!promises(s),s);
 assert(agent.includes('const factsKept = kept.some((t) => RESIDENCY_WORD_RE.test(t) && /50|٥٠|خمسين/.test(t));'));
 assert(agent.includes('texts = factsKept ? kept :'));
});
test('R15: a client named «أم ...» is flagged as a woman in the context',()=>{
 const F=re('FEMALE_KUNYA_RE');
 for(const s of ['ام راكان','أم محسن | ','عميل | ام سالم'])assert(F.test(s),s);
 for(const s of ['إمام سالم','عبدالله','سلامة | '])assert(!F.test(s),s);
 assert(agent.includes('العميلة امرأة (اسمها «أم ...»): خاطبها بالمؤنث'));
});
test('R15: «Om Muhsen» typed in Latin letters counts only when the customer writes in Arabic',()=>{
 const L=re('FEMALE_KUNYA_LATIN_RE');
 for(const s of ['Om Muhsen Almosawy | Om Muhsen Almosawy',' | Um Rakan🤍','Umm Ali | ','x | oum_salem'])assert(L.test(s),s);
 for(const s of ['Omar Ali | ','Mohammed | ','Ahmed Umair | ','Om | '])assert(!L.test(s),s);
 assert(agent.includes('&& history.some((h: any) => h.direction === "inbound" && /[ء-ي]/.test(String(h.body || ""))))'));
});
test('every map link in the chat says which property it belongs to and whether it is still available',()=>{
 assert(agent.includes('const mapNote = (text: string) => {'));
 assert(agent.includes('extra += mapNote(h.body);'));
 assert(agent.includes('select("id,type,area,wilayat,price,status,title,map_url")'),'the sold list carries map_url');
 assert(agent.includes('"id,type,area,wilayat,price,listing_purpose,status,archive_reason,map_url"'),'the no-longer-available list carries map_url');
});
test('a client who only answers «اسمك الكريم ؟» gets the next step, not silence',()=>{
 const brain=fs.readFileSync('supabase/functions/whatsapp-reply-agent/brain.ts','utf8');
 assert(brain.includes('إذا رده كان بس اسمه (جواب "اسمك الكريم ؟") وقبلها كان يسأل أو يبي تفاصيل: لا تسكت.'));
});
// R29 (Ahmed 11 Nov): «ايوه لقيناها الفيلا» after our after-visit question is not a purchase; no «مبروك» without one
test('R29: a congratulation needs the customer to say they bought, reserved or paid',()=>{
 const C=re('CONGRATS_RE'),B=re('BOUGHT_RE'),A=re('AFTER_VISIT_Q');
 assert(C.test('مبروك الله يبارك لك 🌷'));
 for(const s of ['ايوه لقيناها الفيلا','وعليكم السلام','شفناها','الله يرزقك'])assert(!B.test(s),s);
 for(const s of ['حجزنا الفيلا الحمدلله','اشترينا بيت','دفعت العربون'])assert(B.test(s),s);
 assert(A.test('السلام عليكم كيف شفتي فيلا الشخاخيط وايش انطباعك عنها ؟')&&A.test('السلام عليكم كيف لقيتي فيلا الشخاخيط ؟'));
 assert(agent.includes('texts = ["حياك الله، وايش انطباعك بعد الزيارة ؟"]'));
 const brain=fs.readFileSync('supabase/functions/whatsapp-reply-agent/brain.ts','utf8');
 assert(brain.includes('قاعدة ثابتة (R29، أحمد 11 نوفمبر)')&&brain.includes('ممنوع "مبروك" أو "الله يبارك لك"'));
});
// R30 (Ahmed 11 Nov): project meetings at the developer's office in Al Udhaybah; the agent never confirms a slot; never today
test('R30 + R45: meeting at Al Udhaybah, the agent never sets or confirms a time, Ahmed confirms with the button',()=>{
 assert(agent.includes('developer: "مكتب الأهلي صبور في العذيبة"'));
 assert(agent.includes('(ينتظر تأكيدك)')&&agent.includes('out.reply_messages = [];'));
 const brain=fs.readFileSync('supabase/functions/whatsapp-reply-agent/brain.ts','utf8');
 assert(brain.includes('مع المطور الأهلي صبور في مكتبهم بالعذيبة')&&brain.includes('انت ما تحدد ولا تقترح ولا تسأل عن يوم أو وقت أبداً'));
 assert(!brain.includes('"أي يوم يناسبك ؟"'),'R45: the invitation asks no day');
 assert(!brain.includes('تمام ان شاء الله نشوفك الاحد الساعة 5 في المكتب'));
 const hot=fs.readFileSync('supabase/functions/whatsapp-owner-hot-alert/index.ts','utf8');
 assert(hot.includes('📅 طلب اجتماع ينتظر تأكيدك'));
 const ui=fs.readFileSync('crm-calls-meetings.js','utf8');
 assert(ui.includes('أكّد الموعد وارسله للعميل')&&ui.includes('crmSendWhatsApp({client_id:task.client_id'));
});
// R31 (Ahmed 11 Nov): «المستحقين» stopped; askers go on a waiting list
test('R31: المستحقين stopped, askers join the waiting list',()=>{
 const k=fs.readFileSync('supabase/functions/whatsapp-reply-agent/knowledge.ts','utf8');
 assert(k.includes('طرح المستحقين في مدينة السلطان هيثم حالياً موقف')&&k.includes('mustahiq_waitlist=true'));
 assert(agent.includes('mustahiq_waitlist: { type: "boolean" }')&&agent.includes('"name_declined", "mustahiq_waitlist"]'));
 assert(agent.includes('await db.from("mustahiq_waitlist").upsert(')&&agent.includes('conv.route_key !== "owner"'));
 const s=fs.readFileSync('db/changes/87-mustahiq-waitlist.forward.sql','utf8');
 assert(s.includes('UNIQUE (company_id, client_id)')&&s.includes("route_key IS DISTINCT FROM 'owner'"));
 const p=fs.readFileSync('crm-investment-projects.js','utf8');
 assert(p.includes('قائمة انتظار المستحقين')&&p.includes("data-ip=\"wdone\""));
});

test('R33: each project meeting is at its developer (Aida at Dar Global by the Opera House), never Mawaleh (12 Nov)',()=>{
 const brain=fs.readFileSync('supabase/functions/whatsapp-reply-agent/brain.ts','utf8');
 const block=agent.slice(at('const MEETING_PLACE'),at('    // the agent may only touch properties that are really available')).replace(': Record<string, string>','');
 const run=(o,conv={})=>new Function('out','conv','client','dayM','short',block+'\nreturn out;')(o,conv,{name:'أبو سالم'},'2026-11-10',short);
 let o=run({action:'book_meeting',meeting:{place:'dar_global',date:'2026-11-12',time:'10:00'},handoff_reason:'اجتماع: عايدة',intent:'x',reply_messages:['تمام وصلت']});
 assert.equal(o.handoff_reason,'اجتماع: أبو سالم مكتب دار جلوبال عند دار الأوبرا 2026-11-12 10:00 عايدة (ينتظر تأكيدك)');
 o=run({action:'book_meeting',meeting:{place:'project_tbd',date:'2026-11-12',time:'10:00'},handoff_reason:'اجتماع: اليزن',intent:'x',reply_messages:['تمام وصلت']});
 assert(o.handoff_reason.includes('عند المطور (المكان يحدده أحمد)'));
 assert(brain.includes('كل مشروع اجتماعه عند مطوره (R33، أحمد 12 نوفمبر)، أبداً في الموالح'));
 assert(brain.includes('عايدة (دار جلوبال) في مكتبهم عند دار الأوبرا'));
});
