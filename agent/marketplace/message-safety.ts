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

const inspectionCoordinationPatterns = [
  /(?:معاينة|فحص|تجربة|موعد|نتقابل|مكان عام|inspection|meeting|viewing)/i,
];

const externalDealPatterns = [
  /(?:تحويل|حوالة|دفعة|عربون).{0,40}(?:قبل المعاينة|خارج|واتساب|رقم|حساب)/i,
  /(?:iban|حساب بنكي|بطاقة ائتمان|credit card)/i,
];

export function evaluateConversationMessageSafety(
  body: string,
): ConversationMessageSafetyDecision {
  const reasons = new Set<string>();
  const forbiddenTermsDecision = evaluateForbiddenMarketplaceTerms(body);
  const hasInspectionIntent = inspectionCoordinationPatterns.some((pattern) =>
    pattern.test(body),
  );

  if (offPlatformContactPatterns.some((pattern) => pattern.test(body))) {
    reasons.add('external_contact_attempt');
  }

  if (
    directContactDetailsPatterns.some((pattern) => pattern.test(body)) &&
    !hasInspectionIntent
  ) {
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
