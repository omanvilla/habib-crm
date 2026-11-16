'use strict';
// R91 (Ahmed 16 Nov 2026): «إذا العقار مؤجر عادي نستلمه. ما نستلم عقار مسكون، أقصد إذا المالك ساكن ما نستلم، ولكن إذا مؤجر
// عادي نستلم». The owner (or his family) living in the property is declined as before; a rented property is taken and the
// owner intake goes on; mortgaged and heirs are unchanged.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const agent=fs.readFileSync('supabase/functions/whatsapp-reply-agent/index.ts','utf8').replace(/\r\n/g,'\n');
const brain=fs.readFileSync('supabase/functions/whatsapp-reply-agent/brain.ts','utf8').replace(/\r\n/g,'\n');
const rules=fs.readFileSync('docs/agent-rules.md','utf8');
const at=(s)=>{const i=agent.indexOf(s);assert(i>=0,'missing: '+s);return i;};
const re=(name)=>{const m=agent.match(new RegExp('const '+name+' = (\\/.+\\/[a-z]*);'));assert(m,'missing regex '+name);return new Function('return '+m[1])();};
const block=agent.slice(at('    // ---- 14 Nov 2026, batch 3 ----'),at('    // Ahmed 14 Nov: «حصلت» / «اشتريت» after our'))
 .replace(/\((\w+): (?:string|any|RegExp)\)/g,'($1)');
const ASK=['ارسل الكروكي اذا ما عليك امر'];
const run=(said,o={})=>{
 const out={action:'none',handoff_reason:null,category:'seller',intent:'x',crm_note:'',...(o.out||{})};
 const history=[...(o.before||[]),...[].concat(said).map((b)=>({direction:'inbound',body:b}))];
 return new Function('out','texts','history','burstSaid','ignored','HARD_HANDOFF','DECLINE_RE','short','review',block+'\nreturn {out,texts};')
  (out,o.texts||ASK,history,[].concat(said).join(' '),false,re('HARD_HANDOFF'),re('DECLINE_RE'),(s)=>String(s),false);
};
const DECLINE=['نعتذر منك احنا ما نستلم عقارات مرهونة او ساكن فيها صاحبها','الله يسعدك 🌷'];

test('R91: a rented property is taken: the owner intake goes on with no apology',()=>{
 for(const said of ['البيت مؤجر','مؤجر وما فيه رهن','فيه مستأجر','ساكنين فيه مستأجرين','المستأجر ساكن فيه','الفيلا مأجرة بـ 400 في الشهر','مأجر','عليه ايجار لين 2027','ساكن فيه واحد بالايجار']){
  const r=run(said);assert.equal(r.out.guard_owner_decline,undefined,said);assert.deepEqual(r.texts,ASK,said);}
 // the model's own intake reply is kept as it is (the scenario in docs/agent-rules.md)
 const r=run(['ارسلت لك الملكية والكروكي','البيت مؤجر وما فيه رهن'],{texts:['تمام وصلت','بنطلع على المنطقة والاسعار الحالية ونرجع لك'],out:{action:'handoff',handoff_reason:'دراسة سعر: بيت مؤجر'}});
 assert.deepEqual(r.texts,['تمام وصلت','بنطلع على المنطقة والاسعار الحالية ونرجع لك']);assert.equal(r.out.guard_owner_decline,undefined);
});
test('R91: the owner or his family living in it is declined with the new line',()=>{
 for(const said of ['احنا ساكنين فيه','انا ساكن فيه','ساكنين فيه الحين','البيت مسكون','اهلي ساكنين فيه','احنا ساكنين فيه بس ممكن تنسيق للزيارة']){
  const r=run(said);assert.deepEqual(r.texts,DECLINE,said);assert.equal(r.out.guard_owner_decline,'mortgaged_or_occupied',said);assert.equal(r.out.action,'none',said);}
 // a tenant in one line does not excuse the owner living there in another
 const r=run(['احنا ساكنين فيه','الملحق مؤجر']);assert.deepEqual(r.texts,DECLINE);
 for(const said of ['البيت فاضي','مو مسكون','ما احد ساكن فيه'])assert.equal(run(said).out.guard_owner_decline,undefined,said);
});
test('R91: mortgaged and heirs are unchanged (the Al Atkiya villa «مرهونة ومسكونة» stays declined)',()=>{
 assert.deepEqual(run('الفيلا مرهونة ومسكونة').texts,DECLINE);
 assert.deepEqual(run('البيت مرهون وفيه مستأجر').texts,DECLINE,'a mortgage is declined even when rented');
 assert.deepEqual(run('البيت مال ورثة').texts,['نعتذر منك احنا ما نستلم عقارات الورثة','الله يسعدك 🌷']);
});
test('R91: the decline is still recognised (R37 closes the offer, it always goes out), and the brain says the same',()=>{
 const D=re('DECLINE_RE');
 for(const t of ['نعتذر منك احنا ما نستلم عقارات مرهونة او ساكن فيها صاحبها','نعتذر منك احنا ما نستلم عقارات مرهونة او مسكونة'])assert(D.test(t),t);
 assert(!D.test('نعتذر منك على التأخير'));
 assert(brain.includes('"البيت فاضي ولا مؤجر ولا ساكنين فيه ؟"'));
 assert(brain.includes('4. مرهون أو صاحبه أو أهله ساكنين فيه (R91)'));
 assert(brain.includes('مؤجر (فيه مستأجر): نستلمه عادي، والمعاينة تنسيق مع المستأجر عن طريق المالك بدل سؤال المفتاح.'));
 assert(brain.includes('والعقار فاضي أو مؤجر وبدون رهن'));
 assert(!brain.includes('ما نستلم عقارات مرهونة او مسكونة'),'the old line is gone from the brain');
 assert(agent.includes('row.visit_method = "office";'));
 assert(agent.includes('"مؤجر: المعاينة تنسيق مع المستأجر عن طريق المالك"'));
 assert(rules.includes('**R91،'));
});
