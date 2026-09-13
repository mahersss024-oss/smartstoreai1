import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hasVerifiedAdminAccess,
  hasVerifiedModeratorAccess,
} from '@/lib/auth/authorization';
import { GET as getSession } from '@/app/api/auth/session/route';
import {
  createCommissionAgreementCookie,
  createSessionCookie,
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

test('verified authorization fails closed for stale role cookies in database mode', async () => {
  const originalStore = process.env.SMARTSTORE_MARKETPLACE_STORE;
  const originalAdminEmails = process.env.SMARTSTORE_ADMIN_EMAILS;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  process.env.SMARTSTORE_ADMIN_EMAILS = '';

  try {
    const staleAdminSession = {
      user: {
        id: 'google:stale-admin-role',
        email: 'stale-admin@example.com',
        role: 'admin',
      },
      issuedAt: 1,
      expiresAt: Math.floor(Date.now() / 1000) + 60,
    };

    assert.equal(await hasVerifiedAdminAccess(staleAdminSession), false);
    assert.equal(await hasVerifiedModeratorAccess(staleAdminSession), false);
  } finally {
    if (originalStore === undefined) {
      delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    } else {
      process.env.SMARTSTORE_MARKETPLACE_STORE = originalStore;
    }

    if (originalAdminEmails === undefined) {
      delete process.env.SMARTSTORE_ADMIN_EMAILS;
    } else {
      process.env.SMARTSTORE_ADMIN_EMAILS = originalAdminEmails;
    }
  }
});

test('configured admin emails keep verified admin access', async () => {
  const originalStore = process.env.SMARTSTORE_MARKETPLACE_STORE;
  const originalAdminEmails = process.env.SMARTSTORE_ADMIN_EMAILS;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  process.env.SMARTSTORE_ADMIN_EMAILS = 'owner@example.com';

  try {
    assert.equal(
      await hasVerifiedAdminAccess({
        user: { id: 'google:owner', email: 'owner@example.com' },
        issuedAt: 1,
        expiresAt: Math.floor(Date.now() / 1000) + 60,
      }),
      true,
    );
  } finally {
    if (originalStore === undefined) {
      delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    } else {
      process.env.SMARTSTORE_MARKETPLACE_STORE = originalStore;
    }

    if (originalAdminEmails === undefined) {
      delete process.env.SMARTSTORE_ADMIN_EMAILS;
    } else {
      process.env.SMARTSTORE_ADMIN_EMAILS = originalAdminEmails;
    }
  }
});

test('session api does not expose stale admin role when database verification fails', async () => {
  const originalStore = process.env.SMARTSTORE_MARKETPLACE_STORE;
  const originalAdminEmails = process.env.SMARTSTORE_ADMIN_EMAILS;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'database';
  process.env.SMARTSTORE_ADMIN_EMAILS = '';
  delete process.env.DATABASE_URL;

  try {
    const cookie = createSessionCookie({
      id: 'google:stale-session-admin',
      email: 'stale-session-admin@example.com',
      role: 'admin',
    });
    const response = await getSession(
      new Request('https://smartstore.test/api/auth/session', {
        headers: { cookie },
      }),
    );
    const body = await response.json();

    assert.equal(body.user.role, 'user');
  } finally {
    if (originalStore === undefined) {
      delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    } else {
      process.env.SMARTSTORE_MARKETPLACE_STORE = originalStore;
    }

    if (originalAdminEmails === undefined) {
      delete process.env.SMARTSTORE_ADMIN_EMAILS;
    } else {
      process.env.SMARTSTORE_ADMIN_EMAILS = originalAdminEmails;
    }

    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  }
});
