import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  APP_READY_FLAG,
  APP_DISPLAY_MODE_ATTR,
  APP_DISPLAY_MODE_STANDALONE,
  buildWelcomeInitScript,
  WELCOME_COOKIE_NAME,
  WELCOME_FADE_MS,
  WELCOME_ID,
  WELCOME_SESSION_KEY,
  WELCOME_STANDALONE_FADE_MS,
  WELCOME_STANDALONE_VISIBLE_MS,
  WELCOME_VISIBLE_MS,
} from '@/lib/welcome/config';

test('welcome init script references the shared session key', () => {
  const script = buildWelcomeInitScript();

  assert.ok(
    script.includes(WELCOME_SESSION_KEY),
    'script must read the same sessionStorage key as the component',
  );
  assert.ok(
    script.includes(WELCOME_COOKIE_NAME),
    'script must also read the cookie fallback before paint',
  );
});

test('welcome init script hides the overlay before paint for returning visits', () => {
  const script = buildWelcomeInitScript();

  // It must set the skip flag the CSS relies on to avoid a flash.
  assert.match(script, /setAttribute\('data-welcome','skip'\)/);
  assert.match(script, /setAttribute\('data-welcome','show'\)/);
  // And it must respect reduced-motion users.
  assert.match(script, /prefers-reduced-motion: reduce/);
});

test('welcome init script marks installed app display mode before paint', () => {
  const script = buildWelcomeInitScript();

  assert.ok(script.includes(APP_DISPLAY_MODE_ATTR));
  assert.ok(script.includes(APP_DISPLAY_MODE_STANDALONE));
  assert.match(script, /navigator\.standalone/);
  assert.match(script, /display-mode: standalone/);
});

test('welcome init script is a self-contained IIFE', () => {
  const script = buildWelcomeInitScript();

  assert.ok(script.startsWith('(function(){'));
  assert.ok(script.endsWith('})();'));
});

test('returning visits reveal the app before paint', () => {
  const script = buildWelcomeInitScript();

  // The welcome overlay must be skipped instantly so no launch screen lingers
  // for a returning visitor.
  assert.match(script, /data-welcome','skip'/);
  assert.ok(
    script.includes(`${APP_READY_FLAG}','1'`) ||
      script.includes(`'${APP_READY_FLAG}','1'`),
    'returning visits must set the app-ready flag',
  );
});

test('welcome overlay uses a stable id and sane timings', () => {
  assert.equal(WELCOME_ID, 'smartstore-welcome');
  assert.ok(WELCOME_VISIBLE_MS >= 2000, 'overlay should stay long enough to read');
  assert.ok(WELCOME_VISIBLE_MS <= 4000, 'overlay should not overstay');
  assert.ok(WELCOME_FADE_MS >= 400, 'fade should be smooth');
  assert.ok(WELCOME_FADE_MS <= 1000, 'fade should not feel sluggish');
  assert.ok(
    WELCOME_VISIBLE_MS + WELCOME_FADE_MS <= 3100,
    'welcome should not leave a long empty background after the logo exits',
  );
  assert.ok(
    WELCOME_STANDALONE_VISIBLE_MS < WELCOME_VISIBLE_MS,
    'installed app welcome should be shorter after the native launch screen',
  );
  assert.ok(WELCOME_STANDALONE_FADE_MS <= WELCOME_FADE_MS);
  assert.ok(
    WELCOME_STANDALONE_VISIBLE_MS + WELCOME_STANDALONE_FADE_MS <= 1900,
    'installed app welcome should finish quickly after the native launch screen',
  );
});

test('welcome logo asset exists in public assets', () => {
  assert.equal(
    existsSync(join(process.cwd(), 'public', 'smartstore-welcome-logo.png')),
    true,
  );
});

test('welcome component uses the icon-only welcome logo', () => {
  const component = readFileSync(
    join(process.cwd(), 'components', 'app-welcome-splash.tsx'),
    'utf8',
  );

  assert.match(component, /\/smartstore-welcome-logo\.png/);
  assert.doesNotMatch(component, /\/smartstore-logo\.png/);
});

test('welcome component records the visit before its removal timer', () => {
  const component = readFileSync(
    join(process.cwd(), 'components', 'app-welcome-splash.tsx'),
    'utf8',
  );
  const storageIndex = component.indexOf('window.sessionStorage.setItem');
  const cookieIndex = component.indexOf('document.cookie');
  const timerIndex = component.indexOf('window.setTimeout');

  assert.ok(storageIndex > -1, 'component should record the viewed welcome');
  assert.ok(cookieIndex > -1, 'component should write a cookie fallback');
  assert.ok(timerIndex > -1, 'component should still remove itself after the CSS lifecycle');
  assert.ok(
    storageIndex < timerIndex,
    'welcome should be marked seen before a route change can cancel the timer',
  );
  assert.ok(
    cookieIndex < timerIndex,
    'welcome cookie fallback should be written before route changes can cancel the timer',
  );
  assert.match(
    component,
    /welcomeState !== 'show'/,
    'component should not start the overlay lifecycle unless the head script explicitly opted in',
  );
});

test('welcome surfaces use the dark teal brand palette', () => {
  const globals = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8');
  const layout = readFileSync(join(process.cwd(), 'app', 'layout.tsx'), 'utf8');

  for (const source of [globals, layout]) {
    assert.match(source, /#08111d/);
    assert.match(source, /#117c8b/);
  }
});

test('welcome css includes a shorter standalone lifecycle', () => {
  const globals = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8');

  assert.match(globals, /\[data-app-display="standalone"\] \.app-welcome/);
  assert.match(globals, /app-welcome-standalone-lifecycle/);
});

test('welcome content fades only with the overlay background', () => {
  const globals = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8');
  const layout = readFileSync(join(process.cwd(), 'app', 'layout.tsx'), 'utf8');

  assert.match(globals, /app-welcome-lifecycle 2920ms/);
  assert.match(globals, /animation: app-welcome-rise 820ms/);
  assert.match(globals, /animation-duration: 640ms/);
  assert.doesNotMatch(globals, /app-welcome-content-exit/);
  assert.doesNotMatch(globals, /app-welcome-standalone-content-exit/);
  assert.match(layout, /app-welcome-lifecycle 2920ms/);
  assert.match(layout, /animation-duration: 1700ms/);
});

test('welcome overlay is opt-in and has no independent boot cover', () => {
  const layout = readFileSync(join(process.cwd(), 'app', 'layout.tsx'), 'utf8');

  assert.match(layout, /#smartstore-welcome[\s\S]*display: none/);
  assert.match(layout, /html\[data-welcome='show'\] #smartstore-welcome \{ display: flex; \}/);
  assert.match(layout, /html\[data-welcome='skip'\] #smartstore-welcome/);
  assert.doesNotMatch(layout, /smartstore-boot-cover/);
  assert.doesNotMatch(layout, /smartstore-app-shell-fallback/);
});

test('welcome has critical first-paint styles in the document head', () => {
  const layout = readFileSync(join(process.cwd(), 'app', 'layout.tsx'), 'utf8');

  assert.ok(
    layout.indexOf('id="smartstore-welcome-init"') <
      layout.indexOf('id="smartstore-welcome-critical-style"'),
    'welcome state must be decided before the critical welcome CSS can paint',
  );
  assert.match(layout, /#smartstore-welcome \{/);
  assert.match(layout, /z-index: 9999/);
  assert.match(layout, /html\[data-app-display='standalone'\] #smartstore-welcome/);
  assert.match(layout, /app-welcome-standalone-lifecycle/);
});

test('welcome presentation avoids the old floating glow treatment', () => {
  const component = readFileSync(
    join(process.cwd(), 'components', 'app-welcome-splash.tsx'),
    'utf8',
  );
  const globals = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8');

  assert.match(component, /app-welcome__backdrop/);
  assert.doesNotMatch(component, /app-welcome__glow/);
  assert.doesNotMatch(globals, /app-welcome-pulse/);
  assert.doesNotMatch(globals, /app-welcome-float/);
  assert.doesNotMatch(globals, /app-welcome-sheen/);
});

test('welcome background stays smooth without grid texture', () => {
  const globals = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8');
  const layout = readFileSync(join(process.cwd(), 'app', 'layout.tsx'), 'utf8');

  for (const source of [globals, layout]) {
    assert.doesNotMatch(source, /44px 44px/);
    assert.doesNotMatch(source, /0 1px, transparent 1px 100%/);
  }
});
