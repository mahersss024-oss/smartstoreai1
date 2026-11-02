import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { GET as getNotifications } from '@/app/api/notifications/route';
import { createMobileAuthTicket, parseMobileAuthTicket } from '@/lib/auth/mobile-oauth';
import { createSignedSession, getAuthSession, getCookieValue, parseSignedSession } from '@/lib/auth/session';

const user = { id: 'google:ticket-regression', email: 'ticket-regression@example.test', name: 'Test' };

test('a mobile handoff carries only a short-lived purpose-bound credential, not a reusable bearer', () => {
  const originalNow = Date.now;
  const now = 1_800_000_000_000;
  Date.now = () => now;
  try {
    const ticket = createMobileAuthTicket(user);
    const payload = JSON.parse(Buffer.from(ticket.split('.')[0], 'base64url').toString());
    assert.equal(payload.session, undefined);
    assert.deepEqual(payload.user, user);
    assert.equal(payload.expiresAt - payload.issuedAt, 60);
    assert.equal(parseSignedSession(ticket), null, 'ticket signature cannot authenticate as a bearer');
    assert.deepEqual(parseSignedSession(parseMobileAuthTicket(ticket))?.user, user);
    assert.equal(parseMobileAuthTicket(`${ticket}.extra`), null);
    const [encoded, signature] = ticket.split('.');
    const tampered = Buffer.from(JSON.stringify({ ...payload, user: { ...user, id: 'another-user' } })).toString('base64url');
    assert.equal(parseMobileAuthTicket(`${tampered}.${signature}`), null);
    assert.ok(encoded);
    Date.now = () => now + 60_000;
    assert.equal(parseMobileAuthTicket(ticket), null);
    assert.equal(parseSignedSession(ticket), null);
  } finally {
    Date.now = originalNow;
  }
});

test('legacy bearer-containing mobile tickets cannot cross into the new exchange format', () => {
  const oldSecret = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = 'isolated-mobile-ticket-regression-key';
  try {
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(JSON.stringify({ session: createSignedSession(user), nonce: 'old', issuedAt: now, expiresAt: now + 60 })).toString('base64url');
    const signature = createHmac('sha256', process.env.AUTH_SECRET).update(`mobile-auth:${payload}`).digest('base64url');
    assert.equal(parseMobileAuthTicket(`${payload}.${signature}`), null);
  } finally {
    if (oldSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = oldSecret;
  }
});

test('malformed cookies are invalid credentials and cannot fall back to another bearer identity', async () => {
  const bearer = createSignedSession(user);
  for (const value of ['%', '%E0%A4%A']) {
    const request = new Request('http://localhost/api/notifications', {
      headers: { cookie: `smartstore_session=${value}`, authorization: `Bearer ${bearer}` },
    });
    assert.equal(getCookieValue(request, 'missing-cookie'), undefined);
    assert.equal(getCookieValue(request, 'smartstore_session'), '');
    assert.equal(getAuthSession(request), null);
    assert.equal((await getNotifications(request)).status, 401);
  }
  assert.equal(getAuthSession(new Request('http://localhost', { headers: { authorization: `Bearer ${bearer}` } }))?.user.id, user.id);
});
