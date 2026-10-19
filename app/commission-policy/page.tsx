import type { Metadata } from 'next';
import { platformPolicies } from '@/lib/platform/policies';

import { LegalPolicyPage } from '@/components/legal-policy-page';

export const metadata: Metadata = {
  title: 'سياسة رسوم المنصة | سوق حمد',
  description:
    'سياسة رسوم منصة سوق حمد عند إتمام البيع من خلال المنصة.',
};

const { updatedAt, sections } = platformPolicies.commissions;

export default function CommissionPolicyPage() {
  return (
    <LegalPolicyPage
      title="سياسة رسوم المنصة"
      eyebrow="رسوم سوق حمد"
      description="هذه السياسة توضّح متى تستحق رسوم 1%، وكيف يتم حسابها وإدارتها عند إتمام البيع عبر المنصة."
      updatedAt={updatedAt}
      sections={sections}
    />
  );
}
