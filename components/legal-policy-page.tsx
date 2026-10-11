import Link from 'next/link';
import Image from 'next/image';
import type { ReactNode } from 'react';

import { Button } from '@ui/button';

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
  children?: ReactNode;
};

const policyLinks = [
  { href: '/terms', label: 'شروط الاستخدام' },
  { href: '/listing-policy', label: 'سياسة الإعلانات' },
  { href: '/commission-policy', label: 'سياسة رسوم المنصة' },
  { href: '/privacy', label: 'سياسة الخصوصية' },
  { href: '/delete-account', label: 'حذف الحساب' },
];

const SUPPORT_EMAIL = 'support@souqhamad.com';

function renderPolicyText(text: string) {
  const parts = text.split(SUPPORT_EMAIL);

  if (parts.length === 1) {
    return text;
  }

  return parts.map((part, index) => (
    <span key={`${part}-${index}`}>
      {part}
      {index < parts.length - 1 && (
        <a
          className="font-bold text-blue-700 underline dark:text-blue-300"
          href={`mailto:${SUPPORT_EMAIL}`}
        >
          {SUPPORT_EMAIL}
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
  children,
}: LegalPolicyPageProps) {
  return (
    <main className="min-h-screen bg-[#e8edf3] text-[#142033] dark:bg-[#0a111c] dark:text-foreground" dir="rtl">
      <div className="mx-auto grid w-full max-w-5xl gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-wrap items-center justify-between gap-3 px-1 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-10 place-items-center overflow-hidden rounded-md bg-white shadow-sm">
              <Image
                alt="سوق حمد"
                className="size-10 object-cover"
                height={40}
                src="/hamad-market-logo.jpeg"
                width={40}
              />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-blue-700 dark:text-blue-300">
                {eyebrow}
              </p>
              <h1 className="truncate text-xl font-bold">{title}</h1>
            </div>
          </div>
          <Button asChild variant="outline" size="sm" className="rounded-md">
            <Link href="/">العودة للسوق</Link>
          </Button>
        </header>

        <section className="grid gap-4 p-5">
          <div className="grid gap-2">
            <p className="text-sm leading-7 text-muted-foreground">
              آخر تحديث: {updatedAt}
            </p>
            <p className="max-w-3xl text-sm leading-8 text-muted-foreground">
              {description}
            </p>
          </div>

          <nav className="flex flex-wrap gap-2 border-t pt-4">
            {policyLinks.map((link) => (
              <Button
                asChild
                key={link.href}
                variant="outline"
                size="sm"
                className="h-9 rounded-md"
              >
                <Link href={link.href}>{link.label}</Link>
              </Button>
            ))}
          </nav>
        </section>

        <div className="grid gap-4">
          {sections.map((section) => (
            <section
              key={section.title}
              className="grid gap-3 border-t p-5"
            >
              <h2 className="text-lg font-bold">{section.title}</h2>
              {section.body && (
                <p className="text-sm leading-8 text-muted-foreground">
                  {renderPolicyText(section.body)}
                </p>
              )}
              {section.items && (
                <ul className="grid gap-2 text-sm leading-8 text-muted-foreground">
                  {section.items.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className="mt-3 size-1.5 shrink-0 rounded-full bg-blue-600" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>

        {children}

        <section className="rounded-md border border-amber-500/30 bg-amber-50 p-4 text-sm leading-7 text-amber-950 dark:bg-amber-400/10 dark:text-amber-100">
          هذه الصفحات توضح قواعد تشغيل سوق حمد للمستخدمين. يمكن تحديثها عند تطوير الخدمة أو تغير المتطلبات النظامية.
        </section>

        <section className="px-1 py-4 text-sm leading-7">
          <h2 className="mb-1 text-base font-bold">التواصل مع الإدارة</h2>
          <p className="text-muted-foreground">
            للاستفسارات الرسمية أو مراجعة السياسات:
            {' '}
            <a
              className="inline-flex h-9 items-center font-bold text-blue-700 underline dark:text-blue-300"
              href={`mailto:${SUPPORT_EMAIL}`}
            >
              {SUPPORT_EMAIL}
            </a>
          </p>
        </section>
      </div>
    </main>
  );
}
