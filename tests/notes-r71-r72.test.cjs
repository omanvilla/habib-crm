'use strict';
// Notes of Ahmed, 14 Nov 2026 18:35 to 18:39 (crm_owner_notes 6793c909, 7c28d6ca, 41e2db0a, 13382d75), held by code:
// R71 a client who booked, was congratulated and only closes the talk gets no reply, no draft and no follow-up; an order
// «ما يحتاج نرد / الغي» on a waiting draft closes it; R72 «🔥 مشتري جاد» never for a lower budget, a wait or no liking.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const agent=fs.readFileSync('supabase/functions/whatsapp-reply-agent/index.ts','utf8').replace(/\r\n/g,'\n');
const fu=fs.readFileSync('supabase/functions/whatsapp-visit-followup-auto/index.ts','utf8').replace(/\r\n/g,'\n');
const approvals=fs.readFileSync('crm-reply-approvals.js','utf8'),index=fs.readFileSync('index.html','utf8');
const pickFrom=(src)=>(start,end)=>{const a=src.indexOf(start);assert(a>=0,'missing: '+start);const b=src.indexOf(end,a);assert(b>a,'no end: '+start);return src.slice(a,b+end.length);};
const untype=(s)=>s.replace(/: \{ who: string; text: string \}\[\]/g,'').replace(/: any\[\]/g,'').replace(/\((\w+): (?:unknown|string|any|number)(, (\w+): (?:unknown|string|any|number))*\)/g,(m)=>m.replace(/: (?:unknown|string|any|number)/g,''))
 .replace(/\(v: unknown, n = (\d+)\)/g,'(v, n = $1)').replace(/\(r: any, clientSaid: unknown, price: unknown, requestBudget: unknown\)/,'(r, clientSaid, price, requestBudget)').replace(/\(out: any, o: any\)/,'(out, o)');

const A=pickFrom(agent);
const agentSrc=untype([A('const CONGRATS_RE','\n'),A('const BOOKED_RE','\nconst NOT_A_VISIT_Q')].join('\n').replace(/\nconst NOT_A_VISIT_Q$/,''));
const {closedAfterBooking,noReplyOrder}=new Function(agentSrc+';return {closedAfterBooking,noReplyOrder};')();
const chat=(...rows)=>rows.map(([d,b,t])=>({direction:d==='in'?'inbound':'outbound',body:b,message_type:t||'text'}));

test('R71: closing words after our congratulation on a booking get no reply',()=>{
 const booked=['out','السلام عليكم عندنا فيلا في الرميس بـ 59 الف تحبين ارسلك تفاصيلها ؟'];
 const base=[booked,['in','وعليكم السلام ورحمة الله'],['in','خلاص حجزنا ولله الحمد شكراً جزيلا'],['out','مبروك الله يبارك لكم 🌷']];
 // the real chat of 14 Nov (53bffb7d)
 assert.equal(closedAfterBooking(chat(...base,['in','الله يبارك فيك'])),true);
 for(const s of ['شكرا','تسلم 🌷','الله يسلمك ما قصرت','جزاك الله خير','آمين','🌹','👍'])assert.equal(closedAfterBooking(chat(...base,['in',s])),true,s);
 assert.equal(closedAfterBooking(chat(...base,['in','','reaction'])),true,'a reaction');
 // not closing: a question or a new subject
 for(const s of ['الله يبارك فيك، عندكم شقق للايجار ؟','متى نستلم المفتاح','شكرا بس ابي ارض ثانية في بركاء'])assert.equal(closedAfterBooking(chat(...base,['in',s])),false,s);
 // our last message is not a congratulation, or there was no booking before it
 assert.equal(closedAfterBooking(chat(...base,['out','متى يناسبك تزور ؟'],['in','شكرا'])),false);
 assert.equal(closedAfterBooking(chat(booked,['in','عرس اخوي اليوم'],['out','مبروك الله يبارك لكم 🌷'],['in','الله يبارك فيك'])),false,'a wedding is not a booking');
 assert.equal(closedAfterBooking(chat(...base)),false,'nothing new from her');
});
test('R71: the guard runs after R50 and ends the search with no reply and no draft',()=>{
 const g=A('    // R71 (Ahmed 14 Nov 2026): she booked','\n');
 assert(agent.indexOf(g)>agent.indexOf('texts = []; out.action = "none"; out.search_stopped = true;\n    }'),'after R50');
 assert(agent.includes('if (closedAfterBooking(history)) { texts = []; out.action = "none"; out.handoff_reason = null; out.search_stopped = true; out.guard_closed_after_booking = true; }'));
 // an empty reply with no action is stored skipped, never as a card in the approval screen; search_stopped closes the requests
 assert(agent.includes('const nothing = !dry && !out.reply_messages.length && out.action === "none";'));
 assert(agent.includes('if (out.search_stopped && !review) {'));
});
test('an order not to answer closes the waiting draft at once; an empty rewrite closes too',()=>{
 for(const s of ['خلاص يعني ويش بعد نرد؟ ما في أي رد. ليش يعني تنتظر موافقة مني ولا شي؟ فخلاص هذا أموره طيبة. لغيه من هنا يعني خوزة من هنا الردود اللي هو تنتظر موافقة.',
  'مرة ثانية رسلت اللي هذا ومع أني قلت لك خلاص هذا دام إنه الشخص حقز عقاره وباركنا له وكل شي فما يحتاج إن نرد عليه دام هو رد خلاص.',
  'ما يحتاج نرد بشي خلاص الغي المتابعه','لا ترد عليه','بدون رد','الغي الرد','شيله من هنا'])assert.equal(noReplyOrder(s),true,s);
 for(const s of ['ارسل له تفاصيل العقار','ما يحتاج ترد بالسعر، ارسل له الموقع','قل له الفيلا انحجزت','الغي السؤال الثاني وخل الأول','اكتب له متى يناسبك تزور','لا ترد بالسعر قبل الزيارة'])assert.equal(noReplyOrder(s),false,s);
 assert(agent.includes('if (noReplyOrder(instruction)) return json(await closeDraft(d.data.id, d.data.analysis, instruction, prof.data.id));'));
 assert(agent.indexOf('if (noReplyOrder(instruction))')<agent.indexOf('    redo = { draftId: d.data.id, instruction, by: prof.data.id };'),'before the model is asked again');
 assert(agent.includes('if (!out.reply_messages.length) return json(await closeDraft(draftId, analysis, redo.instruction, redo.by));'));
 const close=A('async function closeDraft(','\n}\n');
 assert(close.includes('status: "rejected"')&&close.includes('.eq("status", "pending")')&&close.includes('approver_note: `أمر المدير: ${instruction}`'));
 assert(close.includes('status: "closed"'));
 // the approval screen drops the card and keeps no lesson from that order
 const rw=approvals.slice(approvals.indexOf('async function rewrite('),approvals.indexOf('async function reject('));
 assert(rw.indexOf("if(data.status==='closed')")>0&&rw.indexOf("if(data.status==='closed')")<rw.indexOf("crm_owner_notes"));
 assert(index.includes('crm-reply-approvals.js?v=20261127-ans1'));
});

const F=pickFrom(fu);
test('R71 in follow-ups: a client who booked, was congratulated and closed gets no follow-up, alone or in a group message',()=>{
 const src=untype([F('const short =','\n'),F('const R71_CONGRATS','\n'),F('const R71_BOOKED','\n'),F('const R71_CLOSING','\n'),F('function bookedClosed','\n}\n'),F('function eveningGuard','\n}\n')].join('\n'));
 const {bookedClosed,eveningGuard}=new Function(src+';return {bookedClosed,eveningGuard};')();
 const c=['[2026-11-14] المكتب: السلام عليكم عندنا فيلا في الرميس بـ 59 الف تحبين ارسلك تفاصيلها ؟','[2026-11-14] العميل: خلاص حجزنا ولله الحمد شكراً جزيلا','[2026-11-14] المكتب: مبروك الله يبارك لكم 🌷'];
 assert.equal(bookedClosed([...c,'[2026-11-14] العميل: الله يبارك فيك'].join('\n')),true);
 assert.equal(bookedClosed(c.join('\n')),true,'no answer after the congratulation');
 assert.equal(bookedClosed([...c,'[2026-11-14] العميل: عندكم ارض في بركاء ؟'].join('\n')),false);
 assert.equal(bookedClosed([...c,'[2026-11-15] المكتب: لين الحين تبحث ؟'].join('\n')),false);
 for(const group of [false,true]){
  const r=eveningGuard({decision:'followup',text:'السلام عليكم لين الحين تبحث ؟',reason:'',auto_ok:true,offer_no:2},{group,bookedClosed:true});
  assert.equal(r.decision,'skip');assert.equal(r.text,null);assert.equal(r.auto_ok,false);assert.equal(r.guard,'guard_booked_closed');assert(r.reason.startsWith('(R71)'));
 }
 assert(fu.includes('out.booked_closed = bookedClosed(chat);'));
 assert(fu.includes('bookedClosed: !!out.booked_closed });'));
 assert(fu.includes('delete out.booked_closed;'));
});
test('R72: «🔥 مشتري جاد» never for a lower budget, a wait for a procedure, or an opinion that is not liking',()=>{
 const src=untype([F('const normAr','\n'),F('const r55Norm','\n'),F('const R72_WAIT','\n'),F('const R72_BUDGET','\n'),F('function seriousBlocked','\n}\n')].join('\n'));
 const seriousBlocked=new Function(src+';return seriousBlocked;')();
 // the real chat of 14 Nov (d8a804a0), on the Sowmhan 69 visit
 const said='شفتها مال صومحان الجنوبيه والموقع ما ناسب\nمال الرميس شفتها حلوه وموقعها حلو لاكن شوي انتظر إجراءات من وزاره الدفاع عشان كذه تاخرت شوي\nاريد قريب مسقط المزانيه ٦٥ وتحت';
 assert.equal(seriousBlocked({opinion:'liked',note:''},said,69000,null),'waiting');
 assert.equal(seriousBlocked({opinion:'liked',note:'أعجبته'},'اريد قريب مسقط المزانيه ٦٥ وتحت',69000,null),'budget');
 assert.equal(seriousBlocked({opinion:'liked',note:'ينتظر إجراءات من وزارة الدفاع'},'حلوه',59000,null),'waiting','the note says it');
 assert.equal(seriousBlocked({opinion:'liked',note:''},'عجبتني',69000,60000),'budget','the open request budget');
 assert.equal(seriousBlocked({opinion:'disliked',note:''},'كم آخر سعر',69000,null),'opinion');
 assert.equal(seriousBlocked({opinion:'hesitant',note:''},'بفكر',69000,null),'opinion');
 // a real serious buyer still raises it
 assert.equal(seriousBlocked({opinion:'negotiate',note:''},'عجبتني كم آخر سعر ؟ ميزانيتي 70 الف',69000,null),'');
 assert.equal(seriousBlocked({opinion:'liked',note:''},'ابي احجز ادفع العربون بكره',69000,null),'');
 // wired before the alert, counted when it holds one back, and the price is read with the visit
 assert(fu.includes('blocked = seriousBlocked(r, r.client_said, pr.price, rq.data?.budget_max);'));
 assert(fu.includes('if (r.serious && r.confidence >= 0.6 && !again && !blocked) { await alertSerious('));
 assert(fu.includes('return { ...res, client_said: saidBy(chat, "العميل") };'));
 assert.equal((fu.match(/properties\(type,area,status,archived,price\)/g)||[]).length,2);
});
