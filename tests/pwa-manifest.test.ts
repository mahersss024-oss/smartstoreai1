import assert from 'node:assert/strict';
import test from 'node:test';

import manifest from '@/app/manifest';

const requiredIconSizes = ['180x180', '512x512'];

test('exposes a valid installable web manifest', () => {
  const result = manifest();

  assert.equal(result.display, 'standalone');
  assert.equal(result.start_url, '/');
  assert.equal(result.scope, '/');
  assert.equal(result.dir, 'rtl');
  assert.equal(result.lang, 'ar');
  assert.ok(result.name);
  assert.ok(result.short_name);
  assert.ok(result.theme_color);
  assert.ok(result.background_color);
});

test('manifest declares required install icons with correct dimensions', () => {
  const result = manifest();
  const icons = result.icons ?? [];
  const sizes = icons.map((icon) => icon.sizes);

  for (const requiredSize of requiredIconSizes) {
    assert.ok(
      sizes.includes(requiredSize),
      `manifest is missing an icon sized ${requiredSize}`,
    );
  }

  assert.ok(
    icons.some((icon) => icon.purpose === 'maskable'),
    'manifest must include a maskable icon for Android install',
  );

  for (const icon of icons) {
    assert.ok(icon.src.startsWith('/'), 'icon src must be a root-relative path');
    assert.ok(icon.type?.startsWith('image/'), 'icon type must be an image');
  }
});
