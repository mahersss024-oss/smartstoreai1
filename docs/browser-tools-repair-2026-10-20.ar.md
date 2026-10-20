# معالجة أدوات تشخيص المتصفح

التاريخ: 20 أكتوبر 2026. الطلب: معالجة تعثر Chrome DevTools MCP وLighthouse.
نجح الاختبار الوظيفي للأداتين على نسخة السوق المحلية المعزولة؛ لم تتغير
وظائف التطبيق أو ترويساته الأمنية أو اعتمادياته أو قاعدة البيانات.

## النتيجة الحالية

| الأداة | النتيجة المثبتة | حدودها |
| --- | --- | --- |
| Chrome DevTools MCP 1.11.0 | فتح التطبيق وDOM وConsole وNetwork، ثم trace فيه `NAVIGATION_0` ورابط السوق وLCP وCLS؛ نجح أيضًا من أدوات Codex المباشرة | فحص محلي لصفحة السوق، وليس كل التدفقات أو جميع بيئات التشغيل |
| Lighthouse 13.5.0 | تقرير JSON وHTML وtrace بأرقام فعلية، دون `runtimeError` أو audit errors | desktop، سياق تصفح مهيأ مسبقًا، `provided` throttling؛ ليس زيارة أولى بمتصفح بارد أو قياس الإنتاج/PSI |

أدلة التشغيل الدائم محفوظة تحت `.data/browser-diagnostics/`، المتجاهل في Git.
المحاولات الفاشلة القديمة باقية تحت `.data/environment-audit/` للمقارنة.

## ما الذي سبب التعثر؟

### تشغيل Chrome

في الفحص الأول وصل MCP إلى stdio وCDP ثم فشل renderer بالرمز 49. في هذه
الجلسة نجح تشغيل Puppeteer المباشر، ثم MCP بالإصدارات والأعلام الحالية
على Chromium الموجود وChrome stable، دون تعطيل sandbox أو تغيير ACL.
لذلك **سبب فشل التشغيل الأول لم يُثبت، ولم يعد قابلًا للإعادة في السياق
الحالي**. لا يصح نسب نجاح التشغيل إلى تغيير ترويسات التطبيق أو زيادة مهلة
اعتباطية. نجاح القبول الحالي دليل تشغيل، وليس ضمانًا لكل سياقات العملية.

أُضيف `TEMP/TMP` داخل المشروع، وحد ملفات صريح `--filesystem-root` إلى
إعداد MCP المحلي. حد الملفات يحل رفض حفظ trace عندما لا يعلن العميل
workspace roots؛ يدعم عميل الفحص الجديد بروتوكول `roots/list` أيضًا.
لم يُستخدم `--allow-unrestricted-paths` أو تعديل إعداد Codex العام.
الخياران موثقان في
[إعداد DevTools الرسمي](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/configuration.md).

### فقدان بيانات الانتقال في القياس الافتراضي

كان Lighthouse ينتهي بـ`NO_NAVSTART`، بينما يعطي DevTools trace الافتراضي
`URL: about:blank` و`NO_NAVIGATION` رغم وصول DOM إلى السوق. حفظ ملف trace
دون انتقال للصفحة المستهدفة لم يُحتسب قبولًا صالحًا.

جرت مقارنة مضبوطة على صفحة HTML/CSS بسيطة بلا خدمات خارجية:

| الحالة | النتيجة |
| --- | --- |
| الصفحة البسيطة دون COOP | Lighthouse نجح، ووجد navigationStart مؤهلة |
| الصفحة نفسها مع `Cross-Origin-Opener-Policy: same-origin-allow-popups` | فشل `NO_NAVSTART`، وظهر تبديل عملية الإطار الرئيسي |
| صفحة السوق بإعداد الجمع الافتراضي | فشلت بالطريقة نفسها، وتطابق ترويسة COOP الحالة الثانية |
| صفحة السوق بسياق مهيأ وطريقة الجمع المعدلة | نجحت navigationStart لنفس الإطار ونجحت المقاييس |

التحليل يثبت تفاعل طريقة جمع trace مع الانتقال الذي يبدّل سياق التصفح في
بيئة المتصفح الحالية. لا يثبت عيبًا وظيفيًا في السوق أو يستلزم إزالة COOP.
في trace التطبيق الفاشلة وُجدت navigationStart بإطار مختلف وعنوان تحميل
فارغ، فاستبعدها مرشح Lighthouse؛ في الحالة الصناعية مع COOP لم توجد
navigationStart مؤهلة. في التشغيل المعدل وُجد الحدث الحقيقي للإطار الصحيح،
دون إضافة أحداث مصطنعة أو تعديل بيانات القياس.

الأدلة:

- [مقارنة synthetic دون COOP](../.data/environment-audit/remediation-lighthouse-root-baseline/summary.json).
- [المقارنة مع COOP](../.data/environment-audit/remediation-lighthouse-root-coop/summary.json).
- [تحليل trace التطبيق الفاشلة](../.data/environment-audit/remediation-lighthouse-app-stable-analysis.json).
- [تحليل التشغيل الناجح المعدل](../.data/environment-audit/remediation-lighthouse-prepared-app-analysis.json).

## المعالجة المطبقة

[lighthouse-local.mjs](../scripts/dev-tools/lighthouse-local.mjs) ينشئ ملف
متصفح جديدًا، ويفتح الرابط المحلي أولًا، ثم يمرر Puppeteer Page نفسها إلى
Lighthouse مع `skipAboutBlank=true`. يبقى `disableStorageReset=false`؛
لا تُعطّل إعادة ضبط التخزين والكاش أثناء القياس. يستعمل واجهة API المثبتة
بدون patch للحزمة أو ترقيتها. التقرير موسوم بوضوح بأنه prepared context؛
تظل عمليات المتصفح وكاش الخادم قابلة لأن تكون دافئة، ولا تُقارن الدرجة
بإعداد mobile أو PSI الافتراضي. [واجهة API الرسمية](https://github.com/GoogleChrome/lighthouse/blob/v13.5.0/core/index.js).

[devtools-local.mjs](../scripts/dev-tools/devtools-local.mjs) يتحقق من اتصال
MCP ومن DOM، ثم يبدأ trace بـ`reload=false` و`autoStop=false`، ويجري
`navigate_page(type=reload, ignoreCache=true)` صراحة، ثم يوقف trace بعد
نافذة الملاحظة. هذا يحافظ على السياق المهيأ بدل رحلة `about:blank` التي
ينفذها مسار reload التلقائي. يتحقق من origin وpathname ومن وجود navigation
وLCP وCLS فعلية؛ يرفض قبول `NO_NAVIGATION` أو trace لصفحة أخرى.

السكربتان يقبلان **HTTP loopback فقط** على `127.0.0.1` أو `localhost` أو
`[::1]` دون بيانات اعتماد في URL. لا يثبتان أدوات تلقائيًا، ولا يبدآن
التطبيق أو قواعد البيانات. الملفات المؤقتة وملف المتصفح والأدلة داخل
`.data/browser-diagnostics/`، ويطلب السكربتان إنهاء عملياتهما في `finally`
ويسجلان تعثر التنظيف إذا حدث. التشغيلان المثبتان انتهيا بنجاح.
لا تستخدمهما مع بيانات حسابات حقيقية؛ تقارير الأداء تتضمن URLs وأصول
الصفحة المختبرة. الاختبارات هنا استخدمت fixtures محلية دون تسجيل دخول.

أضيفت مداخل السكربتين إلى Knip لأن مهام VS Code تستدعيهما بمسارات نصية؛
لم تُضف استثناءات لإخفاء نتائج الكود المشتبه به.

## التحقق الفعلي

- نجحت استدعاءات DevTools المباشرة في Codex: `new_page` وDOM وConsole
  وNetwork وبدء trace وإيقافه وحفظه داخل المشروع.
- trace المباشرة تخص `http://127.0.0.1:3197/`، ووجدت `NAVIGATION_0` وLCP
  نحو 2090ms وCLS صفرًا. [دليل MCP المباشر](../.data/environment-audit/remediation-devtools-native.json).
- آخر تشغيل دائم لـDevTools التقط 30 طلبًا بلا أخطاء HTTP مرصودة،
  وLCP نحو 1212ms وCLS صفرًا، مع مطابقة المسار المقصود.
- التشغيل الدائم لـLighthouse أعطى performance=0.98 ومقاييس صالحة بلا
  runtime/audit errors. هذه عينة محلية واحدة؛ ليست ضمان أداء أو تحسنًا في
  التطبيق. عينة إثبات سابقة أثناء تشغيل فحوص أخرى أعطت 0.82، ولذلك لا يُستنتج
  تحسن قبل/بعد من تغير الأرقام دون ضبط ظروف القياس.
- Console سجل ملاحظة DevTools قائمة: حقل نموذج بلا `id` أو `name`.
  لم تُغيّر واجهة المنتج لمعالجتها ضمن مهمة الأدوات.
- بعض تنقلات التطبيق ترسل analytics تلقائيًا إلى الخادم المحلي؛ استُخدم
  مخزن fixtures الملفي المعزول، دون قاعدة بيانات أو إرسال بيانات إنتاج.
- نجح lint مع تحذير `_phoneNumber` القائم فقط، وفحص الصياغة والمهام وتكرار
  installer دون إعادة تثبيت. فحوص TypeScript/Node tests/build من الجولة
  السابقة لم تُعد لأنها ليست تغييرات في وظائف التطبيق؛ حالات baseline
  تبقى موثقة في [تقرير البيئة](environment-tools-verification-2026-10-20.ar.md).
- نجح lint المركز بعد آخر تعديلات السكربتات، وفُحصت مهام VS Code العشر
  وروابط الأدلة. أعاد Knip النتائج الـ193 نفسها تمامًا بعد إضافة المداخل،
  دون إصلاح أو حذف؛ خروج 1 بقي بسبب النتائج القائمة.
- نجحت اختبارات رفض الرابط الخارجي وبيانات الاعتماد في URL لكلا السكربتين.
  أُغلقت خوادم HTTP المؤقتة على المنافذ 3197 و3198 و3199 بعد الانتهاء.

التفاصيل والأسماء الدقيقة لأحدث أدلة التشغيل في
[ملخص المعالجة](../.data/environment-audit/remediation-summary.json).

## الاستخدام من VS Code

شغّل نسخة تطبيق اختبار محلية معدّة مسبقًا، ثم من `Terminal > Run Task`:

1. `SmartStore: Check DevTools browser and trace (local)`.
2. `SmartStore: Lighthouse prepared-context audit (local)`.

تطلب المهمة رابط الخادم الجاري، والقيمة الافتراضية هي منفذ الفحص 3197.
لا تعيد المهام تشغيل الخادم أو تحميل `.env.local` نيابة عنك. الأوامر المكافئة:

```powershell
node scripts/dev-tools/devtools-local.mjs http://127.0.0.1:3197/
node scripts/dev-tools/lighthouse-local.mjs http://127.0.0.1:3197/
```

إذا كانت الحزم المعزولة غائبة، شغّل مهمة التثبيت الموجودة أولًا. إذا تعطل
renderer مجددًا، احتفظ بسجل التشغيل المبكر واختبر ملف متصفح جديدًا في سياق
تنفيذ مماثل قبل تغيير أعلام الحماية. لا تُزل COOP أو sandbox للحصول على
تقرير ناجح. احتفظ بوسم ظروف القياس عند مقارنة تقارير لاحقة.
