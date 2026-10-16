import type { MarketplaceCategoryId } from './categories';

export type MarketplaceCategoryRule = {
  category: MarketplaceCategoryId;
  patterns: RegExp[];
  stopWords: string[];
};

const additionalGoodsRules: MarketplaceCategoryRule[] = [
  { category: 'home_appliances', patterns: [/(?:أجهزة منزلية|اجهزة منزلية|ثلاجة|ثلاجه|غسالة|غساله|مكيف|قلاية|قلايه|غلاية|غلايه|مكنسة|مكنسه|ميكرويف|مايكرويف|عجانة|خلاط|(?:^|\s)(?:فرن|أفران|افران)(?=\s|$)|بوتاجاز|آلة قهوة|الة قهوة|ماكينة قهوة|مكينة قهوة|\b(?:appliances?|fridge|refrigerator|washer|washing machine|air conditioner|air fryer|kettle|vacuum|microwave|oven|coffee machine)\b)/i], stopWords: [] },
  { category: 'tablets', patterns: [/(?:أجهزة لوحية|اجهزة لوحية|جهاز لوحي|ايباد|آيباد|تابلت|\b(?:ipad|tablets?)\b)/i], stopWords: [] },
  { category: 'tv_audio', patterns: [/(?:تلفزيون|تلفاز|تلفزيونات|صوتيات|مسرح منزلي|سماعات|مكبر صوت|\b(?:television|tv|speakers?|soundbar|home theater|headphones?)\b)/i], stopWords: [] },
  { category: 'networking', patterns: [/(?:راوتر|مودم|مقوي شبكة|مقوي واي فاي|معدات شبكات|الشبكات والاتصالات|\b(?:router|modem|network switch|wifi extender)\b)/i], stopWords: [] },
  { category: 'motorcycles', patterns: [/(?:دباب|دراجة نارية|دراجات نارية|الدراجات النارية|\b(?:motorcycles?|motorbikes?|scooters?)\b)/i], stopWords: [] },
  { category: 'heavy_equipment', patterns: [/(?:شاحنة|شاحنات|معدات ثقيلة|حفار|رافعة|قلاب|\b(?:trucks?|excavator|forklift|heavy equipment|trailers?)\b)/i], stopWords: [] },
  { category: 'agriculture', patterns: [/(?:شتلات|شتلة|بذور|نباتات|معدات زراعية|شبكة ري|الزراعة والنباتات|\b(?:seedlings?|seeds?|plants?|irrigation|agriculture)\b)/i], stopWords: [] },
  { category: 'animals', patterns: [/(?:مواشي|أغنام|اغنام|ماعز|خروف|(?:^|\s)(?:إبل|ابل|قطة)(?=\s|$)|حيوانات|طيور|قطط|اعلاف|أعلاف|\b(?:livestock|sheep|goats?|camels?|pets?|cats?|birds?|animal feed)\b)/i], stopWords: [] },
  { category: 'camping', patterns: [/(?:خيمة|خيمه|خيام|تخييم|عدة رحلات|معدات رحلات|الرحلات والتخييم|\b(?:camping|tents?|camping gear)\b)/i], stopWords: [] },
  { category: 'food', patterns: [/(?:تمور|عسل|حلويات|شوكولاتة|شوكولاته|مواد غذائية|اطعمة|أطعمة|مشروبات|\b(?:food|beverages?|honey|chocolates?|sweets?|dates)\b)/i], stopWords: [] },
  { category: 'antiques', patterns: [/(?:نوادر|تراثيات|مقتنيات تراثية|قطع تراثية|\b(?:antiques?|collectibles?|vintage collectibles)\b)/i], stopWords: [] },
  { category: 'arts', patterns: [/(?:أدوات رسم|ادوات رسم|لوحات فنية|لوحة فنية|مستلزمات رسم|الفنون ومستلزماتها|\b(?:art supplies|painting supplies|artwork|canvas)\b)/i], stopWords: [] },
];

// Existing search phrases retain their precedence and token handling.

const legacySearchRules: Array<{
  category: MarketplaceCategoryId;
  patterns: RegExp[];
  stopWords: string[];
}> = [
  {
    category: 'cars',
    patterns: [
      /(?:سيارة|سيارات|موتر|سياره|مواتر|كامري|كورولا|يارس|تويوتا|تايوتا|نيسان|هوندا|هيونداي|كيا|مازدا|لكزس|مرسيدس|car|cars|toyota|camry|corolla|sedan|suv)/i,
    ],
    stopWords: ['سيارة', 'سيارات', 'سياره', 'موتر', 'مواتر', 'car', 'cars'],
  },
  {
    category: 'mobile_phones',
    patterns: [/(?:جوال|جوالات|هاتف|ايفون|آيفون|سامسونج|iphone|samsung|phone|mobile)/i],
    stopWords: ['جوال', 'جوالات', 'هاتف', 'phone', 'mobile'],
  },
  {
    category: 'computers',
    patterns: [/(?:لابتوب|لاب توب|كمبيوتر|ماكبوك|macbook|laptop|computer)/i],
    stopWords: ['لابتوب', 'كمبيوتر', 'laptop', 'computer'],
  },
  {
    category: 'cameras',
    patterns: [/(?:كاميرا|كاميره|كاميرات|كانون|نيكون|فوجي|سوني الفا|camera|cameras|canon|nikon|fujifilm|sony alpha)/i],
    stopWords: ['كاميرا', 'كاميره', 'كاميرات', 'camera', 'cameras'],
  },
  {
    category: 'real_estate',
    patterns: [/(?:عقار|شقة|فيلا|بيت|ارض|أرض|real estate|apartment|villa|house)/i],
    stopWords: ['عقار', 'شقة', 'فيلا', 'بيت', 'ارض', 'أرض'],
  },
  {
    category: 'furniture',
    patterns: [/(?:اثاث|أثاث|كنب|كرسي|طاولة|furniture|chair|table|sofa)/i],
    stopWords: ['اثاث', 'أثاث', 'furniture'],
  },
  {
    category: 'women_supplies',
    patterns: [/(?:مستلزمات نسائية|نسائي|نسائية|حريمي|عباية|عبايات|طرحة|حجاب|women supplies|women|female|ladies|abaya|hijab)/i],
    stopWords: ['مستلزمات', 'نسائية', 'نسائي', 'حريمي', 'women', 'female', 'ladies'],
  },
  {
    category: 'men_supplies',
    patterns: [/(?:مستلزمات رجالية|رجالي|رجالية|شماغ|غترة|عقال|men supplies|men|male|mens|shemagh|ghutra)/i],
    stopWords: ['مستلزمات', 'رجالية', 'رجالي', 'men', 'male', 'mens'],
  },
  {
    category: 'fashion',
    patterns: [/(?:ملابس|ثوب|حذاء|فستان|شنطة|fashion|clothes|shoes|dress|bag)/i],
    stopWords: ['ملابس', 'ثوب', 'حذاء', 'فستان', 'شنطة', 'fashion', 'clothes', 'shoes'],
  },
];

const legacyVisionRules: Array<{
  category: MarketplaceCategoryId;
  patterns: RegExp[];
}> = [
  {
    category: 'cars',
    patterns: [
      /(?:سيارة|سيارات|موتر|كامري|كورولا|يارس|لاندكروزر|نيسان|هوندا|هيونداي|كيا|مازدا|لكزس|مرسيدس|بي ام|car|cars|toyota|camry|corolla|sedan|suv)/i,
    ],
  },
  {
    category: 'auto_parts',
    patterns: [/(?:قطع غيار|كفرات|جنوط|بطارية سيارة|مكينة|قير|صدام|auto parts|spare parts|tires|engine|gearbox)/i],
  },
  {
    category: 'mobile_phones',
    patterns: [/(?:جوال|جوالات|هاتف|ايفون|آيفون|سامسونج|هواوي|شاومي|iphone|samsung|phone|mobile)/i],
  },
  {
    category: 'computers',
    patterns: [/(?:لابتوب|لاب توب|كمبيوتر|ماكبوك|شاشة|كيبورد|طابعة|macbook|laptop|computer|pc|monitor|keyboard|printer)/i],
  },
  {
    category: 'cameras',
    patterns: [/(?:كاميرا|كاميره|كاميرات|كانون|نيكون|فوجي|سوني الفا|camera|cameras|canon|nikon|fujifilm|sony alpha)/i],
  },
  {
    category: 'real_estate',
    patterns: [/(?:عقار|شقة|فيلا|بيت|أرض|ارض|استراحة|real estate|apartment|villa|house|land)/i],
  },
  {
    category: 'furniture',
    patterns: [/(?:أثاث|اثاث|كنب|كرسي|طاولة|سرير|دولاب|furniture|chair|table|sofa|bed|wardrobe)/i],
  },
  {
    category: 'women_supplies',
    patterns: [/(?:مستلزمات نسائية|نسائي|نسائية|حريمي|عباية|عبايات|طرحة|طرح|حجاب|women supplies|women|female|ladies|abaya|hijab)/i],
  },
  {
    category: 'men_supplies',
    patterns: [/(?:مستلزمات رجالية|رجالي|رجالية|ثوب رجالي|شماغ|غترة|عقال|men supplies|men|male|mens|thobe|shemagh|ghutra)/i],
  },
  {
    category: 'fashion',
    patterns: [/(?:ملابس|ثوب|شماغ|حذاء|فستان|شنطة|fashion|clothes|shoes|dress|bag)/i],
  },
  {
    category: 'home_garden',
    patterns: [/(?:منزل|حديقة|مطبخ|مكنسة|ثلاجة|غسالة|مكيف|\b(?:home|garden|kitchen|vacuum|fridge|washer|ac)\b)/i],
  },
  {
    category: 'sports',
    patterns: [/(?:رياضة|دراجة|جهاز مشي|أوزان|اوزان|sports|bicycle|treadmill|weights)/i],
  },
  {
    category: 'gaming_hobbies',
    patterns: [/(?:بلايستيشن|اكس بوكس|نينتندو|لعبة|العاب|هواية|playstation|xbox|nintendo|game|gaming|hobby)/i],
  },
  {
    category: 'books_education',
    patterns: [/(?:كتاب|كتب|تعليم|مدرسي|جامعة|book|books|education|school|university)/i],
  },
  {
    category: 'kids',
    patterns: [/(?:طفل|أطفال|اطفال|عربة أطفال|كرسي طفل|kids|baby|stroller|child seat)/i],
  },
  {
    category: 'tools_equipment',
    patterns: [/(?:عدة|أدوات|ادوات|معدات|دريل|منشار|tool|tools|equipment|drill|saw)/i],
  },
  {
    category: 'watches_accessories',
    patterns: [/(?:ساعة|ساعات|اكسسوار|إكسسوار|نظارة|محفظة|watch|watches|accessory|accessories|glasses|wallet)/i],
  },
  {
    category: 'beauty',
    patterns: [/(?:عناية|تجميل|عطر|مكياج|كريم|beauty|perfume|makeup|cosmetic|cream)/i],
  },
];

const existingSearchIds = new Set(legacySearchRules.map(rule => rule.category));
const specificGoodsRules = additionalGoodsRules.filter(rule => rule.category !== 'animals');
const animalRules = additionalGoodsRules.filter(rule => rule.category === 'animals');
function withNormalizedPatterns<T extends { patterns: RegExp[] }>(rule: T): T {
  return { ...rule, patterns: rule.patterns.flatMap(pattern => {
    const normalized = pattern.source.replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه');
    return normalized === pattern.source ? [pattern] : [pattern, new RegExp(normalized, pattern.flags)];
  }) };
}

export const marketplaceSearchCategoryRules: MarketplaceCategoryRule[] = [
  ...specificGoodsRules,
  ...legacySearchRules,
  ...animalRules,
  ...legacyVisionRules.filter(rule => !existingSearchIds.has(rule.category)).map(rule => ({ ...rule, stopWords: [] })),
].map(withNormalizedPatterns);

export const marketplaceVisionCategoryRules = [
  ...specificGoodsRules,
  ...legacyVisionRules.filter(rule => existingSearchIds.has(rule.category)),
  ...animalRules,
  ...legacyVisionRules.filter(rule => !existingSearchIds.has(rule.category)),
].map(withNormalizedPatterns);
