import assert from 'node:assert/strict';
import test from 'node:test';

import { PATCH as updateCommission } from '@/app/api/marketplace/commissions/[commissionId]/route';
import { POST as sendConversationMessage } from '@/app/api/marketplace/conversations/[conversationId]/route';
import { POST as createConversation } from '@/app/api/marketplace/conversations/route';
import {
  createListingDraft,
  listSellerCommissions,
  publishListing,
  setListingStatusForSeller,
} from '@/agent/marketplace/store';
import {
  isStaleIdempotencyReservation,
  reserveIdempotencyKey,
} from '@/lib/api/idempotency';
import { createSessionCookie } from '@/lib/auth/session';

test('returns the stored idempotent response for duplicate keys', async () => {
  const request = new Request('https://smartstore.test/api', {
    method: 'POST',
    headers: {
      'Idempotency-Key': 'duplicate-listing-create',
    },
  });
  const first = await reserveIdempotencyKey(request, {
    namespace: 'test_idempotency',
    actorKey: 'user:one',
  });

  assert.equal(first?.response, undefined);

  const firstResponse = await first?.complete({ ok: true, id: 'listing:one' }, 201);
  assert.equal(firstResponse?.status, 201);

  const second = await reserveIdempotencyKey(request, {
    namespace: 'test_idempotency',
    actorKey: 'user:one',
  });

  assert.equal(second?.response?.status, 201);
  assert.deepEqual(await second?.response?.json(), {
    ok: true,
    id: 'listing:one',
  });
});

test('scopes idempotency keys per actor', async () => {
  const request = new Request('https://smartstore.test/api', {
    method: 'POST',
    headers: {
      'Idempotency-Key': 'same-browser-key',
    },
  });
  const first = await reserveIdempotencyKey(request, {
    namespace: 'test_actor_scope',
    actorKey: 'user:one',
  });
  const secondActor = await reserveIdempotencyKey(request, {
    namespace: 'test_actor_scope',
    actorKey: 'user:two',
  });

  assert.equal(first?.response, undefined);
  assert.equal(secondActor?.response, undefined);
});

test('treats old pending idempotency reservations as retryable', () => {
  const now = 1_000_000;

  assert.equal(
    isStaleIdempotencyReservation(new Date(now - 2 * 60_000), now),
    true,
  );
  assert.equal(
    isStaleIdempotencyReservation(new Date(now - 2 * 60_000 + 1), now),
    false,
  );
});

test('deduplicates customer conversation creation requests', async () => {
  const originalStore = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'memory';

  try {
    const listing = createListingDraft({
      sellerId: 'seller:conversation-api-idempotency',
      category: 'cars',
      title: 'Toyota Camry API idempotency',
    });
    publishListing(listing.id);

    const cookie = createSessionCookie({
      id: 'buyer:conversation-api-idempotency',
      email: 'buyer-conversation@example.com',
    });
    const requestBody = JSON.stringify({ listingId: listing.id });
    const requestInit = {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie,
        'idempotency-key': 'open-conversation-once',
      },
      body: requestBody,
    };

    const first = await createConversation(
      new Request('https://smartstore.test/api/marketplace/conversations', requestInit),
    );
    const second = await createConversation(
      new Request('https://smartstore.test/api/marketplace/conversations', requestInit),
    );
    const firstBody = await first.json();
    const secondBody = await second.json();

    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal(firstBody.status, 'created');
    assert.equal(secondBody.conversation.id, firstBody.conversation.id);
  } finally {
    if (originalStore === undefined) {
      delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    } else {
      process.env.SMARTSTORE_MARKETPLACE_STORE = originalStore;
    }
  }
});

test('deduplicates seller commission sale amount updates', async () => {
  const originalStore = process.env.SMARTSTORE_MARKETPLACE_STORE;
  process.env.SMARTSTORE_MARKETPLACE_STORE = 'memory';

  try {
    const sellerId = 'seller:commission-api-idempotency';
    const listing = createListingDraft({
      sellerId,
      category: 'cars',
      title: 'Auction car API idempotency',
      price: 'bid',
    });
    publishListing(listing.id);
    setListingStatusForSeller(listing.id, sellerId, 'sold');

    const commission = listSellerCommissions(sellerId)[0];
    assert.ok(commission);

    const cookie = createSessionCookie({
      id: sellerId,
      email: 'seller-commission@example.com',
    });
    const requestInit = {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        cookie,
        'idempotency-key': 'commission-sale-amount-once',
      },
      body: JSON.stringify({ productValue: 80_000 }),
    };
    const context = {
      params: Promise.resolve({ commissionId: commission.id }),
    };

    const first = await updateCommission(
      new Request(
        `https://smartstore.test/api/marketplace/commissions/${commission.id}`,
        requestInit,
      ),
      context,
    );
    const second = await updateCommission(
      new Request(
        `https://smartstore.test/api/marketplace/commissions/${commission.id}`,
        requestInit,
      ),
      context,
    );
    const firstBody = await first.json();
    const secondBody = await second.json();

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(firstBody.status, 'updated');
    assert.equal(secondBody.commission.id, firstBody.commission.id);
    assert.equal(secondBody.commission.commissionAmount, 800);
  } finally {
    if (originalStore === undefined) {
      delete process.env.SMARTSTORE_MARKETPLACE_STORE;
    } else {
      process.env.SMARTSTORE_MARKETPLACE_STORE = originalStore;
    }
  }
});

test('rejects oversized conversation messages before parsing JSON', async () => {
  const cookie = createSessionCookie({
    id: 'buyer:conversation-message-size',
    email: 'buyer-message-size@example.com',
  });
  const response = await sendConversationMessage(
    new Request(
      'https://smartstore.test/api/marketplace/conversations/conversation:size',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': '9000',
          cookie,
        },
        body: '{}',
      },
    ),
    {
      params: Promise.resolve({ conversationId: 'conversation:size' }),
    },
  );

  assert.equal(response.status, 413);
  assert.equal(await response.text(), 'Conversation message request body is too large.');
});
