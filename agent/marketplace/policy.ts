import type {
  ComplianceDecision,
  MarketplaceIntent,
  MarketplaceIntentDecision,
} from './types';
import { marketplaceTextAnalyzer } from './text-understanding';

const executableIntents = new Set<MarketplaceIntent>([
  'create_listing',
  'update_listing',
  'delete_listing',
  'pause_listing',
  'mark_sold',
  'open_conversation',
  'send_message',
  'favorite_listing',
  'report_listing',
  'negotiate',
]);

const confirmationIntents = new Set<MarketplaceIntent>([
  'create_listing',
  'update_listing',
  'delete_listing',
  'pause_listing',
  'mark_sold',
  'open_conversation',
  'send_message',
  'report_listing',
  'negotiate',
]);

export function classifyMarketplaceIntent(text: string): MarketplaceIntentDecision {
  const intent = marketplaceTextAnalyzer.peek(text)?.intent ?? 'general_info';
  return {
    intent,
    requiresAuth: executableIntents.has(intent),
    requiresConfirmation: confirmationIntents.has(intent),
    reasonCode: 'model_marketplace_intent',
  };
}

/** Marketplace writes do not run content models; Hamad opts into its own assessment. */
export function createUnassessedMarketplaceCompliance(): ComplianceDecision {
  return { decision: 'allow', reasons: [], jurisdiction: 'SA', shariaSensitive: false };
}

export function evaluateSaudiMarketplaceCompliance(text: string): ComplianceDecision {
  const result = marketplaceTextAnalyzer.peek(text);
  return result
    ? { ...result.compliance, decision: 'allow', modelAssessment: { decision: result.compliance.decision, reasons: result.compliance.reasons }, jurisdiction: 'SA', checkStatus: 'completed' }
    : { decision: 'allow', modelAssessment: { decision: 'needs_review', reasons: ['text_analysis_unavailable'], unavailable: true }, checkStatus: 'unavailable', reasons: ['text_analysis_unavailable'], jurisdiction: 'SA', shariaSensitive: false };
}

export function evaluateListingComplianceBestEffort(
  text: string,
  evaluate = evaluateSaudiMarketplaceCompliance,
): ComplianceDecision {
  try {
    return evaluate(text);
  } catch (error) {
    console.warn(`[listing_compliance] failure=${error instanceof Error ? error.name : 'UnknownError'}`);
    return {
      decision: 'allow', modelAssessment: { decision: 'needs_review', reasons: ['listing_compliance_unavailable'], unavailable: true }, checkStatus: 'unavailable', reasons: ['listing_compliance_unavailable'],
      jurisdiction: 'SA', shariaSensitive: false,
    };
  }
}

export function getAuthRequiredResponse(language: 'ar' | 'en') {
  void language;
  return '[[SMARTSTORE_GOOGLE_AUTH_REQUIRED]] سجّل دخولك عبر جوجل أو آبل أولًا لاستخدام مساعد سوق حمد ومتابعة خدمات السوق.';
}

export function getComplianceBlockResponse(language: 'ar' | 'en') {
  void language;
  return 'عذرًا، لا يمكن إنشاء هذا الإعلان لأنه يخالف سياسات السوق في السعودية أو القيم الإسلامية. أقدر أساعدك في عرض منتج آخر مسموح.';
}

export function getComplianceReviewResponse(language: 'ar' | 'en') {
  void language;
  return 'هذا المنتج قد يحتاج مراجعة قبل النشر لأنه قد يكون منظمًا أو حساسًا في السعودية. أعطني تفاصيل أوضح وسأجهزه للمراجعة بدل النشر المباشر.';
}
