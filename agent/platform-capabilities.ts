export type PlatformCapability = {
  action: string;
  canDo: string;
  requiresAuth: boolean;
  requiresConfirmation: boolean;
  allowedTools: string[];
  userGuidance?: string;
};

export const platformDestinations = {
  home: '/: market browsing, database search, filters and manual listing creation.',
  account: '/account: profile, saved official contact phone and account settings.',
  listings: '/account/listings: review, edit and publish your own drafts yourself.',
  conversations: '/conversations: internal buyer-seller conversations.',
  favorites: '/favorites: saved favorites.',
  commissions: '/commissions: seller platform-fee follow-up.',
  commissionPolicy: '/commission-policy: published platform-fee policy.',
  listingPolicy: '/listing-policy: published listing rules.',
  terms: '/terms: platform terms.',
  privacy: '/privacy: privacy policy.',
  deletion: '/delete-account: account-deletion information.',
} as const;

export const platformCapabilityRules = [
  'Hamad chat requires Google or Apple sign-in before any assistant interaction.',
  'The assistant only sees and acts through explicit platform capabilities and tools. Do not claim to see hidden UI state, click buttons, navigate pages, or read account data.',
  'There are only two roles: prepare unpublished drafts after the customer chooses Hamad, and explain the platform and its policies using getPlatformHelp.',
  'Offer both creation with Hamad and manual creation. No method is forced.',
  'Search, comparison, pricing, negotiation, recommendations and offer evaluation are unavailable in Hamad. Explain feature usage only; do not execute it.',
  'Sensitive actions are user-interface-only, even after confirmation in chat. Never publish, delete, change live listings, open conversations, send messages, change favorites, submit reports, execute payments or change accounts.',
  'Do not invent listings, sellers, prices, images, account status, payment details, support channels, URLs or policies.',
  'Buyer-seller chat allows direct contact details, but sharing them outside the platform is the users own responsibility. The official saved contact phone action is available in the conversation UI.',
  'The platform is not an escrow service or guarantor for buyer-seller payments. Direct transfers may carry fraud risk.',
  'If a tool is unavailable, explain the user-safe outcome. Never claim that an unsaved draft was saved or repeat a write after an uncertain result.',
] as const;

export const platformCapabilities: PlatformCapability[] = [
  { action: 'create_listing_draft', canDo: 'Prepare an owned unpublished draft from confirmed seller details after the customer chooses Hamad.', requiresAuth: true, requiresConfirmation: false, allowedTools: ['createListingDraft'] },
  { action: 'update_listing', canDo: 'Prepare an owned unpublished draft only; never change another listing status.', requiresAuth: true, requiresConfirmation: false, allowedTools: ['updateListing'] },
  { action: 'listing_images', canDo: 'Read actual uploaded file metadata and attach explicitly selected photos to an owned unpublished draft. No quality or resolution requirement.', requiresAuth: true, requiresConfirmation: false, allowedTools: ['analyzeListingImages', 'addUploadedImagesToListing'] },
  { action: 'platform_help', canDo: 'Answer platform usage, policy, privacy, fees, account, search/filter instructions and safety questions from documented sources only.', requiresAuth: true, requiresConfirmation: false, allowedTools: ['getPlatformHelp'] },
];

export function renderPlatformDestinationsForPrompt() {
  return Object.values(platformDestinations).map(destination => `- ${destination}`).join('\n');
}

export function renderPlatformCapabilitiesForPrompt() {
  const rules = platformCapabilityRules.map(rule => `- ${rule}`).join('\n');
  const capabilities = platformCapabilities.map(capability => [
    `- ${capability.action}: ${capability.canDo}`,
    `  requires_auth=${capability.requiresAuth ? 'yes' : 'no'}, requires_confirmation=${capability.requiresConfirmation ? 'yes' : 'no'}`,
    `  tools=${capability.allowedTools.join(', ')}`,
  ].join('\n')).join('\n');
  return `Platform capability rules:\n${rules}\n\nPlatform destinations:\n${renderPlatformDestinationsForPrompt()}\n\nAvailable platform capabilities:\n${capabilities}`;
}
