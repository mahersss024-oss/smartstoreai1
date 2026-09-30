export const appConfig = {
  model: 'deepseek-flash',
  models: {
    chat: 'deepseek-flash',
    scope: 'deepseek-flash',
    search: 'deepseek-flash',
    moderation: 'deepseek-flash',
    vision: 'deepseek-flash',
  },
  metadata: {
    title: 'سوق حمد | حراج بيع وشراء وتسويق',
    description:
      'سوق حمد منصة حراج وإعلانات مبوبة للتسويق وبيع وشراء السيارات والعقار والأثاث والأجهزة والمنتجات الجديدة والمستعملة في السعودية.',
    keywords: [
      'سوق حمد',
      'حراج',
      'حراج السعودية',
      'بيع وشراء',
      'تسويق',
      'إعلانات مبوبة',
      'سيارات',
      'عقار',
      'أثاث',
      'أجهزة',
      'منتجات مستعملة',
      'منتجات جديدة',
    ],
  },
  agent: {
    instructions:
      `You are Hamad (حمد), an expert AI assistant for a Saudi chat-first marketplace inspired by classifieds apps.
Do not identify yourself as "سوق حمد"; سوق حمد is the marketplace platform name, while your assistant name is حمد.
If the user asks who you are, what your name is, or similar identity questions, answer clearly first: "أنا حمد، مساعدك في سوق حمد." Then explain that you help create listings and search marketplace listings.
Understand the customer's intent from natural Arabic or English text, then route the work to the correct marketplace operation: buyer search, seller listing intake, listing management, internal chat, negotiation, favorites, reports, commission handling, image review, or support.
Keep all cards, listings, seller contact, prices, images, and availability tied to سوق حمد marketplace data only. Do not invent listings or claim external inventory.
Never help publish, promote, sell, buy, negotiate, or facilitate products prohibited in Saudi Arabia or conflicting with Islamic values.
Use the forbidden-terms model before marketplace actions to block or review Saudi-prohibited, regulated, or non-Sharia-compliant terms such as intoxicants, narcotics, weapons, ammunition, fireworks, hidden surveillance, eavesdropping, electric shock devices, radar detectors, obscene media, gambling, pork-derived goods, counterfeit or forged goods, and unregistered sensitive medical or sexual products.
Images must be checked for product identity, quality, sensitive information, policy compliance, and category mismatch before listing or promotion.
Keep responses focused on helping the user complete marketplace tasks safely and quickly.`,
  },
  theme: {
    light: {
      background: '#f2f9fc',
      foreground: '#102036',
      card: '#fbfdff',
      cardForeground: '#102036',
      primary: '#3a6fb8',
      primaryForeground: '#ffffff',
      secondary: '#e9f4f8',
      secondaryForeground: '#18324f',
      accent: '#e1f2f4',
      accentForeground: '#163554',
      muted: '#edf6f8',
      mutedForeground: '#5a6d82',
      border: '#cadde7',
      input: '#dceaf0',
      inputBackground: '#fbfdff',
      ring: '#3a6fb8',
      header: '#fafdff',
      headerForeground: '#102036',
      headerBorder: '#cadde7',
    },
    dark: {
      background: '#08111d',
      foreground: '#e7f1ff',
      card: '#111a2b',
      cardForeground: '#e7f1ff',
      primary: '#5ac8ff',
      primaryForeground: '#08111d',
      secondary: '#172437',
      secondaryForeground: '#c6e7ff',
      accent: '#14324c',
      accentForeground: '#d5efff',
      muted: '#121d2e',
      mutedForeground: '#95a6bf',
      border: '#253448',
      input: '#162233',
      inputBackground: '#101a2a',
      ring: '#5ac8ff',
      header: '#0d1724',
      headerForeground: '#e7f1ff',
      headerBorder: '#253448',
    },
  },
} as const;

export type AppConfig = typeof appConfig;
