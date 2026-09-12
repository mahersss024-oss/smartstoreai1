import type {
  ComplianceDecision,
  MarketplaceIntent,
  MarketplaceIntentDecision,
} from './types';
import { evaluateForbiddenMarketplaceTerms } from './forbidden-terms';

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

const intentPatterns: Array<{
  intent: MarketplaceIntent;
  reasonCode: string;
  patterns: RegExp[];
}> = [
  {
    intent: 'create_listing',
    reasonCode: 'seller_create_listing',
    patterns: [
      /(?:ابي|أبي|اريد|أريد|ابغى|أبغى|عندي|لدي).{0,40}(?:ابيع|أبيع|للبيع|اعرض|أعرض|انشر|أنشر|اعلان|إعلان)/i,
      /(?:للبيع|for sale|sell my|post an ad|create listing)/i,
    ],
  },
  {
    intent: 'update_listing',
    reasonCode: 'seller_update_listing',
    patterns: [
      /(?:عدل|عدّل|غير|غيّر|حدث|حدّث).{0,50}(?:اعلان|إعلان|السعر|الوصف|الصورة|الصور)/i,
      /(?:edit|update|change).{0,40}(?:listing|price|description|photo)/i,
    ],
  },
  {
    intent: 'delete_listing',
    reasonCode: 'seller_delete_listing',
    patterns: [/(?:احذف|حذف|delete|remove).{0,40}(?:اعلان|إعلان|listing|ad)/i],
  },
  {
    intent: 'pause_listing',
    reasonCode: 'seller_pause_listing',
    patterns: [/(?:وقف|أوقف|ايقاف|إيقاف|pause|hide).{0,40}(?:اعلان|إعلان|listing|ad)/i],
  },
  {
    intent: 'mark_sold',
    reasonCode: 'seller_mark_sold',
    patterns: [/(?:تم البيع|مباع|انشره مباع|sold)/i],
  },
  {
    intent: 'open_conversation',
    reasonCode: 'buyer_open_conversation',
    patterns: [
      /(?:تواصل|اكلم|أكلم|راسل|افتح شات|محادثة).{0,40}(?:البائع|المالك|صاحب)/i,
      /(?:contact seller|message seller|open chat)/i,
    ],
  },
  {
    intent: 'report_listing',
    reasonCode: 'user_report_listing',
    patterns: [/(?:بلاغ|ابلغ|أبلغ|مخالف|نصب|احتيال|report|scam|fraud)/i],
  },
  {
    intent: 'favorite_listing',
    reasonCode: 'buyer_favorite_listing',
    patterns: [/(?:احفظ|حفظ|مفضلة|favorite|save).{0,40}(?:اعلان|إعلان|listing|ad)/i],
  },
  {
    intent: 'compare_listings',
    reasonCode: 'buyer_compare_listings',
    patterns: [/(?:قارن|مقارنة|compare).{0,80}(?:اعلان|إعلان|منتج|سيارة|جوال|listing|product)/i],
  },
  {
    intent: 'price_listing',
    reasonCode: 'pricing_request',
    patterns: [/(?:سعر|تسعير|يسوى|كم يسوى|price|value|worth)/i],
  },
  {
    intent: 'negotiate',
    reasonCode: 'negotiation_request',
    patterns: [/(?:سوم|اسوم|أساوم|فاوض|تفاوض|عرض سعر|negotiate|offer)/i],
  },
  {
    intent: 'search_listing',
    reasonCode: 'buyer_search_listing',
    patterns: [
      /(?:ابي|أبي|اريد|أريد|ابغى|أبغى|دور|ابحث|أبحث).{0,80}(?:سيارة|جوال|ايفون|آيفون|عقار|شقة|بيت|كنب|لابتوب|بلايستيشن|منتج|اعلان|إعلان|مسدس|بندقية|سلاح|فيب|دواء|كاميرا مخفية|جهاز تنصت|كاشف رادار)/i,
      /(?:search|find|looking for|want to buy)/i,
    ],
  },
];

export function classifyMarketplaceIntent(text: string): MarketplaceIntentDecision {
  const normalized = text.trim();

  for (const rule of intentPatterns) {
    if (rule.patterns.some((pattern) => pattern.test(normalized))) {
      return {
        intent: rule.intent,
        requiresAuth: executableIntents.has(rule.intent),
        requiresConfirmation: confirmationIntents.has(rule.intent),
        reasonCode: rule.reasonCode,
      };
    }
  }

  return {
    intent: 'general_info',
    requiresAuth: false,
    requiresConfirmation: false,
    reasonCode: 'general_marketplace_info',
  };
}

export function evaluateSaudiMarketplaceCompliance(text: string): ComplianceDecision {
  return evaluateForbiddenMarketplaceTerms(text);
}

export function getAuthRequiredResponse(language: 'ar' | 'en') {
  return language === 'en'
    ? '[[SMARTSTORE_GOOGLE_AUTH_REQUIRED]] Sign in with Google or Apple first to use SmartStore AI chat and continue marketplace assistance.'
    : '[[SMARTSTORE_GOOGLE_AUTH_REQUIRED]] سجّل دخولك عبر Google أو Apple أولًا لاستخدام مساعد SmartStore AI ومتابعة خدمات السوق.';
}

export function getComplianceBlockResponse(language: 'ar' | 'en') {
  return language === 'en'
    ? 'Sorry, this listing cannot be created because it conflicts with Saudi marketplace rules or Islamic values. I can help you list another allowed product.'
    : 'عذرًا، لا يمكن إنشاء هذا الإعلان لأنه يخالف سياسات السوق في السعودية أو القيم الإسلامية. أقدر أساعدك في عرض منتج آخر مسموح.';
}

export function getComplianceReviewResponse(language: 'ar' | 'en') {
  return language === 'en'
    ? 'This product may need manual review before publishing because it could be regulated or sensitive in Saudi Arabia. Share clearer details and I will prepare it for review instead of publishing directly.'
    : 'هذا المنتج قد يحتاج مراجعة قبل النشر لأنه قد يكون منظمًا أو حساسًا في السعودية. أعطني تفاصيل أوضح وسأجهزه للمراجعة بدل النشر المباشر.';
}
