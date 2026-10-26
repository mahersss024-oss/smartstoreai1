import type { Metadata } from 'next';
import { platformPolicies } from '@/lib/platform/policies';

import { LegalPolicyPage } from '@/components/legal-policy-page';

export const metadata: Metadata = {
  title: 'سياسة الخصوصية | سوق حمد',
  description:
    'توضيح طريقة تعامل تطبيق سوق حمد مع بيانات الحساب والإعلانات والمحادثات والصور وحقوق المستخدم في حذف حسابه.',
  alternates: { canonical: '/privacy' },
};

const { updatedAt, sections } = platformPolicies.privacy;

export default function PrivacyPage() {
  return (
    <LegalPolicyPage
      title="سياسة الخصوصية"
      eyebrow="بيانات المستخدم"
      description="هذه السياسة توضّح كيف تتعامل سوق حمد مع بيانات الحساب والإعلانات والمحادثات والصور أثناء تشغيل السوق الذكي."
      updatedAt={updatedAt}
      sections={sections}
      path="/privacy"
    />
  );
}
