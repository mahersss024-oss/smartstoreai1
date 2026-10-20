# أدوات Codex للتطوير

نتائج التجهيز السابقة أدناه تاريخية. الفحص الحالي وإضافات Knip وDevTools
وLighthouse وحدود Read Only موثقة في
[تقرير التحقق الحالي](environment-tools-verification-2026-10-20.ar.md).
نجح Playwright وContext7 وقراءات GitHub وPostgreSQL. بعد تعثر الجولة الأولى،
نجح DevTools وقياس Lighthouse بطريقة موثقة في
[تقرير معالجة المتصفح](browser-tools-repair-2026-10-20.ar.md).
لم تُعد اختبارات DB ذات الكتابة في الفحص الحالي.
عولجت لاحقًا مشكلات تصنيف الملف العام وlint وتتبع بيانات البناء، ونجح
الفحص الحالي دون فشل اختبارات؛ [تقرير الإصلاح](project-fixes-2026-10-20.ar.md).

تم إعداد الأدوات في 20 أكتوبر 2026 دون تعديل كود التطبيق أو `.env.local` أو
اعتماديات التطبيق. ملف إعداد Codex الشخصي هو
`C:\Users\maher\.codex\config.toml`، مع نسخة احتياطية قبل التغيير باسم
`config.toml.before-dev-tools-20261020` في المجلد نفسه.

## الأدوات المثبتة

| التجهيز | الحالة والتحقق |
| --- | --- |
| إرشادات المشروع | `AGENTS.md` يشرح البنية والعقود وأوامر الاختبار ومراجع الوثائق |
| الملفات والطرفية | متاحة بالفعل؛ Codex CLI 0.163.0 وإضافة Codex في VS Code موجودان |
| Context7 MCP | الإصدار 4.4.4؛ نجح الاتصال واستدعاء جلب مراجع Next.js |
| Playwright MCP | الحزمة 0.0.83؛ نجح تشغيل المتصفح وفتح صفحة محلية وقراءة محتواها |
| PostgreSQL | استخدام 17.11 المثبت؛ قاعدتا تطوير واختبار مستقلتان و23 ترحيلة لكل منهما؛ نجحت اختبارات DB الحالية 18/18 |
| Sentry MCP | مفعّل على `https://mcp.sentry.dev/mcp`، واكتمل تسجيل OAuth |
| GitHub MCP | الخادم الرسمي 2.0.2 مثبت ومرتبط باعتماد GitHub الموجود في Windows؛ نجح استدعاء قراءة ملف عام عبر MCP |

حزمتا MCP مثبتتان في `C:\Users\maher\.codex\tools\dev-mcp` بإصدارات ثابتة،
بعيدًا عن `node_modules` وملف قفل التطبيق. متصفح MCP مستقل عن متصفحات
اختبارات المشروع، وأُبقيت الإصدارات التي تعتمد عليها الاختبارات متاحة.
يعمل متصفح MCP دون واجهة وبملف متصفح معزول في الذاكرة.

خادم GitHub وGitHub CLI مثبتان تحت `C:\Users\maher\.codex\tools` من
إصدارات GitHub الرسمية بعد التحقق من SHA-256 للأرشيفين. يستخدم الربط وسيطًا
محليًا في `github-mcp\stdio.mjs` لاسترجاع الاعتماد الموجود بواسطة Git
Credential Manager في الذاكرة وتمريره لعملية الخادم فقط، مع دعم اعتماد
GitHub CLI كبديل عند إعداده. لا يُكتب الاعتماد في إعداد MCP أو المشروع أو سجل الأوامر.
هذا الوسيط تجميع محلي لقدرات الأداتين، وليس حزمة إضافية منشورة من GitHub.
لم يتطلب الربط إنشاء رمز يدوي أو إعادة تسجيل دخول، لأن حساب GitHub كان
موجودًا بالفعل في مخزن Windows. أُلغيت محاولتا ربط الجهاز اللتان رفضهما
المتصفح؛ لا تستخدم رموزهما السابقة. GitHub CLI 2.102.0 مثبت كأداة إضافية،
لكنه ليس مصدر الاعتماد النشط في الإعداد الحالي.

## الاستخدام داخل VS Code

بعد اكتمال الإعداد، أعد تحميل نافذة VS Code عبر
`Developer: Reload Window`، ثم ابدأ محادثة Codex جديدة. تحقق من قائمة
`MCP servers` في إعدادات Codex. إعدادات MCP تخص Codex وتُشارك مع CLI؛
لا يلزم إنشاء `.vscode/mcp.json` الخاص بعملاء آخرين.

يمكن فحص الإعدادات العامة بالأمر:

```powershell
codex.cmd mcp list
```

قد يعرض عمود Auth عبارة `Unsupported` للأدوات المحلية STDIO؛ هذا العمود
يصف مصادقة النقل التي يديرها Codex، ولا يعني أن الخادم لم يعمل. خادم GitHub
المحلي يدير اعتماده عبر الوسيط الذي يستخدم Git Credential Manager أساسًا،
مع GitHub CLI كبديل عند إعداده.

أضيف الآن إعداد مشروع في `.codex/config.toml` يفعّل Chrome DevTools ويقيد
خادم GitHub بـ`GITHUB_READ_ONLY=1`. اختُبر خادم GitHub مستقلاً: 27 أداة قراءة
دون أدوات كتابة. يلزم reload ومحادثة جديدة لتحميل الإعداد في Codex؛ لم تتغير
صلاحيات الاعتماد الأصلي. نجح اختبار متصفح Chrome DevTools وtrace من أدوات
Codex المباشرة ومن السكربت الدائم بعد المعالجة. الأدوات الجديدة محلية ومعزولة داخل `.data`؛
مهمة `SmartStore: Install isolated diagnostic tools` تعيد إنشاءها عند الحاجة.

من `Terminal > Run Task` تتوفر مهام باسم `SmartStore:` لتشغيل قاعدة البيانات
وإيقافها والتحقق منها، وتشغيل التطبيق عليها، واختبارات تكامل PostgreSQL.
أضيفت مهام مستقلة لتثبيت أدوات التشخيص المعزولة، وقراءة PostgreSQL الوصفية
فقط، وKnip دون إصلاح. مهام الترحيل/الاختبار القديمة التي تكتب بيانات ليست
جزءًا من مهمة فحص للقراءة فقط.
التفاصيل في [local-postgres.md](local-postgres.md). البيانات المحلية محفوظة
داخل ignored `.data`، ولا تسجل القاعدة كخدمة Windows أو تستبدل قاعدة موجودة.

## حسابات GitHub وSentry

لإعادة مصادقة GitHub عند الحاجة، استخدم تسجيل المتصفح المباشر عبر مدير
الاعتمادات الموجود، دون الحاجة إلى رموز الجهاز:

```powershell
& 'C:\Program Files\Git\mingw64\bin\git-credential-manager.exe' github login --url https://github.com --browser
```

لإعادة مصادقة Sentry:

```powershell
codex.cmd mcp login sentry
```

لا تشارك رموز الوصول في المحادثة أو ملفات المشروع. ربط Sentry يتيح أدوات
حساب Sentry لـCodex؛ لا يضيف Sentry SDK إلى التطبيق ولا ينشئ مشروع مراقبة
جديدًا تلقائيًا. تبقى العمليات الخارجية مرتبطة بتعليمات المستخدم وصلاحياته.

## مراجع الإعداد

- [إعداد MCP في Codex](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).
- [إرشادات AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md).
- [توثيق GitHub MCP الرسمي](https://github.com/github/github-mcp-server).
- [مصادقة GitHub CLI](https://cli.github.com/manual/gh_auth_login).
- [خادم Sentry الرسمي](https://mcp.sentry.dev/).
