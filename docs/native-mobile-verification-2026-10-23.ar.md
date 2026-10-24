# سجل التحقق من تطبيق سوق حمد — 23 أكتوبر 2026

المصدر في [mobile](../mobile/README.md): تطبيق React Native بواجهات Android وiOS، واتصال HTTPS مباشر بواجهات API. معاينة الويب أداة تطوير واختبار للواجهات. لا يجلب التطبيق صفحات الموقع لعرضها داخله.

## النتيجة المتحققة

تحديث بعد تسليم الحزمة: بطلب المستخدم، ثُبّت APK نفسه بنجاح عبر USB على هاتفه NIC_LX2 بنظام Android 15 (SDK 35، arm64). أعاد `adb install -r` النتيجة `Success`، ونجح تشغيل MainActivity (`Status: ok`)، وظل التطبيق في الواجهة دون سجلات AndroidRuntime أوReactNativeJS من مستوى error لعمليته عند الفحص. روجعت لقطة لواجهة الزائر العربية على الهاتف. هذا فحص تثبيت وبدء تشغيل فقط؛ لا يثبت نجاح الدخول أو الكاميرا أو رفع الصور أو الإشعارات أو نشر إضافات API. عبارات عدم اختبار الجهاز أدناه تسجل حدود جولة البناء السابقة لهذا التحديث.

| الفحص | النتيجة | حدود الدليل |
| --- | --- | --- |
| TypeScript وESLint للتطبيق | نجحا، دون تحذيرات lint | فحص المصدر؛ لا يثبت تشغيل الوحدات الأصلية |
| توافق اعتماديات Expo | `expo install --check` ناجح | SDK 58 مع React Native 0.88 |
| اختبارات النقل والسياق | 5 ناجحة | تجزئة UTF-8 وCRLF، حدود البث وسياق حمد وعزل الأجزاء غير النصية |
| اختبارات نقل الصور | 4 ناجحة | محوّل Expo multipart الفعلي مع File والشبكة المموّهين، والتحقق من بايتات JPEG والحقل والهوية |
| تصدير Android وiOS والويب | نجح `expo export --platform all --output-dir dist --max-workers 2` | أُنتجت حزم Hermes للنظامين؛ هذا ليس إنشاء IPA أو تثبيتًا على جهاز |
| بناء APK الأصلي | نجح Gradle `assembleRelease`؛ `BUILD SUCCESSFUL` خلال 8 دقائق و45 ثانية | APK تجريبي أصلي لأندرويد، بتوقيع Android Debug؛ لم يُثبت أو يُشغّل على جهاز |
| توقيع APK وبياناته | `apksigner verify` ناجح، exit 0، وتوقيع v2 صحيح؛ فحص aapt2 ناجح | التوقيع تجريبي `CN=Android Debug`، وليس توقيع إصدار للمتجر |
| محاذاة أرشيف APK | `zipalign -c -P 16 4` ناجح، exit 0 | فحص الأرشيف لا يثبت اختبار جهاز بصفحات ذاكرة 16 KiB أو محاذاة ELF لكل مكتبة |
| اختبارات السيرفر الموحدة | 145 ناجحة، صفر فشل وصفر تخطٍ | 9 ملفات، بمخزن ملفات ومزودين مموّهين داخل بيئة معزولة |
| TypeScript وESLint لتغييرات السيرفر | نجحا | أُجريا بعد تغييرات API وHTTP/2 |
| فحوص معاينة الواجهات | 7 من 7 ناجحة | React Native Web مع اعتراض جميع طلبات API، دون أخطاء متصفح أو اتصال إنتاج |

شملت معاينة الواجهات: البحث والتصفية، تبويبات الزائر والدخول والإنشاء، عرض نص السياسات من مصدره، بيانات البلاغ الصحيحة، تحديث المفضلة، حجب الصور قيد المراجعة، ووقف طلب المحادثة الذي يعلّمها مقروءة عند مغادرة الشاشة أو انتقال التطبيق للخلفية. النتائج المحلية في `.data/native-mobile/browser-smoke-result.json`، واللقطات في المجلد نفسه. هذه الفحوص لا تثبت سلوك جهاز أصلي.

عُولج انعكاس الصفوف مرتين عند تفعيل RTL في النظام، بتثبيت اتجاه حاويات التصميم المشتركة والنوافذ المستقلة وإبقاء النص `rtl`. يستند الإصلاح إلى سلوك Yoga في مصدر React Native 0.88؛ تجربة جهاز بلغة عربية ما زالت مطلوبة.

محاولات البناء الأولى على Windows كشفت حد المسارات مع Ninja 1.10 ثم مسارات ملفات C++ الطويلة. التهيئة النهائية تستخدم CMake 3.31.6 وNinja 1.12.1 وتثبيت pnpm `hoisted`، مع plugin يضبط `expo.android.cmakeObjectPathMax=200` على Windows. لم تُغيّر إعدادات registry العامة. اكتمل بعدها بناء Gradle الأصلي `assembleRelease` بنجاح خلال 8 دقائق و45 ثانية في جولة مستأنفة تدريجية؛ هذه مدة الجولة النهائية وليست قياس بناء بارد من الصفر. اسم مهمة release لا يغير حقيقة أن شهادة الحزمة الحالية تجريبية.

## حزمة أندرويد المتحققة

الملف المحلي: [souq-hamad-android-preview.apk](../.data/native-mobile/souq-hamad-android-preview.apk). يقع في `.data` المتجاهل من Git؛ الرابط يعمل في مساحة العمل الحالية ولا يعني رفع الملف إلى المستودع أو نشره.

| الخاصية | القيمة المتحققة |
| --- | --- |
| الحجم | 33,904,699 بايت؛ نحو 33.9 MB أو 32.3 MiB |
| SHA-256 | `5765c22023407140742dbb97d1ce009a57df919c5c30382bc683f0666feb3088` |
| اسم الحزمة | `com.souqhamad.app.dev` |
| الإصدار | versionName `1.0.0`، versionCode `1` |
| بنية المعالج | `arm64-v8a` |
| SDK | min SDK `24`، target SDK `36`، compile SDK `37` |
| التوقيع | تحقق apksigner ناجح؛ v2 صحيح؛ شهادة `CN=Android Debug` |
| محاذاة الأرشيف | `zipalign -c -P 16 4`؛ exit `0` |
| محتويات الحزمة الأصلية | 27 مكتبة `.so`، بينها Hermes، و`assets/index.android.bundle` بحجم 3,777,544 بايت |
| إصلاح رفع الصور | تحقق source map للحزمة من تضمين إصلاح native File للرفع؛ هذا فحص تضمين، وليس إثبات رفع فعلي من جهاز |

ملخص البناء والفحوص المحلي: [android-preview-build-summary.json](../.data/native-mobile/android-preview-build-summary.json)، ويتضمن أسماء سجلات Gradle وapksigner وaapt2 وzipalign ومحتويات الحزمة. لم يُستنتج من نجاح zipalign توافق ELF أو نجاح التشغيل على جهاز بصفحات 16 KiB.

هذه حزمة preview للاختبار، وليست إصدارًا بتوقيع المالك أو حزمة منشورة في Google Play. لم تُجرَ تجربة تثبيت أو تشغيل فعلي على Android، ولم يُبنَ IPA أو يجرِ توقيع أو تقديم iOS. نجاح APK لا يثبت عمل Google/Apple أو الكاميرا ورفع الصور وAPNs/FCM مع إعدادات فعلية، ولا يثبت نشر إضافات API أو الاتصال بسيرفر الإنتاج.

ملفات اختبارات السيرفر: `native-mobile-api` و`apple-native-auth` و`auth-session` و`apple-auth` و`route-access-contracts` و`public-seller-profile-route` و`apns-http2` و`native-push` و`web-push`.

سجل الجولة الموحدة وملخصها المحليان في `.data/native-mobile/backend-tests.log` و`backend-tests-summary.json`. زمن الاختبارات 17.879 ثانية. لم تستخدم الجولة `.env.local` أو قاعدة بيانات الإنتاج، ولم تختبر مقدمي Google أوApple أوAPNs أوFCM الفعليين.

## إعادة الفحص

من جذر المستودع، بعد تثبيت اعتمادياته:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/testing/native-mobile-tests.ps1
```

من مجلد `mobile`:

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd exec eslint . --max-warnings 0
pnpm.cmd typecheck
node --experimental-strip-types --test tests/native-transport.test.mjs
node --test tests/native-upload.test.cjs
pnpm.cmd exec expo export --platform all --output-dir dist --max-workers 2
```

بعد التصدير، من الجذر لتشغيل فحوص المعاينة المحلية ذات البيانات المموّهة:

```powershell
node mobile/tests/browser-smoke.cjs
```

## ما يتطلب بيئة المالك قبل الإطلاق

1. نشر إضافات API الموجودة في هذا التغيير إلى سيرفر تجربة، وضبط عنوانه في إعداد التطبيق. لا يفترض هذا السجل أن الإضافات منشورة على النطاق العام.
2. مطابقة معرف الحزمة وبصمات التوقيع وOAuth وإعدادات Firebase وAPNs وSign in with Apple. مفاتيح السيرفر الخاصة لا توضع في التطبيق.
3. تشغيل التطبيق على Android وآيفون فعليين للتحقق من الدخول والكاميرا ورفع الصور والإشعارات والروابط وسلوك الخلفية. لم يكن هناك جهاز متصل أثناء هذه الجولة.
4. بناء iOS وتوقيعه على macOS أو EAS، وإعداد توقيع Android الخاص بالإصدار. لم تنفذ هذه الجولة رفعًا إلى المتاجر أو نشرًا للسيرفر.
5. تقوية دورة الجلسات الحالية بإلغاء جلسات الأجهزة، وإلغاء تفويض Apple عند حذف الحساب. الجلسة الحالية Bearer مدتها 14 يومًا، ولا يمنح logout الحالي إلغاءً عامًا للرمز.

إعداد EAS يستخدم مصدر إصدارات `remote` مع `autoIncrement` للإنتاج، لملاءمة التهيئة الديناميكية. حساب EAS وملكية معرفات الحزم وبيانات التوقيع لم تُربط أو تُفترض. راجع [تعليمات إدارة الإصدارات الرسمية](https://docs.expo.dev/build-reference/app-versions/).

راجع [تعليمات التطبيق](../mobile/README.md) و[البنية](native-mobile-architecture.ar.md) و[جرد API](native-mobile-api-inventory.md) لتفاصيل الوظائف وعقود الربط.
