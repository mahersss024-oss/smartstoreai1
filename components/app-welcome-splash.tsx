'use client';

import { useEffect, useRef } from 'react';

import {
  WELCOME_FADE_MS,
  WELCOME_ID,
  WELCOME_SESSION_KEY,
  WELCOME_VISIBLE_MS,
} from '@/lib/welcome/config';

// The canonical brand logo. Reusing the exact asset used across the app
// guarantees the splash shows the real project logo (never a divergent copy).
const LOGO_SRC = '/smartstore-logo.svg';

/**
 * First-visit welcome overlay. The markup is rendered on the server so it is
 * present (and animating) on the very first paint — no post-hydration flash.
 * React only clears it away afterwards, and a matching head script removes it
 * instantly for returning visitors.
 */
export function AppWelcomeSplash() {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    // If the head script already flagged this as a returning visit, React takes
    // over removal so the element does not linger in the DOM.
    if (document.documentElement.getAttribute('data-welcome') === 'skip') {
      root.remove();
      document.documentElement.setAttribute('data-app-ready', '1');
      return;
    }

    const prefersReducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      root.remove();
      document.documentElement.setAttribute('data-app-ready', '1');
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // The visual lifecycle (hold + fade) is driven by CSS so the overlay always
    // disappears even if this script is interrupted. JS only records the visit,
    // reveals the app, and removes the now-hidden node from the DOM.
    const removeTimer = window.setTimeout(() => {
      try {
        window.sessionStorage.setItem(WELCOME_SESSION_KEY, '1');
      } catch {
        // Ignore storage failures.
      }
      document.body.style.overflow = previousOverflow;
      root.remove();
      // Reveal the app and drop the brand boot cover at the same moment.
      document.documentElement.setAttribute('data-app-ready', '1');
    }, WELCOME_VISIBLE_MS + WELCOME_FADE_MS);

    return () => {
      window.clearTimeout(removeTimer);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div id={WELCOME_ID} className="app-welcome" role="presentation">
      <div className="app-welcome__glow" />
      <div className="app-welcome__content">
        <div className="app-welcome__logo">
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand
              asset already shipped in /public; next/image adds no value here. */}
          <img src={LOGO_SRC} alt="SmartStore AI" width={256} height={256} />
        </div>

        <h1 className="app-welcome__title">SmartStore AI</h1>
        <p className="app-welcome__tagline">سوقك الذكي… بأسلوب المحادثة</p>

        <div className="app-welcome__loader" aria-hidden="true">
          <span />
        </div>
      </div>
    </div>
  );
}
