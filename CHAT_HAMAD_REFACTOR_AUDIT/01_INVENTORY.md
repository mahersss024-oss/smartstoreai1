# جرد شات حمد قبل التنفيذ

خط الأساس `9d4666c731d8a3757ff5088885c63828b26bb85b`. نقطة الرجوع `audit/hamad-pre-refactor-20261122` وفرع التنفيذ `refactor/hamad-specialized-20261122`. نسخة التطبيق `f62fe30` متوافقة مع حمل الرسالة الحالي.

| المكوّن | الموقع | الاستخدام الحالي |
| --- | --- | --- |
| بدء المحادثة وإعادة ضبطها | `app/api/chat/route.ts` و`app/api/chat/reset/route.ts` | الطلب والرد عبر UI SSE، جلسة موقّعة وموافقة AI، والتحقق من الحجم والملكية. |
| تنسيق النموذج | `lib/chat/hamad-engine.ts`، `agent/chat-agent.ts` و`agent/system-prompt.ts` | ToolLoopAgent، فحص الإيصالات، الأسئلة المتكررة والمهل. |
| فهم النية الحالي | `agent/scope-guard.ts` و`lib/chat/draft-selection.ts` و`lib/chat/draft-edits.ts` | مصنف نموذج مع قواعد احتياطية، واستخراج وتقييد حقول المسودة يدويًا. |
| الذاكرة والسياق | `lib/chat/context.ts` و`draft-memory.ts` و`draft-intake.ts` | سياق محدود وإيصال حالة موقّع في `hamadDraftMemory`، مع جلسة الحساب والمحادثة. |
| واجهة التطبيق والتخزين | `AI/src/features/assistant/screen.tsx` و`history.ts` و`context.ts` | تطبيق Android وiOS يرسل سياقًا محليًا معزولًا بالحساب. يعرض نصًا وروابط قائمة ويحتفظ ببيانات الاستئناف، لا توجد بطاقات تعرض صور مسودات من عقد الشات الحالي. |
| الأدوات الخمس | `agent/tools/marketplace.ts` | إنشاء مسودة وتعديلها وإرفاق الصور وقراءة بيانات الصور ودليل المنصة. |
| حفظ المسودات والمعاينة والنشر | `agent/marketplace/repository.ts`، جدول `Listing` و`ListingImage`، `AI/src/features/listing-editor` | معرّف المالك من الجلسة، ومحرر التطبيق يدير المراجعة والنشر الفعلي. |
| الصور | `agent/marketplace/listing-image-content.ts` و`listing-image-storage.ts` و`agent/vision-messages.ts` | تدقيق الصور، استعمال مزود الرؤية عند الحاجة والربط الرسمي بالمسودات. |
| المعرفة | `agent/platform-guide.ts` و`lib/platform/policies.ts` | حقائق وسياسات المشروع المنشورة. |
| مزود النموذج | `agent/deepseek-provider.ts` و`app/app-config.ts` | DeepSeek. الأدوار المعرّفة في الإعدادات افتراضيًا `deepseek-flash` مع إمكان تجاوزها بحسب البيئة. أدوار البرمجية وحدها لا تثبت وجود نماذج منفصلة في خادم حي. |
| ضوابط العدد والتكلفة | `lib/chat/admission.ts` و`lib/rate-limit.ts` و`agent/deepseek-provider.ts` | قيد المعدل والتزامن، ميزانية خطوات، وطابور/إعادة محاولة المزود. |
| اختبارات الانحدار | `tests/chat-customer-flow.test.ts` و`tests/chat-action-boundary.test.ts` و`tests/chat-auth-gate.test.ts` و`tests/scope-guard.test.ts` | عقود المحادثة والملكية والاستئناف ومزودات مصطنعة. |

قبل التغيير، نقطة الدخول تعتمد طبقة امتثال وتحديد النية، ثم آليات اختيار المسودة والحقول، ثم وكيل الأدوات. يحتاج حذف أي وحدة قديمة إلى إسقاط اعتماد مسار الرجوع وإثبات مراجعها.
