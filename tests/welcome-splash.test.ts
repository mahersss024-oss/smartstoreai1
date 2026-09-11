import assert from 'node:assert/strict';
import test from 'node:test';

import {
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

test('welcome overlay uses a stable id and sane timings', () => {
  assert.equal(WELCOME_ID, 'smartstore-welcome');
  assert.ok(WELCOME_VISIBLE_MS >= 2000, 'overlay should stay long enough to read');
  assert.ok(WELCOME_VISIBLE_MS <= 4000, 'overlay should not overstay');
  assert.ok(WELCOME_FADE_MS >= 400, 'fade should be smooth');
  assert.ok(WELCOME_FADE_MS <= 1000, 'fade should not feel sluggish');
});
