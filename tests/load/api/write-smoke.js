import { check, group } from 'k6';
import { randomString } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

import { assertSafeWriteScenario, loadEnv } from '../config/environment.js';
import { parseJson, think, timedPost } from '../helpers/http.js';
import { handleSummary } from '../helpers/summary.js';

assertSafeWriteScenario();

export const options = {
  scenarios: {
    staging_write_smoke: {
      executor: 'constant-vus',
      vus: Math.min(loadEnv.maxVus, 25),
      duration: loadEnv.duration,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    smartstore_endpoint_errors: ['rate<0.05'],
    checks: ['rate==1'],
  },
};

export { handleSummary };

export default function writeSmoke() {
  group('create listing draft in staging', () => {
    const suffix = randomString(8);
    const response = timedPost(
      '/api/marketplace/listings',
      'create_listing_draft',
      JSON.stringify({
        category: 'other',
        title: `Load test listing ${suffix}`,
        description: 'Temporary staging load-test listing. Used condition. Safe to delete.',
        price: 'negotiable',
        city: 'الرياض',
        attributes: { source: 'k6' },
      }),
      {
        headers: {
          'Idempotency-Key': `k6-${__VU}-${__ITER}-${suffix}`,
        },
      },
    );
    check(response, {
      'write smoke creates an unpublished draft': result => result.status === 201 && parseJson(result)?.listing?.status === 'draft',
    });
    think();
  });
}
