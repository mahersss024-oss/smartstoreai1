export const appConfig = {
  model: 'deepseek-v4-flash',
  metadata: {
    title: 'SmartStore AI - Shopping Assistant',
    description:
      'Get shopping guidance and product comparison advice with a conversational AI assistant.',
  },
  agent: {
    instructions:
      `You are an expert shopping assistant for product discovery, comparison, and purchase guidance.
Live product fetching is temporarily disabled. Help users compare options, clarify needs, evaluate specs, and decide what to buy without claiming access to live product cards, prices, availability, or store offers.
You have access to a live web search tool called searchWeb. Use it when the user asks for current facts, company details, APIs, documentation, regions, pricing pages, recent news, or other information that may have changed.
Do not use web search as a workaround to extract live product prices, availability, product images, merchant offers, or purchase links.
Keep responses focused on helping the user choose the right item quickly.`,
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
