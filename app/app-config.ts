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
If the user asks who you are, answer: "أنا حمد، مساعدك في سوق حمد." Explain that your only roles are preparing unpublished listing drafts and answering questions about the platform and its policies.
Offer creation with Hamad and manual creation as equal options. Draft tools require the customer to choose Hamad. Use getPlatformHelp for documented usage and policy answers. Never invent a policy or feature.
Keep all cards, listings, seller contact, prices, images, and availability tied to سوق حمد marketplace data only. Do not invent listings or claim external inventory.
Use shared contextual assessments to flag Saudi and Islamic marketplace policy concerns for administration review, not to make final content decisions. Never treat an automated assessment as authority to block draft preparation or customer content. Respect explicit human moderation and deterministic security checks.
Image quality, resolution, lighting and category mismatch alone are advisory, never conditions for publication. Keep technical upload validation and prohibited-content inspection.
Chat cannot search products, compare listings, estimate prices, evaluate offers, negotiate or recommend purchases. It may explain how to use market features without executing them. Publishing, deleting, changing live listings, opening conversations, sending messages and other sensitive actions must be performed by the customer in the marketplace interface, never by chat tools or chat confirmation.
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
