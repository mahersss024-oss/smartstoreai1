import {
  deactivateSubscriptionById,
  listActiveSubscriptionsForUser,
} from '@/agent/marketplace/push-subscriptions';
import type {
  Conversation,
  ConversationMessage,
} from '@/agent/marketplace/types';

import { sendNativePushToUser } from './native-push';
import { sendWebPush } from './web-push';

type NotifyConversationMessageInput = {
  conversation: Conversation;
  message: ConversationMessage;
  senderName?: string | null;
};

function getConversationRecipientId(conversation: Conversation, senderId: string) {
  if (conversation.buyerId === senderId) {
    return conversation.sellerId;
  }

  if (conversation.sellerId === senderId) {
    return conversation.buyerId;
  }

  return null;
}

function buildMessagePreview(body: string) {
  const normalized = body.replace(/\s+/g, ' ').trim();

  if (normalized.length <= 90) {
    return normalized;
  }

  return `${normalized.slice(0, 87)}...`;
}

export async function notifyConversationMessage({
  conversation,
  message,
  senderName,
}: NotifyConversationMessageInput) {
  if (message.type !== 'text' || message.status !== 'sent') {
    return;
  }

  const recipientId = getConversationRecipientId(
    conversation,
    message.senderId,
  );

  if (!recipientId) {
    return;
  }

  const title = senderName?.trim()
    ? `رسالة جديدة من ${senderName.trim()}`
    : 'رسالة جديدة في سوق حمد';
  const pushMessage = {
    title,
    body: buildMessagePreview(message.body),
    url: `/conversations/${conversation.id}`,
    tag: `conversation:${conversation.id}`,
  };
  const subscriptions = await listActiveSubscriptionsForUser(recipientId);

  await Promise.all([
    ...subscriptions.map(async (subscription) => {
      const result = await sendWebPush(subscription, pushMessage);

      if (!result.ok && result.expired) {
        await deactivateSubscriptionById(subscription.id);
      } else if (!result.ok && result.reason !== 'push_not_configured') {
        throw new Error('web_push_delivery_failed');
      }
    }),
    sendNativePushToUser(recipientId, pushMessage),
  ]);
}
