import { group } from 'k6';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

import { assertSafeWriteScenario } from '../config/environment.js';
import { timedPost } from '../helpers/http.js';
import { handleSummary } from '../helpers/summary.js';

assertSafeWriteScenario();

export const options = {
  scenarios: {
    staging_write_smoke: {
      executor: 'constant-vus',
      vus: Math.min(Number(__ENV.K6_MAX_VUS || 5), 25),
      duration: __ENV.K6_DURATION || '1m',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    smartstore_endpoint_errors: ['rate<0.05'],
  },
};

export { handleSummary };

export default function writeSmoke() {
  group('create listing draft in staging', () => {
    const suffix = randomString(8);
    timedPost(
      '/api/marketplace/listings',
      'create_listing_draft',
      JSON.stringify({
        category: 'load-test',
        title: `Load test listing ${suffix}`,
        description: 'Temporary staging load-test listing. Safe to delete.',
        price: 'negotiable',
        city: 'riyadh',
        condition: 'used',
        attributes: { source: 'k6' },
      }),
      {
        headers: {
          'Idempotency-Key': `k6-${__VU}-${__ITER}-${suffix}`,
        },
      },
    );
  });
}
