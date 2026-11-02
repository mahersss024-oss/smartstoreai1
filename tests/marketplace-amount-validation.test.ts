import assert from 'node:assert/strict';
import test from 'node:test';
import { POST as createListing } from '@/app/api/marketplace/listings/route';
import { PATCH as editListing } from '@/app/api/marketplace/listings/[listingId]/route';
import { PATCH as editAdminListing } from '@/app/api/admin/listings/[listingId]/route';
import { PATCH as editCommission } from '@/app/api/marketplace/commissions/[commissionId]/route';
import { createSignedSession } from '@/lib/auth/session';
import { marketplaceAmountSchema, maxMarketplaceAmount } from '@/lib/marketplace/amounts';

test('marketplace amount validation matches numeric(12,2) without changing supported ordinary amounts', () => {
  for (const value of [0, 0.01, 100, 123.456, maxMarketplaceAmount]) {
    assert.equal(marketplaceAmountSchema.safeParse(value).success, true);
  }
  for (const value of [-1, 10_000_000_000, 1e20, Infinity, NaN]) {
    assert.equal(marketplaceAmountSchema.safeParse(value).success, false);
  }
});

test('all monetary write API entry points reject overflow before persistence with the existing invalid_request contract', async t => {
  const values = {
    SMARTSTORE_MARKETPLACE_STORE: 'file', SMARTSTORE_ADMIN_EMAILS: 'amount-owner@example.test',
    AUTH_SECRET: 'local-marketplace-amount-validation-only', SMARTSTORE_RATE_LIMIT_BACKEND: 'memory',
    UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '',
  };
  for (const [key, value] of Object.entries(values)) {
    const old = process.env[key]; process.env[key] = value;
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('live_io_forbidden'); });
  const token = createSignedSession({ id: 'amount-owner', email: 'amount-owner@example.test', role: 'admin' });
  const request = (url: string, method: string, body: object) => new Request('https://example.test' + url, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const listingContext = { params: Promise.resolve({ listingId: 'overflow-must-not-be-looked-up' }) };
  for (const amount of [10_000_000_000, 1e20]) {
    const responses = [
      await createListing(request('/api/marketplace/listings', 'POST', { category: 'furniture', title: 'Local validation', price: amount })),
      await editListing(request('/api/marketplace/listings/overflow', 'PATCH', { price: amount }), listingContext),
      await editAdminListing(request('/api/admin/listings/overflow', 'PATCH', { price: amount }), listingContext),
      await editCommission(request('/api/marketplace/commissions/overflow', 'PATCH', { productValue: amount }), {
        params: Promise.resolve({ commissionId: 'overflow-must-not-be-looked-up' }),
      }),
    ];
    for (const response of responses) {
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error, 'invalid_request');
    }
  }
  const created = await createListing(request('/api/marketplace/listings', 'POST', {
    category: 'furniture', title: 'Maximum valid local amount', price: maxMarketplaceAmount,
  }));
  assert.equal(created.status, 201);
  assert.equal((await created.json()).listing.price, maxMarketplaceAmount);
});
