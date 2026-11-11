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
 const rebuild=at('const outgoing: any[] = [...out.reply_messages.map(');
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
 const block=agent.slice(at('    const MUSCAT_AREAS = '),at('    // no English type codes reach the customer'))
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
 assert.deepEqual(meeting.properties.place.enum,['office','online','developer']);
 assert.deepEqual(meeting.properties.date.type,['string','null']);
 assert.deepEqual(meeting.properties.time.type,['string','null']);
 assert(schema.properties.action.enum.includes('book_meeting'));
 assert(agent.includes('"client_name_stated", "name_declined"]'),'the required list still ends the same way');
});

test('5: memory and seriousness are saved on live runs only, and an empty note never wipes the memory',()=>{
 const mem=agent.slice(at("// the agent's own memory (contract C"),at('const backAt'));
 assert(mem.includes('if (!review) {'));
 assert(mem.includes('if ("agent_note" in conv && String(out.crm_note || "").trim()) mem.agent_note = short(out.crm_note, 1500);'));
 for(const s of ['mem.agent_seriousness = ','mem.agent_seriousness_reason = ','mem.agent_profile_at = '])assert(mem.includes(s),s);
 assert(mem.includes('if ("agent_seriousness" in conv)')&&mem.includes('if ("agent_profile_at" in conv)'),'only columns that exist are written');
 assert(at("// the agent's own memory (contract C")>at('status: "rewritten"'),'a rewrite never saves memory');
});

test('5: book_meeting is booked only with a day and an hour, as a soft «اجتماع:» handoff, with one alert and one task per slot',()=>{
 const block=agent.slice(at('const MEETING_PLACE'),at('    // the agent may only touch properties that are really available')).replace(': Record<string, string>','');
 const run=(o,conv={})=>new Function('out','conv','client','dayM','short',block+'\nreturn out;')(o,conv,{name:'أبو سالم'},'2026-11-10',short);
 let o=run({action:'book_meeting',meeting:{place:'office',date:'2026-11-12',time:'9:30'},handoff_reason:'اجتماع: يبي جدول الدفع في مدينة السلطان هيثم',intent:'x'});
 assert.equal(o.action,'book_meeting');
 assert.equal(o.meeting.time,'09:30');
 assert.equal(o.handoff_reason,'اجتماع: أبو سالم مكتب الموالح 2026-11-12 09:30 يبي جدول الدفع في مدينة السلطان هيثم');
 o=run({action:'book_meeting',meeting:{place:'online',date:'2026-11-12',time:null},handoff_reason:'اجتماع: x',intent:'x'});
 assert.equal(o.action,'none');assert.equal(o.handoff_reason,null);assert.equal(o.meeting_waits,true);
 o=run({action:'book_meeting',meeting:{place:'office',date:'2026-11-09',time:'10:00'},handoff_reason:null,intent:'x'});
 assert.equal(o.action,'none','a day already gone is not booked');
 o=run({action:'handoff',meeting:null,handoff_reason:'اجتماع: مستثمر مهتم',intent:'x'});
 assert.equal(o.action,'handoff');assert.equal(o.handoff_reason,'طلب اجتماع بدون موعد: مستثمر مهتم','no meeting alert without a day and an hour');
 const booked='اجتماع: أبو سالم مكتب الموالح 2026-11-12 09:30 جدول الدفع';
 o=run({action:'book_meeting',meeting:{place:'office',date:'2026-11-12',time:'09:30:00'},handoff_reason:'اجتماع: تأكيد',intent:'x'},{human_handoff_required:true,handoff_reason:booked});
 assert.equal(o.handoff_reason,booked);assert.equal(o.meeting_already_booked,true,'the same slot again is not a new booking');
 o=run({action:'handoff',meeting:null,handoff_reason:'اجتماع: تمام',intent:'x'},{human_handoff_required:true,handoff_reason:booked});
 assert.equal(o.handoff_reason,booked,'the booked meeting stays as it is');
 o=run({action:'book_meeting',meeting:{place:'developer',date:'2026-11-13',time:'16:00'},handoff_reason:'اجتماع: موعد جديد',intent:'x'},{human_handoff_required:true,handoff_reason:booked});
 assert(o.handoff_reason.startsWith('اجتماع: أبو سالم مكتب المطور 2026-11-13 16:00')&&!o.meeting_already_booked,'a changed slot is a new booking');
 // after the send: soft handoff, Ahmed alerted once with a task on the meeting day
 assert(agent.includes('const meetingBooked = out.action === "book_meeting" && /^\\s*اجتماع\\s*:/.test(String(out.handoff_reason || ""));'));
 assert(agent.includes('if (out.action === "handoff" || meetingBooked) Object.assign(convPatch, { human_handoff_required: true'));
 const mt=agent.slice(at('if (meetingBooked && !out.meeting_already_booked) {'),at('const flags: any = {};'));
 assert(mt.includes('await notifyHandoff(msg.company_id, conv, client, out.handoff_reason, true);'),'the meeting alert goes to the owner himself');
 assert(mt.includes('due_date: out.meeting.date'));
 assert(at('if (meetingBooked && !out.meeting_already_booked) {')>at('const wamid = await metaSend'),'the meeting is handed over after the reply went out');
 assert(agent.includes('/^اجتماع/.test(reason) ? "📅 اجتماع"'));
 assert(!re('HARD_HANDOFF').test(booked),'a meeting is a soft handoff: the agent keeps answering');
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
 assert(A.test('السلام عليكم كيف شفتي فيلا الشخاخيط ؟ عجبتك ولا ما ناسبتك ؟')&&A.test('السلام عليكم كيف لقيتي فيلا الشخاخيط ؟'));
 assert(agent.includes('texts = ["حياك الله، طيب عجبتك ولا ما ناسبتك ؟"]'));
 const brain=fs.readFileSync('supabase/functions/whatsapp-reply-agent/brain.ts','utf8');
 assert(brain.includes('قاعدة ثابتة (R29، أحمد 11 نوفمبر)')&&brain.includes('ممنوع "مبروك" أو "الله يبارك لك"'));
});
