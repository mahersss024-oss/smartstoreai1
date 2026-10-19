// Persisted IDs are stable: new labels and groups never rewrite existing listings.
export const marketplaceCategoryDefinitions = [
  { id: 'cars', label: 'السيارات', group: 'سيارات ومركبات' },
  { id: 'auto_parts', label: 'قطع الغيار', group: 'سيارات ومركبات' },
  { id: 'motorcycles', label: 'الدراجات النارية', group: 'سيارات ومركبات' },
  { id: 'heavy_equipment', label: 'الشاحنات والمعدات الثقيلة', group: 'سيارات ومركبات' },
  { id: 'mobile_phones', label: 'الجوالات', group: 'الأجهزة والإلكترونيات' },
  { id: 'computers', label: 'الحواسيب وملحقاتها', group: 'الأجهزة والإلكترونيات' },
  { id: 'tablets', label: 'الأجهزة اللوحية', group: 'الأجهزة والإلكترونيات' },
  { id: 'cameras', label: 'الكاميرات والتصوير', group: 'الأجهزة والإلكترونيات' },
  { id: 'tv_audio', label: 'التلفزيونات والصوتيات', group: 'الأجهزة والإلكترونيات' },
  { id: 'networking', label: 'الشبكات والاتصالات', group: 'الأجهزة والإلكترونيات' },
  { id: 'home_appliances', label: 'الأجهزة المنزلية والمطبخ', group: 'الأجهزة المنزلية' },
  { id: 'real_estate', label: 'العقارات', group: 'العقار' },
  { id: 'furniture', label: 'الأثاث', group: 'البيت والأثاث' },
  { id: 'home_garden', label: 'المنزل والحديقة', group: 'البيت والأثاث' },
  { id: 'fashion', label: 'الموضة', group: 'أزياء ومستلزمات' },
  { id: 'women_supplies', label: 'مستلزمات نسائية', group: 'أزياء ومستلزمات' },
  { id: 'men_supplies', label: 'مستلزمات رجالية', group: 'أزياء ومستلزمات' },
  { id: 'kids', label: 'مستلزمات الأطفال', group: 'أزياء ومستلزمات' },
  { id: 'watches_accessories', label: 'ساعات وإكسسوارات', group: 'أزياء ومستلزمات' },
  { id: 'beauty', label: 'العناية والتجميل', group: 'أزياء ومستلزمات' },
  { id: 'sports', label: 'الرياضة', group: 'رياضة وهوايات وتعليم' },
  { id: 'gaming_hobbies', label: 'الألعاب والهوايات', group: 'رياضة وهوايات وتعليم' },
  { id: 'books_education', label: 'الكتب والتعليم', group: 'رياضة وهوايات وتعليم' },
  { id: 'arts', label: 'الفنون ومستلزماتها', group: 'رياضة وهوايات وتعليم' },
  { id: 'tools_equipment', label: 'معدات وأدوات', group: 'معدات وأدوات' },
  { id: 'agriculture', label: 'الزراعة والنباتات', group: 'الزراعة والحيوانات' },
  { id: 'animals', label: 'الحيوانات ومستلزماتها', group: 'الزراعة والحيوانات' },
  { id: 'camping', label: 'الرحلات والتخييم', group: 'الرحلات والتخييم' },
  { id: 'food', label: 'الأطعمة والمشروبات', group: 'الأطعمة والمشروبات' },
  { id: 'antiques', label: 'النوادر والتراثيات', group: 'النوادر والتراثيات' },
  { id: 'boats', label: 'القوارب والمستلزمات البحرية', group: 'سيارات ومركبات' },
  { id: 'services', label: 'الخدمات ومقدمو الخدمات', group: 'الخدمات والأعمال' },
  { id: 'business_equipment', label: 'التجهيزات التجارية والمكتبية', group: 'الخدمات والأعمال' },
  { id: 'businesses', label: 'المشاريع والمحلات للتنازل', group: 'الخدمات والأعمال' },
  { id: 'jobs', label: 'الوظائف', group: 'الوظائف والتدريب' },
  { id: 'training', label: 'التدريب والدورات', group: 'الوظائف والتدريب' },
  { id: 'events', label: 'المناسبات وتجهيزاتها', group: 'المناسبات والسفر' },
  { id: 'travel', label: 'السياحة والسفر', group: 'المناسبات والسفر' },
  { id: 'building_materials', label: 'مواد البناء والتشطيب', group: 'معدات وأدوات' },
  { id: 'other', label: 'أخرى', group: 'أخرى' },
] as const;

export type MarketplaceCategoryId = typeof marketplaceCategoryDefinitions[number]['id'];

export const marketplaceCategoryIds = marketplaceCategoryDefinitions.map(category => category.id);
const categoriesById = new Map<string, typeof marketplaceCategoryDefinitions[number]>(
  marketplaceCategoryDefinitions.map(category => [category.id, category]),
);

export function isMarketplaceCategory(value: string): value is MarketplaceCategoryId {
  return categoriesById.has(value);
}

export function formatMarketplaceCategory(value: string): string {
  return categoriesById.get(value)?.label ?? value;
}

export const marketplaceCategoryGroups: Array<{ label: string; categories: string[] }> = [];
for (const category of marketplaceCategoryDefinitions) {
  let group = marketplaceCategoryGroups.find(group => group.label === category.group);
  if (!group) {
    group = { label: category.group, categories: [] };
    marketplaceCategoryGroups.push(group);
  }
  group.categories.push(category.label);
}

export const marketplaceCategoryPrompt = marketplaceCategoryDefinitions
  .map(category => `${category.id} (${category.label})`).join(', ');

// Keyword searches can still find goods saved under the older, broader categories.
const legacySearchCategories: Partial<Record<MarketplaceCategoryId, string[]>> = {
  cameras: ['computers', 'other'],
  tablets: ['mobile_phones', 'computers', 'other'],
  home_appliances: ['home_garden', 'computers', 'other'],
  tv_audio: ['computers', 'home_garden', 'other'],
  networking: ['computers', 'other'],
  motorcycles: ['cars', 'sports', 'other'],
  heavy_equipment: ['cars', 'tools_equipment', 'other'],
  agriculture: ['home_garden', 'tools_equipment', 'other'],
  animals: ['other'],
  camping: ['sports', 'tools_equipment', 'other'],
  food: ['other'],
  antiques: ['home_garden', 'furniture', 'other'],
  arts: ['books_education', 'home_garden', 'other'],
};

export function getMarketplaceCategorySearchIds(category: string): string[] {
  return [category, ...(isMarketplaceCategory(category) ? legacySearchCategories[category] ?? [] : [])];
}
