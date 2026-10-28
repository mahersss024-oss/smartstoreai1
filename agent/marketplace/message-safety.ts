export type ConversationMessageSafetyDecision = {
  decision: 'allow' | 'block';
  reasons: string[];
};

const arabicDigitMap: Record<string, string> = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
};

function normalizeDigits(value: string) {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => arabicDigitMap[digit] ?? digit);
}

export function containsDirectContactDetails(body: string) {
  const normalized = normalizeDigits(body);
  const compact = normalized.replace(/[\s().-]/g, '');

  return (
    /(?:05|5)\d{8}/.test(compact) ||
    /\+9665\d{8}/.test(compact) ||
    /\b[^@\s]+@[^@\s]+\.[A-Za-z]{2,}\b/.test(normalized)
  );
}

export function evaluateConversationMessageSafety(
  body: string,
): ConversationMessageSafetyDecision {
  // Ownership, conversation blocks and content limits are enforced by the caller.
  // Buyer/seller messages do not wait for Hamad's advisory models.
  void body;
  return { decision: 'allow', reasons: [] };
}
