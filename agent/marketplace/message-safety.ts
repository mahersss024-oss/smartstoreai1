export type ConversationMessageSafetyDecision = {
  decision: 'allow' | 'block';
  reasons: string[];
};

const externalContactPatterns = [
  /(?:05|5)\d{8}/,
  /\+\s*966\s*5\d{8}/,
  /(?:واتساب|واتس|whatsapp|telegram|تليجرام|سناب|snapchat)/i,
  /(?:اتصل|كلم|راسلني).{0,24}(?:رقمي|جوالي|خاص|خارج التطبيق)/i,
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
];

const externalDealPatterns = [
  /(?:خارج المنصة|خارج التطبيق|برا التطبيق|بعيد عن التطبيق)/i,
  /(?:تحويل|حوالة|دفعة|عربون).{0,40}(?:قبل المعاينة|خارج|واتساب|رقم|حساب)/i,
  /(?:iban|حساب بنكي|بطاقة ائتمان|credit card)/i,
];

export function evaluateConversationMessageSafety(
  body: string,
): ConversationMessageSafetyDecision {
  const reasons: string[] = [];

  if (externalContactPatterns.some((pattern) => pattern.test(body))) {
    reasons.push('external_contact_attempt');
  }

  if (externalDealPatterns.some((pattern) => pattern.test(body))) {
    reasons.push('external_deal_or_payment_attempt');
  }

  return {
    decision: reasons.length ? 'block' : 'allow',
    reasons,
  };
}
