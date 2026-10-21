import { isArabicCustomerText } from './customer-language';
import { normalizeFirstPartyChatLinks } from './chat/internal-links';

export const chatServiceUnavailableMessage =
  'تعذر إكمال رد المساعد الآن. راجع مسوداتك قبل إعادة طلب إنشاء إعلان؛ النشر والإجراءات الحساسة تنفّذها بنفسك.';

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
  const trimmed = normalizeFirstPartyChatLinks(text.trim());

  return isRawServiceErrorResponse(trimmed) || !isArabicCustomerText(trimmed) ? '' : trimmed;
}
