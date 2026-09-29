/* eslint-disable @next/next/no-img-element */

import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import {
  ArrowRight,
  BadgeCheck,
  CalendarDays,
  Eye,
  MapPin,
  MessageCircle,
  PackageCheck,
  Star,
} from 'lucide-react';

import {
  getListing,
  getPublicSellerProfile,
  listMarketplaceListings,
} from '@/agent/marketplace/repository';
import { getComparableListings } from '@/agent/marketplace/market-intelligence';
import type { ListingRecord } from '@/agent/marketplace/store';
import type { ListingCondition } from '@/agent/marketplace/types';
import { getAuthSession } from '@/lib/auth/session';
import { Button } from '@ui/button';
import { ListingShareButton } from '@/components/listing-share-button';
import { SellerAvatar } from '@/components/seller-avatar';
import { ListingContactActions } from './contact-actions';
import {
  ListingImageGallery,
  type ListingGalleryImage,
} from './listing-image-gallery';
import { ListingSafetyActions } from './listing-safety-actions';
import { SimilarListingFollowButton } from './similar-follow-button';

type PageProps = {
  params: Promise<{
    listingId: string;
  }>;
  searchParams: Promise<{
    source?: string | string[];
    conversationId?: string | string[];
    sellerId?: string | string[];
    sellerSource?: string | string[];
    sourceListingId?: string | string[];
  }>;
};

export const dynamic = 'force-dynamic';

const missingListingImageDataUrl =
  'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%221200%22 height=%22750%22 viewBox=%220 0 1200 750%22%3E%3Crect width=%221200%22 height=%22750%22 fill=%22%23f1f5f9%22/%3E%3Cpath d=%22M514 308h172a34 34 0 0 1 34 34v120a34 34 0 0 1-34 34H514a34 34 0 0 1-34-34V342a34 34 0 0 1 34-34z%22 fill=%22none%22 stroke=%22%2394a3b8%22 stroke-width=%2216%22/%3E%3Ccircle cx=%22558%22 cy=%22372%22 r=%2224%22 fill=%22%2394a3b8%22/%3E%3Cpath d=%22m514 462 65-68 52 52 32-34 57 50%22 fill=%22none%22 stroke=%22%2394a3b8%22 stroke-width=%2216%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22/%3E%3Ctext x=%22600%22 y=%22562%22 text-anchor=%22middle%22 font-family=%22Arial, sans-serif%22 font-size=%2236%22 font-weight=%22700%22 fill=%22%2364758b%22%3ENo real photo%3C/text%3E%3C/svg%3E';

function getDurableImageUrl(...urls: Array<string | undefined>) {
  return urls.find((url) => {
    return (
      typeof url === 'string' &&
      url.length > 0 &&
      !url.startsWith('/uploads/listings/')
    );
  });
}

function formatPrice(price: number | 'bid' | 'negotiable' | undefined) {
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

function formatCategory(category: string) {
  const labels: Record<string, string> = {
    mobile_phones: 'الجوالات',
    cars: 'السيارات',
    auto_parts: 'قطع الغيار',
    computers: 'الأجهزة',
    real_estate: 'العقارات',
    furniture: 'الأثاث',
    fashion: 'الموضة',
    home_garden: 'المنزل والحديقة',
    sports: 'الرياضة',
    gaming_hobbies: 'الألعاب والهوايات',
    books_education: 'الكتب والتعليم',
    kids: 'مستلزمات الأطفال',
    women_supplies: 'مستلزمات نسائية',
    men_supplies: 'مستلزمات رجالية',
    tools_equipment: 'معدات وأدوات',
    watches_accessories: 'ساعات وإكسسوارات',
    beauty: 'العناية والتجميل',
    other: 'أخرى',
  };

  return labels[category] ?? category;
}

function formatCondition(condition: ListingCondition | undefined) {
  const labels: Record<ListingCondition, string> = {
    new: 'جديد',
    used: 'مستخدم',
    like_new: 'شبه جديد',
    damaged: 'يحتاج صيانة',
  };

  return condition ? labels[condition] : 'غير محددة';
}

function formatSaleTerms(
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

function formatAttributeLabel(key: string) {
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

function formatAttributeValue(key: string, value: unknown): string {
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ar-SA', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatRelativeListingTime(value: string) {
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

function getSingleSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function isSafePathSegment(value: string | undefined): value is string {
  return Boolean(value && /^[a-zA-Z0-9_-]+$/.test(value));
}

function getListingReturnHref(searchParams: Awaited<PageProps['searchParams']>) {
  const source = getSingleSearchParam(searchParams.source);
  const conversationId = getSingleSearchParam(searchParams.conversationId);
  const sellerId = getSingleSearchParam(searchParams.sellerId);
  const sellerSource = getSingleSearchParam(searchParams.sellerSource);
  const sourceListingId = getSingleSearchParam(searchParams.sourceListingId);

  if (source === 'conversation' && isSafePathSegment(conversationId)) {
    return `/conversations/${encodeURIComponent(conversationId)}`;
  }

  if (source === 'seller' && isSafePathSegment(sellerId)) {
    const query = new URLSearchParams();

    if (sellerSource === 'admin-users' || sellerSource === 'follows') {
      query.set('source', sellerSource);
    }

    if (sellerSource === 'conversation' && isSafePathSegment(conversationId)) {
      query.set('source', sellerSource);
      query.set('conversationId', conversationId);
    }

    if (sellerSource === 'listing' && isSafePathSegment(sourceListingId)) {
      query.set('source', sellerSource);
      query.set('listingId', sourceListingId);
    }

    const suffix = query.toString() ? `?${query.toString()}` : '';
    return `/sellers/${encodeURIComponent(sellerId)}${suffix}`;
  }

  if (source === 'favorites') {
    return '/favorites';
  }

  if (source === 'account-listings') {
    return '/account/listings';
  }

  if (source === 'listing' && isSafePathSegment(sourceListingId)) {
    return `/listings/${encodeURIComponent(sourceListingId)}`;
  }

  return '/';
}

function getSellerProfileHref(sellerId: string, listingId: string) {
  return `/sellers/${encodeURIComponent(sellerId)}?source=listing&listingId=${encodeURIComponent(listingId)}`;
}

function getSimilarListingHref(listingId: string, sourceListingId: string) {
  return `/listings/${encodeURIComponent(listingId)}?source=listing&sourceListingId=${encodeURIComponent(sourceListingId)}`;
}

function getListingPrimaryImage(listing: {
  images: Array<{
    isPrimary?: boolean;
    thumbnailUrl?: string;
    displayUrl?: string;
    originalUrl?: string;
  }>;
}) {
  const image =
    listing.images.find((candidate) => candidate.isPrimary) ??
    listing.images[0];

  return image
    ? getDurableImageUrl(
        image.thumbnailUrl,
        image.displayUrl,
        image.originalUrl,
      )
    : null;
}

function getDetailSimilarListings(
  listing: ListingRecord,
  candidates: ListingRecord[],
) {
  const strictMatches = getComparableListings(listing, candidates);

  const uniqueMatches = new Map<string, ListingRecord>();

  for (const candidate of strictMatches) {
    uniqueMatches.set(candidate.id, candidate);
  }

  return [...uniqueMatches.values()].slice(0, 6);
}

export default async function ListingDetailsPage({ params, searchParams }: PageProps) {
  const { listingId } = await params;
  const resolvedSearchParams = await searchParams;
  const listing = await getListing(listingId);

  if (!listing || listing.status !== 'published') {
    notFound();
  }

  const requestHeaders = await headers();
  const session = getAuthSession(
    new Request('https://souqhamad.local/listing-details', {
      headers: requestHeaders,
    }),
  );
  const isOwnListing = session?.user.id === listing.sellerId;
  const sellerProfile = await getPublicSellerProfile(listing.sellerId);
  const returnHref = getListingReturnHref(resolvedSearchParams);
  const sellerProfileHref = getSellerProfileHref(listing.sellerId, listing.id);
  const candidateSimilarListings = await listMarketplaceListings({
    category: listing.category,
    city: listing.city,
    limit: 24,
  });
  let similarListings = getDetailSimilarListings(
    listing,
    candidateSimilarListings,
  );

  if (similarListings.length < 3) {
    const widerSimilarListings = await listMarketplaceListings({
      category: listing.category,
      limit: 24,
    });

    similarListings = getDetailSimilarListings(
      listing,
      [...candidateSimilarListings, ...widerSimilarListings],
    );
  }

  const approvedImages = listing.images.filter(
    (image) => image.status === 'approved',
  );
  const durableApprovedImages = approvedImages
    .map((image): ListingGalleryImage | null => {
      const originalUrl = getDurableImageUrl(
        image.originalUrl,
        image.displayUrl,
        image.thumbnailUrl,
      );
      const displayUrl = getDurableImageUrl(
        image.displayUrl,
        image.originalUrl,
        image.thumbnailUrl,
      );
      const thumbnailUrl = getDurableImageUrl(
        image.thumbnailUrl,
        image.displayUrl,
        image.originalUrl,
      );

      if (!originalUrl || !displayUrl || !thumbnailUrl) {
        return null;
      }

      return {
        originalUrl,
        displayUrl,
        thumbnailUrl,
      };
    })
    .filter((image): image is ListingGalleryImage => Boolean(image));
  const images = durableApprovedImages.length
    ? durableApprovedImages
    : [
        {
          originalUrl: missingListingImageDataUrl,
          displayUrl: missingListingImageDataUrl,
          thumbnailUrl: missingListingImageDataUrl,
        },
      ];
  const attributes = Object.entries(listing.attributes).filter(([, value]) => {
    return value !== null && value !== undefined && String(value).trim() !== '';
  });
  const saleTerms = formatSaleTerms(listing.price, listing.attributes);

  return (
    <main className="min-h-screen bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground" dir="rtl">
      <div className="mx-auto grid max-w-4xl gap-3 px-3 py-4 sm:px-5">
        <header className="flex flex-wrap items-center justify-between gap-3 px-1 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Button asChild variant="outline" size="icon" className="rounded-md">
              <Link href={returnHref}>
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <div className="grid size-10 place-items-center overflow-hidden rounded-md bg-white dark:bg-card">
              <img alt="سوق حمد" className="size-10 object-cover" src="/hamad-market-logo.jpeg" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold">تفاصيل الإعلان</h1>
              <p className="truncate text-xs text-muted-foreground">سوق حمد</p>
            </div>
          </div>
        </header>

        <section className="grid items-start gap-4 px-1 py-3 sm:px-2 lg:grid-cols-[minmax(0,1fr)_14rem]">
          <div className="grid min-w-0 gap-3">
            <section className="px-1 py-2 sm:px-2">
              <div className="flex items-center gap-3">
                <Link
                  href={sellerProfileHref}
                  className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md bg-[#0f766e] text-lg font-bold text-white transition hover:opacity-85 active:scale-95"
                >
                  <SellerAvatar
                    alt={sellerProfile?.name ?? 'معلن سوق حمد'}
                    picture={sellerProfile?.picture}
                  />
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 text-xs font-semibold text-muted-foreground">
                    المعلن
                  </div>
                  <Link
                    href={sellerProfileHref}
                    className="block truncate text-sm font-bold transition hover:text-blue-600"
                  >
                    {sellerProfile?.name ?? 'معلن سوق حمد'}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>
                      {sellerProfile?.publishedListingCount ?? 1} إعلان منشور
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Star className="size-3.5 text-blue-500" />
                      {sellerProfile?.ratingCount ?? 0} تقييم
                    </span>
                  </div>
                </div>
              </div>
            </section>

            <ListingImageGallery
              images={images}
              title={listing.title ?? 'صورة الإعلان'}
            />

            <section className="grid gap-2 px-1 py-2 sm:px-2">
              {!isOwnListing && (
                <ListingContactActions
                  listingId={listing.id}
                  sellerPhoneNumber={sellerProfile?.phoneNumber}
                />
              )}
              <div className="grid grid-cols-2 gap-2">
                {!isOwnListing && (
                  <ListingSafetyActions
                    listingId={listing.id}
                    sellerId={listing.sellerId}
                    showReport={false}
                  />
                )}
                <ListingShareButton
                  className={`h-10 w-full rounded-md ${
                    isOwnListing ? 'col-span-2' : ''
                  }`}
                  listingId={listing.id}
                  title={listing.title ?? 'إعلان سوق حمد'}
                />
              </div>
            </section>

            <section className="px-1 py-3 sm:px-2">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:bg-blue-400/10 dark:text-blue-200">
                      {formatCategory(listing.category)}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200">
                      <BadgeCheck className="size-3.5" />
                      مطابق لسياسة السوق
                    </span>
                  </div>
                  <h2 className="text-xl font-bold leading-tight sm:text-2xl">{listing.title ?? 'إعلان بدون عنوان'}</h2>
                  <p className="mt-2 text-sm leading-7 text-muted-foreground">{listing.description ?? 'لا يوجد وصف مضاف لهذا الإعلان.'}</p>
                </div>
              </div>

              <div className="grid gap-3 border-t border-slate-200/60 pt-4 dark:border-white/10 sm:grid-cols-2 lg:grid-cols-3">
                <div className="pt-3">
                  <div className="text-xs text-muted-foreground">السعر</div>
                  <div className="mt-1 text-lg font-bold text-blue-700">{formatPrice(listing.price)}</div>
                </div>
                <div className="pt-3">
                  <div className="text-xs text-muted-foreground">المدينة</div>
                  <div className="mt-1 flex items-center gap-1 text-sm font-bold">
                    <MapPin className="size-4 text-blue-600" />
                    {listing.city ?? 'السعودية'}
                  </div>
                </div>
                <div className="pt-3">
                  <div className="text-xs text-muted-foreground">الحالة</div>
                  <div className="mt-1 text-sm font-bold">{formatCondition(listing.condition)}</div>
                </div>
                <div className="pt-3">
                  <div className="text-xs text-muted-foreground">طريقة البيع</div>
                  <div className="mt-1 text-sm font-bold">{saleTerms}</div>
                </div>
                <div className="pt-3">
                  <div className="text-xs text-muted-foreground">رقم الإعلان</div>
                  <div className="mt-1 truncate text-sm font-bold">{listing.id}</div>
                </div>
              </div>
            </section>

            <section className="px-1 py-3 sm:px-2">
              <div className="mb-3 flex items-center gap-2 text-sm font-bold">
                <PackageCheck className="size-4 text-blue-600" />
                بيانات المنتج
              </div>
              {attributes.length ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {attributes.map(([key, value]) => (
                    <div key={key} className="pt-3">
                      <div className="text-xs text-muted-foreground">{formatAttributeLabel(key)}</div>
                      <div className="mt-1 break-words text-sm font-semibold">
                        {formatAttributeValue(key, value)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="pt-4 text-sm leading-7 text-muted-foreground">
                  لا توجد بيانات إضافية محفوظة لهذا الإعلان حتى الآن.
                </p>
              )}
            </section>

          </div>

          <aside className="grid h-fit gap-3">
            <section className="px-1 py-3 sm:px-2">
              <div className="mb-4">
                <div className="text-xs text-muted-foreground">السعر المطلوب</div>
                <div className="mt-1 text-xl font-bold text-blue-700">{formatPrice(listing.price)}</div>
              </div>
              <ListingShareButton
                className="mb-3 hidden h-11 w-full rounded-md"
                listingId={listing.id}
                title={listing.title ?? 'إعلان سوق حمد'}
              />
              <ListingSafetyActions
                listingId={listing.id}
                sellerId={listing.sellerId}
                isOwnListing={isOwnListing}
                showFavorite={false}
              />
            </section>

            <section className="px-1 py-3 sm:px-2">
              <div className="mb-3 text-sm font-bold">نشاط الإعلان</div>
              <div className="grid gap-2 text-sm text-muted-foreground">
                <div className="flex items-center justify-between gap-2 py-2">
                  <span className="flex items-center gap-2">
                    <Eye className="size-4 text-blue-600" />
                    المشاهدات
                  </span>
                  <strong className="text-foreground">{listing.views}</strong>
                </div>
                <div className="flex items-center justify-between gap-2 py-2">
                  <span className="flex items-center gap-2">
                    <MessageCircle className="size-4 text-blue-600" />
                    الرسائل
                  </span>
                  <strong className="text-foreground">{listing.messageCount}</strong>
                </div>
                <div className="flex items-center justify-between gap-2 py-2">
                  <span className="flex items-center gap-2">
                    <CalendarDays className="size-4 text-blue-600" />
                    نُشر
                  </span>
                  <strong className="text-foreground">
                    {formatRelativeListingTime(listing.createdAt)}
                  </strong>
                </div>
                <div className="flex items-center justify-between gap-2 py-2">
                  <span className="flex items-center gap-2">
                    <CalendarDays className="size-4 text-blue-600" />
                    آخر تحديث
                  </span>
                  <strong className="text-foreground">{formatDate(listing.updatedAt)}</strong>
                </div>
              </div>
            </section>

            {!isOwnListing && (
              <section className="px-1 py-3 sm:px-2">
                <SimilarListingFollowButton listingId={listing.id} />
              </section>
            )}

            {similarListings.length > 0 && (
              <section className="px-1 py-3 sm:px-2">
                <div className="mb-3 flex items-center gap-2 text-sm font-bold">
                  <PackageCheck className="size-4 text-blue-600" />
                  إعلانات مشابهة
                </div>
                <div className="grid gap-2">
                  {similarListings.map((similarListing) => {
                    const imageUrl = getListingPrimaryImage(similarListing);

                    return (
                      <Link
                        key={similarListing.id}
                        className="grid grid-cols-[5.5rem_minmax(0,1fr)] overflow-hidden rounded-md border border-slate-200 bg-white text-right transition hover:border-blue-300 hover:bg-blue-50/35 dark:border-white/10 dark:bg-card dark:hover:bg-blue-400/10"
                        href={getSimilarListingHref(similarListing.id, listing.id)}
                      >
                        <div className="aspect-square overflow-hidden bg-slate-100 dark:bg-slate-900">
                          {imageUrl ? (
                            <img
                              alt={similarListing.title ?? 'صورة الإعلان'}
                              className="h-full w-full object-cover"
                              decoding="async"
                              loading="lazy"
                              src={imageUrl}
                            />
                          ) : (
                            <div className="grid h-full place-items-center">
                              <PackageCheck className="size-6 text-slate-400" />
                            </div>
                          )}
                        </div>
                        <div className="grid min-w-0 content-center gap-1 px-3 py-2">
                          <div className="line-clamp-2 text-[13px] font-bold leading-5 text-emerald-700 dark:text-emerald-300">
                            {similarListing.title ?? 'إعلان مشابه'}
                          </div>
                          <div className="truncate text-sm font-bold">
                            {formatPrice(similarListing.price)}
                          </div>
                          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                            <span className="truncate">
                              {similarListing.city ?? 'السعودية'}
                            </span>
                            <span className="truncate">
                              {formatCategory(similarListing.category)}
                            </span>
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </section>
            )}
          </aside>
        </section>
      </div>
    </main>
  );
}
