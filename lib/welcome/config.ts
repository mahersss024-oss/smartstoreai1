// Shared, framework-agnostic welcome-splash configuration.
//
// This module stays free of `'use client'` / React imports so it can be used
// both by the server-rendered <head> script (layout.tsx) and by the client
// overlay component. Keeping the key, id and timings in one place guarantees the
// head script and the component never drift apart.

export const WELCOME_SESSION_KEY = 'smartstore_welcome_seen';
export const WELCOME_ID = 'smartstore-welcome';

// How long the overlay stays fully visible before it starts to fade.
export const WELCOME_VISIBLE_MS = 2600;
// Duration of the fade-out transition (mirrors the CSS transition duration).
export const WELCOME_FADE_MS = 700;

/**
 * Tiny blocking script that runs in <head> before the first paint. It decides,
 * synchronously, whether the server-rendered welcome overlay should be shown:
 *  - hidden instantly if the visitor already saw it this session,
 *  - hidden instantly for reduced-motion users (they still get an instant app).
 *
 * Because it runs before paint, a returning visitor never sees a flash of the
 * overlay, and a first-time visitor sees it immediately (no post-hydration pop).
 */
export function buildWelcomeInitScript() {
  return `(function(){try{var shown=window.sessionStorage.getItem('${WELCOME_SESSION_KEY}')==='1';var reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;if(shown||reduce){document.documentElement.setAttribute('data-welcome','skip');document.documentElement.setAttribute('data-app-ready','1');}}catch(e){}})();`;
}

/**
 * Script that hides the boot cover as soon as the app is interactive. It runs on
 * the client after hydration; paired with `data-app-ready`, it guarantees the
 * brand cover is removed the instant the real UI is ready to be seen.
 */
export const APP_READY_FLAG = 'data-app-ready';

