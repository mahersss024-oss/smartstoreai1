import { check, group } from 'k6';

import { assertSafeReadScenario, loadEnv } from '../config/environment.js';
import { parseJson, think, timedGet, timedImageGet } from '../helpers/http.js';
import { handleSummary } from '../helpers/summary.js';

assertSafeReadScenario();

export const options = {
  scenarios: {
    image_delivery: {
      executor: 'ramping-vus',
      stages: [
        { duration: '30s', target: Math.min(loadEnv.maxVus, 50) },
        { duration: loadEnv.duration, target: loadEnv.maxVus },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    checks: ['rate==1'],
    smartstore_image_errors: ['rate<0.02'],
    smartstore_image_duration: ['p(95)<1500', 'p(99)<3000'],
  },
};

export { handleSummary };

export default function imageFlow() {
  group('listing image delivery', () => {
    const response = timedGet('/api/marketplace/listings?page=1&limit=24', 'public_listings');
    const payload = parseJson(response, { listings: [] });
    const listings = (payload?.listings || []).filter(listing => listing.images?.length);

    let imageRequests = 0;
    for (const listing of listings.slice(0, 4)) {
      for (const image of (listing.images || []).slice(0, 2)) {
        if (image.thumbnailUrl) {
          timedImageGet(image.thumbnailUrl, 'thumbnail_image');
          imageRequests += 1;
        }
        if (image.displayUrl) {
          timedImageGet(image.displayUrl, 'display_image');
          imageRequests += 1;
        }
      }
    }
    check(imageRequests, { 'image sample is not empty': count => count > 0 });

    think(0.2, 1);
  });
}
