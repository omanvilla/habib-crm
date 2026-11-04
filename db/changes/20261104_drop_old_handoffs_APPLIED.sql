-- The reply agent now identifies properties, reads kroki/images/PDFs and collects request details itself.
-- The old pipeline's "needs human" flags only blocked the agent (it stays silent while a handoff is open),
-- so they are no longer raised and the open ones are closed. Real handoffs (the agent's own, or the client
-- asking for staff) are kept.
create or replace function crm_repair_private.suppress_empty_identify_handoff()
 returns trigger language plpgsql security definer set search_path to '' as $f$
begin
 if NEW.human_handoff_required and not coalesce(OLD.human_handoff_required,false)
  and (NEW.handoff_reason in (
    'استفسار عن عقار يحتاج تحديده وربطه بالعقار الصحيح','استفسار عن عقار محدد يحتاج تحديده',
    'وصل مستند عقاري ولم يمكن تحديد الطلب المرتبط به','بيانات الكروكي تختلف عن بيانات العميل وتحتاج تحققاً',
    'تم استلام الكروكي ويحتاج مراجعة بشرية','طلب تقييم قبل البيع ويحتاج مراجعة بشرية',
    'العميل رد بجزء من البيانات ويحتاج استكمالاً بشرياً','بيانات الطلب ناقصة وتعذر إرسال طلب الاستكمال تلقائياً',
    'اكتملت بيانات الطلب وتعذر إرسال رسالة التأكيد تلقائياً','تعذر قراءة الكروكي آلياً ويحتاج مراجعة بشرية',
    'تعذر تصنيف طلب التقييم قبل البيع تلقائياً','تعذر ربط رد الموظف بالاستفسار آلياً؛ تحتاج الرسالة مراجعة',
    'العقار المذكور في الرد يختلف عن العقار الذي سأل عنه العميل','يلزم التحقق من العقار المقصود في رد الموظف')
   or NEW.handoff_reason like 'تعذر قراءة صور%') then
  NEW.human_handoff_required:=false; NEW.handoff_reason:=OLD.handoff_reason; NEW.handoff_updated_at:=OLD.handoff_updated_at;
 end if;
 return NEW;
end $f$;

update public.whatsapp_conversations set human_handoff_required=false, handoff_reason=null, handoff_updated_at=now()
 where handoff_reason is not null and (handoff_reason like '%يحتاج تحديده%' or handoff_reason like '[أُغلق تلقائياً%'
  or handoff_reason like 'تعذر قراءة صور%' or handoff_reason like 'تعذر ربط رد الموظف%' or handoff_reason like '%الكروكي%مراجعة%'
  or handoff_reason like '%بيانات الطلب%' or handoff_reason like '%التقييم قبل البيع%' or handoff_reason like 'وصل مستند عقاري%');
