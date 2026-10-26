import Image from 'next/image';
import Link from 'next/link';
import { ArrowUpLeft, Mail, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';

import { platformSupportEmail } from '@/lib/platform/policies';
import { publicLegalLinks } from '@/lib/platform/legal-routes';
import styles from './legal-policy-page.module.css';

type LegalSection = {
  title: string;
  body?: string;
  items?: string[];
};

type LegalPolicyPageProps = {
  title: string;
  eyebrow: string;
  description: string;
  updatedAt: string;
  sections: LegalSection[];
  path?: string;
  lead?: ReactNode;
  children?: ReactNode;
};

function renderPolicyText(text: string) {
  const parts = text.split(platformSupportEmail);

  return parts.map((part, index) => (
    <span key={`${part}-${index}`}>
      {part}
      {index < parts.length - 1 && (
        <a href={`mailto:${platformSupportEmail}`} dir="ltr">
          {platformSupportEmail}
        </a>
      )}
    </span>
  ));
}

export function LegalPolicyPage({
  title,
  eyebrow,
  description,
  updatedAt,
  sections,
  path,
  lead,
  children,
}: LegalPolicyPageProps) {
  const currentPath = path ?? publicLegalLinks.find(link => link.label === title)?.href;

  return (
    <main className={styles.page} dir="rtl">
      <a className={styles.skipLink} href="#policy-content">انتقل إلى محتوى السياسة</a>

      <div className={styles.container}>
        <header className={styles.header}>
          <Link className={styles.brand} href="/" prefetch={false} aria-label="سوق حمد — الصفحة الرئيسية">
            <Image alt="" src="/hamad-market-logo.webp" width={48} height={48} unoptimized priority />
            <span>سوق حمد<small>السياسات والمساعدة</small></span>
          </Link>
          <Link className={styles.gatewayLink} href="/" prefetch={false}>
            تطبيق سوق حمد<ArrowUpLeft size={16} aria-hidden="true" />
          </Link>
        </header>

        <div className={styles.layout}>
          <aside className={styles.sidebar}>
            <nav aria-label="سياسات سوق حمد" className={styles.policyNav}>
              <p className={styles.navLabel}>السياسات</p>
              {publicLegalLinks.map(link => (
                <Link
                  className={styles.policyLink}
                  href={link.href}
                  prefetch={false}
                  key={link.href}
                  aria-current={currentPath === link.href ? 'page' : undefined}
                >
                  {link.label}
                  {currentPath === link.href && <span className={styles.activeDot} aria-hidden="true" />}
                </Link>
              ))}
            </nav>
            <div className={styles.sidebarNote}>
              <ShieldCheck size={22} aria-hidden="true" />
              <p>معلومات واضحة عن استخدام التطبيق وحقوقك وبياناتك.</p>
            </div>
          </aside>

          <div className={styles.content}>
            <header className={styles.hero}>
              <p className={styles.eyebrow}>{eyebrow}</p>
              <h1>{title}</h1>
              <p className={styles.description}>{description}</p>
              <p className={styles.updatedAt}>آخر تحديث: <span>{updatedAt}</span></p>
            </header>

            {lead}

            <article className={styles.document} id="policy-content" tabIndex={-1} aria-label={title}>
              {sections.map((section, index) => (
                <section key={section.title} className={styles.section}>
                  <h2><span className={styles.sectionNumber} aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>{section.title}</h2>
                  {section.body && <p>{renderPolicyText(section.body)}</p>}
                  {section.items && (
                    <ul>
                      {section.items.map(item => <li key={item}>{renderPolicyText(item)}</li>)}
                    </ul>
                  )}
                </section>
              ))}
            </article>

            {children}

            <section className={styles.footer} aria-label="التواصل والدعم">
              <div>
                <h2>لديك استفسار عن هذه السياسة؟</h2>
                <p>تواصل مع دعم سوق حمد للاستفسار عن السياسات أو بيانات حسابك.</p>
              </div>
              <a className={styles.supportLink} href={`mailto:${platformSupportEmail}`}>
                <Mail size={18} aria-hidden="true" /><span dir="ltr">{platformSupportEmail}</span>
              </a>
              <p className={styles.updateNote}>قد تُحدّث هذه السياسات عند تطوير الخدمة أو تغيّر المتطلبات النظامية. راجع تاريخ آخر تحديث أعلى الصفحة.</p>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
