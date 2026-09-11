'use client';

import { useEffect, useState } from 'react';

const SESSION_KEY = 'smartstore_welcome_seen';
const MIN_VISIBLE_MS = 1500;
const FADE_OUT_MS = 600;

function shouldSkipWelcome() {
  if (typeof window === 'undefined') {
    return true;
  }

  try {
    if (window.sessionStorage.getItem(SESSION_KEY) === '1') {
      return true;
    }
  } catch {
    // Ignore storage access failures (private mode, etc.).
  }

  // Respect users who prefer reduced motion: skip the animated overlay.
  if (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    return true;
  }

  return false;
}

/**
 * First-visit welcome overlay: a polished, animated brand moment shown once per
 * browser session before the app appears. Mobile/tablet-first, RTL-aware, and
 * theme-aware (light/dark). It never blocks navigation for long and always
 * cleans itself up.
 */
type SplashPhase = 'idle' | 'visible' | 'leaving' | 'done';

export function AppWelcomeSplash() {
  const [phase, setPhase] = useState<SplashPhase>('idle');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (shouldSkipWelcome()) {
      return;
    }

    // Defer the first paint to the next frame so the mount does not trigger a
    // synchronous cascading render inside this effect.
    let exitTimer: ReturnType<typeof setTimeout> | null = null;
    let fadeTimer: ReturnType<typeof setTimeout> | null = null;

    const raf = window.requestAnimationFrame(() => {
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      setPhase('visible');

      const prefersReducedMotion =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const visibleMs = prefersReducedMotion ? 300 : MIN_VISIBLE_MS;

      exitTimer = setTimeout(() => {
        setPhase('leaving');
        fadeTimer = setTimeout(() => {
          setPhase('done');
          document.body.style.overflow = previousOverflow;
          try {
            window.sessionStorage.setItem(SESSION_KEY, '1');
          } catch {
            // Ignore storage failures.
          }
        }, FADE_OUT_MS);
      }, visibleMs);
    });

    return () => {
      window.cancelAnimationFrame(raf);
      if (exitTimer !== null) {
        clearTimeout(exitTimer);
      }
      if (fadeTimer !== null) {
        clearTimeout(fadeTimer);
      }
      document.body.style.overflow = '';
    };
  }, []);

  useEffect(() => {
    if (phase === 'visible') {
      const raf = window.requestAnimationFrame(() => setMounted(true));
      return () => window.cancelAnimationFrame(raf);
    }
  }, [phase]);

  if (phase === 'idle' || phase === 'done') {
    return null;
  }

  const leaving = phase === 'leaving';

  return (
    <div
      aria-hidden={leaving}
      className={`app-welcome ${mounted ? 'app-welcome--in' : ''} ${
        leaving ? 'app-welcome--out' : ''
      }`}
    >
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
