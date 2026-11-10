# إضافة عقار ومالك من محادثات Claude

أي محادثة (مثل بروجكت «تسعير الفلل والمباني») تضيف العقار بهذي الدالة، بدل `insert` مباشر في `owners` و`properties`.

```sql
select public.crm_add_property_with_owner(
  jsonb_build_object(
    'name', 'اسم الوكيل',
    'phone', '+96800000000',
    'owner_type', 'agent',              -- owner | agent | broker | agency | developer
    'original_owner_name', null,        -- للوكيل: اسم صاحب العقار
    'kinship', 'والده',                 -- للوكيل: صلة القرابة
    'has_power_of_attorney', true,      -- للوكيل: عنده وكالة رسمية؟
    'notes', null
  ),
  jsonb_build_object(
    'title', 'عنوان العقار الداخلي',           -- مطلوب
    'area', 'المنطقة',                         -- مطلوب
    'price', 69000,                            -- مطلوب
    'branch_key', 'barka',                     -- مطلوب: barka أو muscat
    'type', 'twin_villa', 'wilayat', 'بركاء',
    'owner_net', 65000, 'expected_commission', 4000,
    'bedrooms', 6, 'bathrooms', 7, 'land_size', 317, 'built_size', 273.6,
    'description', '...', 'map_url', 'https://...',
    'listing_purpose', 'sale',                 -- sale أو rent
    'visit_method', 'open'                     -- open | lockbox | owner_lives | office
  )
);
```

**وش تسوي:**
- تدور على المالك برقم الهاتف (آخر 8 أرقام). إذا موجود تستخدمه، وإذا لا تضيفه.
- إذا نفس المالك عنده عقار بنفس العنوان ترجعه وما تضيف ثاني. تقدر تعيد الأمر بأمان.
- العقار يتسجل «متاح»، ويدخل في «إضافات الأسبوع» ورصيد الفرع، ويبدأ تتبع أدائه، وتشتغل كل الـtriggers مثل الإضافة من الشاشة.
- ترجع `owner_id` و`property_id` و`owner_created` و`property_created`.

**الصلاحية:** المالك فقط، أو جلسة خادم بدون مستخدم. حساب الفرع ممنوع.

# ملاحظات أحمد على الزيارة

```sql
select public.crm_set_visit_presence('<viewing_id>', true, 'وش صار وجهاً لوجه');
```

- الوسيط الثاني: `true` أحمد حاضر، `false` العميل زار لحاله، `null` بدون تغيير.
- الملاحظة تنضاف مع التاريخ والوقت، وما تمسح اللي قبلها.
- للوصول لرقم الزيارة: `select id, viewing_date, status from viewings where client_id = '...' order by viewing_date desc`.

# أرشفة عقار واستعادته (10 نوفمبر 2026)

العقار المؤرشف ما يظهر «متوفر» أبداً، وكل أرشفة لها سبب ومصدر وسجل. **لا تكتب** `update public.properties set archived = ...` مباشرة: القيود ترفض أرشيف بدون سبب أو أرشيف حالته `available`، والتحديث المباشر يتخطى فحص الصفقات والسجل وإشعار أحمد (هذا اللي صار في 9 نوفمبر مع فلل فلاح).

## الأسباب — `public.property_archive_reasons`

| code | السبب | الحالة بعد الأرشفة |
|---|---|---|
| `contract_expired` | انتهى عقد التسويق | `withdrawn` |
| `owner_withdrew` | المالك سحب العقار | `withdrawn` |
| `sold_by_owner` | المالك باعه بنفسه أو عن طريق غيرنا | `sold` |
| `sold_by_us` | انباع عن طريقنا | `sold` |
| `rented` | انأجر | `not_available` |
| `duplicate` | سجل مكرر (الملاحظة مطلوبة: أي سجل هو الأصل) | `not_available` |
| `test_record` | سجل تجريبي أو خطأ إدخال | `not_available` |
| `other` | سبب آخر (الملاحظة مطلوبة) | `not_available` |
| `unrecorded` | سبب الأرشفة غير مسجل (للتسجيل اللاحق بس، ما ينختار) | `not_available` |

- المباع يبقى `sold` مهما كان السبب. الحالة تتغير في نفس التحديث اللي يأرشف.
- **صفقة شغالة** توقف الأرشفة: أي صفقة على العقار في `negotiation` أو `deposit` أو `awaiting_finance` أو `finance_approved` أو `awaiting_clearance` أو `ownership_transfer`، أو حالة العقار `reserved` / `deposit` / `negotiating`. حساب الفرع ممنوع دايماً، أحمد يقدر يكمل من الشاشة بعد ما يعلّم «أعرف إن على العقار صفقة شغالة»، والعقل والنظام ما يفرضون أبداً.

## من الشاشة
- زر «أرشفة» يفتح «أرشفة العقار — ليش؟»: يختار السبب، يكتب ملاحظة إذا السبب يحتاجها، ويشوف الصفقات المفتوحة حسب المرحلة والزيارات القادمة قبل الحفظ (`crm_property_archive_precheck` ثم `crm_archive_property`).
- زر «استعادة» يفتح «استعادة العقار كعقد جديد»: عقد تسويق جديد أو بدون عقد، السعر، و«تأكدت من المالك إن العقار متاح» (`crm_restore_property`).
- القائمة والتفاصيل تكتب «📦 <السبب>» للمؤرشف، و«مسحوب» أو «غير متاح» بدل «متوفر».

## من محادثة Claude أو العقل (بطلب أحمد)

1. افحص الصفقات والزيارات أول:

```sql
select public.crm_property_archive_precheck('<property_id>'::uuid);
-- {ok, open_deals:[{id,stage}], active_deal, upcoming_viewings, status, archived, archive_reason, can_force}
```

2. أرشف بالسبب، والمصدر `agent`:

```sql
select crm_repair_private.archive_property_internal(
  '<property_id>'::uuid,
  'contract_expired',                       -- code من الجدول فوق
  'أحمد 10 نوفمبر: خلصت مدة العقد',           -- الملاحظة (مطلوبة لـ duplicate و other)
  'agent',                                  -- agent لمحادثة Claude والعقل، system للمهام التلقائية بس
  jsonb_build_object('owner_note_ids', jsonb_build_array('<crm_owner_notes.id>')),  -- الدليل
  false                                     -- p_force: دايماً false من agent و system
);
```

- `{"ok":true, "status_after":..., "archive_reason":...}`: انأرشف.
- `{"ok":false, "blocked":"active_deal"}`: لا تفرض ولا تغير الصفقة. بلّغ أحمد بالصفقة ومرحلتها وخله يقرر.
- `public.crm_archive_property(id, reason, note)` من جلسة بدون مستخدم تنسجل كمان `agent` لكن بدون دليل، فالأحسن الدالة فوق مع `owner_note_ids`.
- اللي يصير لحاله: سطر في `property_archive_events` ونشاط، والصفقات المفتوحة اللي قبل الحجز (بدون عربون أو حجز مؤكد) تتسكر بسبب `property_unavailable` «العقار أصبح غير متاح» إلا مع `duplicate`، وأحمد يوصله إشعار واحد للعقار. ما ينرسل شي للعملاء؛ إشعار «انحجزت» لما يصير `sold` ينتظر الموافقة.
- لا تعدل `archived_at` أو `archived_by` أو `created_at` بنفسك.

## الاستعادة = عقد جديد

```sql
select public.crm_restore_property(
  '<property_id>'::uuid,
  true,             -- p_has_agreement: عقد تسويق جديد؟ (false = بدون عقد)
  current_date,     -- p_agreement_start
  3,                -- p_duration_months (من 1 إلى 60)
  null,             -- p_price: السعر الجديد، أو null يبقى نفسه
  'أحمد أكد مع المالك إنه متاح'   -- p_note
);
```

- يرجع العقار `available` مع `relisted_at`، وإشعار «عقار جديد» للعملاء يدخل قائمة الموافقة (ما ينرسل لحاله). بدون عقد ينمسح العقد القديم عشان ما يرجع للأرشيف لحاله.
- حتى لو كان مسجل «مباع» يرجع `available`. الدالة ترفض إذا عليه صفقة بيع مكتملة (`property_has_completed_deal`) أو حجز/عربون شغال (`property_has_active_reservation`).
- سبب الأرشفة القديم يبقى في `property_archive_events`.
- الاستعادة بطلب أحمد بس، وبعد ما يتأكد من المالك إن العقار متاح. من جلسة Claude (بدون مستخدم) تنسجل بمصدر `agent`.
- قبل ما تضيف عقار رجع للسوق بـ `crm_add_property_with_owner`، دوّر عليه في الأرشيف (نفس المالك والعنوان أو نفس المواصفات) واستعده كعقد جديد بدل سجل ثاني.

## سبب لعقار مؤرشف بدون سبب
الشاشة تعرض «سبب الأرشفة غير مسجل» بس، بدون تعديل. لا تعدل `archive_reason` بتحديث مباشر؛ اكتب لأحمد السبب المقترح والدليل، وبعد موافقته يتسجل بدالة الأرشفة نفسها وينكتب في السجل كـ `reason_set`.

- إذا العقار المؤرشف حالته `reserved` أو `deposit` أو `negotiating`، أو عليه صفقة في `negotiation` أو `deposit` أو `awaiting_finance` أو `finance_approved` أو `awaiting_clearance` أو `ownership_transfer`، الدالة ترجع `{"ok":false, "blocked":"active_deal"}` وما يتسجل السبب (المصدر `agent` ما يفرض أبداً). بلّغ أحمد بحالة العقار والصفقة ومرحلتها وخله يقرر. لا تفرض ولا تعدل `archive_reason` أو `status` بتحديث مباشر. في 10 نوفمبر هذا حال `f99087b9`: مؤرشف وحالته `reserved`، فسببه يبقى «سبب الأرشفة غير مسجل» لين يقرر أحمد.
