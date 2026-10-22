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
 * Critical first-paint styles for the welcome overlay. Shared by the website
 * and the local native-app shell so both launch surfaces use the same layout
 * and lifecycle before the full stylesheet is ready.
 */
export function buildWelcomeCriticalStyle() {
  const lifecycleMs = WELCOME_VISIBLE_MS + WELCOME_FADE_MS;
  const standaloneLifecycleMs =
    WELCOME_STANDALONE_VISIBLE_MS + WELCOME_STANDALONE_FADE_MS;
  const visiblePercent = Math.round((WELCOME_VISIBLE_MS / lifecycleMs) * 100);
  const standaloneVisiblePercent = Math.round(
    (WELCOME_STANDALONE_VISIBLE_MS / standaloneLifecycleMs) * 100,
  );

  return `
html { background-color: #e8edf3; }
html.dark { background-color: #0a111c; }
body { background-color: var(--theme-light-background, #e8edf3); }
html.dark body { background-color: var(--theme-dark-background, #0a111c); }
html[data-welcome='skip'] #smartstore-welcome { display: none !important; }
#smartstore-welcome {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: none;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  width: 100vw;
  min-width: 100vw;
  height: 100dvh;
  min-height: 100svh;
  overflow: hidden;
  background: linear-gradient(150deg, #08111d 0%, #0d2b28 44%, #117c8b 100%);
  padding-top: env(safe-area-inset-top);
  padding-bottom: env(safe-area-inset-bottom);
  animation: app-welcome-lifecycle ${lifecycleMs}ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
}
html[data-welcome='show'] #smartstore-welcome { display: flex; }
html[data-app-display='standalone'] #smartstore-welcome {
  animation-duration: ${standaloneLifecycleMs}ms;
  animation-name: app-welcome-standalone-lifecycle;
}
#smartstore-welcome::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  background:
    radial-gradient(circle at 50% 28%, rgb(28 194 111 / 30%), transparent 34%),
    radial-gradient(circle at 72% 48%, rgb(17 124 139 / 34%), transparent 42%),
    linear-gradient(160deg, rgb(8 17 29 / 76%), rgb(13 43 40 / 42%) 48%, rgb(17 124 139 / 34%));
  opacity: 1;
}
#smartstore-welcome .app-welcome__brand {
  position: absolute;
  z-index: 2;
  left: 50%;
  top: 42%;
  width: min(78vw, 26rem);
  max-width: calc(100vw - 2rem);
  height: auto;
  box-sizing: border-box;
  pointer-events: none;
  user-select: none;
  -webkit-user-drag: none;
  display: block;
  transform: translate(-50%, -50%);
}
#smartstore-welcome .app-welcome__content {
  position: relative;
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: 0.8rem;
  width: 100%;
  min-height: 100%;
  padding: 0 1.5rem calc(env(safe-area-inset-bottom) + 4.5rem);
  text-align: center;
}
@media (min-width: 640px) {
  #smartstore-welcome .app-welcome__brand {
    top: 41%;
    width: min(56vw, 30rem);
  }
}
@media (orientation: landscape) {
  #smartstore-welcome .app-welcome__brand {
    top: 40%;
    width: min(42vw, 30rem);
  }
}
@media (min-width: 1024px) and (orientation: landscape) {
  #smartstore-welcome .app-welcome__brand {
    top: 40%;
    width: min(36vw, 34rem);
  }
}
@keyframes app-welcome-lifecycle {
  0%, ${visiblePercent}% { opacity: 1; }
  100% { opacity: 0; visibility: hidden; }
}
@keyframes app-welcome-standalone-lifecycle {
  0%, ${standaloneVisiblePercent}% { opacity: 1; }
  100% { opacity: 0; visibility: hidden; }
}
`;
}

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
