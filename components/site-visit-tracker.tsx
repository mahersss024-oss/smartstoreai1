'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

import { scheduleIdleTask } from '@/lib/client-idle-task';

export function SiteVisitTracker() {
  const pathname = usePathname();

  useEffect(() => {
    return scheduleIdleTask(() => {
      const body = JSON.stringify({ path: pathname });

      if ('sendBeacon' in navigator) {
        const payload = new Blob([body], { type: 'application/json' });
        navigator.sendBeacon('/api/analytics/visit', payload);
        return;
      }

      void fetch('/api/analytics/visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => undefined);
    });
  }, [pathname]);

  return null;
}
