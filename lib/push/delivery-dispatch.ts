import { getListingSimilarityScore } from '@/agent/marketplace/listing-similarity';
import { prisma } from '@/lib/db/prisma';
import { getConversationBlockStatus, deliverPublishedListingNotifications, getListing } from '@/agent/marketplace/repository';
import { notifyConversationMessage } from './conversation-notifications';
import { notifySellerFollowersOfPublishedListing, notifySimilarListingFollowersOfPublishedListing } from './follow-notifications';

type Payload = { listingId?: string; userId?: string; messageId?: string; source?: string };
/** Re-read source and recipients so delayed delivery cannot revive deleted content. */
export async function deliverNotificationJob(kind: string, payload: Payload) {
  if (kind === 'listing-published' && payload.listingId) {
    await deliverPublishedListingNotifications(payload.listingId);
    return;
  }
  if (kind === 'listing-follow' && payload.listingId && payload.userId) {
    const listing = await getListing(payload.listingId);
    const users = listing ? await prisma.user.findMany({ where: { id: { in: [listing.sellerId, payload.userId] }, deletedAt: null }, select: { id: true } }) : [];
    if (!listing || listing.status !== 'published' || users.length !== 2) return;
    if (payload.source === 'similar') {
      const follows = await prisma.similarListingFollow.findMany({ where: { userId: payload.userId, category: listing.category }, include: { listing: true }, take: 500 });
      const followed = follows.some(follow => follow.listing.status === 'published' && getListingSimilarityScore(listing, {
        ...follow.listing, attributes: follow.listing.attributes && typeof follow.listing.attributes === 'object' && !Array.isArray(follow.listing.attributes) ? follow.listing.attributes as Record<string, unknown> : {},
      }) >= 85);
      if (!followed) return;
      await notifySimilarListingFollowersOfPublishedListing({ listing, followerIds: [payload.userId] });
    } else {
      const followed = await prisma.sellerFollow.count({ where: { followerId: payload.userId, sellerId: listing.sellerId } });
      if (!followed) return;
      await notifySellerFollowersOfPublishedListing({ listing, followerIds: [payload.userId] });
    }
    return;
  }
  if (kind === 'conversation-message' && payload.messageId) {
    const record = await prisma.conversationMessage.findUnique({ where: { id: payload.messageId },
      include: { sender: { select: { name: true, deletedAt: true } }, conversation: {
        include: { buyer: { select: { deletedAt: true } }, seller: { select: { deletedAt: true } } },
      } } });
    if (!record || record.type !== 'text' || record.status !== 'sent' || record.sender.deletedAt ||
      record.conversation.buyer.deletedAt || record.conversation.seller.deletedAt || record.conversation.status !== 'open') return;
    const recipientId = record.senderId === record.conversation.buyerId ? record.conversation.sellerId : record.conversation.buyerId;
    const metadata = record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata) ? record.metadata as Record<string, unknown> : {};
    const receipts = (field: string) => metadata[field] && typeof metadata[field] === 'object' ? metadata[field] as Record<string, unknown> : {};
    if (receipts('readBy')[recipientId] || receipts('deletedFor')[recipientId] || Object.keys(receipts('deletedForEveryone')).length) return;
    if ((await getConversationBlockStatus(record.conversationId, record.senderId))?.blocked) return;
    await notifyConversationMessage({ senderName: record.sender.name,
      conversation: { ...record.conversation, messages: [], createdAt: record.conversation.createdAt.toISOString(), updatedAt: record.conversation.updatedAt.toISOString() },
      message: { ...record, type: 'text', status: 'sent', metadata: {}, createdAt: record.createdAt.toISOString() },
    });
    return;
  }
  throw new Error('invalid_notification_job');
}
