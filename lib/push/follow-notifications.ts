import {
  deactivateSubscriptionById,
  listActiveSubscriptionsForUser,
} from '@/agent/marketplace/push-subscriptions';

import { sendNativePushToUser } from './native-push';
import { sendWebPush } from './web-push';

type PublishedListingNotification = {
  id: string;
  sellerId: string;
  title?: string | null;
  city?: string | null;
};

type NotifySellerFollowersInput = {
  listing: PublishedListingNotification;
  followerIds: string[];
};

type NotifySimilarListingFollowersInput = {
  listing: PublishedListingNotification;
  followerIds: string[];
};

function buildListingNotificationBody(listing: PublishedListingNotification) {
  const title = listing.title?.trim() || 'إعلان جديد';
  const city = listing.city?.trim();

  return city ? `${title} في ${city}` : title;
}

export async function notifySellerFollowersOfPublishedListing({
  listing,
  followerIds,
}: NotifySellerFollowersInput) {
  const recipients = [...new Set(followerIds)].filter(
    (userId) => userId && userId !== listing.sellerId,
  );

  if (recipients.length === 0) {
    return;
  }

  const subscriptionsByUser = await Promise.all(
    recipients.map(async (userId) => ({
      userId,
      subscriptions: await listActiveSubscriptionsForUser(userId),
    })),
  );
  const pushMessage = {
    title: 'إعلان جديد من بائع تتابعه',
    body: buildListingNotificationBody(listing),
    url: `/listings/${encodeURIComponent(listing.id)}?source=follow`,
    tag: `follow:listing:${listing.id}`,
  };

  await Promise.all(
    subscriptionsByUser.flatMap(({ userId, subscriptions }) => [
      ...subscriptions.map(async (subscription) => {
        const result = await sendWebPush(subscription, pushMessage);

        if (!result.ok && result.expired) {
          await deactivateSubscriptionById(subscription.id);
        }
      }),
      sendNativePushToUser(userId, pushMessage),
    ]),
  );
}

export async function notifySimilarListingFollowersOfPublishedListing({
  listing,
  followerIds,
}: NotifySimilarListingFollowersInput) {
  const recipients = [...new Set(followerIds)].filter(
    (userId) => userId && userId !== listing.sellerId,
  );

  if (recipients.length === 0) {
    return;
  }

  const subscriptionsByUser = await Promise.all(
    recipients.map(async (userId) => ({
      userId,
      subscriptions: await listActiveSubscriptionsForUser(userId),
    })),
  );
  const pushMessage = {
    title: 'إعلان مشابه جديد',
    body: buildListingNotificationBody(listing),
    url: `/listings/${encodeURIComponent(listing.id)}?source=similar-follow`,
    tag: `similar:listing:${listing.id}`,
  };

  await Promise.all(
    subscriptionsByUser.flatMap(({ userId, subscriptions }) => [
      ...subscriptions.map(async (subscription) => {
        const result = await sendWebPush(subscription, pushMessage);

        if (!result.ok && result.expired) {
          await deactivateSubscriptionById(subscription.id);
        }
      }),
      sendNativePushToUser(userId, pushMessage),
    ]),
  );
}
