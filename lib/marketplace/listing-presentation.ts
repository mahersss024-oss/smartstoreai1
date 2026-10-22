import type { ListingCondition } from '@/agent/marketplace/types';

export function formatPrice(price: number | 'bid' | 'negotiable' | undefined) {
  if (typeof price === 'number') {
    return `${new Intl.NumberFormat('ar-SA').format(price)} ر.س`;
  }

  if (price === 'bid') {
    return 'على السوم';
  }

  if (price === 'negotiable') {
    return 'قابل للتفاوض';
  }

  return 'السعر غير محدد';
}


export function formatCondition(condition: ListingCondition | undefined) {
  const labels: Record<ListingCondition, string> = {
    new: 'جديد',
    used: 'مستخدم',
    like_new: 'شبه جديد',
    damaged: 'يحتاج صيانة',
  };

  return condition ? labels[condition] : 'غير محددة';
}

export function formatSaleTerms(
  price: number | 'bid' | 'negotiable' | undefined,
  attributes: Record<string, unknown>,
) {
  const saleTerms = String(attributes.saleTerms ?? '').toLowerCase();

  if (price === 'bid' || saleTerms === 'auction') {
    return 'على السوم';
  }

  if (price === 'negotiable' || saleTerms === 'negotiable') {
    return 'قابل للتفاوض';
  }

  if (saleTerms === 'open_to_offers') {
    return 'يقبل العروض';
  }

  if (typeof price === 'number' || saleTerms === 'fixed') {
    return 'سعر ثابت';
  }

  return 'غير محددة';
}

export function formatAttributeLabel(key: string) {
  const labels: Record<string, string> = {
    name: 'الاسم',
    title: 'العنوان',
    description: 'الوصف',
    category: 'القسم',
    subcategory: 'القسم الفرعي',
    type: 'النوع',
    productType: 'نوع المنتج',
    itemType: 'نوع السلعة',
    status: 'الحالة',
    condition: 'حالة المنتج',
    saleTerms: 'طريقة البيع',
    priceType: 'نوع السعر',
    askingPrice: 'السعر المطلوب',
    finalPrice: 'السعر النهائي',
    minPrice: 'أقل سعر',
    maxPrice: 'أعلى سعر',
    negotiable: 'قابل للتفاوض',
    paymentMethod: 'طريقة الدفع',
    paymentMethods: 'طرق الدفع',
    deliveryMethod: 'طريقة التسليم',
    deliveryMethods: 'طرق التسليم',
    shipping: 'الشحن',
    shippingCost: 'تكلفة الشحن',
    pickup: 'الاستلام',
    pickupLocation: 'موقع الاستلام',
    returnPolicy: 'سياسة الاسترجاع',
    exchangePolicy: 'سياسة الاستبدال',
    availability: 'التوفر',
    quantity: 'الكمية',
    stock: 'المتوفر',
    orderType: 'نوع الطلب',
    offerType: 'نوع العرض',
    usageNotes: 'الاستخدام',
    usageDuration: 'مدة الاستخدام',
    usageLevel: 'مستوى الاستخدام',
    age: 'العمر',
    purchaseDate: 'تاريخ الشراء',
    originalPrice: 'السعر الأصلي',
    invoice: 'الفاتورة',
    hasInvoice: 'توجد فاتورة',
    receipt: 'الإيصال',
    warranty: 'الضمان',
    warrantyStatus: 'حالة الضمان',
    warrantyDuration: 'مدة الضمان',
    warrantyProvider: 'مزود الضمان',
    authenticity: 'الأصالة',
    original: 'أصلي',
    accessories: 'الملحقات',
    includedAccessories: 'الملحقات المرفقة',
    missingAccessories: 'الملحقات الناقصة',
    box: 'الكرتون',
    hasBox: 'يوجد كرتون',
    manual: 'الكتيب',
    notes: 'ملاحظات',
    defects: 'الملاحظات',
    defectsDetails: 'تفاصيل العيوب',
    hasDefects: 'توجد عيوب',
    repairs: 'الإصلاحات',
    repairHistory: 'سجل الإصلاحات',
    maintenance: 'الصيانة',
    maintenanceHistory: 'سجل الصيانة',
    inspection: 'الفحص',
    inspectionStatus: 'حالة الفحص',
    inspectionNotes: 'ملاحظات الفحص',
    color: 'اللون',
    size: 'المقاس',
    dimensions: 'الأبعاد',
    length: 'الطول',
    width: 'العرض',
    height: 'الارتفاع',
    weight: 'الوزن',
    material: 'الخامة',
    brand: 'العلامة',
    manufacturer: 'الشركة المصنعة',
    model: 'الموديل',
    modelNumber: 'رقم الموديل',
    serialNumber: 'الرقم التسلسلي',
    version: 'الإصدار',
    generation: 'الجيل',
    releaseYear: 'سنة الإصدار',
    year: 'سنة الصنع',
    mileageKm: 'الممشى',
    mileage: 'الممشى',
    transmission: 'ناقل الحركة',
    fuelType: 'نوع الوقود',
    engineSize: 'حجم المحرك',
    trim: 'الفئة',
    specs: 'المواصفات',
    features: 'المميزات',
    storage: 'سعة التخزين',
    memory: 'الذاكرة',
    ram: 'الرام',
    screenSize: 'حجم الشاشة',
    processor: 'المعالج',
    gpu: 'كرت الشاشة',
    batteryHealth: 'صحة البطارية',
    battery: 'البطارية',
    camera: 'الكاميرا',
    network: 'الشبكة',
    sim: 'الشريحة',
    simType: 'نوع الشريحة',
    carrier: 'المشغل',
    operatingSystem: 'نظام التشغيل',
    capacity: 'السعة',
    exteriorColor: 'اللون الخارجي',
    interiorColor: 'اللون الداخلي',
    ownership: 'الملكية',
    ownerCount: 'عدد الملاك',
    bodyType: 'نوع الهيكل',
    cylinders: 'عدد الأسطوانات',
    seats: 'عدد المقاعد',
    doors: 'عدد الأبواب',
    driveType: 'نظام الدفع',
    plateType: 'نوع اللوحة',
    accidentHistory: 'سجل الحوادث',
    serviceHistory: 'سجل الصيانة',
    registration: 'الاستمارة',
    registrationExpiry: 'انتهاء الاستمارة',
    insurance: 'التأمين',
    insuranceExpiry: 'انتهاء التأمين',
    propertyType: 'نوع العقار',
    area: 'المساحة',
    rooms: 'عدد الغرف',
    bedrooms: 'غرف النوم',
    bathrooms: 'دورات المياه',
    floor: 'الدور',
    floors: 'عدد الأدوار',
    furnished: 'مؤثث',
    frontage: 'الواجهة',
    streetWidth: 'عرض الشارع',
    ageOfProperty: 'عمر العقار',
    services: 'الخدمات',
    rentPeriod: 'مدة الإيجار',
    leaseTerm: 'مدة العقد',
    fabric: 'القماش',
    fit: 'القصة',
    gender: 'الفئة',
    targetGender: 'الفئة المناسبة',
    style: 'النمط',
    pattern: 'النقشة',
    serviceType: 'نوع الخدمة',
    experience: 'الخبرة',
    duration: 'المدة',
    appointment: 'الموعد',
    contactMethod: 'طريقة التواصل',
    location: 'الموقع',
    locationDetails: 'تفاصيل الموقع',
    city: 'المدينة',
    district: 'الحي',
    sellerNotes: 'ملاحظات المعلن',
    sellerType: 'نوع المعلن',
  };

  const normalizedKey = key.replace(/-([a-z])/g, '_$1');
  const camelKey = normalizedKey.replace(/_([a-z])/g, (_, letter: string) =>
    letter.toUpperCase(),
  );

  return labels[key] ?? labels[normalizedKey] ?? labels[camelKey] ?? 'تفصيل إضافي';
}

export function formatAttributeValue(key: string, value: unknown): string {
  if (key === 'saleTerms') {
    return formatSaleTerms(undefined, { saleTerms: value });
  }

  const numberFormatter = new Intl.NumberFormat('ar-SA');
  const plainNumberFormatter = new Intl.NumberFormat('ar-SA', { useGrouping: false });

  if ((key === 'mileageKm' || key === 'mileage') && typeof value === 'number') {
    return `${numberFormatter.format(value)} كم`;
  }

  if (['askingPrice', 'finalPrice', 'minPrice', 'maxPrice', 'originalPrice', 'shippingCost'].includes(key) && typeof value === 'number') {
    return `${numberFormatter.format(value)} ريال`;
  }

  if (['area', 'streetWidth'].includes(key) && typeof value === 'number') {
    return `${numberFormatter.format(value)} م²`;
  }

  if (['storage', 'memory', 'ram', 'capacity'].includes(key) && typeof value === 'number') {
    return `${numberFormatter.format(value)} جيجابايت`;
  }

  if (['screenSize', 'length', 'width', 'height'].includes(key) && typeof value === 'number') {
    return numberFormatter.format(value);
  }

  if ((key === 'year' || key === 'cylinders' || key === 'seats' || key === 'doors') && typeof value === 'number') {
    return plainNumberFormatter.format(value);
  }

  if (typeof value === 'string') {
    const normalizedValue = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
    const optionLabels: Record<string, string> = {
      fixed: 'سعر ثابت',
      negotiable: 'قابل للتفاوض',
      auction: 'على السوم',
      bid: 'على السوم',
      open_to_offers: 'يقبل العروض',
      available: 'متوفر',
      unavailable: 'غير متوفر',
      reserved: 'محجوز',
      sold: 'تم البيع',
      draft: 'مسودة',
      published: 'منشور',
      paused: 'موقوف النشر',
      deleted: 'محذوف',
      new: 'جديد',
      used: 'مستخدم',
      like_new: 'شبه جديد',
      damaged: 'يحتاج صيانة',
      excellent: 'ممتاز',
      very_good: 'جيد جدًا',
      good: 'جيد',
      fair: 'مقبول',
      poor: 'ضعيف',
      automatic: 'أوتوماتيك',
      manual: 'يدوي',
      gasoline: 'بنزين',
      petrol: 'بنزين',
      diesel: 'ديزل',
      hybrid: 'هايبرد',
      electric: 'كهربائي',
      gas: 'غاز',
      valid: 'سليم',
      pending: 'بانتظار المراجعة',
      rejected: 'مرفوض',
      approved: 'معتمد',
      needs_review: 'يحتاج مراجعة',
      needs_retake: 'يحتاج صورة أوضح',
      no_defects: 'لا توجد عيوب',
      with_defects: 'توجد عيوب',
      private: 'ملكية خاصة',
      dealer: 'معرض',
      agency: 'وكالة',
      individual: 'فرد',
      company: 'شركة',
      store: 'متجر',
      cash: 'نقدًا',
      bank_transfer: 'تحويل بنكي',
      card: 'بطاقة',
      stc_pay: 'STC Pay',
      apple_pay: 'Apple Pay',
      mada: 'مدى',
      delivery: 'توصيل',
      shipping: 'شحن',
      pickup: 'استلام',
      meet_up: 'تسليم بالاتفاق',
      local_delivery: 'توصيل داخل المدينة',
      free_shipping: 'شحن مجاني',
      buyer_pays_shipping: 'الشحن على المشتري',
      seller_pays_shipping: 'الشحن على المعلن',
      return_available: 'الاسترجاع متاح',
      no_returns: 'لا يوجد استرجاع',
      exchange_available: 'الاستبدال متاح',
      original: 'أصلي',
      copy: 'نسخة',
      refurbished: 'مجدد',
      imported: 'مستورد',
      local: 'محلي',
      under_warranty: 'تحت الضمان',
      expired_warranty: 'انتهى الضمان',
      no_warranty: 'بدون ضمان',
      invoice_available: 'الفاتورة متوفرة',
      no_invoice: 'لا توجد فاتورة',
      box_available: 'الكرتون موجود',
      no_box: 'بدون كرتون',
      front_wheel: 'دفع أمامي',
      rear_wheel: 'دفع خلفي',
      all_wheel: 'دفع كلي',
      four_wheel: 'دفع رباعي',
      sedan: 'سيدان',
      suv: 'دفع رباعي / SUV',
      coupe: 'كوبيه',
      hatchback: 'هاتشباك',
      pickup_truck: 'بيك أب',
      van: 'فان',
      truck: 'شاحنة',
      motorcycle: 'دراجة نارية',
      apartment: 'شقة',
      villa: 'فيلا',
      land: 'أرض',
      shop: 'محل',
      office: 'مكتب',
      warehouse: 'مستودع',
      studio: 'استوديو',
      furnished: 'مؤثث',
      unfurnished: 'غير مؤثث',
      semi_furnished: 'مؤثث جزئيًا',
      daily: 'يومي',
      weekly: 'أسبوعي',
      monthly: 'شهري',
      yearly: 'سنوي',
      male: 'رجالي',
      female: 'نسائي',
      kids: 'أطفال',
      unisex: 'للجميع',
      ready_for_inspection: 'جاهز للفحص',
      ready: 'جاهز',
      not_ready: 'غير جاهز',
    };

    return optionLabels[normalizedValue] ?? value;
  }

  if (typeof value === 'boolean') {
    return value ? 'نعم' : 'لا';
  }

  if (Array.isArray(value)) {
    return value
      .filter(Boolean)
      .map((item) => formatAttributeValue(key, item))
      .join('، ');
  }

  if (value && typeof value === 'object') {
    return Object.entries(value)
      .map(([entryKey, entryValue]) => {
        return `${formatAttributeLabel(entryKey)}: ${formatAttributeValue(entryKey, entryValue)}`;
      })
      .join('، ');
  }

  return String(value);
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat('ar-SA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function formatRelativeListingTime(value: string) {
  const date = new Date(value);
  const timestamp = date.getTime();

  if (Number.isNaN(timestamp)) {
    return 'غير محدد';
  }

  const diffMs = timestamp - Date.now();
  const absDiffMs = Math.abs(diffMs);
  const relativeFormatter = new Intl.RelativeTimeFormat('ar-SA', {
    numeric: 'auto',
  });
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const month = 30 * day;
  const year = 365 * day;

  if (absDiffMs < minute) {
    return 'الآن';
  }

  if (absDiffMs < hour) {
    return relativeFormatter.format(Math.round(diffMs / minute), 'minute');
  }

  if (absDiffMs < day) {
    return relativeFormatter.format(Math.round(diffMs / hour), 'hour');
  }

  if (absDiffMs < month) {
    return relativeFormatter.format(Math.round(diffMs / day), 'day');
  }

  if (absDiffMs < year) {
    return relativeFormatter.format(Math.round(diffMs / month), 'month');
  }

  return relativeFormatter.format(Math.round(diffMs / year), 'year');
}
