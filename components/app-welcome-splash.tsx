'use client';

import { useEffect, useRef } from 'react';

import {
  WELCOME_FADE_MS,
  WELCOME_ID,
  WELCOME_SESSION_KEY,
  WELCOME_VISIBLE_MS,
} from '@/lib/welcome/config';

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
      return;
    }

    const prefersReducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      root.remove();
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const startExit = window.setTimeout(() => {
      document.body.style.overflow = previousOverflow;
      try {
        window.sessionStorage.setItem(WELCOME_SESSION_KEY, '1');
      } catch {
        // Ignore storage failures.
      }
      root.classList.add('app-welcome--out');
      window.setTimeout(() => root.remove(), WELCOME_FADE_MS);
    }, WELCOME_VISIBLE_MS);

    return () => {
      window.clearTimeout(startExit);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div id={WELCOME_ID} className="app-welcome" role="presentation">
      <div className="app-welcome__glow" />
      <div className="app-welcome__content">
        <div className="app-welcome__logo" aria-hidden="true">
          <svg viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient
                id="welcomeBg"
                x1="30"
                y1="28"
                x2="226"
                y2="228"
                gradientUnits="userSpaceOnUse"
              >
                <stop offset="0" stopColor="#0E4FA2" />
                <stop offset="0.56" stopColor="#1C98D2" />
                <stop offset="1" stopColor="#67D8FF" />
              </linearGradient>
            </defs>
            <rect width="256" height="256" rx="56" fill="url(#welcomeBg)" />
            <rect
              x="38"
              y="38"
              width="180"
              height="180"
              rx="44"
              fill="white"
              fillOpacity="0.08"
            />
            <path
              d="M86 94C86 81.8497 95.8497 72 108 72H148C160.15 72 170 81.8497 170 94V103H86V94Z"
              fill="white"
              fillOpacity="0.96"
            />
            <path
              d="M88 104H168V171C168 184.255 157.255 195 144 195H112C98.7452 195 88 184.255 88 171V104Z"
              fill="white"
              fillOpacity="0.16"
              stroke="white"
              strokeOpacity="0.9"
              strokeWidth="8"
              strokeLinejoin="round"
            />
            <path
              d="M106 103V88C106 77.5066 114.507 69 125 69H131C141.493 69 150 77.5066 150 88V103"
              stroke="white"
              strokeOpacity="0.96"
              strokeWidth="8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M158 129C152 118 141 113 128 113C111 113 99 120 99 131C99 143 110 147 124 150C142 153 157 159 157 172C157 186 143 195 121 195C106 195 94 190 85 182"
              stroke="#F4FCFF"
              strokeWidth="18"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="176" cy="79" r="4.5" fill="#F8E18A" />
            <circle cx="186" cy="91" r="2.8" fill="#FFFFFF" fillOpacity="0.88" />
            <circle cx="171" cy="93" r="2.2" fill="#FFFFFF" fillOpacity="0.72" />
          </svg>
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
