export type MarketplaceIntent =
  | 'general_info'
  | 'search_listing'
  | 'create_listing'
  | 'update_listing'
  | 'delete_listing'
  | 'pause_listing'
  | 'mark_sold'
  | 'open_conversation'
  | 'send_message'
  | 'favorite_listing'
  | 'report_listing'
  | 'compare_listings'
  | 'price_listing'
  | 'negotiate'
  | 'support';

export type ListingStatus =
  | 'draft'
  | 'pending'
  | 'published'
  | 'paused'
  | 'sold'
  | 'rejected'
  | 'deleted';

export type ListingCondition = 'new' | 'used' | 'like_new' | 'damaged';

export type ListingImageStatus =
  | 'pending_review'
  | 'approved'
  | 'needs_retake'
  | 'rejected';

export type ImageEnhancementAction =
  | 'auto_crop'
  | 'improve_lighting'
  | 'sharpen'
  | 'straighten'
  | 'blur_sensitive_info'
  | 'compress'
  | 'create_thumbnail';

export type ListingImage = {
  id: string;
  listingId: string;
  originalUrl: string;
  displayUrl: string;
  thumbnailUrl: string;
  isPrimary: boolean;
  qualityScore: number;
  status: ListingImageStatus;
  enhancements: ImageEnhancementAction[];
};

export type ListingDraft = {
  id: string;
  sellerId: string;
  category: string;
  title?: string;
  description?: string;
  price?: number | 'bid' | 'negotiable';
  city?: string;
  condition?: ListingCondition;
  images: ListingImage[];
  attributes: Record<string, unknown>;
  status: ListingStatus;
};

export type Conversation = {
  id: string;
  listingId: string;
  sellerId: string;
  buyerId: string;
  status: 'open' | 'closed' | 'reported';
  messages: ConversationMessage[];
  createdAt: string;
  updatedAt: string;
};

export type ConversationMessage = {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  status: 'sent' | 'blocked';
  type: 'text' | 'contact_share';
  reasons: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type FavoriteRecord = {
  id: string;
  listingId: string;
  userId: string;
  createdAt: string;
};

export type ReportRecord = {
  id: string;
  listingId: string;
  reporterId: string;
  reason: string;
  details?: string;
  status: 'open' | 'reviewed' | 'dismissed';
  createdAt: string;
};

export type CommissionStatus =
  | 'pending_amount'
  | 'due'
  | 'paid'
  | 'waived'
  | 'disputed';

export type CommissionRecord = {
  id: string;
  listingId: string;
  sellerId: string;
  productValue: number | null;
  commissionRatePercent: 1;
  commissionAmount: number | null;
  status: CommissionStatus;
  source: 'site_sale';
  paidAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type MarketplaceIntentDecision = {
  intent: MarketplaceIntent;
  requiresAuth: boolean;
  requiresConfirmation: boolean;
  reasonCode: string;
};

export type ComplianceDecision = {
  decision: 'allow' | 'block' | 'needs_review';
  reasons: string[];
  jurisdiction: 'SA';
  shariaSensitive: boolean;
  prohibitedCategory?: string;
};
