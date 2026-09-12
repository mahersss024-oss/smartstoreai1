import { evaluateForbiddenMarketplaceTerms } from './forbidden-terms';

export type ConversationMessageSafetyDecision = {
  decision: 'allow' | 'block';
  reasons: string[];
};

const offPlatformContactPatterns = [
  /(?:واتساب|واتس|whatsapp|telegram|تليجرام|سناب|snapchat)/i,
  /(?:اتصل|كلم|راسلني).{0,24}(?:رقمي|جوالي|خاص|خارج التطبيق)/i,
  /(?:خارج المنصة|خارج التطبيق|برا التطبيق|بعيد عن التطبيق)/i,
];

const directContactDetailsPatterns = [
  /(?:05|5)\d{8}/,
  /\+\s*966\s*5\d{8}/,
  /\b[^@\s]+@[^@\s]+\.[A-Za-z]{2,}\b/,
];

const externalDealPatterns = [
  /(?:تحويل|حوالة|دفعة|عربون).{0,40}(?:قبل المعاينة|خارج|واتساب|رقم|حساب)/i,
  /(?:iban|حساب بنكي|بطاقة ائتمان|credit card)/i,
];

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
    directContactDetailsPatterns.some((pattern) => pattern.test(normalized)) ||
    /(?:05|5)\d{8}/.test(compact) ||
    /\+9665\d{8}/.test(compact) ||
    /\b[^@\s]+@[^@\s]+\.[A-Za-z]{2,}\b/.test(normalized)
  );
}

export function evaluateConversationMessageSafety(
  body: string,
): ConversationMessageSafetyDecision {
  const reasons = new Set<string>();
  const forbiddenTermsDecision = evaluateForbiddenMarketplaceTerms(body);
  if (offPlatformContactPatterns.some((pattern) => pattern.test(body))) {
    reasons.add('external_contact_attempt');
  }

  if (containsDirectContactDetails(body)) {
    reasons.add('external_contact_attempt');
  }

  if (externalDealPatterns.some((pattern) => pattern.test(body))) {
    reasons.add('external_deal_or_payment_attempt');
  }

  if (forbiddenTermsDecision.decision !== 'allow') {
    reasons.add('forbidden_or_regulated_marketplace_terms');
  }

  const resolvedReasons = [...reasons];

  return {
    decision: resolvedReasons.length ? 'block' : 'allow',
    reasons: resolvedReasons,
  };
}
