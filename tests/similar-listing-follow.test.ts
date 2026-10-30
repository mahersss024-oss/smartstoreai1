import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

function readSource(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

test('listing details exposes similar listing follow without changing listing routes', () => {
  const listingPage = readSource('app/listings/[listingId]/page.tsx');
  const button = readSource('app/listings/[listingId]/similar-follow-button.tsx');
  const route = readSource(
    'app/api/marketplace/listings/[listingId]/similar-follow/route.ts',
  );

  assert.match(listingPage, /CustomerAppGateway/);
  assert.match(button, /تابع الإعلانات المشابهة/);
  assert.match(button, /similar-follow/);
  assert.match(button, /useAuthSession/);
  assert.match(button, /if \(!session\.authenticated\)/);
  assert.match(button, /Idempotency-Key/);
  assert.match(route, /getSimilarListingFollowState/);
  assert.match(route, /toggleSimilarListingFollow/);
  assert.match(route, /similar_listing_follow_toggle/);
});

test('similar listing follows are persisted and matched using comparable listing logic', () => {
  const schema = readSource('prisma/schema.prisma');
  const migration = readSource(
    'prisma/migrations/20260929110000_similar_listing_follows/migration.sql',
  );
  const repository = readSource('agent/marketplace/repository.ts');
  const pushNotifications = readSource('lib/push/follow-notifications.ts');
  const realtimeEvents = readSource('lib/realtime/events.ts');
  const notificationsPage = readSource('app/notifications/page.tsx');
  const pushSettings = readSource('components/push-notification-settings.tsx');

  assert.match(schema, /model SimilarListingFollow/);
  assert.match(migration, /CREATE TABLE "SimilarListingFollow"/);
  assert.match(repository, /getComparableListings/);
  assert.match(repository, /listSimilarListingFollowerIds/);
  assert.match(repository, /notifySimilarFollowersWhenListingIsPublished/);
  assert.match(repository, /title: 'إعلان مشابه جديد'/);
  assert.match(repository, /urlSource: 'similar-follow'/);
  assert.match(pushNotifications, /notifySimilarListingFollowersOfPublishedListing/);
  assert.match(pushNotifications, /tag: `similar:listing:\$\{listing\.id\}`/);
  assert.match(realtimeEvents, /listing_notification_created/);
  assert.match(notificationsPage, /CustomerAppGateway/);
  assert.match(pushSettings, /iconUnreadRefreshDelayMs = 60_000/);
  assert.match(pushSettings, /window\.setTimeout/);
  assert.doesNotMatch(pushSettings, /listing_notification_created/);
});
