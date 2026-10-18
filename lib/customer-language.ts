export const customerLanguage = 'ar' as const;
export const customerLanguageInstructions = `All customer-facing replies must be in Arabic only, regardless of the input language, stored preferences, browser locale or requests to switch languages.
Understand customer input in any language internally, but explain results, errors, guidance and button names in Arabic. Transliterate product and provider names into Arabic in generated prose. Never output English sentences, raw internal codes or JSON to the customer. Keep functional link destinations unchanged and use Arabic link labels. This rule does not authorize changing seller-provided listing data.`;

export function resolveCustomerLanguage(requested?: unknown) {
  void requested;
  return customerLanguage;
}

export function isArabicCustomerText(text: string) {
  const prose = text
    .replaceAll('[[SMARTSTORE_GOOGLE_AUTH_REQUIRED]]', '')
    .replace(/\]\((?:https?:\/\/|\/)[^\s)]*\)/giu, ']')
    .replace(/https?:\/\/[^\s<>]+/giu, '')
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/gu, '');
  return !Array.from(prose).some(character =>
    /\p{L}/u.test(character) && !/\p{Script_Extensions=Arabic}/u.test(character));
}

export function getArabicCustomerMessage(message: unknown, fallback: string) {
  return typeof message === 'string' && message.trim() && isArabicCustomerText(message)
    ? message.trim() : fallback;
}
