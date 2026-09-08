export const defaultMaxListingsPerSeller = 100;

export class ListingLimitReachedError extends Error {
  readonly code = 'seller_listing_limit_reached';
  readonly maxListings: number;

  constructor(maxListings = getMaxListingsPerSeller()) {
    super(`Seller listing limit reached: ${maxListings}`);
    this.name = 'ListingLimitReachedError';
    this.maxListings = maxListings;
  }
}

export function getMaxListingsPerSeller() {
  const configuredValue = Number.parseInt(
    process.env.SMARTSTORE_MAX_LISTINGS_PER_SELLER ?? '',
    10,
  );

  if (!Number.isFinite(configuredValue) || configuredValue <= 0) {
    return defaultMaxListingsPerSeller;
  }

  return configuredValue;
}

export function hasReachedSellerListingLimit(listingCount: number) {
  return listingCount >= getMaxListingsPerSeller();
}

export function isListingLimitReachedError(
  error: unknown,
): error is ListingLimitReachedError {
  return (
    error instanceof ListingLimitReachedError ||
    (typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'seller_listing_limit_reached')
  );
}
