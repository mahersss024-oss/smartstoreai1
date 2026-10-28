import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from '@/app/.well-known/apple-app-site-association/route';

test('Apple app association fails clearly without a valid actual signing team and matching native bundle', async () => {
  const previous = { team: process.env.APPLE_TEAM_ID, client: process.env.APPLE_NATIVE_CLIENT_ID };
  try {
    for (const [team, client] of [['', ''], ['placeholder', ''], ['ABC1234567', 'wrong.bundle.app']]) {
      process.env.APPLE_TEAM_ID = team;
      process.env.APPLE_NATIVE_CLIENT_ID = client;
      const response = await GET();
      assert.equal(response.status, 503);
      assert.match(response.headers.get('cache-control')!, /no-store/);
      assert.deepEqual(await response.json(), { error: 'apple_app_association_not_configured' });
    }
  } finally {
    if (previous.team === undefined) delete process.env.APPLE_TEAM_ID;
    else process.env.APPLE_TEAM_ID = previous.team;
    if (previous.client === undefined) delete process.env.APPLE_NATIVE_CLIENT_ID;
    else process.env.APPLE_NATIVE_CLIENT_ID = previous.client;
  }
});

test('Apple association returns an unredirected JSON document for exactly the native public routes', async () => {
  const previous = { team: process.env.APPLE_TEAM_ID, client: process.env.APPLE_NATIVE_CLIENT_ID };
  try {
    process.env.APPLE_TEAM_ID = 'ABC1234567';
    process.env.APPLE_NATIVE_CLIENT_ID = 'com.souqhamad.app';
    const response = await GET();
    assert.equal(response.status, 200);
    assert.equal(response.headers.has('location'), false);
    assert.match(response.headers.get('content-type')!, /^application\/json/);
    assert.deepEqual(await response.json(), { applinks: { details: [{
      appIDs: ['ABC1234567.com.souqhamad.app'],
      components: [{ '/': '/listings/*' }, { '/': '/sellers/*' }, { '/': '/conversations/*' }],
    }] } });
  } finally {
    if (previous.team === undefined) delete process.env.APPLE_TEAM_ID;
    else process.env.APPLE_TEAM_ID = previous.team;
    if (previous.client === undefined) delete process.env.APPLE_NATIVE_CLIENT_ID;
    else process.env.APPLE_NATIVE_CLIENT_ID = previous.client;
  }
});
