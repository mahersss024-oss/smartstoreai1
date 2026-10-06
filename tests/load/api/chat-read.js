import { group } from 'k6';

import { assertSafeReadScenario, loadEnv } from '../config/environment.js';
import { timedPost } from '../helpers/http.js';
import { handleSummary } from '../helpers/summary.js';

assertSafeReadScenario();

if (!loadEnv.sessionCookie) {
  throw new Error('Chat load tests require K6_SESSION_COOKIE for a test account.');
}

export const options = {
  scenarios: {
    chat_read_like_flow: {
      executor: 'ramping-vus',
      stages: [
        { duration: '30s', target: Math.min(loadEnv.maxVus, 10) },
        { duration: loadEnv.duration, target: loadEnv.maxVus },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    'http_req_duration{endpoint:chat_api}': ['p(95)<45000'],
  },
};

export { handleSummary };

export default function chatReadFlow() {
  group('assistant marketplace chat', () => {
    timedPost(
      '/api/chat',
      'chat_api',
      JSON.stringify({
        messages: [
          {
            role: 'user',
            parts: [{ type: 'text', text: 'ابحث عن سيارة كامري في الرياض' }],
          },
        ],
        locationSettings: { country: 'SA', currency: 'SAR', language: 'ar' },
      }),
      { timeout: '90s' },
    );
  });
}
