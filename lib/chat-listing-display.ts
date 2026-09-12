const defaultAssistantListingLimit = 12;

export function getAssistantResultListings<T>(input: {
  searchToolListings: readonly T[];
  limit?: number;
}) {
  const limit = Math.max(1, input.limit ?? defaultAssistantListingLimit);

  return input.searchToolListings.slice(0, limit);
}

export function getExploreListings<T extends { id?: string | null }>(input: {
  marketplaceListings: readonly T[];
  searchToolListings: readonly T[];
}) {
  const searchListingIds = new Set(
    input.searchToolListings
      .map((listing) => listing.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  );

  if (searchListingIds.size === 0) {
    return [...input.marketplaceListings];
  }

  return input.marketplaceListings.filter(
    (listing) => !listing.id || !searchListingIds.has(listing.id),
  );
}

export function getCanLoadMoreExploreListings(input: {
  hasMore: boolean;
  displayedCount: number;
}) {
  return input.hasMore && input.displayedCount > 0;
}
