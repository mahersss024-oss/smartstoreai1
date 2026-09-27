import { AlertTriangle, CircleAlert, Info } from 'lucide-react';
import { connection } from 'next/server';

import { getActiveSiteMessage } from '@/lib/site-message';

const presentation = {
  info: {
    icon: Info,
    className: 'border-blue-300 bg-blue-50 text-blue-950 dark:border-blue-800 dark:bg-blue-950/70 dark:text-blue-100',
  },
  warning: {
    icon: CircleAlert,
    className: 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/70 dark:text-amber-100',
  },
  maintenance: {
    icon: AlertTriangle,
    className: 'border-teal-300 bg-teal-50 text-teal-950 dark:border-teal-800 dark:bg-teal-950/70 dark:text-teal-100',
  },
} as const;

export async function SiteMessageBanner() {
  await connection();
  const siteMessage = await getActiveSiteMessage();

  if (!siteMessage) return null;

  const style = presentation[siteMessage.type];
  const Icon = style.icon;

  return (
    <aside
      aria-live="polite"
      className={`relative z-40 border-b px-4 py-2.5 text-sm ${style.className}`}
      dir="rtl"
      role="status"
    >
      <div className="mx-auto flex max-w-6xl items-start justify-center gap-2 leading-6">
        <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>{siteMessage.message}</p>
      </div>
    </aside>
  );
}
