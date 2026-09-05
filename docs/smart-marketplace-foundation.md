# SmartStore AI Marketplace Foundation

This project is being shifted from a full-page shopping chatbot into a chat-first Saudi marketplace inspired by classifieds apps.

## Core Product Rules

- The app is a marketplace, not only a chatbot.
- The first screen shows listings, seller controls, and marketplace status.
- The AI chat is a side panel that stays available while the user browses.
- Users can ask questions, browse, search, and learn how the system works without signing in.
- Google sign-in is required only for account-bound actions.
- Before Google sign-in, the user must accept a commission acknowledgment: if a product is sold through the site, SmartStore AI is owed 1% of the product value.
- Listing creation and editing happen through natural conversation, not manual forms.
- The AI infers category, extracts listing details, asks short follow-up questions, requests images, and shows a preview before publishing.
- Buyer and seller communication happens through internal app conversations, not phone numbers.

## Account-Bound Actions

These actions must require a verified Google session:

- Publish a listing.
- Save a listing draft to an account.
- Edit, delete, pause, republish, or mark a listing as sold.
- Open a buyer-seller conversation.
- Send a message to another user.
- Save favorites.
- Submit reports.
- Accept offers or close a deal.

## Commission Acknowledgment

Registration is gated by a signed commission acknowledgment cookie.

- The agreement is shown before Google OAuth starts.
- The user must explicitly accept the 1% commission statement.
- The commission applies when the sale is completed through the site.
- When a listing is marked as sold, the system creates a commission record at 1% of the product value.
- If the listing price is not numeric, the commission remains pending until the seller enters the final sale value.
- Admins can mark commissions as due, paid, waived, or disputed.
- Browsing, asking marketplace questions, and learning how the chat works remain open without registration.
- Production should store the accepted agreement version, timestamp, user id after sign-in, and IP/user-agent audit metadata in the database.

## Marketplace Agents

The system is split into specialized agents. They have separate instructions, schemas, permissions, and model profiles. By default text agents use `deepseek-v4-flash`, image understanding uses `deepseek-v4-flash-vision-exp`, and deployment can override them with `DEEPSEEK_MODEL`, `DEEPSEEK_CHAT_MODEL`, `DEEPSEEK_SCOPE_MODEL`, `DEEPSEEK_MODERATION_MODEL`, and `DEEPSEEK_VISION_MODEL`.

- Intent Router
- Auth Gate
- Category Classifier
- Listing Intake
- Listing Writer
- Pricing Agent
- Search Agent
- Ranking Agent
- Comparison Agent
- Conversation Agent
- Negotiation Agent
- Safety/Fraud Agent
- Moderation Agent
- Image Quality Agent
- Support Agent

## Listing Schema

```ts
type ListingDraft = {
  id: string;
  sellerId: string;
  category: string;
  title?: string;
  description?: string;
  price?: number | "bid" | "negotiable";
  city?: string;
  condition?: "new" | "used" | "like_new" | "damaged";
  images: ListingImage[];
  attributes: Record<string, unknown>;
  status: "draft" | "pending" | "published" | "paused" | "sold" | "rejected" | "deleted";
};
```

There is no `contactMethod` field because communication is internal.

## Saudi And Islamic Compliance

The marketplace must block or review products that are illegal in Saudi Arabia or conflict with Islamic values.

Blocked examples:

- Alcohol and intoxicants.
- Drugs or drug paraphernalia.
- Gambling and betting products.
- Adult or sexual products.
- Magic, occult services, talismans, and similar claims.
- Counterfeit or stolen products.
- Unlicensed dangerous medicines.
- Weapons or ammunition unless a future licensed policy is implemented.

Sensitive or regulated examples should be routed to review:

- Tobacco or vape products.
- Prescription medicine.
- Financial accounts, bank-related items, and risky digital accounts.

## Image Quality And Enhancement

Images are uploaded through chat. The system must keep originals and create display derivatives.

Allowed enhancements:

- Crop around the product.
- Improve lighting.
- Sharpen mildly.
- Straighten.
- Compress.
- Create thumbnails.
- Blur phone numbers or sensitive information.

Forbidden enhancements:

- Hide scratches or defects.
- Change product color.
- Add accessories.
- Make a used product look new.
- Alter the truth of the item.

## Current Implementation Stage

The current code adds:

- Marketplace policy types.
- Intent and compliance guards.
- Google OAuth session routes.
- Chat API auth gate for account-bound actions.
- AI tools for listing drafts, image quality checks, and internal conversations.
- Temporary in-memory marketplace store for listings and conversations.
- Marketplace API routes for published listings, seller listings, conversation creation, conversation messages, favorites, and reports.
- A marketplace home screen with side chat and seller overview.
- Listing detail pages, account page, conversations pages, and favorites page.
- Admin moderation page guarded by `SMARTSTORE_ADMIN_EMAILS`.
- Tests for policy decisions, listing lifecycle, internal messages, favorites, reports, and image checks.

The database target is PostgreSQL through Prisma. The next stage should move runtime reads/writes from the development store into Prisma, then add production object storage, image processing workers, notification delivery, and richer search.

## Current API Routes

- `GET /api/marketplace/listings`: returns published listings.
- `POST /api/marketplace/listings`: creates a signed-in seller listing draft.
- `GET /api/marketplace/listings/[listingId]`: returns a published listing.
- `PATCH /api/marketplace/listings/[listingId]`: updates or controls a seller-owned listing.
- `POST /api/marketplace/listings/[listingId]/images`: uploads and evaluates a seller-owned listing image.
- `POST /api/marketplace/listings/[listingId]/favorite`: saves or removes a published listing from the signed-in user's favorites.
- `POST /api/marketplace/listings/[listingId]/reports`: submits a moderation report for a published listing.
- `GET /api/marketplace/me/listings`: returns the signed-in seller's listings and requires Google session.
- `GET /api/marketplace/me/conversations`: returns conversations for the signed-in buyer or seller.
- `GET /api/marketplace/me/favorites`: returns the signed-in user's saved listings.
- `GET /api/marketplace/me/commissions`: returns the signed-in seller's commission records.
- `PATCH /api/marketplace/commissions/[commissionId]`: lets the seller provide a final sale value for pending commission records.
- `POST /api/marketplace/conversations`: opens or reuses one internal conversation per listing, seller, and buyer.
- `GET /api/marketplace/conversations/[conversationId]`: returns a conversation only for its buyer or seller.
- `POST /api/marketplace/conversations/[conversationId]`: sends an internal message and blocks attempts to move contact or payment outside the platform.
- `GET /api/auth/session`: returns the current signed-in user.
- `POST /api/auth/commission-agreement`: stores the signed 1% commission acknowledgment before Google sign-in.
- `GET /api/auth/google/start`: starts Google OAuth.
- `GET /api/auth/google/callback`: completes Google OAuth and sets the signed session cookie.
- `POST /api/auth/logout`: clears the signed session cookie.
- `GET /api/admin/moderation`: returns sensitive listings and reports for admin users.
- `PATCH /api/admin/moderation/listings/[listingId]`: approves, rejects, or deletes a listing from moderation.
- `PATCH /api/admin/moderation/reports/[reportId]`: marks a report reviewed or dismissed.
- `GET /api/admin/commissions`: returns all commission records for admin users.
- `PATCH /api/admin/commissions/[commissionId]`: updates a commission payment status.

## Current AI Tools

- `createListingDraft`: creates a structured draft after conversational details are known.
- `analyzeListingImages`: checks quality and truth-preserving enhancement actions.
- `openMarketplaceConversation`: opens internal buyer-seller chat for a published listing.
- `toggleFavoriteListing`: saves or removes a published listing from favorites.
- `reportMarketplaceListing`: reports a listing for moderation review.

These tools run through the marketplace repository. In local fallback mode they use the development store, and in production mode they use PostgreSQL through Prisma.

## Local Persistence

For development, set:

```env
SMARTSTORE_MARKETPLACE_STORE=file
```

This writes marketplace state to `.data/marketplace-store.json` and uploaded listing images under `public/uploads/`. Both paths are git-ignored. Production should replace this with a database and object storage.
