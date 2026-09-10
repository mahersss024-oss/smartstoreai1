export function getDisplayedListings<T>(input: {
  marketplaceListings: readonly T[];
  searchToolListings: readonly T[];
}) {
  if (input.searchToolListings.length > 0) {
    return [...input.searchToolListings];
  }

  return [...input.marketplaceListings];
}

export function getCanLoadMoreListings(input: {
  hasMore: boolean;
  displayedCount: number;
  hasSearchToolListings: boolean;
}) {
  return (
    !input.hasSearchToolListings &&
    input.hasMore &&
    input.displayedCount > 0
  );
}