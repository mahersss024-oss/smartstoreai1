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
  void input.searchToolListings;

  return [...input.marketplaceListings];
}

export function getCanLoadMoreExploreListings(input: {
  hasMore: boolean;
  displayedCount: number;
}) {
  return input.hasMore && input.displayedCount > 0;
}
