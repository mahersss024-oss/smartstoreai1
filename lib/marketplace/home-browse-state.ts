export type HomeBrowseFilters = {
  searchInput: string;
  categoryGroup: string;
  subcategory: string;
  city: string;
};

export type HomeBrowseState<Listing> = HomeBrowseFilters & {
  listings: Listing[];
  listingsKey: string;
  pagination: { page: number; hasMore: boolean };
  nearbyCity: string | null;
  filterOpen: boolean;
  viewport: { scrollTop: number; contentOffset: string; toolsHidden: boolean };
};

// Public browsing state lives only in this tab's runtime, separately from chat.
let snapshot: HomeBrowseState<unknown> | null = null;

export function getHomeBrowseKey(filters: HomeBrowseFilters) {
  return JSON.stringify([filters.searchInput.trim(), filters.categoryGroup, filters.subcategory, filters.city]);
}

export function readHomeBrowseState<Listing>(): HomeBrowseState<Listing> | null {
  return snapshot as HomeBrowseState<Listing> | null;
}

export function writeHomeBrowseState<Listing>(state: HomeBrowseState<Listing>) {
  snapshot = state;
}

export function clearHomeBrowseState() {
  snapshot = null;
}

type BrowsePage<Listing> = {
  listings?: Listing[];
  pagination?: { page?: number; hasMore?: boolean };
};

export async function reloadHomeBrowsePages<Listing extends { id: string }>(
  pageCount: number,
  fetchPage: (page: number) => Promise<BrowsePage<Listing>>,
) {
  const listings: Listing[] = [];
  const seen = new Set<string>();
  const lastPage = Number.isSafeInteger(pageCount) && pageCount > 0 ? pageCount : 1;
  let pagination = { page: 1, hasMore: false };
  for (let page = 1; page <= lastPage; page++) {
    const payload = await fetchPage(page);
    if (!payload.listings) throw new Error('invalid_listings_response');
    for (const listing of payload.listings) {
      if (seen.has(listing.id)) continue;
      seen.add(listing.id);
      listings.push(listing);
    }
    pagination = { page: payload.pagination?.page ?? page, hasMore: Boolean(payload.pagination?.hasMore) };
    if (!pagination.hasMore) break;
  }
  return { listings, pagination };
}
