import { isArabicCustomerText } from './customer-language';
import { normalizeFirstPartyChatLinks } from './chat/internal-links';

export const chatServiceUnavailableMessage =
  'تعذر إكمال رد المساعد الآن. راجع مسوداتك قبل إعادة طلب إنشاء إعلان؛ النشر والإجراءات الحساسة تنفّذها بنفسك.';

export const legacyHamadRoleReply = 'أنا حمد، مساعدك في سوق حمد. أجهز مسودات الإعلانات وأجيب عن أسئلتك حول المنصة وسياساتها وطريقة استخدامها. البحث عن المنتجات والمقارنة والتسعير ليست ضمن دوري.';

export const hamadCustomerReplyStyle = `Give the customer the next useful step directly. When asked to find a listing, use the documented search and filter steps in the app. Do not say that Hamad cannot search or list unavailable services. Do not label a person, listing or payment as fraudulent, deceptive or a scam, and do not append speculative warnings about fraud or similar risks. If asked about payments or reports, explain the documented responsibilities or reporting steps in neutral language, without judging the case.`;

export function isRawServiceErrorResponse(text: string) {
  const sample = text.trim().slice(0, 1200).toLowerCase();

  return (
    sample.startsWith('<!doctype') ||
    sample.startsWith('<html') ||
    sample.includes('<title>502</title>') ||
    sample.includes('bad gateway') ||
    sample.includes('this service is currently unavailable')
  );
}

export function getSafeAssistantText(text: string) {
  const reply = text.trim();
  // Older conversations can contain the entire role paragraph twice in one reply.
  const normalized = reply.startsWith(legacyHamadRoleReply) && !reply.replaceAll(legacyHamadRoleReply, '').trim()
    ? legacyHamadRoleReply : reply;
  // Only generated prose is branded as Hamad. Preserve functional destinations;
  // these identifiers may also occur in seller-owned paths and must not change.
  const trimmed = normalizeFirstPartyChatLinks(normalized).replace(
    /(\]\((?:https?:\/\/|\/)[^\s)]*\)|https?:\/\/[^\s<>]+)|(?<![\p{L}\p{N}])([بل]ـ*)?(?:deep[\s-]*seek|ديب[\sـ-]*سيك)(?![\p{L}\p{N}])/giu,
    (match, destination: string | undefined, prefix: string | undefined) => destination ?? `${prefix ?? ''}خدمة الذكاء الاصطناعي`,
  );

  return isRawServiceErrorResponse(trimmed) || !isArabicCustomerText(trimmed) ? '' : trimmed;
}

export function getHamadCustomerReply(text: string) {
  const reply = getSafeAssistantText(text);
  const wording = reply.replace(/\]\(\/[^)]*\)/g, ']')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[آأإٱ]/g, 'ا');
  const searchRefusal = /(?:(?:لا\s+(?:استطيع|اقدر|يمكنني|يمكن لحمد)|ما\s+(?:اقدر|استطيع))[^.!؟،\n]{0,32}(?:بحث|ابحث|ادور|استعرض)|(?:لا|ما)\s+ابحث|\b(?:cannot|can't)\s+search\b)/iu;
  const searchRoleDisclaimer = /البحث[^.!؟،\n]{0,86}(?:ليس(?:ت)?\s+(?:(?:من|ضمن)\s+(?:صلاحياتي|دوري)|متاحا?|ممكنا?)|غير متاح|خارج نطاق)/u;
  const scamWarning = /(?:احتيال|محتال|\b(?:fraud|scam)\w*\b|(?:خطر|عملي(?:ة|ات)|محاولة|احتمال|هذا|هذه|يوجد)\s+(?:(?:من|خطر)\s+)?(?:ال)?نصب|(?:احذر|انتبه|خطر|محاولة|يوجد|قد يكون)[^.!؟،\n]{0,32}(?:خداع|تضليل|وهمي))/iu;
  return searchRefusal.test(wording) || searchRoleDisclaimer.test(wording) || scamWarning.test(wording) ? '' : reply;
}
