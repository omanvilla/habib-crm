'use strict';
// Step F (decision 77, Ahmed 18 Nov 2026): a client (buyer or owner) who wrote to the wrong branch number about the other
// branch's area is moved by us: one line here («… وبنرسلك منه»), and the right number messages him (SQL140, whatsapp-outreach).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const agent=fs.readFileSync('supabase/functions/whatsapp-reply-agent/index.ts','utf8');
const brain=fs.readFileSync('supabase/functions/whatsapp-reply-agent/brain.ts','utf8');
const pick=(start,end)=>{const a=agent.indexOf(start);assert(a>=0,start);return agent.slice(a,agent.indexOf(end,a)+end.length);};
const src=[pick('const BRANCH_OLD_RE','\n'),pick('const BRANCH_NEW_RE','\n'),pick('function transferArea','\n}\n'),pick('function branchTransferLines','\n}\n')].join('\n')
  .replace('(raw: unknown, branch: string)','(raw, branch)')
  .replace('(out: any, here: unknown, prop: any, branchOf: (k: any) => { name: string; number: string } | null)','(out, here, prop, branchOf)')
  .replace('const hit: { to: string; area: string }[] = []','const hit = []').replace('const req: string[] =','const req =')
  .replace('(to: string, owner: boolean, named: unknown)','(to, owner, named)').replace('(t: any)','(t)')
  .replace('branchOf(to)!;','branchOf(to);').replace(/n!\[/g,'n[');
const branchTransferLines=new Function(src+';return branchTransferLines;')();
const branchOf=k=>k==='barka'?{name:'بركاء',number:'92344273'}:k==='muscat'?{name:'مسقط',number:'71770030'}:null;
const run=(o,here,prop=null)=>branchTransferLines({reply_messages:[],request:null,owner_offer:null,area:null,branch_transfer:null,category:'buyer',...o},here,prop,branchOf);

test('the branch line becomes «… يتابعها رقم فرع X وبنرسلك منه» and names the transfer',()=>{
  let r=run({reply_messages:['وعليكم السلام ورحمة الله وبركاته','هذا العقار تتابعه معنا على رقم بركاء 92344273 واتساب']},'muscat',{branch_key:'barka',area:'الرميس'});
  assert.deepEqual(r.lines,['وعليكم السلام ورحمة الله وبركاته','عقارات الرميس يتابعها رقم فرع بركاء 92344273 وبنرسلك منه']);
  assert.equal(r.to,'barka');assert.equal(r.area,'الرميس');
  r=run({reply_messages:['طلبك تتابعه معنا على رقم مسقط 71770030 واتساب'],request:{areas:['الحيل الشمالية']}},'barka');
  assert.deepEqual(r.lines,['عقارات الحيل الشمالية يتابعها رقم فرع مسقط 71770030 وبنرسلك منه']);assert.equal(r.to,'muscat');
  // an owner (R9 line on the Barka number)
  r=run({category:'seller',reply_messages:['عقارك تتابعه معنا على رقم مسقط 71770030 واتساب','هذا الرقم خاص لعقارات بركاء'],owner_offer:{area:'الخوض'}},'barka');
  assert.deepEqual(r.lines,['عقارك في الخوض يتابعه رقم فرع مسقط 71770030 وبنرسلك منه','هذا الرقم خاص لعقارات بركاء']);
  // the model wrote the new line itself, with its own area
  r=run({reply_messages:['عقارات بوشر يتابعها رقم فرع مسقط 71770030 وبنرسلك منه'],branch_transfer:{to:'muscat',area:'بوشر'}},'barka');
  assert.deepEqual(r.lines,['عقارات بوشر يتابعها رقم فرع مسقط 71770030 وبنرسلك منه']);assert.equal(r.area,'بوشر');
  // the model set the transfer but forgot the line
  r=run({reply_messages:['وعليكم السلام ورحمة الله وبركاته'],branch_transfer:{to:'barka',area:'الصومحان، الجنوبية'}},'muscat');
  assert.deepEqual(r.lines,['وعليكم السلام ورحمة الله وبركاته','عقارات الصومحان الجنوبية يتابعها رقم فرع بركاء 92344273 وبنرسلك منه']);
  // no area known: the branch's name
  r=run({reply_messages:['هذا العقار تتابعه معنا على رقم بركاء 92344273 واتساب']},'muscat');
  assert.equal(r.area,'بركاء');
});

test('no transfer: the same number, the investor line, another route, a reply without the line',()=>{
  assert.equal(run({reply_messages:['هذا العقار تتابعه معنا على رقم مسقط 71770030 واتساب']},'muscat'),null);
  assert.equal(run({category:'investor',reply_messages:['الاستثمار والمشاريع تتابعها معنا على رقم مسقط 71770030 واتساب']},'barka'),null);
  assert.equal(run({reply_messages:['هذا العقار تتابعه معنا على رقم بركاء 92344273 واتساب']},'owner'),null);
  assert.equal(run({reply_messages:['المساحة 400 متر'],branch_transfer:{to:'muscat',area:'x'}},'muscat'),null);
  assert.equal(run({reply_messages:['المساحة 400 متر']},'barka'),null);
});

test('the transfer is queued only outside a dry run, nothing of the other branch is served, the R9 owner line counts once',()=>{
  const block=pick('    const stepF = branchTransferLines(','\n    }\n');
  assert(block.includes('if (!review) {')&&block.includes('db.rpc("crm_branch_transfer_queue", { p_conversation: conv.id, p_to_route: stepF.to, p_area: stepF.area })'));
  assert(block.includes('out.action = "none"; out.viewing_date = null; out.viewing_time = null; actionMsgs.length = 0;'));
  assert(agent.indexOf('    const stepF = branchTransferLines(')>agent.indexOf('analysis.branch_redirect = prop.branch_key;'),'after R48 and R9');
  assert(agent.indexOf('    const stepF = branchTransferLines(')<agent.indexOf('Object.assign(analysis, { reply_messages: out.reply_messages'),'before the draft records the final reply');
  assert(agent.includes('/عقارك\\s*تتابعه\\s*معنا\\s*على\\s*رقم\\s*مسقط|عقارك\\s.*يتابعه\\s*رقم\\s*فرع\\s*مسقط/'));
  assert(agent.includes('branch_transfer: { anyOf: [{ type: "null" }, {')&&agent.includes('"meeting", "branch_transfer", "client_name_stated", "name_declined", "mustahiq_waitlist"]'));
});

test('the brain moves the client with the new line and never «بيتواصل معك»',()=>{
  assert(brain.includes('- الخطوة F (أحمد 18 نوفمبر):'));
  assert(brain.includes('"عقارات [المنطقة] يتابعها رقم فرع [الفرع] [الرقم] وبنرسلك منه"'));
  assert(!/تتابعه معنا على رقم (مسقط|بركاء) (71770030|92344273) واتساب/.test(brain),'the old «تواصل أنت» line is gone from the brain');
  assert(brain.includes('- branch_transfer: شوف "الخطوة F"'));
});
