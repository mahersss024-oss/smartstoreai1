'use client';

import { useEffect, useRef } from 'react';

import {
  APP_DISPLAY_MODE_ATTR,
  APP_DISPLAY_MODE_STANDALONE,
  WELCOME_COOKIE_NAME,
  WELCOME_FADE_MS,
  WELCOME_ID,
  WELCOME_SESSION_KEY,
  WELCOME_STANDALONE_FADE_MS,
  WELCOME_STANDALONE_VISIBLE_MS,
  WELCOME_VISIBLE_MS,
} from '@/lib/welcome/config';

const WELCOME_WORDMARK_SRC = '/hamad-market-wordmark.webp';

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
    const welcomeState = document.documentElement.getAttribute('data-welcome');
    if (welcomeState !== 'show') {
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
    try {
      window.sessionStorage.setItem(WELCOME_SESSION_KEY, '1');
    } catch {
      // Ignore storage failures.
    }
    document.cookie = `${WELCOME_COOKIE_NAME}=1; Path=/; SameSite=Lax`;
    const isStandalone =
      document.documentElement.getAttribute(APP_DISPLAY_MODE_ATTR) ===
      APP_DISPLAY_MODE_STANDALONE;
    const visibleMs = isStandalone
      ? WELCOME_STANDALONE_VISIBLE_MS
      : WELCOME_VISIBLE_MS;
    const fadeMs = isStandalone ? WELCOME_STANDALONE_FADE_MS : WELCOME_FADE_MS;

    // The visual lifecycle (hold + fade) is driven by CSS so the overlay always
    // disappears even if this script is interrupted. The visit is recorded
    // before the timer so route changes/reloads during the animation do not
    // replay the welcome screen on the next page.
    const removeTimer = window.setTimeout(() => {
      document.body.style.overflow = previousOverflow;
      root.remove();
      // Reveal the app at the same moment the welcome overlay leaves the DOM.
      document.documentElement.setAttribute('data-app-ready', '1');
    }, visibleMs + fadeMs);

    return () => {
      window.clearTimeout(removeTimer);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div
      id={WELCOME_ID}
      className="app-welcome"
      role="presentation"
    >
      <div className="app-welcome__backdrop" aria-hidden="true" />
      {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset
          used as a decorative splash layer. */}
      <img
        className="app-welcome__brand"
        src={WELCOME_WORDMARK_SRC}
        alt=""
        aria-hidden="true"
      />
      <div className="app-welcome__content">
        <p className="app-welcome__tagline">سوقك الذكي للبيع والشراء</p>

        <div className="app-welcome__loader" aria-hidden="true">
          <span />
        </div>
      </div>
    </div>
  );
}
