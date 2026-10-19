import type { FileUIPart, PrepareSendMessagesRequest, UIMessage } from 'ai';
import { selectChatContext } from './context';
import { parseChatConversationId } from './conversation';

export type RetainedChatImage = Pick<FileUIPart, 'type' | 'url' | 'mediaType' | 'filename'>;

export function createChatImageContext(ownerId: string | null) {
  let conversationId: string = crypto.randomUUID();
  let images: RetainedChatImage[] = [];
  let sourceMessageId: string | null = null;
  const prepareRequest = ({ messages, body }: Parameters<PrepareSendMessagesRequest<UIMessage>>[0]) => {
    const context = selectChatContext(messages);
    const latestUser = context.findLast(message => message.role === 'user');
    const currentImages = latestUser?.parts.filter((part): part is FileUIPart => part.type === 'file' && part.mediaType.startsWith('image/')).slice(0, 8) ?? [];
    if (currentImages.length) {
      images = currentImages.map(({ type, url, mediaType, filename }) => ({ type, url, mediaType, filename }));
      sourceMessageId = latestUser!.id;
    }
    const retained = !currentImages.length && context.some(message => message.role === 'user' && message.id === sourceMessageId);
    return { body: { ...body, chatOwnerId: ownerId, chatConversationId: conversationId, messages: context,
      retainedListingImages: retained ? images : [],
      retainedListingImageMessageId: retained ? sourceMessageId : undefined,
    } };
  };
  return {
    prepareRequest,
    snapshot: () => ({ images, sourceMessageId, conversationId }),
    restore: (savedImages: RetainedChatImage[], savedSource: string | null, savedConversationId?: string) => {
      images = savedImages;
      sourceMessageId = savedSource;
      conversationId = parseChatConversationId(savedConversationId) ?? conversationId;
    },
    clear: () => { images = []; sourceMessageId = null; conversationId = crypto.randomUUID(); },
  };
}
