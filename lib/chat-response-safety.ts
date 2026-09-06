export const chatServiceUnavailableMessage =
  'تعذر إكمال الطلب الآن بسبب انقطاع مؤقت في الخدمة. أعد المحاولة بعد لحظات، ولن يتم نشر أي إعلان حتى تكتمل المراجعة بنجاح.';

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
  const trimmed = text.trim();

  return isRawServiceErrorResponse(trimmed) ? '' : trimmed;
}
