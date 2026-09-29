import {
  deactivateSubscriptionById,
  listActiveSubscriptionsForUser,
} from '@/agent/marketplace/push-subscriptions';

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
  const body = buildListingNotificationBody(listing);
  const url = `/listings/${encodeURIComponent(listing.id)}?source=follow`;

  await Promise.all(
    subscriptionsByUser.flatMap(({ subscriptions }) =>
      subscriptions.map(async (subscription) => {
        const result = await sendWebPush(subscription, {
          title: 'إعلان جديد من بائع تتابعه',
          body,
          url,
          tag: `follow:listing:${listing.id}`,
        });

        if (!result.ok && result.expired) {
          await deactivateSubscriptionById(subscription.id);
        }
      }),
    ),
  );
}
