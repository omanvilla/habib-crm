/* Pure dry-run planner. No SDK, HTTP, persistence, scheduling or message sending. */
import {matchListingReferences,normalizeListingText,isPropertyRequest,isContextFollowup,isLocationRequest,normalizeMapUrl} from './property-inquiry-matcher.mjs';
const clean=v=>String(v??'').replace(/[<>]/g,'').trim();
const safeLink=v=>{try{const u=new URL(v);return /^https?:$/.test(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}};
const typeOf=t=>/(?:فيلا|فله|توين|بيت|منزل|villa|house)/.test(t)?'villa':/(?:شقه|شقق|apartment)/.test(t)?'apartment':/(?:ارض|اراضي|land)/.test(t)?'land':null;
const typeMatches=(p,type)=>type==='villa'?['villa','house','twin_villa','townhouse'].includes(p.type):type==='land'?String(p.type||'').startsWith('land'):p.type===type;
const number=n=>Number(n).toLocaleString('en-US',{maximumFractionDigits:3});
function details(p){
  return [clean(p.title).slice(0,120),p.area?'الموقع: '+clean(p.area):'',Number(p.price)>0?'السعر: '+number(p.price)+' ر.ع':'',
    [p.land_size?'أرض '+number(p.land_size)+' م²':'',p.built_size?'بناء '+number(p.built_size)+' م²':'',p.bedrooms?number(p.bedrooms)+' غرف':''].filter(Boolean).join(' | ')].filter(Boolean).join('\n');
}
export function previewReply(messages,properties,route='muscat'){
  const inventory=(properties||[]).filter(p=>p&&p.id&&!p.archived&&p.branch_key===route);
  const state={route,request:'unknown',area:null,budget:null,property_type:null,bedrooms:null,selected_property_ids:[],visit_interest:false,visit_scheduled:false};
  let awaiting=null,previousAsk=false,lastResult=null,lastSuggestions=[];
  for(const message of (messages||[]).slice(-60)){
    const text=String(message.text||'').slice(0,6000),t=normalizeListingText(text);
    if(!t)continue;
    if(message.role==='assistant')continue; // Questions never become asserted customer requirements.
    const refs=matchListingReferences(text,inventory,{requireIntent:message.role==='customer'});
    if(message.role==='staff'){
      if(previousAsk&&refs.matches.length===1&&!refs.ambiguous){state.selected_property_ids=[refs.matches[0].property_id];state.request='specific_property';}
      else if(refs.matches.length>1||refs.ambiguous)state.selected_property_ids=[];
      lastResult={state:{...state},reply:null,action:'staff_context',simulation:true,send_allowed:false};continue;
    }
    if(message.role!=='customer')continue;
    const out=(reply,action,extra={})=>({state:structuredClone(state),reply,action,simulation:true,send_allowed:false,visit_created:false,...extra});
    if(/(?:انت (?:روبوت|ذكاء|انسان)|هل انت (?:روبوت|بشر)|are you (?:a bot|human))/.test(t)){
      lastResult=out('أنا المساعد الافتراضي للمكتب، وأقدر أوصلك بالفريق متى تحتاج.','identity');continue;
    }
    if(/(?:وقف|لا ترسل|الغاء|الغي|stop|unsubscribe)/.test(t)){
      state.selected_property_ids=[];previousAsk=false;lastResult=out('حاضر، ما بنرسل لك رسائل متابعة.','opt_out',{handoff:true});continue;
    }
    if(/(?:موظف|موظفه|اكلم احد|اتكلم مع|human|agent please)/.test(t)){
      previousAsk=false;lastResult=out('حاضر، يتابع معك أحد أعضاء الفريق.','human_handoff',{handoff:true});continue;
    }
    if(/(?:عندي .{0,30}(?:للبيع|للايجار)|اريد ابيع|انا المالك|انا مالك)/.test(t)){
      state.request='seller';state.selected_property_ids=[];previousAsk=false;lastResult=out('حياك الله، في أي منطقة العقار وما نوعه؟','seller_intake');continue;
    }
    if(/(?:غير مناسب|ما يناسب|ما اريد|لا اريد|مو مهتم|not interested|no thanks)/.test(t)){
      state.selected_property_ids=[];previousAsk=false;lastResult=out('تمام، تفضل نبحث لك عن خيار مختلف؟','rejection');continue;
    }
    if(/(?:ثاني|اخر|غيرها|غيره|بديل|another)/.test(t))state.selected_property_ids=[];
    if(refs.matches.length===1&&!refs.ambiguous){state.selected_property_ids=[refs.matches[0].property_id];state.request='specific_property';}
    else if(refs.ambiguous||refs.matches.length>1){state.selected_property_ids=[];previousAsk=true;lastResult=out('تقصد أي عقار بالضبط؟ أرسل رابط الإعلان أو صورته عشان أحدده لك.','clarify_property');continue;}
    else if(refs.generalRequest){state.selected_property_ids=[];state.request='search';}
    else if(state.selected_property_ids.length&&!isContextFollowup(text)&&!/(?:السعر|غرف|مساحه|متوفر|موجود|معاينه|زياره)/.test(t)&&isPropertyRequest(text))state.selected_property_ids=[];
    if(lastSuggestions.length&&/^(?:الاول|اول واحد|1|الثاني|ثاني واحد|2)$/.test(t)){const chosen=/ثاني|2/.test(t)?lastSuggestions[1]:lastSuggestions[0];if(chosen){state.selected_property_ids=[chosen];state.request='specific_property';}}
    const p=state.selected_property_ids.length===1?inventory.find(p=>p.id===state.selected_property_ids[0]):null;
    if(p){
      previousAsk=true;
      if(p.status&&p.status!=='available'){
        lastResult=out('هذا العقار '+(p.status==='sold'?'مباع':p.status==='reserved'?'محجوز':'غير متاح حاليًا')+'. تحب نبحث لك عن بديل مناسب؟','unavailable');continue;
      }
      if(isLocationRequest(text)){
        state.visit_interest=true;
        const map=normalizeMapUrl(p.map_url)&&safeLink(p.map_url);
        lastResult=out(map?'هذا موقع العقار:\n'+map+'\nتحب الفريق ينسّق لك معاينة؟':'العقار واضح عندنا، لكن الموقع غير محفوظ. يتابع معك الفريق لإرساله.','location',{handoff:!map});continue;
      }
      if(/(?:زياره|معاينه|اعاين|نعاين|viewing|visit)/.test(t)){
        state.visit_interest=true;lastResult=out('أكيد، أي يوم ووقت يناسبك؟ الفريق يؤكد معك الموعد.','visit_interest',{handoff:true});continue;
      }
      lastResult=out(details(p)+'\nتحب نرسل لك الموقع؟','property_details');continue;
    }
    const explicitArea=refs.areas.length===1?refs.areas[0]:(t.match(/(?:^| )(بركاء|بركا|مسقط|صحار|نزوي|صور|صلاله|قريات|الرستاق|السويق)(?: |$)/)?.[1]||null);
    if(explicitArea){state.area=explicitArea;state.request='search';}
    const type=typeOf(t);if(type){state.property_type=type;state.request='search';}
    if(refs.generalRequest||/(?:ابحث|ادور|اريد اشتري|اريد استاجر)/.test(t))state.request='search';
    const nums=[...t.matchAll(/\b\d+(?:\.\d+)?\b/g)].map(m=>Number(m[0]));
    if((awaiting==='budget'||/(?:ميزاني|حدود|سعر|ريال|omr)/.test(t))&&nums.length===1&&nums[0]>0&&nums[0]<10000000){
      let budget=nums[0];if(budget<1000&&/(?:الف|الاف|thousand|\bk\b)/i.test(text))budget*=1000;
      if(budget>=1000)state.budget=budget;
    }
    const bedrooms=t.match(/(?:^| )(\d+) غرف(?:ه)?(?: نوم)?/);if(bedrooms)state.bedrooms=Number(bedrooms[1]);
    if(state.request==='search'){
      previousAsk=true;
      if(!state.area){awaiting='area';lastResult=out('أكيد، في أي منطقة تبحث؟','ask_area');continue;}
      if(!state.budget){awaiting='budget';lastResult=out('تمام، كم الميزانية التقريبية اللي حاطّها للعقار؟','ask_budget');continue;}
      if(!state.property_type){awaiting='property_type';lastResult=out('تبحث عن فيلا، شقة أو أرض؟','ask_type');continue;}
      awaiting=null;
      const possible=inventory.filter(p=>p.status==='available'&&Number(p.price)>0&&Number(p.price)<=state.budget&&typeMatches(p,state.property_type)
        &&normalizeListingText([p.area,p.title].join(' ')).includes(state.area)&&(!state.bedrooms||Number(p.bedrooms)>=state.bedrooms)).sort((a,b)=>Number(a.price)-Number(b.price)).slice(0,2);
      lastSuggestions=possible.map(p=>p.id);
      // Suggestions are not confirmed client inquiries and never create business records.
      lastResult=out(possible.length?'هذه خيارات ضمن طلبك:\n'+possible.map(p=>clean(p.title).slice(0,120)+' — '+number(p.price)+' ر.ع').join('\n')+'\nأي واحد تحب تعرف تفاصيله؟':'وصلني طلبك. ما عندي الآن خيار مؤكد مطابق في السجلات؛ يتابع معك الفريق.','search_options',{suggested_property_ids:possible.map(p=>p.id),handoff:!possible.length});continue;
    }
    previousAsk=isPropertyRequest(text)||/(?:تفاصيل|لوكيشن|الموقع)/.test(t);
    lastResult=out(previousAsk?'حياك الله، أرسل رابط الإعلان أو صورته عشان أرسل لك تفاصيل العقار المقصود.':'هلا وسهلا، كيف نقدر نخدمك؟',previousAsk?'clarify_property':'greeting');
  }
  return lastResult||{state,reply:null,action:'empty',simulation:true,send_allowed:false,visit_created:false};
}
