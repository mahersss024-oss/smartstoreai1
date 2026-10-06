import publicReadFlow, { handleSummary } from './public-read.js';
import { loadEnv } from '../config/environment.js';

const maxVus = loadEnv.maxVus || 1000;

export const options = {
  scenarios: {
    spike_read_mix: {
      executor: 'ramping-vus',
      stages: [
        { duration: '1m', target: Math.min(100, maxVus) },
        { duration: '30s', target: maxVus },
        { duration: '2m', target: maxVus },
        { duration: '30s', target: Math.min(100, maxVus) },
        { duration: '1m', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
    smartstore_endpoint_errors: ['rate<0.02'],
    http_req_duration: ['p(95)<3000', 'p(99)<7000'],
  },
};

export { handleSummary };
export default publicReadFlow;
