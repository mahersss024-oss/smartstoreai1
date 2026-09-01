export type AppLanguage = 'ar' | 'en';

export const appCopy = {
  ar: {
    direction: 'rtl',
    assistantLabel: 'مساعد التسوق',
    newChat: 'محادثة جديدة',
    historyTitle: 'سجل المحادثات',
    historyEmpty: 'ستظهر محادثاتك السابقة هنا بعد إرسال أول رسالة.',
    clearHistory: 'حذف جميع المحادثات',
    clearHistoryConfirm: 'هل تريد حذف جميع المحادثات المحفوظة؟',
    deleteChat: 'حذف المحادثة',
    settings: 'إعدادات الموقع',
    settingsDescription:
      'تساعد هذه الإعدادات المساعد على تخصيص النصائح حسب الدولة والعملة والمنطقة.',
    country: 'الدولة',
    currency: 'العملة',
    language: 'لغة الواجهة والرد',
    arabic: 'العربية',
    english: 'English',
    savedLocally: 'يتم الحفظ تلقائيًا على هذا المتصفح.',
    close: 'إغلاق',
    emptyTitle: 'كيف أقدر أساعدك في التسوق اليوم؟',
    emptyDescription:
      'اكتب ما تريد شراءه أو مقارنته. يمكنني استخدام البحث كحل مؤقت لاكتشاف الصفحات، أما الأسعار المؤكدة فتأتي لاحقًا من المتاجر المتصلة.',
    inputPlaceholder: 'اسأل عن منتج، مقارنة، أو نصيحة شراء...',
    fallbackChatTitle: 'محادثة جديدة',
    imageAlt: 'شعار SmartStore AI',
    themeToDark: 'الوضع الداكن',
    themeToLight: 'الوضع الفاتح',
    privacyPolicy: 'سياسة الخصوصية',
    partners: 'الشراكات',
    quickPrompts: [
      {
        title: 'منتج بميزانية محددة',
        prompt:
          'أريد شراء منتج مناسب بميزانية محددة. ساعدني أحدد أفضل خيار حسب السعر والاستخدام.',
      },
      {
        title: 'قارن بين منتجين',
        prompt:
          'قارن لي بين منتجين من ناحية المواصفات والقيمة مقابل السعر.',
      },
      {
        title: 'اختيار منتج محدد',
        prompt:
          'ساعدني أختار منتجًا محددًا بشكل دقيق بناءً على المواصفات التي أحتاجها.',
      },
      {
        title: 'هدية مناسبة',
        prompt:
          'أريد اقتراح هدية مناسبة. اسألني الأسئلة المهمة ثم رشح لي خيارات.',
      },
    ],
    status: {
      web: [
        { title: 'جاري البحث في الويب', detail: 'أراجع مصادر حديثة وموثوقة' },
        { title: 'جاري جمع النتائج', detail: 'أرتب المعلومات الأهم أولًا' },
        { title: 'جاري التحقق من المعلومات', detail: 'أراجع التفاصيل قبل الرد' },
        { title: 'لحظة واحدة', detail: 'أجهز لك خلاصة واضحة' },
      ],
      thinking: [
        { title: 'جاري تجهيز الرد', detail: 'أراجع طلبك وأرتب الإجابة المناسبة' },
        { title: 'لحظة واحدة', detail: 'أفكر في أفضل طريقة لمساعدتك' },
        { title: 'جاري التحليل', detail: 'أحول طلبك إلى خطوات واضحة' },
        { title: 'قريبًا ينتهي الرد', detail: 'أجهز لك خلاصة مختصرة ومفيدة' },
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
  },
  en: {
    direction: 'ltr',
    assistantLabel: 'Shopping assistant',
    newChat: 'New chat',
    historyTitle: 'Chat history',
    historyEmpty: 'Your previous conversations will appear here after your first message.',
    clearHistory: 'Clear all chats',
    clearHistoryConfirm: 'Do you want to delete all saved conversations?',
    deleteChat: 'Delete chat',
    settings: 'Location settings',
    settingsDescription:
      'These settings help the assistant tailor guidance by country, currency, and region.',
    country: 'Country',
    currency: 'Currency',
    language: 'Interface and reply language',
    arabic: 'العربية',
    english: 'English',
    savedLocally: 'Saved automatically on this browser.',
    close: 'Close',
    emptyTitle: 'How can I help you shop today?',
    emptyDescription:
      'Ask what you want to buy or compare. I can use web search for temporary page discovery, while confirmed prices will come from connected stores later.',
    inputPlaceholder: 'Ask about a product, comparison, or shopping advice...',
    fallbackChatTitle: 'New chat',
    imageAlt: 'SmartStore AI logo',
    themeToDark: 'Switch to dark mode',
    themeToLight: 'Switch to light mode',
    privacyPolicy: 'Privacy policy',
    partners: 'Partners',
    quickPrompts: [
      {
        title: 'Product within budget',
        prompt:
          'I want to buy a suitable product within a specific budget. Help me choose the best option based on price and use.',
      },
      {
        title: 'Compare two products',
        prompt:
          'Compare two products for me based on specs and value for money.',
      },
      {
        title: 'Choose a specific product',
        prompt:
          'Help me choose a specific product accurately based on the specs I need.',
      },
      {
        title: 'Suitable gift',
        prompt:
          'I want a suitable gift suggestion. Ask me the important questions, then recommend options.',
      },
    ],
    status: {
      web: [
        { title: 'Searching the web', detail: 'Reviewing recent and reliable sources' },
        { title: 'Collecting results', detail: 'Putting the most important details first' },
        { title: 'Checking the information', detail: 'Reviewing details before replying' },
        { title: 'One moment', detail: 'Preparing a clear summary for you' },
      ],
      thinking: [
        { title: 'Preparing the reply', detail: 'Reviewing your request and organizing the answer' },
        { title: 'One moment', detail: 'Thinking through the best way to help' },
        { title: 'Analyzing', detail: 'Turning your request into clear steps' },
        { title: 'Almost ready', detail: 'Preparing a short and useful summary' },
      ],
      queryPrefix: 'Searching for',
    },
    countries: {
      SA: 'Saudi Arabia',
      AE: 'United Arab Emirates',
      KW: 'Kuwait',
      QA: 'Qatar',
      BH: 'Bahrain',
      OM: 'Oman',
      EG: 'Egypt',
      JO: 'Jordan',
    },
  },
} as const;
