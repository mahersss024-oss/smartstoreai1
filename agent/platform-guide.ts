import { platformPolicies } from '@/lib/platform/policies';
import { marketplaceCategoryDefinitions } from '@/lib/marketplace/categories';
import { marketplaceCategoryOptionGroups } from '@/lib/marketplace/category-options';
import { getMaxListingsPerSeller } from '@/agent/marketplace/listing-limits';
import { getMaxListingImagesPerListing } from '@/agent/marketplace/listing-image-limits';

export const platformHelpTopics = ['overview', 'account', 'listings', 'search', 'conversations', 'favorites', 'reports', 'notifications', 'follows', 'support', 'commissions', 'terms', 'privacy', 'listing_policy', 'deletion'] as const;
type HelpTopic = typeof platformHelpTopics[number];
type Workflow = { path: string; title: string; steps: string[] };

const workflows: Partial<Record<HelpTopic, Workflow>> = {
  overview: { path: '/', title: 'سوق حمد', steps: ['منصة لعرض الإعلانات والتواصل بين المستخدمين. حمد يجهز مسودات الإعلانات ويشرح المنصة وسياساتها فقط.', 'البحث عن المنتجات والمقارنة والتسعير والتفاوض ليست خدمات يقدمها حمد. استخدم أدوات السوق المتاحة بنفسك.'] },
  account: { path: '/account', title: 'حسابي', steps: ['افتح حسابي لإدارة بياناتك وإعلاناتك ومفضلتك وإعدادات الحساب.', 'يتطلب استخدام حمد تسجيل الدخول بأحد مزودي الدخول المتاحين. لا تشارك بيانات الدخول داخل المحادثة.'] },
  listings: { path: '/account/listings', title: 'إعلاناتي', steps: ['يمكنك اختيار إنشاء الإعلان مع حمد أو الإنشاء اليدوي من الصفحة الرئيسية.', 'مع حمد: اختر الإنشاء مع حمد، ثم أرسل بيانات المنتج والصور الاختيارية لتجهيز مسودة.', 'يدويًا: افتح إنشاء إعلان يدويًا، وأدخل البيانات، واختر حفظ المسودة أو راجع الإعلان وانشره بنفسك.', 'افتح إعلاناتي لمراجعة المسودة وتعديلها ونشرها بنفسك. حمد لا ينشر ولا يغير الإعلانات غير المسودة أو حالتها.'] },
  search: { path: '/', title: 'البحث في السوق', steps: ['اكتب عنوان المنتج أو رقم الإعلان في حقل ابحث في كل السوق.', 'استخدم خيارات التصنيف والمدينة وبقية الفلاتر المتاحة لتصفية النتائج، واضغط البطاقة لفتح تفاصيل الإعلان.', 'حمد يشرح استخدام البحث فقط، ولا يسترجع المنتجات أو يبحث عنها داخل الشات.'] },
  conversations: { path: '/conversations', title: 'محادثاتي', steps: ['افتح تفاصيل الإعلان ثم استخدم زر التواصل المتاح للتواصل مع المعلن بنفسك.', 'تابع المحادثات من محادثاتي. حمد لا يفتح محادثة ولا يرسل رسائل نيابةً عنك.', 'سوق حمد لا يحتفظ بأموال البيع بين الأطراف ولا يضمن التحويلات المباشرة.'] },
  favorites: { path: '/favorites', title: 'المفضلة', steps: ['استخدم زر المفضلة المتاح للإعلان بنفسك، ثم افتح المفضلة لمراجعة الإعلانات المحفوظة.', 'حمد يشرح الخطوات فقط ولا يضيف أو يزيل المفضلة.'] },
  reports: { path: '/listing-policy', title: 'البلاغات', steps: ['استخدم خيار الإبلاغ المتاح في صفحة الإعلان أو المحادثة أو المستخدم، وحدد السبب وأرسل البلاغ بنفسك.', 'تراجع الإدارة البلاغات وفق صلاحياتها والسياسات. حمد لا يقدم بلاغًا ولا يقرر نتيجته ولا يضمن وقتًا للرد.'] },
  notifications: { path: '/notifications', title: 'الإشعارات', steps: ['افتح حسابي ثم الإشعارات للاطلاع على سجل إشعارات حسابك.', 'افتح الإشعار المطلوب أو استخدم خيارات الحذف المتاحة بنفسك. لا يستطيع حمد قراءة إشعاراتك أو حذفها.'] },
  follows: { path: '/account/follows', title: 'قائمة المتابعة', steps: ['افتح حسابي ثم قائمة المتابعة للاطلاع على المتابعين ومن تتابعهم ومتابعة الإعلانات المشابهة.', 'تغييرات المتابعة والتقييمات والبلاغات تتم من الخيارات المتاحة في واجهة المستخدم، وليس عن طريق حمد.'] },
  support: { path: '/privacy', title: 'الدعم والمعلومات غير المتاحة', steps: ['راجع وسائل التواصل المنشورة في سياسة الخصوصية. لا يطلع حمد على حالة طلب دعم أو بلاغ أو قرار إدارة خاص بحسابك.', 'إذا لم توجد إجابة موثقة فلا تخمّن السبب أو السياسة أو النتيجة، ولا تعد العميل بتعويض أو استثناء أو موعد.'] },
};

const policiesByTopic: Partial<Record<HelpTopic, (typeof platformPolicies)[keyof typeof platformPolicies]>> = {
  commissions: platformPolicies.commissions, terms: platformPolicies.terms,
  privacy: platformPolicies.privacy, listing_policy: platformPolicies.listings,
  deletion: platformPolicies.deletion,
};

export function getPlatformHelp(topic: HelpTopic) {
  const source = policiesByTopic[topic] ?? workflows[topic];
  if (!source) throw new Error('Unsupported platform help topic');
  return {
    status: 'documented' as const,
    source,
    ...(['listings', 'search'].includes(topic) ? { catalog: marketplaceCategoryDefinitions.map(category => ({ ...category, ...marketplaceCategoryOptionGroups[category.id] })), catalogRules: 'التصنيف ثم البراند أو النوع. السيارات فقط تتيح اختيار السيارة التابعة للبراند، دون سنوات أو فئات تجهيز. لا توجد قائمة براندات للملابس ولا قسم مفقودات. الاختيار اختياري ويستخدم في فلترة السوق، وليس بحثًا ينفذه حمد.' } : {}),
    ...(topic === 'support' ? { relatedPolicies: [platformPolicies.privacy] } : {}),
    ...(topic === 'listings' ? { configuredLimits: { listingsPerSeller: getMaxListingsPerSeller(), imagesPerListing: getMaxListingImagesPerListing() } } : {}),
    rules: 'Use only these documented facts. Cite the relevant source path in Arabic when useful. These are public platform documents, not personal account data. Do not infer private account status, payment details, exceptions, guarantees or unlisted features. Explain uncertainty honestly; never invent a policy or support channel. Current assistant capabilities are draft preparation and platform help only; historical descriptions in policies do not grant tools or actions.',
  };
}
