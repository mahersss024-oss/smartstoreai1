export type ForbiddenTermsDecision = {
  decision: 'allow' | 'block' | 'needs_review';
  reasons: string[];
  jurisdiction: 'SA';
  shariaSensitive: boolean;
  prohibitedCategory?: string;
};

type ForbiddenTermRule = {
  category: string;
  decision: 'block' | 'needs_review';
  shariaSensitive: boolean;
  reason: string;
  priority: number;
  patterns: RegExp[];
};

const forbiddenTermRules: ForbiddenTermRule[] = [
  {
    category: 'real_weapons_or_ammunition',
    decision: 'block',
    shariaSensitive: false,
    reason: 'prohibited_in_saudi_marketplace_policy',
    priority: 100,
    patterns: [
      /(?:سلاح ناري|مسدس حقيقي|بندقية حقيقية|رشاش|كلاشنكوف|ذخيرة|رصاص حي|firearm|real gun|real pistol|rifle|live ammo|ammunition)/i,
    ],
  },
  {
    category: 'pork_or_pig_derived',
    decision: 'block',
    shariaSensitive: true,
    reason: 'prohibited_in_saudi_marketplace_policy',
    priority: 90,
    patterns: [/(?:خنزير|لحم خنزير|دهن خنزير|جيلاتين خنزير|pork|pig|lard|porcine|pork gelatin)/i],
  },
  {
    category: 'alcohol_or_intoxicants',
    decision: 'block',
    shariaSensitive: true,
    reason: 'prohibited_in_saudi_marketplace_policy',
    priority: 90,
    patterns: [/(?:خمر|خمور|مسكر|مسكرات|مشروب كحولي|ويسكي|فودكا|نبيذ|عرق|wine|whisky|vodka|alcohol|liquor|beer)/i],
  },
  {
    category: 'narcotics_or_drugs',
    decision: 'block',
    shariaSensitive: true,
    reason: 'prohibited_in_saudi_marketplace_policy',
    priority: 90,
    patterns: [/(?:مخدر|مخدرات|حشيش|كبتاجون|هيروين|كوكايين|ماريجوانا|قنب|drug|narcotic|cocaine|heroin|captagon|cannabis|marijuana)/i],
  },
  {
    category: 'gambling_or_lottery',
    decision: 'block',
    shariaSensitive: true,
    reason: 'prohibited_in_saudi_marketplace_policy',
    priority: 86,
    patterns: [/(?:قمار|مراهن|مراهنة|رهان|كازينو|يانصيب|لوتري|سحب جوائز بمقابل|تذاكر سحب|casino|betting|gambling|lottery|raffle)/i],
  },
  {
    category: 'adult_or_obscene_content',
    decision: 'block',
    shariaSensitive: true,
    reason: 'prohibited_in_saudi_marketplace_policy',
    priority: 86,
    patterns: [/(?:اباحي|إباحي|جنسي|مخل|فاحش|عاري|صور فاضحة|وسائط مخلة|محتوى مخل|sex|porn|adult toy|obscene|indecent|explicit|فاضح)/i],
  },
  {
    category: 'magic_occult_or_shirk',
    decision: 'block',
    shariaSensitive: true,
    reason: 'prohibited_in_saudi_marketplace_policy',
    priority: 84,
    patterns: [/(?:سحر|شعوذة|طلسم|تميمة|جلب الحبيب|صرف وعطف|شرك|وثن|اصنام|أصنام|تمثال معبود|عبادة الاصنام|عبادة الأصنام|magic spell|occult|sorcery|talisman|idol|idols|idolatry|shirk)/i],
  },
  {
    category: 'weapons_general',
    decision: 'block',
    shariaSensitive: false,
    reason: 'prohibited_in_saudi_marketplace_policy',
    priority: 80,
    patterns: [/(?:سلاح|مسدس|ذخيرة|رصاص|بندقية|سكين قتالي|صاعق|weapon|gun|ammo|ammunition|stun gun)/i],
  },
  {
    category: 'explosives_fireworks_or_pyrotechnics',
    decision: 'block',
    shariaSensitive: false,
    reason: 'prohibited_in_saudi_marketplace_policy',
    priority: 80,
    patterns: [/(?:متفجرات|مفرقعات|ألعاب نارية|العاب نارية|بارود|صاروخ ناري|explosive|explosives|fireworks|firecracker|pyrotechnic)/i],
  },
  {
    category: 'surveillance_or_eavesdropping',
    decision: 'block',
    shariaSensitive: false,
    reason: 'prohibited_in_saudi_marketplace_policy',
    priority: 80,
    patterns: [/(?:كاميرا مخفية|كاميرا تجسس|قلم كاميرا|ساعة كاميرا|جهاز تنصت|اجهزة تنصت|أجهزة تنصت|ميكروفون تجسس|secret camera|hidden camera|spy camera|surveillance pen|eavesdropping|wiretap|bugging device)/i],
  },
  {
    category: 'counterfeit_stolen_or_forged',
    decision: 'block',
    shariaSensitive: true,
    reason: 'prohibited_in_saudi_marketplace_policy',
    priority: 78,
    patterns: [/(?:مسروق|مقلد|تقليد درجة أولى|مزور|مزورة|عملة مزيفة|وثيقة مزورة|جواز مزور|هوية مزورة|fake|replica|stolen|counterfeit|forged|fake currency|fake document)/i],
  },
  {
    category: 'electric_shock_or_tear_gas',
    decision: 'block',
    shariaSensitive: false,
    reason: 'prohibited_in_saudi_marketplace_policy',
    priority: 76,
    patterns: [/(?:صاعق كهربائي|صواعق كهربائية|غاز مسيل للدموع|بخاخ فلفل|tear gas|pepper spray|electric shock|taser|stun device)/i],
  },
  {
    category: 'radar_detectors_or_restricted_devices',
    decision: 'block',
    shariaSensitive: false,
    reason: 'prohibited_in_saudi_marketplace_policy',
    priority: 74,
    patterns: [/(?:كاشف رادار|كاشف ساهر|جهاز كشف السرعة|رادار السرعة|speed radar detector|radar detector)/i],
  },
  {
    category: 'unregistered_sexual_or_abortion_products',
    decision: 'block',
    shariaSensitive: true,
    reason: 'prohibited_in_saudi_marketplace_policy',
    priority: 74,
    patterns: [/(?:منشط جنسي|حبوب اجهاض|حبوب إجهاض|ادوات جنسية|أدوات جنسية|اعضاء جنسية|أعضاء جنسية|sexual tonic|abortion pills|sexual device|sexual tools)/i],
  },
  {
    category: 'prohibited_food_or_plant_items',
    decision: 'block',
    shariaSensitive: false,
    reason: 'prohibited_in_saudi_marketplace_policy',
    priority: 68,
    patterns: [/(?:جوزة الطيب|بودرة جوزة الطيب|قورو|ثمرة القورو|قات|nutmeg|guru fruit|khat)/i],
  },
  {
    category: 'unlicensed_medicine_or_health_claims',
    decision: 'needs_review',
    shariaSensitive: false,
    reason: 'high_risk_or_regulated_product',
    priority: 60,
    patterns: [/(?:دواء|وصفة طبية|حبوب تنحيف|مضاد حيوي|كريم علاجي|علاج سحري|medicine|prescription|antibiotic|weight loss pills|medical cream)/i],
  },
  {
    category: 'weapon_lookalike_or_airsoft',
    decision: 'needs_review',
    shariaSensitive: false,
    reason: 'high_risk_or_regulated_product',
    priority: 82,
    patterns: [
      /(?=.*(?:مسدس|بندقية|سلاح|gun|pistol|rifle))(?=.*(?:خرز|لعبة|العاب|أطفال|اطفال|بلاستيك|ماء|هوائي|ايرسوفت|airsoft|bb|pellet|toy|plastic|water|nerf|gel blaster))/i,
    ],
  },
  {
    category: 'tobacco_or_vape',
    decision: 'needs_review',
    shariaSensitive: true,
    reason: 'high_risk_or_regulated_product',
    priority: 56,
    patterns: [/(?:دخان|تبغ|شيشة|فيب|شمة|سويكة|vape|tobacco|cigarette|chewing tobacco)/i],
  },
  {
    category: 'high_risk_financial_or_accounts',
    decision: 'needs_review',
    shariaSensitive: true,
    reason: 'high_risk_or_regulated_product',
    priority: 52,
    patterns: [/(?:حساب|اشتراك|كود|بطاقة).{0,30}(?:نتفلكس|بنك|بنكي|ائتمان|credit|bank|account)/i],
  },
  {
    category: 'media_or_publications_review',
    decision: 'needs_review',
    shariaSensitive: true,
    reason: 'high_risk_or_regulated_product',
    priority: 48,
    patterns: [/(?:كتاب ممنوع|منشورات مخالفة|مطبوعات مخالفة|وسائط غير مرخصة|قرص يحتوي مواد مخلة|banned book|unlicensed media|immoral media)/i],
  },
  {
    category: 'restricted_laser_devices',
    decision: 'needs_review',
    shariaSensitive: false,
    reason: 'high_risk_or_regulated_product',
    priority: 44,
    patterns: [/(?:ليزر قوي|قلم ليزر|laser pointer|high power laser)/i],
  },
];

export function evaluateForbiddenMarketplaceTerms(
  text: string,
): ForbiddenTermsDecision {
  const normalized = text.trim();

  if (!normalized) {
    return {
      decision: 'allow',
      reasons: [],
      jurisdiction: 'SA',
      shariaSensitive: false,
    };
  }

  const matchingRule = forbiddenTermRules
    .filter((rule) =>
      rule.patterns.some((pattern) => pattern.test(normalized)),
    )
    .sort((first, second) => {
      if (first.priority !== second.priority) {
        return second.priority - first.priority;
      }

      if (first.decision !== second.decision) {
        return first.decision === 'block' ? -1 : 1;
      }

      return 0;
    })[0];

  if (!matchingRule) {
    return {
      decision: 'allow',
      reasons: [],
      jurisdiction: 'SA',
      shariaSensitive: false,
    };
  }

  return {
    decision: matchingRule.decision,
    reasons: [matchingRule.reason],
    jurisdiction: 'SA',
    shariaSensitive: matchingRule.shariaSensitive,
    prohibitedCategory: matchingRule.category,
  };
}
