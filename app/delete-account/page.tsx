import type { Metadata } from 'next';
import { platformPolicies } from '@/lib/platform/policies';

import { DeleteAccountAction } from '@/components/delete-account-action';
import { LegalPolicyPage } from '@/components/legal-policy-page';

export const metadata: Metadata = {
  title: 'حذف الحساب | سوق حمد',
  description:
    'تعليمات طلب حذف حساب سوق حمد والبيانات المرتبطة به وفق متطلبات المتجر وسياسة الخصوصية.',
  alternates: {
    canonical: '/delete-account',
  },
};

const { updatedAt, sections } = platformPolicies.deletion;

export default function DeleteAccountPage() {
  return (
    <LegalPolicyPage
      title="حذف الحساب"
      eyebrow="إدارة بياناتك"
      description="توضح هذه الصفحة طريقة طلب حذف حسابك في سوق حمد وما يحدث للبيانات المرتبطة بالحساب بعد تقديم الطلب."
      updatedAt={updatedAt}
      sections={sections}
    >
      <DeleteAccountAction />
    </LegalPolicyPage>
  );
}
