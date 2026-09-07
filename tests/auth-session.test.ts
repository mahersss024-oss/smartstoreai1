import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCommissionAgreementCookie,
  hasCommissionAgreement,
  isAdminSession,
  isModeratorSession,
  parseCommissionAgreement,
} from '@/lib/auth/session';

test('creates a signed commission agreement cookie for the 1 percent policy', () => {
  const setCookie = createCommissionAgreementCookie();
  const cookieHeader = setCookie.split(';')[0];
  const request = new Request('http://localhost', {
    headers: { cookie: cookieHeader },
  });

  assert.equal(hasCommissionAgreement(request), true);
});

test('rejects tampered commission agreement cookies', () => {
  assert.equal(parseCommissionAgreement('bad.payload.signature'), null);
});

test('detects admin sessions from configured admin emails', () => {
  process.env.SMARTSTORE_ADMIN_EMAILS = 'owner@example.com, admin@example.com';

  assert.equal(
    isAdminSession({
      user: { id: 'google:admin', email: 'ADMIN@example.com' },
      issuedAt: 1,
      expiresAt: 2,
    }),
    true,
  );
  assert.equal(
    isAdminSession({
      user: { id: 'google:user', email: 'user@example.com' },
      issuedAt: 1,
      expiresAt: 2,
    }),
    false,
  );
});

test('detects admin and moderator roles from the signed session user', () => {
  process.env.SMARTSTORE_ADMIN_EMAILS = '';

  assert.equal(
    isAdminSession({
      user: {
        id: 'google:admin-role',
        email: 'role-admin@example.com',
        role: 'admin',
      },
      issuedAt: 1,
      expiresAt: 2,
    }),
    true,
  );
  assert.equal(
    isAdminSession({
      user: {
        id: 'google:moderator-role',
        email: 'moderator@example.com',
        role: 'moderator',
      },
      issuedAt: 1,
      expiresAt: 2,
    }),
    false,
  );
  assert.equal(
    isModeratorSession({
      user: {
        id: 'google:moderator-role',
        email: 'moderator@example.com',
        role: 'moderator',
      },
      issuedAt: 1,
      expiresAt: 2,
    }),
    true,
  );
});
