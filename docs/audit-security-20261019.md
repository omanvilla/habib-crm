# Security and integration delta — 2026-10-19

Read-only follow-up to `comprehensive-audit-20261018.md`. Scope is deliberately a delta check; this report does not relabel the earlier synthetic or transaction-local role tests as real employee browser authentication. No customer rows were written, conversations opened, messages sent, passwords changed, tokens minted, or jobs enabled.

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

## Remaining direct-use limits

- Actual manager/employee browser authentication, token expiry/refresh, recovery email, real authenticated Storage upload/download and Realtime delivery remain unverified by this agent.
- Unchanged Edge versions do not establish fresh Meta intake, outbound delivery, token validity, OCR or provider retries. No sends were attempted.
- Follow-up post-release checks should read the six effective ACLs and the owner/Muscat/Barka/disabled target/performance scopes, without opening CRM threads or writing test business records.

## Post-release handoff

Prepared fourteen separate bounded read-only queries under `/tmp/habib-postrelease-security/`: account/route cardinality preflight, six trigger ACLs, and owner/Muscat/Barka/disabled target, performance and boundary checks. They require unambiguous real profile selection from existing route configuration, use a four-second SQL statement limit, change only transaction-local claims, and end with `ROLLBACK`. They expose no profile identifiers or names and do not create authenticated browser sessions.

After the release owner reported SQL25/26 applied, this agent attempted only the preflight query. Its connector call stalled and was interrupted without returning a database result. **No post-release SQL query returned to this agent; no post-release role or ACL success is asserted here.** The release owner will execute the prepared files through the working root connector and record those separate results. No retry or additional live query was issued by this agent.

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
