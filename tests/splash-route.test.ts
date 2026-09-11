import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from '@/app/splash/route';

test('splash route returns an svg image for a known size', async () => {
  const response = GET(new Request('http://localhost/splash?size=1170x2532'));

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /image\/svg\+xml/);

  const body = await response.text();

  assert.match(body, /<svg/);
  assert.match(body, /width="1170"/);
  assert.match(body, /height="2532"/);
  assert.match(body, /SmartStore AI/);
});

test('splash route falls back to a default size for unknown values', async () => {
  const response = GET(new Request('http://localhost/splash?size=999x999'));
  const body = await response.text();

  assert.match(body, /width="1170"/);
  assert.match(body, /height="2532"/);
});

test('splash route honours the dark theme query', async () => {
  const response = GET(new Request('http://localhost/splash?theme=dark'));
  const body = await response.text();

  assert.match(body, /#0a111c/);
});

test('splash route is cacheable and immutable', async () => {
  const response = GET(new Request('http://localhost/splash'));

  assert.match(response.headers.get('cache-control') ?? '', /immutable/);
});
