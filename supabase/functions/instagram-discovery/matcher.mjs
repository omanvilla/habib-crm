// Deterministic evidence only. Captions are data, never instructions. No price-only/face guesses.
export const MATCH_VERSION='caption-facts-v1';
export function normalize(value){return String(value??'').normalize('NFKC').replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776)).replace(/[\u064b-\u065f\u0670\u0640\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,'').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/٫/g,'.').replace(/٬/g,',').toLowerCase();}
const clean=s=>normalize(s).replace(/[^\p{L}\p{N}.\n ,]/gu,' ').replace(/[ \t]+/g,' ');
const value=s=>Number(String(s).replace(/[, ]/g,''));
function collect(text,patterns){const out=[];for(const pattern of patterns)for(const m of text.matchAll(pattern)){const n=value(m[1]);if(n>0&&!out.includes(n))out.push(n);}return out;}
export function facts(caption){
 const t=clean(caption),n='([0-9]+(?:[,.][0-9]+)*)',pad='[^0-9\\n]{0,24}';
 const land=collect(t,[new RegExp('(?:مساحه\\s*(?:الارض|ارض)|(?:الارض|ارض)\\s*بمساحه|(?:مساحتها))'+pad+n,'g')]);
 const build=collect(t,[new RegExp('(?:مساحه\\s*(?:البناء|بناء)|(?:البناء|بناء)\\s*(?:بمساحه)?|مساحه بناء(?: كبيره تصل الي)?)'+pad+n,'g')]);
 const bedrooms=collect(t,[new RegExp(n+'\\s*غرف(?:ه|)?\\s*(?:نوم)?','g')]);
 const bathrooms=collect(t,[new RegExp(n+'\\s*(?:دورات مياه|حمامات)','g')]);
 const prices=[];for(const m of t.matchAll(/(?:السعر(?:\s+(?:الحالي|المطلوب))?|سعرها|سعر كل فيلا|القيمه|المطلوب|بسعر)\s*[^0-9\n]{0,16}([0-9]+(?:[,.][0-9]+)*)\s*(الف|الاف|مليون|k)?/g)){let p=value(m[1]);if(m[2])p*=m[2]==='مليون'?1000000:1000;if(p>0&&!prices.includes(p))prices.push(p);}
 const ad=/(للبيع|للايجار|للتملك|سعرها|السعر|القيمه|توين فيلا|منزل جديد|مشروع اليزن|وادي زها|وادي زهاء|سكاي فيلا|الوحدات المطروحه|الاقساط|عروض حصريه)/.test(t)||land.length>0||build.length>0;
 const advice=/(نصيحه|نصائح|في هذا الفيديو اوضح|المستشار العقاري|لا تغلط|لا تياس|تطمن|مشوارك الوظيفي|توكل علي الله|معلومه عقاريه|نصيحه للمستثمر)/.test(t);
 const multi=/(?:[2-9]|ثلاث|اربع|خمس|ست|سبع|ثمان|تسع)\s*(?:فلل|منازل|عقارات)|فلل للبيع|لكل فيلا|ضمن\s*[2-9]\s*فلل/.test(t);
 return {text:t,land,build,bedrooms,bathrooms,prices,ad,advice,multi};
}
function areaTokens(property){
 const a=clean(property.area).replace(/الصومحان/g,'صومحان').replace(/الجنوبيه/g,'جنوب').replace(/الشماليه/g,'شمال');
 return a.split(/\s+/).filter(w=>w&&!['مسقط','بركاء','بركا','سلطنه','عمان','ولايه','منطقه','في','حي'].includes(w)&&!/^\d/.test(w));
}
function containsWord(t,w){return (' '+t.replace(/\n/g,' ')+' ').includes(' '+w+' ');}
export function matchMedia(media,properties,knownLinks=[]){
 const f=facts(media.caption),code=String(media.permalink||'').match(/\/(?:p|reels?|tv)\/([A-Za-z0-9_-]+)/)?.[1];
 const existing=knownLinks.filter(e=>(code&&e.link_key==='instagram:'+code)||String(e.instagram_media_id||'')===String(media.instagram_media_id||media.id));
 if(existing.length){const ids=[...new Set(existing.map(e=>e.property_id))];return ids.length===1?{decision:'link',property_id:ids[0],reason:'existing_link',evidence:{existing_event:existing[0].id}}:{decision:'needs_review',reason:'existing_conflict',evidence:{}};}
 if(media.media_type!=='VIDEO'&&media.media_product_type!=='REELS')return {decision:'non_property',reason:'not_video',evidence:{}};
 if(f.advice&&!/(للبيع|للايجار|هذه الفيلا|هذا المنزل|للمعاينه)/.test(f.text))return {decision:'non_property',reason:'advice',evidence:{caption_only:true}};
 if(f.advice)return {decision:'needs_review',reason:'mixed_advice_and_offer',evidence:{caption_only:true}};
 if(!f.ad)return {decision:'needs_review',reason:'unclear_content',evidence:{caption_only:true}};
 const text=f.text.replace(/الصومحان/g,'صومحان').replace(/الجنوبيه/g,'جنوب').replace(/الشماليه/g,'شمال');
 const candidates=[];
 for(const p of properties){
  if(/test_crm|test فقط/i.test(p.title||''))continue;
  const tokens=areaTokens(p);if(!tokens.length||!tokens.every(w=>containsWord(text,w)))continue;
  const hits=[],conflicts=[];
  for(const [key,vals] of [['land_size',f.land],['built_size',f.build],['price',f.prices],['bedrooms',f.bedrooms],['bathrooms',f.bathrooms]]){
   if(vals.length!==1||!(Number(p[key])>0))continue;
   // No rounding or maid-room guessing: conflicting stored facts require review.
   if(Math.abs(Number(p[key])-vals[0])<0.01)hits.push(key);else conflicts.push(key);
  }
  const dimensions=hits.includes('land_size')&&hits.includes('built_size');
  const strong=dimensions||(hits.includes('price')&&(hits.includes('land_size')||hits.includes('built_size'))&&hits.includes('bedrooms'));
  candidates.push({property_id:p.id,hits,conflicts,strong});
 }
 const eligible=candidates.filter(c=>c.strong&&!c.conflicts.length);
 const evidence={facts:{land:f.land,build:f.build,prices:f.prices,bedrooms:f.bedrooms,bathrooms:f.bathrooms},candidates,caption_only:true,version:MATCH_VERSION};
 if(f.multi)return {decision:'needs_review',reason:'multiple_units',evidence};
 if(eligible.length===1){return {decision:'link',property_id:eligible[0].property_id,reason:'unique_specification_match',evidence};}
 return {decision:'needs_review',reason:eligible.length>1?'multiple_matches':candidates.some(c=>c.conflicts.length)?'conflicting_specifications':candidates.length?'insufficient_specifications':'property_not_found',evidence};
}
