import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

function readProjectFile(...segments: string[]) {
  return readFileSync(join(process.cwd(), ...segments), 'utf8');
}

test('site visit writes are rate limited before recording analytics', () => {
  const route = readProjectFile('app', 'api', 'analytics', 'visit', 'route.ts');

  assert.match(route, /enforceApiRateLimit/);
  assert.match(route, /namespace: 'site_visit'/);
  assert.match(route, /actorId: existingVisitorId \?\? undefined/);
  assert.match(route, /recordSiteVisit/);
  assert.ok(
    route.indexOf('const rateLimitResponse') <
      route.indexOf('await recordSiteVisit'),
  );
});
