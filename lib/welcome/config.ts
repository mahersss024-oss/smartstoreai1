// Shared, framework-agnostic welcome-splash configuration.
//
// This module stays free of `'use client'` / React imports so it can be used
// both by the server-rendered <head> script (layout.tsx) and by the client
// overlay component. Keeping the key, id and timings in one place guarantees the
// head script and the component never drift apart.

export const WELCOME_SESSION_KEY = 'smartstore_welcome_seen';
export const WELCOME_COOKIE_NAME = 'smartstore_welcome_seen';
export const WELCOME_ID = 'smartstore-welcome';
export const APP_DISPLAY_MODE_ATTR = 'data-app-display';
export const APP_DISPLAY_MODE_STANDALONE = 'standalone';

// How long the overlay stays fully visible before it starts to fade. Keep this
// short so the first meaningful page paint is not delayed by the brand handoff.
export const WELCOME_VISIBLE_MS = 1400;
// Duration of the fade-out transition (mirrors the CSS transition duration).
export const WELCOME_FADE_MS = 320;
// Installed iOS/Android PWAs already show a native launch screen, so the
// in-app welcome should be a shorter brand handoff rather than a second splash.
export const WELCOME_STANDALONE_VISIBLE_MS = 950;
export const WELCOME_STANDALONE_FADE_MS = 260;

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
  const browserLifecycleMs = WELCOME_VISIBLE_MS + WELCOME_FADE_MS;
  const standaloneLifecycleMs =
    WELCOME_STANDALONE_VISIBLE_MS + WELCOME_STANDALONE_FADE_MS;

  return `(function(){var d=document.documentElement;try{var m=window.matchMedia;var standalone=(window.navigator&&window.navigator.standalone===true)||(m&&((m('(display-mode: standalone)').matches)||(m('(display-mode: fullscreen)').matches)));if(standalone){d.setAttribute('${APP_DISPLAY_MODE_ATTR}','${APP_DISPLAY_MODE_STANDALONE}');}var stored=false;try{stored=window.sessionStorage.getItem('${WELCOME_SESSION_KEY}')==='1';}catch(e){}var cookie=(document.cookie||'').indexOf('${WELCOME_COOKIE_NAME}=1')!==-1;var reduce=m&&m('(prefers-reduced-motion: reduce)').matches;if(stored||cookie||reduce){d.setAttribute('data-welcome','skip');d.setAttribute('data-app-ready','1');}else{d.setAttribute('data-welcome','show');try{window.sessionStorage.setItem('${WELCOME_SESSION_KEY}','1');}catch(e){}document.cookie='${WELCOME_COOKIE_NAME}=1; Path=/; SameSite=Lax';window.setTimeout(function(){d.setAttribute('data-app-ready','1');},standalone?${standaloneLifecycleMs}:${browserLifecycleMs});}}catch(e){d.setAttribute('data-welcome','skip');d.setAttribute('data-app-ready','1');}})();`;
}

/**
 * Shared app-ready attribute used by the head script and client overlay to mark
 * when the real UI is ready to be seen.
 */
export const APP_READY_FLAG = 'data-app-ready';
