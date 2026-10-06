import publicReadFlow, { handleSummary } from './public-read.js';
import { loadEnv } from '../config/environment.js';

export const options = {
  scenarios: {
    stress_read_mix: {
      executor: 'ramping-vus',
      stages: [
        { duration: '2m', target: 50 },
        { duration: '3m', target: 100 },
        { duration: '3m', target: 250 },
        { duration: '3m', target: Math.min(loadEnv.maxVus, 500) },
        { duration: '2m', target: 0 },
      ],
      gracefulRampDown: '45s',
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
