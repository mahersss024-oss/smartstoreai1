import {
  findArabicRootMatch,
  normalizeArabicDisplayText,
  type ArabicRootOptions,
} from './arabic-word-match';
import {
  isDerivedColorWord,
  resolveAmbiguousRootContext,
} from './context-allowlist';

export type ForbiddenTermsDecision = {
  decision: 'allow' | 'block' | 'needs_review';
  reasons: string[];
  jurisdiction: 'SA';
  shariaSensitive: boolean;
  prohibitedCategory?: string;
};

type ForbiddenRoot = {
  /** Arabic root matched as a whole word, never as a substring. */
  root: string;
  options?: ArabicRootOptions;
  /**
   * When true, the root shares its spelling with an allowed meaning and the
   * decision is resolved by surrounding context words (e.g. "حشيش").
   */
  ambiguous?: boolean;
};

type ForbiddenTermRule = {
  category: string;
  decision: 'block' | 'needs_review';
  shariaSensitive: boolean;
  reason: string;
  priority: number;
  /** Phrase or boundary-aware patterns. */
  patterns: RegExp[];
  /** Single Arabic roots matched on word boundaries. */
  roots?: ForbiddenRoot[];
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
    patterns: [/(?:لحم خنزير|دهن خنزير|جيلاتين خنزير|pork|pig|lard|porcine|pork gelatin)/i],
    roots: [{ root: 'خنزير' }, { root: 'خنازير' }],
  },
  {
    category: 'alcohol_or_intoxicants',
    decision: 'block',
    shariaSensitive: true,
    reason: 'prohibited_in_saudi_marketplace_policy',
    priority: 90,
    patterns: [/(?:مشروب كحولي|ويسكي|فودكا|نبيذ|wine|whisky|vodka|alcohol|liquor|beer)/i],
    roots: [
      // "خمر" (wine) vs "خمري" (a color): the adjectival suffix "ي" forms a
      // color, so it is blocked for this root only.
      { root: 'خمر', options: { blockedSuffixes: ['ي', 'ية', 'يه'] } },
      { root: 'خمور' },
      // "كحول"/"كحولي" (alcohol as a material) vs an alcoholic drink: resolved
      // by context so perfumes and cosmetics ("عطر خالي من الكحول") stay allowed.
      { root: 'كحول', ambiguous: true },
      { root: 'كحولي', ambiguous: true },
      { root: 'كحوليات' },
      // "مسكر"/"مسكرات" (intoxicant) must not match "مسكرة" (mascara), so the
      // feminine suffixes "ة"/"ه" are blocked for this root only.
      { root: 'مسكر', options: { blockedSuffixes: ['ة', 'ه', 'يتين'] } },
      { root: 'مسكرات' },
      // "عرق" (a spirit) is also sweat / deodorant / sciatica, so it is resolved
      // by context. The definite article prefix is disabled so it never matches
      // "العراق" (a country).
      { root: 'عرق', options: { allowLeadingAl: false }, ambiguous: true },
    ],
  },
  {
    category: 'narcotics_or_drugs',
    decision: 'block',
    shariaSensitive: true,
    reason: 'prohibited_in_saudi_marketplace_policy',
    priority: 90,
    patterns: [/(?:كبتاجون|هيروين|كوكايين|ماريجوانا|drug|narcotic|cocaine|heroin|captagon|cannabis|marijuana)/i],
    roots: [
      { root: 'مخدر' },
      { root: 'مخدرات' },
      { root: 'قنب' },
      // "حشيش" (marijuana) vs "حشيش" (animal fodder): resolved by context.
      { root: 'حشيش', ambiguous: true },
    ],
  },
  {
    category: 'gambling_or_lottery',
    decision: 'block',
    shariaSensitive: true,
    reason: 'prohibited_in_saudi_marketplace_policy',
    priority: 86,
    patterns: [/(?:كازينو|يانصيب|لوتري|سحب جوائز بمقابل|تذاكر سحب|casino|betting|gambling|lottery|raffle)/i],
    roots: [
      { root: 'قمار' },
      { root: 'مراهن' },
      { root: 'مراهنة' },
      { root: 'رهان' },
    ],
  },
  {
    category: 'adult_or_obscene_content',
    decision: 'block',
    shariaSensitive: true,
    reason: 'prohibited_in_saudi_marketplace_policy',
    priority: 86,
    patterns: [/(?:صور فاضحة|وسائط مخلة|محتوى مخل|sex|porn|adult toy|obscene|indecent|explicit)/i],
    roots: [
      { root: 'اباحي' },
      { root: 'إباحي' },
      { root: 'جنسي' },
      { root: 'مخل' },
      { root: 'فاحش' },
      { root: 'فاضح' },
      { root: 'عاري' },
    ],
  },
  {
    category: 'magic_occult_or_shirk',
    decision: 'block',
    shariaSensitive: true,
    reason: 'prohibited_in_saudi_marketplace_policy',
    priority: 84,
    patterns: [/(?:جلب الحبيب|صرف وعطف|تمثال معبود|عبادة الاصنام|عبادة الأصنام|magic spell|occult|sorcery|talisman|idolatry)/i],
    roots: [
      { root: 'سحر' },
      { root: 'شعوذة' },
      { root: 'طلسم' },
      { root: 'تميمة' },
      // "شرك" (shirk) must not match "شركة" (company): the feminine suffix
      // forms a different word, so it is blocked for this root only.
      { root: 'شرك', options: { blockedSuffixes: ['ه', 'ية', 'يه', 'ات'] } },
      { root: 'وثن' },
      { root: 'اصنام' },
      { root: 'أصنام' },
      { root: 'idol' },
      { root: 'idols' },
      { root: 'shirk' },
    ],
  },
  {
    category: 'weapons_general',
    decision: 'block',
    shariaSensitive: false,
    reason: 'prohibited_in_saudi_marketplace_policy',
    priority: 80,
    patterns: [/(?:سكين قتالي|weapon|gun|ammo|ammunition|stun gun)/i],
    roots: [
      { root: 'سلاح' },
      { root: 'مسدس' },
      { root: 'ذخيرة' },
      { root: 'بندقية' },
      { root: 'صاعق' },
      { root: 'رصاصة' },
      // "رصاص" (ammunition) must not match "رصاصي" (a color): the adjectival
      // suffix forms a different word, so it is blocked for this root only.
      { root: 'رصاص', options: { blockedSuffixes: ['ي', 'ية', 'يه', 'يات'] } },
    ],
  },
  {
    category: 'explosives_fireworks_or_pyrotechnics',
    decision: 'block',
    shariaSensitive: false,
    reason: 'prohibited_in_saudi_marketplace_policy',
    priority: 80,
    patterns: [/(?:ألعاب نارية|العاب نارية|صاروخ ناري|explosive|explosives|fireworks|firecracker|pyrotechnic)/i],
    roots: [{ root: 'متفجرات' }, { root: 'مفرقعات' }, { root: 'بارود' }],
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
    patterns: [/(?:تقليد درجة أولى|عملة مزيفة|وثيقة مزورة|جواز مزور|هوية مزورة|fake|replica|stolen|counterfeit|forged|fake currency|fake document)/i],
    roots: [
      { root: 'مسروق' },
      { root: 'مقلد' },
      { root: 'مزور' },
      { root: 'مزورة' },
    ],
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
    patterns: [/(?:جوزة الطيب|بودرة جوزة الطيب|ثمرة القورو|nutmeg|guru fruit|khat)/i],
    roots: [{ root: 'قورو' }, { root: 'قات' }],
  },
  {
    category: 'unlicensed_medicine_or_health_claims',
    decision: 'needs_review',
    shariaSensitive: false,
    reason: 'high_risk_or_regulated_product',
    priority: 60,
    patterns: [/(?:وصفة طبية|حبوب تنحيف|مضاد حيوي|كريم علاجي|علاج سحري|medicine|prescription|antibiotic|weight loss pills|medical cream)/i],
    roots: [{ root: 'دواء' }],
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
    patterns: [/(?:شيشة|فيب|شمة|سويكة|vape|tobacco|cigarette|chewing tobacco)/i],
    roots: [
      // "دخان" (tobacco) vs physical smoke (exhaust, fire, grill): resolved by
      // context so "لحم مدخن" and "سيارة تدخن" are not treated as tobacco.
      { root: 'دخان', ambiguous: true },
      { root: 'تبغ' },
      { root: 'سيجارة' },
      { root: 'سيجاره' },
      { root: 'سجائر' },
      { root: 'سيجار' },
      // Shisha tobacco and chewing tobacco products.
      { root: 'معسل' },
      { root: 'معسلات' },
      { root: 'تنباك' },
      // "شمة" (snuff/chewing tobacco) — both the taa-marbuta and haa spellings.
      { root: 'شمة' },
      { root: 'شمه' },
      { root: 'سويكة' },
      { root: 'سويكه' },
    ],
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

function matchesRoot(entry: ForbiddenRoot, text: string) {
  const matchedWord = findArabicRootMatch(text, entry.root, entry.options);

  if (!matchedWord) {
    return false;
  }

  // A derived color built on a forbidden root (e.g. "خمري", "رصاصي") is a
  // color adjective, not the product itself.
  if (isDerivedColorWord(matchedWord)) {
    return false;
  }

  // Ambiguous roots (e.g. "حشيش") depend on surrounding context words.
  if (entry.ambiguous) {
    const context = resolveAmbiguousRootContext(
      normalizeArabicDisplayText(text),
      entry.root,
    );

    return context !== 'allowed';
  }

  return true;
}

function ruleMatches(rule: ForbiddenTermRule, text: string) {
  const normalizedText = normalizeArabicDisplayText(text);

  // Patterns run against both the raw text and the normalized text so phrase
  // rules (e.g. "مشروب كحولي", "ويسكي") still match when the user evades with
  // separators such as "و-ي-س-ك-ي".
  if (
    rule.patterns.some(
      (pattern) => pattern.test(text) || pattern.test(normalizedText),
    )
  ) {
    return true;
  }

  return rule.roots?.some((entry) => matchesRoot(entry, text)) ?? false;
}

/**
 * Returns the ambiguous roots that are present in the text but whose context is
 * not decisive. Used only by the optional chat-layer semantic resolver; the
 * deterministic layer already treats them as blocked by default.
 */
export function findAmbiguousForbiddenRoots(text: string) {
  const normalizedText = normalizeArabicDisplayText(text);
  const seen = new Set<string>();
  const result: string[] = [];

  for (const rule of forbiddenTermRules) {
    for (const entry of rule.roots ?? []) {
      if (!entry.ambiguous || seen.has(entry.root)) {
        continue;
      }

      const matchedWord = findArabicRootMatch(text, entry.root, entry.options);

      if (!matchedWord || isDerivedColorWord(matchedWord)) {
        continue;
      }

      if (
        resolveAmbiguousRootContext(normalizedText, entry.root) === 'unknown'
      ) {
        seen.add(entry.root);
        result.push(entry.root);
      }
    }
  }

  return result;
}

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
    .filter((rule) => ruleMatches(rule, normalized))
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
