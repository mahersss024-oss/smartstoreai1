import type { MobileOperationContract } from './mobile-operation-types';

// Source anchors identify actions that share one endpoint and generic dispatcher.
// They locate existing client branches; they are not claims that a tap was tested.
const conversation = 'src/features/conversations/screens.tsx';
const listings = 'src/app/(tabs)/listings.tsx';
const binding = (file: string, sourceText: string, description: string) => ({ file, sourceText, description });
const anchors: Record<string, MobileOperationContract['actionEvidence']> = {
  'market.similar-cards': [binding('src/features/marketplace/listing-screen.tsx', '{ view: "similar" }', 'The detail GET uses view=similar for the separate similar-cards query.')],
  'listing.publish': [binding('src/features/listing-editor/screen.tsx', '{ action: "publish" }', 'The editor explicitly publishes through the existing listing PATCH.')],
  'listing.pause': [binding(listings, 'action(menuListing, "pause")', 'My listings dispatches the pause action after confirmation.')],
  'listing.mark-sold': [binding(listings, 'action(menuListing, "mark_sold")', 'My listings dispatches the sold action after confirmation.')],
  'listing.delete': [binding(listings, 'action(menuListing, "delete")', 'My listings dispatches listing deletion after confirmation.')],
  'conversations.send-message': [binding(conversation, '{ body: text }', 'The message branch supplies body text to conversation POST.')],
  'conversations.delete-message-for-me': [binding(conversation, 'mode: "for_me"', 'The shared delete_message dispatcher uses for_me.')],
  'conversations.delete-message-for-everyone': [binding(conversation, 'mode: "for_everyone"', 'The shared delete_message dispatcher uses for_everyone.')],
  'conversations.share-contact': [binding(conversation, 'action: "share_contact"', 'The shared action dispatcher sends share_contact.')],
  'conversations.block-user': [binding(conversation, 'action: "block_user"', 'The shared action dispatcher sends block_user.')],
  'conversations.unblock-user': [binding(conversation, 'action: "unblock_user"', 'The shared action dispatcher sends unblock_user.')],
  'conversations.report-user': [binding(conversation, 'action: "report_user"', 'The shared action dispatcher sends report_user.')],
};

export function attachMobileActionBindings(contracts: MobileOperationContract[]): MobileOperationContract[] {
  return contracts.map(contract => ({ ...contract, actionEvidence: anchors[contract.id] ?? [] }));
}
