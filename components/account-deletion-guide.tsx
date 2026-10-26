'use client';

import Link from 'next/link';
import { ArrowUpLeft, Mail, Smartphone } from 'lucide-react';
import { useState } from 'react';

import { mobileAppLaunchUrl } from '@/lib/mobile/app-store-links';
import { platformSupportEmail } from '@/lib/platform/policies';
import styles from './legal-policy-page.module.css';

const deletionSteps = ['حسابي', 'تعديل حسابي', 'حذف الحساب'];
const deletionRequestHref = `mailto:${platformSupportEmail}?subject=${encodeURIComponent('طلب حذف حساب')}`;

export function AccountDeletionGuide() {
  const [openingAttempted, setOpeningAttempted] = useState(false);

  return (
    <section className={styles.deletionGuide} aria-labelledby="account-deletion-heading">
      <div className={styles.guideHeading}>
        <span className={styles.guideIcon}><Smartphone size={22} aria-hidden="true" /></span>
        <div>
          <h2 id="account-deletion-heading">احذف حسابك من التطبيق</h2>
          <p>افتح تطبيق سوق حمد وسجّل الدخول إلى الحساب الذي تريد حذفه، ثم اتبع المسار:</p>
        </div>
      </div>

      <ol className={styles.deletionSteps} aria-label="خطوات حذف الحساب داخل التطبيق">
        {deletionSteps.map((step, index) => (
          <li key={step}><span aria-hidden="true">{index + 1}</span>{step}</li>
        ))}
      </ol>
      <p>راجع تفاصيل الحذف، ثم أكّد اختيارك داخل التطبيق لإتمام حذف الحساب.</p>
      <a href={mobileAppLaunchUrl} className={styles.appLaunch} onClick={() => setOpeningAttempted(true)}>
        فتح تطبيق سوق حمد<ArrowUpLeft size={18} aria-hidden="true" />
      </a>
      <p className={styles.launchHint} aria-live="polite">
        {openingAttempted
          ? 'إذا لم يفتح التطبيق، تأكد أنه مثبت على جوالك، أو استخدم البريد أدناه لطلب المساعدة.'
          : 'يفتح هذا الرابط التطبيق إذا كان مثبتًا على جوالك.'}
        {' '}<Link href="/" prefetch={false}>خيارات تحميل التطبيق</Link>
      </p>

      <div className={styles.deletionSupport}>
        <h3>تعذّر عليك الوصول إلى التطبيق أو حسابك؟</h3>
        <p>يمكنك طلب حذف حسابك عبر البريد. أرسل من البريد المرتبط بحسابك بعنوان «طلب حذف حساب»، واذكر طريقة تسجيل الدخول. لا ترسل كلمة مرور أو رمز تحقق.</p>
        <a className={styles.supportLink} href={deletionRequestHref}>
          <Mail size={18} aria-hidden="true" /><span dir="ltr">{platformSupportEmail}</span>
        </a>
        <p>يراجع الدعم الطلب ويتحقق من ملكية الحساب قبل تنفيذ الحذف.</p>
      </div>
    </section>
  );
}
