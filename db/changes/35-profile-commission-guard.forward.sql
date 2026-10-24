-- SQL35: staff cannot change their own profiles.commission_rate.
-- profiles_update_own_basic lets every user update their own row; the trigger
-- already blocked role/company/is_active/email but not commission_rate.
-- The company owner keeps the ability to set any rate (including their own).
-- Only the self-edit branch changes; the rest is the applied definition verbatim.
CREATE OR REPLACE FUNCTION public.protect_profile_sensitive_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  uid uuid;
begin
  uid := auth.uid();

  -- العمليات الداخلية الموثوقة مثل Trigger الدعوات
  if uid is null then
    return new;
  end if;

  -- المستخدم يعدّل حسابه الشخصي
  if uid = old.id then

    if new.role is distinct from old.role then
      raise exception 'غير مسموح لك بتغيير صلاحية حسابك';
    end if;

    if new.company_id is distinct from old.company_id then
      raise exception 'غير مسموح لك بتغيير الشركة';
    end if;

    if new.is_active is distinct from old.is_active then
      raise exception 'غير مسموح لك بتغيير حالة حسابك';
    end if;

    if new.email is distinct from old.email then
      raise exception 'تغيير البريد الإلكتروني غير مسموح من ملف المستخدم';
    end if;

    if new.commission_rate is distinct from old.commission_rate
       and not public.is_company_owner(old.company_id) then
      raise exception 'غير مسموح لك بتغيير نسبة عمولتك';
    end if;

    return new;
  end if;

  -- تعديل حساب موظف آخر: Owner فقط
  if not public.is_company_owner(old.company_id) then
    raise exception 'فقط صاحب الشركة يستطيع تعديل صلاحيات الموظفين';
  end if;

  -- لا يسمح بنقل الموظف إلى شركة أخرى
  if new.company_id is distinct from old.company_id then
    raise exception 'لا يمكن نقل المستخدم إلى شركة أخرى بهذه الطريقة';
  end if;

  -- البريد مرتبط بحساب Auth ولا يعدّل من صفحة الفريق
  if new.email is distinct from old.email then
    raise exception 'لا يمكن تغيير بريد الموظف من صفحة الفريق';
  end if;

  -- حماية حساب الـ Owner من التعطيل أو تغيير دوره
  if old.role = 'owner'
     and (
       new.role is distinct from old.role
       or new.is_active is distinct from old.is_active
     ) then
    raise exception 'لا يمكن تغيير أو تعطيل حساب صاحب الشركة';
  end if;

  return new;
end;
$function$;

REVOKE ALL ON FUNCTION public.protect_profile_sensitive_fields() FROM PUBLIC, anon, authenticated;
