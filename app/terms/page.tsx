import type { Metadata } from 'next';
import { platformPolicies } from '@/lib/platform/policies';

import { LegalPolicyPage } from '@/components/legal-policy-page';

export const metadata: Metadata = {
  title: 'شروط الاستخدام | سوق حمد',
  description:
    'شروط استخدام سوق حمد كسوق ذكي للتسويق وبيع وشراء المنتجات داخل المنصة.',
};

const { updatedAt, sections } = platformPolicies.terms;

export default function TermsPage() {
  return (
    <LegalPolicyPage
      title="شروط الاستخدام"
      eyebrow="سوق حمد"
      description="هذه الشروط تنظم استخدام سوق حمد كسوق ذكي يعتمد على المحادثة والذكاء الاصطناعي لمساعدة المعلنين والمهتمين بالإعلانات."
      updatedAt={updatedAt}
      sections={sections}
    />
  );
}
