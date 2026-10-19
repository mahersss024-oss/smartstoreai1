import type { MarketplaceCategoryId } from './categories';
import { getMarketplaceCarModel, marketplaceCarModelAttribute } from './car-models';

export type MarketplaceCategoryOption = { id: string; label: string };
type OptionGroup = { kind: 'brand' | 'type'; options: readonly MarketplaceCategoryOption[] };

function options(entries: readonly (readonly [string, string])[]): MarketplaceCategoryOption[] {
  return entries.map(([id, label]) => ({ id, label }));
}

const phoneBrands = options([
  ['apple', 'آبل'], ['samsung', 'سامسونج'], ['huawei', 'هواوي'], ['xiaomi', 'شاومي'],
  ['honor', 'هونر'], ['oppo', 'أوبو'], ['vivo', 'فيفو'], ['realme', 'ريلمي'],
  ['nokia', 'نوكيا'], ['motorola', 'موتورولا'], ['google', 'جوجل'], ['oneplus', 'ون بلس'],
  ['sony', 'سوني'], ['asus', 'أسوس'], ['nothing', 'ناثينج'], ['tecno', 'تكنو'],
  ['infinix', 'إنفينيكس'], ['zte', 'زد تي إي'], ['lenovo', 'لينوفو'], ['tcl', 'تي سي إل'],
]);

// A catalog of explicit selections, not keywords for inferring a listing from its title.
export const marketplaceCategoryOptionGroups: Record<MarketplaceCategoryId, OptionGroup> = {
  cars: { kind: 'brand', options: options([
    ['toyota', 'تويوتا'], ['hyundai', 'هيونداي'], ['nissan', 'نيسان'], ['ford', 'فورد'],
    ['kia', 'كيا'], ['chevrolet', 'شفروليه'], ['lexus', 'لكزس'], ['mercedes_benz', 'مرسيدس بنز'],
    ['gmc', 'جي إم سي'], ['honda', 'هوندا'], ['isuzu', 'إيسوزو'], ['bmw', 'بي إم دبليو'],
    ['dodge', 'دودج'], ['mazda', 'مازدا'], ['changan', 'شانجان'], ['mitsubishi', 'ميتسوبيشي'],
    ['land_rover', 'لاند روفر'], ['jetour', 'جيتور'], ['geely', 'جيلي'], ['jeep', 'جيب'],
    ['mg', 'إم جي'], ['suzuki', 'سوزوكي'], ['haval', 'هافال'], ['genesis', 'جينيسيس'],
    ['audi', 'أودي'], ['chery', 'شيري'], ['porsche', 'بورش'], ['chrysler', 'كرايسلر'],
    ['cadillac', 'كاديلاك'], ['gac', 'جي إيه سي'], ['peugeot', 'بيجو'], ['volkswagen', 'فولكس واجن'],
    ['faw', 'فاو'], ['lincoln', 'لينكولن'], ['daihatsu', 'دايهاتسو'], ['infiniti', 'إنفينيتي'],
    ['great_wall', 'جريت وول'], ['byd', 'بي واي دي'], ['jac', 'جاك'], ['fiat', 'فيات'],
    ['dongfeng', 'دونج فينج'], ['bentley', 'بنتلي'], ['tank', 'تانك'], ['foton', 'فوتون'],
    ['rolls_royce', 'رولز رويس'], ['jaguar', 'جاكوار'], ['baic', 'بايك'], ['maserati', 'مازيراتي'],
    ['hummer', 'همر'], ['jmc', 'جيه إم سي'], ['volvo', 'فولفو'], ['maxus', 'ماكسوس'],
    ['saab', 'ساب'], ['tata', 'تاتا'], ['subaru', 'سوبارو'], ['lamborghini', 'لامبورجيني'],
    ['lucid', 'لوسيد'], ['buick', 'بويك'], ['hongqi', 'هونشي'], ['jaecoo', 'جايكو'],
    ['smart', 'سمارت'], ['kg_mobility', 'سانج يونج وكي جي'], ['skoda', 'سكودا'], ['lynk_co', 'لينك آند كو'],
    ['ferrari', 'فيراري'], ['rox', 'روكس'], ['aston_martin', 'أستون مارتن'], ['seat', 'سيات'],
    ['lifan', 'ليفان'], ['zxauto', 'زد إكس أوتو'], ['citroen', 'سيتروين'], ['mercury', 'ميركوري'],
    ['exeed', 'إكسيد'], ['alfa_romeo', 'ألفا روميو'], ['tesla', 'تسلا'], ['soueast', 'ساوايست'],
    ['mahindra', 'ماهيندرا'], ['renault', 'رينو'], ['mclaren', 'ماكلارين'], ['omoda', 'أومودا'],
    ['opel', 'أوبل'], ['lotus', 'لوتس'], ['ineos', 'إينيوس'], ['daewoo', 'دايو'],
    ['kaiyi', 'كايي'], ['proton', 'بروتون'], ['ram', 'رام'], ['changan_deepal', 'ديبال'],
    ['other', 'ماركات سيارات أخرى'],
  ]) },
  auto_parts: { kind: 'type', options: options([
    ['engines', 'محركات وقير'], ['body', 'هيكل وبودي'], ['electrical', 'كهرباء وإنارة'],
    ['tires', 'إطارات وجنوط'], ['interior', 'داخلية وإكسسوارات'], ['maintenance', 'زيوت وفلاتر وصيانة'],
    ['scrap', 'قطع تشليح'], ['other', 'قطع وملحقات أخرى'],
  ]) },
  motorcycles: { kind: 'brand', options: options([
    ['honda', 'هوندا'], ['yamaha', 'ياماها'], ['suzuki', 'سوزوكي'], ['kawasaki', 'كاواساكي'],
    ['bmw', 'بي إم دبليو'], ['harley_davidson', 'هارلي ديفيدسون'], ['ducati', 'دوكاتي'],
    ['ktm', 'كي تي إم'], ['triumph', 'ترايمف'], ['can_am', 'كان آم'], ['polaris', 'بولاريس'],
    ['cfmoto', 'سي إف موتو'], ['bajaj', 'باجاج'], ['royal_enfield', 'رويال إنفيلد'], ['other', 'ماركات دراجات أخرى'],
  ]) },
  heavy_equipment: { kind: 'type', options: options([
    ['trucks', 'شاحنات'], ['trailers', 'تريلات ومقطورات'], ['buses', 'حافلات'], ['tankers', 'وايتات وصهاريج'],
    ['tow_trucks', 'سطحات'], ['loaders', 'شيولات وحفارات'], ['cranes', 'رافعات وكرينات'],
    ['forklifts', 'رافعات شوكية'], ['road_equipment', 'معدات طرق'], ['other', 'معدات ثقيلة أخرى'],
  ]) },
  mobile_phones: { kind: 'brand', options: [...phoneBrands, ...options([['other', 'ماركات جوالات أخرى']])] },
  computers: { kind: 'brand', options: options([
    ['apple', 'آبل'], ['hp', 'إتش بي'], ['dell', 'ديل'], ['lenovo', 'لينوفو'], ['asus', 'أسوس'],
    ['acer', 'إيسر'], ['msi', 'إم إس آي'], ['microsoft', 'مايكروسوفت'], ['huawei', 'هواوي'],
    ['samsung', 'سامسونج'], ['gigabyte', 'جيجابايت'], ['lg', 'إل جي'], ['toshiba', 'توشيبا'],
    ['epson', 'إبسون'], ['canon', 'كانون'], ['brother', 'براذر'], ['custom', 'أجهزة تجميع'],
    ['other', 'ماركات حواسيب وملحقات أخرى'],
  ]) },
  tablets: { kind: 'brand', options: options([
    ['apple', 'آبل'], ['samsung', 'سامسونج'], ['huawei', 'هواوي'], ['lenovo', 'لينوفو'],
    ['xiaomi', 'شاومي'], ['honor', 'هونر'], ['microsoft', 'مايكروسوفت'], ['amazon', 'أمازون'],
    ['nokia', 'نوكيا'], ['realme', 'ريلمي'], ['other', 'ماركات أجهزة لوحية أخرى'],
  ]) },
  cameras: { kind: 'brand', options: options([
    ['canon', 'كانون'], ['nikon', 'نيكون'], ['sony', 'سوني'], ['fujifilm', 'فوجي فيلم'],
    ['panasonic', 'باناسونيك'], ['olympus', 'أوليمبوس'], ['leica', 'لايكا'], ['gopro', 'جو برو'],
    ['dji', 'دي جي آي'], ['insta360', 'إنستا 360'], ['blackmagic', 'بلاك ماجيك'],
    ['sigma', 'سيجما'], ['other', 'ماركات تصوير أخرى'],
  ]) },
  tv_audio: { kind: 'brand', options: options([
    ['samsung', 'سامسونج'], ['lg', 'إل جي'], ['sony', 'سوني'], ['tcl', 'تي سي إل'],
    ['hisense', 'هايسنس'], ['panasonic', 'باناسونيك'], ['toshiba', 'توشيبا'], ['philips', 'فيليبس'],
    ['sharp', 'شارب'], ['xiaomi', 'شاومي'], ['jbl', 'جي بي إل'], ['bose', 'بوز'],
    ['yamaha', 'ياماها'], ['harman_kardon', 'هارمان كاردون'], ['other', 'ماركات تلفزيونات وصوتيات أخرى'],
  ]) },
  networking: { kind: 'brand', options: options([
    ['huawei', 'هواوي'], ['zte', 'زد تي إي'], ['tp_link', 'تي بي لينك'], ['d_link', 'دي لينك'],
    ['cisco', 'سيسكو'], ['ubiquiti', 'يوبيكويتي'], ['mikrotik', 'مايكروتك'], ['netgear', 'نت جير'],
    ['asus', 'أسوس'], ['tenda', 'تندا'], ['other', 'ماركات شبكات أخرى'],
  ]) },
  home_appliances: { kind: 'brand', options: options([
    ['lg', 'إل جي'], ['samsung', 'سامسونج'], ['haier', 'هاير'], ['midea', 'ميديا'], ['gree', 'جري'],
    ['aux', 'أوكس'], ['carrier', 'كاريير'], ['york', 'يورك'], ['general', 'جنرال'], ['zamil', 'الزامل'],
    ['bosch', 'بوش'], ['beko', 'بيكو'], ['whirlpool', 'ويرلبول'], ['electrolux', 'إلكترولوكس'],
    ['hitachi', 'هيتاشي'], ['panasonic', 'باناسونيك'], ['toshiba', 'توشيبا'], ['sharp', 'شارب'],
    ['philips', 'فيليبس'], ['braun', 'براون'], ['kenwood', 'كينوود'], ['tefal', 'تيفال'],
    ['delonghi', 'ديلونجي'], ['dyson', 'دايسون'], ['nikai', 'نيكاي'], ['geepas', 'جيباس'],
    ['other', 'ماركات أجهزة منزلية أخرى'],
  ]) },
  real_estate: { kind: 'type', options: options([
    ['apartments_sale', 'شقق للبيع'], ['apartments_rent', 'شقق للإيجار'],
    ['villas_sale', 'فلل للبيع'], ['villas_rent', 'فلل للإيجار'],
    ['houses_sale', 'بيوت للبيع'], ['houses_rent', 'بيوت للإيجار'], ['floors', 'أدوار'],
    ['residential_land', 'أراضٍ سكنية'], ['commercial_land', 'أراضٍ تجارية'], ['agricultural_land', 'أراضٍ زراعية'],
    ['buildings', 'عمائر'], ['shops_sale', 'محلات للبيع'], ['shops_rent', 'محلات للإيجار'],
    ['shops_transfer', 'محلات للتنازل'], ['offices', 'مكاتب'], ['warehouses', 'مستودعات'],
    ['farms', 'مزارع'], ['rest_houses', 'استراحات وشاليهات'], ['rooms', 'غرف وسكن مشترك'],
    ['other', 'عقارات أخرى'],
  ]) },
  furniture: { kind: 'type', options: options([
    ['bedrooms', 'غرف نوم'], ['sofas', 'كنب ومجالس'], ['dining', 'طاولات طعام'], ['tables', 'طاولات'],
    ['chairs', 'كراسي'], ['storage', 'خزائن ودواليب'], ['kitchens', 'مطابخ'], ['office', 'أثاث مكتبي'],
    ['carpets', 'سجاد وستائر'], ['outdoor', 'أثاث خارجي'], ['other', 'أثاث آخر'],
  ]) },
  home_garden: { kind: 'type', options: options([
    ['decor', 'ديكور'], ['lighting', 'إنارة'], ['kitchenware', 'أوانٍ وأدوات مطبخ'], ['bedding', 'مفروشات'],
    ['cleaning', 'أدوات تنظيف'], ['garden', 'مستلزمات حدائق'], ['storage', 'تنظيم وتخزين'], ['other', 'مستلزمات منزل أخرى'],
  ]) },
  fashion: { kind: 'type', options: options([
    ['women_clothing', 'ملابس نسائية'], ['men_clothing', 'ملابس رجالية'], ['children_clothing', 'ملابس أطفال'],
    ['shoes', 'أحذية'], ['bags', 'حقائب'], ['traditional', 'أزياء شعبية'], ['other', 'أزياء أخرى'],
  ]) },
  women_supplies: { kind: 'type', options: options([
    ['clothing', 'ملابس'], ['abayas', 'عبايات وطرح'], ['dresses', 'فساتين'], ['shoes', 'أحذية'],
    ['bags', 'حقائب'], ['accessories', 'إكسسوارات'], ['other', 'مستلزمات نسائية أخرى'],
  ]) },
  men_supplies: { kind: 'type', options: options([
    ['clothing', 'ملابس'], ['thobes', 'ثياب'], ['headwear', 'شمغ وغتر'], ['shoes', 'أحذية'],
    ['bags', 'حقائب ومحافظ'], ['accessories', 'إكسسوارات'], ['other', 'مستلزمات رجالية أخرى'],
  ]) },
  kids: { kind: 'type', options: options([
    ['clothing', 'ملابس وأحذية'], ['strollers', 'عربات أطفال'], ['car_seats', 'مقاعد سيارات'],
    ['furniture', 'أثاث أطفال'], ['toys', 'ألعاب أطفال'], ['feeding', 'مستلزمات تغذية'],
    ['care', 'مستلزمات عناية'], ['other', 'مستلزمات أطفال أخرى'],
  ]) },
  watches_accessories: { kind: 'type', options: options([
    ['watches', 'ساعات'], ['smartwatches', 'ساعات ذكية'], ['jewelry', 'حلي ومجوهرات'],
    ['eyewear', 'نظارات'], ['accessories', 'إكسسوارات'], ['other', 'ساعات وإكسسوارات أخرى'],
  ]) },
  beauty: { kind: 'type', options: options([
    ['perfumes', 'عطور وبخور'], ['skin', 'العناية بالبشرة'], ['hair', 'العناية بالشعر'], ['makeup', 'مستحضرات تجميل'],
    ['devices', 'أجهزة عناية'], ['salon', 'مستلزمات صالونات'], ['other', 'منتجات عناية أخرى'],
  ]) },
  sports: { kind: 'type', options: options([
    ['fitness', 'أجهزة لياقة'], ['weights', 'أوزان ومقاومة'], ['bicycles', 'دراجات هوائية'],
    ['team_sports', 'رياضات جماعية'], ['racket_sports', 'رياضات المضرب'], ['water_sports', 'رياضات مائية'],
    ['clothing', 'ملابس ومستلزمات رياضية'], ['other', 'معدات رياضية أخرى'],
  ]) },
  gaming_hobbies: { kind: 'type', options: options([
    ['playstation', 'بلايستيشن'], ['xbox', 'إكس بوكس'], ['nintendo', 'نينتندو'], ['pc_gaming', 'ألعاب الحاسب'],
    ['accessories', 'ملحقات ألعاب'], ['board_games', 'ألعاب جماعية وطاولة'], ['hobbies', 'هوايات ومجسمات'],
    ['other', 'ألعاب وهوايات أخرى'],
  ]) },
  books_education: { kind: 'type', options: options([
    ['books', 'كتب عامة'], ['textbooks', 'كتب دراسية'], ['children', 'كتب أطفال'], ['stationery', 'قرطاسية'],
    ['learning', 'وسائل تعليمية'], ['other', 'كتب ومستلزمات تعليم أخرى'],
  ]) },
  arts: { kind: 'type', options: options([
    ['paintings', 'لوحات فنية'], ['drawing', 'أدوات رسم'], ['crafts', 'أشغال يدوية'], ['sculpture', 'مجسمات ومنحوتات'],
    ['calligraphy', 'خط وزخرفة'], ['other', 'فنون ومستلزمات أخرى'],
  ]) },
  tools_equipment: { kind: 'type', options: options([
    ['hand_tools', 'أدوات يدوية'], ['power_tools', 'عدد كهربائية'], ['workshops', 'معدات ورش'],
    ['generators', 'مولدات'], ['pumps', 'مضخات'], ['welding', 'معدات لحام'], ['safety', 'معدات سلامة'],
    ['industrial', 'معدات صناعية'], ['solar', 'معدات طاقة شمسية'], ['other', 'معدات وأدوات أخرى'],
  ]) },
  agriculture: { kind: 'type', options: options([
    ['plants', 'نباتات وشتلات'], ['seeds', 'بذور'], ['irrigation', 'أنظمة ري'], ['soil', 'تربة وأسمدة'],
    ['equipment', 'معدات زراعية'], ['greenhouses', 'بيوت محمية'], ['other', 'مستلزمات زراعية أخرى'],
  ]) },
  animals: { kind: 'type', options: options([
    ['sheep', 'أغنام'], ['goats', 'ماعز'], ['camels', 'إبل'], ['cattle', 'أبقار'], ['horses', 'خيل'],
    ['birds', 'طيور'], ['poultry', 'دواجن'], ['cats', 'قطط'], ['dogs', 'كلاب'], ['fish', 'أسماك زينة'],
    ['rabbits', 'أرانب'], ['feed', 'أعلاف وأغذية'], ['supplies', 'مستلزمات حيوانات'], ['other', 'حيوانات ومستلزمات أخرى'],
  ]) },
  camping: { kind: 'type', options: options([
    ['tents', 'خيام ومظلات'], ['sleeping', 'مستلزمات نوم'], ['cooking', 'أدوات طبخ رحلات'], ['lighting', 'إنارة رحلات'],
    ['coolers', 'حافظات وثلاجات متنقلة'], ['fishing', 'مستلزمات صيد مسموحة'], ['other', 'مستلزمات رحلات أخرى'],
  ]) },
  food: { kind: 'type', options: options([
    ['dates', 'تمور'], ['honey', 'عسل'], ['coffee', 'قهوة وشاي'], ['sweets', 'حلويات ومخبوزات'],
    ['homemade', 'أطعمة منزلية'], ['produce', 'خضار وفواكه'], ['local', 'منتجات محلية'], ['other', 'أطعمة ومشروبات أخرى'],
  ]) },
  antiques: { kind: 'type', options: options([
    ['heritage', 'تراثيات'], ['coins', 'عملات وميداليات'], ['stamps', 'طوابع'], ['collectibles', 'مقتنيات نادرة'],
    ['decor', 'تحف وديكور قديم'], ['other', 'نوادر أخرى'],
  ]) },
  boats: { kind: 'type', options: options([
    ['boats', 'قوارب'], ['yachts', 'يخوت'], ['jet_skis', 'دبابات بحرية'], ['engines', 'محركات بحرية'],
    ['trailers', 'مقطورات قوارب'], ['supplies', 'مستلزمات بحرية'], ['other', 'قوارب ومستلزمات أخرى'],
  ]) },
  services: { kind: 'type', options: options([
    ['ac', 'تكييف وتبريد'], ['electrical', 'كهرباء'], ['plumbing', 'سباكة'], ['construction', 'مقاولات وبناء'],
    ['finishing', 'تشطيب ودهان'], ['carpentry', 'نجارة وحدادة'], ['cleaning', 'تنظيف'], ['pest_control', 'مكافحة حشرات'],
    ['moving', 'نقل عفش'], ['delivery', 'نقل وتوصيل'], ['car_maintenance', 'صيانة سيارات'],
    ['device_repair', 'صيانة أجهزة'], ['computing', 'خدمات حاسب وشبكات'], ['programming', 'برمجة وتطوير'],
    ['design', 'تصميم'], ['photography', 'تصوير'], ['printing', 'طباعة ودعاية'], ['translation', 'ترجمة وكتابة'],
    ['gardening', 'تنسيق حدائق'], ['events', 'تنظيم مناسبات'], ['catering', 'ضيافة وتموين'],
    ['rental', 'تأجير معدات'], ['other', 'خدمات أخرى'],
  ]) },
  business_equipment: { kind: 'type', options: options([
    ['restaurants', 'تجهيزات مطاعم'], ['cafes', 'تجهيزات مقاهٍ'], ['shops', 'تجهيزات محلات'],
    ['offices', 'تجهيزات مكاتب'], ['storage', 'أرفف وتخزين'], ['pos', 'أجهزة كاشير ونقاط بيع'],
    ['salons', 'تجهيزات صالونات'], ['other', 'تجهيزات تجارية أخرى'],
  ]) },
  businesses: { kind: 'type', options: options([
    ['shops', 'محلات للتنازل'], ['restaurants', 'مطاعم للتنازل'], ['cafes', 'مقاهٍ للتنازل'],
    ['workshops', 'ورش للتنازل'], ['projects', 'مشاريع قائمة للتنازل'], ['other', 'أنشطة تجارية أخرى للتنازل'],
  ]) },
  jobs: { kind: 'type', options: options([
    ['administration', 'إدارة ومحاسبة'], ['sales', 'مبيعات وتسويق'], ['technical', 'وظائف تقنية'],
    ['engineering', 'هندسة وفنيون'], ['hospitality', 'ضيافة ومطاعم'], ['transport', 'نقل وتوصيل'],
    ['education', 'تعليم وتدريب'], ['other', 'وظائف أخرى'],
  ]) },
  training: { kind: 'type', options: options([
    ['technology', 'تقنية وبرمجة'], ['languages', 'لغات'], ['business', 'إدارة وأعمال'],
    ['vocational', 'تدريب مهني'], ['arts', 'فنون وتصميم'], ['academic', 'تعليم ودروس'],
    ['other', 'تدريب ودورات أخرى'],
  ]) },
  events: { kind: 'type', options: options([
    ['equipment', 'تجهيزات مناسبات'], ['decor', 'ديكور وتنسيق'], ['hospitality', 'مستلزمات ضيافة'],
    ['gifts', 'هدايا وتوزيعات'], ['other', 'مستلزمات مناسبات أخرى'],
  ]) },
  travel: { kind: 'type', options: options([
    ['trips', 'رحلات سياحية'], ['accommodation', 'عروض إقامة'], ['activities', 'أنشطة سياحية'],
    ['supplies', 'مستلزمات سفر'], ['other', 'عروض سياحة وسفر أخرى'],
  ]) },
  building_materials: { kind: 'type', options: options([
    ['structural', 'حديد وأسمنت وبلوك'], ['flooring', 'بلاط وأرضيات'], ['doors', 'أبواب ونوافذ'],
    ['plumbing', 'مواد سباكة'], ['electrical', 'مواد كهربائية'], ['paint', 'دهانات وعزل'],
    ['wood', 'خشب وألواح'], ['stone', 'رخام وحجر'], ['other', 'مواد بناء أخرى'],
  ]) },
  other: { kind: 'type', options: [] },
};

export const marketplaceCategoryOptionAttribute = 'marketplaceCategoryOption';

export function getMarketplaceCategoryOptions(category: string): readonly MarketplaceCategoryOption[] {
  return marketplaceCategoryOptionGroups[category as MarketplaceCategoryId]?.options ?? [];
}

export function getMarketplaceCategoryOptionLabel(category: string) {
  return marketplaceCategoryOptionGroups[category as MarketplaceCategoryId]?.kind === 'brand' ? 'البراند' : 'النوع';
}

export function getMarketplaceCategoryOption(category: string, value: unknown) {
  return typeof value === 'string' ? getMarketplaceCategoryOptions(category).find(option => option.id === value) : undefined;
}

export function getListingCategoryOption(listing: { category: string; attributes?: unknown }) {
  const attributes = listing.attributes && typeof listing.attributes === 'object' && !Array.isArray(listing.attributes)
    ? listing.attributes as Record<string, unknown> : {};
  return getMarketplaceCategoryOption(listing.category, attributes[marketplaceCategoryOptionAttribute]);
}

export class InvalidMarketplaceCategoryOptionError extends Error {
  constructor(message = 'اختر البراند أو النوع من الخيارات التابعة للتصنيف.') { super(message); }
}

export function getListingCarModel(listing: { category: string; attributes?: unknown }) {
  const brand = listing.category === 'cars' && getListingCategoryOption(listing);
  if (!brand) return undefined;
  return getMarketplaceCarModel(brand.id, (listing.attributes as Record<string, unknown> | undefined)?.[marketplaceCarModelAttribute]);
}

export function mergeMarketplaceCategoryAttributes(
  category: string,
  updates: Record<string, unknown> = {},
  previous: { category: string; attributes?: Record<string, unknown> } | undefined = undefined,
) {
  const attributes = { ...previous?.attributes, ...updates };
  const explicit = Object.hasOwn(updates, marketplaceCategoryOptionAttribute);
  const value = updates[marketplaceCategoryOptionAttribute];
  const previousOption = previous && getListingCategoryOption(previous);
  const previousBrand = previousOption && marketplaceCategoryOptionGroups[previous!.category as MarketplaceCategoryId]?.kind === 'brand'
    && previousOption.id !== 'other' && previousOption.id !== 'custom' ? previousOption : undefined;
  if ((explicit || previous?.category !== category) && previousBrand && attributes.brand === previousBrand.label) delete attributes.brand;
  delete attributes[marketplaceCategoryOptionAttribute];
  if (explicit && value !== null && value !== '') {
    const option = getMarketplaceCategoryOption(category, value);
    if (!option) throw new InvalidMarketplaceCategoryOptionError();
    attributes[marketplaceCategoryOptionAttribute] = option.id;
    if (marketplaceCategoryOptionGroups[category as MarketplaceCategoryId]?.kind === 'brand' && option.id !== 'other' && option.id !== 'custom') attributes.brand = option.label;
  } else if (!explicit && previous?.category === category) {
    const option = getListingCategoryOption(previous);
    if (option) attributes[marketplaceCategoryOptionAttribute] = option.id;
  }
  const previousModel = previous && getListingCarModel(previous);
  const brand = category === 'cars' && getListingCategoryOption({ category, attributes });
  const sameBrand = previous?.category === category && previousOption?.id === (brand && brand.id);
  const explicitModel = Object.hasOwn(updates, marketplaceCarModelAttribute);
  const modelValue = updates[marketplaceCarModelAttribute];
  delete attributes[marketplaceCarModelAttribute];
  if ((!sameBrand || explicitModel) && previousModel && previousModel.id !== 'other' && attributes.model === previousModel.label) delete attributes.model;
  if (explicitModel && modelValue !== null && modelValue !== '') {
    const model = brand && getMarketplaceCarModel(brand.id, modelValue);
    if (!model) throw new InvalidMarketplaceCategoryOptionError('اختر السيارة من الخيارات التابعة لبراندها.');
    attributes[marketplaceCarModelAttribute] = model.id;
    if (model.id !== 'other') attributes.model = model.label;
  } else if (!explicitModel && sameBrand && previousModel) {
    attributes[marketplaceCarModelAttribute] = previousModel.id;
  }
  return attributes;
}

export const marketplaceCategoryOptionsPrompt = Object.entries(marketplaceCategoryOptionGroups)
  .filter(([, group]) => group.options.length)
  .map(([category, group]) => `${category} [${group.kind}]: ${group.options.map(option => `${option.id}=${option.label}`).join(', ')}`)
  .join('\n');
