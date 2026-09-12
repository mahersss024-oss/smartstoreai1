import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  APP_READY_FLAG,
  buildWelcomeInitScript,
  WELCOME_FADE_MS,
  WELCOME_ID,
  WELCOME_SESSION_KEY,
  WELCOME_VISIBLE_MS,
} from '@/lib/welcome/config';

test('welcome init script references the shared session key', () => {
  const script = buildWelcomeInitScript();

  assert.ok(
    script.includes(WELCOME_SESSION_KEY),
    'script must read the same sessionStorage key as the component',
  );
});

test('welcome init script hides the overlay before paint for returning visits', () => {
  const script = buildWelcomeInitScript();

  // It must set the skip flag the CSS relies on to avoid a flash.
  assert.match(script, /setAttribute\('data-welcome','skip'\)/);
  // And it must respect reduced-motion users.
  assert.match(script, /prefers-reduced-motion: reduce/);
});

test('welcome init script is a self-contained IIFE', () => {
  const script = buildWelcomeInitScript();

  assert.ok(script.startsWith('(function(){'));
  assert.ok(script.endsWith('})();'));
});

test('returning visits reveal the app before paint (hides boot cover)', () => {
  const script = buildWelcomeInitScript();

  // Both the welcome overlay and the boot cover must be cleared instantly so no
  // brand cover or overlay lingers for a returning visitor.
  assert.match(script, /data-welcome','skip'/);
  assert.ok(
    script.includes(`${APP_READY_FLAG}','1'`) ||
      script.includes(`'${APP_READY_FLAG}','1'`),
    'returning visits must set the app-ready flag to drop the boot cover',
  );
});

test('welcome overlay uses a stable id and sane timings', () => {
  assert.equal(WELCOME_ID, 'smartstore-welcome');
  assert.ok(WELCOME_VISIBLE_MS >= 2000, 'overlay should stay long enough to read');
  assert.ok(WELCOME_VISIBLE_MS <= 4000, 'overlay should not overstay');
  assert.ok(WELCOME_FADE_MS >= 400, 'fade should be smooth');
  assert.ok(WELCOME_FADE_MS <= 1000, 'fade should not feel sluggish');
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

test('welcome surfaces use the dark teal brand palette', () => {
  const globals = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8');
  const layout = readFileSync(join(process.cwd(), 'app', 'layout.tsx'), 'utf8');

  for (const source of [globals, layout]) {
    assert.match(source, /#08111d/);
    assert.match(source, /#117c8b/);
  }
});
