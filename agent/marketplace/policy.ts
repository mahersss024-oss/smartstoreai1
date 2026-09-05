import type {
  ComplianceDecision,
  MarketplaceIntent,
  MarketplaceIntentDecision,
} from './types';

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
      /(?:ابي|أبي|اريد|أريد|ابغى|أبغى|دور|ابحث|أبحث).{0,80}(?:سيارة|جوال|ايفون|آيفون|عقار|شقة|بيت|كنب|لابتوب|بلايستيشن|منتج|اعلان|إعلان)/i,
      /(?:search|find|looking for|want to buy)/i,
    ],
  },
];

const blockedProductRules: Array<{
  category: string;
  shariaSensitive: boolean;
  patterns: RegExp[];
}> = [
  {
    category: 'pork_or_pig_derived',
    shariaSensitive: true,
    patterns: [/(?:خنزير|لحم خنزير|دهن خنزير|جيلاتين خنزير|pork|pig|lard|porcine|pork gelatin)/i],
  },
  {
    category: 'alcohol',
    shariaSensitive: true,
    patterns: [/(?:خمر|خمور|مسكر|مشروب كحولي|ويسكي|فودكا|wine|whisky|vodka|alcohol)/i],
  },
  {
    category: 'drugs',
    shariaSensitive: true,
    patterns: [/(?:مخدر|حشيش|كبتاجون|هيروين|كوكايين|drug|cocaine|heroin|captagon)/i],
  },
  {
    category: 'gambling',
    shariaSensitive: true,
    patterns: [/(?:قمار|مراهن|رهان|كازينو|casino|betting|gambling)/i],
  },
  {
    category: 'lottery_or_raffle',
    shariaSensitive: true,
    patterns: [/(?:يانصيب|لوتري|سحب جوائز بمقابل|تذاكر سحب|lottery|raffle)/i],
  },
  {
    category: 'adult_content',
    shariaSensitive: true,
    patterns: [/(?:اباحي|إباحي|جنسي|مخل|فاحش|عاري|صور فاضحة|sex|porn|adult toy|obscene|indecent|فاضح)/i],
  },
  {
    category: 'magic_occult',
    shariaSensitive: true,
    patterns: [/(?:سحر|شعوذة|طلسم|تميمة|جلب الحبيب|صرف وعطف|magic spell|occult|sorcery|talisman)/i],
  },
  {
    category: 'shirk_or_offensive_religious_items',
    shariaSensitive: true,
    patterns: [/(?:شرك|وثن|اصنام|أصنام|تمثال معبود|عبادة الاصنام|عبادة الأصنام|idol|idols|idolatry|shirk)/i],
  },
  {
    category: 'real_weapons_or_ammunition',
    shariaSensitive: false,
    patterns: [
      /(?:سلاح ناري|مسدس حقيقي|بندقية حقيقية|رشاش|كلاشنكوف|ذخيرة|رصاص حي|firearm|real gun|real pistol|rifle|live ammo|ammunition)/i,
    ],
  },
  {
    category: 'weapons',
    shariaSensitive: false,
    patterns: [/(?:سلاح|مسدس|ذخيرة|رصاص|بندقية|سكين قتالي|صاعق|weapon|gun|ammo|ammunition|stun gun)/i],
  },
  {
    category: 'explosives_or_fireworks',
    shariaSensitive: false,
    patterns: [/(?:متفجرات|مفرقعات|ألعاب نارية|العاب نارية|بارود|explosive|explosives|fireworks|firecracker)/i],
  },
  {
    category: 'secret_surveillance',
    shariaSensitive: false,
    patterns: [/(?:كاميرا مخفية|كاميرا تجسس|قلم كاميرا|ساعة كاميرا|secret camera|hidden camera|spy camera|surveillance pen)/i],
  },
  {
    category: 'unlicensed_medicine',
    shariaSensitive: false,
    patterns: [/(?:دواء|وصفة طبية|حبوب تنحيف|منشط|مضاد حيوي|medicine|prescription|antibiotic)/i],
  },
  {
    category: 'counterfeit_or_stolen',
    shariaSensitive: true,
    patterns: [/(?:مسروق|مقلد|تقليد درجة أولى|مزور|عملة مزيفة|وثيقة مزورة|fake|replica|stolen|counterfeit|forged|fake currency|fake document)/i],
  },
];

const reviewProductRules: Array<{
  category: string;
  shariaSensitive: boolean;
  patterns: RegExp[];
}> = [
  {
    category: 'weapon_lookalike_or_airsoft',
    shariaSensitive: false,
    patterns: [
      /(?=.*(?:مسدس|بندقية|سلاح|gun|pistol|rifle))(?=.*(?:خرز|لعبة|العاب|أطفال|اطفال|بلاستيك|ماء|هوائي|ايرسوفت|airsoft|bb|pellet|toy|plastic|water|nerf|gel blaster))/i,
    ],
  },
  {
    category: 'tobacco_or_vape',
    shariaSensitive: true,
    patterns: [/(?:دخان|تبغ|شيشة|فيب|vape|tobacco|cigarette)/i],
  },
  {
    category: 'high_risk_financial_or_accounts',
    shariaSensitive: true,
    patterns: [/(?:حساب|اشتراك|كود|بطاقة).{0,30}(?:نتفلكس|بنك|بنكي|ائتمان|credit|bank|account)/i],
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
  const normalized = text.trim();
  const hardBlockedRules = blockedProductRules.filter((rule) => rule.category === 'real_weapons_or_ammunition');
  const regularBlockedRules = blockedProductRules.filter((rule) => rule.category !== 'real_weapons_or_ammunition');

  for (const rule of hardBlockedRules) {
    if (rule.patterns.some((pattern) => pattern.test(normalized))) {
      return {
        decision: 'block',
        reasons: ['prohibited_in_saudi_marketplace_policy'],
        jurisdiction: 'SA',
        shariaSensitive: rule.shariaSensitive,
        prohibitedCategory: rule.category,
      };
    }
  }

  for (const rule of reviewProductRules) {
    if (rule.patterns.some((pattern) => pattern.test(normalized))) {
      return {
        decision: 'needs_review',
        reasons: ['high_risk_or_regulated_product'],
        jurisdiction: 'SA',
        shariaSensitive: rule.shariaSensitive,
        prohibitedCategory: rule.category,
      };
    }
  }

  for (const rule of regularBlockedRules) {
    if (rule.patterns.some((pattern) => pattern.test(normalized))) {
      return {
        decision: 'block',
        reasons: ['prohibited_in_saudi_marketplace_policy'],
        jurisdiction: 'SA',
        shariaSensitive: rule.shariaSensitive,
        prohibitedCategory: rule.category,
      };
    }
  }

  return {
    decision: 'allow',
    reasons: [],
    jurisdiction: 'SA',
    shariaSensitive: false,
  };
}

export function getAuthRequiredResponse(language: 'ar' | 'en') {
  return language === 'en'
    ? '[[SMARTSTORE_GOOGLE_AUTH_REQUIRED]] To continue this marketplace action, sign in with Google first. You can still ask questions and browse without signing in.'
    : '[[SMARTSTORE_GOOGLE_AUTH_REQUIRED]] لإكمال هذه العملية في السوق، سجّل دخولك عبر Google أولًا. تقدر تستمر في السؤال والتصفح بدون تسجيل.';
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
