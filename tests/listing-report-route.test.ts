import assert from 'node:assert/strict';
import test from 'node:test';

import { createListingDraft, publishListing } from '@/agent/marketplace/store';
import { GET, POST } from '@/app/api/marketplace/listings/[listingId]/reports/route';
import { createSessionCookie } from '@/lib/auth/session';
import { mockAllowedTextAnalysis } from './helpers/text-understanding';

test.beforeEach(mockAllowedTextAnalysis);

test('report endpoint persists state and deduplicates different request keys', async () => {
  const previous = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'file';
  try {
    const listing = createListingDraft({ sellerId: 'report-route-seller', category: 'other', title: 'Desk' });
    publishListing(listing.id);
    const context = { params: Promise.resolve({ listingId: listing.id }) };
    const url = `http://localhost/api/marketplace/listings/${listing.id}/reports`;
    const cookie = createSessionCookie({ id: 'report-route-buyer', email: 'report-route@smartstore.local' }).split(';')[0];
    const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
    const read = () => GET(new Request(url, { headers }), context);
    assert.equal((await GET(new Request(url), context)).status, 401);
    assert.equal((await (await read()).json()).isReported, false);
    const invalid = await POST(new Request(url, { method: 'POST', headers, body: '{}' }), context);
    assert.equal(invalid.status, 400);
    assert.equal((await (await read()).json()).isReported, false);
    const results = await Promise.all(Array.from({ length: 4 }, (_, index) => POST(new Request(url, {
      method: 'POST', headers: { ...headers, 'Idempotency-Key': `report-route-${index}` },
      body: JSON.stringify({ reason: 'fraud' }),
    }), context).then(response => response.json())));
    assert.equal(new Set(results.map(result => result.report.id)).size, 1);
    const state = await read();
    assert.equal(state.headers.get('cache-control'), 'private, no-store');
    assert.equal((await state.json()).isReported, true);
    const otherHeaders = { Cookie: createSessionCookie({ id: 'report-route-other', email: 'other-report@smartstore.local' }).split(';')[0] };
    assert.equal((await (await GET(new Request(url, { headers: otherHeaders }), context)).json()).isReported, false);
  } finally {
    if (previous === undefined) delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    else process.env.SMARTSTORE_MARKETPLACE_STORE = previous;
  }
});
