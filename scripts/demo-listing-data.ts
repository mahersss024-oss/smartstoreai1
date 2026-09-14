import type { CreateListingInput } from '@/agent/marketplace/repository';

export const defaultDemoListingSeedCount = 1000;
export const defaultDemoListingsPerSeller = 20;
export const demoSellerIdPrefix = 'demo-load-seller-';
export const demoSellerEmailDomain = 'smartstore-demo.local';
export const demoDatasetId = 'smartstore-capacity-demo-v1';

export const demoListingCategories = [
  {
    category: 'cars',
    label: 'السيارات',
    products: [
      'تويوتا كامري 2025',
      'نيسان باترول LE 2025',
      'هيونداي سوناتا 2024',
      'لكزس ES 2023',
    ],
  },
  {
    category: 'auto_parts',
    label: 'قطع الغيار',
    products: [
      'إطارات مقاس 17',
      'بطارية سيارة أصلية',
      'شمعات أمامية LED',
      'فلتر زيت وفلتر هواء',
    ],
  },
  {
    category: 'mobile_phones',
    label: 'الجوالات',
    products: [
      'آيفون 15 برو',
      'سامسونج جالكسي S24',
      'شاومي ريدمي نوت',
      'آيباد ميني',
    ],
  },
  {
    category: 'computers',
    label: 'الأجهزة',
    products: [
      'لابتوب ديل XPS',
      'ماك بوك برو',
      'شاشة ألعاب 27 بوصة',
      'جهاز مكتبي للأعمال',
    ],
  },
  {
    category: 'real_estate',
    label: 'العقارات',
    products: [
      'شقة عائلية',
      'فيلا دوبلكس',
      'مكتب تجاري',
      'أرض سكنية',
    ],
  },
  {
    category: 'furniture',
    label: 'الأثاث',
    products: [
      'كنب مجلس',
      'طاولة طعام',
      'سرير غرفة نوم',
      'مكتب منزلي',
    ],
  },
  {
    category: 'fashion',
    label: 'الموضة',
    products: [
      'حقيبة جلدية',
      'حذاء رسمي',
      'ساعة كلاسيكية',
      'نظارة شمسية',
    ],
  },
  {
    category: 'home_garden',
    label: 'المنزل والحديقة',
    products: [
      'مكيف سبليت',
      'غسالة ملابس',
      'طقم أواني مطبخ',
      'جلسة حديقة',
    ],
  },
  {
    category: 'sports',
    label: 'الرياضة',
    products: [
      'جهاز مشي كهربائي',
      'دراجة رياضية',
      'طقم أوزان',
      'مضرب تنس',
    ],
  },
  {
    category: 'gaming_hobbies',
    label: 'الألعاب والهوايات',
    products: [
      'بلايستيشن 5',
      'إكس بوكس سيريس',
      'كاميرا هواة',
      'طائرة تصوير صغيرة',
    ],
  },
  {
    category: 'books_education',
    label: 'الكتب والتعليم',
    products: [
      'كتب جامعية',
      'دورة لغة إنجليزية',
      'مكتب دراسة',
      'آلة حاسبة علمية',
    ],
  },
  {
    category: 'kids',
    label: 'مستلزمات الأطفال',
    products: [
      'عربة أطفال',
      'كرسي سيارة للطفل',
      'سرير أطفال',
      'ألعاب تعليمية',
    ],
  },
  {
    category: 'tools_equipment',
    label: 'معدات وأدوات',
    products: [
      'دريل كهربائي',
      'عدة صيانة منزلية',
      'ماكينة لحام',
      'سلم ألمنيوم',
    ],
  },
  {
    category: 'watches_accessories',
    label: 'ساعات وإكسسوارات',
    products: [
      'ساعة ذكية',
      'سوار جلد',
      'محفظة رجالية',
      'قلم فاخر',
    ],
  },
  {
    category: 'beauty',
    label: 'العناية والتجميل',
    products: [
      'مجموعة عناية بالبشرة',
      'مجفف شعر',
      'ماكينة حلاقة',
      'مرآة إضاءة',
    ],
  },
  {
    category: 'other',
    label: 'أخرى',
    products: [
      'قسيمة خدمة',
      'حقيبة سفر',
      'طابعة مكتبية',
      'رف تخزين',
    ],
  },
] as const;

export type DemoListingSeedEntry = {
  index: number;
  sellerIndex: number;
  seller: {
    id: string;
    email: string;
    name: string;
  };
  listing: CreateListingInput;
  categoryLabel: string;
  productName: string;
};

const cities = [
  'الرياض',
  'جدة',
  'الدمام',
  'مكة',
  'المدينة',
  'الخبر',
  'الطائف',
  'أبها',
  'تبوك',
  'بريدة',
];

const conditions = ['new', 'like_new', 'used'] as const;

function padIndex(value: number) {
  return String(value).padStart(4, '0');
}

function getPrice(index: number, category: string) {
  const priceBases: Record<string, number> = {
    cars: 45000,
    auto_parts: 180,
    mobile_phones: 900,
    computers: 1200,
    real_estate: 180000,
    furniture: 350,
    fashion: 120,
    home_garden: 250,
    sports: 220,
    gaming_hobbies: 300,
    books_education: 60,
    kids: 90,
    tools_equipment: 160,
    watches_accessories: 140,
    beauty: 70,
    other: 100,
  };

  const base = priceBases[category] ?? 100;
  return base + ((index * 137) % Math.max(base, 10000));
}

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function getDemoSellerId(sellerIndex: number) {
  return `${demoSellerIdPrefix}${padIndex(sellerIndex)}`;
}

export function buildDemoListingSeed(
  count = defaultDemoListingSeedCount,
  listingsPerSeller = defaultDemoListingsPerSeller,
) {
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error('Demo listing count must be a positive integer.');
  }

  if (!Number.isInteger(listingsPerSeller) || listingsPerSeller <= 0) {
    throw new Error('Demo listings per seller must be a positive integer.');
  }

  return Array.from({ length: count }, (_, itemIndex): DemoListingSeedEntry => {
    const index = itemIndex + 1;
    const categoryInfo =
      demoListingCategories[itemIndex % demoListingCategories.length];
    const productName =
      categoryInfo.products[
        Math.floor(itemIndex / demoListingCategories.length) %
          categoryInfo.products.length
      ];
    const city = cities[itemIndex % cities.length];
    const condition = conditions[itemIndex % conditions.length];
    const sellerIndex = Math.floor(itemIndex / listingsPerSeller);
    const listingNumber = padIndex(index);
    const title = `[تجريبي] ${productName} رقم ${listingNumber}`;

    return {
      index,
      sellerIndex,
      seller: {
        id: getDemoSellerId(sellerIndex),
        email: `${getDemoSellerId(sellerIndex)}@${demoSellerEmailDomain}`,
        name: `بائع تجريبي ${padIndex(sellerIndex + 1)}`,
      },
      listing: {
        category: categoryInfo.category,
        title,
        description:
          `إعلان تجريبي لاختبار قدرة SmartStore AI. المنتج: ${productName}. ` +
          `التصنيف: ${categoryInfo.label}. المدينة: ${city}. الصورة موسومة بكلمة تجريبي.`,
        price: getPrice(index, categoryInfo.category),
        city,
        condition,
        attributes: {
          demo: true,
          demoDataset: demoDatasetId,
          demoIndex: index,
          productName,
          categoryLabel: categoryInfo.label,
          city,
          condition,
          searchKeywords: [productName, categoryInfo.label, city, 'تجريبي'],
        },
      },
      categoryLabel: categoryInfo.label,
      productName,
    };
  });
}

export function createDemoListingImageDataUrl(entry: DemoListingSeedEntry) {
  const hue = (entry.index * 37) % 360;
  const title = escapeXml(entry.productName);
  const category = escapeXml(entry.categoryLabel);
  const number = escapeXml(padIndex(entry.index));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900" direction="rtl">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="hsl(${hue}, 54%, 18%)"/>
      <stop offset="52%" stop-color="hsl(${(hue + 44) % 360}, 60%, 26%)"/>
      <stop offset="100%" stop-color="hsl(${(hue + 92) % 360}, 66%, 34%)"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="900" rx="44" fill="url(#bg)"/>
  <rect x="72" y="72" width="1056" height="756" rx="36" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.35)" stroke-width="4"/>
  <text x="600" y="360" text-anchor="middle" font-family="Arial, Tahoma, sans-serif" font-size="132" font-weight="800" fill="#ffffff">تجريبي</text>
  <text x="600" y="490" text-anchor="middle" font-family="Arial, Tahoma, sans-serif" font-size="54" font-weight="700" fill="#dffcf0">${title}</text>
  <text x="600" y="590" text-anchor="middle" font-family="Arial, Tahoma, sans-serif" font-size="42" font-weight="600" fill="#b8f7e0">${category}</text>
  <text x="600" y="700" text-anchor="middle" font-family="Arial, Tahoma, sans-serif" font-size="34" font-weight="700" fill="#ffffff">SmartStore AI Demo #${number}</text>
</svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}
