export type PlatformCapability = {
  action: string;
  canDo: string;
  requiresAuth: boolean;
  requiresConfirmation: boolean;
  allowedTools: string[];
  userGuidance?: string;
};

export const platformDestinations = {
  account:
    '/account: profile, saved official contact phone, seller listings, favorites, and account deletion.',
  conversations:
    '/conversations: internal buyer-seller conversations linked to listings.',
  commissions:
    '/commissions: seller commission status and payment follow-up.',
  commissionPolicy: '/commission-policy: the 1 percent commission policy.',
  listingPolicy: '/listing-policy: allowed, restricted, and prohibited listing rules.',
  terms: '/terms: platform terms.',
  privacy: '/privacy: privacy policy.',
} as const;

export const platformCapabilityRules = [
  'SmartStore AI chat requires Google or Apple sign-in before any assistant interaction. If a request reaches an AI model, treat the user as signed in and tied to the authenticated session.',
  'The assistant only sees and acts through explicit platform capabilities and tools. Do not claim to see hidden UI state, click buttons, navigate pages, or read account data unless a tool result provides it.',
  'Use real SmartStore AI marketplace data only. Do not invent listings, sellers, prices, images, conversations, favorites, reports, commission status, payment recipients, support channels, URLs, or policies.',
  'Manual phone numbers and emails are blocked in buyer-seller chat. Sellers can share only the one official saved contact phone through the dedicated conversation action.',
  'If the user asks how to use the app, give short practical steps and mention the relevant destination only when useful.',
  'If a required tool is unavailable or returns an error, explain the user-safe outcome and next step without exposing internal errors.',
] as const;

export const platformCapabilities: PlatformCapability[] = [
  {
    action: 'search_listings',
    canDo: 'Search and narrow published marketplace listings using buyer language, filters, and visible listing cards.',
    requiresAuth: true,
    requiresConfirmation: false,
    allowedTools: ['searchMarketplaceListings'],
    userGuidance: 'Tell the user they can open visible listing cards for full details.',
  },
  {
    action: 'compare_listings',
    canDo: 'Compare a specific visible listing with real comparable marketplace listings.',
    requiresAuth: true,
    requiresConfirmation: false,
    allowedTools: ['compareMarketplaceListings'],
  },
  {
    action: 'create_listing_draft',
    canDo: 'Create a seller listing draft from a minimum reliable product signal and preserve all confirmed seller details.',
    requiresAuth: true,
    requiresConfirmation: false,
    allowedTools: ['createListingDraft'],
    userGuidance: 'Do not block draft creation because optional details are missing.',
  },
  {
    action: 'update_listing',
    canDo: 'Update a seller-owned listing or current draft when the target is clear.',
    requiresAuth: true,
    requiresConfirmation: false,
    allowedTools: ['updateListing'],
  },
  {
    action: 'publish_or_status_change',
    canDo: 'Publish, pause, republish, mark sold, or delete seller-owned listings.',
    requiresAuth: true,
    requiresConfirmation: true,
    allowedTools: ['setListingStatus'],
  },
  {
    action: 'listing_images',
    canDo: 'Analyze listing images, attach uploaded images, set the primary image, or delete listing images.',
    requiresAuth: true,
    requiresConfirmation: true,
    allowedTools: [
      'analyzeListingImages',
      'addUploadedImagesToListing',
      'setPrimaryListingImage',
      'deleteListingImage',
    ],
    userGuidance: 'Image deletion and primary-image changes require a clear target and explicit confirmation.',
  },
  {
    action: 'open_conversation',
    canDo: 'Open one internal buyer-seller conversation for a specific published listing.',
    requiresAuth: true,
    requiresConfirmation: false,
    allowedTools: ['openMarketplaceConversation'],
    userGuidance: 'Do not open a conversation for the seller on their own listing.',
  },
  {
    action: 'favorites',
    canDo: "Save or remove another seller's listing from favorites.",
    requiresAuth: true,
    requiresConfirmation: false,
    allowedTools: ['toggleFavoriteListing'],
    userGuidance: 'A seller cannot favorite their own listing.',
  },
  {
    action: 'reports',
    canDo: 'Report a specific listing for fraud, abuse, misleading content, prohibited products, or wrong category.',
    requiresAuth: true,
    requiresConfirmation: true,
    allowedTools: ['reportMarketplaceListing'],
  },
  {
    action: 'pricing_guidance',
    canDo: 'Estimate a listing price from comparable marketplace listings and confidence signals.',
    requiresAuth: true,
    requiresConfirmation: false,
    allowedTools: ['estimateListingPrice'],
    userGuidance: 'Present pricing as a calculated range, not a guaranteed sale price.',
  },
  {
    action: 'negotiation_guidance',
    canDo: 'Privately evaluate offer strength and suggest advisory negotiation options.',
    requiresAuth: true,
    requiresConfirmation: false,
    allowedTools: ['evaluateNegotiationOffer'],
    userGuidance:
      'Never send, accept, reject, counter, change price, close, or commit to a deal on behalf of the user.',
  },
  {
    action: 'platform_help',
    canDo: 'Explain how the signed-in user uses SmartStore AI pages, policies, account settings, conversations, commissions, and contact sharing.',
    requiresAuth: true,
    requiresConfirmation: false,
    allowedTools: [],
  },
];

function formatBoolean(value: boolean) {
  return value ? 'yes' : 'no';
}

export function renderPlatformDestinationsForPrompt() {
  return Object.values(platformDestinations)
    .map((destination) => `- ${destination}`)
    .join('\n');
}

export function renderPlatformCapabilitiesForPrompt() {
  const rules = platformCapabilityRules.map((rule) => `- ${rule}`).join('\n');
  const capabilities = platformCapabilities
    .map((capability) =>
      [
        `- ${capability.action}: ${capability.canDo}`,
        `  requires_auth=${formatBoolean(capability.requiresAuth)}, requires_confirmation=${formatBoolean(capability.requiresConfirmation)}`,
        `  tools=${capability.allowedTools.length ? capability.allowedTools.join(', ') : 'none'}`,
        capability.userGuidance ? `  guidance=${capability.userGuidance}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n');

  return `Platform capability rules:\n${rules}\n\nPlatform destinations:\n${renderPlatformDestinationsForPrompt()}\n\nAvailable platform capabilities:\n${capabilities}`;
}
