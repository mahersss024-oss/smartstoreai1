export const aiSharingConsent = {
  version: 'ai-sharing-2026-11-02-v2',
  provider: 'خدمة الذكاء الاصطناعي',
  description: 'تُرسل رسائلك والصور التي تختارها في محادثة حمد إلى خدمة خارجية للذكاء الاصطناعي لمعالجة طلبك. يمكنك رفض المشاركة، أو سحب الموافقة من حسابي، والاستمرار في تصفح السوق وإنشاء إعلان يدويًا.',
} as const;
export const aiConsentHeader = 'x-souq-hamad-ai-consent';
export function hasAiSharingConsent(request: Request) {
  const version = request.headers.get(aiConsentHeader);
  // Existing installations already obtained permission to share Hamad messages
  // and selected images. Keep their receipts valid while they refresh bootstrap.
  return version === aiSharingConsent.version || version === 'deepseek-sharing-2026-11-02-v1';
}
export function aiConsentRequiredResponse() {
  return Response.json({ error: 'ai_consent_required', message: 'وافق على مشاركة رسائلك والصور التي تختارها قبل استخدام حمد.', aiConsent: aiSharingConsent }, {
    status: 409, headers: { 'Cache-Control': 'private, no-store' },
  });
}
