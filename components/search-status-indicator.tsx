'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, SearchIcon } from 'lucide-react';

import { appCopy, type AppLanguage } from '@/app/i18n';
import { cn } from '@/lib/utils';

type SearchStatusMode = 'web' | 'thinking';

type SearchStatusIndicatorProps = {
  mode?: SearchStatusMode;
  query?: string;
  className?: string;
  language?: AppLanguage;
};

export function SearchStatusIndicator({
  mode = 'thinking',
  query,
  className,
  language = 'ar',
}: SearchStatusIndicatorProps) {
  const copy = appCopy[language];
  const phrases = useMemo(() => copy.status[mode], [copy, mode]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (phrases.length <= 1) {
      return;
    }

    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % phrases.length);
    }, 1400);

    return () => window.clearInterval(timer);
  }, [phrases]);

  const current = phrases[index] ?? phrases[0];

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-xl border bg-muted/30 px-4 py-3 text-sm text-muted-foreground',
        className,
      )}
      dir={copy.direction}
    >
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-background text-primary shadow-sm">
        <Loader2 className="size-4 animate-spin" />
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-foreground">
          <span className="font-medium">
            {query ? `${copy.status.queryPrefix} "${query}"` : current.title}
          </span>
          {!query && <SearchIcon className="size-4 animate-pulse text-primary" />}
        </div>
        <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {current.detail}
        </div>
      </div>
    </div>
  );
}
