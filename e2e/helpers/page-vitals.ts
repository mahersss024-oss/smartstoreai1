import type { Page } from '@playwright/test';

type LabVitals = {
  lcp: number | null;
  cls: number;
  interactionMax: number | null;
  eventEntries: number;
  trustedKeydowns: number;
  supported: string[];
  interactions: Array<{ name: string; target: string; duration: number; inputDelay: number; processing: number; presentation: number }>;
};

declare global {
  interface Window {
    __allPageVitals: LabVitals;
  }
}

export async function observePageVitals(page: Page) {
  await page.addInitScript(() => {
    const state: LabVitals = {
      lcp: null, cls: 0, interactionMax: null, eventEntries: 0,
      trustedKeydowns: 0, supported: [...PerformanceObserver.supportedEntryTypes],
      interactions: [],
    };
    window.__allPageVitals = state;
    let windowStart = 0;
    let previousShift = 0;
    let windowScore = 0;
    if (state.supported.includes('layout-shift')) {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries() as Array<PerformanceEntry & { hadRecentInput: boolean; value: number }>) {
          if (entry.hadRecentInput) continue;
          if (entry.startTime - previousShift > 1000 || entry.startTime - windowStart > 5000) {
            windowStart = entry.startTime;
            windowScore = 0;
          }
          windowScore += entry.value;
          previousShift = entry.startTime;
          state.cls = Math.max(state.cls, windowScore);
        }
      }).observe({ type: 'layout-shift', buffered: true });
    }
    if (state.supported.includes('largest-contentful-paint')) {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) state.lcp = entry.startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    }
    if (state.supported.includes('event')) {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries() as Array<PerformanceEventTiming & { interactionId: number }>) {
          if (!entry.interactionId) continue;
          state.eventEntries++;
          state.interactionMax = Math.max(state.interactionMax ?? 0, entry.duration);
          if (state.interactions.length < 50) state.interactions.push({
            name: entry.name, target: entry.target instanceof Element ? `${entry.target.tagName}.${[...entry.target.classList].slice(0, 3).join('.')}` : '',
            duration: entry.duration, inputDelay: entry.processingStart - entry.startTime,
            processing: entry.processingEnd - entry.processingStart,
            presentation: entry.startTime + entry.duration - entry.processingEnd,
          });
        }
      }).observe({ type: 'event', buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
    }
    window.addEventListener('keydown', event => {
      if (event.isTrusted) state.trustedKeydowns++;
    }, true);
  });
}

export async function readPageVitals(page: Page) {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    return {
      ...window.__allPageVitals,
      // Short laboratory interaction sample, not a field-data INP percentile.
      interactionBelowReportingThreshold: window.__allPageVitals.interactionMax === null &&
        window.__allPageVitals.trustedKeydowns > 0 && window.__allPageVitals.supported.includes('event'),
      ttfb: nav.responseStart - nav.requestStart,
      domNodes: document.getElementsByTagName('*').length,
      horizontalOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    };
  });
}
