import publicReadFlow, { handleSummary } from './public-read.js';
import { loadEnv } from '../config/environment.js';

export const options = {
  scenarios: {
    soak_read_mix: {
      executor: 'constant-vus',
      vus: loadEnv.maxVus,
      duration: loadEnv.duration || '30m',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    smartstore_endpoint_errors: ['rate<0.02'],
    http_req_duration: ['p(95)<2500', 'p(99)<5000'],
  },
};

export { handleSummary };
export default publicReadFlow;
