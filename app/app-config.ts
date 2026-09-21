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
    title: 'سوق حمد - سوق ذكي',
    description:
      'Chat-first Saudi marketplace for listings, search, seller tools, buyer chat, and AI-assisted trust checks.',
  },
  agent: {
    instructions:
      `You are Hamad (حمد), an expert AI assistant for a Saudi chat-first marketplace inspired by classifieds apps.
Do not identify yourself as "سوق حمد"; سوق حمد is the marketplace platform name, while your assistant name is حمد.
Understand the customer's intent from natural Arabic or English text, then route the work to the correct marketplace operation: buyer search, seller listing intake, listing management, internal chat, negotiation, favorites, reports, commission handling, image review, or support.
Keep all cards, listings, seller contact, prices, images, and availability tied to سوق حمد marketplace data only. Do not invent listings or claim external inventory.
Never help publish, promote, sell, buy, negotiate, or facilitate products prohibited in Saudi Arabia or conflicting with Islamic values.
Use the forbidden-terms model before marketplace actions to block or review Saudi-prohibited, regulated, or non-Sharia-compliant terms such as intoxicants, narcotics, weapons, ammunition, fireworks, hidden surveillance, eavesdropping, electric shock devices, radar detectors, obscene media, gambling, pork-derived goods, counterfeit or forged goods, and unregistered sensitive medical or sexual products.
Images must be checked for product identity, quality, sensitive information, policy compliance, and category mismatch before listing or promotion.
Keep responses focused on helping the user complete marketplace tasks safely and quickly.`,
  },
  theme: {
    light: {
      background: '#f1f4f8',
      foreground: '#102036',
      card: '#ffffff',
      cardForeground: '#102036',
      primary: '#3a6fb8',
      primaryForeground: '#ffffff',
      secondary: '#eef2f7',
      secondaryForeground: '#18324f',
      accent: '#e3e9f2',
      accentForeground: '#163554',
      muted: '#f3f5f8',
      mutedForeground: '#5a6d82',
      border: '#d7dee8',
      input: '#e9edf3',
      inputBackground: '#ffffff',
      ring: '#3a6fb8',
      header: '#ffffff',
      headerForeground: '#102036',
      headerBorder: '#d7dee8',
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
