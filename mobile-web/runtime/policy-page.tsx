'use client';

import { DeleteAccountAction } from '../../components/delete-account-action';
import { LegalPolicyPage } from '../../components/legal-policy-page';
import { platformPolicies } from '../../lib/platform/policies';

export type MobilePolicyKind = 'terms' | 'privacy' | 'commissions' | 'listings' | 'deletion';

const policyPresentation = {
  "terms": {
    "eyebrow": "سوق حمد",
    "description": "هذه الشروط تنظم استخدام سوق حمد كسوق ذكي يعتمد على المحادثة والذكاء الاصطناعي لمساعدة المعلنين والمهتمين بالإعلانات."
  },
  "privacy": {
    "eyebrow": "بيانات المستخدم",
    "description": "هذه السياسة توضّح كيف تتعامل سوق حمد مع بيانات الحساب والإعلانات والمحادثات والصور أثناء تشغيل السوق الذكي."
  },
  "commissions": {
    "eyebrow": "رسوم سوق حمد",
    "description": "هذه السياسة توضّح متى تستحق رسوم 1%، وكيف يتم حسابها وإدارتها عند إتمام البيع عبر المنصة."
  },
  "listings": {
    "eyebrow": "قواعد السوق",
    "description": "هذه السياسة تحدد ما يمكن نشره في سوق حمد، وكيف تُراجع الصور والبيانات لحماية المعلن والطرف المهتم من التضليل والمخالفات."
  },
  "deletion": {
    "eyebrow": "إدارة بياناتك",
    "description": "توضح هذه الصفحة طريقة طلب حذف حسابك في سوق حمد وما يحدث للبيانات المرتبطة بالحساب بعد تقديم الطلب."
  }
} satisfies Record<MobilePolicyKind, { eyebrow: string; description: string }>;

const policyByKind = {
  terms: platformPolicies.terms,
  privacy: platformPolicies.privacy,
  commissions: platformPolicies.commissions,
  listings: platformPolicies.listings,
  deletion: platformPolicies.deletion,
};

export function MobilePolicyPage({ kind }: { kind: MobilePolicyKind }) {
  const policy = policyByKind[kind];

  return (
    <LegalPolicyPage
      title={policy.title}
      eyebrow={policyPresentation[kind].eyebrow}
      description={policyPresentation[kind].description}
      updatedAt={policy.updatedAt}
      sections={policy.sections}
    >
      {kind === 'deletion' ? <DeleteAccountAction /> : null}
    </LegalPolicyPage>
  );
}
