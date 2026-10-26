import type { Metadata } from 'next';
import { platformPolicies } from '@/lib/platform/policies';

import { LegalPolicyPage } from '@/components/legal-policy-page';

export const metadata: Metadata = {
  title: 'شروط الاستخدام | سوق حمد',
  description:
    'شروط استخدام تطبيق سوق حمد ونشر الإعلانات والتواصل بين المستخدمين.',
  alternates: { canonical: '/terms' },
};

const { updatedAt, sections } = platformPolicies.terms;

export default function TermsPage() {
  return (
    <LegalPolicyPage
      title="شروط الاستخدام"
      eyebrow="سوق حمد"
      description="توضح هذه الشروط قواعد استخدام تطبيق سوق حمد، ونشر الإعلانات، والتواصل بين المعلنين والمهتمين، ودور المساعد حمد."
      updatedAt={updatedAt}
      sections={sections}
      path="/terms"
    />
  );
}
