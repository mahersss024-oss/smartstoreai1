import type { Metadata } from 'next';
import { platformPolicies } from '@/lib/platform/policies';

import { LegalPolicyPage } from '@/components/legal-policy-page';

export const metadata: Metadata = {
  title: 'سياسة الإعلانات | سوق حمد',
  description:
    'قواعد نشر الإعلانات والصور والمحتوى المسموح والممنوع في سوق حمد.',
  alternates: { canonical: '/listing-policy' },
};

const { updatedAt, sections } = platformPolicies.listings;

export default function ListingPolicyPage() {
  return (
    <LegalPolicyPage
      title="سياسة الإعلانات"
      eyebrow="قواعد السوق"
      description="هذه السياسة تحدد ما يمكن نشره في سوق حمد، وكيف تُراجع الصور والبيانات لحماية المعلن والطرف المهتم من التضليل والمخالفات."
      updatedAt={updatedAt}
      sections={sections}
      path="/listing-policy"
    />
  );
}
