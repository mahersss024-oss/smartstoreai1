export type AppLanguage = 'ar' | 'en';

const arabicCopy = {
    direction: 'rtl',
    assistantLabel: 'مساعد السوق الذكي',
    newChat: 'محادثة جديدة',
    historyTitle: 'سجل المحادثات',
    historyEmpty: 'ستظهر محادثاتك السابقة هنا بعد إرسال أول رسالة.',
    clearHistory: 'حذف جميع المحادثات',
    clearHistoryConfirm: 'هل تريد حذف جميع المحادثات المحفوظة؟',
    deleteChat: 'حذف المحادثة',
    settings: 'إعدادات السوق',
    settingsDescription:
      'تساعد هذه الإعدادات المساعد على تخصيص تجربة السوق حسب الدولة والعملة واللغة.',
    country: 'الدولة',
    currency: 'العملة',
    language: 'لغة الواجهة والرد',
    arabic: 'العربية',
    english: 'الإنجليزية',
    savedLocally: 'يتم الحفظ تلقائيًا على هذا المتصفح.',
    close: 'إغلاق',
    emptyTitle: 'ماذا تريد أن تفعل في السوق اليوم؟',
    emptyDescription:
      'اكتب طلبك طبيعيًا: ابحث عن منتج، اعرض منتج للبيع، ارفع صور إعلان، أو اسأل عن محادثات البيع والشراء.',
    inputPlaceholder: 'اكتب طلبك أو أرفق صور المنتج...',
    fallbackChatTitle: 'محادثة جديدة',
    imageAlt: 'شعار سوق حمد',
    themeToDark: 'الوضع الداكن',
    themeToLight: 'الوضع الفاتح',
    privacyPolicy: 'سياسة الخصوصية',
    quickPrompts: [
      {
        title: 'أبحث عن منتج',
        prompt: 'أبحث عن سيارة في الرياض',
      },
      {
        title: 'أعرض منتج للبيع',
        prompt: 'عندي آيفون 14 برو للبيع',
      },
      {
        title: 'افحص صور الإعلان',
        prompt: 'أريد فحص صور المنتج قبل نشر الإعلان',
      },
      {
        title: 'أحتاج مساعدة في إعلان',
        prompt: 'ساعدني أجهز إعلان واضح ومطابق للسياسة',
      },
    ],
    status: {
      marketplace: [
        { title: 'جاري فهم الطلب', detail: 'أحدد هل العميل يريد بحثًا أو إعلانًا أو محادثة' },
        { title: 'جاري مراجعة السوق', detail: 'أبحث داخل إعلانات سوق حمد المناسبة' },
        { title: 'جاري التحقق', detail: 'أراجع السياسة والتصنيف قبل الرد' },
        { title: 'لحظة واحدة', detail: 'أجهز لك ردًا مناسبًا للعملية' },
      ],
      thinking: [
        { title: 'جاري تجهيز الرد', detail: 'أراجع طلبك وأرتب الخطوة المناسبة' },
        { title: 'لحظة واحدة', detail: 'أفهم النية وأحدد أفضل مسار' },
        { title: 'جاري التحليل', detail: 'أحوّل الطلب إلى إجراء واضح داخل السوق' },
        { title: 'قريبًا ينتهي الرد', detail: 'أجهز خلاصة مختصرة ومفيدة' },
      ],
      queryPrefix: 'جاري البحث عن',
    },
    countries: {
      SA: 'السعودية',
      AE: 'الإمارات',
      KW: 'الكويت',
      QA: 'قطر',
      BH: 'البحرين',
      OM: 'عُمان',
      EG: 'مصر',
      JO: 'الأردن',
    },
  } as const;

// Old language preferences remain readable, but all customer copy is Arabic.
export const appCopy = { ar: arabicCopy, en: arabicCopy } as const;
