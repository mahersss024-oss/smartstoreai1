import type { MarketplaceCategoryId } from './categories';

type ProductEntry = { id: string; category: MarketplaceCategoryId; aliases: string[]; searchGroups?: string[][] };

// Product identity is narrower than a category: a tanker is not a tow truck.
export const marketplaceProducts: ProductEntry[] = [
  { id: 'water_tanker', category: 'heavy_equipment', aliases: ['وايت', 'وايتات', 'صهريج', 'صهاريج', 'water tanker', 'tanker truck'] },
  { id: 'tractor_trailer', category: 'heavy_equipment', aliases: ['تريله', 'تريلة', 'تريلا', 'تريلات', 'راس تريلا', 'رأس تريلة', 'tractor trailer', 'semi truck'] },
  { id: 'tow_truck', category: 'heavy_equipment', aliases: ['سطحة', 'سطحه', 'سطحات', 'ونش سحب', 'tow truck', 'recovery truck'] },
  { id: 'dump_truck', category: 'heavy_equipment', aliases: ['قلاب', 'قلابات', 'dump truck', 'tipper truck'] },
  { id: 'wheel_loader', category: 'heavy_equipment', aliases: ['شيول', 'شيولات', 'wheel loader'] },
  { id: 'excavator', category: 'heavy_equipment', aliases: ['بوكلين', 'بوكلينات', 'حفار', 'excavator'] },
  { id: 'forklift', category: 'heavy_equipment', aliases: ['رافعة شوكية', 'رافعة شوكيه', 'فوركلفت', 'forklift'] },
  { id: 'concrete_mixer', category: 'heavy_equipment', aliases: ['خلاطة خرسانة', 'خلاطة اسمنت', 'خلاطه اسمنت', 'concrete mixer'] },
  { id: 'road_roller', category: 'heavy_equipment', aliases: ['رصاصة طرق', 'رصاصه طرق', 'دكاكة طرق', 'road roller'] },
  { id: 'grader', category: 'heavy_equipment', aliases: ['قريدر', 'جريدر', 'motor grader'] },
  { id: 'light_commercial_truck', category: 'heavy_equipment', aliases: ['دينا', 'دينه', 'دينة', 'دينا نقل', 'light commercial truck'] },
  { id: 'motorcycle', category: 'motorcycles', aliases: ['دباب', 'دبابات', 'دراجة نارية', 'motorcycle', 'motorbike'] },
  { id: 'bicycle', category: 'sports', aliases: ['سيكل', 'سياكل', 'بسكليت', 'دراجة هوائية', 'bicycle', 'bike'] },
  { id: 'car_parts', category: 'auto_parts', aliases: ['قطع غيار', 'قطع تشليح', 'مكينة سيارة', 'قير سيارة', 'spare parts', 'auto parts'] },
  { id: 'tires', category: 'auto_parts', aliases: ['كفرات', 'اطارات سيارات', 'إطارات سيارات', 'car tires', 'car tyres'] },
  { id: 'wheels', category: 'auto_parts', aliases: ['جنوط', 'جنط', 'car rims', 'alloy wheels'] },
  { id: 'pickup', category: 'cars', aliases: ['وانيت', 'غمارة', 'غماره', 'دبل كبين', 'pickup truck'] },
  { id: 'phone', category: 'mobile_phones', aliases: ['جوال', 'جوالات', 'موبايل', 'ايفون', 'آيفون', 'iphone', 'smartphone'], searchGroups: [['جوال', 'جوالات', 'موبايل', 'smartphone'], ['ايفون', 'آيفون', 'iphone']] },
  { id: 'laptop', category: 'computers', aliases: ['لاب توب', 'لابتوب', 'لاب توب محمول', 'ماكبوك', 'macbook', 'laptop', 'notebook computer'], searchGroups: [['لاب توب', 'لابتوب', 'لاب توب محمول', 'laptop', 'notebook computer'], ['ماكبوك', 'macbook']] },
  { id: 'desktop', category: 'computers', aliases: ['كمبيوتر مكتبي', 'تجميعة', 'تجميعه', 'بي سي', 'desktop pc', 'gaming pc'] },
  { id: 'tablet', category: 'tablets', aliases: ['ايباد', 'آيباد', 'تابلت', 'جهاز لوحي', 'ipad', 'tablet'], searchGroups: [['ايباد', 'آيباد', 'ipad'], ['تابلت', 'جهاز لوحي', 'tablet']] },
  { id: 'camera', category: 'cameras', aliases: ['كاميرا', 'كاميره', 'كاميرات', 'camera'] },
  { id: 'television', category: 'tv_audio', aliases: ['تلفزيون', 'تلفاز', 'تلفزيونات', 'شاشة تلفزيون', 'television', 'smart tv'] },
  { id: 'monitor', category: 'computers', aliases: ['شاشة كمبيوتر', 'شاشة قيمنق', 'شاشة جيمنج', 'computer monitor', 'gaming monitor'] },
  { id: 'speaker', category: 'tv_audio', aliases: ['مكبر صوت', 'سبيكر', 'ساوند بار', 'soundbar', 'speaker'] },
  { id: 'router', category: 'networking', aliases: ['راوتر', 'مودم', 'مقوي واي فاي', 'router', 'modem'] },
  { id: 'refrigerator', category: 'home_appliances', aliases: ['ثلاجة', 'ثلاجه', 'refrigerator', 'fridge'] },
  { id: 'water_dispenser', category: 'home_appliances', aliases: ['براد مياه', 'برادة مياه', 'water dispenser', 'water cooler'] },
  { id: 'washer', category: 'home_appliances', aliases: ['غسالة', 'غساله', 'washing machine', 'washer'] },
  { id: 'air_conditioner', category: 'home_appliances', aliases: ['مكيف', 'مكيفات', 'سبلت', 'اسبلت', 'air conditioner', 'split ac'] },
  { id: 'air_fryer', category: 'home_appliances', aliases: ['قلاية هوائية', 'قلايه هوائيه', 'air fryer'] },
  { id: 'deep_fryer', category: 'home_appliances', aliases: ['قلاية زيت', 'قلايه زيت', 'deep fryer'] },
  { id: 'kettle', category: 'home_appliances', aliases: ['غلاية', 'غلايه', 'kettle'] },
  { id: 'coffee_machine', category: 'home_appliances', aliases: ['مكينة قهوة', 'ماكينة قهوة', 'الة قهوة', 'coffee machine'] },
  { id: 'sofa', category: 'furniture', aliases: ['كنب', 'كنبة', 'كنبه', 'انتريه', 'sofa', 'couch'] },
  { id: 'table', category: 'furniture', aliases: ['طاولة', 'طاوله', 'طاولات', 'ميز طعام', 'coffee table', 'dining table', 'table'] },
  { id: 'bed', category: 'furniture', aliases: ['سرير', 'اسرة نوم', 'bed', 'bed frame'] },
  { id: 'wardrobe', category: 'furniture', aliases: ['دولاب', 'خزانة ملابس', 'خزانه ملابس', 'wardrobe'] },
  { id: 'chair', category: 'furniture', aliases: ['كرسي', 'كراسي', 'chair'] },
  { id: 'apartment', category: 'real_estate', aliases: ['شقة', 'شقه', 'شقق', 'apartment', 'flat'] },
  { id: 'villa', category: 'real_estate', aliases: ['فيلا', 'فلة', 'فله', 'فلل', 'villa'] },
  { id: 'abaya', category: 'women_supplies', aliases: ['عباية', 'عبايه', 'عبايات', 'abaya'] },
  { id: 'shemagh', category: 'men_supplies', aliases: ['شماغ', 'اشمغة', 'اشمغه', 'غترة', 'غتره', 'shemagh', 'ghutra'] },
  { id: 'shoes', category: 'fashion', aliases: ['حذاء', 'احذية', 'جزمة', 'جزمه', 'جزم', 'شوز', 'shoes', 'sneakers'] },
  { id: 'stroller', category: 'kids', aliases: ['عربة اطفال', 'عربه اطفال', 'عربية اطفال', 'stroller', 'pram'] },
  { id: 'watch', category: 'watches_accessories', aliases: ['ساعة', 'ساعه', 'ساعات', 'watch', 'watches'] },
  { id: 'perfume', category: 'beauty', aliases: ['عطر', 'عطور', 'perfume', 'fragrance'] },
  { id: 'playstation', category: 'gaming_hobbies', aliases: ['بلايستيشن', 'بلاي ستيشن', 'سوني فايف', 'playstation'] },
  { id: 'xbox', category: 'gaming_hobbies', aliases: ['اكس بوكس', 'xbox'] },
  { id: 'book', category: 'books_education', aliases: ['كتاب', 'كتب', 'book', 'books'] },
  { id: 'art_supplies', category: 'arts', aliases: ['ادوات رسم', 'أدوات رسم', 'الوان رسم', 'art supplies'] },
  { id: 'drill', category: 'tools_equipment', aliases: ['دريل', 'شنيور', 'مثقاب', 'drill'] },
  { id: 'generator', category: 'tools_equipment', aliases: ['ماطور كهرباء', 'موتور كهرباء', 'مولد كهرباء', 'generator'] },
  { id: 'seedling', category: 'agriculture', aliases: ['شتلة', 'شتله', 'شتلات', 'seedling', 'seedlings'] },
  { id: 'sheep', category: 'animals', aliases: ['خروف', 'خرفان', 'غنم', 'اغنام', 'sheep', 'lamb'] },
  { id: 'camel', category: 'animals', aliases: ['ناقة', 'ناقه', 'بعير', 'حاشي', 'camel'] },
  { id: 'tent', category: 'camping', aliases: ['خيمة', 'خيمه', 'خيام', 'بيت شعر', 'camping tent', 'tent'] },
  { id: 'dates', category: 'food', aliases: ['تمر', 'تمور', 'dates'] },
  { id: 'honey', category: 'food', aliases: ['عسل', 'honey'] },
  { id: 'heritage', category: 'antiques', aliases: ['تراثيات', 'مقتنيات تراثية', 'antique collectibles'] },
  { id: 'garden_furniture', category: 'home_garden', aliases: ['جلسة حوش', 'جلسه حوش', 'اثاث حديقة', 'garden furniture', 'patio furniture'] },
];

export function normalizeProductTerm(text: string) {
  return text.normalize('NFKC').toLowerCase().replace(/[\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/[إأآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function phrasePattern(alias: string) {
  const phrase = normalizeProductTerm(alias).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
  const arabic = /\p{Script=Arabic}/u.test(alias);
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${arabic ? '(?:و)?(?:ال)?' : ''}${phrase}(?=$|[^\\p{L}\\p{N}])`, 'iu');
}

const entries = marketplaceProducts.map(product => ({ ...product, patterns: product.aliases.map(phrasePattern) }));
const aliasEntries = new Map(entries.flatMap(product => product.aliases.map(alias => [normalizeProductTerm(alias), product] as const)));
const explicitPartsPrefix = /^(?:للبيع\s+|for sale\s+)?(?:قطع غيار|قطع تشليح|كفرات|جنوط|جنط|spare parts|auto parts|car tires|car tyres|car rims|alloy wheels)(?:\s|$)/u;

export function getProductIdentity(text: string) {
  const normalized = normalizeProductTerm(text);
  const matches = entries.flatMap(product => product.patterns.flatMap((pattern, index) => pattern.test(normalized)
    ? [{ product, specificity: normalizeProductTerm(product.aliases[index]).split(' ').length }] : []));
  // Explicit parts are the item being sold, not the vehicle named after them.
  if (explicitPartsPrefix.test(normalized)) {
    return matches.find(match => match.product.category === 'auto_parts')?.product;
  }
  return matches.sort((a, b) => b.specificity - a.specificity)[0]?.product;
}

export function getProductCategory(text: string) {
  return getProductIdentity(text)?.category;
}

export function getProductAliases(term: string) {
  const normalized = normalizeProductTerm(term).replace(/^(?:وال|ال)/u, '');
  const entry = aliasEntries.get(normalized);
  // A named product must not expand into every product in its broader family.
  return entry?.searchGroups?.find(group => group.some(alias => normalizeProductTerm(alias) === normalized)) ?? entry?.aliases ?? [];
}

export function canonicalProductTokens(text: string) {
  return normalizeProductTerm(text).split(' ').map(token => {
    const entry = aliasEntries.get(token.replace(/^(?:وال|ال)/u, ''));
    return entry ? `product:${entry.id}` : token;
  });
}

export function getProductOfferKind(text: string): 'parts' | 'service' | 'product' {
  const normalized = normalizeProductTerm(text);
  if (explicitPartsPrefix.test(normalized)) return 'parts';
  if (/^(?:خدمه|خدمات|توصيل مياه|نقل عفش|صيانة|صيانه|اصلاح)(?:\s|$)/u.test(normalized) || /(?:^|\s)(?:للايجار|للتاجير|للعمل)(?:\s|$)/u.test(normalized)) return 'service';
  return 'product';
}

export function getHeavyVehicleConfiguration(text: string) {
  const normalized = normalizeProductTerm(text);
  if (/(?:^|\s)(?:سكس|سكسويل|سكس ويل|six wheeler)(?:\s|$)/u.test(normalized)) return 'six_wheeler';
  if (/(?:^|\s)(?:تريلا|تريله)(?:\s|$)/u.test(normalized)) return 'tractor_trailer';
  return undefined;
}
