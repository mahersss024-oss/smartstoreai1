import { group } from 'k6';

import { assertSafeReadScenario, loadEnv } from '../config/environment.js';
import { configuredListingId, searchTerm } from '../data/flows.js';
import { parseJson, think, timedGet } from '../helpers/http.js';
import { handleSummary } from '../helpers/summary.js';

assertSafeReadScenario();

export const options = {
  scenarios: {
    page_navigation_flow: {
      executor: 'ramping-vus',
      stages: [
        { duration: '30s', target: Math.min(loadEnv.maxVus, 25) },
        { duration: loadEnv.duration, target: loadEnv.maxVus },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    smartstore_endpoint_errors: ['rate<0.02'],
    'http_req_duration{endpoint:home_page}': ['p(95)<1500'],
    'http_req_duration{endpoint:listing_detail_page}': ['p(95)<1800'],
  },
};

export { handleSummary };

export default function pageFlow() {
  group('home to search to detail', () => {
    timedGet('/', 'home_page');
    const query = encodeURIComponent(searchTerm());
    const listingsResponse = timedGet(
      `/api/marketplace/listings?q=${query}&page=1&limit=24`,
      'public_search_api',
    );
    const listings = parseJson(listingsResponse, { listings: [] });
    const listingId = configuredListingId() || listings?.listings?.[0]?.id;

    if (listingId) {
      timedGet(`/listings/${listingId}`, 'listing_detail_page');
      timedGet(`/api/marketplace/listings/${listingId}`, 'listing_detail_api');
    }
    think();
  });

  group('account and protected read probes', () => {
    timedGet('/account', 'account_page');
    timedGet('/api/auth/session', 'session_api');
    timedGet('/conversations', 'conversations_page');
    timedGet('/favorites', 'favorites_page');
    timedGet('/notifications', 'notifications_page');
    think();
  });
}
