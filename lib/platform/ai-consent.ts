export const aiSharingConsent = {
  version: 'deepseek-sharing-2026-11-02-v1',
  provider: 'DeepSeek',
  description: 'تُرسل رسائلك والصور التي تختارها لحمد، أو عنوان إعلانك عند اقتراح التصنيف، إلى DeepSeek لمعالجة طلبك. يمكنك إنشاء الإعلان واختيار تصنيفه يدويًا دون الموافقة.',
} as const;
export const aiConsentHeader = 'x-souq-hamad-ai-consent';
export function hasAiSharingConsent(request: Request) {
  return request.headers.get(aiConsentHeader) === aiSharingConsent.version;
}
export function aiConsentRequiredResponse() {
  return Response.json({ error: 'ai_consent_required', message: 'وافق على مشاركة البيانات مع خدمة الذكاء الاصطناعي قبل استخدام حمد أو اقتراح التصنيف.', aiConsent: aiSharingConsent }, {
    status: 409, headers: { 'Cache-Control': 'private, no-store' },
  });
}
