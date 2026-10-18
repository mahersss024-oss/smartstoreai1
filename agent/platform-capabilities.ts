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
  'Hamad chat requires Google or Apple sign-in before any assistant interaction. If a request reaches an AI model, treat the user as signed in and tied to the authenticated session.',
  'The assistant only sees and acts through explicit platform capabilities and tools. Do not claim to see hidden UI state, click buttons, navigate pages, or read account data unless a tool result provides it.',
  'Chat may prepare unpublished drafts only. Sensitive actions require the user to operate the marketplace UI themselves. A model-generated confirmation flag or a yes in chat never authorizes publishing, changing live listings, pausing, marking sold, deleting, opening conversations, sending messages, changing image selection, favorites, reports, payments, account changes or permissions.',
  'Use real سوق حمد marketplace data only. Do not invent listings, sellers, prices, images, conversations, favorites, reports, commission status, payment recipients, support channels, URLs, or policies.',
  'Buyer-seller chat allows direct contact details, but sharing contact or payment information outside the platform is the users own responsibility. Sellers can still use the official saved contact phone action as a clearer trusted option.',
  'Sharing a public listing link is allowed when a real listingUrl is available from a marketplace tool or verified selected listing context.',
  'سوق حمد is not an escrow service, payment processor, money-transfer intermediary, or guarantor for buyer-seller payments. Money transfers between buyer and seller are their own responsibility and may carry fraud risk.',
  'If the user asks how to use the app, give short practical steps and mention the relevant destination only when useful.',
  'If a required tool is unavailable or returns an error, explain the user-safe outcome and next step without exposing internal errors.',
] as const;

export const platformCapabilities: PlatformCapability[] = [
  {
    action: 'search_listings',
    canDo: 'Search and narrow published marketplace listings using dedicated structured buyer understanding, filters, and visible listing cards.',
    requiresAuth: true,
    requiresConfirmation: false,
    allowedTools: ['searchMarketplaceListings'],
    userGuidance:
      'Tell the user they can open visible listing cards for full details. If a requested match is not visible in smart results but a real listingUrl is available, share that link in text.',
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
    canDo: 'Prepare details of a seller-owned unpublished draft only; changes to all non-draft listings require the user interface.',
    requiresAuth: true,
    requiresConfirmation: false,
    allowedTools: ['updateListing'],
  },
  {
    action: 'publish_or_status_change',
    canDo: 'Guide the seller to review and operate status controls themselves. Assistant chat cannot publish listings, pause, mark sold or delete them.',
    requiresAuth: true,
    requiresConfirmation: true,
    allowedTools: [],
    userGuidance:
      'For publishing, direct the seller to Account > My listings so they can review the draft and press the publish button themselves.',
  },
  {
    action: 'listing_images',
    canDo: 'Analyze images and attach uploaded images to unpublished drafts only. Primary-image changes, deletion and all changes to non-draft images require the user interface.',
    requiresAuth: true,
    requiresConfirmation: true,
    allowedTools: [
      'analyzeListingImages',
      'addUploadedImagesToListing',
    ],
    userGuidance: 'The user must delete images or select a primary image using Account > My listings themselves.',
  },
  {
    action: 'open_conversation',
    canDo: 'Guide the user to open the listing details page and use the visible buyer-seller contact button. The assistant must not create the conversation itself.',
    requiresAuth: true,
    requiresConfirmation: false,
    allowedTools: [],
    userGuidance:
      'Never open a buyer-seller conversation from chat. If a listing id is known, provide its public listing link and tell the user to use the contact button on that page.',
  },
  {
    action: 'favorites',
    canDo: 'Guide the user to the favorite button; never save or remove favorites from chat.',
    requiresAuth: true,
    requiresConfirmation: false,
    allowedTools: [],
    userGuidance: 'A seller cannot favorite their own listing.',
  },
  {
    action: 'reports',
    canDo: 'Explain reporting and guide the user to submit a report from the listing UI themselves; never submit reports from chat.',
    requiresAuth: true,
    requiresConfirmation: true,
    allowedTools: [],
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
    canDo: 'Explain how the signed-in user uses سوق حمد pages, policies, account settings, conversations, commissions, and contact sharing.',
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
