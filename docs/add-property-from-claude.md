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
