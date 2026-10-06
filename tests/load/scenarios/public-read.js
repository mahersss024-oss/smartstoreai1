import { group } from 'k6';

import { assertSafeReadScenario, loadEnv } from '../config/environment.js';
import { city, configuredListingId, searchTerm } from '../data/flows.js';
import { parseJson, think, timedGet, timedImageGet } from '../helpers/http.js';
import { handleSummary } from '../helpers/summary.js';

assertSafeReadScenario();

export const options = {
  scenarios: {
    marketplace_read_mix: {
      executor: 'ramping-vus',
      stages: [
        { duration: '1m', target: Math.min(loadEnv.maxVus, 50) },
        { duration: loadEnv.duration, target: loadEnv.maxVus },
        { duration: '1m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    'http_req_duration{endpoint:public_listings}': ['p(95)<1200'],
    'http_req_duration{endpoint:listing_detail}': ['p(95)<1500'],
    smartstore_endpoint_errors: ['rate<0.02'],
  },
};

export { handleSummary };

function fetchListings(params = '') {
  const response = timedGet(`/api/marketplace/listings${params}`, 'public_listings');
  return parseJson(response, { listings: [] });
}

export default function publicReadFlow() {
  let listingsPayload;

  group('home and listing feed', () => {
    timedGet('/', 'home_page');
    listingsPayload = fetchListings('?page=1&limit=24');
    think();
  });

  group('search and filters', () => {
    const query = encodeURIComponent(searchTerm());
    const selectedCity = encodeURIComponent(city());
    fetchListings(`?page=1&limit=24&q=${query}`);
    fetchListings(`?page=1&limit=24&q=${query}&city=${selectedCity}`);
    think();
  });

  group('listing detail and images', () => {
    const listing =
      listingsPayload?.listings?.[(__VU + __ITER) % Math.max(1, listingsPayload.listings.length)];
    const listingId = configuredListingId() || listing?.id;

    if (!listingId) return;

    const detailResponse = timedGet(`/api/marketplace/listings/${listingId}`, 'listing_detail');
    const detail = parseJson(detailResponse, { listing: null });
    const detailListing = detail?.listing || listing;

    timedGet(`/listings/${listingId}`, 'listing_detail_page');

    for (const image of (detailListing?.images || []).slice(0, 3)) {
      const imageUrl = image.thumbnailUrl || image.displayUrl || image.originalUrl;
      if (imageUrl) {
        timedImageGet(imageUrl, 'listing_image');
      }
    }
    think();
  });
}
