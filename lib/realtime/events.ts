export type RealtimeEventType =
  | 'ad_created'
  | 'ad_updated'
  | 'ad_deleted'
  | 'ad_status_changed'
  | 'follow_listing_published'
  | 'listing_notification_created'
  | 'message_created'
  | 'conversation_updated'
  | 'commission_updated'
  | 'moderation_updated'
  | 'maintenance_cleanup';

type RealtimePayloadByType = {
  ad_created: {
    listingId: string;
    sellerId: string;
    status: string;
  };
  ad_updated: {
    listingId: string;
    sellerId: string;
    status: string;
    reason:
      | 'content'
      | 'image_added'
      | 'image_deleted'
      | 'primary_image'
      | 'favorite_count'
      | 'message_count'
      | 'report'
      | 'admin_update';
  };
  ad_deleted: {
    listingId: string;
    sellerId: string;
  };
  ad_status_changed: {
    listingId: string;
    sellerId: string;
    previousStatus: string;
    status: string;
  };
  follow_listing_published: {
    listingId: string;
    sellerId: string;
    status: 'published';
  };
  listing_notification_created: {
    listingId: string;
    sellerId: string;
    reason: 'seller_follow' | 'similar_listing_follow';
  };
  message_created: {
    conversationId: string;
    listingId: string;
    sellerId: string;
    buyerId: string;
    messageId: string;
    senderId: string;
    status: 'sent' | 'blocked';
  };
  conversation_updated: {
    conversationId: string;
    listingId: string;
    sellerId: string;
    buyerId: string;
    status: string;
  };
  commission_updated: {
    commissionId: string;
    listingId: string;
    sellerId: string;
    status: string;
    reason:
      | 'created'
      | 'sale_amount_updated'
      | 'status_updated'
      | 'deleted';
  };
  moderation_updated: {
    entity: 'listing' | 'report';
    entityId: string;
    status: string;
  };
  maintenance_cleanup: {
    scope: string;
  };
};

export type RealtimeEvent = {
  [T in RealtimeEventType]: {
    id: number;
    type: T;
    occurredAt: string;
    payload: RealtimePayloadByType[T];
  };
}[RealtimeEventType];

export type RealtimeEventVisibility = {
  includePublic?: boolean;
  includeAdmins?: boolean;
  userIds?: string[];
};

export type PublishRealtimeEventInput<
  T extends RealtimeEventType = RealtimeEventType,
> = {
  type: T;
  payload: RealtimePayloadByType[T];
  visibility?: RealtimeEventVisibility;
};

export type RealtimeSubscriberContext = {
  userId: string | null;
  isAdmin: boolean;
};

export type RealtimeEventEnvelope = RealtimeEvent & {
  visibility: Required<RealtimeEventVisibility>;
};

export function normalizeRealtimeVisibility(
  visibility?: RealtimeEventVisibility,
): Required<RealtimeEventVisibility> {
  const includePublic = Boolean(visibility?.includePublic);
  const includeAdmins = Boolean(visibility?.includeAdmins);
  const userIds = Array.from(new Set(visibility?.userIds?.filter(Boolean) ?? []));

  return {
    includePublic,
    includeAdmins,
    userIds,
  };
}

export function isRealtimeEventVisibleToSubscriber(
  event: RealtimeEventEnvelope,
  subscriber: RealtimeSubscriberContext,
) {
  if (event.visibility.includePublic) {
    return true;
  }

  if (event.visibility.includeAdmins && subscriber.isAdmin) {
    return true;
  }

  if (subscriber.userId && event.visibility.userIds.includes(subscriber.userId)) {
    return true;
  }

  return false;
}
