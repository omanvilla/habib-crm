# Security and integration delta — 2026-10-19

Read-only follow-up to `comprehensive-audit-20261018.md`. Scope is deliberately a delta check; this report does not relabel the earlier synthetic or transaction-local role tests as real employee browser authentication. Later real authenticated browser checks by the release owner are recorded separately below and supersede the earlier missing-session limitation for those tested journeys. No customer rows were written, conversations opened or marked read, messages sent, passwords changed, test credentials or impersonation tokens fabricated, or jobs enabled. The model did not collect secrets; real sign-in used secure `browserAuth`.

## Verified before release

At approximately 03:51 UTC (07:51 Asia/Muscat), the connected Supabase Management tools returned:

| Check | Observed result | Meaning |
|---|---|---|
| Applied migrations | Latest `20261018142647`, `reservation_period_performance_20261018` | SQL24 applied; SQL25 candidate not yet applied at this checkpoint. |
| Edge inventory | 17 functions, all ACTIVE | Main versions unchanged: webhook37, send15, inbox12, direct-bind11, embedded-signup6, property-ai4, client-ai2. Deployment presence/version is not proof of live message delivery. |
| Anonymous SECURITY DEFINER execute advisories | Six functions | Matches SQL25's planned trigger-only grant removal; see names below. |
| Signed-in SECURITY DEFINER execute advisories | 17 findings including those six | Callable privileged code needs its explicit authorization checks; the advisory alone does not establish a data leak. |
| SECURITY DEFINER view advisories | `crm_properties_access`, `crm_deals_access` | Existing deliberately scoped projections, previously tested to hide financial columns. No change to views was made by this pass. |
| RLS enabled without policies | 20 INFO findings | Primarily private audit/workflow tables plus service-only credential/webhook/runtime tables. Deny-all RLS is intentional; no new permissive policy was added. |
| Leaked-password protection | Disabled | Existing remaining Auth configuration warning. This pass has no Auth configuration mutation capability. |

The six trigger-only functions are `crm_set_request_geography`, `crm_sync_request_assignees`, `exclude_internal_numbers_from_followups`, `process_followup_reply_from_whatsapp`, `sync_followup_delivery_status`, and `sync_property_monitoring_from_marketing_event`. SQL25 is the prepared fix; the release owner must verify effective anonymous/authenticated ACLs after applying it. The pre-release observation is not a claim that the fix is already live.

No additional urgent security defect was established by this delta pass. A later batched catalog/documentation read was interrupted before results were returned; its proposed Storage, cron, Realtime, search-path and log checks are **not counted as completed**. The detailed 18 October evidence and its stated limitations remain the reference for those surfaces.

## Remaining direct-use limits after the latest browser pass

- Actual recovery email/password recovery, forced token expiry and the refresh-token lifecycle remain unverified. Successful page reload/session restoration does not establish those separate paths.
- Actual login by an inactive account remains unverified; the completed root SQL-role denial is separate evidence. No real manager/viewer browser session was tested.
- Real authenticated Storage upload/download, network Realtime delivery, provider-level Meta intake/outbound/retry/OCR and physical backup restoration remain unverified. No sends, uploads or restore attempts were performed.
- The completed root post-release ACL/role reads and actual owner/employee browser journeys are recorded in their own sections below. These results cover the specified read, reload, cancellation and logout paths, not every button or a production write journey.

## Post-release handoff

Prepared fourteen separate bounded read-only queries under `/tmp/habib-postrelease-security/`: account/route cardinality preflight, six trigger ACLs, and owner/Muscat/Barka/disabled target, performance and boundary checks. They require unambiguous real profile selection from existing route configuration, use a four-second SQL statement limit, change only transaction-local claims, and end with `ROLLBACK`. They expose no profile identifiers or names and do not create authenticated browser sessions.

After the release owner reported SQL25/26 applied, this agent attempted only the preflight query. Its connector call stalled and was interrupted without returning a database result. **No post-release SQL query returned to this agent.** The successful follow-up SQL reads below were executed through the release owner's working root connector and are attributed separately. No retry or additional live query was issued by this agent.

## Advisor references

- [Anonymous callable SECURITY DEFINER functions](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)
- [Signed-in callable SECURITY DEFINER functions](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
- [SECURITY DEFINER views](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view)
- [RLS enabled without policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
- [Leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)


## تحقق الوكيلة الرئيسية بعد الترحيل — 19 أكتوبر 2026

نفّذت الوكيلة الرئيسية الاستعلامات المحضّرة عبر اتصالها العامل، بعد تعطل اتصال الوكيلة الفرعية. نجحت القراءات التالية، ولا تُنسب إلى الوكيلة الفرعية أو إلى تسجيل دخول فعلي:

- الدوال الست المخصصة لـTriggers موجودة؛ التنفيذ ممنوع لكل من `anon` و`authenticated`.
- الأهداف: المالك يرى صفين لمسقط وبركاء؛ كل موظفة ترى صفها فقط، بالقيم المعتمدة 10/2/10/5 وحجزين أو 4,000 ريال عمولة متوقعة. الحساب المعطل مرفوض بـ`42501`.
- الموظفتان لا تقرآن عملاء أو عقارات أو محادثات الفرع الآخر. حقول المالية محجوبة في الـprojections، والقراءة المباشرة للحقول المالية وطلب نطاق الاستثمار مرفوضة. الحساب المعطل لا يرى الشركة أو العملاء أو العقارات أو الصفقات.
- `crm_commission_report` يعمل للمالك ويُرفض للموظفتين والحساب المعطل. توجد عشرة سجلات تحصيل قديمة بلا تاريخ واثنان بلا مبلغ معروف؛ التشخيص ظاهر دون اختلاق مبلغ أو تاريخ. لا تُنشر المجاميع المالية الحقيقية في هذا المستودع العام.
- أداء الموظفات: مهلة 4 ثوانٍ لم تكفِ؛ إعادة الفحص بمهلة SQL قدرها 8 ثوانٍ نجحت للأدوار الثلاثة، بنطاق صحيح ومؤشر الحجز. الزمن شامل الاتصال نحو 4.9/5.8/7.7 ثانية للمالك/مسقط/بركاء. هذه ملاحظة أداء متبقية، وليست دليلًا على تحميل فوري.
- Storage: يوجد حوض `property-images` عام بلا كائنات، وسياسات الإدراج/القراءة/الحذف تستخدم مساعدًا يقيد الشركة والعقار والمالك والمسار وصيغ الصور. عرض الرابط العام لا تحميه RLS؛ هذا الحوض للصور العامة، وليس دليلًا على حماية مستندات حساسة. لم يُنفذ رفع حقيقي.
- مهمة `habib_whatsapp_followups_hourly` ما زالت `active=false`. لم تُفعّل أتمتة أو تُرسل رسالة.
- أعيد تشغيل security/performance advisors. بقيت تحذيرات projections ذات صلاحية المالك والدوال المقصودة للاستخدام المصادق وحماية كلمات المرور المسرّبة غير المفعلة، وفئات تحسينات الفهارس/RLS. زالت صلاحية تنفيذ الدوال الست. لم تُخفَّ التحذيرات أو تُحوّل views إلى invoker بما يكشف المالية.

الدليل القابل للمراجعة، الخالي من الأسماء والمعرّفات وبيانات العملاء والمجاميع المالية الحقيقية: `docs/audit-live-checks-20261019.json`. لا توجد صفوف استثمار خاصة فعلية في نتيجة القراءة الحالية؛ سماح المالك ورفض manager/viewer للسجلات الاستثمارية الموجبة ثبتا في PostgreSQL المعزول، وليس باستعمال حسابين فعليين غير موجودين في الشركة.

## الدخول الفعلي واستخدام المتصفح — دليل أحدث من حدود الجلسات السابقة

تحققت الوكيلة الرئيسية من الهوية الظاهرة بعد تسجيل دخول حقيقي عبر `browserAuth` الآمن لكل من مرام وهديل والمالك أحمد. هذا دليل استعمال فعلي للحسابات، مستقل عن المحاكاة وclaims معاملات SQL، ويستبدل وصف دخول الموظفتين والمالك بأنه غير متحقق منه في التقارير السابقة، ضمن المسارات المحددة هنا فقط.

اختبارات الأدوار السابقة تمت خلال إصداري v6/v7 في 19 أكتوبر، ومنها فحوص هديل والمالك المحددة أدناه على v7. تبقى أدلة مؤرخة لتلك الإصدارات؛ فحص المالك الإضافي على v8 مسجل منفصلًا، ولا يعيد تسمية كل رحلة سابقة بأنها أُعيدت كاملة بعد نشر v8.

| الحساب | ما نُفّذ وظهر فعليًا | النتيجة وحدودها |
|---|---|---|
| مرام — بركاء | لوحة بركاء وأهدافها؛ أداء هذا الشهر وآخر 3 أشهر؛ قائمة العملاء والبحث ومسح البحث؛ فتح نموذج فارغ وإلغاؤه؛ تحميل العقارات والزيارات؛ قائمة واتساب؛ إعادة تحميل الصفحة؛ تسجيل خروج محلي ثم إعادة التحميل | ظهرت أهداف بركاء الصحيحة وأداء مرام وحدها. عُرضت 100 محادثة من نطاقها و0 من مسقط في القائمة المفحوصة؛ هذا عدد العينة المعروضة، وليس ادعاءً بفحص كل صفحات المحادثات. أعادت إعادة التحميل اللوحة والأهداف؛ أعاد تسجيل الخروج ثم إعادة التحميل شاشة الدخول. |
| هديل — مسقط | لوحة مسقط وأهدافها؛ أداء الشهر؛ العملاء وفتح تفاصيل عميل/عرض 360 للقراءة؛ قائمة واتساب؛ إعادة التحميل من صندوق الوارد؛ العودة إلى الأهداف في الإصدار v7؛ تسجيل الخروج المحلي | ظهرت أهداف مسقط الصحيحة وأداء هديل وحدها. عُرضت 100 محادثة مسقط و0 بركاء في القائمة المفحوصة. احتُفظ بالجلسة عند إعادة التحميل وعادت الأهداف؛ تأكد تسجيل الخروج المحلي. |
| أحمد — المالك | هوية الحساب؛ أهداف الموظفتين؛ مساحة الاستثمار الخاصة؛ بطاقة الحالة التي كانت تعرض `viewing_cancelled` | ظهرت أهداف الموظفتين ومساحة الاستثمار الخاصة للمالك، وأصبحت الحالة المعنية بالعربية. ظهور مساحة الاستثمار لا يُقدّم بيانات استثمار موجبة غير موجودة في الإنتاج ولا يحل محل اختبارات PostgreSQL المعزولة. |

لم تُحفظ نماذج أو تُنشأ/تُعدّل سجلات عمل حقيقية، ولم تُفتح محادثة أو يُغيّر read state أو تُرسل رسالة أثناء هذه الجولة. لم يجمع النموذج كلمات مرور أو رموز جلسات. التحقق من الاستعادة بعد إعادة التحميل ومن الخروج المحلي لا يعني اختبار انتهاء الجلسة الإجباري أو تبديل refresh token أو استعادة كلمة المرور.

### فحص إضافي فعلي لحساب المالك على v7

نفّذت الوكيلة الرئيسية المسارات التالية في جلسة المالك الحقيقية، للقراءة وفتح النماذج وإلغائها فقط:

- كانت قائمة عمل الاستثمار الخاص فارغة وبها زر «إضافة مستثمر». فتح الزر نفسه نموذجًا فارغًا مع تحديد تصنيف المستثمر مسبقًا، وإشعار صريح بأن المسار استثمار والمسؤول المالك والخصوصية للمالك. كان حقل `cAssignedTo` معطلًا والمالك محددًا فيه. أُلغي النموذج دون حفظ، وبقيت القائمة فارغة. يثبت ذلك إعداد النموذج ومسار فتحه؛ لا يُقدَّم على أنه اختبار حفظ مستثمر حقيقي في الإنتاج.
- تحمّلت شاشتا المصاريف والنقد. فُتح نموذج مصروف فارغ وأُلغي؛ تحقق وجود دقة `0.001` في قيد المبلغ، دون تسجيل مصروف أو عرض مجاميع مالية حقيقية في هذا التقرير العام.
- عرضت الإعدادات إسناد مسقط لهديل، وبركاء لمرام، والاستثمار للمالك، والمسار العام دون إسناد. معرّفات Meta لخطّي الفرعين محفوظة، لكن ظهورها ليس دليلًا على استقبال webhook أو سلامة التكامل كاملًا. ظل خط المستثمر غير مربوط. لم تُنفذ عملية OAuth أو مزامنة أو حفظ إعدادات.

### النشر الموثق والإصدار النهائي

النسخة المنشورة v7 عند runtime `b25bb6922722f99e4a8c26ab4779a87574cae7a9`. نجحت جميع وظائف CI السبع في [run 39203499962](https://github.com/omanvilla/habib-crm/actions/runs/39203499962)، ونجح [نشر Pages 39203860804](https://github.com/omanvilla/habib-crm/actions/runs/39203860804). طابقت الأصول المنشورة المصدر في 18 من 18 أصلًا مفحوصًا. هذه أدلة نشر واختبارات مرافقة؛ نجاح الدخول والمسارات أعلاه مثبت بمشاهدتها في الجلسات الحقيقية، وليس باستنتاجه من نجاح CI وحده.

**الإصدار النهائي v8 منشور ومتحقق منه** عند runtime `6021a2416939075531b065e7c90e154ce3efb7f6`. اجتاز وظائف CI السبع في [run 39206341645](https://github.com/omanvilla/habib-crm/actions/runs/39206341645)، مع 270 اختبار Node ناجحًا واختباري SQL متروكين في سياق Node المخصص. نجح [نشر Pages 39206681056](https://github.com/omanvilla/habib-crm/actions/runs/39206681056) لنفس SHA، وعاد كل أصل من الأصول الإنتاجية الـ18 بحالة HTTP 200 وبايتات مطابقة للمصدر. [رابط الإنتاج](https://omanvilla.github.io/habib-crm/).

بعد نشر v8، أعادت الوكيلة الرئيسية تحميل جلسة المالك الحقيقية: بقيت هويته الصحيحة، وأظهر DOM إصدار v8. في «نظرة عامة» ظهرت فترة 1–31 أكتوبر 2026 بتوقيت عمان، وإيضاحات الحساب الصحيحة، واختفى النص القديم، وظهرت أزرار الفترات الست: هذا الشهر، وآخر 3 أشهر، وآخر 6 أشهر، وآخر 9 أشهر، وآخر سنة، ومن بداية الشركة. أظهر بحث العملاء غير المطابق صياغة الفراغ المصححة، وأعاد مسح البحث القائمة. لم تُحفظ سجلات أو إعدادات أثناء هذا الفحص.

اكتمل لاحقًا تحميل مجموعتي أهداف الموظفتين في لوحة v8، وظهر لكل منهما الأهداف الستة المعتمدة بالقيم 10/2/10/5/2/4000، مع المتبقي ونسب الإنجاز. نجحت مشاهدة بطاقات الأهداف في DOM. تعذرت قراءة سجل Console عند المحاولة الأخيرة بسبب قيد أمني على البيانات المحفوظة بعد تسليم بيانات الدخول عبر المسار الآمن؛ لم تُحاول الوكيلة تجاوز هذا القيد. لذلك **لا يثبت هذا الفحص خلو Console الإنتاج من الأخطاء**. نجاح المتصفحات المعزولة دون أخطاء وسجلات Edge السابقة المتاحة أدلة منفصلة عن سجل المتصفح الحي الذي تعذرت قراءته.

الدليل المجمع للجلسات الحقيقية وحدودها في [docs/audit-authenticated-browser-20261019.json](audit-authenticated-browser-20261019.json). تحل أدلة Pages/الأصول وفحص المالك على v8 محل حالة «نشر v8 معلّق» في التحديث السابق؛ تبقى اختبارات الأدوار السابقة منسوبة إلى v6/v7، وحدود استعادة الدخول وانتهاء الجلسة ودورة refresh token وMeta وStorage وRealtime والاستعادة الفيزيائية كما هي.

### تصنيف المستثمر القديم ومسار الاستثمار الخاص

ظهر لدى مرام تبويب تصنيف «مستثمرين» ضمن عملاء نطاقها. في `app-base-v15.html`، يعتمد هذا التبويب على `getRoles()` وحقلي `is_investor`/`client_type` في قائمة العملاء المصرح بها. أما مساحة الاستثمار الخاصة في `crm-operations-v6.js` وقواعد SQL18 فتعتمد على `lead_route` أو `route_key` أو `branch_key` بالقيمة `investment`، وعلى روابط العمل الخاص.

هذا التمييز منصوص عليه في `AGENTS.md` و`docs/current-state.md` و`docs/investment-owner-only-20261015.md`: تُحفظ تصنيفات المستثمرين القديمة التابعة للفروع دون تحويل تخميني أو تغيير مسار العملاء. لذا لا يُعد ظهور تصنيف مستثمر قديم وحده دليل تسريب للمساحة الخاصة، ولا يصح بالمقابل الادعاء بأن كل عميل يحمل تصنيف مستثمر مخفي عن الموظفات. بقيت هذه السجلات على حالها، ولم يُنفذ تحويل أو حجب جماعي. يظل وجود سجل فعلي من المسار الخاص لدى موظفة عيب صلاحيات مستقلًا يتطلب دليلًا على السجل ومساره.
