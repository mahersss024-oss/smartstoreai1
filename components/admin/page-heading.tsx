import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import type { ReactNode } from 'react';

export function AdminPageHeading({
  title,
  actions,
}: {
  title: string;
  actions?: ReactNode;
}) {
  return (
    <header className="admin-page-heading">
      <div className="min-w-0">
        <div className="mb-2 flex items-center gap-1 text-xs text-muted-foreground">
          <Link href="/admin" prefetch={false} className="hover:text-primary">
            نظرة عامة
          </Link>
          <ChevronLeft className="size-3" aria-hidden="true" />
          <span>{title}</span>
        </div>
        <h1 className="text-lg font-bold">{title}</h1>
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  );
}
